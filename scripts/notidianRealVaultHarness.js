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
const DEFAULT_TABLE_UI_CONFLICT_EXTERNAL = "conflict-external";
const DEFAULT_TABLE_UI_CONFLICT_APPLIED = "conflict-applied";
const DEFAULT_BASE_VIEW_EDIT_VALUE = "base-view-active";
const DEFAULT_BASE_VIEW_PASTE_STATUS = "base-view-paste-active";
const DEFAULT_BASE_VIEW_PASTE_RATING = "9";
const DEFAULT_BASE_VIEW_CONFLICT_EXTERNAL = "base-view-conflict-external";
const DEFAULT_BASE_VIEW_CONFLICT_APPLIED = "base-view-conflict-applied";
const DEFAULT_BASE_VIEW_PASTE_RENAME_SUFFIX = "Beta Base Pasted";
const DEFAULT_BASE_VIEW_PASTE_RENAME_STATUS = "base-view-title-paste-status";
const DEFAULT_BASE_VIEW_RENAME_SUFFIX = "Beta Base Renamed";
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
    includeBaseExport: false,
    includeBaseView: false,
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
    if (arg == "--base-export") {
      config.includeBaseExport = true;
      continue;
    }
    if (arg == "--base-view") {
      config.includeBaseView = true;
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
    betaBaseRenamedPath: `${prefix}-${DEFAULT_BASE_VIEW_RENAME_SUFFIX}.md`,
    alphaRenamedPath: `${prefix}-Alpha Renamed.md`,
    alphaUiRenamedPath: `${prefix}-Alpha UI Renamed.md`,
    baseViewPath: `${prefix}-Notidian Table.base`,
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

const baseExportEvalCode = ({ pluginId, folder, timeoutMs, pollIntervalMs }) =>
  `(async () => {
    const marker = "notidianBaseExport";
    const finish = (payload) => JSON.stringify({ marker, ...payload });
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const pluginId = ${JSON.stringify(pluginId)};
    const folder = ${JSON.stringify(folder)};
    const timeoutMs = ${Number(timeoutMs)};
    const pollIntervalMs = Math.max(1, ${Number(pollIntervalMs)});
    try {
      const plugin = app.plugins.plugins[pluginId];
      if (!plugin?.superstate?.ui) {
        return finish({ ok: false, reason: "missing-plugin" });
      }
      if (!app.vault.getAbstractFileByPath(folder)) {
        return finish({ ok: false, reason: "missing-folder", folder });
      }
      const commandId = pluginId + ":notidian-export-active-folder-base";
      if (!app.commands.commands[commandId]) {
        return finish({ ok: false, reason: "missing-command", commandId });
      }
      if (typeof plugin.superstate.ui.setActivePath == "function") {
        plugin.superstate.ui.setActivePath(folder);
      } else {
        plugin.superstate.ui.activePath = folder;
      }
      plugin.superstate.ui.openPath?.(folder, true);
      await sleep(100);
      app.commands.executeCommandById(commandId);

      const start = Date.now();
      let lastModalText = "";
      do {
        const modals = Array.from(
          document.querySelectorAll(".mk-modal-wrapper, .mk-modal-wrapper-mobile")
        );
        const modal = modals.reverse().find((candidate) => {
          const text = candidate.innerText || "";
          return (
            text.includes("Export Obsidian Base") ||
            (text.includes("Export path:") && text.includes("Export .base"))
          );
        });
        if (!modal) {
          await sleep(pollIntervalMs);
          continue;
        }

        lastModalText = (modal.innerText || "").slice(0, 1000);
        const outputCode = Array.from(modal.querySelectorAll("code"))
          .find((candidate) => candidate.innerText.trim().endsWith(".base"));
        const outputPath = outputCode?.innerText.trim() || "";
        if (!outputPath) {
          return finish({
            ok: false,
            reason: "missing-output-path",
            modalText: lastModalText,
          });
        }
        const exportButton = Array.from(modal.querySelectorAll("button"))
          .find((button) => button.innerText.trim() == "Export .base");
        if (!exportButton) {
          return finish({
            ok: false,
            reason: "missing-export-button",
            outputPath,
            modalText: lastModalText,
          });
        }
        exportButton.click();

        const writeStart = Date.now();
        do {
          const exported = app.vault.getAbstractFileByPath(outputPath);
          if (exported) {
            const content = await app.vault.read(exported);
            if (!content.includes("file.inFolder") || !content.includes(folder)) {
              return finish({
                ok: false,
                reason: "missing-folder-filter",
                outputPath,
                content: content.slice(0, 1000),
              });
            }
            if (!content.includes("views:") || !content.includes('type: "table"')) {
              return finish({
                ok: false,
                reason: "missing-table-view",
                outputPath,
                content: content.slice(0, 1000),
              });
            }
            return finish({
              ok: true,
              outputPath,
              content: content.slice(0, 2000),
            });
          }
          await sleep(pollIntervalMs);
        } while (Date.now() - writeStart <= timeoutMs);

        return finish({
          ok: false,
          reason: "export-not-written",
          outputPath,
          modalText: lastModalText,
        });
      } while (Date.now() - start <= timeoutMs);

      return finish({ ok: false, reason: "missing-modal", commandId });
    } catch (error) {
      return finish({
        ok: false,
        reason: "exception",
        message: String(error?.message ?? error),
      });
    }
  })()`.replace(/\s+/g, " ");

const baseViewEvalCode = ({
  pluginId,
  folder,
  basePath,
  betaPath,
  expectedTitle,
  editValue,
  pasteStatusValue,
  pasteRatingValue,
  conflictExternalValue,
  conflictAppliedValue,
  pasteRenameTitle,
  pasteRenamePath,
  pasteRenameStatusValue,
  renameTitle,
  renamePath,
  timeoutMs,
  pollIntervalMs,
}) => {
  const baseContent = [
    "filters:",
    "  and:",
    `    - ${JSON.stringify(`file.inFolder(${JSON.stringify(folder)})`)}`,
    '    - "file.ext == \\"md\\""',
    "views:",
    '  - type: "notidian-table"',
    '    name: "Notidian Table Smoke"',
    "    order:",
    '      - "file.name"',
    '      - "status"',
    '      - "rating"',
    "",
  ].join("\n");

  return `(async () => {
    const marker = "notidianBaseView";
    const finish = (payload) => JSON.stringify({ marker, ...payload });
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const pluginId = ${JSON.stringify(pluginId)};
    const folder = ${JSON.stringify(folder)};
    const basePath = ${JSON.stringify(basePath)};
    const betaPath = ${JSON.stringify(betaPath)};
    const expectedTitle = ${JSON.stringify(expectedTitle)};
    const editValue = ${JSON.stringify(editValue)};
    const pasteStatusValue = ${JSON.stringify(pasteStatusValue)};
    const pasteRatingValue = ${JSON.stringify(pasteRatingValue)};
    const conflictExternalValue = ${JSON.stringify(conflictExternalValue)};
    const conflictAppliedValue = ${JSON.stringify(conflictAppliedValue)};
    const pasteRenameTitle = ${JSON.stringify(pasteRenameTitle)};
    const pasteRenamePath = ${JSON.stringify(pasteRenamePath)};
    const pasteRenameStatusValue = ${JSON.stringify(pasteRenameStatusValue)};
    const renameTitle = ${JSON.stringify(renameTitle)};
    const renamePath = ${JSON.stringify(renamePath)};
    const baseContent = ${JSON.stringify(baseContent)};
    const timeoutMs = ${Number(timeoutMs)};
    const pollIntervalMs = Math.max(1, ${Number(pollIntervalMs)});
    const latestView = () => {
      const views = Array.from(
        document.querySelectorAll(".notidian-bases-table-view")
      );
      return views[views.length - 1];
    };
    const frontmatterValue = (path, property) => {
      const file = app.vault.getAbstractFileByPath(path);
      if (!file) return undefined;
      return app.metadataCache.getFileCache(file)?.frontmatter?.[property];
    };
    const markdownFrontmatterValue = async (path, property) => {
      const file = app.vault.getAbstractFileByPath(path);
      if (!file) return undefined;
      const content = await app.vault.cachedRead(file);
      const match = String(content).match(/^---\\n([\\s\\S]*?)\\n---/);
      if (!match) return undefined;
      const line = match[1]
        .split("\\n")
        .find((candidate) => candidate.startsWith(property + ":"));
      if (!line) return undefined;
      return line
        .slice(property.length + 1)
        .trim()
        .replace(/^["']|["']$/g, "");
    };
    const editStatusCell = async (
      view,
      nextValue = editValue,
      waitForMetadata = true,
      beforeCommit = null,
      baseValueOverride = null
    ) => {
      const headers = Array.from(view.querySelectorAll("thead th"))
        .map((header) => header.innerText.trim());
      const statusColumnIndex = headers.findIndex((header) =>
        ["status", "note.status"].includes(header)
      );
      if (statusColumnIndex < 0) {
        return { ok: false, reason: "missing-edit-column", columns: headers };
      }
      const row = Array.from(view.querySelectorAll("tbody tr[data-path]"))
        .find((candidate) =>
          candidate.getAttribute("data-path") === betaPath ||
          candidate.innerText.includes(expectedTitle)
        );
      if (!row) {
        return {
          ok: false,
          reason: "missing-edit-row",
          columns: headers,
          tableText: view.innerText.slice(0, 500),
        };
      }
      const cell = row.children[statusColumnIndex];
      const editor = cell?.querySelector("[contenteditable='true']");
      if (!editor) {
        return {
          ok: false,
          reason: "missing-edit-editor",
          columns: headers,
          cellHtml: cell?.outerHTML?.slice(0, 500) ?? "",
        };
      }
      if (baseValueOverride != null) {
        cell.setAttribute(
          "data-notidian-bases-base-value",
          String(baseValueOverride)
        );
        editor.textContent = String(baseValueOverride);
      }
      editor.focus();
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(editor);
      selection?.removeAllRanges();
      selection?.addRange(range);
      const inserted = typeof document.execCommand == "function"
        ? document.execCommand("insertText", false, nextValue)
        : false;
      if (!inserted) {
        editor.textContent = nextValue;
      }
      const inputEvent = typeof InputEvent == "function"
        ? new InputEvent("input", {
            bubbles: true,
            inputType: "insertText",
            data: nextValue,
          })
        : new Event("input", { bubbles: true });
      editor.dispatchEvent(inputEvent);
      if (typeof beforeCommit == "function") {
        beforeCommit();
      }
      editor.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, key: "Enter" })
      );
      editor.dispatchEvent(
        new FocusEvent("focusout", {
          bubbles: true,
          relatedTarget: view,
        })
      );
      editor.dispatchEvent(
        new FocusEvent("blur", {
          bubbles: false,
          relatedTarget: view,
        })
      );
      if (document.activeElement === editor) {
        editor.blur();
      }

      if (!waitForMetadata) {
        return { ok: true, editedValue: nextValue };
      }

      const start = Date.now();
      do {
        if (String(frontmatterValue(betaPath, "status")) == nextValue) {
          return { ok: true, editedValue: nextValue };
        }
        await sleep(pollIntervalMs);
      } while (Date.now() - start <= timeoutMs);

      return {
        ok: false,
        reason: "edit-not-applied",
        currentValue: frontmatterValue(betaPath, "status"),
      };
    };
    const pasteStatusAndRating = async (view) => {
      const headers = Array.from(view.querySelectorAll("thead th"))
        .map((header) => header.innerText.trim());
      const statusColumnIndex = headers.findIndex((header) =>
        ["status", "note.status"].includes(header)
      );
      if (statusColumnIndex < 0) {
        return { ok: false, reason: "missing-paste-column", columns: headers };
      }
      const row = Array.from(view.querySelectorAll("tbody tr[data-path]"))
        .find((candidate) =>
          candidate.getAttribute("data-path") === betaPath ||
          candidate.innerText.includes(expectedTitle)
        );
      if (!row) {
        return {
          ok: false,
          reason: "missing-paste-row",
          columns: headers,
          tableText: view.innerText.slice(0, 500),
        };
      }
      const cell = row.children[statusColumnIndex];
      const editor = cell?.querySelector("[contenteditable='true']");
      if (!editor) {
        return {
          ok: false,
          reason: "missing-paste-editor",
          columns: headers,
          cellHtml: cell?.outerHTML?.slice(0, 500) ?? "",
        };
      }

      editor.focus();
      const baseBeforePaste = cell.getAttribute("data-notidian-bases-base-value");
      const textBeforePaste = editor.innerText.trim();
      const payload = pasteStatusValue + "\\t" + pasteRatingValue;
      let dataTransfer = null;
      if (typeof DataTransfer == "function") {
        dataTransfer = new DataTransfer();
        dataTransfer.setData("text/plain", payload);
      }
      const pasteEvent = typeof ClipboardEvent == "function"
        ? new ClipboardEvent("paste", {
            bubbles: true,
            cancelable: true,
            clipboardData: dataTransfer,
          })
        : new Event("paste", { bubbles: true, cancelable: true });
      if (dataTransfer && !pasteEvent.clipboardData) {
        try {
          Object.defineProperty(pasteEvent, "clipboardData", {
            value: dataTransfer,
          });
        } catch (_error) {}
      }
      if (!dataTransfer) {
        try {
          Object.defineProperty(pasteEvent, "clipboardData", {
            value: {
              getData: (type) => type == "text/plain" ? payload : "",
            },
          });
        } catch (_error) {}
      }
      editor.dispatchEvent(pasteEvent);
      if (!pasteEvent.defaultPrevented) {
        return {
          ok: false,
          reason: "paste-not-intercepted",
          columns: headers,
        };
      }

      const start = Date.now();
      do {
        if (
          String(frontmatterValue(betaPath, "status")) == pasteStatusValue &&
          String(frontmatterValue(betaPath, "rating")) == pasteRatingValue
        ) {
          return {
            ok: true,
            pastedValues: {
              status: pasteStatusValue,
              rating: pasteRatingValue,
            },
            pasteDebug: {
              baseBeforePaste,
              textBeforePaste,
            },
          };
        }
        await sleep(pollIntervalMs);
      } while (Date.now() - start <= timeoutMs);

      return {
        ok: false,
        reason: "paste-not-applied",
        currentStatus: frontmatterValue(betaPath, "status"),
        currentRating: frontmatterValue(betaPath, "rating"),
      };
    };
    const undoPastedStatusAndRating = async (view) => {
      const table = view.querySelector(".notidian-bases-table-view__table");
      if (!table) {
        return { ok: false, reason: "missing-undo-table" };
      }
      table.focus();
      const undoEvent = new KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        key: "z",
        metaKey: true,
        ctrlKey: true,
      });
      table.dispatchEvent(undoEvent);
      if (!undoEvent.defaultPrevented) {
        return { ok: false, reason: "undo-not-intercepted" };
      }

      const start = Date.now();
      const debug = {
        undoDepthBefore: view.getAttribute("data-notidian-bases-undo-depth"),
        statusBeforeUndo: frontmatterValue(betaPath, "status"),
        ratingBeforeUndo: frontmatterValue(betaPath, "rating"),
      };
      do {
        debug.undoState = table.getAttribute("data-notidian-bases-undo-state");
        debug.lastUndo = view.getAttribute("data-notidian-bases-last-undo");
        debug.markdownStatus = await markdownFrontmatterValue(betaPath, "status");
        debug.markdownRating = await markdownFrontmatterValue(betaPath, "rating");
        if (
          String(debug.markdownStatus) == editValue &&
          String(debug.markdownRating) == "2"
        ) {
          return {
            ok: true,
            undoValues: {
              status: editValue,
              rating: "2",
            },
          };
        }
        await sleep(pollIntervalMs);
      } while (Date.now() - start <= timeoutMs);

      return {
        ok: false,
        reason: "undo-not-applied",
        currentStatus: frontmatterValue(betaPath, "status"),
        currentRating: frontmatterValue(betaPath, "rating"),
        debug,
      };
    };
    const applyConflictStatus = async (view) => {
      const file = app.vault.getAbstractFileByPath(betaPath);
      const cache = file ? app.metadataCache.getFileCache(file) : null;
      if (!cache?.frontmatter) {
        return { ok: false, reason: "missing-conflict-cache" };
      }
      const conflictDebug = {
        cacheBeforeEdit: cache.frontmatter.status,
        cacheAfterMutation: null,
        cellBaseBeforeEdit: null,
      };

      const editResult = await editStatusCell(
        view,
        conflictAppliedValue,
        false,
        () => {
          cache.frontmatter.status = conflictExternalValue;
          conflictDebug.cacheAfterMutation = cache.frontmatter.status;
        },
        editValue
      );
      if (!editResult.ok) return editResult;

      const start = Date.now();
      let lastCellHtml = "";
      do {
        const latest = latestView() || view;
        const row = Array.from(latest.querySelectorAll("tbody tr[data-path]"))
          .find((candidate) =>
            candidate.getAttribute("data-path") === betaPath ||
            candidate.innerText.includes(expectedTitle)
          );
        const conflictCell = row
          ? Array.from(row.children).find(
              (cell) =>
                cell.getAttribute("data-edit-action") ==
                "frontmatter-conflict"
            )
          : null;
        if (row && conflictDebug.cellBaseBeforeEdit == null) {
          const headers = Array.from(latest.querySelectorAll("thead th"))
            .map((header) => header.innerText.trim());
          const statusColumnIndex = headers.findIndex((header) =>
            ["status", "note.status"].includes(header)
          );
          conflictDebug.cellBaseBeforeEdit = row.children[statusColumnIndex]
            ?.getAttribute("data-notidian-bases-base-value");
        }
        if (conflictCell) {
          lastCellHtml = conflictCell.outerHTML.slice(0, 800);
          const applyButton = Array.from(conflictCell.querySelectorAll("button"))
            .find((button) => button.innerText.trim() == "Apply anyway");
          if (applyButton) {
            applyButton.click();
            const applyStart = Date.now();
            do {
              if (String(frontmatterValue(betaPath, "status")) == conflictAppliedValue) {
                return {
                  ok: true,
                  conflictAppliedValue,
                };
              }
              await sleep(pollIntervalMs);
            } while (Date.now() - applyStart <= timeoutMs);
            return {
              ok: false,
              reason: "conflict-apply-not-visible",
              currentValue: frontmatterValue(betaPath, "status"),
            };
          }
        }
        await sleep(pollIntervalMs);
      } while (Date.now() - start <= timeoutMs);

      return {
        ok: false,
        reason: "missing-conflict-action",
        currentValue: frontmatterValue(betaPath, "status"),
        debug: conflictDebug,
        cellHtml: lastCellHtml,
      };
    };
    const pasteFileNameAndStatus = async (view) => {
      const headers = Array.from(view.querySelectorAll("thead th"))
        .map((header) => header.innerText.trim());
      const fileNameColumnIndex = headers.findIndex((header) =>
        header === "file.name"
      );
      if (fileNameColumnIndex < 0) {
        return { ok: false, reason: "missing-title-paste-column", columns: headers };
      }
      const row = Array.from(view.querySelectorAll("tbody tr[data-path]"))
        .find((candidate) =>
          candidate.getAttribute("data-path") === betaPath ||
          candidate.innerText.includes(expectedTitle)
        );
      if (!row) {
        return {
          ok: false,
          reason: "missing-title-paste-row",
          columns: headers,
          tableText: view.innerText.slice(0, 500),
        };
      }
      const cell = row.children[fileNameColumnIndex];
      const editor = cell?.querySelector("[contenteditable='true']");
      if (!editor) {
        return {
          ok: false,
          reason: "missing-title-paste-editor",
          columns: headers,
          cellHtml: cell?.outerHTML?.slice(0, 500) ?? "",
        };
      }

      editor.focus();
      const payload = pasteRenameTitle + "\\t" + pasteRenameStatusValue;
      let dataTransfer = null;
      if (typeof DataTransfer == "function") {
        dataTransfer = new DataTransfer();
        dataTransfer.setData("text/plain", payload);
      }
      const pasteEvent = typeof ClipboardEvent == "function"
        ? new ClipboardEvent("paste", {
            bubbles: true,
            cancelable: true,
            clipboardData: dataTransfer,
          })
        : new Event("paste", { bubbles: true, cancelable: true });
      if (dataTransfer && !pasteEvent.clipboardData) {
        try {
          Object.defineProperty(pasteEvent, "clipboardData", {
            value: dataTransfer,
          });
        } catch (_error) {}
      }
      if (!dataTransfer) {
        try {
          Object.defineProperty(pasteEvent, "clipboardData", {
            value: {
              getData: (type) => type == "text/plain" ? payload : "",
            },
          });
        } catch (_error) {}
      }
      editor.dispatchEvent(pasteEvent);
      if (!pasteEvent.defaultPrevented) {
        return {
          ok: false,
          reason: "title-paste-not-intercepted",
          columns: headers,
        };
      }

      const start = Date.now();
      do {
        const renamedFile = app.vault.getAbstractFileByPath(pasteRenamePath);
        if (
          renamedFile &&
          String(await markdownFrontmatterValue(pasteRenamePath, "status")) ==
            pasteRenameStatusValue
        ) {
          return {
            ok: true,
            titlePastePath: pasteRenamePath,
            titlePasteTitle: pasteRenameTitle,
            titlePasteStatusValue: pasteRenameStatusValue,
          };
        }
        await sleep(pollIntervalMs);
      } while (Date.now() - start <= timeoutMs);

      return {
        ok: false,
        reason: "title-paste-not-applied",
        pasteRenamePath,
        currentStatus: await markdownFrontmatterValue(pasteRenamePath, "status"),
      };
    };
    const undoFileNamePaste = async (view) => {
      const table = view.querySelector(".notidian-bases-table-view__table");
      if (!table) {
        return { ok: false, reason: "missing-title-undo-table" };
      }
      table.focus();
      const undoEvent = new KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        key: "z",
        metaKey: true,
        ctrlKey: true,
      });
      table.dispatchEvent(undoEvent);
      if (!undoEvent.defaultPrevented) {
        return { ok: false, reason: "title-undo-not-intercepted" };
      }

      const start = Date.now();
      do {
        const originalFile = app.vault.getAbstractFileByPath(betaPath);
        const renamedFile = app.vault.getAbstractFileByPath(pasteRenamePath);
        if (
          originalFile &&
          !renamedFile &&
          String(await markdownFrontmatterValue(betaPath, "status")) ==
            conflictAppliedValue
        ) {
          return {
            ok: true,
            titleUndoPath: betaPath,
          };
        }
        await sleep(pollIntervalMs);
      } while (Date.now() - start <= timeoutMs);

      return {
        ok: false,
        reason: "title-undo-not-applied",
        originalExists: Boolean(app.vault.getAbstractFileByPath(betaPath)),
        renamedExists: Boolean(app.vault.getAbstractFileByPath(pasteRenamePath)),
      };
    };
    const editFileNameCell = async (view) => {
      const headers = Array.from(view.querySelectorAll("thead th"))
        .map((header) => header.innerText.trim());
      const fileNameColumnIndex = headers.findIndex((header) =>
        header === "file.name"
      );
      if (fileNameColumnIndex < 0) {
        return { ok: false, reason: "missing-rename-column", columns: headers };
      }
      const row = Array.from(view.querySelectorAll("tbody tr[data-path]"))
        .find((candidate) =>
          candidate.getAttribute("data-path") === betaPath ||
          candidate.innerText.includes(expectedTitle)
        );
      if (!row) {
        return {
          ok: false,
          reason: "missing-rename-row",
          columns: headers,
          tableText: view.innerText.slice(0, 500),
        };
      }
      const cell = row.children[fileNameColumnIndex];
      const editor = cell?.querySelector("[contenteditable='true']");
      if (!editor) {
        return {
          ok: false,
          reason: "missing-rename-editor",
          columns: headers,
          cellHtml: cell?.outerHTML?.slice(0, 500) ?? "",
        };
      }
      editor.focus();
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(editor);
      selection?.removeAllRanges();
      selection?.addRange(range);
      const inserted = typeof document.execCommand == "function"
        ? document.execCommand("insertText", false, renameTitle)
        : false;
      if (!inserted) {
        editor.textContent = renameTitle;
      }
      const inputEvent = typeof InputEvent == "function"
        ? new InputEvent("input", {
            bubbles: true,
            inputType: "insertText",
            data: renameTitle,
          })
        : new Event("input", { bubbles: true });
      editor.dispatchEvent(inputEvent);
      editor.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, key: "Enter" })
      );
      editor.dispatchEvent(
        new FocusEvent("focusout", {
          bubbles: true,
          relatedTarget: view,
        })
      );
      editor.dispatchEvent(
        new FocusEvent("blur", {
          bubbles: false,
          relatedTarget: view,
        })
      );
      if (document.activeElement === editor) {
        editor.blur();
      }

      const start = Date.now();
      do {
        const renamedFile = app.vault.getAbstractFileByPath(renamePath);
        if (renamedFile) {
          return { ok: true, renamedPath: renamePath, renamedTitle: renameTitle };
        }
        await sleep(pollIntervalMs);
      } while (Date.now() - start <= timeoutMs);

      return {
        ok: false,
        reason: "rename-not-applied",
        renamePath,
      };
    };
    try {
      const plugin = app.plugins.plugins[pluginId];
      if (!plugin) {
        return finish({ ok: false, reason: "missing-plugin" });
      }
      if (plugin.notidianBasesViewRegistered !== true) {
        return finish({
          ok: false,
          reason: "not-registered",
          registered: plugin.notidianBasesViewRegistered,
        });
      }
      if (!app.vault.getAbstractFileByPath(folder)) {
        return finish({ ok: false, reason: "missing-folder", folder });
      }
      const existing = app.vault.getAbstractFileByPath(basePath);
      if (existing) {
        await app.vault.modify(existing, baseContent);
      } else {
        await app.vault.create(basePath, baseContent);
      }
      const baseFile = app.vault.getAbstractFileByPath(basePath);
      if (!baseFile) {
        return finish({ ok: false, reason: "base-not-created", basePath });
      }
      await app.workspace.getLeaf(true).openFile(baseFile);

      const start = Date.now();
      let sawView = false;
      let lastText = "";
      let rowCount = 0;
      do {
        const views = Array.from(
          document.querySelectorAll(".notidian-bases-table-view")
        );
        const view = views[views.length - 1];
        if (view) {
          sawView = true;
          lastText = (view.innerText || "").slice(0, 1000);
          rowCount = view.querySelectorAll("tbody tr[data-path]").length;
          const capabilitiesText =
            view.getAttribute("data-notidian-bases-capabilities") || "";
          let capabilities = null;
          if (capabilitiesText) {
            try {
              capabilities = JSON.parse(capabilitiesText);
            } catch (error) {
              return finish({
                ok: false,
                reason: "invalid-capabilities",
                message: String(error?.message ?? error),
                basePath,
                tableText: lastText,
              });
            }
          }
          if (
            lastText.includes("Notidian Table") &&
            lastText.includes(expectedTitle) &&
            lastText.includes("status") &&
            lastText.includes("rating")
          ) {
            if (!capabilities) {
              return finish({
                ok: false,
                reason: "missing-capabilities",
                basePath,
                rowCount,
                tableText: lastText,
              });
            }
            const editResult = await editStatusCell(view);
            if (!editResult.ok) {
              return finish({
                ...editResult,
                basePath,
                rowCount,
                tableText: lastText,
              });
            }
            const pasteResult = await pasteStatusAndRating(latestView() || view);
            if (!pasteResult.ok) {
              return finish({
                ...pasteResult,
                basePath,
                rowCount,
                tableText: lastText,
              });
            }
            const undoResult = await undoPastedStatusAndRating(latestView() || view);
            if (!undoResult.ok) {
              return finish({
                ...undoResult,
                pasteDebug: pasteResult.pasteDebug,
                basePath,
                rowCount,
                tableText: lastText,
              });
            }
            const conflictResult = await applyConflictStatus(latestView() || view);
            if (!conflictResult.ok) {
              return finish({
                ...conflictResult,
                basePath,
                rowCount,
                tableText: lastText,
              });
            }
            const titlePasteResult = await pasteFileNameAndStatus(latestView() || view);
            if (!titlePasteResult.ok) {
              return finish({
                ...titlePasteResult,
                basePath,
                rowCount,
                tableText: lastText,
              });
            }
            const titleUndoResult = await undoFileNamePaste(latestView() || view);
            if (!titleUndoResult.ok) {
              return finish({
                ...titleUndoResult,
                basePath,
                rowCount,
                tableText: lastText,
              });
            }
            const renameResult = await editFileNameCell(latestView() || view);
            if (!renameResult.ok) {
              return finish({
                ...renameResult,
                basePath,
                rowCount,
                tableText: lastText,
              });
            }
            return finish({
              ok: true,
              basePath,
              rowCount,
              tableText: lastText,
              capabilities,
              editedValue: editResult.editedValue,
              pastedValues: pasteResult.pastedValues,
              undoValues: undoResult.undoValues,
              conflictAppliedValue: conflictResult.conflictAppliedValue,
              titlePastePath: titlePasteResult.titlePastePath,
              titlePasteTitle: titlePasteResult.titlePasteTitle,
              titlePasteStatusValue: titlePasteResult.titlePasteStatusValue,
              titleUndoPath: titleUndoResult.titleUndoPath,
              renamedPath: renameResult.renamedPath,
              renamedTitle: renameResult.renamedTitle,
            });
          }
        }
        await sleep(pollIntervalMs);
      } while (Date.now() - start <= timeoutMs);

      return finish({
        ok: false,
        reason: sawView ? "custom-view-not-settled" : "missing-custom-view",
        basePath,
        rowCount,
        tableText: lastText,
      });
    } catch (error) {
      return finish({
        ok: false,
        reason: "exception",
        message: String(error?.message ?? error),
      });
    }
  })()`;
};

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

const assertBaseExportEvalOk = (result) => {
  if (result?.ok) return;
  throw new Error(
    `Notidian base export smoke failed: ${formatUiFailure(result)}`
  );
};

const assertBaseViewEvalOk = (result) => {
  if (result?.ok) return;
  throw new Error(
    `Notidian custom Bases view smoke failed: ${formatUiFailure(result)}`
  );
};

const baseViewCapabilitySummary = (capabilities) => ({
  configMethods: capabilities?.configMethods ?? [],
  entryHasSetValue: Boolean(capabilities?.writeSurface?.entryHasSetValue),
  properties: capabilities?.dataShape?.properties ?? [],
  valueMethods: capabilities?.firstEntry?.valueMethods ?? [],
});

const assertBaseViewCapabilities = (result) => {
  const capabilities = result?.capabilities;
  if (!capabilities) {
    throw new Error(
      "Notidian custom Bases view smoke failed: missing-capabilities"
    );
  }
  if (capabilities.dataShape?.hasData !== true) {
    throw new Error("Notidian custom Bases view smoke failed: missing-data");
  }
  const properties = capabilities.dataShape?.properties ?? [];
  const expectedProperties = [
    ["file.name"],
    ["status", "note.status"],
    ["rating", "note.rating"],
  ];
  for (const aliases of expectedProperties) {
    if (!aliases.some((property) => properties.includes(property))) {
      throw new Error(
        `Notidian custom Bases view smoke failed: missing-property ${aliases[0]}`
      );
    }
  }
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

const alphaContent = "---\nstatus: old\nrating: 1\n---\n# Alpha\n";
const betaContent = "---\nstatus: queued\nrating: 2\n---\n# Beta\n";

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
  for (const path of deletePaths) {
    await runObsidian(config, runner, "delete", {
      path,
      permanent: true,
    });
  }

  return true;
};

const runBaseExportSmokeScenario = async ({ config, runner, paths }) => {
  const result = parseJsonEvalResult(
    await runObsidian(config, runner, "eval", {
      code: baseExportEvalCode({
        pluginId: config.pluginId,
        folder: paths.folder,
        timeoutMs: config.timeoutMs,
        pollIntervalMs: config.pollIntervalMs,
      }),
    })
  );
  assertBaseExportEvalOk(result);

  if (!String(result.outputPath ?? "").endsWith(".base")) {
    throw new Error(
      `Notidian base export smoke failed: expected .base output path; got ${result.outputPath}`
    );
  }

  return {
    baseExportPath: result.outputPath,
  };
};

const runBaseViewSmokeScenario = async ({ config, runner, paths }) => {
  const result = parseJsonEvalResult(
    await runObsidian(config, runner, "eval", {
      code: baseViewEvalCode({
        pluginId: config.pluginId,
        folder: paths.folder,
        basePath: paths.baseViewPath,
        betaPath: paths.betaPath,
        expectedTitle: `${paths.runId}-Beta`,
        editValue: DEFAULT_BASE_VIEW_EDIT_VALUE,
        pasteStatusValue: DEFAULT_BASE_VIEW_PASTE_STATUS,
        pasteRatingValue: DEFAULT_BASE_VIEW_PASTE_RATING,
        conflictExternalValue: DEFAULT_BASE_VIEW_CONFLICT_EXTERNAL,
        conflictAppliedValue: DEFAULT_BASE_VIEW_CONFLICT_APPLIED,
        pasteRenameTitle: `${paths.runId}-${DEFAULT_BASE_VIEW_PASTE_RENAME_SUFFIX}`,
        pasteRenamePath: `${paths.prefix}-${DEFAULT_BASE_VIEW_PASTE_RENAME_SUFFIX}.md`,
        pasteRenameStatusValue: DEFAULT_BASE_VIEW_PASTE_RENAME_STATUS,
        renameTitle: `${paths.runId}-${DEFAULT_BASE_VIEW_RENAME_SUFFIX}`,
        renamePath: paths.betaBaseRenamedPath,
        timeoutMs: config.timeoutMs,
        pollIntervalMs: config.pollIntervalMs,
      }),
    })
  );
  assertBaseViewEvalOk(result);
  assertBaseViewCapabilities(result);

  if (!String(result.basePath ?? "").endsWith(".base")) {
    throw new Error(
      `Notidian custom Bases view smoke failed: expected .base path; got ${result.basePath}`
    );
  }
  if (result.editedValue != DEFAULT_BASE_VIEW_EDIT_VALUE) {
    throw new Error(
      `Notidian custom Bases view smoke failed: expected editedValue=${DEFAULT_BASE_VIEW_EDIT_VALUE}; got ${result.editedValue}`
    );
  }
  if (
    result.pastedValues?.status != DEFAULT_BASE_VIEW_PASTE_STATUS ||
    result.pastedValues?.rating != DEFAULT_BASE_VIEW_PASTE_RATING
  ) {
    throw new Error(
      `Notidian custom Bases view smoke failed: expected pastedValues status=${DEFAULT_BASE_VIEW_PASTE_STATUS} rating=${DEFAULT_BASE_VIEW_PASTE_RATING}; got ${JSON.stringify(result.pastedValues)}`
    );
  }
  if (
    result.undoValues?.status != DEFAULT_BASE_VIEW_EDIT_VALUE ||
    result.undoValues?.rating != "2"
  ) {
    throw new Error(
      `Notidian custom Bases view smoke failed: expected undoValues status=${DEFAULT_BASE_VIEW_EDIT_VALUE} rating=2; got ${JSON.stringify(result.undoValues)}`
    );
  }
  if (result.conflictAppliedValue != DEFAULT_BASE_VIEW_CONFLICT_APPLIED) {
    throw new Error(
      `Notidian custom Bases view smoke failed: expected conflictAppliedValue=${DEFAULT_BASE_VIEW_CONFLICT_APPLIED}; got ${result.conflictAppliedValue}`
    );
  }
  const expectedTitlePastePath = `${paths.prefix}-${DEFAULT_BASE_VIEW_PASTE_RENAME_SUFFIX}.md`;
  if (result.titlePastePath != expectedTitlePastePath) {
    throw new Error(
      `Notidian custom Bases view smoke failed: expected titlePastePath=${expectedTitlePastePath}; got ${result.titlePastePath}`
    );
  }
  if (result.titleUndoPath != paths.betaPath) {
    throw new Error(
      `Notidian custom Bases view smoke failed: expected titleUndoPath=${paths.betaPath}; got ${result.titleUndoPath}`
    );
  }
  if (result.titlePasteStatusValue != DEFAULT_BASE_VIEW_PASTE_RENAME_STATUS) {
    throw new Error(
      `Notidian custom Bases view smoke failed: expected titlePasteStatusValue=${DEFAULT_BASE_VIEW_PASTE_RENAME_STATUS}; got ${result.titlePasteStatusValue}`
    );
  }
  if (result.renamedPath != paths.betaBaseRenamedPath) {
    throw new Error(
      `Notidian custom Bases view smoke failed: expected renamedPath=${paths.betaBaseRenamedPath}; got ${result.renamedPath}`
    );
  }

  await waitForMetadataValue({
    config,
    runner,
    path: result.renamedPath,
    property: "status",
    expected: DEFAULT_BASE_VIEW_CONFLICT_APPLIED,
  });
  await waitForMetadataValue({
    config,
    runner,
    path: result.renamedPath,
    property: "rating",
    expected: "2",
  });

  return {
    baseViewPath: result.basePath,
    baseViewCapabilities: baseViewCapabilitySummary(result.capabilities),
    baseViewEditValue: result.editedValue,
    baseViewPasteValues: result.pastedValues,
    baseViewUndoValues: result.undoValues,
    baseViewConflictAppliedValue: result.conflictAppliedValue,
    baseViewTitlePastePath: result.titlePastePath,
    baseViewTitlePasteStatusValue: result.titlePasteStatusValue,
    baseViewTitleUndoPath: result.titleUndoPath,
    baseViewRenamedPath: result.renamedPath,
    baseViewRenameTitle: result.renamedTitle,
  };
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
  let baseExportPath = null;
  let baseViewPath = null;
  let baseViewCapabilities = null;
  let baseViewEditValue = null;
  let baseViewPasteValues = null;
  let baseViewUndoValues = null;
  let baseViewConflictAppliedValue = null;
  let baseViewTitlePastePath = null;
  let baseViewTitlePasteStatusValue = null;
  let baseViewTitleUndoPath = null;
  let baseViewRenamedPath = null;
  let baseViewRenameTitle = null;
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

    const propertyValue = normalizeCliValue(
      await runObsidian(config, execute, "property:read", {
        path: paths.alphaPath,
        name: "status",
      })
    );
    if (propertyValue != "active") {
      throw new Error(
        `Expected property:read status=active on ${paths.alphaPath}; got ${propertyValue}`
      );
    }

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

    if (config.includeBaseExport) {
      const exportPaths = await runBaseExportSmokeScenario({
        config,
        runner: execute,
        paths,
      });
      baseExportPath = exportPaths.baseExportPath ?? null;
    }

    if (config.includeBaseView) {
      const viewPaths = await runBaseViewSmokeScenario({
        config,
        runner: execute,
        paths,
      });
      baseViewPath = viewPaths.baseViewPath ?? null;
      baseViewCapabilities = viewPaths.baseViewCapabilities ?? null;
      baseViewEditValue = viewPaths.baseViewEditValue ?? null;
      baseViewPasteValues = viewPaths.baseViewPasteValues ?? null;
      baseViewUndoValues = viewPaths.baseViewUndoValues ?? null;
      baseViewConflictAppliedValue =
        viewPaths.baseViewConflictAppliedValue ?? null;
      baseViewTitlePastePath = viewPaths.baseViewTitlePastePath ?? null;
      baseViewTitlePasteStatusValue =
        viewPaths.baseViewTitlePasteStatusValue ?? null;
      baseViewTitleUndoPath = viewPaths.baseViewTitleUndoPath ?? null;
      baseViewRenamedPath = viewPaths.baseViewRenamedPath ?? null;
      baseViewRenameTitle = viewPaths.baseViewRenameTitle ?? null;
      betaPath = viewPaths.baseViewRenamedPath ?? betaPath;
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

  const cleanedUp = await cleanupFixtures({
    config,
    runner: execute,
    paths,
    primaryPath,
    betaPath,
    extraPaths: [
      baseExportPath,
      baseViewPath,
      config.includeBaseView ? paths.baseViewPath : null,
    ].filter(Boolean),
  });

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

  if (scenarioError) throw scenarioError;

  return {
    ok: true,
    fixtureFolder: paths.folder,
    cleanedUp,
    ...(baseExportPath ? { baseExportPath } : {}),
    ...(baseViewPath ? { baseViewPath } : {}),
    ...(baseViewCapabilities ? { baseViewCapabilities } : {}),
    ...(baseViewEditValue ? { baseViewEditValue } : {}),
    ...(baseViewPasteValues ? { baseViewPasteValues } : {}),
    ...(baseViewUndoValues ? { baseViewUndoValues } : {}),
    ...(baseViewConflictAppliedValue ? { baseViewConflictAppliedValue } : {}),
    ...(baseViewTitlePastePath ? { baseViewTitlePastePath } : {}),
    ...(baseViewTitlePasteStatusValue
      ? { baseViewTitlePasteStatusValue }
      : {}),
    ...(baseViewTitleUndoPath ? { baseViewTitleUndoPath } : {}),
    ...(baseViewRenamedPath ? { baseViewRenamedPath } : {}),
    ...(baseViewRenameTitle ? { baseViewRenameTitle } : {}),
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
  "  --base-export            Also exercise the .base export command and cleanup.",
  "  --base-view              Also exercise the notidian-table custom Bases view.",
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
