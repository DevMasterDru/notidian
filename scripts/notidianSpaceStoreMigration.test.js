const fs = require("fs/promises");
const os = require("os");
const path = require("path");

const {
  executeSpaceStoreMigration,
  planSpaceStoreMigration,
} = require("./notidianSpaceStoreMigration");

const withTempDir = async (testFn) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "notidian-space-migration-"));
  try {
    await testFn(dir);
  } finally {
    await fs.rm(dir, { force: true, recursive: true });
  }
};

const writeFile = async (filePath, content) => {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content);
};

const pathExists = async (filePath) => {
  try {
    await fs.access(filePath);
    return true;
  } catch (error) {
    if (error?.code == "ENOENT") return false;
    throw error;
  }
};

describe("notidian space store migration", () => {
  it("copies .space stores to .notidian and moves originals to an external backup", async () => {
    await withTempDir(async (dir) => {
      const vaultPath = path.join(dir, "vault");
      const backupRoot = path.join(dir, "backups");
      await writeFile(path.join(vaultPath, ".space", "lang.json"), "{}");
      await writeFile(
        path.join(vaultPath, ".space", "iconsets", "iconsets.json"),
        JSON.stringify({
          custom: {
            path: ".space/assets/icons/custom",
            nestedPath: "Folder/.space/assets/icons/custom",
            rootCachePath: ".makemd/fileCache.mdc",
          },
        })
      );
      await writeFile(path.join(vaultPath, ".space", "assets", "icons", "custom", "a.svg"), "<svg/>");
      await writeFile(path.join(vaultPath, ".notidian", "fileCache.mdc"), "cache");
      await writeFile(
        path.join(vaultPath, "Devices", ".space", "context.mdb"),
        "context"
      );

      const plan = await planSpaceStoreMigration({
        vaultPath,
        backupRoot,
        timestamp: "20260603T120000",
      });

      expect(plan.ok).toBe(true);
      expect(plan.conflicts).toEqual([]);
      expect(
        plan.stores.map((store) => ({
          source: store.relativeSource,
          target: store.relativeTarget,
          mode: store.mode,
        }))
      ).toEqual([
        { source: ".space", target: ".notidian", mode: "merge" },
        { source: "Devices/.space", target: "Devices/.notidian", mode: "create" },
      ]);

      await executeSpaceStoreMigration(plan, { allowWrite: true });

      expect(await pathExists(path.join(vaultPath, ".space"))).toBe(false);
      expect(await pathExists(path.join(vaultPath, "Devices", ".space"))).toBe(false);
      await expect(fs.readFile(path.join(vaultPath, ".notidian", "fileCache.mdc"), "utf8"))
        .resolves.toBe("cache");
      await expect(fs.readFile(path.join(vaultPath, ".notidian", "lang.json"), "utf8"))
        .resolves.toBe("{}");
      await expect(
        fs.readFile(path.join(vaultPath, ".notidian", "iconsets", "iconsets.json"), "utf8")
      ).resolves.toContain(".notidian/assets/icons/custom");
      const iconsetJson = await fs.readFile(
        path.join(vaultPath, ".notidian", "iconsets", "iconsets.json"),
        "utf8"
      );
      expect(iconsetJson).toContain("Folder/.notidian/assets/icons/custom");
      expect(iconsetJson).toContain(".notidian/fileCache.mdc");
      await expect(
        fs.readFile(path.join(vaultPath, "Devices", ".notidian", "context.mdb"), "utf8")
      ).resolves.toBe("context");
      expect(await pathExists(path.join(backupRoot, "20260603T120000", ".space")))
        .toBe(true);
      expect(
        await pathExists(path.join(backupRoot, "20260603T120000", "Devices", ".space"))
      ).toBe(true);
    });
  });

  it("fails closed when .space and .notidian contain different files at the same path", async () => {
    await withTempDir(async (dir) => {
      const vaultPath = path.join(dir, "vault");
      const backupRoot = path.join(dir, "backups");
      await writeFile(path.join(vaultPath, ".space", "lang.json"), "{\"a\":1}");
      await writeFile(path.join(vaultPath, ".notidian", "lang.json"), "{\"a\":2}");

      const plan = await planSpaceStoreMigration({
        vaultPath,
        backupRoot,
        timestamp: "20260603T120000",
      });

      expect(plan.ok).toBe(false);
      expect(plan.conflicts).toEqual([
        expect.objectContaining({
          source: path.join(vaultPath, ".space", "lang.json"),
          target: path.join(vaultPath, ".notidian", "lang.json"),
        }),
      ]);
      await expect(executeSpaceStoreMigration(plan, { allowWrite: true }))
        .rejects.toThrow(/conflict/i);
      expect(await pathExists(path.join(vaultPath, ".space"))).toBe(true);
    });
  });

  it("requires an explicit write flag", async () => {
    await withTempDir(async (dir) => {
      const vaultPath = path.join(dir, "vault");
      const backupRoot = path.join(dir, "backups");
      await writeFile(path.join(vaultPath, "Devices", ".space", "context.mdb"), "context");

      const plan = await planSpaceStoreMigration({
        vaultPath,
        backupRoot,
        timestamp: "20260603T120000",
      });

      await expect(executeSpaceStoreMigration(plan)).rejects.toThrow(/allow-write/i);
      expect(await pathExists(path.join(vaultPath, "Devices", ".space"))).toBe(true);
    });
  });
});
