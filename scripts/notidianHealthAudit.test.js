const fs = require("fs/promises");
const os = require("os");
const path = require("path");

const {
  findActiveLegacyArtifacts,
  parseHealthArgs,
  runHealthAudit,
} = require("./notidianHealthAudit");

const withTempDir = async (testFn) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "notidian-health-"));
  try {
    await testFn(dir);
  } finally {
    await fs.rm(dir, { force: true, recursive: true });
  }
};

const writeJson = (filePath, value) =>
  fs.writeFile(filePath, JSON.stringify(value, null, 2));

const writeSource = async (sourceDir, version = "1.3.4") => {
  await fs.mkdir(path.join(sourceDir, "docs", "adr"), { recursive: true });
  await writeJson(path.join(sourceDir, "package.json"), {
    name: "notidian",
    version,
    repository: { url: "git+https://github.com/DevMasterDru/notidian.git" },
  });
  await writeJson(path.join(sourceDir, "manifest.json"), {
    id: "notidian",
    name: "Notidian",
    version,
  });
  await fs.writeFile(
    path.join(sourceDir, "docs", "current-state.md"),
    "Notidian-only personal database architecture. Native Obsidian Bases is not a runtime dependency."
  );
  await fs.mkdir(path.join(sourceDir, "src", "shared"), { recursive: true });
  await fs.writeFile(path.join(sourceDir, "src", "main.ts"), "");
  await fs.writeFile(
    path.join(sourceDir, "src", "shared", "pluginIdentity.ts"),
    ""
  );
  await fs.mkdir(path.join(sourceDir, "src", "core", "schemas"), { recursive: true });
  await fs.mkdir(path.join(sourceDir, "src", "shared", "types"), { recursive: true });
  await fs.mkdir(path.join(sourceDir, "src", "adapters", "obsidian"), { recursive: true });
  await fs.mkdir(
    path.join(sourceDir, "src", "core", "react", "components", "System", "SettingsSections"),
    { recursive: true }
  );
  await fs.mkdir(path.join(sourceDir, "src", "core", "superstate"), { recursive: true });
  await fs.mkdir(path.join(sourceDir, "src", "core", "utils", "properties"), { recursive: true });
  await fs.mkdir(path.join(sourceDir, "src", "css", "SpaceViewer"), { recursive: true });
  await Promise.all(
    [
      "src/core/schemas/settings.ts",
      "src/shared/types/settings.ts",
      "src/adapters/obsidian/settings.ts",
      "src/core/react/components/System/SettingsSections/SpaceSettings.tsx",
      "src/core/superstate/superstate.ts",
      "src/core/utils/properties/propertyAuthority.ts",
      "src/css/SpaceViewer/TableView.css",
    ].map((relativePath) => fs.writeFile(path.join(sourceDir, relativePath), ""))
  );
};

const writeVault = async (vaultDir, version = "1.3.4") => {
  const pluginDir = path.join(vaultDir, ".obsidian", "plugins", "notidian");
  await fs.mkdir(pluginDir, { recursive: true });
  await writeJson(path.join(vaultDir, ".obsidian", "community-plugins.json"), [
    "notidian",
  ]);
  await writeJson(path.join(pluginDir, "manifest.json"), {
    id: "notidian",
    name: "Notidian",
    version,
  });
};

const writeContextStore = async (vaultDir, relativeStorePath) => {
  const storePath = path.join(vaultDir, relativeStorePath);
  await fs.mkdir(storePath, { recursive: true });
  await fs.writeFile(path.join(storePath, "context.mdb"), "context");
};

describe("notidian health audit", () => {
  it("parses CLI options and environment fallbacks", () => {
    expect(
      parseHealthArgs(
        [
          "--vault-path=/vault",
          "--source-dir=/repo",
          "--plugin-id=notidian-dev",
          "--skip-vault",
          "--live",
          "--json",
        ],
        { NOTIDIAN_VAULT_PATH: "/env-vault" }
      )
    ).toEqual({
      vaultPath: "/vault",
      sourceDir: "/repo",
      pluginId: "notidian-dev",
      skipVault: true,
      live: true,
      json: true,
    });

    expect(parseHealthArgs([], { NOTIDIAN_VAULT_PATH: "/env-vault" }))
      .toMatchObject({
        vaultPath: "/env-vault",
        pluginId: "notidian",
        skipVault: false,
        live: false,
      });
  });

  it("passes source and vault identity checks for an aligned Notidian install", async () => {
    await withTempDir(async (dir) => {
      const sourceDir = path.join(dir, "source");
      const vaultPath = path.join(dir, "vault");
      await writeSource(sourceDir);
      await writeVault(vaultPath);

      const result = await runHealthAudit({
        sourceDir,
        vaultPath,
        pluginId: "notidian",
        skipVault: false,
        live: false,
      });

      expect(result.ok).toBe(true);
      expect(result.results.every((check) => check.passed)).toBe(true);
    });
  });

  it("fails when the active vault install is not enabled or version-aligned", async () => {
    await withTempDir(async (dir) => {
      const sourceDir = path.join(dir, "source");
      const vaultPath = path.join(dir, "vault");
      await writeSource(sourceDir, "1.3.4");
      await writeVault(vaultPath, "1.3.3");
      await writeJson(path.join(vaultPath, ".obsidian", "community-plugins.json"), []);

      const result = await runHealthAudit({
        sourceDir,
        vaultPath,
        pluginId: "notidian",
        skipVault: false,
        live: false,
      });

      expect(result.ok).toBe(false);
      expect(result.results).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: "Notidian is enabled in the vault", passed: false }),
          expect.objectContaining({ name: "installed manifest version matches source", passed: false }),
        ])
      );
    });
  });

  it("checks live Obsidian runtime state when requested", async () => {
    await withTempDir(async (dir) => {
      const sourceDir = path.join(dir, "source");
      await writeSource(sourceDir);

      const commands = [];
      const runner = (command, args) => {
        commands.push([command, args]);
        if (args[0] == "eval") {
          return '=> {"notidianEnabled":true,"notidianLoaded":true,"basesCore":false,"retiredSyncSettingsPresent":[],"spaceSubFolder":".notidian","legacyStorageRootGuardInstalled":true,"spaceAdapterSchemes":[["spaces","vault"]],"rootCachePersisters":[".notidian/superstate.mdc",".notidian/fileCache.mdc"]}';
        }
        if (args[0] == "dev:errors") {
          return "No errors captured.";
        }
        throw new Error(`unexpected command ${command} ${args.join(" ")}`);
      };

      const result = await runHealthAudit({
        sourceDir,
        vaultPath: "",
        pluginId: "notidian",
        skipVault: true,
        live: true,
        runner,
      });

      expect(result.ok).toBe(true);
      expect(commands.map(([command]) => command)).toEqual(["obsidian", "obsidian"]);
    });
  });

  it("fails when active source exposes retired context-to-frontmatter sync settings", async () => {
    await withTempDir(async (dir) => {
      const sourceDir = path.join(dir, "source");
      await writeSource(sourceDir);
      await fs.writeFile(
        path.join(sourceDir, "src", "core", "schemas", "settings.ts"),
        "export const DEFAULT_SETTINGS = { saveAllContextToFrontmatter: true };"
      );

      const result = await runHealthAudit({
        sourceDir,
        vaultPath: "",
        pluginId: "notidian",
        skipVault: true,
        live: false,
      });

      expect(result.ok).toBe(false);
      expect(result.results).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            name: "source has no active context-to-frontmatter bulk sync settings",
            passed: false,
          }),
        ])
      );
    });
  });

  it("fails live health when retired sync settings remain loaded", async () => {
    await withTempDir(async (dir) => {
      const sourceDir = path.join(dir, "source");
      await writeSource(sourceDir);

      const runner = (command, args) => {
        if (args[0] == "eval") {
          return '=> {"notidianEnabled":true,"notidianLoaded":true,"basesCore":false,"retiredSyncSettingsPresent":["syncFormulaToFrontmatter"],"spaceSubFolder":".notidian","legacyStorageRootGuardInstalled":true,"spaceAdapterSchemes":[["spaces","vault"]],"rootCachePersisters":[".notidian/superstate.mdc",".notidian/fileCache.mdc"]}';
        }
        if (args[0] == "dev:errors") {
          return "No errors captured.";
        }
        throw new Error(`unexpected command ${command} ${args.join(" ")}`);
      };

      const result = await runHealthAudit({
        sourceDir,
        vaultPath: "",
        pluginId: "notidian",
        skipVault: true,
        live: true,
        runner,
      });

      expect(result.ok).toBe(false);
      expect(result.results).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            name: "live Notidian settings have no retired context-to-frontmatter sync keys",
            passed: false,
          }),
        ])
      );
    });
  });

  it("fails when active source writes runtime caches into .makemd", async () => {
    await withTempDir(async (dir) => {
      const sourceDir = path.join(dir, "source");
      await writeSource(sourceDir);
      await fs.mkdir(
        path.join(sourceDir, "src", "adapters", "obsidian", "filesystem"),
        { recursive: true }
      );
      await fs.writeFile(
        path.join(
          sourceDir,
          "src",
          "adapters",
          "obsidian",
          "filesystem",
          "filesystem.ts"
        ),
        "const cachePath = '.makemd/fileCache.mdc';"
      );

      const result = await runHealthAudit({
        sourceDir,
        vaultPath: "",
        pluginId: "notidian",
        skipVault: true,
        live: false,
      });

      expect(result.ok).toBe(false);
      expect(result.results).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            name: "source has no active .makemd runtime cache path",
            passed: false,
          }),
        ])
      );
    });
  });

  it("fails when active source keeps orphaned native Bases view styling", async () => {
    await withTempDir(async (dir) => {
      const sourceDir = path.join(dir, "source");
      await writeSource(sourceDir);
      await fs.writeFile(
        path.join(sourceDir, "src", "css", "SpaceViewer", "TableView.css"),
        ".notidian-bases-table-view { display: flex; }"
      );

      const result = await runHealthAudit({
        sourceDir,
        vaultPath: "",
        pluginId: "notidian",
        skipVault: true,
        live: false,
      });

      expect(result.ok).toBe(false);
      expect(result.results).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            name: "source has no orphaned native Bases view styling",
            passed: false,
          }),
        ])
      );
    });
  });

  it("fails when the vault still has active legacy Make.md plugin data paths", async () => {
    await withTempDir(async (dir) => {
      const sourceDir = path.join(dir, "source");
      const vaultPath = path.join(dir, "vault");
      await writeSource(sourceDir);
      await writeVault(vaultPath);
      await fs.mkdir(path.join(vaultPath, ".makemd"), { recursive: true });

      const result = await runHealthAudit({
        sourceDir,
        vaultPath,
        pluginId: "notidian",
        skipVault: false,
        live: false,
      });

      expect(result.ok).toBe(false);
      expect(result.results).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            name: "vault has no active legacy Make.md plugin or root cache",
            passed: false,
          }),
        ])
      );
    });
  });

  it("fails when the vault still has active .space compatibility stores", async () => {
    await withTempDir(async (dir) => {
      const sourceDir = path.join(dir, "source");
      const vaultPath = path.join(dir, "vault");
      await writeSource(sourceDir);
      await writeVault(vaultPath);
      await writeContextStore(vaultPath, path.join("Devices", ".space"));

      const result = await runHealthAudit({
        sourceDir,
        vaultPath,
        pluginId: "notidian",
        skipVault: false,
        live: false,
      });

      expect(result.ok).toBe(false);
      expect(result.results).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            name: "vault has no active .space compatibility stores",
            passed: false,
          }),
        ])
      );
    });
  });

  it("fails when active vault legacy storage or .base artifacts remain outside pruned paths", async () => {
    await withTempDir(async (dir) => {
      const sourceDir = path.join(dir, "source");
      const vaultPath = path.join(dir, "vault");
      await writeSource(sourceDir);
      await writeVault(vaultPath);
      await fs.mkdir(path.join(vaultPath, "Devices", ".makemd"), {
        recursive: true,
      });
      await fs.mkdir(path.join(vaultPath, "Dashboards"), {
        recursive: true,
      });
      await fs.writeFile(path.join(vaultPath, "Dashboards", "active.base"), "");
      await fs.mkdir(path.join(vaultPath, "Archive", "Old", ".makemd"), {
        recursive: true,
      });
      await fs.mkdir(path.join(vaultPath, "Devices", ".trash", ".space"), {
        recursive: true,
      });
      await fs.mkdir(path.join(vaultPath, "temp_ignore"), {
        recursive: true,
      });
      await fs.writeFile(
        path.join(vaultPath, "temp_ignore", "ignored.base"),
        ""
      );

      const result = await runHealthAudit({
        sourceDir,
        vaultPath,
        pluginId: "notidian",
        skipVault: false,
        live: false,
      });

      expect(result.ok).toBe(false);
      expect(await findActiveLegacyArtifacts(vaultPath)).toEqual([
        "Dashboards/active.base",
        "Devices/.makemd",
      ]);
      expect(result.results).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            name: "vault has no active legacy storage or Bases artifacts",
            passed: false,
            detail: "Dashboards/active.base, Devices/.makemd",
          }),
        ])
      );
    });
  });

  it("fails live health when Notidian registers non-local space adapters", async () => {
    await withTempDir(async (dir) => {
      const sourceDir = path.join(dir, "source");
      await writeSource(sourceDir);

      const runner = (command, args) => {
        if (args[0] == "eval") {
          return '=> {"notidianEnabled":true,"notidianLoaded":true,"basesCore":false,"retiredSyncSettingsPresent":[],"spaceSubFolder":".notidian","legacyStorageRootGuardInstalled":true,"spaceAdapterSchemes":[["spaces","vault"],["web"]],"rootCachePersisters":[".notidian/superstate.mdc",".notidian/fileCache.mdc"]}';
        }
        if (args[0] == "dev:errors") {
          return "No errors captured.";
        }
        throw new Error(`unexpected command ${command} ${args.join(" ")}`);
      };

      const result = await runHealthAudit({
        sourceDir,
        vaultPath: "",
        pluginId: "notidian",
        skipVault: true,
        live: true,
        runner,
      });

      expect(result.ok).toBe(false);
      expect(result.results).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            name: "live Notidian space adapters are local vault only",
            passed: false,
          }),
        ])
      );
    });
  });

  it("fails live health when root cache persisters point outside .notidian", async () => {
    await withTempDir(async (dir) => {
      const sourceDir = path.join(dir, "source");
      await writeSource(sourceDir);

      const runner = (command, args) => {
        if (args[0] == "eval") {
          return '=> {"notidianEnabled":true,"notidianLoaded":true,"basesCore":false,"retiredSyncSettingsPresent":[],"spaceSubFolder":".notidian","legacyStorageRootGuardInstalled":true,"spaceAdapterSchemes":[["spaces","vault"]],"rootCachePersisters":[".notidian/superstate.mdc",".makemd/fileCache.mdc"]}';
        }
        if (args[0] == "dev:errors") {
          return "No errors captured.";
        }
        throw new Error(`unexpected command ${command} ${args.join(" ")}`);
      };

      const result = await runHealthAudit({
        sourceDir,
        vaultPath: "",
        pluginId: "notidian",
        skipVault: true,
        live: true,
        runner,
      });

      expect(result.ok).toBe(false);
      expect(result.results).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            name: "live Notidian root cache persisters use .notidian",
            passed: false,
          }),
        ])
      );
    });
  });

  it("fails live health when Notidian still uses .space as the storage root", async () => {
    await withTempDir(async (dir) => {
      const sourceDir = path.join(dir, "source");
      await writeSource(sourceDir);

      const runner = (command, args) => {
        if (args[0] == "eval") {
          return '=> {"notidianEnabled":true,"notidianLoaded":true,"basesCore":false,"retiredSyncSettingsPresent":[],"spaceSubFolder":".space","legacyStorageRootGuardInstalled":true,"spaceAdapterSchemes":[["spaces","vault"]],"rootCachePersisters":[".notidian/superstate.mdc",".notidian/fileCache.mdc"]}';
        }
        if (args[0] == "dev:errors") {
          return "No errors captured.";
        }
        throw new Error(`unexpected command ${command} ${args.join(" ")}`);
      };

      const result = await runHealthAudit({
        sourceDir,
        vaultPath: "",
        pluginId: "notidian",
        skipVault: true,
        live: true,
        runner,
      });

      expect(result.ok).toBe(false);
      expect(result.results).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            name: "live Notidian storage root is .notidian",
            passed: false,
          }),
        ])
      );
    });
  });

  it("fails live health when the legacy storage root guard is absent", async () => {
    await withTempDir(async (dir) => {
      const sourceDir = path.join(dir, "source");
      await writeSource(sourceDir);

      const runner = (command, args) => {
        if (args[0] == "eval") {
          return '=> {"notidianEnabled":true,"notidianLoaded":true,"basesCore":false,"retiredSyncSettingsPresent":[],"spaceSubFolder":".notidian","legacyStorageRootGuardInstalled":false,"spaceAdapterSchemes":[["spaces","vault"]],"rootCachePersisters":[".notidian/superstate.mdc",".notidian/fileCache.mdc"]}';
        }
        if (args[0] == "dev:errors") {
          return "No errors captured.";
        }
        throw new Error(`unexpected command ${command} ${args.join(" ")}`);
      };

      const result = await runHealthAudit({
        sourceDir,
        vaultPath: "",
        pluginId: "notidian",
        skipVault: true,
        live: true,
        runner,
      });

      expect(result.ok).toBe(false);
      expect(result.results).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            name: "live legacy storage root guard is installed",
            passed: false,
          }),
        ])
      );
    });
  });

  it("fails when source can automatically read legacy Make.md plugin data", async () => {
    await withTempDir(async (dir) => {
      const sourceDir = path.join(dir, "source");
      await writeSource(sourceDir);
      await fs.writeFile(
        path.join(sourceDir, "src", "main.ts"),
        "async function loadDataWithLegacyFallback() { return legacyPluginDataPath; }"
      );

      const result = await runHealthAudit({
        sourceDir,
        vaultPath: "",
        pluginId: "notidian",
        skipVault: true,
        live: false,
      });

      expect(result.ok).toBe(false);
      expect(result.results).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            name: "source has no automatic legacy Make.md plugin data fallback",
            passed: false,
          }),
        ])
      );
    });
  });

  it("fails when active source exposes Make.md web kit or remote space paths", async () => {
    await withTempDir(async (dir) => {
      const sourceDir = path.join(dir, "source");
      await writeSource(sourceDir);
      await fs.mkdir(
        path.join(sourceDir, "src", "core", "spaceManager", "webAdapter"),
        { recursive: true }
      );
      await fs.writeFile(
        path.join(
          sourceDir,
          "src",
          "core",
          "spaceManager",
          "webAdapter",
          "webAdapter.ts"
        ),
        "const legacyMakeMdWebHost = 'https://www.make.md';"
      );

      const result = await runHealthAudit({
        sourceDir,
        vaultPath: "",
        pluginId: "notidian",
        skipVault: true,
        live: false,
      });

      expect(result.ok).toBe(false);
      expect(result.results).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            name: "source has no active Make.md web kit or remote space entry points",
            passed: false,
          }),
        ])
      );
    });
  });

  it("fails when package dependencies point to Make.md GitHub forks", async () => {
    await withTempDir(async (dir) => {
      const sourceDir = path.join(dir, "source");
      await writeSource(sourceDir);
      const packageJson = JSON.parse(
        await fs.readFile(path.join(sourceDir, "package.json"), "utf8")
      );
      packageJson.dependencies = { vaul: "github:make-md/vaul" };
      await writeJson(path.join(sourceDir, "package.json"), packageJson);

      const result = await runHealthAudit({
        sourceDir,
        vaultPath: "",
        pluginId: "notidian",
        skipVault: true,
        live: false,
      });

      expect(result.ok).toBe(false);
      expect(result.results).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            name: "package dependencies do not use Make.md GitHub forks",
            passed: false,
          }),
        ])
      );
    });
  });
});
