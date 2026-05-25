const { spawn } = require("child_process");

const DEFAULT_FIXTURE_ROOT = "Notidian Integration Fixtures";
const DEFAULT_PLUGIN_ID = "notidian";
const DEFAULT_TIMEOUT_MS = 10000;
const DEFAULT_POLL_INTERVAL_MS = 250;

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
    pluginId: DEFAULT_PLUGIN_ID,
    fixtureRoot: DEFAULT_FIXTURE_ROOT,
    timeoutMs: DEFAULT_TIMEOUT_MS,
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

const createObsidianRunner = (obsidianBin) => (args) =>
  new Promise((resolve, reject) => {
    const child = spawn(obsidianBin, args, {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
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

const runRealVaultSmokeHarness = async (config, runner) => {
  const errors = validateHarnessConfig(config);
  if (errors.length > 0) {
    throw new Error(errors.join("\n"));
  }

  const execute = runner ?? createObsidianRunner(config.obsidianBin);
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
    await runObsidian(config, execute, "rename", {
      path: paths.alphaPath,
      name: `${paths.runId}-Alpha Renamed`,
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
  "  --plugin-id=<id>         Defaults to notidian.",
  `  --fixture-root=<folder>  Defaults to ${DEFAULT_FIXTURE_ROOT}.`,
  `  --timeout-ms=<ms>        Defaults to ${DEFAULT_TIMEOUT_MS}.`,
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
  createFixturePaths,
  parseHarnessArgs,
  runRealVaultSmokeHarness,
  validateHarnessConfig,
};
