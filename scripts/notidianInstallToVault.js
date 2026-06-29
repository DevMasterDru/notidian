const fs = require("fs/promises");
const path = require("path");

const DEFAULT_PLUGIN_ID = "notidian";
const BUILD_ARTIFACTS = ["manifest.json", "main.js", "styles.css"];

const parseInstallArgs = (
  argv = process.argv.slice(2),
  env = process.env
) => {
  const config = {
    vaultPath: env.NOTIDIAN_VAULT_PATH ?? "",
    pluginId: DEFAULT_PLUGIN_ID,
    sourceDir: process.cwd(),
    allowWrite: false,
  };

  for (const arg of argv) {
    if (arg == "--allow-write") {
      config.allowWrite = true;
      continue;
    }

    const separator = arg.indexOf("=");
    if (separator < 0) continue;

    const key = arg.slice(0, separator).replace(/^--/, "");
    const value = arg.slice(separator + 1);
    switch (key) {
      case "vault-path":
      case "vault":
        config.vaultPath = value;
        break;
      case "plugin-id":
        config.pluginId = value;
        break;
      case "source-dir":
        config.sourceDir = value;
        break;
    }
  }

  return config;
};

const validateInstallConfig = (config) => {
  const errors = [];

  if (!String(config.vaultPath ?? "").trim()) {
    errors.push("Set --vault-path=<path> or NOTIDIAN_VAULT_PATH before installing.");
  }

  if (!String(config.pluginId ?? "").trim()) {
    errors.push("Set --plugin-id to a non-empty Obsidian plugin id.");
  }

  if (!String(config.sourceDir ?? "").trim()) {
    errors.push("Set --source-dir to the repository build output directory.");
  }

  if (!config.allowWrite) {
    errors.push("Pass --allow-write to permit writing plugin files into the vault.");
  }

  return errors;
};

const buildInstallPlan = (config) => ({
  sourceDir: config.sourceDir,
  targetDir: path.join(
    config.vaultPath,
    ".obsidian",
    "plugins",
    config.pluginId
  ),
  artifacts: [...BUILD_ARTIFACTS],
});

const readManifest = async (sourceDir) => {
  const manifestPath = path.join(sourceDir, "manifest.json");
  try {
    return JSON.parse(await fs.readFile(manifestPath, "utf8"));
  } catch (error) {
    throw new Error(
      `Unable to read ${manifestPath}: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
};

const assertArtifactsReady = async (plan, pluginId) => {
  for (const artifact of plan.artifacts) {
    const sourcePath = path.join(plan.sourceDir, artifact);
    try {
      const stat = await fs.stat(sourcePath);
      if (!stat.isFile()) {
        throw new Error(`${sourcePath} is not a file`);
      }
    } catch (error) {
      throw new Error(
        `Missing build artifact ${sourcePath}: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  const manifest = await readManifest(plan.sourceDir);
  if (manifest.id !== pluginId) {
    throw new Error(
      `manifest id ${manifest.id} does not match plugin id ${pluginId}`
    );
  }
};

const installPluginToVault = async (config) => {
  const errors = validateInstallConfig(config);
  if (errors.length > 0) {
    throw new Error(errors.join("\n"));
  }

  const plan = buildInstallPlan(config);
  await assertArtifactsReady(plan, config.pluginId);
  await fs.mkdir(plan.targetDir, { recursive: true });

  for (const artifact of plan.artifacts) {
    await fs.copyFile(
      path.join(plan.sourceDir, artifact),
      path.join(plan.targetDir, artifact)
    );
  }

  const symlinkWarnings = await checkVaultSymlinks(config.vaultPath);
  return {
    targetDir: plan.targetDir,
    copied: plan.artifacts,
    symlinkWarnings,
  };
};

const checkVaultSymlinks = async (vaultPath) => {
  const warnings = [];
  try {
    const entries = await fs.readdir(vaultPath, { withFileTypes: true, recursive: true });
    for (const entry of entries) {
      if (entry.isSymbolicLink()) {
        const full = path.join(entry.parentPath ?? entry.path, entry.name);
        const rel = path.relative(vaultPath, full);
        const target = await fs.readlink(full);
        warnings.push(`${rel} -> ${target}`);
      }
    }
  } catch { /* readdir recursive may not be available */ }
  return warnings;
};

const usage = () => [
  "Usage:",
  '  npm run install:vault -- --vault-path="/Users/druker/Atlas Vault" --allow-write',
  "",
  "Options:",
  "  --vault-path=<path>      Required unless NOTIDIAN_VAULT_PATH is set.",
  "  --allow-write            Required before writing plugin files.",
  "  --plugin-id=<id>         Defaults to notidian.",
  "  --source-dir=<path>      Defaults to the current working directory.",
].join("\n");

const main = async (argv = process.argv.slice(2), env = process.env) => {
  const config = parseInstallArgs(argv, env);
  const errors = validateInstallConfig(config);

  if (errors.length > 0) {
    console.error(`${errors.join("\n")}\n\n${usage()}`);
    process.exitCode = 1;
    return;
  }

  try {
    const result = await installPluginToVault(config);
    console.log(
      `Installed ${result.copied.join(", ")} to ${result.targetDir}.`
    );
    if (result.symlinkWarnings?.length > 0) {
      console.warn(`\n\x1b[33m[deploy:vault] WARNING: ${result.symlinkWarnings.length} symlink(s) in vault (can cause Obsidian OOM):\x1b[0m`);
      result.symlinkWarnings.forEach(w => console.warn(`  ${w}`));
      console.warn(`Remove directory symlinks — use stub .md files instead.\n`);
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
};

if (require.main === module) {
  main();
}

module.exports = {
  buildInstallPlan,
  installPluginToVault,
  parseInstallArgs,
  validateInstallConfig,
};
