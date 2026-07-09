const { spawn } = require("child_process");

const DEFAULT_FIXTURE_ROOT = "Sandbox/Notidian/Integration Fixtures";
const DEFAULT_PLUGIN_ID = "notidian";
const DEFAULT_TIMEOUT_MS = 10000;
const DEFAULT_COMMAND_TIMEOUT_MS = 20000;
const DEFAULT_POLL_INTERVAL_MS = 250;
const DEFAULT_CLEANUP_SETTLE_MS = 1000;
const DEFAULT_TABLE_UI_EDIT_VALUE = "ui-active";
const DEFAULT_TABLE_UI_PASTE_STATUS = "paste-active";
const DEFAULT_TABLE_UI_PASTE_RATING = "7";
const DEFAULT_TABLE_UI_OPTION_STAGE = "option-review";
const DEFAULT_TABLE_UI_SELECT_EXISTING_STAGE = "todo";
const DEFAULT_TABLE_UI_MULTI_SELECT_STAGE = ["multi-alpha", "multi-beta"];
const DEFAULT_TABLE_UI_TYPE_COLUMN = "stage";
const DEFAULT_TABLE_UI_CONFLICT_EXTERNAL = "conflict-external";
const DEFAULT_TABLE_UI_CONFLICT_APPLIED = "conflict-applied";
const DEFAULT_TABLE_UI_MULTI_PASTE_ALPHA_STATUS = "multi-alpha-status";
const DEFAULT_TABLE_UI_MULTI_PASTE_ALPHA_RATING = "31";
const DEFAULT_TABLE_UI_MULTI_PASTE_BETA_STATUS = "multi-beta-status";
const DEFAULT_TABLE_UI_MULTI_PASTE_BETA_RATING = "47";
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
    includeSchemaAdoption: false,
    includeReconciler: false,
    includeHealthSurfaces: false,
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
    if (arg == "--adopt-schema") {
      config.includeSchemaAdoption = true;
      continue;
    }
    if (arg == "--reconciler") {
      config.includeReconciler = true;
      continue;
    }
    if (arg == "--health") {
      config.includeHealthSurfaces = true;
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
    let exitCloseGraceTimeout = null;
    let settled = false;
    const commandKillGraceMs = Math.min(
      1000,
      Math.max(50, Math.floor(commandTimeoutMs / 2))
    );
    const stdioCloseGraceMs = Math.min(
      100,
      Math.max(10, Math.floor(commandTimeoutMs / 10))
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
      if (exitCloseGraceTimeout) clearTimeout(exitCloseGraceTimeout);
    };
    const finish = (code) => {
      if (settled) return;
      settled = true;
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
      if (settled) return;
      settled = true;
      clearTimers();
      reject(error);
    });
    child.on("exit", (code) => {
      exitCloseGraceTimeout = setTimeout(() => {
        finish(code);
      }, stdioCloseGraceMs);
    });
    child.on("close", (code) => {
      finish(code);
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

const ensureFixtureFolderEvalCode = ({ folder }) =>
  `(async () => {
    const marker = "notidianEnsureFixtureFolder";
    const finish = (payload) => JSON.stringify({ marker, ...payload });
    try {
      const parts = ${JSON.stringify(folder)}.split("/").filter(Boolean);
      let current = "";
      const created = [];
      for (const part of parts) {
        current = current ? current + "/" + part : part;
        if (!app.vault.getAbstractFileByPath(current)) {
          await app.vault.createFolder(current);
          created.push(current);
        }
      }
      return finish({ ok: true, folder: ${JSON.stringify(folder)}, created });
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

const legacyArtifactSnapshotEvalCode = () =>
  `(() => {
    const marker = "notidianLegacyArtifactSnapshot";
    const blocked = (path) => path
      .split("/")
      .filter(Boolean)
      .some((part) => {
        const lower = part.toLowerCase();
        return part === ".trash" || lower.includes("archive") || lower.includes("ignore");
      });
    const stalePaths = Array.from(
      new Set(
        app.vault.getAllLoadedFiles()
          .map((file) => file.path)
          .filter((path) => {
            if (!path || blocked(path)) return false;
            const parts = path.split("/").filter(Boolean);
            return parts.includes(".makemd") || parts.includes(".space") || path.endsWith(".base");
          })
      )
    ).sort();
    return JSON.stringify({
      marker,
      ok: stalePaths.length == 0,
      stalePaths,
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

const tableUiMultiPasteEvalCode = ({
  folder,
  firstRowTitle,
  secondRowTitle,
  firstStatus,
  firstRating,
  secondStatus,
  secondRating,
  firstCurrentStatus,
  firstCurrentRating,
  secondCurrentStatus,
  secondCurrentRating,
  timeoutMs,
  pollIntervalMs,
}) =>
  `(async () => {
    const marker = "notidianTableUiMultiPaste";
    const finish = (payload) => JSON.stringify({ marker, ...payload });
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const folder = ${JSON.stringify(folder)};
    const firstRowTitle = ${JSON.stringify(firstRowTitle)};
    const secondRowTitle = ${JSON.stringify(secondRowTitle)};
    const firstStatus = ${JSON.stringify(firstStatus)};
    const firstRating = ${JSON.stringify(firstRating)};
    const secondStatus = ${JSON.stringify(secondStatus)};
    const secondRating = ${JSON.stringify(secondRating)};
    const firstCurrentStatus = ${JSON.stringify(firstCurrentStatus)};
    const firstCurrentRating = ${JSON.stringify(firstCurrentRating)};
    const secondCurrentStatus = ${JSON.stringify(secondCurrentStatus)};
    const secondCurrentRating = ${JSON.stringify(secondCurrentRating)};
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
      if (!view || !table) {
        return { ok: false, reason: !view ? "missing-view" : "missing-table" };
      }
      const headers = Array.from(table.querySelectorAll("thead th"))
        .map((header) => header.innerText.trim());
      const rows = Array.from(table.querySelectorAll("tbody tr[data-row-id]"));
      const firstRow = rows.find((row) => row.innerText.includes(firstRowTitle));
      const secondRow = rows.find((row) => row.innerText.includes(secondRowTitle));
      if (!firstRow || !secondRow) {
        return {
          ok: false,
          reason: "missing-row",
          rows: rows.map((row) => row.innerText.slice(0, 120)),
          columns: headers.filter(Boolean),
        };
      }
      const visibleRows = Array.from(table.querySelectorAll("tbody tr[data-row-id]"));
      return {
        ok: true,
        table,
        headers,
        firstRow,
        secondRow,
        firstRowIsTop: visibleRows.indexOf(firstRow) < visibleRows.indexOf(secondRow),
      };
    };
    const cellByColumn = (row, headers, columnName) => {
      const columnIndex = headers.findIndex(
        (header) => header.toLowerCase() === columnName.toLowerCase()
      );
      const cell = columnIndex < 0 ? null : row.children[columnIndex];
      return cell
        ? { ok: true, cell, columnIndex }
        : {
            ok: false,
            reason: columnIndex < 0 ? "missing-column" : "missing-cell",
            columnName,
            columnIndex,
            cellCount: row.children.length,
          };
    };
    const selectRange = async (tableState) => {
      const start = cellByColumn(tableState.firstRow, tableState.headers, "status");
      const end = cellByColumn(tableState.secondRow, tableState.headers, "rating");
      if (!start.ok || !end.ok) return { ok: false, ...(start.ok ? end : start) };
      start.cell.dispatchEvent(
        new MouseEvent("mousedown", { bubbles: true, buttons: 1 })
      );
      await sleep(50);
      end.cell.dispatchEvent(
        new MouseEvent("mousedown", {
          bubbles: true,
          buttons: 1,
          shiftKey: true,
        })
      );
      tableState.table.focus();
      await sleep(50);
      return { ok: true };
    };
    const renderedValues = (tableState) => {
      const cells = [
        cellByColumn(tableState.firstRow, tableState.headers, "status"),
        cellByColumn(tableState.firstRow, tableState.headers, "rating"),
        cellByColumn(tableState.secondRow, tableState.headers, "status"),
        cellByColumn(tableState.secondRow, tableState.headers, "rating"),
      ];
      if (cells.some((cell) => !cell.ok)) return null;
      return cells.map((cell) => cell.cell.innerText.trim());
    };
    const waitForPastedValues = async (firstRowIsTop) => {
      const expected = firstRowIsTop
        ? [firstStatus, firstRating, secondStatus, secondRating]
        : [secondStatus, secondRating, firstStatus, firstRating];
      const start = Date.now();
      let latest = null;
      do {
        const tableState = findTable();
        if (!tableState.ok) return tableState;
        latest = renderedValues(tableState);
        if (JSON.stringify(latest) === JSON.stringify(expected)) {
          return { ok: true, editedValues: latest };
        }
        await sleep(pollIntervalMs);
      } while (Date.now() - start <= timeoutMs);
      return { ok: false, reason: "display-not-settled", latest };
    };
    const originalClipboard = navigator.clipboard;
    const originalReadText = originalClipboard?.readText;
    const originalWriteText = originalClipboard?.writeText;
    const clipboardText = [
      [firstStatus, firstRating].join("\\t"),
      [secondStatus, secondRating].join("\\t"),
    ].join("\\n");
    let copiedText = "";
    let replacedClipboard = false;
    const restoreClipboard = () => {
      try {
        if (replacedClipboard) {
          Object.defineProperty(navigator, "clipboard", {
            configurable: true,
            value: originalClipboard,
          });
        } else if (originalClipboard) {
          originalClipboard.readText = originalReadText;
          originalClipboard.writeText = originalWriteText;
        }
      } catch (_error) {}
    };
    try {
      try {
        originalClipboard.readText = async () => clipboardText;
        originalClipboard.writeText = async (text) => {
          copiedText = String(text);
        };
      } catch (_error) {
        replacedClipboard = true;
        Object.defineProperty(navigator, "clipboard", {
          configurable: true,
          value: {
            ...(originalClipboard || {}),
            readText: async () => clipboardText,
            writeText: async (text) => {
              copiedText = String(text);
            },
          },
        });
      }
      const start = Date.now();
      let tableState = null;
      do {
        tableState = findTable();
        if (tableState.ok) break;
        await sleep(pollIntervalMs);
      } while (Date.now() - start <= timeoutMs);
      if (!tableState?.ok) return finish(tableState || { ok: false, reason: "missing-table" });
      const expectedCopiedText = tableState.firstRowIsTop
        ? [
            [firstCurrentStatus, firstCurrentRating].join("\\t"),
            [secondCurrentStatus, secondCurrentRating].join("\\t"),
          ].join("\\n")
        : [
            [secondCurrentStatus, secondCurrentRating].join("\\t"),
            [firstCurrentStatus, firstCurrentRating].join("\\t"),
          ].join("\\n");
      const copiedSelection = await selectRange(tableState);
      if (!copiedSelection.ok) return finish(copiedSelection);
      tableState.table.dispatchEvent(
        new KeyboardEvent("keydown", {
          bubbles: true,
          cancelable: true,
          key: "c",
          code: "KeyC",
          metaKey: true,
        })
      );
      await sleep(100);
      if (copiedText !== expectedCopiedText) {
        return finish({
          ok: false,
          reason: "copy-mismatch",
          copiedText,
          expectedCopiedText,
          firstRowIsTop: tableState.firstRowIsTop,
        });
      }
      const latestTableState = findTable();
      if (!latestTableState.ok) return finish(latestTableState);
      const pastedSelection = await selectRange(latestTableState);
      if (!pastedSelection.ok) return finish(pastedSelection);
      latestTableState.table.dispatchEvent(
        new KeyboardEvent("keydown", {
          bubbles: true,
          cancelable: true,
          key: "v",
          code: "KeyV",
          metaKey: true,
        })
      );
      await sleep(300);
      return finish({
        copiedText,
        firstRowIsTop: latestTableState.firstRowIsTop,
        ...(await waitForPastedValues(latestTableState.firstRowIsTop)),
      });
    } catch (error) {
      return finish({
        ok: false,
        reason: "exception",
        message: String(error?.message ?? error),
      });
    } finally {
      restoreClipboard();
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
    const dispatchUndoShortcut = (table) => {
      const event = new KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        key: "z",
        code: "KeyZ",
        metaKey: true,
      });
      table.focus();
      table.dispatchEvent(event);
      return event.defaultPrevented;
    };
    try {
      const tableState = findTable();
      if (!tableState.ok) return finish(tableState);
      const start = Date.now();
      let last = null;
      let shortcutAccepted = false;
      let lastShortcutAt = 0;
      const shortcutRetryMs = Math.max(250, pollIntervalMs);
      do {
        const nextState = findTable();
        if (!nextState.ok) return finish(nextState);
        if (!shortcutAccepted && Date.now() - lastShortcutAt >= shortcutRetryMs) {
          shortcutAccepted = dispatchUndoShortcut(nextState.table);
          lastShortcutAt = Date.now();
          await sleep(50);
        }
        const status = cellText(nextState, "status");
        if (!status.ok) return finish(status);
        const rating = cellText(nextState, "rating");
        if (!rating.ok) return finish(rating);
        last = { status: status.value, rating: rating.value, shortcutAccepted };
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
    const dispatchRedoShortcut = (table) => {
      const event = new KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        key: "z",
        code: "KeyZ",
        metaKey: true,
        shiftKey: true,
      });
      table.focus();
      table.dispatchEvent(event);
      return event.defaultPrevented;
    };
    try {
      const tableState = findTable();
      if (!tableState.ok) return finish(tableState);
      const start = Date.now();
      let last = null;
      let shortcutAccepted = false;
      let lastShortcutAt = 0;
      const shortcutRetryMs = Math.max(250, pollIntervalMs);
      do {
        const nextState = findTable();
        if (!nextState.ok) return finish(nextState);
        if (!shortcutAccepted && Date.now() - lastShortcutAt >= shortcutRetryMs) {
          shortcutAccepted = dispatchRedoShortcut(nextState.table);
          lastShortcutAt = Date.now();
          await sleep(50);
        }
        const status = cellText(nextState, "status");
        if (!status.ok) return finish(status);
        const rating = cellText(nextState, "rating");
        if (!rating.ok) return finish(rating);
        last = { status: status.value, rating: rating.value, shortcutAccepted };
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
    const waitForOptionColumnReady = async () => {
      const readyStart = Date.now();
      const retryIntervalMs = Math.max(250, pollIntervalMs);
      let lastRetryAt = 0;
      let latest = {
        type: "",
        columnValue: "",
        render: "",
        cellText: "",
      };
      do {
        const updatedTable = await plugin.superstate.spaceManager.readTable(folder, ${JSON.stringify(DEFAULT_CONTEXT_SCHEMA_ID)});
        const updatedColumn = updatedTable.cols.find((column) => column.name == columnName);
        const found = findOptionCell();
        latest = {
          type: String(updatedColumn?.type ?? ""),
          columnValue: String(updatedColumn?.value ?? ""),
          render: found.ok ? "option" : found.reason,
          cellText: found.ok ? found.cell.innerText.trim() : "",
          columns: found.headers?.filter(Boolean) ?? found.columns ?? [],
          cellHtml: found.cellHtml,
        };
        const columnReady =
          updatedColumn?.type == "option" &&
          String(updatedColumn?.value ?? "").includes(currentValue);
        if (
          columnReady &&
          found.ok &&
          found.cell.innerText.includes(currentValue)
        ) {
          return { ok: true, found };
        }
        if (!columnReady && Date.now() - lastRetryAt >= retryIntervalMs) {
          const retry = await ensureOptionColumn();
          if (!retry.ok) return retry;
          lastRetryAt = Date.now();
        }
        await sleep(pollIntervalMs);
      } while (Date.now() - readyStart <= timeoutMs);
      return {
        ok: false,
        reason: "option-column-not-ready",
        latest,
      };
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
      const ready = await waitForOptionColumnReady();
      if (!ready.ok) return finish(ready);
      const found = ready.found;
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
	      let latest = {
	        editedValue: "",
	        optionSaved: false,
	        columnValue: "",
	      };
	      do {
	        const nextFound = findOptionCell();
	        if (!nextFound.ok) return finish(nextFound);
	        latest.editedValue = nextFound.cell.innerText.trim();
	        if (latest.editedValue == newValue) {
	          const updatedTable = await plugin.superstate.spaceManager.readTable(folder, ${JSON.stringify(DEFAULT_CONTEXT_SCHEMA_ID)});
	          const updatedColumn = updatedTable.cols.find((column) => column.name == columnName);
	          latest.optionSaved = String(updatedColumn?.value ?? "").includes(newValue);
	          latest.columnValue = String(updatedColumn?.value ?? "");
	          if (latest.optionSaved) {
	            return finish({
	              ok: true,
	              editedValue: latest.editedValue,
	              optionSaved: true,
	            });
	          }
	        }
	        await sleep(pollIntervalMs);
	      } while (Date.now() - settleStart <= timeoutMs);
	      return finish({
	        ok: false,
	        reason: latest.editedValue == newValue
	          ? "option-config-not-settled"
	          : "display-not-settled",
	        ...latest,
	      });
    } catch (error) {
      return finish({
        ok: false,
        reason: "exception",
        message: String(error?.message ?? error),
      });
    }
  })()`.replace(/\s+/g, " ");

const tableUiMultiSelectEvalCode = ({
  pluginId,
  folder,
  rowTitle,
  rowPath,
  columnName,
  values,
  timeoutMs,
  pollIntervalMs,
}) =>
  `(async () => {
    const marker = "notidianTableUiMultiSelect";
    const finish = (payload) => JSON.stringify({ marker, ...payload });
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const plugin = app.plugins.plugins[${JSON.stringify(pluginId)}];
    const folder = ${JSON.stringify(folder)};
    const rowTitle = ${JSON.stringify(rowTitle)};
    const rowPath = ${JSON.stringify(rowPath)};
    const columnName = ${JSON.stringify(columnName)};
    const values = ${JSON.stringify(values)};
    const timeoutMs = ${Number(timeoutMs)};
    const pollIntervalMs = Math.max(1, ${Number(pollIntervalMs)});
    const clickElement = (element) => {
      element.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0, buttons: 1, view: window }));
      element.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, button: 0, view: window }));
      element.dispatchEvent(new MouseEvent("click", { bubbles: true, button: 0, view: window }));
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
    const readMetadataValues = () => {
      const file = app.vault.getAbstractFileByPath(rowPath);
      if (!file) return [];
      const rawValue = app.metadataCache.getFileCache(file)?.frontmatter?.[columnName];
      if (rawValue == null) return [];
      if (Array.isArray(rawValue)) return rawValue.map((value) => String(value));
      if (typeof rawValue == "string") {
        try {
          const parsed = JSON.parse(rawValue);
          if (Array.isArray(parsed)) return parsed.map((value) => String(value));
        } catch (_) {}
        return rawValue.length > 0 ? [rawValue] : [];
      }
      return [String(rawValue)];
    };
    const ensureMultiSelectColumn = async () => {
      if (!plugin?.superstate?.spaceManager) {
        return { ok: false, reason: "missing-plugin" };
      }
      const table = await plugin.superstate.spaceManager.readTable(folder, ${JSON.stringify(DEFAULT_CONTEXT_SCHEMA_ID)});
      const existing = table.cols.find((column) => column.name == columnName);
      const options = values.map((value) => ({
        name: value,
        value,
      }));
      const nextColumn = {
        ...(existing || {}),
        name: columnName,
        schemaId: ${JSON.stringify(DEFAULT_CONTEXT_SCHEMA_ID)},
        type: "option-multi",
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
      const file = app.vault.getAbstractFileByPath(rowPath);
      if (!file) return { ok: false, reason: "missing-row-file", rowPath };
      await app.fileManager.processFrontMatter(file, (frontmatter) => {
        frontmatter[columnName] = [];
      });
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
      const optionCell = cell?.querySelector(".mk-cell-option");
      if (!optionCell) {
        return {
          ok: false,
          reason: "missing-option-cell",
          columns: headers.filter(Boolean),
          cellHtml: cell?.outerHTML.slice(0, 500),
        };
      }
      return { ok: true, table, cell, optionCell, headers };
    };
    const selectValue = async (value) => {
      let menu = Array.from(document.querySelectorAll(".mk-menu")).at(-1);
      if (!menu?.querySelector(".mk-menu-search-input")) {
        const found = findOptionCell();
        if (!found.ok) return found;
        const addButton = found.cell.querySelector(".mk-cell-option-new");
        if (!addButton) {
          return { ok: false, reason: "missing-multi-select-add-button", cellHtml: found.cell.outerHTML.slice(0, 500) };
        }
        clickElement(addButton);
        await sleep(250);
        menu = Array.from(document.querySelectorAll(".mk-menu")).at(-1);
      }
      if (!menu) return { ok: false, reason: "missing-multi-select-menu" };
      const input = menu.querySelector(".mk-menu-search-input");
      if (!input) {
        return { ok: false, reason: "missing-multi-select-menu-input", menuText: menu.innerText.slice(0, 500) };
      }
      input.focus();
      setInputValue(input, value);
      await sleep(250);
      const option = Array.from(menu.querySelectorAll(".mk-menu-option"))
        .find((item) => item.innerText.split("\\n").map((part) => part.trim()).includes(value));
      if (!option) {
        return { ok: false, reason: "missing-multi-select-option", value, menuText: menu.innerText.slice(0, 500) };
      }
      clickElement(option);
      await sleep(350);
      return { ok: true };
    };
    try {
      const setup = await ensureMultiSelectColumn();
      if (!setup.ok) return finish(setup);
      const renderStart = Date.now();
      let found = null;
      do {
        found = findOptionCell();
        if (found.ok && found.cell.querySelector(".mk-cell-option-new") && readMetadataValues().length == 0) break;
        await sleep(pollIntervalMs);
      } while (Date.now() - renderStart <= timeoutMs);
      if (!found?.ok) return finish(found || { ok: false, reason: "missing-option-cell" });
      for (const value of values) {
        const selected = await selectValue(value);
        if (!selected.ok) return finish(selected);
      }
      const settleStart = Date.now();
      let latest = null;
      do {
        const updatedTable = await plugin.superstate.spaceManager.readTable(folder, ${JSON.stringify(DEFAULT_CONTEXT_SCHEMA_ID)});
        const updatedColumn = updatedTable.cols.find((column) => column.name == columnName);
        const nextFound = findOptionCell();
        if (!nextFound.ok) return finish(nextFound);
        const editedValues = readMetadataValues();
        latest = {
          editedValues,
          type: updatedColumn?.type,
          cellText: nextFound.cell.innerText.trim(),
        };
        if (
          latest.type == "option-multi" &&
          values.every((value) => editedValues.includes(value)) &&
          values.every((value) => latest.cellText.includes(value))
        ) {
          return finish({ ok: true, editedValues, type: latest.type });
        }
        await sleep(pollIntervalMs);
      } while (Date.now() - settleStart <= timeoutMs);
      return finish({ ok: false, reason: "multi-select-not-settled", latest });
    } catch (error) {
      return finish({
        ok: false,
        reason: "exception",
        message: String(error?.message ?? error),
      });
    }
  })()`.replace(/\s+/g, " ");

const tableUiSelectExistingOptionEvalCode = ({
  pluginId,
  folder,
  rowTitle,
  rowPath,
  columnName,
  currentValue,
  targetValue,
  timeoutMs,
  pollIntervalMs,
}) =>
  `(async () => {
    const marker = "notidianTableUiSelectExistingOption";
    const finish = (payload) => JSON.stringify({ marker, ...payload });
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const plugin = app.plugins.plugins[${JSON.stringify(pluginId)}];
    const folder = ${JSON.stringify(folder)};
    const rowTitle = ${JSON.stringify(rowTitle)};
    const rowPath = ${JSON.stringify(rowPath)};
    const columnName = ${JSON.stringify(columnName)};
    const currentValue = ${JSON.stringify(currentValue)};
    const targetValue = ${JSON.stringify(targetValue)};
    const timeoutMs = ${Number(timeoutMs)};
    const pollIntervalMs = Math.max(1, ${Number(pollIntervalMs)});
    const clickElement = (element) => {
      element.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0, buttons: 1, view: window }));
      element.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, button: 0, view: window }));
      element.dispatchEvent(new MouseEvent("click", { bubbles: true, button: 0, view: window }));
    };
    const readMetadataValue = () => {
      const file = app.vault.getAbstractFileByPath(rowPath);
      if (!file) return "";
      const rawValue = app.metadataCache.getFileCache(file)?.frontmatter?.[columnName];
      if (rawValue == null) return "";
      return Array.isArray(rawValue) ? rawValue.join(",") : String(rawValue);
    };
    const ensureSelectColumn = async () => {
      if (!plugin?.superstate?.spaceManager) {
        return { ok: false, reason: "missing-plugin" };
      }
      const table = await plugin.superstate.spaceManager.readTable(folder, ${JSON.stringify(DEFAULT_CONTEXT_SCHEMA_ID)});
      const existing = table.cols.find((column) => column.name == columnName);
      const options = [currentValue, targetValue].map((value) => ({
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
      const file = app.vault.getAbstractFileByPath(rowPath);
      if (!file) return { ok: false, reason: "missing-row-file", rowPath };
      await app.fileManager.processFrontMatter(file, (frontmatter) => {
        frontmatter[columnName] = currentValue;
      });
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
      const optionCell = cell?.querySelector(".mk-cell-option");
      if (!optionCell) {
        return {
          ok: false,
          reason: "missing-option-cell",
          columns: headers.filter(Boolean),
          cellHtml: cell?.outerHTML.slice(0, 500),
        };
      }
      return { ok: true, table, cell, optionCell, headers };
    };
    try {
      if (!plugin?.superstate?.spaceManager) {
        return finish({ ok: false, reason: "missing-plugin" });
      }
      const table = await plugin.superstate.spaceManager.readTable(folder, ${JSON.stringify(DEFAULT_CONTEXT_SCHEMA_ID)});
      const column = table.cols.find((column) => column.name == columnName);
      const columnValue = String(column?.value ?? "");
      if (!columnValue.includes(currentValue) || !columnValue.includes(targetValue)) {
        return finish({
          ok: false,
          reason: "select-option-config-missing",
          columnValue,
        });
      }
      const renderStart = Date.now();
      let found = null;
      do {
        found = findOptionCell();
        if (
          found.ok &&
          found.cell.innerText.includes(currentValue) &&
          readMetadataValue() == currentValue
        ) {
          break;
        }
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
      clickElement(optionChip);
      await sleep(250);
      const menu = Array.from(document.querySelectorAll(".mk-menu")).at(-1);
      if (!menu) {
        return finish({
          ok: false,
          reason: "missing-select-menu-after-chip-click",
          columns: found.headers.filter(Boolean),
          cellHtml: found.cell.outerHTML.slice(0, 500),
        });
      }
      const option = Array.from(menu.querySelectorAll(".mk-menu-option"))
        .find((item) => item.innerText.split("\\n").map((part) => part.trim()).includes(targetValue));
      if (!option) {
        return finish({
          ok: false,
          reason: "missing-existing-select-option",
          menuText: menu.innerText.slice(0, 500),
        });
      }
      clickElement(option);
      const settleStart = Date.now();
      let latest = null;
      do {
        const nextFound = findOptionCell();
        if (!nextFound.ok) return finish(nextFound);
        latest = {
          editedValue: readMetadataValue(),
          cellText: nextFound.cell.innerText.trim(),
        };
        if (
          latest.editedValue == targetValue &&
          latest.cellText.includes(targetValue)
        ) {
          return finish({ ok: true, editedValue: latest.editedValue });
        }
        await sleep(pollIntervalMs);
      } while (Date.now() - settleStart <= timeoutMs);
      return finish({ ok: false, reason: "select-existing-not-settled", latest });
    } catch (error) {
      return finish({
        ok: false,
        reason: "exception",
        message: String(error?.message ?? error),
      });
    }
  })()`.replace(/\s+/g, " ");

const tableUiSelectEmptyExistingOptionEvalCode = ({
  folder,
  rowTitle,
  rowPath,
  columnName,
  currentValue,
  targetValue,
  timeoutMs,
  pollIntervalMs,
}) =>
  `(async () => {
    const marker = "notidianTableUiSelectEmptyExistingOption";
    const finish = (payload) => JSON.stringify({ marker, ...payload });
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const folder = ${JSON.stringify(folder)};
    const rowTitle = ${JSON.stringify(rowTitle)};
    const rowPath = ${JSON.stringify(rowPath)};
    const columnName = ${JSON.stringify(columnName)};
    const currentValue = ${JSON.stringify(currentValue)};
    const targetValue = ${JSON.stringify(targetValue)};
    const timeoutMs = ${Number(timeoutMs)};
    const pollIntervalMs = Math.max(1, ${Number(pollIntervalMs)});
    const clickElement = (element) => {
      element.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0, buttons: 1, view: window }));
      element.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, button: 0, view: window }));
      element.dispatchEvent(new MouseEvent("click", { bubbles: true, button: 0, view: window }));
    };
    const readMetadataValue = () => {
      const file = app.vault.getAbstractFileByPath(rowPath);
      if (!file) return "";
      const rawValue = app.metadataCache.getFileCache(file)?.frontmatter?.[columnName];
      if (rawValue == null) return "";
      return Array.isArray(rawValue) ? rawValue.join(",") : String(rawValue);
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
      const optionCell = cell?.querySelector(".mk-cell-option");
      if (!optionCell) {
        return {
          ok: false,
          reason: "missing-option-cell",
          columns: headers.filter(Boolean),
          cellHtml: cell?.outerHTML.slice(0, 500),
        };
      }
      return { ok: true, table, cell, optionCell, headers };
    };
    const openMenu = async () => {
      const found = findOptionCell();
      if (!found.ok) return found;
      const optionChip = found.cell.querySelector(".mk-cell-option-item");
      if (!optionChip) {
        return {
          ok: false,
          reason: "missing-option-chip",
          columns: found.headers.filter(Boolean),
          cellHtml: found.cell.outerHTML.slice(0, 500),
        };
      }
      clickElement(optionChip);
      await sleep(250);
      const menu = Array.from(document.querySelectorAll(".mk-menu")).at(-1);
      if (!menu) {
        return {
          ok: false,
          reason: "missing-select-menu-after-chip-click",
          columns: found.headers.filter(Boolean),
          cellHtml: found.cell.outerHTML.slice(0, 500),
        };
      }
      return { ok: true, menu, found };
    };
    const clickMenuOption = (menu, value) => {
      const options = Array.from(menu.querySelectorAll(".mk-menu-option"));
      return options.find((item) =>
        item.innerText.split("\\n").map((part) => part.trim()).includes(value)
      );
    };
    try {
      const firstMenu = await openMenu();
      if (!firstMenu.ok) return finish(firstMenu);
      const noneOption = Array.from(firstMenu.menu.querySelectorAll(".mk-menu-option"))[0];
      if (!noneOption) {
        return finish({
          ok: false,
          reason: "missing-select-none-option",
          menuText: firstMenu.menu.innerText.slice(0, 500),
        });
      }
      clickElement(noneOption);
      const clearStart = Date.now();
      let latest = null;
      do {
        const found = findOptionCell();
        if (!found.ok) return finish(found);
        latest = {
          editedValue: readMetadataValue(),
          cellText: found.cell.innerText.trim(),
        };
        if (latest.editedValue == "" && !latest.cellText.includes(currentValue)) break;
        await sleep(pollIntervalMs);
      } while (Date.now() - clearStart <= timeoutMs);
      if (!latest || latest.editedValue != "") {
        return finish({ ok: false, reason: "select-clear-not-settled", latest });
      }
      const secondMenu = await openMenu();
      if (!secondMenu.ok) return finish(secondMenu);
      const targetOption = clickMenuOption(secondMenu.menu, targetValue);
      if (!targetOption) {
        return finish({
          ok: false,
          reason: "missing-empty-select-existing-option",
          menuText: secondMenu.menu.innerText.slice(0, 500),
        });
      }
      clickElement(targetOption);
      const settleStart = Date.now();
      do {
        const found = findOptionCell();
        if (!found.ok) return finish(found);
        latest = {
          editedValue: readMetadataValue(),
          cellText: found.cell.innerText.trim(),
        };
        if (
          latest.editedValue == targetValue &&
          latest.cellText.includes(targetValue)
        ) {
          return finish({ ok: true, editedValue: latest.editedValue });
        }
        await sleep(pollIntervalMs);
      } while (Date.now() - settleStart <= timeoutMs);
      return finish({ ok: false, reason: "empty-select-existing-not-settled", latest });
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
      { label: "Select", type: "option", className: "mk-cell-option" },
      { label: "Multi-select", type: "option-multi", className: "mk-cell-option" },
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
	      if (typeMenuText.split("\\n").map((item) => item.trim()).includes("Option")) {
	        return { ok: false, reason: "frontmatter-menu-still-shows-option-label", typeMenuText };
	      }
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
    result?.columnValue !== undefined
      ? `columnValue=${String(result.columnValue).slice(0, 400)}`
      : "",
    result?.editedValue !== undefined ? `editedValue=${result.editedValue}` : "",
    result?.latest ? `latest=${JSON.stringify(result.latest).slice(0, 500)}` : "",
    result?.menuText ? `menuText=${String(result.menuText).slice(0, 500)}` : "",
    result?.cellHtml ? `cellHtml=${String(result.cellHtml).slice(0, 300)}` : "",
    result?.debug ? `debug=${JSON.stringify(result.debug).slice(0, 600)}` : "",
    result?.pasteDebug
      ? `pasteDebug=${JSON.stringify(result.pasteDebug).slice(0, 400)}`
      : "",
    result?.copiedText !== undefined
      ? `copiedText=${String(result.copiedText).slice(0, 400)}`
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

const assertNoLegacyArtifacts = async ({ config, runner, label }) => {
  const result = parseJsonEvalResult(
    await runObsidian(config, runner, "eval", {
      code: legacyArtifactSnapshotEvalCode(),
    })
  );

  if (result?.ok) return result;

  const stalePaths = Array.isArray(result?.stalePaths)
    ? result.stalePaths.join(", ")
    : formatUiFailure(result);
  throw new Error(
    `Notidian legacy artifact guard failed after ${label}: ${stalePaths}`
  );
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
  let alphaStatusAfterMultiPaste = "active";
  let alphaRatingAfterMultiPaste = "1";

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

  const multiPasteResult = parseJsonEvalResult(
    await runObsidian(config, runner, "eval", {
      code: tableUiMultiPasteEvalCode({
        folder: paths.folder,
        firstRowTitle: `${paths.runId}-Alpha Renamed`,
        secondRowTitle: `${paths.runId}-Beta`,
        firstStatus: DEFAULT_TABLE_UI_MULTI_PASTE_ALPHA_STATUS,
        firstRating: DEFAULT_TABLE_UI_MULTI_PASTE_ALPHA_RATING,
        secondStatus: DEFAULT_TABLE_UI_MULTI_PASTE_BETA_STATUS,
        secondRating: DEFAULT_TABLE_UI_MULTI_PASTE_BETA_RATING,
        firstCurrentStatus: "active",
        firstCurrentRating: "1",
        secondCurrentStatus: DEFAULT_TABLE_UI_PASTE_STATUS,
        secondCurrentRating: DEFAULT_TABLE_UI_PASTE_RATING,
        timeoutMs: config.timeoutMs,
        pollIntervalMs: config.pollIntervalMs,
      }),
    })
  );
  assertUiEvalOk("multi-row copy/paste", multiPasteResult);
  if (typeof multiPasteResult.firstRowIsTop != "boolean") {
    throw new Error(
      "Notidian table UI multi-row copy/paste failed: row order was not reported."
    );
  }
  const expectedAlpha = multiPasteResult.firstRowIsTop
    ? {
        status: DEFAULT_TABLE_UI_MULTI_PASTE_ALPHA_STATUS,
        rating: DEFAULT_TABLE_UI_MULTI_PASTE_ALPHA_RATING,
      }
    : {
        status: DEFAULT_TABLE_UI_MULTI_PASTE_BETA_STATUS,
        rating: DEFAULT_TABLE_UI_MULTI_PASTE_BETA_RATING,
      };
  const expectedBeta = multiPasteResult.firstRowIsTop
    ? {
        status: DEFAULT_TABLE_UI_MULTI_PASTE_BETA_STATUS,
        rating: DEFAULT_TABLE_UI_MULTI_PASTE_BETA_RATING,
      }
    : {
        status: DEFAULT_TABLE_UI_MULTI_PASTE_ALPHA_STATUS,
        rating: DEFAULT_TABLE_UI_MULTI_PASTE_ALPHA_RATING,
      };
  alphaStatusAfterMultiPaste = expectedAlpha.status;
  alphaRatingAfterMultiPaste = expectedAlpha.rating;

  await waitForMetadataValue({
    config,
    runner,
    path: paths.alphaRenamedPath,
    property: "status",
    expected: expectedAlpha.status,
  });
  await waitForMetadataValue({
    config,
    runner,
    path: paths.alphaRenamedPath,
    property: "rating",
    expected: expectedAlpha.rating,
  });
  await waitForMetadataValue({
    config,
    runner,
    path: paths.betaPath,
    property: "status",
    expected: expectedBeta.status,
  });
  await waitForMetadataValue({
    config,
    runner,
    path: paths.betaPath,
    property: "rating",
    expected: expectedBeta.rating,
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

  const selectExistingResult = parseJsonEvalResult(
    await runObsidian(config, runner, "eval", {
      code: tableUiSelectExistingOptionEvalCode({
        pluginId: config.pluginId,
        folder: paths.folder,
        rowTitle: `${paths.runId}-Beta`,
        rowPath: paths.betaPath,
        columnName: "stage",
        currentValue: DEFAULT_TABLE_UI_OPTION_STAGE,
        targetValue: DEFAULT_TABLE_UI_SELECT_EXISTING_STAGE,
        timeoutMs: config.timeoutMs,
        pollIntervalMs: config.pollIntervalMs,
      }),
    })
  );
  assertUiEvalOk("select existing option", selectExistingResult);

  if (selectExistingResult.editedValue != DEFAULT_TABLE_UI_SELECT_EXISTING_STAGE) {
    throw new Error(
      `Notidian table UI select existing option failed: expected editedValue=${DEFAULT_TABLE_UI_SELECT_EXISTING_STAGE}; got ${selectExistingResult.editedValue}`
    );
  }

  await waitForMetadataValue({
    config,
    runner,
    path: paths.betaPath,
    property: "stage",
    expected: DEFAULT_TABLE_UI_SELECT_EXISTING_STAGE,
  });

  const selectEmptyExistingResult = parseJsonEvalResult(
    await runObsidian(config, runner, "eval", {
      code: tableUiSelectEmptyExistingOptionEvalCode({
        folder: paths.folder,
        rowTitle: `${paths.runId}-Beta`,
        rowPath: paths.betaPath,
        columnName: "stage",
        currentValue: DEFAULT_TABLE_UI_SELECT_EXISTING_STAGE,
        targetValue: DEFAULT_TABLE_UI_OPTION_STAGE,
        timeoutMs: config.timeoutMs,
        pollIntervalMs: config.pollIntervalMs,
      }),
    })
  );
  assertUiEvalOk("empty select existing option", selectEmptyExistingResult);

  if (selectEmptyExistingResult.editedValue != DEFAULT_TABLE_UI_OPTION_STAGE) {
    throw new Error(
      `Notidian table UI empty select existing option failed: expected editedValue=${DEFAULT_TABLE_UI_OPTION_STAGE}; got ${selectEmptyExistingResult.editedValue}`
    );
  }

  await waitForMetadataValue({
    config,
    runner,
    path: paths.betaPath,
    property: "stage",
    expected: DEFAULT_TABLE_UI_OPTION_STAGE,
  });

  const multiSelectResult = parseJsonEvalResult(
    await runObsidian(config, runner, "eval", {
      code: tableUiMultiSelectEvalCode({
        pluginId: config.pluginId,
        folder: paths.folder,
        rowTitle: `${paths.runId}-Beta`,
        rowPath: paths.betaPath,
        columnName: "stage",
        values: DEFAULT_TABLE_UI_MULTI_SELECT_STAGE,
        timeoutMs: config.timeoutMs,
        pollIntervalMs: config.pollIntervalMs,
      }),
    })
  );
  assertUiEvalOk("multi-select", multiSelectResult);

  if (
    JSON.stringify(multiSelectResult.editedValues) !=
    JSON.stringify(DEFAULT_TABLE_UI_MULTI_SELECT_STAGE)
  ) {
    throw new Error(
      `Notidian table UI multi-select failed: expected editedValues=${JSON.stringify(
        DEFAULT_TABLE_UI_MULTI_SELECT_STAGE
      )}; got ${JSON.stringify(multiSelectResult.editedValues)}`
    );
  }
  if (multiSelectResult.type != "option-multi") {
    throw new Error(
      `Notidian table UI multi-select failed: expected type=option-multi; got ${multiSelectResult.type}`
    );
  }

  await waitForMetadataValue({
    config,
    runner,
    path: paths.betaPath,
    property: "stage",
    expected: JSON.stringify(DEFAULT_TABLE_UI_MULTI_SELECT_STAGE),
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
    expected: alphaStatusAfterMultiPaste,
  });

  return {
    primaryPath,
  };
};

// ---------------------------------------------------------------------------
// Schema adoption scenario (Notidian-loan.3, ADR-0056 D9): a live, DOM-driven
// smoke of "Adopt schema for this database" — draft a v3 Type Profile from a
// fixture database's live rows (a bounded-cardinality `sensor_class` field and
// a `board_id` field whose values overlap a sibling "Board Registry" fixture),
// confirm through the preview modal, and assert the hub note is UNCHANGED
// before confirm and correctly profiled (enum + FK reference) after. Gated
// behind its own --adopt-schema flag (config.includeSchemaAdoption) rather
// than folded into the existing --ui table smoke, so it does not perturb that
// scenario's already-pinned eval-call sequence; it is otherwise the same
// class of interaction (a real DOM click on a confirm-gated modal) as every
// other --ui scenario in this file.
// ---------------------------------------------------------------------------

const SCHEMA_ADOPTION_SENSOR_ROWS = [
  { id: "sn-001", sensorClass: "temperature", boardId: "board-1" },
  { id: "sn-002", sensorClass: "humidity", boardId: "board-1" },
  { id: "sn-003", sensorClass: "temperature", boardId: "board-2" },
  { id: "sn-004", sensorClass: "pressure", boardId: "board-2" },
  // Deliberately no board_id: exercises the FK candidate's partial-coverage
  // path (2 of 2 distinct board_id values still match, out of 5 rows total).
  { id: "sn-005", sensorClass: "temperature", boardId: null },
];
const SCHEMA_ADOPTION_BOARD_IDS = ["board-1", "board-2"];
const SCHEMA_ADOPTION_ENUM_VALUES = ["temperature", "humidity", "pressure"];
// Obsidian's `command` CLI verb (and app.commands.executeCommandById) needs
// the plugin-namespaced form ("<pluginId>:<id>"), not the bare id passed to
// plugin.addCommand — confirmed live via `obsidian commands filter=notidian`.
const SCHEMA_ADOPTION_COMMAND_ID = "notidian-adopt-schema";

const schemaAdoptionSensorContent = ({ id, sensorClass, boardId }) =>
  [
    "---",
    `sensor_id: ${id}`,
    `sensor_class: ${sensorClass}`,
    ...(boardId ? [`board_id: ${boardId}`] : []),
    "---",
    `# ${id}`,
    "",
  ].join("\n");

const schemaAdoptionBoardContent = (boardId) =>
  ["---", `board_id: ${boardId}`, "---", `# ${boardId}`, ""].join("\n");

// Reloads both fixture folders' live context (same reload pair
// tableViewSetupEvalCode already uses) and reports back the sensor
// registry's CURRENT hub-note path, resolved the same way
// metadataPathForSpace does in-app (settings.enableFolderNote picks
// notePath vs defPath) — resolved live from the running vault's actual
// settings rather than assumed, since folder-note placement (inside vs.
// adjacent) and naming are both configurable.
//
// Each row file's OWN "which space does this belong to" membership
// (spacesMap, keyed off reloadPath) is a SEPARATE async pipeline from
// Obsidian's native metadata cache (which waitForMetadataValue already
// confirmed settled) — a folder's contextsIndex.paths is read straight off
// spacesMap.getInverse(folder) (buildContextPayload,
// core/superstate/workers/indexer/indexer.ts), so it can still be empty even
// after metadata has settled. This forces each row's own reload (the same
// call plugin.superstate.onPathCreated already makes) before reloading the
// folder's space/context, and polls until BOTH folders report the expected
// row count.
//
// NOTE: this function's returned template literal is whitespace-collapsed
// (`.replace(/\s+/g, " ")`, matching every other *EvalCode helper in this
// file) before being sent to Obsidian — a `//` line comment INSIDE that
// template would swallow every line after it once collapsed to one line, so
// all explanatory comments for the generated code live HERE, outside the
// template, never inside it.
const schemaAdoptionContextSetupEvalCode = ({
  pluginId,
  sensorFolder,
  boardFolder,
  rowPaths,
  expectedSensorPaths,
  expectedBoardPaths,
  timeoutMs,
  pollIntervalMs,
}) =>
  `(async () => {
    const marker = "notidianSchemaAdoptionSetup";
    const finish = (payload) => JSON.stringify({ marker, ...payload });
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const timeoutMs = ${Number(timeoutMs)};
    const pollIntervalMs = Math.max(1, ${Number(pollIntervalMs)});
    try {
      const plugin = app.plugins.plugins[${JSON.stringify(pluginId)}];
      if (!plugin?.superstate?.spaceManager) {
        return finish({ ok: false, reason: "missing-plugin" });
      }
      const sensorFolder = ${JSON.stringify(sensorFolder)};
      const boardFolder = ${JSON.stringify(boardFolder)};
      const rowPaths = ${JSON.stringify(rowPaths)};
      const expectedSensorPaths = ${Number(expectedSensorPaths)};
      const expectedBoardPaths = ${Number(expectedBoardPaths)};
      const start = Date.now();
      let sensorCtx = null;
      let boardCtx = null;
      do {
        for (const rowPath of rowPaths) {
          await plugin.superstate.reloadPath(rowPath, true);
        }
        for (const folder of [sensorFolder, boardFolder]) {
          await plugin.superstate.reloadSpace(
            plugin.superstate.spaceManager.spaceInfoForPath(folder),
            null,
            true
          );
          await plugin.superstate.reloadContextByPath(folder, {
            force: true,
            calculate: true,
          });
        }
        sensorCtx = plugin.superstate.contextsIndex.get(sensorFolder);
        boardCtx = plugin.superstate.contextsIndex.get(boardFolder);
        const sensorCount = new Set(sensorCtx?.paths ?? []).size;
        const boardCount = new Set(boardCtx?.paths ?? []).size;
        if (sensorCount >= expectedSensorPaths && boardCount >= expectedBoardPaths) {
          break;
        }
        await sleep(pollIntervalMs);
      } while (Date.now() - start <= timeoutMs);

      const sensorSpace = plugin.superstate.spacesIndex.get(sensorFolder)?.space;
      if (!sensorSpace) {
        return finish({ ok: false, reason: "missing-sensor-space" });
      }
      const sensorPathCount = new Set(sensorCtx?.paths ?? []).size;
      const boardPathCount = new Set(boardCtx?.paths ?? []).size;
      if (sensorPathCount < expectedSensorPaths) {
        return finish({
          ok: false,
          reason: "sensor-context-not-settled",
          sensorPathCount,
        });
      }
      if (boardPathCount < expectedBoardPaths) {
        return finish({
          ok: false,
          reason: "board-context-not-settled",
          boardPathCount,
        });
      }
      const enableFolderNote = !!plugin.superstate.settings.enableFolderNote;
      const hubPath = enableFolderNote ? sensorSpace.notePath : sensorSpace.defPath;
      return finish({ ok: true, hubPath, enableFolderNote });
    } catch (error) {
      return finish({
        ok: false,
        reason: "exception",
        message: String(error?.message ?? error),
      });
    }
  })()`.replace(/\s+/g, " ");

// The full parsed frontmatter object for a path (not just one property, per
// metadataEvalCode) — needed to inspect the adopted profile's nested
// `fields.<name>.enum`/`.reference` shape, not just a single scalar.
const frontmatterSnapshotEvalCode = (path) =>
  `(() => {
    const file = app.vault.getAbstractFileByPath(${JSON.stringify(path)});
    if (!file) return JSON.stringify({});
    const cache = app.metadataCache.getFileCache(file);
    return JSON.stringify(cache?.frontmatter ?? {});
  })()`.replace(/\s+/g, " ");

// Polls for the confirm-gated preview modal (TypeProfileAdoptionModal, mounted
// under .mk-modal-wrapper per adapters/obsidian/ui/modal.tsx's portal), then
// clicks its "Adopt N field(s)" button — the ONLY DOM action in this scenario
// that can cause a write. Returns the modal's rendered text so the caller can
// assert the drafted enum/FK candidates were actually shown before confirming.
const schemaAdoptionModalConfirmEvalCode = ({ timeoutMs, pollIntervalMs }) =>
  `(async () => {
    const marker = "notidianSchemaAdoptionModal";
    const finish = (payload) => JSON.stringify({ marker, ...payload });
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const timeoutMs = ${Number(timeoutMs)};
    const pollIntervalMs = Math.max(1, ${Number(pollIntervalMs)});
    const findModal = () =>
      document.querySelector(".mk-modal-wrapper .mk-type-profile-adoption");
    try {
      const start = Date.now();
      let modalEl = null;
      do {
        modalEl = findModal();
        if (modalEl) break;
        await sleep(pollIntervalMs);
      } while (Date.now() - start <= timeoutMs);
      if (!modalEl) {
        return finish({ ok: false, reason: "missing-modal" });
      }
      const modalText = (modalEl.innerText || modalEl.textContent || "").slice(
        0,
        2000
      );
      const confirmButton = Array.from(
        modalEl.querySelectorAll("button")
      ).find((button) => (button.textContent || "").includes("Adopt"));
      if (!confirmButton) {
        return finish({ ok: false, reason: "missing-confirm-button", modalText });
      }
      confirmButton.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true })
      );
      const closeStart = Date.now();
      let closed = false;
      do {
        if (!findModal()) {
          closed = true;
          break;
        }
        await sleep(pollIntervalMs);
      } while (Date.now() - closeStart <= timeoutMs);
      return finish({ ok: true, modalText, closed });
    } catch (error) {
      return finish({
        ok: false,
        reason: "exception",
        message: String(error?.message ?? error),
      });
    }
  })()`.replace(/\s+/g, " ");

// Deletes the fixture FOLDER and -- because the folder-note convention can
// place a space's hub note ADJACENT to its folder (a sibling `<Folder>.md`
// that a recursive folder delete never touches) -- the resolved folder-note
// path too, so no stray hub note is left in Sandbox after a run. Callers pass
// the SAME `notePath` the harness already resolved and wrote the hub note to
// (reconcilerHubPathEvalCode -> `space.notePath`), which honors the running
// vault's live inside-vs-adjacent placement setting instead of assuming a
// fixed location. When the note lives INSIDE the folder it was already removed
// with it and the second delete is a null-guarded no-op, so passing
// `folderNote` is always safe. `folderNote` is optional: a scenario that
// failed before resolving its hub path passes `null` and only the folder is
// removed.
//
// NOTE (same whitespace-collapse caveat every *EvalCode helper here carries):
// the returned template is `.replace(/\s+/g, " ")`-flattened before Obsidian
// runs it, so a `//` line comment INSIDE the template would swallow the rest
// of the program once collapsed -- all commentary stays out here.
const deleteFolderEvalCode = ({ folder, folderNote = null }) =>
  `(async () => {
    const marker = "notidianDeleteFolder";
    const finish = (payload) => JSON.stringify({ marker, ...payload });
    const deletePath = async (path) => {
      if (!path) return false;
      const file = app.vault.getAbstractFileByPath(path);
      if (!file) return false;
      await app.vault.delete(file, true);
      return true;
    };
    try {
      const folderDeleted = await deletePath(${JSON.stringify(folder)});
      const folderNoteDeleted = await deletePath(${JSON.stringify(folderNote)});
      if (!folderDeleted && !folderNoteDeleted) {
        return finish({ ok: true, reason: "already-absent" });
      }
      return finish({ ok: true, folderNoteDeleted });
    } catch (error) {
      return finish({
        ok: false,
        reason: "exception",
        message: String(error?.message ?? error),
      });
    }
  })()`.replace(/\s+/g, " ");

const runSchemaAdoptionScenario = async ({ config, runner, runId }) => {
  const root = joinVaultPath(config.fixtureRoot, `${runId}-SchemaAdoption`);
  const sensorFolder = joinVaultPath(root, "Sensor Registry");
  const boardFolder = joinVaultPath(root, "Board Registry");
  const sensorRowPaths = SCHEMA_ADOPTION_SENSOR_ROWS.map(
    (row) => `${sensorFolder}/${row.id}.md`
  );
  const boardRowPaths = SCHEMA_ADOPTION_BOARD_IDS.map(
    (boardId) => `${boardFolder}/${boardId}.md`
  );
  let scenarioError = null;
  let hubPath = null;

  try {
    await runObsidian(config, runner, "eval", {
      code: ensureFixtureFolderEvalCode({ folder: sensorFolder }),
    });
    await runObsidian(config, runner, "eval", {
      code: ensureFixtureFolderEvalCode({ folder: boardFolder }),
    });

    for (const row of SCHEMA_ADOPTION_SENSOR_ROWS) {
      await runObsidian(config, runner, "create", {
        path: `${sensorFolder}/${row.id}.md`,
        content: schemaAdoptionSensorContent(row),
        overwrite: true,
      });
    }
    for (const boardId of SCHEMA_ADOPTION_BOARD_IDS) {
      await runObsidian(config, runner, "create", {
        path: `${boardFolder}/${boardId}.md`,
        content: schemaAdoptionBoardContent(boardId),
        overwrite: true,
      });
    }

    // Wait for EVERY row's frontmatter to settle in the metadata cache, not
    // just the first — the adoption draft reads all 5 rows via pathsIndex, so
    // a partially-indexed fixture silently under-drafts the enum/FK
    // candidates (fewer distinct values than the fixture actually has)
    // instead of failing loudly.
    for (const row of SCHEMA_ADOPTION_SENSOR_ROWS) {
      await waitForMetadataValue({
        config,
        runner,
        path: `${sensorFolder}/${row.id}.md`,
        property: "sensor_class",
        expected: row.sensorClass,
      });
    }
    for (const boardId of SCHEMA_ADOPTION_BOARD_IDS) {
      await waitForMetadataValue({
        config,
        runner,
        path: `${boardFolder}/${boardId}.md`,
        property: "board_id",
        expected: boardId,
      });
    }

    const contextSetupArgs = {
      pluginId: config.pluginId,
      sensorFolder,
      boardFolder,
      rowPaths: [...sensorRowPaths, ...boardRowPaths],
      expectedSensorPaths: SCHEMA_ADOPTION_SENSOR_ROWS.length,
      expectedBoardPaths: SCHEMA_ADOPTION_BOARD_IDS.length,
      timeoutMs: config.timeoutMs,
      pollIntervalMs: config.pollIntervalMs,
    };

    const setupResult = parseJsonEvalResult(
      await runObsidian(config, runner, "eval", {
        code: schemaAdoptionContextSetupEvalCode(contextSetupArgs),
      })
    );
    if (!setupResult?.ok) {
      throw new Error(
        `Schema adoption fixture context setup failed: ${
          setupResult?.reason ?? "unknown"
        }`
      );
    }
    hubPath = setupResult.hubPath;

    // Ensure the hub note exists with NO Type Profile declared yet — the
    // onboarding-an-unprofiled-database case ADR-0056 D9 targets.
    await runObsidian(config, runner, "create", {
      path: hubPath,
      overwrite: true,
    });
    // Re-settle context now that the hub note file exists.
    await runObsidian(config, runner, "eval", {
      code: schemaAdoptionContextSetupEvalCode(contextSetupArgs),
    });

    const beforeSnapshot = parseJsonEvalResult(
      await runObsidian(config, runner, "eval", {
        code: frontmatterSnapshotEvalCode(hubPath),
      })
    );
    if (beforeSnapshot?.schema_type) {
      throw new Error(
        `Schema adoption fixture hub note unexpectedly already declares schema_type=${beforeSnapshot.schema_type} before confirm.`
      );
    }

    await runObsidian(config, runner, "open", { path: hubPath });
    await runObsidian(config, runner, "command", {
      id: `${config.pluginId}:${SCHEMA_ADOPTION_COMMAND_ID}`,
    });

    const modalResult = parseJsonEvalResult(
      await runObsidian(config, runner, "eval", {
        code: schemaAdoptionModalConfirmEvalCode({
          timeoutMs: config.timeoutMs,
          pollIntervalMs: config.pollIntervalMs,
        }),
      })
    );
    if (!modalResult?.ok) {
      throw new Error(
        `Schema adoption modal interaction failed: ${
          modalResult?.reason ?? "unknown"
        }${modalResult?.modalText ? ` — modal text: ${modalResult.modalText}` : ""}`
      );
    }
    if (!modalResult.modalText.includes("sensor_class")) {
      throw new Error(
        `Schema adoption preview did not surface the drafted sensor_class field. Modal text: ${modalResult.modalText}`
      );
    }
    if (!modalResult.modalText.includes("Board Registry")) {
      throw new Error(
        `Schema adoption preview did not surface the drafted board_id FK candidate. Modal text: ${modalResult.modalText}`
      );
    }

    await waitForMetadataValue({
      config,
      runner,
      path: hubPath,
      property: "schema_type",
      expected: "notidian_type_profile",
    });

    const afterSnapshot = parseJsonEvalResult(
      await runObsidian(config, runner, "eval", {
        code: frontmatterSnapshotEvalCode(hubPath),
      })
    );
    const sensorClassEnum =
      afterSnapshot?.fields?.sensor_class?.enum?.values ?? [];
    if (
      !SCHEMA_ADOPTION_ENUM_VALUES.every((value) =>
        sensorClassEnum.includes(value)
      )
    ) {
      throw new Error(
        `Adopted sensor_class enum missing expected values. Got: ${JSON.stringify(
          sensorClassEnum
        )}`
      );
    }
    if (afterSnapshot?.fields?.sensor_class?.enum?.strict !== false) {
      throw new Error(
        "Adopted sensor_class enum must be suggested-only (strict: false), never auto-strict (ADR-0056 D9)."
      );
    }
    const boardReference = afterSnapshot?.fields?.board_id?.reference;
    if (!boardReference || boardReference.targetFolder != boardFolder) {
      throw new Error(
        `Adopted board_id reference did not target the Board Registry fixture. Got: ${JSON.stringify(
          boardReference
        )}`
      );
    }
  } catch (error) {
    scenarioError = error;
  }

  if (!config.keepFixture) {
    const cleanupResult = parseJsonEvalResult(
      await runObsidian(config, runner, "eval", {
        code: deleteFolderEvalCode({ folder: root }),
      })
    );
    if (!scenarioError && !cleanupResult?.ok) {
      scenarioError = new Error(
        `Schema adoption fixture cleanup failed: ${
          cleanupResult?.reason ?? "unknown"
        }`
      );
    }
  }

  if (scenarioError) throw scenarioError;
  return { ok: true, folder: root, hubPath };
};

// ---------------------------------------------------------------------------
// --reconciler / runReconcilerScenario (Notidian-loan.4, ADR-0057): the Data
// Integrity reconciler is a read-only, event-driven engine
// (src/core/superstate/reconciler.ts) that watches a schema'd folder's rows
// and holds their current Violation[] in memory, recomputed from live index
// state -- nothing in this scenario writes through Notidian's own
// transaction path. It is threaded behind its own --reconciler flag
// (config.includeReconciler), the same convention as
// --adopt-schema/config.includeSchemaAdoption, so it never perturbs any
// other scenario's already-pinned eval-call sequence.
//
// Unlike schema adoption, this scenario declares its Type Profile DIRECTLY in
// the hub note's frontmatter (no adoption UI, no modal, no enum/FK drafting)
// -- the bead's own DoD is an EXTERNAL raw-text edit to a fixture row (the
// harness's own `create --overwrite` primitive, simulating an edit made
// completely outside Notidian) surfacing the right violation after reload.
// Two such edits are exercised on the SAME row, in sequence:
//   A) valid YAML that drops the declared required field's value entirely --
//      the reconciler must surface exactly one `required` violation, then
//      clear it once the value is restored.
//   B) YAML that fails to parse at all (an unterminated double-quoted
//      scalar) -- the reconciler must resolve to exactly ONE dedicated
//      `malformed-row` violation (ADR-0057 D4's `brokenFrontmatterViolation`,
//      reconciler.ts ~103-110), never fall through to ordinary per-field
//      checks, and never crash the app (checked via the same `cleanDevErrors`
//      pattern every other scenario uses).
//
// `plugin.reconciler` is TS-private on the plugin class but runtime-reachable
// via `eval`, exactly like `plugin.superstate` is throughout this file; it is
// also populated by a lazy dynamic `import()` in main.ts's `onload` (Notidian
// -loan.4's own landed wiring), so a `missing-reconciler` response from
// `reconcilerRowViolationsEvalCode` is a real, expected transient this
// scenario's own poll loop (never a one-shot check) must tolerate, not an
// error.
// ---------------------------------------------------------------------------

const RECONCILER_REQUIRED_FIELD = "model";
const RECONCILER_VALID_VALUE = "Widget A";
const RECONCILER_ROW_TITLE = "Reconciler Row";

const reconcilerHubContent = () =>
  [
    "---",
    "schema_type: notidian_type_profile",
    "fields:",
    `  ${RECONCILER_REQUIRED_FIELD}:`,
    "    kind: text",
    "    required: true",
    "---",
    "# Reconciler Fixture Hub",
    "",
  ].join("\n");

const reconcilerRowValidContent = () =>
  [
    "---",
    `${RECONCILER_REQUIRED_FIELD}: ${RECONCILER_VALID_VALUE}`,
    "---",
    `# ${RECONCILER_ROW_TITLE}`,
    "",
  ].join("\n");

// External edit A: valid YAML, but the declared required field's value is
// gone entirely (not merely blanked) -- validateRow.ts's `checkRequired` /
// `isMissingValue` treats an absent key the same as `null`/`""`.
const reconcilerRowDroppedRequiredContent = () =>
  [
    "---",
    "notes: dropped-required-field",
    "---",
    `# ${RECONCILER_ROW_TITLE}`,
    "",
  ].join("\n");

// External edit B: an unterminated double-quoted scalar. Obsidian extracts
// the frontmatter block textually (the two `---` fence lines) before handing
// the substring to its YAML parser, so this fails to parse as YAML without
// disturbing the fence lines themselves -- confirming this empirically in a
// real vault (does the broken parse actually leave
// `pathsIndex.get(path)?.metadata?.property` absent, per ADR-0057 D4's
// assumption) is this whole scenario's reason for existing.
const reconcilerRowMalformedYamlContent = () =>
  [
    "---",
    `${RECONCILER_REQUIRED_FIELD}: "${RECONCILER_VALID_VALUE}`,
    "---",
    `# ${RECONCILER_ROW_TITLE}`,
    "",
  ].join("\n");

// Resolves the fixture folder's hub-note path the SAME way the reconciler
// itself does (reconciler.ts's `resolveDbSchema`/`dbForNotePath`: always
// `spacesIndex.get(dbPath)?.space?.notePath`, regardless of the
// `enableFolderNote` setting -- that setting only picks `notePath` vs.
// `defPath` for OTHER callers via `metadataPathForSpace`
// (core/superstate/utils/spaces.ts), and `defPath` is an internal
// `def.json`, never a Markdown hub note; the reconciler's own code never
// reads it). Forces the same `reloadSpace`/`reloadContextByPath` pair
// `schemaAdoptionContextSetupEvalCode` and `tableViewSetupEvalCode` already
// use, so `spacesIndex` carries a fresh entry for a folder that was only
// just created.
const reconcilerHubPathEvalCode = ({
  pluginId,
  folder,
  timeoutMs,
  pollIntervalMs,
}) =>
  `(async () => {
    const marker = "notidianReconcilerHubPath";
    const finish = (payload) => JSON.stringify({ marker, ...payload });
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const timeoutMs = ${Number(timeoutMs)};
    const pollIntervalMs = Math.max(1, ${Number(pollIntervalMs)});
    try {
      const plugin = app.plugins.plugins[${JSON.stringify(pluginId)}];
      if (!plugin?.superstate?.spaceManager) {
        return finish({ ok: false, reason: "missing-plugin" });
      }
      const folder = ${JSON.stringify(folder)};
      const start = Date.now();
      let notePath = null;
      do {
        await plugin.superstate.reloadSpace(
          plugin.superstate.spaceManager.spaceInfoForPath(folder),
          null,
          true
        );
        await plugin.superstate.reloadContextByPath(folder, {
          force: true,
          calculate: true,
        });
        notePath =
          plugin.superstate.spacesIndex.get(folder)?.space?.notePath ?? null;
        if (notePath) break;
        await sleep(pollIntervalMs);
      } while (Date.now() - start <= timeoutMs);
      if (!notePath) {
        return finish({ ok: false, reason: "missing-note-path" });
      }
      return finish({ ok: true, hubPath: notePath });
    } catch (error) {
      return finish({
        ok: false,
        reason: "exception",
        message: String(error?.message ?? error),
      });
    }
  })()`.replace(/\s+/g, " ");

// `plugin.reconciler` is the runtime-reachable-but-TS-private engine instance
// (see this section's own header comment); `missing-reconciler` is a real,
// expected transient (a lazy dynamic import in main.ts's onload), not a
// fatal condition -- the caller's own poll loop (waitForReconcilerViolations)
// is what tolerates it, not this eval code.
const reconcilerRowViolationsEvalCode = ({ pluginId, dbPath, rowPath }) =>
  `(() => {
    const marker = "notidianReconcilerRowViolations";
    const finish = (payload) => JSON.stringify({ marker, ...payload });
    try {
      const plugin = app.plugins.plugins[${JSON.stringify(pluginId)}];
      if (!plugin?.reconciler) {
        return finish({ ok: false, reason: "missing-reconciler" });
      }
      const violations = plugin.reconciler.getRowViolations(
        ${JSON.stringify(dbPath)},
        ${JSON.stringify(rowPath)}
      );
      return finish({ ok: true, violations });
    } catch (error) {
      return finish({
        ok: false,
        reason: "exception",
        message: String(error?.message ?? error),
      });
    }
  })()`.replace(/\s+/g, " ");

// Node-side poll loop, cloned from waitForMetadataValue's own shape (a
// separate `eval` round-trip per attempt, not a poll loop embedded in one
// eval call) -- `plugin.reconciler.getRowViolations` is a synchronous,
// already-in-memory read, so each attempt is cheap; a non-ok response
// (missing-reconciler, or a thrown exception) never satisfies `predicate`
// and is retried exactly like a not-yet-matching violations array.
const waitForReconcilerViolations = async ({
  config,
  runner,
  pluginId,
  dbPath,
  rowPath,
  predicate,
  label,
}) => {
  const start = Date.now();
  let lastResult = null;

  while (Date.now() - start <= config.timeoutMs) {
    lastResult = parseJsonEvalResult(
      await runObsidian(config, runner, "eval", {
        code: reconcilerRowViolationsEvalCode({ pluginId, dbPath, rowPath }),
      })
    );

    if (lastResult?.ok && predicate(lastResult.violations ?? [])) {
      return lastResult.violations ?? [];
    }
    await sleep(Math.max(1, config.pollIntervalMs));
  }

  throw new Error(
    `Timed out waiting for reconciler violations (${label}) on ${rowPath}. Last result: ${JSON.stringify(
      lastResult
    )}`
  );
};

const isCleanViolations = (violations) =>
  Array.isArray(violations) && violations.length == 0;

const isSingleRequiredViolation = (violations) =>
  Array.isArray(violations) &&
  violations.length == 1 &&
  violations[0]?.code == "required" &&
  violations[0]?.field == RECONCILER_REQUIRED_FIELD &&
  violations[0]?.severity == "error";

const isSingleMalformedRowViolation = (violations) =>
  Array.isArray(violations) &&
  violations.length == 1 &&
  violations[0]?.code == "malformed-row" &&
  violations[0]?.severity == "error" &&
  violations[0]?.repairTier == "manual-only";

const runReconcilerScenario = async ({ config, runner, runId }) => {
  const root = joinVaultPath(config.fixtureRoot, `${runId}-Reconciler`);
  const rowPath = `${root}/${RECONCILER_ROW_TITLE}.md`;
  let scenarioError = null;
  let hubPath = null;

  try {
    await runObsidian(config, runner, "eval", {
      code: ensureFixtureFolderEvalCode({ folder: root }),
    });

    await runObsidian(config, runner, "create", {
      path: rowPath,
      content: reconcilerRowValidContent(),
      overwrite: true,
    });
    await waitForMetadataValue({
      config,
      runner,
      path: rowPath,
      property: RECONCILER_REQUIRED_FIELD,
      expected: RECONCILER_VALID_VALUE,
    });

    const hubPathResult = parseJsonEvalResult(
      await runObsidian(config, runner, "eval", {
        code: reconcilerHubPathEvalCode({
          pluginId: config.pluginId,
          folder: root,
          timeoutMs: config.timeoutMs,
          pollIntervalMs: config.pollIntervalMs,
        }),
      })
    );
    if (!hubPathResult?.ok) {
      throw new Error(
        `Reconciler fixture hub path resolution failed: ${
          hubPathResult?.reason ?? "unknown"
        }`
      );
    }
    hubPath = hubPathResult.hubPath;

    await runObsidian(config, runner, "create", {
      path: hubPath,
      content: reconcilerHubContent(),
      overwrite: true,
    });
    await waitForMetadataValue({
      config,
      runner,
      path: hubPath,
      property: "schema_type",
      expected: "notidian_type_profile",
    });

    // Baseline: the valid row must read clean before either external edit.
    // (A reconciler that has not yet examined this row also reads as `[]`;
    // the real proof this scenario exists for is the flips below.)
    await waitForReconcilerViolations({
      config,
      runner,
      pluginId: config.pluginId,
      dbPath: root,
      rowPath,
      predicate: isCleanViolations,
      label: "baseline clean",
    });

    // External edit A: drop the required field's value while staying valid
    // YAML.
    await runObsidian(config, runner, "create", {
      path: rowPath,
      content: reconcilerRowDroppedRequiredContent(),
      overwrite: true,
    });
    await waitForReconcilerViolations({
      config,
      runner,
      pluginId: config.pluginId,
      dbPath: root,
      rowPath,
      predicate: isSingleRequiredViolation,
      label: "required violation",
    });

    // Restore valid content -- the violation must clear.
    await runObsidian(config, runner, "create", {
      path: rowPath,
      content: reconcilerRowValidContent(),
      overwrite: true,
    });
    await waitForReconcilerViolations({
      config,
      runner,
      pluginId: config.pluginId,
      dbPath: root,
      rowPath,
      predicate: isCleanViolations,
      label: "restored clean",
    });

    // External edit B: break the row's YAML entirely.
    await runObsidian(config, runner, "create", {
      path: rowPath,
      content: reconcilerRowMalformedYamlContent(),
      overwrite: true,
    });
    await waitForReconcilerViolations({
      config,
      runner,
      pluginId: config.pluginId,
      dbPath: root,
      rowPath,
      predicate: isSingleMalformedRowViolation,
      label: "malformed-row violation",
    });

    const devErrors = await runObsidian(config, runner, "dev:errors");
    if (!cleanDevErrors(devErrors)) {
      throw new Error(
        `Obsidian captured developer errors during the reconciler scenario:\n${devErrors}`
      );
    }
  } catch (error) {
    scenarioError = error;
  }

  if (!config.keepFixture) {
    const cleanupResult = parseJsonEvalResult(
      await runObsidian(config, runner, "eval", {
        code: deleteFolderEvalCode({ folder: root, folderNote: hubPath }),
      })
    );
    if (!scenarioError && !cleanupResult?.ok) {
      scenarioError = new Error(
        `Reconciler fixture cleanup failed: ${
          cleanupResult?.reason ?? "unknown"
        }`
      );
    }
  }

  if (scenarioError) throw scenarioError;
  return { ok: true, folder: root, hubPath, rowPath };
};

// ---------------------------------------------------------------------------
// --health / runHealthSurfacesScenario (Notidian-loan.5, ADR-0057 D3/D4): the
// health SURFACES sit on top of S4's reconciler engine -- this scenario is
// the first to actually drive the live table DOM against real violation
// state, not just poll `plugin.reconciler`'s read API in the dark (the
// --reconciler scenario's whole reason for existing). Threaded behind its
// own --health flag (config.includeHealthSurfaces), same convention as
// --adopt-schema/--reconciler, so it never perturbs any other scenario's
// already-pinned eval-call sequence.
//
// Like --reconciler, the Type Profile is declared DIRECTLY in the hub note's
// frontmatter (reusing reconcilerHubPathEvalCode verbatim -- it is already
// fully generic over `folder`, nothing reconciler-scenario-specific lives
// inside it). Two fixture rows exercise the two DoD surfaces:
//   - a BROKEN row (malformed YAML, same unterminated-quote idiom
//     runReconcilerScenario uses) -- proves a schema'd folder's row that
//     fails to parse renders as `tr.mk-row-broken` instead of vanishing.
//   - an EMPTY row (valid YAML, but the `code` field -- declared
//     `empty: "empty-string"` -- is entirely absent) -- proves the ONE
//     ratified autofix (empty-encoding, per TableView.tsx's
//     openRowHealthRepairMenu/applyRowHealthFix doc comment) writes through
//     the SAME funnel every other direct cell edit in this file uses
//     (tableUndoWriteForDirectEdit -> applyValueEdits -> ContextEditorContext
//     -> executeTableValueWrites), never saveFrontmatterProperties/
//     processFrontMatter/deleteProperty directly, and that the row's badge
//     clears once the reconciler revalidates.
//
// The autofix is driven through the REAL repair menu (click
// `.mk-row-health-badge` -> `.mk-menu` -> the one actionable item, whose
// literal label is i18n.labels.fixEmptyString == "Fix: set explicit empty
// string" -- restated here as HEALTH_FIX_LABEL, the same
// restate-the-source-string convention RECONCILER_REQUIRED_FIELD/
// RECONCILER_VALID_VALUE already use for the reconciler scenario's hub
// fields), exactly like the --ui scenario's Select-option menus are driven
// (openMenu -> clickElement -> find `.mk-menu-option` by innerText -> click).
// No fallback funnel-eval path was needed -- the menu proved reachable and
// stable on the first live run (see this bead's close note for the
// first-try confirmation).
// ---------------------------------------------------------------------------

const HEALTH_REQUIRED_FIELD = "model";
const HEALTH_EMPTY_FIELD = "code";
const HEALTH_VALID_VALUE = "Widget A";
const HEALTH_BROKEN_ROW_TITLE = "Health Broken Row";
const HEALTH_EMPTY_ROW_TITLE = "Health Empty Row";
// Restated from src/shared/en.ts's `fixEmptyString` label (i18n.labels
// .fixEmptyString) -- the ONE actionable, write-wired repair-menu item's
// literal text (TableView.tsx's openRowHealthRepairMenu). Every other menu
// entry (enum, title-binding, manual-only codes, an "absent"-policy empty-
// encoding violation) is rendered `disabled: true` -- text-only, per the
// round-2 descope this scenario's own header comment restates.
const HEALTH_FIX_LABEL = "Fix: set explicit empty string";

const healthHubContent = () =>
  [
    "---",
    "schema_type: notidian_type_profile",
    "fields:",
    `  ${HEALTH_REQUIRED_FIELD}:`,
    "    kind: text",
    "    required: true",
    `  ${HEALTH_EMPTY_FIELD}:`,
    "    kind: text",
    "    empty: empty-string",
    "---",
    "# Health Fixture Hub",
    "",
  ].join("\n");

// Valid YAML; `model` is present but `code` is entirely absent -- per
// validateRow.ts's checkEmptyEncoding, an absent value on a field declared
// `empty: "empty-string"` is the ONE case that yields a single, autofix-tier
// `empty-encoding` violation (never a `required` violation too, since `code`
// itself is not declared required).
const healthEmptyRowContent = () =>
  [
    "---",
    `${HEALTH_REQUIRED_FIELD}: ${HEALTH_VALID_VALUE}`,
    "---",
    `# ${HEALTH_EMPTY_ROW_TITLE}`,
    "",
  ].join("\n");

// An unterminated double-quoted scalar -- same malformed-YAML idiom
// reconcilerRowMalformedYamlContent uses (see that function's own comment
// for why this reliably fails to parse without disturbing the fence lines).
const healthBrokenRowContent = () =>
  [
    "---",
    `${HEALTH_REQUIRED_FIELD}: "${HEALTH_VALID_VALUE}`,
    "---",
    `# ${HEALTH_BROKEN_ROW_TITLE}`,
    "",
  ].join("\n");

const isSingleEmptyEncodingAutofixViolation = (violations) =>
  Array.isArray(violations) &&
  violations.length == 1 &&
  violations[0]?.code == "empty-encoding" &&
  violations[0]?.field == HEALTH_EMPTY_FIELD &&
  violations[0]?.repairTier == "autofix";

// One-shot DOM read (no embedded poll loop -- the Node-side
// waitForHealthRowDom below owns retrying): locates the fixture folder's
// live table (same `.mk-space-view[data-path]` -> `.mk-table` idiom every
// other DOM helper in this file uses), finds the row whose rendered text
// includes `rowTitle` (works whether the row's Name cell shows a frontmatter
// title override or just the file's own basename -- a broken row has no
// frontmatter title, so it always falls back to basename), and reports both
// broken-row state (`tr.mk-row-broken`) and row-health-badge state
// (`.mk-row-health-badge`'s data-* attributes, or absent entirely once a
// violation clears).
const healthRowDomEvalCode = ({ folder, rowTitle }) =>
  `(() => {
    const marker = "notidianHealthRowDom";
    const finish = (payload) => JSON.stringify({ marker, ...payload });
    try {
      const folder = ${JSON.stringify(folder)};
      const rowTitle = ${JSON.stringify(rowTitle)};
      const views = Array.from(document.querySelectorAll(".mk-space-view"))
        .filter((view) =>
          view.getAttribute("data-path") === folder &&
          view.querySelector(".mk-table")
        );
      const view = views[views.length - 1];
      const table = view?.querySelector(".mk-table");
      if (!view || !table) {
        return finish({ ok: false, reason: !view ? "missing-view" : "missing-table" });
      }
      const row = Array.from(table.querySelectorAll("tbody tr[data-row-id]"))
        .find((candidate) => candidate.innerText.includes(rowTitle));
      if (!row) {
        return finish({
          ok: false,
          reason: "missing-row",
          tableText: table.innerText.slice(0, 500),
        });
      }
      const badge = row.querySelector(".mk-row-health-badge");
      return finish({
        ok: true,
        isBroken: row.classList.contains("mk-row-broken"),
        hasBadge: !!badge,
        violationCount: badge ? Number(badge.getAttribute("data-violation-count")) : 0,
        violationCode: badge ? badge.getAttribute("data-violation-code") : null,
        repairTier: badge ? badge.getAttribute("data-repair-tier") : null,
      });
    } catch (error) {
      return finish({
        ok: false,
        reason: "exception",
        message: String(error?.message ?? error),
      });
    }
  })()`.replace(/\s+/g, " ");

// Node-side poll loop, cloned from waitForMetadataValue's own shape (a
// separate `eval` round-trip per attempt) -- rendering can lag one tick
// behind the reconciler's own store mutation (TableView's onChange
// subscription re-renders asynchronously), so a single-shot DOM read right
// after an API-level violation check is not enough on its own.
const waitForHealthRowDom = async ({
  config,
  runner,
  folder,
  rowTitle,
  predicate,
  label,
}) => {
  const start = Date.now();
  let lastResult = null;

  while (Date.now() - start <= config.timeoutMs) {
    lastResult = parseJsonEvalResult(
      await runObsidian(config, runner, "eval", {
        code: healthRowDomEvalCode({ folder, rowTitle }),
      })
    );

    if (lastResult?.ok && predicate(lastResult)) return lastResult;
    await sleep(Math.max(1, config.pollIntervalMs));
  }

  throw new Error(
    `Timed out waiting for health row DOM (${label}) on ${rowTitle}. Last result: ${JSON.stringify(
      lastResult
    )}`
  );
};

const isBrokenRowRendered = (result) => result.isBroken === true;

const isAutofixBadgeVisible = (result) =>
  result.hasBadge === true &&
  result.violationCount === 1 &&
  result.violationCode == "empty-encoding" &&
  result.repairTier == "autofix";

const isBadgeCleared = (result) => result.hasBadge === false;

// DOM-drives the ONE actionable repair (Unit 3): click the badge to open the
// repair menu (RowHealthBadge.tsx's onClick -> TableView's
// openRowHealthRepairMenu), then click the menu item whose innerText is
// HEALTH_FIX_LABEL (TableView.tsx wires this item's onClick to
// applyRowHealthFix -> applyValueEdits -> executeTableValueWrites -- the
// SAME funnel every other direct cell edit in this file goes through). A
// single click-and-return, not an embedded settle-poll -- the caller polls
// the AFTER-effects (on-disk value + cleared badge) separately, exactly like
// every other multi-step outcome this file asserts.
const healthAutofixEvalCode = ({ folder, rowTitle, fixLabel }) =>
  `(async () => {
    const marker = "notidianHealthAutofix";
    const finish = (payload) => JSON.stringify({ marker, ...payload });
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const clickElement = (element) => {
      element.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0, buttons: 1, view: window }));
      element.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, button: 0, view: window }));
      element.dispatchEvent(new MouseEvent("click", { bubbles: true, button: 0, view: window }));
    };
    try {
      const folder = ${JSON.stringify(folder)};
      const rowTitle = ${JSON.stringify(rowTitle)};
      const fixLabel = ${JSON.stringify(fixLabel)};
      const views = Array.from(document.querySelectorAll(".mk-space-view"))
        .filter((view) =>
          view.getAttribute("data-path") === folder &&
          view.querySelector(".mk-table")
        );
      const view = views[views.length - 1];
      const table = view?.querySelector(".mk-table");
      if (!view || !table) {
        return finish({ ok: false, reason: !view ? "missing-view" : "missing-table" });
      }
      const row = Array.from(table.querySelectorAll("tbody tr[data-row-id]"))
        .find((candidate) => candidate.innerText.includes(rowTitle));
      if (!row) {
        return finish({
          ok: false,
          reason: "missing-row",
          tableText: table.innerText.slice(0, 500),
        });
      }
      const badge = row.querySelector(".mk-row-health-badge");
      if (!badge) return finish({ ok: false, reason: "missing-badge" });
      clickElement(badge);
      await sleep(250);
      const menu = Array.from(document.querySelectorAll(".mk-menu")).at(-1);
      if (!menu) return finish({ ok: false, reason: "missing-repair-menu" });
      const option = Array.from(menu.querySelectorAll(".mk-menu-option")).find(
        (item) => item.innerText.trim().includes(fixLabel)
      );
      if (!option) {
        return finish({
          ok: false,
          reason: "missing-autofix-option",
          menuText: menu.innerText.slice(0, 500),
        });
      }
      clickElement(option);
      return finish({ ok: true });
    } catch (error) {
      return finish({
        ok: false,
        reason: "exception",
        message: String(error?.message ?? error),
      });
    }
  })()`.replace(/\s+/g, " ");

// On-disk assertion primitive, cloned from waitForMetadataValue's own shape
// but NOT waitForMetadataValue itself: metadataEvalCode's `value == null ->
// ""` normalization makes an absent key and an explicit empty string
// indistinguishable, which is exactly the distinction this scenario needs
// to prove (the autofix's whole job is turning "absent" into "explicit
// empty string", per validateRow.ts's checkEmptyEncoding/
// emptyEncodingViolation -- see this section's own header comment).
const healthFieldStateEvalCode = ({ path, property }) =>
  `(() => {
    const marker = "notidianHealthFieldState";
    const finish = (payload) => JSON.stringify({ marker, ...payload });
    try {
      const file = app.vault.getAbstractFileByPath(${JSON.stringify(path)});
      if (!file) return finish({ hasKey: false, value: null });
      const cache = app.metadataCache.getFileCache(file);
      const fm = cache?.frontmatter ?? {};
      const property = ${JSON.stringify(property)};
      const hasKey = Object.prototype.hasOwnProperty.call(fm, property);
      return finish({ hasKey, value: hasKey ? fm[property] : null });
    } catch (error) {
      return finish({
        ok: false,
        reason: "exception",
        message: String(error?.message ?? error),
      });
    }
  })()`.replace(/\s+/g, " ");

const waitForExplicitEmptyStringValue = async ({
  config,
  runner,
  path,
  property,
}) => {
  const start = Date.now();
  let lastResult = null;

  while (Date.now() - start <= config.timeoutMs) {
    lastResult = parseJsonEvalResult(
      await runObsidian(config, runner, "eval", {
        code: healthFieldStateEvalCode({ path, property }),
      })
    );

    if (lastResult?.hasKey === true && lastResult?.value === "") {
      return lastResult;
    }
    await sleep(Math.max(1, config.pollIntervalMs));
  }

  throw new Error(
    `Timed out waiting for an explicit empty string ${property}="" on ${path}. Last value: ${JSON.stringify(
      lastResult
    )}`
  );
};

// Read-only chip count (no click -- Node-side waitForHealthChipCount below
// owns retrying until the FilterBar's own onChange-triggered re-render has
// settled to the expected post-fix count, BEFORE the atomic click+compare
// eval below risks racing a still-stale chip against a freshly-opened panel).
const healthChipCountEvalCode = ({ folder }) =>
  `(() => {
    const marker = "notidianHealthChipCount";
    const finish = (payload) => JSON.stringify({ marker, ...payload });
    try {
      const folder = ${JSON.stringify(folder)};
      const views = Array.from(document.querySelectorAll(".mk-space-view"))
        .filter((view) => view.getAttribute("data-path") === folder);
      const view = views[views.length - 1];
      const chip = view?.querySelector(".mk-db-health-chip");
      if (!view || !chip) {
        return finish({ ok: false, reason: !view ? "missing-view" : "missing-chip" });
      }
      return finish({
        ok: true,
        violationCount: Number(chip.getAttribute("data-violation-count")),
      });
    } catch (error) {
      return finish({
        ok: false,
        reason: "exception",
        message: String(error?.message ?? error),
      });
    }
  })()`.replace(/\s+/g, " ");

const waitForHealthChipCount = async ({
  config,
  runner,
  folder,
  predicate,
  label,
}) => {
  const start = Date.now();
  let lastResult = null;

  while (Date.now() - start <= config.timeoutMs) {
    lastResult = parseJsonEvalResult(
      await runObsidian(config, runner, "eval", {
        code: healthChipCountEvalCode({ folder }),
      })
    );

    if (lastResult?.ok && predicate(lastResult)) return lastResult;
    await sleep(Math.max(1, config.pollIntervalMs));
  }

  throw new Error(
    `Timed out waiting for health chip count (${label}) on ${folder}. Last result: ${JSON.stringify(
      lastResult
    )}`
  );
};

// Chip == panel (Unit 2/DatabaseHealthPanel.tsx's own DoD comment: "this
// panel's total always equals the FilterBar chip's count for the same
// dbPath"). Both the chip's `data-violation-count` and the panel's
// `data-panel-violation-count` are populated straight from
// `reconciler.getViolationCount(dbPath)` -- `liveCount` below calls that
// SAME method directly (not re-derived from the DOM) so the comparison is
// against the live reconciler count for the fixture DB, not just an
// internal-consistency check between two renders of the same number. One
// atomic eval round-trip (click chip -> poll for the panel's own DOM to
// mount -> read both counts -> close the modal) avoids a race where two
// separate round-trips could straddle a reconciler mutation.
const healthChipPanelEvalCode = ({ pluginId, folder }) =>
  `(async () => {
    const marker = "notidianHealthChipPanel";
    const finish = (payload) => JSON.stringify({ marker, ...payload });
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const clickElement = (element) => {
      element.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0, buttons: 1, view: window }));
      element.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, button: 0, view: window }));
      element.dispatchEvent(new MouseEvent("click", { bubbles: true, button: 0, view: window }));
    };
    try {
      const pluginId = ${JSON.stringify(pluginId)};
      const folder = ${JSON.stringify(folder)};
      const plugin = app.plugins.plugins[pluginId];
      const views = Array.from(document.querySelectorAll(".mk-space-view"))
        .filter((view) => view.getAttribute("data-path") === folder);
      const view = views[views.length - 1];
      const chip = view?.querySelector(".mk-db-health-chip");
      if (!view || !chip) {
        return finish({ ok: false, reason: !view ? "missing-view" : "missing-chip" });
      }
      const chipCount = Number(chip.getAttribute("data-violation-count"));
      clickElement(chip);
      let panel = null;
      const start = Date.now();
      do {
        panel = document.querySelector(
          '.mk-health-panel[data-health-view="db"] [data-panel-violation-count]'
        );
        if (panel) break;
        await sleep(50);
      } while (Date.now() - start <= 5000);
      if (!panel) return finish({ ok: false, reason: "missing-panel" });
      const panelCount = Number(panel.getAttribute("data-panel-violation-count"));
      const liveCount = plugin?.reconciler?.getViolationCount(folder) ?? null;
      const closeButton = document.querySelector(".mk-modal-wrapper .mk-x-small");
      if (closeButton) clickElement(closeButton);
      return finish({ ok: true, chipCount, panelCount, liveCount });
    } catch (error) {
      return finish({
        ok: false,
        reason: "exception",
        message: String(error?.message ?? error),
      });
    }
  })()`.replace(/\s+/g, " ");

const runHealthSurfacesScenario = async ({ config, runner, runId }) => {
  const root = joinVaultPath(config.fixtureRoot, `${runId}-Health`);
  const emptyRowPath = `${root}/${HEALTH_EMPTY_ROW_TITLE}.md`;
  const brokenRowPath = `${root}/${HEALTH_BROKEN_ROW_TITLE}.md`;
  let scenarioError = null;
  let hubPath = null;

  try {
    await runObsidian(config, runner, "eval", {
      code: ensureFixtureFolderEvalCode({ folder: root }),
    });

    // The empty row is written BEFORE the hub declares any schema -- same
    // ordering runReconcilerScenario uses -- so its own frontmatter has
    // already settled in the metadata cache once the schema arrives and the
    // reconciler's schema-change sweep evaluates it for the first time.
    await runObsidian(config, runner, "create", {
      path: emptyRowPath,
      content: healthEmptyRowContent(),
      overwrite: true,
    });
    await waitForMetadataValue({
      config,
      runner,
      path: emptyRowPath,
      property: HEALTH_REQUIRED_FIELD,
      expected: HEALTH_VALID_VALUE,
    });

    // The broken row's frontmatter can never settle in the metadata cache by
    // definition (that is the point) -- no waitForMetadataValue call for it;
    // the reconciler poll below is this scenario's only settle signal.
    await runObsidian(config, runner, "create", {
      path: brokenRowPath,
      content: healthBrokenRowContent(),
      overwrite: true,
    });

    // Reused verbatim from the --reconciler scenario (Notidian-loan.4): fully
    // generic over `folder`, resolves the fixture folder's hub-note path the
    // same way the reconciler itself does (see that function's own doc
    // comment for why enableFolderNote never matters here).
    const hubPathResult = parseJsonEvalResult(
      await runObsidian(config, runner, "eval", {
        code: reconcilerHubPathEvalCode({
          pluginId: config.pluginId,
          folder: root,
          timeoutMs: config.timeoutMs,
          pollIntervalMs: config.pollIntervalMs,
        }),
      })
    );
    if (!hubPathResult?.ok) {
      throw new Error(
        `Health fixture hub path resolution failed: ${
          hubPathResult?.reason ?? "unknown"
        }`
      );
    }
    hubPath = hubPathResult.hubPath;

    await runObsidian(config, runner, "create", {
      path: hubPath,
      content: healthHubContent(),
      overwrite: true,
    });
    await waitForMetadataValue({
      config,
      runner,
      path: hubPath,
      property: "schema_type",
      expected: "notidian_type_profile",
    });

    // Reused verbatim from the --reconciler scenario: plugin.reconciler's own
    // read API (getRowViolations), polled through the SAME Node-side loop.
    await waitForReconcilerViolations({
      config,
      runner,
      pluginId: config.pluginId,
      dbPath: root,
      rowPath: emptyRowPath,
      predicate: isSingleEmptyEncodingAutofixViolation,
      label: "empty-encoding autofix violation",
    });
    await waitForReconcilerViolations({
      config,
      runner,
      pluginId: config.pluginId,
      dbPath: root,
      rowPath: brokenRowPath,
      predicate: isSingleMalformedRowViolation,
      label: "malformed-row violation",
    });

    // Force the fixture root's default view to table (same tableViewSetup-
    // EvalCode the --ui scenario uses) so the DOM assertions below have a
    // live `.mk-space-view[data-path]` -> `.mk-table` to query.
    const setupResult = parseJsonEvalResult(
      await runObsidian(config, runner, "eval", {
        code: tableViewSetupEvalCode({ pluginId: config.pluginId, folder: root }),
      })
    );
    assertUiEvalOk("health table setup", setupResult);

    // DoD item 1: the broken fixture row is visible in the table (rendered
    // as an error row, not silently absent).
    await waitForHealthRowDom({
      config,
      runner,
      folder: root,
      rowTitle: HEALTH_BROKEN_ROW_TITLE,
      predicate: isBrokenRowRendered,
      label: "broken row rendered",
    });

    // Pre-condition for the autofix below: the empty row's badge is visible
    // with the expected autofix-tier empty-encoding violation.
    await waitForHealthRowDom({
      config,
      runner,
      folder: root,
      rowTitle: HEALTH_EMPTY_ROW_TITLE,
      predicate: isAutofixBadgeVisible,
      label: "autofix badge visible",
    });

    // DoD item 2 (part 1): DOM-drive the ratified autofix through the real
    // repair menu -- the ONLY write this scenario performs, and it goes
    // through the funnel (see this section's header comment + the module's
    // own grep-checked DoD item).
    const autofixResult = parseJsonEvalResult(
      await runObsidian(config, runner, "eval", {
        code: healthAutofixEvalCode({
          folder: root,
          rowTitle: HEALTH_EMPTY_ROW_TITLE,
          fixLabel: HEALTH_FIX_LABEL,
        }),
      })
    );
    if (!autofixResult?.ok) {
      throw new Error(
        `Health autofix DOM interaction failed: ${formatUiFailure(autofixResult)}`
      );
    }

    // DoD item 2 (part 2): the write landed ON DISK as an explicit empty
    // string (never merely "still absent" -- see healthFieldStateEvalCode's
    // own comment for why waitForMetadataValue itself cannot tell the two
    // apart).
    await waitForExplicitEmptyStringValue({
      config,
      runner,
      path: emptyRowPath,
      property: HEALTH_EMPTY_FIELD,
    });

    // DoD item 2 (part 3): the reconciler has revalidated and the violation
    // is gone.
    await waitForReconcilerViolations({
      config,
      runner,
      pluginId: config.pluginId,
      dbPath: root,
      rowPath: emptyRowPath,
      predicate: isCleanViolations,
      label: "empty-encoding cleared",
    });

    // DoD item 2 (part 4): the badge itself is gone from the rendered row.
    await waitForHealthRowDom({
      config,
      runner,
      folder: root,
      rowTitle: HEALTH_EMPTY_ROW_TITLE,
      predicate: isBadgeCleared,
      label: "autofix badge cleared",
    });

    // DoD item 3: chip count == panel count. Only the malformed-row
    // violation remains at this point (manual-only, never fixed by this
    // scenario) -- settle the chip to that count first so the atomic
    // click+compare eval below never races a still-stale chip render.
    await waitForHealthChipCount({
      config,
      runner,
      folder: root,
      predicate: (result) => result.violationCount === 1,
      label: "post-fix chip count",
    });

    const chipPanelResult = parseJsonEvalResult(
      await runObsidian(config, runner, "eval", {
        code: healthChipPanelEvalCode({ pluginId: config.pluginId, folder: root }),
      })
    );
    if (!chipPanelResult?.ok) {
      throw new Error(
        `Health chip/panel DOM interaction failed: ${formatUiFailure(
          chipPanelResult
        )}`
      );
    }
    if (
      chipPanelResult.chipCount !== chipPanelResult.panelCount ||
      chipPanelResult.chipCount !== chipPanelResult.liveCount
    ) {
      throw new Error(
        `Database Health chip count (${chipPanelResult.chipCount}) does not match panel count (${chipPanelResult.panelCount}) or the live reconciler count (${chipPanelResult.liveCount}) for ${root}.`
      );
    }

    const devErrors = await runObsidian(config, runner, "dev:errors");
    if (!cleanDevErrors(devErrors)) {
      throw new Error(
        `Obsidian captured developer errors during the health surfaces scenario:\n${devErrors}`
      );
    }
  } catch (error) {
    scenarioError = error;
  }

  if (!config.keepFixture) {
    const cleanupResult = parseJsonEvalResult(
      await runObsidian(config, runner, "eval", {
        code: deleteFolderEvalCode({ folder: root, folderNote: hubPath }),
      })
    );
    if (!scenarioError && !cleanupResult?.ok) {
      scenarioError = new Error(
        `Health fixture cleanup failed: ${cleanupResult?.reason ?? "unknown"}`
      );
    }
  }

  if (scenarioError) throw scenarioError;
  return { ok: true, folder: root, hubPath, emptyRowPath, brokenRowPath };
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
    await runObsidian(config, execute, "eval", {
      code: ensureFixtureFolderEvalCode({ folder: paths.folder }),
    });
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

    if (config.includeSchemaAdoption) {
      await runSchemaAdoptionScenario({
        config,
        runner: execute,
        runId: paths.runId,
      });
    }

    if (config.includeReconciler) {
      await runReconcilerScenario({
        config,
        runner: execute,
        runId: paths.runId,
      });
    }

    if (config.includeHealthSurfaces) {
      await runHealthSurfacesScenario({
        config,
        runner: execute,
        runId: paths.runId,
      });
    }

    const devErrors = await runObsidian(config, execute, "dev:errors");
    if (!cleanDevErrors(devErrors)) {
      throw new Error(`Obsidian captured developer errors:\n${devErrors}`);
    }
    await assertNoLegacyArtifacts({
      config,
      runner: execute,
      label: "smoke scenario",
    });
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
    await assertNoLegacyArtifacts({
      config,
      runner: execute,
      label: "fixture cleanup",
    });
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
  "  --adopt-schema           Also exercise the schema-adoption preview/confirm modal.",
  "  --reconciler             Also exercise the Data Integrity reconciler engine (ADR-0057).",
  "  --health                 Also exercise the Data Integrity health surfaces (badges/chip/panel/autofix, ADR-0057 D3/D4).",
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
  deleteFolderEvalCode,
  parseHarnessArgs,
  runRealVaultSmokeHarness,
  runSchemaAdoptionScenario,
  runReconcilerScenario,
  runHealthSurfacesScenario,
  validateHarnessConfig,
};
