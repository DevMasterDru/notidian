const { spawn } = require("child_process");

const DEFAULT_FIXTURE_ROOT = "Notidian Integration Fixtures";
const DEFAULT_PLUGIN_ID = "notidian";
const DEFAULT_TIMEOUT_MS = 10000;
const DEFAULT_COMMAND_TIMEOUT_MS = 20000;
const DEFAULT_POLL_INTERVAL_MS = 250;
const DEFAULT_TABLE_UI_EDIT_VALUE = "ui-active";
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
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, commandTimeoutMs);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timeout);
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
        new KeyboardEvent("keydown", { bubbles: true, key: "Enter" })
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

const alphaContent = "---\nstatus: old\nrating: 1\n---\n# Alpha\n";
const betaContent = "---\nstatus: queued\nrating: 2\n---\n# Beta\n";

const cleanupFixtures = async ({ config, runner, paths, primaryPath }) => {
  if (config.keepFixture) return false;

  const deletePaths = [...new Set([primaryPath, paths.betaPath])];
  for (const path of deletePaths) {
    await runObsidian(config, runner, "delete", {
      path,
      permanent: true,
    });
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
      await runTableUiSmokeScenario({
        config,
        runner: execute,
        paths,
      });
    }

    const devErrors = await runObsidian(config, execute, "dev:errors");
    if (!cleanDevErrors(devErrors)) {
      throw new Error(`Obsidian captured developer errors:\n${devErrors}`);
    }
  } catch (error) {
    scenarioError = error;
  }

  const cleanedUp = await cleanupFixtures({
    config,
    runner: execute,
    paths,
    primaryPath,
  });

  if (!scenarioError && cleanedUp) {
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
