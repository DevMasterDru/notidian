const fs = require("fs/promises");
const os = require("os");
const path = require("path");

const {
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
          return '=> {"notidianEnabled":true,"notidianLoaded":true,"basesCore":false}';
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
});
