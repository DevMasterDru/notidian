const fs = require("fs/promises");
const os = require("os");
const path = require("path");

const {
  buildInstallPlan,
  installPluginToVault,
  parseInstallArgs,
  validateInstallConfig,
} = require("./notidianInstallToVault");

const baseConfig = {
  vaultPath: "/Users/druker/Atlas Vault",
  pluginId: "notidian",
  sourceDir: "/repo/notidian",
  allowWrite: true,
};

const withTempDir = async (testFn) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "notidian-install-"));
  try {
    await testFn(dir);
  } finally {
    await fs.rm(dir, { force: true, recursive: true });
  }
};

const writeBuildArtifacts = async (sourceDir, manifest = { id: "notidian" }) => {
  await fs.mkdir(sourceDir, { recursive: true });
  await fs.writeFile(
    path.join(sourceDir, "manifest.json"),
    JSON.stringify(manifest, null, 2)
  );
  await fs.writeFile(path.join(sourceDir, "main.js"), "main");
  await fs.writeFile(path.join(sourceDir, "styles.css"), "styles");
};

describe("notidian vault installer", () => {
  it("parses explicit CLI options and environment fallbacks", () => {
    expect(
      parseInstallArgs(
        [
          "--vault-path=/Users/druker/Atlas Vault",
          "--plugin-id=notidian-dev",
          "--source-dir=/repo/build",
          "--allow-write",
        ],
        { NOTIDIAN_VAULT_PATH: "/env/vault" }
      )
    ).toEqual({
      vaultPath: "/Users/druker/Atlas Vault",
      pluginId: "notidian-dev",
      sourceDir: "/repo/build",
      allowWrite: true,
    });

    expect(parseInstallArgs([], { NOTIDIAN_VAULT_PATH: "/env/vault" }))
      .toMatchObject({
        vaultPath: "/env/vault",
        pluginId: "notidian",
        allowWrite: false,
      });
  });

  it("rejects writes without a vault path and explicit write approval", () => {
    expect(
      validateInstallConfig({
        ...baseConfig,
        vaultPath: "",
        allowWrite: false,
      })
    ).toEqual([
      "Set --vault-path=<path> or NOTIDIAN_VAULT_PATH before installing.",
      "Pass --allow-write to permit writing plugin files into the vault.",
    ]);
  });

  it("plans the target Obsidian plugin directory and artifact list", () => {
    expect(buildInstallPlan(baseConfig)).toEqual({
      sourceDir: "/repo/notidian",
      targetDir: "/Users/druker/Atlas Vault/.obsidian/plugins/notidian",
      artifacts: ["manifest.json", "main.js", "styles.css"],
    });
  });

  it("copies the current plugin build artifacts into the vault plugin directory", async () => {
    await withTempDir(async (dir) => {
      const sourceDir = path.join(dir, "source");
      const vaultPath = path.join(dir, "vault");
      await writeBuildArtifacts(sourceDir, {
        id: "notidian",
        version: "1.3.4",
      });

      const result = await installPluginToVault({
        ...baseConfig,
        sourceDir,
        vaultPath,
      });

      expect(result).toEqual({
        targetDir: path.join(vaultPath, ".obsidian/plugins/notidian"),
        copied: ["manifest.json", "main.js", "styles.css"],
      });
      await expect(
        fs.readFile(
          path.join(vaultPath, ".obsidian/plugins/notidian/main.js"),
          "utf8"
        )
      ).resolves.toBe("main");
      await expect(
        fs.readFile(
          path.join(vaultPath, ".obsidian/plugins/notidian/styles.css"),
          "utf8"
        )
      ).resolves.toBe("styles");
    });
  });

  it("fails before writing when the manifest id does not match the plugin id", async () => {
    await withTempDir(async (dir) => {
      const sourceDir = path.join(dir, "source");
      const vaultPath = path.join(dir, "vault");
      await writeBuildArtifacts(sourceDir, { id: "make-md" });

      await expect(
        installPluginToVault({
          ...baseConfig,
          sourceDir,
          vaultPath,
        })
      ).rejects.toThrow("manifest id make-md does not match plugin id notidian");
    });
  });

  it("fails before writing when a build artifact is missing", async () => {
    await withTempDir(async (dir) => {
      const sourceDir = path.join(dir, "source");
      const vaultPath = path.join(dir, "vault");
      await fs.mkdir(sourceDir, { recursive: true });
      await fs.writeFile(
        path.join(sourceDir, "manifest.json"),
        JSON.stringify({ id: "notidian" })
      );
      await fs.writeFile(path.join(sourceDir, "main.js"), "main");

      await expect(
        installPluginToVault({
          ...baseConfig,
          sourceDir,
          vaultPath,
        })
      ).rejects.toThrow("Missing build artifact");
    });
  });
});
