const { spawn } = require("child_process");

const DEFAULT_FIXTURE_ROOT = "Notidian Integration Fixtures";
const DEFAULT_PLUGIN_ID = "notidian";
const DEFAULT_TIMEOUT_MS = 10000;
const DEFAULT_COMMAND_TIMEOUT_MS = 20000;
const DEFAULT_POLL_INTERVAL_MS = 250;
const DEFAULT_CLEANUP_SETTLE_MS = 1000;
const DEFAULT_TABLE_UI_EDIT_VALUE = "ui-active";
const DEFAULT_TABLE_UI_PASTE_STATUS = "paste-active";
const DEFAULT_TABLE_UI_PASTE_RATING = "7";
const DEFAULT_TABLE_UI_OPTION_STAGE = "option-review";
const DEFAULT_TABLE_UI_TYPE_COLUMN = "stage";
const DEFAULT_TABLE_UI_CONFLICT_EXTERNAL = "conflict-external";
const DEFAULT_TABLE_UI_CONFLICT_APPLIED = "conflict-applied";
const DEFAULT_FRAME_LIST_VIEW_ID = "filesView";
const DEFAULT_CONTEXT_SCHEMA_ID = "files";

const normalizeCliValue = (value) => {
  const trimmed = String(value ?? "")
    .trim()
    .replace(/^=>\s*/, "");
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
};

const parseIntegerOption = (value, fallback) => {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const parseHarnessArgs = (argv = process.argv.slice(2), env = process.env) => {
  const config = {
    vault: env.NOTIDIAN_REAL_VAULT ?? "",
    allowWrite: false,
    keepFixture: false,
    includeUi: false,
    pluginId: DEFAULT_PLUGIN_ID,
    fixtureRoot: DEFAULT_FIXTURE_ROOT,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    commandTimeoutMs: DEFAULT_COMMAND_TIMEOUT_MS,
    pollIntervalMs: DEFAULT_POLL_INTERVAL_MS,
    cleanupSettleMs: DEFAULT_CLEANUP_SETTLE_MS,
    obsidianBin: env.OBSIDIAN_BIN ?? "obsidian",
  };

  for (const arg of argv) {
    if (arg == "--allow-write") {
      config.allowWrite = true;
      continue;
    }
    if (arg == "--keep-fixture") {
      config.keepFixture = true;
      continue;
    }
    if (arg == "--ui") {
      config.includeUi = true;
      continue;
    }
    const separator = arg.indexOf("=");
    if (separator < 0) continue;

    const key = arg.slice(0, separator).replace(/^--/, "");
    const value = arg.slice(separator + 1);
    switch (key) {
      case "vault":
        config.vault = value;
        break;
      case "plugin-id":
        config.pluginId = value;
        break;
      case "fixture-root":
        config.fixtureRoot = value;
        break;
      case "timeout-ms":
        config.timeoutMs = parseIntegerOption(value, config.timeoutMs);
        break;
      case "command-timeout-ms":
        config.commandTimeoutMs = parseIntegerOption(
          value,
          config.commandTimeoutMs
        );
        break;
      case "poll-interval-ms":
        config.pollIntervalMs = parseIntegerOption(
          value,
          config.pollIntervalMs
        );
        break;
      case "cleanup-settle-ms":
        config.cleanupSettleMs = parseIntegerOption(
          value,
          config.cleanupSettleMs
        );
        break;
    }
  }

  return config;
};

const validateHarnessConfig = (config) => {
  const errors = [];

  if (!String(config.vault ?? "").trim()) {
    errors.push(
      "Set vault=<name> or NOTIDIAN_REAL_VAULT before running the real-vault harness."
    );
  }

  if (!config.allowWrite) {
    errors.push(
      "Pass --allow-write to permit fixture creation in the selected vault."
    );
  }

  if (!String(config.fixtureRoot ?? "").trim()) {
    errors.push("Set --fixture-root to a non-empty vault folder path.");
  }

  if (!Number.isFinite(config.timeoutMs) || config.timeoutMs <= 0) {
    errors.push("Set --timeout-ms to a positive integer.");
  }

  if (
    !Number.isFinite(config.commandTimeoutMs) ||
    config.commandTimeoutMs <= 0
  ) {
    errors.push("Set --command-timeout-ms to a positive integer.");
  }

  if (!Number.isFinite(config.pollIntervalMs) || config.pollIntervalMs < 0) {
    errors.push("Set --poll-interval-ms to zero or a positive integer.");
  }

  if (!Number.isFinite(config.cleanupSettleMs) || config.cleanupSettleMs < 0) {
    errors.push("Set --cleanup-settle-ms to zero or a positive integer.");
  }

  return errors;
};

const joinVaultPath = (...parts) =>
  parts
    .map((part) => String(part ?? "").replace(/^\/+|\/+$/g, ""))
    .filter(Boolean)
    .join("/");

const runIdForDate = (date) =>
  `notidian-smoke-${date.toISOString().replace(/[:.]/g, "-")}`;

const createFixturePaths = (config, now = new Date()) => {
  const runId = runIdForDate(now);
  const folder = joinVaultPath(config.fixtureRoot);
  const prefix = joinVaultPath(folder, runId);
  return {
    runId,
    folder,
    prefix,
    alphaPath: `${prefix}-Alpha.md`,
    betaPath: `${prefix}-Beta.md`,
    alphaRenamedPath: `${prefix}-Alpha Renamed.md`,
    alphaUiRenamedPath: `${prefix}-Alpha UI Renamed.md`,
  };
};

const buildObsidianArgs = (config, command, args = {}) => {
  const builtArgs = [`vault=${config.vault}`, command];

  for (const [key, value] of Object.entries(args)) {
    if (value === true) {
      builtArgs.push(key);
      continue;
    }
    if (value === false || value == null) continue;
    builtArgs.push(`${key}=${String(value)}`);
  }

  return builtArgs;
};

const createObsidianRunner = (
  obsidianBin,
  commandTimeoutMs = DEFAULT_COMMAND_TIMEOUT_MS
) => (args) =>
  new Promise((resolve, reject) => {
    const child = spawn(obsidianBin, args, {
      stdio: ["ignore", "pipe", "pipe"],
      detached: process.platform !== "win32",
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let forceKillTimeout = null;
    const commandKillGraceMs = Math.min(
      1000,
      Math.max(50, Math.floor(commandTimeoutMs / 2))
    );
    const signalChildTree = (signal) => {
      try {
        if (process.platform === "win32") {
          child.kill(signal);
          return;
        }
        process.kill(-child.pid, signal);
      } catch (_error) {}
    };
    const clearTimers = () => {
      clearTimeout(timeout);
      if (forceKillTimeout) clearTimeout(forceKillTimeout);
    };
    const timeout = setTimeout(() => {
      timedOut = true;
      signalChildTree("SIGTERM");
      forceKillTimeout = setTimeout(() => {
        signalChildTree("SIGKILL");
      }, commandKillGraceMs);
    }, commandTimeoutMs);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      clearTimers();
      reject(error);
    });
    child.on("close", (code) => {
      clearTimers();
      if (timedOut) {
        reject(
          new Error(
            `obsidian ${args.join(" ")} timed out after ${commandTimeoutMs}ms`
          )
        );
        return;
      }

      if (code == 0) {
        resolve(stdout.trim());
        return;
      }

      reject(
        new Error(
          `obsidian ${args.join(" ")} failed with exit code ${code}: ${stderr.trim()}`
        )
      );
    });
  });

const runObsidian = async (config, runner, command, args = {}) =>
  runner(buildObsidianArgs(config, command, args));

const metadataEvalCode = (path, property) =>
  `(() => {
    const file = app.vault.getAbstractFileByPath(${JSON.stringify(path)});
    if (!file) return "";
    const cache = app.metadataCache.getFileCache(file);
    const value = cache?.frontmatter?.[${JSON.stringify(property)}];
    if (value == null) return "";
    if (Array.isArray(value)) return JSON.stringify(value);
    return String(value);
  })()`.replace(/\s+/g, " ");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const tablePredicate = () => ({
  view: "table",
  filters: [],
  listView: "",
  listItem: "",
  listGroup: "",
  listGroupProps: {},
  listViewProps: {},
  listItemProps: {},
  sort: [],
  groupBy: [],
  colsOrder: [],
  colsHidden: [],
  colsSize: {},
  colsCalc: {},
  limit: 0,
});

const tableViewSetupEvalCode = ({ pluginId, folder }) =>
  `(async () => {
    const marker = "notidianTableUiSetup";
    const finish = (payload) => JSON.stringify({ marker, ...payload });
    try {
      const plugin = app.plugins.plugins[${JSON.stringify(pluginId)}];
      if (!plugin?.superstate?.spaceManager) {
        return finish({ ok: false, reason: "missing-plugin" });
      }
      const folder = ${JSON.stringify(folder)};
      await plugin.superstate.spaceManager.saveFrameSchema(
        folder,
        ${JSON.stringify(DEFAULT_FRAME_LIST_VIEW_ID)},
        (prev) => ({
          ...(prev || {}),
          id: ${JSON.stringify(DEFAULT_FRAME_LIST_VIEW_ID)},
          name: "All",
          type: "view",
          def: JSON.stringify({
            db: ${JSON.stringify(DEFAULT_CONTEXT_SCHEMA_ID)},
            icon: "ui//table",
          }),
          predicate: JSON.stringify(${JSON.stringify(tablePredicate())}),
        })
      );
      await plugin.superstate.reloadSpace(
        plugin.superstate.spaceManager.spaceInfoForPath(folder),
        null,
        true
      );
      await plugin.superstate.reloadContextByPath(folder, {
        force: true,
        calculate: true,
      });
      plugin.superstate.ui.openPath(folder, true);
      return finish({ ok: true });
    } catch (error) {
      return finish({
        ok: false,
        reason: "exception",
        message: String(error?.message ?? error),
      });
    }
  })()`.replace(/\s+/g, " ");

const renameFileEvalCode = ({ fromPath, toPath }) =>
  `(async () => {
    const marker = "notidianRenameFile";
    const finish = (payload) => JSON.stringify({ marker, ...payload });
    try {
      const fromPath = ${JSON.stringify(fromPath)};
      const toPath = ${JSON.stringify(toPath)};
      const file = app.vault.getAbstractFileByPath(fromPath);
      if (!file) {
        return finish({ ok: false, reason: "missing-file", fromPath });
      }
      await app.fileManager.renameFile(file, toPath);
      return finish({ ok: true, path: toPath });
    } catch (error) {
      return finish({
        ok: false,
        reason: "exception",
        message: String(error?.message ?? error),
      });
    }
  })()`.replace(/\s+/g, " ");

const cleanupFixturesEvalCode = ({ paths }) =>
  `(async () => {
    const marker = "notidianCleanupFixtures";
    const finish = (payload) => JSON.stringify({ marker, ...payload });
    const paths = ${JSON.stringify(paths)};
    const deleted = [];
    const missing = [];
    const failed = [];
    for (const path of paths) {
      try {
        const file = app.vault.getAbstractFileByPath(path);
        if (!file) {
          missing.push(path);
          continue;
        }
        await app.vault.delete(file, true);
        deleted.push(path);
      } catch (error) {
        failed.push({
          path,
          message: String(error?.message ?? error),
        });
      }
    }
    return finish({
      ok: failed.length == 0,
      reason: failed.length == 0 ? "deleted" : "delete-failed",
      deleted,
      missing,
      failed,
    });
  })()`.replace(/\s+/g, " ");

const tableUiEditEvalCode = ({
  folder,
  rowTitle,
  columnName,
  value,
  timeoutMs,
  pollIntervalMs,
}) =>
  `(async () => {
    const marker = "notidianTableUiEdit";
    const finish = (payload) => JSON.stringify({ marker, ...payload });
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const folder = ${JSON.stringify(folder)};
    const rowTitle = ${JSON.stringify(rowTitle)};
    const columnName = ${JSON.stringify(columnName)};
    const value = ${JSON.stringify(value)};
    const timeoutMs = ${Number(timeoutMs)};
    const pollIntervalMs = Math.max(1, ${Number(pollIntervalMs)});
    const transientReasons = new Set([
      "missing-view",
      "missing-table",
      "missing-row",
      "display-not-settled",
    ]);
    const attempt = async () => {
      const views = Array.from(document.querySelectorAll(".mk-space-view"))
        .filter((view) =>
          view.getAttribute("data-path") === folder &&
          view.querySelector(".mk-table")
        );
      const view = views[views.length - 1];
      if (!view) {
        return {
          ok: false,
          reason: "missing-view",
          availableViews: Array.from(document.querySelectorAll(".mk-space-view"))
            .map((item) => item.getAttribute("data-path")),
        };
      }
      const table = view.querySelector(".mk-table");
      if (!table) {
        return { ok: false, reason: "missing-table" };
      }
      const headers = Array.from(table.querySelectorAll("thead th"))
        .map((header) => header.innerText.trim());
      const columnIndex = headers.findIndex(
        (header) => header.toLowerCase() === columnName.toLowerCase()
      );
      if (columnIndex < 0) {
        return {
          ok: false,
          reason: "missing-column",
          columns: headers.filter(Boolean),
        };
      }
      const row = Array.from(table.querySelectorAll("tbody tr"))
        .find((candidate) => candidate.innerText.includes(rowTitle));
      if (!row) {
        return {
          ok: false,
          reason: "missing-row",
          columns: headers.filter(Boolean),
          tableText: table.innerText.slice(0, 500),
        };
      }
      const cell = row.children[columnIndex];
      if (!cell) {
        return {
          ok: false,
          reason: "missing-cell",
          columns: headers.filter(Boolean),
          columnIndex,
          cellCount: row.children.length,
        };
      }
      await sleep(250);
      cell.dispatchEvent(
        new MouseEvent("mousedown", { bubbles: true, buttons: 1 })
      );
      table.focus();
      await sleep(100);
      table.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, key: "Enter" })
      );
      await sleep(250);
      const editor = cell.querySelector("[contenteditable='true']");
      if (!editor) {
        return {
          ok: false,
          reason: "missing-editor",
          columns: headers.filter(Boolean),
          cellHtml: cell.outerHTML.slice(0, 500),
        };
      }
      editor.focus();
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(editor);
      selection?.removeAllRanges();
      selection?.addRange(range);
      const inserted = typeof document.execCommand == "function"
        ? document.execCommand("insertText", false, value)
        : false;
      if (!inserted) {
        editor.textContent = value;
      }
      const inputEvent = typeof InputEvent == "function"
        ? new InputEvent("input", {
            bubbles: true,
            inputType: "insertText",
            data: value,
          })
        : new Event("input", { bubbles: true });
      editor.dispatchEvent(inputEvent);
      await sleep(100);
      editor.dispatchEvent(
        new FocusEvent("focusout", {
          bubbles: true,
          relatedTarget: table,
        })
      );
      editor.dispatchEvent(
        new FocusEvent("blur", {
          bubbles: false,
          relatedTarget: table,
        })
      );
      await sleep(300);
      if (cell.querySelector("[contenteditable='true']")) {
        editor.blur();
        await sleep(100);
      }
      const displayStart = Date.now();
      const displayTimeoutMs = Math.min(2000, timeoutMs);
      let editedValue = cell.innerText.trim();
      while (
        editedValue != value &&
        Date.now() - displayStart <= displayTimeoutMs
      ) {
        await sleep(pollIntervalMs);
        editedValue = cell.innerText.trim();
      }
      if (editedValue != value) {
        return {
          ok: false,
          reason: "display-not-settled",
          columns: headers.filter(Boolean),
          rowFound: true,
          editedValue,
          displaySettled: false,
        };
      }
      return {
        ok: true,
        columns: headers.filter(Boolean),
        rowFound: true,
        editedValue,
        displaySettled: true,
      };
    };
    try {
      const start = Date.now();
      let lastResult = null;
      do {
        lastResult = await attempt();
        if (lastResult.ok || !transientReasons.has(lastResult.reason)) {
          return finish(lastResult);
        }
        await sleep(pollIntervalMs);
      } while (Date.now() - start <= timeoutMs);
      return finish({
        ...(lastResult || {}),
        ok: false,
        reason: lastResult?.reason || "timeout",
        timedOut: true,
      });
    } catch (error) {
      return finish({
        ok: false,
        reason: "exception",
        message: String(error?.message ?? error),
      });
    }
  })()`.replace(/\s+/g, " ");

const tableUiPasteEvalCode = ({
  folder,
  rowTitle,
  statusValue,
  ratingValue,
  timeoutMs,
  pollIntervalMs,
}) =>
  `(async () => {
    const marker = "notidianTableUiPaste";
    const finish = (payload) => JSON.stringify({ marker, ...payload });
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const folder = ${JSON.stringify(folder)};
    const rowTitle = ${JSON.stringify(rowTitle)};
    const statusValue = ${JSON.stringify(statusValue)};
    const ratingValue = ${JSON.stringify(ratingValue)};
    const timeoutMs = ${Number(timeoutMs)};
    const pollIntervalMs = Math.max(1, ${Number(pollIntervalMs)});
    const findTable = () => {
      const views = Array.from(document.querySelectorAll(".mk-space-view"))
        .filter((view) =>
          view.getAttribute("data-path") === folder &&
          view.querySelector(".mk-table")
        );
      const view = views[views.length - 1];
      const table = view?.querySelector(".mk-table");
      if (!view || !table) return { ok: false, reason: !view ? "missing-view" : "missing-table" };
      const headers = Array.from(table.querySelectorAll("thead th"))
        .map((header) => header.innerText.trim());
      const row = Array.from(table.querySelectorAll("tbody tr"))
        .find((candidate) => candidate.innerText.includes(rowTitle));
      if (!row) {
        return {
          ok: false,
          reason: "missing-row",
          columns: headers.filter(Boolean),
          tableText: table.innerText.slice(0, 500),
        };
      }
      return { ok: true, table, headers, row };
    };
    const cellByColumn = (tableState, columnName) => {
      const columnIndex = tableState.headers.findIndex(
        (header) => header.toLowerCase() === columnName.toLowerCase()
      );
      if (columnIndex < 0) {
        return {
          ok: false,
          reason: "missing-column",
          columns: tableState.headers.filter(Boolean),
        };
      }
      const cell = tableState.row.children[columnIndex];
      if (!cell) {
        return {
          ok: false,
          reason: "missing-cell",
          columns: tableState.headers.filter(Boolean),
          columnIndex,
          cellCount: tableState.row.children.length,
        };
      }
      return { ok: true, cell, columnIndex };
    };
    const waitForCells = async () => {
      const start = Date.now();
      let last = null;
      do {
        const tableState = findTable();
        if (!tableState.ok) return tableState;
        const statusCell = cellByColumn(tableState, "status");
        if (!statusCell.ok) return statusCell;
        const ratingCell = cellByColumn(tableState, "rating");
        if (!ratingCell.ok) return ratingCell;
        last = {
          status: statusCell.cell.innerText.trim(),
          rating: ratingCell.cell.innerText.trim(),
        };
        if (last.status == statusValue && last.rating == ratingValue) {
          return { ok: true, editedValues: last };
        }
        await sleep(pollIntervalMs);
      } while (Date.now() - start <= timeoutMs);
      return {
        ok: false,
        reason: "display-not-settled",
        editedValues: last,
      };
    };
    try {
      const start = Date.now();
      let tableState = null;
      do {
        tableState = findTable();
        if (tableState.ok) break;
        await sleep(pollIntervalMs);
      } while (Date.now() - start <= timeoutMs);
      if (!tableState?.ok) return finish(tableState || { ok: false, reason: "missing-table" });
      const statusCell = cellByColumn(tableState, "status");
      if (!statusCell.ok) return finish(statusCell);
      statusCell.cell.dispatchEvent(
        new MouseEvent("mousedown", { bubbles: true, buttons: 1 })
      );
      tableState.table.focus();
      await sleep(100);
      const clipboardText = statusValue + "\\t" + ratingValue;
      const originalClipboard = navigator.clipboard;
      const originalReadText = originalClipboard?.readText;
      let restored = false;
      const restoreClipboard = () => {
        if (restored) return;
        restored = true;
        try {
          if (originalClipboard && originalReadText) {
            originalClipboard.readText = originalReadText;
          }
        } catch (error) {
          if (originalClipboard) {
            Object.defineProperty(navigator, "clipboard", {
              configurable: true,
              value: originalClipboard,
            });
          }
        }
      };
      try {
        try {
          originalClipboard.readText = async () => clipboardText;
        } catch (error) {
          Object.defineProperty(navigator, "clipboard", {
            configurable: true,
            value: {
              ...(originalClipboard || {}),
              readText: async () => clipboardText,
            },
          });
        }
        tableState.table.dispatchEvent(
          new KeyboardEvent("keydown", {
            bubbles: true,
            cancelable: true,
            key: "v",
            code: "KeyV",
            metaKey: true,
          })
        );
      } finally {
        setTimeout(restoreClipboard, 0);
      }
      await sleep(300);
      const result = await waitForCells();
      restoreClipboard();
      return finish(result);
    } catch (error) {
      return finish({
        ok: false,
        reason: "exception",
        message: String(error?.message ?? error),
      });
    }
  })()`.replace(/\s+/g, " ");

const tableUiUndoEvalCode = ({
  folder,
  rowTitle,
  statusValue,
  ratingValue,
  timeoutMs,
  pollIntervalMs,
}) =>
  `(async () => {
    const marker = "notidianTableUiUndo";
    const finish = (payload) => JSON.stringify({ marker, ...payload });
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const folder = ${JSON.stringify(folder)};
    const rowTitle = ${JSON.stringify(rowTitle)};
    const statusValue = ${JSON.stringify(statusValue)};
    const ratingValue = ${JSON.stringify(ratingValue)};
    const timeoutMs = ${Number(timeoutMs)};
    const pollIntervalMs = Math.max(1, ${Number(pollIntervalMs)});
    const findTable = () => {
      const views = Array.from(document.querySelectorAll(".mk-space-view"))
        .filter((view) =>
          view.getAttribute("data-path") === folder &&
          view.querySelector(".mk-table")
        );
      const view = views[views.length - 1];
      const table = view?.querySelector(".mk-table");
      if (!view || !table) return { ok: false, reason: !view ? "missing-view" : "missing-table" };
      const headers = Array.from(table.querySelectorAll("thead th"))
        .map((header) => header.innerText.trim());
      const row = Array.from(table.querySelectorAll("tbody tr"))
        .find((candidate) => candidate.innerText.includes(rowTitle));
      if (!row) {
        return {
          ok: false,
          reason: "missing-row",
          columns: headers.filter(Boolean),
          tableText: table.innerText.slice(0, 500),
        };
      }
      return { ok: true, table, headers, row };
    };
    const cellText = (tableState, columnName) => {
      const columnIndex = tableState.headers.findIndex(
        (header) => header.toLowerCase() === columnName.toLowerCase()
      );
      if (columnIndex < 0) {
        return {
          ok: false,
          reason: "missing-column",
          columns: tableState.headers.filter(Boolean),
        };
      }
      const cell = tableState.row.children[columnIndex];
      if (!cell) {
        return {
          ok: false,
          reason: "missing-cell",
          columns: tableState.headers.filter(Boolean),
          columnIndex,
          cellCount: tableState.row.children.length,
        };
      }
      return { ok: true, value: cell.innerText.trim() };
    };
    try {
      const tableState = findTable();
      if (!tableState.ok) return finish(tableState);
      tableState.table.focus();
      tableState.table.dispatchEvent(
        new KeyboardEvent("keydown", {
          bubbles: true,
          cancelable: true,
          key: "z",
          code: "KeyZ",
          metaKey: true,
        })
      );
      const start = Date.now();
      let last = null;
      do {
        const nextState = findTable();
        if (!nextState.ok) return finish(nextState);
        const status = cellText(nextState, "status");
        if (!status.ok) return finish(status);
        const rating = cellText(nextState, "rating");
        if (!rating.ok) return finish(rating);
        last = { status: status.value, rating: rating.value };
        if (last.status == statusValue && last.rating == ratingValue) {
          return finish({ ok: true, editedValues: last });
        }
        await sleep(pollIntervalMs);
      } while (Date.now() - start <= timeoutMs);
      return finish({
        ok: false,
        reason: "display-not-settled",
        editedValues: last,
      });
    } catch (error) {
      return finish({
        ok: false,
        reason: "exception",
        message: String(error?.message ?? error),
      });
    }
  })()`.replace(/\s+/g, " ");

const tableUiRedoEvalCode = ({
  folder,
  rowTitle,
  statusValue,
  ratingValue,
  timeoutMs,
  pollIntervalMs,
}) =>
  `(async () => {
    const marker = "notidianTableUiRedo";
    const finish = (payload) => JSON.stringify({ marker, ...payload });
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const folder = ${JSON.stringify(folder)};
    const rowTitle = ${JSON.stringify(rowTitle)};
    const statusValue = ${JSON.stringify(statusValue)};
    const ratingValue = ${JSON.stringify(ratingValue)};
    const timeoutMs = ${Number(timeoutMs)};
    const pollIntervalMs = Math.max(1, ${Number(pollIntervalMs)});
    const findTable = () => {
      const views = Array.from(document.querySelectorAll(".mk-space-view"))
        .filter((view) =>
          view.getAttribute("data-path") === folder &&
          view.querySelector(".mk-table")
        );
      const view = views[views.length - 1];
      const table = view?.querySelector(".mk-table");
      if (!view || !table) return { ok: false, reason: !view ? "missing-view" : "missing-table" };
      const headers = Array.from(table.querySelectorAll("thead th"))
        .map((header) => header.innerText.trim());
      const row = Array.from(table.querySelectorAll("tbody tr"))
        .find((candidate) => candidate.innerText.includes(rowTitle));
      if (!row) {
        return {
          ok: false,
          reason: "missing-row",
          columns: headers.filter(Boolean),
          tableText: table.innerText.slice(0, 500),
        };
      }
      return { ok: true, table, headers, row };
    };
    const cellText = (tableState, columnName) => {
      const columnIndex = tableState.headers.findIndex(
        (header) => header.toLowerCase() === columnName.toLowerCase()
      );
      if (columnIndex < 0) {
        return {
          ok: false,
          reason: "missing-column",
          columns: tableState.headers.filter(Boolean),
        };
      }
      const cell = tableState.row.children[columnIndex];
      if (!cell) {
        return {
          ok: false,
          reason: "missing-cell",
          columns: tableState.headers.filter(Boolean),
          columnIndex,
          cellCount: tableState.row.children.length,
        };
      }
      return { ok: true, value: cell.innerText.trim() };
    };
    try {
      const tableState = findTable();
      if (!tableState.ok) return finish(tableState);
      tableState.table.focus();
      tableState.table.dispatchEvent(
        new KeyboardEvent("keydown", {
          bubbles: true,
          cancelable: true,
          key: "z",
          code: "KeyZ",
          metaKey: true,
          shiftKey: true,
        })
      );
      const start = Date.now();
      let last = null;
      do {
        const nextState = findTable();
        if (!nextState.ok) return finish(nextState);
        const status = cellText(nextState, "status");
        if (!status.ok) return finish(status);
        const rating = cellText(nextState, "rating");
        if (!rating.ok) return finish(rating);
        last = { status: status.value, rating: rating.value };
        if (last.status == statusValue && last.rating == ratingValue) {
          return finish({ ok: true, editedValues: last });
        }
        await sleep(pollIntervalMs);
      } while (Date.now() - start <= timeoutMs);
      return finish({
        ok: false,
        reason: "display-not-settled",
        editedValues: last,
      });
    } catch (error) {
      return finish({
        ok: false,
        reason: "exception",
        message: String(error?.message ?? error),
      });
    }
  })()`.replace(/\s+/g, " ");

const tableUiOptionEvalCode = ({
  pluginId,
  folder,
  rowTitle,
  columnName,
  currentValue,
  newValue,
  timeoutMs,
  pollIntervalMs,
}) =>
  `(async () => {
    const marker = "notidianTableUiOption";
    const finish = (payload) => JSON.stringify({ marker, ...payload });
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const plugin = app.plugins.plugins[${JSON.stringify(pluginId)}];
    const folder = ${JSON.stringify(folder)};
    const rowTitle = ${JSON.stringify(rowTitle)};
    const columnName = ${JSON.stringify(columnName)};
    const currentValue = ${JSON.stringify(currentValue)};
    const newValue = ${JSON.stringify(newValue)};
    const timeoutMs = ${Number(timeoutMs)};
    const pollIntervalMs = Math.max(1, ${Number(pollIntervalMs)});
    const ensureOptionColumn = async () => {
      if (!plugin?.superstate?.spaceManager) {
        return { ok: false, reason: "missing-plugin" };
      }
      const table = await plugin.superstate.spaceManager.readTable(folder, ${JSON.stringify(DEFAULT_CONTEXT_SCHEMA_ID)});
      const existing = table.cols.find((column) => column.name == columnName);
      const options = [...new Set([currentValue].filter(Boolean))].map((value) => ({
        name: value,
        value,
      }));
      const nextColumn = {
        ...(existing || {}),
        name: columnName,
        schemaId: ${JSON.stringify(DEFAULT_CONTEXT_SCHEMA_ID)},
        type: "option",
        value: JSON.stringify({ options }),
        source: "frontmatter",
        hidden: existing?.hidden ?? "",
        unique: existing?.unique ?? "",
        primary: existing?.primary ?? "",
      };
      const nextTable = {
        ...table,
        cols: existing
          ? table.cols.map((column) => column.name == columnName ? nextColumn : column)
          : [...table.cols, nextColumn],
      };
      await plugin.superstate.spaceManager.saveTable(folder, nextTable, true);
      await plugin.superstate.reloadContextByPath(folder, {
        force: true,
        calculate: true,
      });
      return { ok: true };
    };
    const findOptionCell = () => {
      const views = Array.from(document.querySelectorAll(".mk-space-view"))
        .filter((view) =>
          view.getAttribute("data-path") === folder &&
          view.querySelector(".mk-table")
        );
      const view = views[views.length - 1];
      const table = view?.querySelector(".mk-table");
      if (!view || !table) return { ok: false, reason: !view ? "missing-view" : "missing-table" };
      const headers = Array.from(table.querySelectorAll("thead th"))
        .map((header) => header.innerText.trim());
      const columnIndex = headers.findIndex(
        (header) => header.toLowerCase() === columnName.toLowerCase()
      );
      if (columnIndex < 0) {
        return {
          ok: false,
          reason: "missing-column",
          columns: headers.filter(Boolean),
        };
      }
      const row = Array.from(table.querySelectorAll("tbody tr"))
        .find((candidate) => candidate.innerText.includes(rowTitle));
      if (!row) {
        return {
          ok: false,
          reason: "missing-row",
          columns: headers.filter(Boolean),
          tableText: table.innerText.slice(0, 500),
        };
      }
      const cell = row.children[columnIndex];
      if (!cell) {
        return {
          ok: false,
          reason: "missing-cell",
          columns: headers.filter(Boolean),
          columnIndex,
          cellCount: row.children.length,
        };
      }
      const optionCell = cell.querySelector(".mk-cell-option");
      if (!optionCell) {
        return {
          ok: false,
          reason: "missing-option-cell",
          columns: headers.filter(Boolean),
          cellHtml: cell.outerHTML.slice(0, 500),
        };
      }
      return { ok: true, table, cell, optionCell, headers };
    };
    const setInputValue = (input, value) => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      if (setter) {
        setter.call(input, value);
      } else {
        input.value = value;
      }
      const inputEvent = typeof InputEvent == "function"
        ? new InputEvent("input", {
            bubbles: true,
            inputType: "insertText",
            data: value,
          })
        : new Event("input", { bubbles: true });
      input.dispatchEvent(inputEvent);
    };
    try {
      const setup = await ensureOptionColumn();
      if (!setup.ok) return finish(setup);
      const renderStart = Date.now();
      let found = null;
      do {
        found = findOptionCell();
        if (found.ok && found.cell.innerText.includes(currentValue)) break;
        await sleep(pollIntervalMs);
      } while (Date.now() - renderStart <= timeoutMs);
      if (!found?.ok) return finish(found || { ok: false, reason: "missing-option-cell" });
      const optionChip = found.cell.querySelector(".mk-cell-option-item");
      if (!optionChip) {
        return finish({
          ok: false,
          reason: "missing-option-chip",
          columns: found.headers.filter(Boolean),
          cellHtml: found.cell.outerHTML.slice(0, 500),
        });
      }
      optionChip.dispatchEvent(
        new MouseEvent("mousedown", { bubbles: true, button: 0, buttons: 1 })
      );
      optionChip.dispatchEvent(
        new MouseEvent("mouseup", { bubbles: true, button: 0 })
      );
      optionChip.dispatchEvent(
        new MouseEvent("click", { bubbles: true, button: 0 })
      );
      await sleep(250);
      const menu = Array.from(document.querySelectorAll(".mk-menu")).at(-1);
      if (!menu) {
        return finish({
          ok: false,
          reason: "missing-option-menu-after-chip-click",
          columns: found.headers.filter(Boolean),
          cellHtml: found.cell.outerHTML.slice(0, 500),
        });
      }
      const input = menu.querySelector(".mk-menu-search-input");
      if (!input) {
        return finish({
          ok: false,
          reason: "missing-option-menu-input",
          menuText: menu.innerText.slice(0, 500),
        });
      }
      input.focus();
      setInputValue(input, newValue);
      await sleep(250);
      const addOption = Array.from(menu.querySelectorAll(".mk-menu-option"))
        .find((option) => option.innerText.includes(newValue));
      if (!addOption) {
        return finish({
          ok: false,
          reason: "missing-new-option-action",
          menuText: menu.innerText.slice(0, 500),
        });
      }
      addOption.dispatchEvent(
        new MouseEvent("mousedown", { bubbles: true, button: 0, buttons: 1 })
      );
      addOption.dispatchEvent(
        new MouseEvent("mouseup", { bubbles: true, button: 0 })
      );
      addOption.dispatchEvent(
        new MouseEvent("click", { bubbles: true, button: 0 })
      );
      const settleStart = Date.now();
      let latestValue = "";
      do {
        const nextFound = findOptionCell();
        if (!nextFound.ok) return finish(nextFound);
        latestValue = nextFound.cell.innerText.trim();
        if (latestValue == newValue) {
          const updatedTable = await plugin.superstate.spaceManager.readTable(folder, ${JSON.stringify(DEFAULT_CONTEXT_SCHEMA_ID)});
          const updatedColumn = updatedTable.cols.find((column) => column.name == columnName);
          return finish({
            ok: true,
            editedValue: latestValue,
            optionSaved: String(updatedColumn?.value ?? "").includes(newValue),
          });
        }
        await sleep(pollIntervalMs);
      } while (Date.now() - settleStart <= timeoutMs);
      return finish({
        ok: false,
        reason: "display-not-settled",
        editedValue: latestValue,
      });
    } catch (error) {
      return finish({
        ok: false,
        reason: "exception",
        message: String(error?.message ?? error),
      });
    }
  })()`.replace(/\s+/g, " ");

const tableUiTypeMatrixEvalCode = ({
  pluginId,
  folder,
  columnName,
  timeoutMs,
  pollIntervalMs,
}) =>
  `(async () => {
    const marker = "notidianTableUiTypeMatrix";
    const finish = (payload) => JSON.stringify({ marker, ...payload });
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const plugin = app.plugins.plugins[${JSON.stringify(pluginId)}];
    const folder = ${JSON.stringify(folder)};
    const columnName = ${JSON.stringify(columnName)};
    const timeoutMs = ${Number(timeoutMs)};
    const pollIntervalMs = Math.max(1, ${Number(pollIntervalMs)});
    const matrix = [
      { label: "Text", type: "text", className: "mk-cell-text" },
      { label: "Number", type: "number", className: "mk-cell-number" },
      { label: "Yes/No", type: "boolean", className: "mk-cell-boolean" },
      { label: "Date", type: "date", className: "mk-cell-date" },
      { label: "Option", type: "option", className: "mk-cell-option" },
      { label: "Link", type: "link", className: "mk-cell-link" },
      { label: "Image", type: "image", className: "mk-cell-image" },
    ];
    const disallowedLabels = ["Tags", "Formula", "Context", "Flex", "Aggregate", "Object"];
    const findTable = () => {
      const views = Array.from(document.querySelectorAll(".mk-space-view"))
        .filter((view) =>
          view.getAttribute("data-path") === folder &&
          view.querySelector(".mk-table")
        );
      const view = views[views.length - 1];
      const table = view?.querySelector(".mk-table");
      if (!view || !table) return { ok: false, reason: !view ? "missing-view" : "missing-table" };
      const headers = Array.from(table.querySelectorAll("thead th"))
        .map((header) => header.innerText.trim());
      const columnIndex = headers.findIndex(
        (header) => header.toLowerCase() === columnName.toLowerCase()
      );
      if (columnIndex < 0) {
        return { ok: false, reason: "missing-column", columns: headers.filter(Boolean) };
      }
      const row = table.querySelector("tbody tr");
      if (!row) return { ok: false, reason: "missing-row", columns: headers.filter(Boolean) };
      const cell = row.children[columnIndex];
      if (!cell) {
        return { ok: false, reason: "missing-cell", columns: headers.filter(Boolean), columnIndex };
      }
      const header = Array.from(table.querySelectorAll("thead th"))[columnIndex];
      return { ok: true, table, headers, header, cell };
    };
    const clearMenus = async () => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, key: "Escape" })
      );
      document.body.dispatchEvent(
        new MouseEvent("mousedown", { bubbles: true, button: 0, view: window })
      );
      await sleep(100);
    };
    const openTypeMenu = async () => {
      await clearMenus();
      const found = findTable();
      if (!found.ok) return found;
      found.header.querySelector(".mk-col-header")?.dispatchEvent(
        new MouseEvent("click", { bubbles: true, button: 0, view: window })
      );
      await sleep(150);
      let menu = Array.from(document.querySelectorAll(".mk-menu")).at(-1);
      const typeRow = Array.from(menu?.querySelectorAll(".mk-menu-option") ?? [])
        .find((option) => option.innerText.includes("Type"));
      if (!typeRow) {
        return { ok: false, reason: "missing-type-row", menuText: menu?.innerText ?? "" };
      }
      typeRow.dispatchEvent(
        new MouseEvent("click", { bubbles: true, button: 0, view: window })
      );
      await sleep(150);
      menu = Array.from(document.querySelectorAll(".mk-menu")).at(-1);
      if (!menu) return { ok: false, reason: "missing-type-menu" };
      return { ok: true, menu };
    };
    const selectType = async ({ label, type, className }) => {
      const menuResult = await openTypeMenu();
      if (!menuResult.ok) return menuResult;
      const typeMenuText = menuResult.menu.innerText;
      const blockedLabel = disallowedLabels.find((name) =>
        typeMenuText.split("\\n").map((item) => item.trim()).includes(name)
      );
      if (blockedLabel) {
        return { ok: false, reason: "frontmatter-menu-allows-context-type", blockedLabel, typeMenuText };
      }
      const option = Array.from(menuResult.menu.querySelectorAll(".mk-menu-option"))
        .find((item) => item.innerText.trim() === label);
      if (!option) {
        return { ok: false, reason: "missing-type-option", label, typeMenuText };
      }
      option.dispatchEvent(
        new MouseEvent("click", { bubbles: true, button: 0, view: window })
      );
      const start = Date.now();
      let latest = null;
      do {
        await sleep(pollIntervalMs);
        const table = await plugin.superstate.spaceManager.readTable(folder, ${JSON.stringify(DEFAULT_CONTEXT_SCHEMA_ID)});
        const column = table.cols.find((item) => item.name == columnName);
        const found = findTable();
        if (!found.ok) return found;
        latest = {
          label,
          type: column?.type,
          className: Array.from(found.cell.querySelector("div")?.classList ?? []),
          cellHtml: found.cell.outerHTML.slice(0, 500),
        };
        if (
          latest.type === type &&
          latest.className.includes(className)
        ) {
          return { ok: true, ...latest };
        }
      } while (Date.now() - start <= timeoutMs);
      return { ok: false, reason: "type-not-settled", expectedType: type, expectedClass: className, latest };
    };
    try {
      if (!plugin?.superstate?.spaceManager) {
        return finish({ ok: false, reason: "missing-plugin" });
      }
      const results = [];
      for (const item of matrix) {
        const result = await selectType(item);
        results.push(result);
        if (!result.ok) return finish({ ...result, results });
      }
      return finish({ ok: true, results });
    } catch (error) {
      return finish({
        ok: false,
        reason: "exception",
        message: String(error?.message ?? error),
      });
    }
  })()`.replace(/\s+/g, " ");

const tableUiRenameEvalCode = ({
  folder,
  rowTitle,
  nextTitle,
  nextPath,
  timeoutMs,
  pollIntervalMs,
}) =>
  `(async () => {
    const marker = "notidianTableUiRename";
    const finish = (payload) => JSON.stringify({ marker, ...payload });
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const folder = ${JSON.stringify(folder)};
    const rowTitle = ${JSON.stringify(rowTitle)};
    const nextTitle = ${JSON.stringify(nextTitle)};
    const nextPath = ${JSON.stringify(nextPath)};
    const timeoutMs = ${Number(timeoutMs)};
    const pollIntervalMs = Math.max(1, ${Number(pollIntervalMs)});
    const findTitleCell = () => {
      const views = Array.from(document.querySelectorAll(".mk-space-view"))
        .filter((view) =>
          view.getAttribute("data-path") === folder &&
          view.querySelector(".mk-table")
        );
      const view = views[views.length - 1];
      const table = view?.querySelector(".mk-table");
      if (!view || !table) return { ok: false, reason: !view ? "missing-view" : "missing-table" };
      const headers = Array.from(table.querySelectorAll("thead th"))
        .map((header) => header.innerText.trim());
      const columnIndex = headers.findIndex(
        (header) => header.toLowerCase() === "file"
      );
      if (columnIndex < 0) {
        return {
          ok: false,
          reason: "missing-column",
          columns: headers.filter(Boolean),
        };
      }
      const row = Array.from(table.querySelectorAll("tbody tr"))
        .find((candidate) => candidate.innerText.includes(rowTitle));
      if (!row) {
        return {
          ok: false,
          reason: "missing-row",
          columns: headers.filter(Boolean),
          tableText: table.innerText.slice(0, 500),
        };
      }
      const cell = row.children[columnIndex];
      if (!cell) {
        return {
          ok: false,
          reason: "missing-cell",
          columns: headers.filter(Boolean),
          columnIndex,
          cellCount: row.children.length,
        };
      }
      return { ok: true, table, cell, headers };
    };
    try {
      const found = findTitleCell();
      if (!found.ok) return finish(found);
      found.cell.dispatchEvent(
        new MouseEvent("mousedown", { bubbles: true, buttons: 1 })
      );
      found.table.focus();
      await sleep(100);
      found.table.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, key: "Enter" })
      );
      await sleep(250);
      const editor = found.cell.querySelector("[contenteditable='true']");
      if (!editor) {
        return finish({
          ok: false,
          reason: "missing-editor",
          columns: found.headers.filter(Boolean),
          cellHtml: found.cell.outerHTML.slice(0, 500),
        });
      }
      editor.focus();
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(editor);
      selection?.removeAllRanges();
      selection?.addRange(range);
      const inserted = typeof document.execCommand == "function"
        ? document.execCommand("insertText", false, nextTitle)
        : false;
      if (!inserted) {
        editor.textContent = nextTitle;
      }
      const inputEvent = typeof InputEvent == "function"
        ? new InputEvent("input", {
            bubbles: true,
            inputType: "insertText",
            data: nextTitle,
          })
        : new Event("input", { bubbles: true });
      editor.dispatchEvent(inputEvent);
      await sleep(100);
      editor.dispatchEvent(
        new FocusEvent("focusout", {
          bubbles: true,
          relatedTarget: found.table,
        })
      );
      editor.dispatchEvent(
        new FocusEvent("blur", {
          bubbles: false,
          relatedTarget: found.table,
        })
      );
      editor.blur();
      const start = Date.now();
      do {
        if (app.vault.getAbstractFileByPath(nextPath)) {
          return finish({ ok: true, path: nextPath, title: nextTitle });
        }
        await sleep(pollIntervalMs);
      } while (Date.now() - start <= timeoutMs);
      return finish({
        ok: false,
        reason: "rename-not-settled",
        path: nextPath,
      });
    } catch (error) {
      return finish({
        ok: false,
        reason: "exception",
        message: String(error?.message ?? error),
      });
    }
  })()`.replace(/\s+/g, " ");

const tableUiConflictEvalCode = ({
  pluginId,
  folder,
  rowTitle,
  betaPath,
  externalValue,
  appliedValue,
  timeoutMs,
  pollIntervalMs,
}) =>
  `(async () => {
    const marker = "notidianTableUiConflict";
    const finish = (payload) => JSON.stringify({ marker, ...payload });
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const folder = ${JSON.stringify(folder)};
    const rowTitle = ${JSON.stringify(rowTitle)};
    const betaPath = ${JSON.stringify(betaPath)};
    const pluginId = ${JSON.stringify(pluginId)};
    const externalValue = ${JSON.stringify(externalValue)};
    const appliedValue = ${JSON.stringify(appliedValue)};
    const timeoutMs = ${Number(timeoutMs)};
    const pollIntervalMs = Math.max(1, ${Number(pollIntervalMs)});
    const frontmatterValue = () => {
      const file = app.vault.getAbstractFileByPath(betaPath);
      if (!file) return undefined;
      return app.metadataCache.getFileCache(file)?.frontmatter?.status;
    };
    const pathIndexValue = () => {
      const plugin = app.plugins.plugins[pluginId];
      return plugin?.superstate?.pathsIndex
        ?.get(betaPath)
        ?.metadata
        ?.property
        ?.status;
    };
    const findStatusCell = () => {
      const views = Array.from(document.querySelectorAll(".mk-space-view"))
        .filter((view) =>
          view.getAttribute("data-path") === folder &&
          view.querySelector(".mk-table")
        );
      const view = views[views.length - 1];
      const table = view?.querySelector(".mk-table");
      if (!view || !table) return { ok: false, reason: !view ? "missing-view" : "missing-table" };
      const headers = Array.from(table.querySelectorAll("thead th"))
        .map((header) => header.innerText.trim());
      const columnIndex = headers.findIndex(
        (header) => header.toLowerCase() === "status"
      );
      if (columnIndex < 0) {
        return {
          ok: false,
          reason: "missing-column",
          columns: headers.filter(Boolean),
        };
      }
      const row = Array.from(table.querySelectorAll("tbody tr"))
        .find((candidate) => candidate.innerText.includes(rowTitle));
      if (!row) {
        return {
          ok: false,
          reason: "missing-row",
          columns: headers.filter(Boolean),
          tableText: table.innerText.slice(0, 500),
        };
      }
      const cell = row.children[columnIndex];
      if (!cell) {
        return {
          ok: false,
          reason: "missing-cell",
          columns: headers.filter(Boolean),
          columnIndex,
          cellCount: row.children.length,
        };
      }
      return { ok: true, table, cell, columns: headers.filter(Boolean) };
    };
    const editStatusCell = async () => {
      const found = findStatusCell();
      if (!found.ok) return found;
      found.cell.dispatchEvent(
        new MouseEvent("mousedown", { bubbles: true, buttons: 1 })
      );
      found.table.focus();
      await sleep(100);
      found.table.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, key: "Enter" })
      );
      await sleep(250);
      const editor = found.cell.querySelector("[contenteditable='true']");
      if (!editor) {
        return {
          ok: false,
          reason: "missing-editor",
          columns: found.columns,
          cellHtml: found.cell.outerHTML.slice(0, 500),
        };
      }
      editor.focus();
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(editor);
      selection?.removeAllRanges();
      selection?.addRange(range);
      const inserted = typeof document.execCommand == "function"
        ? document.execCommand("insertText", false, appliedValue)
        : false;
      if (!inserted) {
        editor.textContent = appliedValue;
      }
      const inputEvent = typeof InputEvent == "function"
        ? new InputEvent("input", {
            bubbles: true,
            inputType: "insertText",
            data: appliedValue,
          })
        : new Event("input", { bubbles: true });
      editor.dispatchEvent(inputEvent);
      await sleep(100);
      editor.dispatchEvent(
        new FocusEvent("focusout", {
          bubbles: true,
          relatedTarget: found.table,
        })
      );
      editor.dispatchEvent(
        new FocusEvent("blur", {
          bubbles: false,
          relatedTarget: found.table,
        })
      );
      await sleep(300);
      if (found.cell.querySelector("[contenteditable='true']")) {
        editor.blur();
      }
      return { ok: true };
    };
    try {
      const file = app.vault.getAbstractFileByPath(betaPath);
      if (!file) return finish({ ok: false, reason: "missing-file", path: betaPath });
      const plugin = app.plugins.plugins[pluginId];
      const pathState = plugin?.superstate?.pathsIndex?.get(betaPath);
      if (!pathState?.metadata?.property) {
        return finish({
          ok: false,
          reason: "missing-path-state",
          path: betaPath,
        });
      }
      pathState.metadata.property.status = externalValue;
      const editResult = await editStatusCell();
      if (!editResult.ok) return finish(editResult);
      const conflictStart = Date.now();
      let lastCellHtml = "";
      do {
        const found = findStatusCell();
        if (!found.ok) return finish(found);
        lastCellHtml = found.cell.outerHTML.slice(0, 800);
        const conflictCell = found.cell.classList.contains("mk-cell-conflict")
          ? found.cell
          : found.cell.querySelector(".mk-cell-conflict")
          ? found.cell
          : null;
        const applyButton = conflictCell
          ? Array.from(conflictCell.querySelectorAll("button"))
              .find((button) => button.innerText.trim() == "Apply anyway")
          : null;
        if (applyButton) {
          applyButton.click();
          const applyStart = Date.now();
          do {
            if (String(frontmatterValue()) == appliedValue) {
              return finish({ ok: true, appliedValue });
            }
            await sleep(pollIntervalMs);
          } while (Date.now() - applyStart <= timeoutMs);
          return finish({
            ok: false,
            reason: "apply-not-visible",
            currentValue: frontmatterValue(),
          });
        }
        await sleep(pollIntervalMs);
      } while (Date.now() - conflictStart <= timeoutMs);
      return finish({
        ok: false,
        reason: "missing-conflict",
        currentValue: frontmatterValue(),
        pathIndexValue: pathIndexValue(),
        cellHtml: lastCellHtml,
      });
    } catch (error) {
      return finish({
        ok: false,
        reason: "exception",
        message: String(error?.message ?? error),
      });
    }
  })()`.replace(/\s+/g, " ");

const parseJsonEvalResult = (output) => {
  const normalized = normalizeCliValue(output);
  try {
    return JSON.parse(normalized);
  } catch (error) {
    return {
      ok: false,
      reason: "invalid-json",
      output: normalized,
    };
  }
};

const formatUiFailure = (result) =>
  [
    result?.reason || "unknown",
    result?.message ? `(${result.message})` : "",
    result?.columns ? `columns=${result.columns.join(",")}` : "",
    result?.currentStatus !== undefined
      ? `currentStatus=${result.currentStatus}`
      : "",
    result?.currentRating !== undefined
      ? `currentRating=${result.currentRating}`
      : "",
    result?.currentValue !== undefined ? `currentValue=${result.currentValue}` : "",
    result?.cellHtml ? `cellHtml=${String(result.cellHtml).slice(0, 300)}` : "",
    result?.debug ? `debug=${JSON.stringify(result.debug).slice(0, 600)}` : "",
    result?.pasteDebug
      ? `pasteDebug=${JSON.stringify(result.pasteDebug).slice(0, 400)}`
      : "",
  ]
    .filter(Boolean)
    .join(" ");

const assertUiEvalOk = (label, result) => {
  if (result?.ok) return;
  throw new Error(
    `Notidian table UI ${label} failed: ${formatUiFailure(result)}`
  );
};

const waitForMetadataValue = async ({
  config,
  runner,
  path,
  property,
  expected,
}) => {
  const start = Date.now();
  let lastValue = "";

  while (Date.now() - start <= config.timeoutMs) {
    lastValue = normalizeCliValue(
      await runObsidian(config, runner, "eval", {
        code: metadataEvalCode(path, property),
      })
    );

    if (lastValue == expected) return lastValue;
    await sleep(Math.max(1, config.pollIntervalMs));
  }

  throw new Error(
    `Timed out waiting for metadata ${property}=${expected} on ${path}. Last value: ${lastValue}`
  );
};

const renameFileWithObsidianApi = async ({
  config,
  runner,
  fromPath,
  toPath,
}) => {
  const result = parseJsonEvalResult(
    await runObsidian(config, runner, "eval", {
      code: renameFileEvalCode({ fromPath, toPath }),
    })
  );

  if (result?.ok) return result;

  throw new Error(`Obsidian API rename failed: ${formatUiFailure(result)}`);
};

const cleanDevErrors = (output) => {
  const text = String(output ?? "").trim();
  return text.length == 0 || /no errors captured/i.test(text);
};

const alphaContent = "---\nstatus: old\nrating: 1\nstage: todo\n---\n# Alpha\n";
const betaContent = "---\nstatus: queued\nrating: 2\nstage: todo\n---\n# Beta\n";

const cleanupFixtures = async ({
  config,
  runner,
  paths,
  primaryPath,
  betaPath = paths.betaPath,
  extraPaths = [],
}) => {
  if (config.keepFixture) return false;

  const deletePaths = [
    ...new Set([primaryPath, betaPath, ...extraPaths].filter(Boolean)),
  ];
  const cleanupResult = parseJsonEvalResult(
    await runObsidian(config, runner, "eval", {
      code: cleanupFixturesEvalCode({ paths: deletePaths }),
    })
  );

  if (!cleanupResult?.ok) {
    const failed = cleanupResult?.failed?.[0];
    const path = failed?.path ? ` path=${failed.path}` : "";
    const message = failed?.message ? ` message=${failed.message}` : "";
    throw new Error(
      `Fixture cleanup failed: ${
        cleanupResult?.reason ?? "unknown"
      }${path}${message}`
    );
  }

  return true;
};

const runTableUiSmokeScenario = async ({ config, runner, paths }) => {
  const setupResult = parseJsonEvalResult(
    await runObsidian(config, runner, "eval", {
      code: tableViewSetupEvalCode({
        pluginId: config.pluginId,
        folder: paths.folder,
      }),
    })
  );
  assertUiEvalOk("setup", setupResult);

  const uiResult = parseJsonEvalResult(
    await runObsidian(config, runner, "eval", {
      code: tableUiEditEvalCode({
        folder: paths.folder,
        rowTitle: `${paths.runId}-Beta`,
        columnName: "status",
        value: DEFAULT_TABLE_UI_EDIT_VALUE,
        timeoutMs: config.timeoutMs,
        pollIntervalMs: config.pollIntervalMs,
      }),
    })
  );
  assertUiEvalOk("smoke", uiResult);

  if (uiResult.editedValue != DEFAULT_TABLE_UI_EDIT_VALUE) {
    throw new Error(
      `Notidian table UI smoke failed: expected editedValue=${DEFAULT_TABLE_UI_EDIT_VALUE}; got ${uiResult.editedValue}`
    );
  }

  await waitForMetadataValue({
    config,
    runner,
    path: paths.betaPath,
    property: "status",
    expected: DEFAULT_TABLE_UI_EDIT_VALUE,
  });

  const directUndoResult = parseJsonEvalResult(
    await runObsidian(config, runner, "eval", {
      code: tableUiUndoEvalCode({
        folder: paths.folder,
        rowTitle: `${paths.runId}-Beta`,
        statusValue: "queued",
        ratingValue: "2",
        timeoutMs: config.timeoutMs,
        pollIntervalMs: config.pollIntervalMs,
      }),
    })
  );
  assertUiEvalOk("direct undo", directUndoResult);

  await waitForMetadataValue({
    config,
    runner,
    path: paths.betaPath,
    property: "status",
    expected: "queued",
  });

  const directRedoResult = parseJsonEvalResult(
    await runObsidian(config, runner, "eval", {
      code: tableUiRedoEvalCode({
        folder: paths.folder,
        rowTitle: `${paths.runId}-Beta`,
        statusValue: DEFAULT_TABLE_UI_EDIT_VALUE,
        ratingValue: "2",
        timeoutMs: config.timeoutMs,
        pollIntervalMs: config.pollIntervalMs,
      }),
    })
  );
  assertUiEvalOk("direct redo", directRedoResult);

  await waitForMetadataValue({
    config,
    runner,
    path: paths.betaPath,
    property: "status",
    expected: DEFAULT_TABLE_UI_EDIT_VALUE,
  });

  const pasteResult = parseJsonEvalResult(
    await runObsidian(config, runner, "eval", {
      code: tableUiPasteEvalCode({
        folder: paths.folder,
        rowTitle: `${paths.runId}-Beta`,
        statusValue: DEFAULT_TABLE_UI_PASTE_STATUS,
        ratingValue: DEFAULT_TABLE_UI_PASTE_RATING,
        timeoutMs: config.timeoutMs,
        pollIntervalMs: config.pollIntervalMs,
      }),
    })
  );
  assertUiEvalOk("paste", pasteResult);

  await waitForMetadataValue({
    config,
    runner,
    path: paths.betaPath,
    property: "status",
    expected: DEFAULT_TABLE_UI_PASTE_STATUS,
  });
  await waitForMetadataValue({
    config,
    runner,
    path: paths.betaPath,
    property: "rating",
    expected: DEFAULT_TABLE_UI_PASTE_RATING,
  });

  const undoResult = parseJsonEvalResult(
    await runObsidian(config, runner, "eval", {
      code: tableUiUndoEvalCode({
        folder: paths.folder,
        rowTitle: `${paths.runId}-Beta`,
        statusValue: DEFAULT_TABLE_UI_EDIT_VALUE,
        ratingValue: "2",
        timeoutMs: config.timeoutMs,
        pollIntervalMs: config.pollIntervalMs,
      }),
    })
  );
  assertUiEvalOk("undo", undoResult);

  await waitForMetadataValue({
    config,
    runner,
    path: paths.betaPath,
    property: "status",
    expected: DEFAULT_TABLE_UI_EDIT_VALUE,
  });
  await waitForMetadataValue({
    config,
    runner,
    path: paths.betaPath,
    property: "rating",
    expected: "2",
  });

  const redoResult = parseJsonEvalResult(
    await runObsidian(config, runner, "eval", {
      code: tableUiRedoEvalCode({
        folder: paths.folder,
        rowTitle: `${paths.runId}-Beta`,
        statusValue: DEFAULT_TABLE_UI_PASTE_STATUS,
        ratingValue: DEFAULT_TABLE_UI_PASTE_RATING,
        timeoutMs: config.timeoutMs,
        pollIntervalMs: config.pollIntervalMs,
      }),
    })
  );
  assertUiEvalOk("redo", redoResult);

  await waitForMetadataValue({
    config,
    runner,
    path: paths.betaPath,
    property: "status",
    expected: DEFAULT_TABLE_UI_PASTE_STATUS,
  });
  await waitForMetadataValue({
    config,
    runner,
    path: paths.betaPath,
    property: "rating",
    expected: DEFAULT_TABLE_UI_PASTE_RATING,
  });

  const typeMatrixResult = parseJsonEvalResult(
    await runObsidian(config, runner, "eval", {
      code: tableUiTypeMatrixEvalCode({
        pluginId: config.pluginId,
        folder: paths.folder,
        columnName: DEFAULT_TABLE_UI_TYPE_COLUMN,
        timeoutMs: config.timeoutMs,
        pollIntervalMs: config.pollIntervalMs,
      }),
    })
  );
  assertUiEvalOk("type matrix", typeMatrixResult);

  const optionResult = parseJsonEvalResult(
    await runObsidian(config, runner, "eval", {
      code: tableUiOptionEvalCode({
        pluginId: config.pluginId,
        folder: paths.folder,
        rowTitle: `${paths.runId}-Beta`,
        columnName: "stage",
        currentValue: "todo",
        newValue: DEFAULT_TABLE_UI_OPTION_STAGE,
        timeoutMs: config.timeoutMs,
        pollIntervalMs: config.pollIntervalMs,
      }),
    })
  );
  assertUiEvalOk("option", optionResult);

  if (optionResult.editedValue != DEFAULT_TABLE_UI_OPTION_STAGE) {
    throw new Error(
      `Notidian table UI option failed: expected editedValue=${DEFAULT_TABLE_UI_OPTION_STAGE}; got ${optionResult.editedValue}`
    );
  }
  if (optionResult.optionSaved !== true) {
    throw new Error("Notidian table UI option failed: option was not saved.");
  }

  await waitForMetadataValue({
    config,
    runner,
    path: paths.betaPath,
    property: "stage",
    expected: DEFAULT_TABLE_UI_OPTION_STAGE,
  });

  const conflictResult = parseJsonEvalResult(
    await runObsidian(config, runner, "eval", {
      code: tableUiConflictEvalCode({
        pluginId: config.pluginId,
        folder: paths.folder,
        rowTitle: `${paths.runId}-Beta`,
        betaPath: paths.betaPath,
        externalValue: DEFAULT_TABLE_UI_CONFLICT_EXTERNAL,
        appliedValue: DEFAULT_TABLE_UI_CONFLICT_APPLIED,
        timeoutMs: config.timeoutMs,
        pollIntervalMs: config.pollIntervalMs,
      }),
    })
  );
  assertUiEvalOk("conflict", conflictResult);

  await waitForMetadataValue({
    config,
    runner,
    path: paths.betaPath,
    property: "status",
    expected: DEFAULT_TABLE_UI_CONFLICT_APPLIED,
  });

  const uiRenameTitle = `${paths.runId}-Alpha UI Renamed`;
  const renameResult = parseJsonEvalResult(
    await runObsidian(config, runner, "eval", {
      code: tableUiRenameEvalCode({
        folder: paths.folder,
        rowTitle: `${paths.runId}-Alpha Renamed`,
        nextTitle: uiRenameTitle,
        nextPath: paths.alphaUiRenamedPath,
        timeoutMs: config.timeoutMs,
        pollIntervalMs: config.pollIntervalMs,
      }),
    })
  );
  assertUiEvalOk("rename", renameResult);

  const primaryPath = renameResult.path || paths.alphaUiRenamedPath;
  const renamedContent = await runObsidian(config, runner, "read", {
    path: primaryPath,
  });
  if (!String(renamedContent ?? "").trim()) {
    throw new Error(`UI-renamed fixture could not be read at ${primaryPath}.`);
  }

  await waitForMetadataValue({
    config,
    runner,
    path: primaryPath,
    property: "status",
    expected: "active",
  });

  return {
    primaryPath,
  };
};

const runRealVaultSmokeHarness = async (config, runner) => {
  const errors = validateHarnessConfig(config);
  if (errors.length > 0) {
    throw new Error(errors.join("\n"));
  }

  const execute =
    runner ?? createObsidianRunner(config.obsidianBin, config.commandTimeoutMs);
  const paths = createFixturePaths(config, config.now?.() ?? new Date());
  let primaryPath = paths.alphaPath;
  let betaPath = paths.betaPath;
  let scenarioError = null;

  try {
    await runObsidian(config, execute, "vault", { info: "name" });
    await runObsidian(config, execute, "plugin:reload", {
      id: config.pluginId,
    });
    await runObsidian(config, execute, "dev:errors", { clear: true });
    await runObsidian(config, execute, "create", {
      path: paths.alphaPath,
      content: alphaContent,
      overwrite: true,
    });
    await runObsidian(config, execute, "create", {
      path: paths.betaPath,
      content: betaContent,
      overwrite: true,
    });
    await waitForMetadataValue({
      config,
      runner: execute,
      path: paths.alphaPath,
      property: "status",
      expected: "old",
    });
    await runObsidian(config, execute, "property:set", {
      path: paths.alphaPath,
      name: "status",
      value: "active",
      type: "text",
    });

    await waitForMetadataValue({
      config,
      runner: execute,
      path: paths.alphaPath,
      property: "status",
      expected: "active",
    });
    await renameFileWithObsidianApi({
      config,
      runner: execute,
      fromPath: paths.alphaPath,
      toPath: paths.alphaRenamedPath,
    });
    primaryPath = paths.alphaRenamedPath;

    const renamedContent = await runObsidian(config, execute, "read", {
      path: primaryPath,
    });
    if (!String(renamedContent ?? "").trim()) {
      throw new Error(`Renamed fixture could not be read at ${primaryPath}.`);
    }

    await waitForMetadataValue({
      config,
      runner: execute,
      path: primaryPath,
      property: "status",
      expected: "active",
    });

    if (config.includeUi) {
      const uiPaths = await runTableUiSmokeScenario({
        config,
        runner: execute,
        paths,
      });
      primaryPath = uiPaths.primaryPath ?? primaryPath;
    }

    const devErrors = await runObsidian(config, execute, "dev:errors");
    if (!cleanDevErrors(devErrors)) {
      throw new Error(`Obsidian captured developer errors:\n${devErrors}`);
    }
  } catch (error) {
    scenarioError = error;
  }

  if (!scenarioError && config.cleanupSettleMs > 0) {
    await sleep(config.cleanupSettleMs);
  }

  let cleanedUp = false;
  let cleanupError = null;
  try {
    cleanedUp = await cleanupFixtures({
      config,
      runner: execute,
      paths,
      primaryPath,
      betaPath,
    });
  } catch (error) {
    cleanupError = error;
  }

  if (scenarioError) throw scenarioError;
  if (cleanupError) throw cleanupError;

  if (!scenarioError && cleanedUp) {
    if (config.cleanupSettleMs > 0) {
      await sleep(config.cleanupSettleMs);
    }
    const cleanupDevErrors = await runObsidian(config, execute, "dev:errors");
    if (!cleanDevErrors(cleanupDevErrors)) {
      throw new Error(
        `Obsidian captured developer errors after fixture cleanup:\n${cleanupDevErrors}`
      );
    }
  }

  return {
    ok: true,
    fixtureFolder: paths.folder,
    cleanedUp,
  };
};

const usage = () => [
  "Usage:",
  '  npm run test:real-vault -- vault="Atlas Vault" --allow-write',
  "",
  "Options:",
  "  vault=<name>             Required unless NOTIDIAN_REAL_VAULT is set.",
  "  --allow-write            Required before creating fixtures.",
  "  --keep-fixture           Leave fixtures in the vault for inspection.",
  "  --ui                     Also exercise the live Notidian table DOM.",
  "  --plugin-id=<id>         Defaults to notidian.",
  `  --fixture-root=<folder>  Defaults to ${DEFAULT_FIXTURE_ROOT}.`,
  `  --timeout-ms=<ms>        Defaults to ${DEFAULT_TIMEOUT_MS}.`,
  `  --command-timeout-ms=<ms> Defaults to ${DEFAULT_COMMAND_TIMEOUT_MS}.`,
  `  --cleanup-settle-ms=<ms> Defaults to ${DEFAULT_CLEANUP_SETTLE_MS}.`,
].join("\n");

const main = async (argv = process.argv.slice(2), env = process.env) => {
  const config = parseHarnessArgs(argv, env);
  const errors = validateHarnessConfig(config);

  if (errors.length > 0) {
    console.error(`${errors.join("\n")}\n\n${usage()}`);
    process.exitCode = 1;
    return;
  }

  try {
    const result = await runRealVaultSmokeHarness(config);
    console.log(
      `Notidian real-vault smoke passed. Fixture folder: ${result.fixtureFolder}. Cleaned up: ${result.cleanedUp}.`
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
};

if (require.main === module) {
  main();
}

module.exports = {
  buildObsidianArgs,
  createObsidianRunner,
  createFixturePaths,
  parseHarnessArgs,
  runRealVaultSmokeHarness,
  validateHarnessConfig,
};
