const path = require("path");
const { spawnSync } = require("child_process");

const DEFAULT_VAULT_PATH = "/Users/druker/Atlas Vault";
const DEFAULT_PLUGIN_ID = "notidian";
const DEFAULT_SETTLE_MS = 8000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const parseIntegerOption = (value, fallback) => {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const vaultNameFromPath = (vaultPath) => {
  const normalized = String(vaultPath || "").replace(/[\\/]+$/g, "");
  return path.basename(normalized) || "Atlas Vault";
};

const parseVerifyArgs = (argv = process.argv.slice(2), env = process.env) => {
  const config = {
    mode: env.NOTIDIAN_VERIFY_MODE ?? "source",
    vaultPath: env.NOTIDIAN_VAULT_PATH ?? DEFAULT_VAULT_PATH,
    vault: env.NOTIDIAN_REAL_VAULT ?? "",
    pluginId: env.NOTIDIAN_PLUGIN_ID ?? DEFAULT_PLUGIN_ID,
    ui: false,
    adoptSchema: false,
    requireClean: false,
    settleMs: DEFAULT_SETTLE_MS,
  };

  for (const arg of argv) {
    if (arg == "source" || arg == "live") {
      config.mode = arg;
      continue;
    }
    if (arg == "--ui") {
      config.ui = true;
      continue;
    }
    if (arg == "--adopt-schema") {
      config.adoptSchema = true;
      continue;
    }
    if (arg == "--require-clean") {
      config.requireClean = true;
      continue;
    }
    if (arg == "--help" || arg == "-h") {
      config.help = true;
      continue;
    }

    const separator = arg.indexOf("=");
    if (separator < 0) continue;

    const key = arg.slice(0, separator).replace(/^--/, "");
    const value = arg.slice(separator + 1);
    switch (key) {
      case "vault-path":
      case "vaultPath":
        config.vaultPath = value;
        break;
      case "vault":
        config.vault = value;
        break;
      case "plugin-id":
      case "pluginId":
        config.pluginId = value;
        break;
      case "settle-ms":
      case "settleMs":
        config.settleMs = parseIntegerOption(value, config.settleMs);
        break;
    }
  }

  if (!config.vault) {
    config.vault = vaultNameFromPath(config.vaultPath);
  }

  return config;
};

const createSourceVerificationSteps = ({ requireClean = false } = {}) => {
  const steps = [
    {
      label: "Jest test suite",
      command: "npm",
      args: ["test", "--", "--runInBand"],
    },
    {
      label: "TypeScript",
      command: "npx",
      args: ["tsc", "-noEmit", "-skipLibCheck"],
    },
    { label: "npm audit", command: "npm", args: ["audit"] },
    { label: "production build", command: "npm", args: ["run", "build"] },
    {
      label: "git whitespace check",
      command: "git",
      args: ["diff", "--check", "HEAD^", "HEAD", "--", "."],
    },
  ];

  if (!requireClean) return steps;

  return [
    {
      label: "git status before source verification",
      command: "git",
      args: ["status", "--short"],
      requireEmptyStdout: true,
    },
    ...steps,
    {
      label: "git status after source verification",
      command: "git",
      args: ["status", "--short"],
      requireEmptyStdout: true,
    },
  ];
};

const createLiveVerificationSteps = ({
  vaultPath = DEFAULT_VAULT_PATH,
  vault = vaultNameFromPath(vaultPath),
  pluginId = DEFAULT_PLUGIN_ID,
  ui = false,
  adoptSchema = false,
  settleMs = DEFAULT_SETTLE_MS,
} = {}) => {
  const smokeArgs = [
    "run",
    "test:real-vault",
    "--",
    `vault=${vault}`,
    "--allow-write",
    `--plugin-id=${pluginId}`,
  ];
  if (ui) smokeArgs.push("--ui");
  if (adoptSchema) smokeArgs.push("--adopt-schema");

  return [
    {
      label: "live health audit before smoke",
      command: "npm",
      args: [
        "run",
        "health:audit",
        "--",
        `--vault-path=${vaultPath}`,
        "--live",
      ],
    },
    {
      label: "legacy storage migration dry-run",
      command: "npm",
      args: [
        "run",
        "migrate:space-store",
        "--",
        `--vault-path=${vaultPath}`,
        "--json",
      ],
    },
    {
      label: "real-vault smoke",
      command: "npm",
      args: smokeArgs,
    },
    { label: "post-smoke settle", sleepMs: settleMs },
    {
      label: "live health audit after smoke",
      command: "npm",
      args: [
        "run",
        "health:audit",
        "--",
        `--vault-path=${vaultPath}`,
        "--live",
      ],
    },
    {
      label: "Obsidian developer errors",
      command: "obsidian",
      args: [`vault=${vault}`, "dev:errors"],
    },
  ];
};

const defaultRunner = (command, args) =>
  spawnSync(command, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 100 * 1024 * 1024,
  });

const printCommandOutput = (result) => {
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
};

const runVerificationSteps = async (
  steps,
  { runner = defaultRunner, sleep: sleepFn = sleep, log = console.log } = {}
) => {
  const completed = [];
  for (const step of steps) {
    log(`\n== ${step.label} ==`);
    if (step.sleepMs != null) {
      await sleepFn(step.sleepMs);
      completed.push(step);
      continue;
    }

    log(`$ ${[step.command, ...step.args].join(" ")}`);
    const result = runner(step.command, step.args);
    printCommandOutput(result);

    if (result.error) {
      throw new Error(
        `Verification step failed: ${step.label}: ${result.error.message}`
      );
    }

    if (result.status !== 0) {
      throw new Error(`Verification step failed: ${step.label}`);
    }

    if (step.requireEmptyStdout && String(result.stdout ?? "").trim()) {
      throw new Error(
        `Verification step failed: ${step.label}: working tree is not clean`
      );
    }

    completed.push(step);
  }
  return completed;
};

const usage = () => [
  "Usage:",
  "  node scripts/notidianVerify.js source [--require-clean]",
  "  node scripts/notidianVerify.js live [--ui] [--vault-path=<path>] [--vault=<name>]",
  "",
  "Options:",
  "  --require-clean       Require empty git status before and after source checks.",
  "  --ui                  Include the optional live table DOM smoke.",
  "  --adopt-schema        Include the optional schema-adoption preview/confirm smoke.",
  `  --vault-path=<path>    Defaults to ${DEFAULT_VAULT_PATH}.`,
  "  --vault=<name>        Defaults to the vault path basename.",
  `  --plugin-id=<id>      Defaults to ${DEFAULT_PLUGIN_ID}.`,
  `  --settle-ms=<ms>      Defaults to ${DEFAULT_SETTLE_MS}.`,
].join("\n");

const main = async (argv = process.argv.slice(2), env = process.env) => {
  const config = parseVerifyArgs(argv, env);
  if (config.help) {
    console.log(usage());
    return;
  }

  if (config.mode != "source" && config.mode != "live") {
    console.error(`Unknown verification mode: ${config.mode}\n\n${usage()}`);
    process.exitCode = 1;
    return;
  }

  const steps =
    config.mode == "live"
      ? createLiveVerificationSteps(config)
      : createSourceVerificationSteps(config);

  try {
    await runVerificationSteps(steps);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
};

if (require.main === module) {
  main();
}

module.exports = {
  createLiveVerificationSteps,
  createSourceVerificationSteps,
  parseVerifyArgs,
  runVerificationSteps,
};
