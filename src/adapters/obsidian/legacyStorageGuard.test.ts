import { installLegacyStorageRootGuard } from "./legacyStorageGuard";

describe("legacy storage guard", () => {
  it("normalizes retired storage roots before vault adapter operations", async () => {
    const calls: [string, unknown[]][] = [];
    const adapter = {
      mkdir: jest.fn(async (...args: unknown[]) => calls.push(["mkdir", args])),
      writeBinary: jest.fn(async (...args: unknown[]) =>
        calls.push(["writeBinary", args])
      ),
      rename: jest.fn(async (...args: unknown[]) =>
        calls.push(["rename", args])
      ),
    };
    const uninstallers: Array<() => void> = [];
    const plugin = {
      app: { vault: { adapter } },
      register: jest.fn((uninstaller: () => void) =>
        uninstallers.push(uninstaller)
      ),
    };

    installLegacyStorageRootGuard(plugin as any);

    await adapter.mkdir([".", "makemd"].join("") + "/");
    await adapter.writeBinary("Folder/.space/context.mdb", new ArrayBuffer(0));
    await adapter.rename(
      "Folder/.space/context.mdb",
      "Folder/.makemd/context.mdb"
    );

    expect(calls).toEqual([
      ["mkdir", [".notidian/"]],
      ["writeBinary", ["Folder/.notidian/context.mdb", expect.any(ArrayBuffer)]],
      [
        "rename",
        [
          "Folder/.notidian/context.mdb",
          "Folder/.notidian/context.mdb",
        ],
      ],
    ]);
    expect(plugin.register).toHaveBeenCalledTimes(1);
    expect((plugin as any).legacyStorageRootGuardInstalled).toBe(true);
    expect(uninstallers).toHaveLength(1);
  });
});
