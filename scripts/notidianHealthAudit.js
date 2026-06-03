const fs = require("fs/promises");
const path = require("path");
const { execFileSync } = require("child_process");

const DEFAULT_PLUGIN_ID = "notidian";
const DEFAULT_VAULT_PATH = "/Users/druker/Atlas Vault";

const parseHealthArgs = (
  argv = process.argv.slice(2),
  env = process.env
) => {
  const config = {
    vaultPath: env.NOTIDIAN_VAULT_PATH ?? DEFAULT_VAULT_PATH,
    sourceDir: process.cwd(),
    pluginId: DEFAULT_PLUGIN_ID,
    skipVault: false,
    live: false,
    json: false,
  };

  for (const arg of argv) {
    if (arg == "--skip-vault") {
      config.skipVault = true;
      continue;
    }
    if (arg == "--live") {
      config.live = true;
      continue;
    }
    if (arg == "--json") {
      config.json = true;
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
      case "vault":
      case "vault-path":
        config.vaultPath = value;
        break;
      case "source-dir":
        config.sourceDir = value;
        break;
      case "plugin-id":
        config.pluginId = value;
        break;
    }
  }

  return config;
};

const readJson = async (filePath) =>
  JSON.parse(await fs.readFile(filePath, "utf8"));

const readText = async (filePath) => fs.readFile(filePath, "utf8");

const readTextIfExists = async (filePath) => {
  try {
    return await readText(filePath);
  } catch (error) {
    if (error?.code == "ENOENT") return "";
    throw error;
  }
};

const defaultRunner = (command, args) =>
  execFileSync(command, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });

const addCheck = async (results, name, predicate, detail) => {
  let passed = false;
  let message = detail;
  try {
    passed = Boolean(await predicate());
  } catch (error) {
    message = error instanceof Error ? error.message : String(error);
  }
  results.push({ name, passed, detail: message });
};

const stripEvalPrefix = (output) => String(output).trim().replace(/^=>\s*/, "");

const runHealthAudit = async (config) => {
  const results = [];
  const runner = config.runner ?? defaultRunner;
  const sourceDir = config.sourceDir;
  const pkg = await readJson(path.join(sourceDir, "package.json"));
  const manifest = await readJson(path.join(sourceDir, "manifest.json"));

  await addCheck(
    results,
    "package name is notidian",
    () => pkg.name == "notidian",
    pkg.name
  );
  await addCheck(
    results,
    "manifest id is notidian",
    () => manifest.id == config.pluginId,
    manifest.id
  );
  await addCheck(
    results,
    "manifest name is Notidian",
    () => manifest.name == "Notidian",
    manifest.name
  );
  await addCheck(
    results,
    "source versions are aligned",
    () => pkg.version == manifest.version,
    `${pkg.version} / ${manifest.version}`
  );
  await addCheck(
    results,
    "repository points to Notidian",
    () => String(pkg.repository?.url ?? "").includes("DevMasterDru/notidian"),
    pkg.repository?.url
  );
  await addCheck(results, "current docs preserve Notidian-only architecture", async () => {
    const currentState = await readText(path.join(sourceDir, "docs", "current-state.md"));
    return (
      currentState.includes("Notidian-only personal") &&
      currentState.includes("Native Obsidian Bases is not")
    );
  });
  await addCheck(
    results,
    "source has no automatic legacy Make.md plugin data fallback",
    async () => {
      const main = await readText(path.join(sourceDir, "src", "main.ts"));
      const identity = await readText(
        path.join(sourceDir, "src", "shared", "pluginIdentity.ts")
      );
      return (
        !main.includes("loadDataWithLegacyFallback") &&
        !main.includes("pluginDataFilePathWithLegacyFallback") &&
        !main.includes("migrateLegacyPluginDataFile") &&
        !main.includes("legacyPluginDataPath") &&
        !identity.includes("legacyPluginDataDir") &&
        !identity.includes("legacyPluginDataPath")
      );
    }
  );
  await addCheck(
    results,
    "source has no active Make.md web kit or remote space entry points",
    async () => {
      const activeRuntimeFiles = [
        "src/shared/pluginIdentity.ts",
        "src/main.ts",
        "src/adapters/obsidian/ui/kit/InstallKitModal.tsx",
        "src/core/spaceManager/webAdapter/webAdapter.ts",
        "src/core/spaceManager/webAdapter/webCache.ts",
      ];
      const blockedRuntimeText = [
        "legacyMakeMdWebHost",
        "legacyMakeMdKitUrlPrefix",
        "https://www.make.md",
        "static/kits",
        "new WebSpaceAdapter",
        "addSpaceAdapter(webSpaceAdapter",
      ];
      for (const relativePath of activeRuntimeFiles) {
        const text = await readTextIfExists(path.join(sourceDir, relativePath));
        if (blockedRuntimeText.some((blocked) => text.includes(blocked))) {
          return false;
        }
      }
      return true;
    }
  );
  await addCheck(
    results,
    "package dependencies do not use Make.md GitHub forks",
    async () => {
      const packageLock = await readTextIfExists(
        path.join(sourceDir, "package-lock.json")
      );
      const dependencyText = [
        JSON.stringify(pkg.dependencies ?? {}),
        JSON.stringify(pkg.devDependencies ?? {}),
        JSON.stringify(pkg.optionalDependencies ?? {}),
        packageLock,
      ].join("\n");
      const blockedDependencyText = [
        "github:make-md",
        "github.com/make-md",
        "git@github.com:make-md",
        "git+ssh://git@github.com/make-md",
      ];
      return !blockedDependencyText.some((blocked) =>
        dependencyText.includes(blocked)
      );
    }
  );
  await addCheck(
    results,
    "source has no active context-to-frontmatter bulk sync settings",
    async () => {
      const retiredSettings = [
        "saveAllContextToFrontmatter",
        "syncFormulaToFrontmatter",
      ];
      const activeRuntimeFiles = [
        "src/core/schemas/settings.ts",
        "src/shared/types/settings.ts",
        "src/adapters/obsidian/settings.ts",
        "src/core/react/components/System/SettingsSections/SpaceSettings.tsx",
        "src/core/superstate/superstate.ts",
        "src/core/utils/properties/propertyAuthority.ts",
      ];
      for (const relativePath of activeRuntimeFiles) {
        const text = await readText(path.join(sourceDir, relativePath));
        if (retiredSettings.some((setting) => text.includes(setting))) {
          return false;
        }
      }
      return true;
    }
  );

  if (!config.skipVault) {
    const pluginDir = path.join(
      config.vaultPath,
      ".obsidian",
      "plugins",
      config.pluginId
    );
    const communityPluginsPath = path.join(
      config.vaultPath,
      ".obsidian",
      "community-plugins.json"
    );
    const installedManifest = await readJson(path.join(pluginDir, "manifest.json"));
    const enabledPlugins = await readJson(communityPluginsPath);

    await addCheck(
      results,
      "installed manifest id is notidian",
      () => installedManifest.id == config.pluginId,
      installedManifest.id
    );
    await addCheck(
      results,
      "installed manifest version matches source",
      () => installedManifest.version == manifest.version,
      `${installedManifest.version} / ${manifest.version}`
    );
    await addCheck(
      results,
      "Notidian is enabled in the vault",
      () => enabledPlugins.includes(config.pluginId)
    );
  }

  if (config.live) {
    const state = JSON.parse(
      stripEvalPrefix(
        runner("obsidian", [
          "eval",
          "code=JSON.stringify({notidianEnabled: app.plugins.enabledPlugins.has('notidian'), notidianLoaded: Boolean(app.plugins.plugins.notidian), basesCore: app.internalPlugins?.plugins?.bases ? app.internalPlugins.plugins.bases.enabled : null, retiredSyncSettingsPresent: ['saveAllContextToFrontmatter','syncFormulaToFrontmatter'].filter((key) => Object.prototype.hasOwnProperty.call(app.plugins.plugins.notidian?.superstate?.settings ?? {}, key))})",
        ])
      )
    );
    const errors = String(runner("obsidian", ["dev:errors"]));

    await addCheck(
      results,
      "live Notidian plugin is enabled",
      () => state.notidianEnabled === true,
      JSON.stringify(state)
    );
    await addCheck(
      results,
      "live Notidian plugin is loaded",
      () => state.notidianLoaded === true,
      JSON.stringify(state)
    );
    await addCheck(
      results,
      "native Bases core plugin is disabled",
      () => state.basesCore === false,
      JSON.stringify(state)
    );
    await addCheck(
      results,
      "live Notidian settings have no retired context-to-frontmatter sync keys",
      () => Array.isArray(state.retiredSyncSettingsPresent) && state.retiredSyncSettingsPresent.length === 0,
      JSON.stringify(state)
    );
    await addCheck(
      results,
      "Obsidian reports no captured errors",
      () => errors.includes("No errors captured."),
      errors.trim()
    );
  }

  return {
    ok: results.every((result) => result.passed),
    results,
  };
};

const usage = () => [
  "Usage:",
  '  npm run health:audit -- --vault-path="/Users/druker/Atlas Vault" --live',
  "",
  "Options:",
  "  --vault-path=<path>      Defaults to NOTIDIAN_VAULT_PATH or /Users/druker/Atlas Vault.",
  "  --source-dir=<path>      Defaults to the current working directory.",
  "  --plugin-id=<id>         Defaults to notidian.",
  "  --skip-vault             Skip installed-vault manifest and enablement checks.",
  "  --live                   Check live Obsidian plugin state and dev errors.",
  "  --json                   Emit JSON.",
].join("\n");

const main = async (argv = process.argv.slice(2), env = process.env) => {
  const config = parseHealthArgs(argv, env);
  if (config.help) {
    console.log(usage());
    return;
  }

  try {
    const audit = await runHealthAudit(config);
    if (config.json) {
      console.log(JSON.stringify(audit, null, 2));
    } else {
      for (const result of audit.results) {
        const prefix = result.passed ? "PASS" : "FAIL";
        const detail = result.detail === undefined ? "" : ` (${result.detail})`;
        console.log(`${prefix} ${result.name}${detail}`);
      }
    }
    if (!audit.ok) process.exitCode = 1;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
};

if (require.main === module) {
  main();
}

module.exports = {
  parseHealthArgs,
  runHealthAudit,
};
