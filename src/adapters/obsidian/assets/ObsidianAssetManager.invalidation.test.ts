jest.mock("main", () => ({}));
jest.mock("obsidian", () => ({ normalizePath: (path: string) => path }), { virtual: true });

import { ObsidianAssetManager } from "./ObsidianAssetManager";

type Deferred<T> = { promise: Promise<T>; resolve: (value: T) => void };
const deferred = <T,>(): Deferred<T> => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
};

const flushUntil = async (predicate: () => boolean, turns = 20) => {
  for (let turn = 0; turn < turns && !predicate(); turn += 1) await Promise.resolve();
};

const managerHarness = () => {
  const persister = {
    remove: jest.fn().mockResolvedValue(undefined),
    store: jest.fn().mockResolvedValue(undefined),
  };
  const manager = new ObsidianAssetManager({} as any, {} as any, persister as any, {} as any);
  return { manager, persister };
};

describe("ObsidianAssetManager source-path invalidation", () => {
  it("does not load a persisted icon whose source no longer exists", async () => {
    const { manager, persister } = managerHarness();
    (persister as any).loadAll = jest.fn().mockResolvedValue([
      { path: ".notidian/iconsets/atlas/deleted.svg", cache: "<svg>stale</svg>" },
    ]);
    (manager as any).pathExists = jest.fn().mockResolvedValue(false);

    await (manager as any).loadCachedIcons();

    expect(manager.getIconSync(".notidian/iconsets/atlas/deleted.svg")).toBeUndefined();
  });

  it("does not resurrect a deleted source after durable icon removal rejects and the manager restarts", async () => {
    const { manager, persister } = managerHarness();
    const path = ".notidian/iconsets/atlas/deleted.svg";
    manager.cacheIconFromPath(path, "<svg>stale</svg>");
    persister.remove.mockRejectedValueOnce(new Error("icon cache unavailable"));

    await expect(manager.invalidateIconPath(path)).rejects.toThrow("icon cache unavailable");

    (persister as any).loadAll = jest.fn().mockResolvedValue([{ path, cache: "<svg>stale</svg>" }]);
    const restarted = new ObsidianAssetManager({} as any, {} as any, persister as any, {} as any);
    (restarted as any).pathExists = jest.fn().mockResolvedValue(false);
    await (restarted as any).loadCachedIcons();

    expect(restarted.getIconSync(path)).toBeUndefined();
  });

  it("does not load an unproven persisted icon merely because its source path exists", async () => {
    const { manager, persister } = managerHarness();
    (persister as any).loadAll = jest.fn().mockResolvedValue([
      { path: ".notidian/iconsets/atlas/current.svg", cache: "<svg>current</svg>" },
    ]);
    (manager as any).pathExists = jest.fn().mockResolvedValue(true);

    await (manager as any).loadCachedIcons();

    expect(manager.getIconSync(".notidian/iconsets/atlas/current.svg")).toBeUndefined();
  });

  it("does not trust persisted icon bytes or aliases for a different same-path source after restart", async () => {
    const { manager, persister } = managerHarness();
    const path = ".notidian/iconsets/atlas/compass.svg";
    manager.iconsetCaches.set("atlas", new Map());
    (manager as any).iconPathMetadata.set(path, { iconsetId: "atlas", iconId: "compass" });
    (persister as any).loadAll = jest.fn().mockResolvedValue([
      { path, cache: "<svg>stale</svg>" },
    ]);
    (manager as any).pathExists = jest.fn().mockResolvedValue(true);

    await (manager as any).loadCachedIcons();

    expect(manager.getIconSync(path)).toBeUndefined();
    expect(manager.getIconSync("compass")).toBeUndefined();
    expect(manager.getIconSync("atlas//compass")).toBeUndefined();
  });

  it("removes every real alias created for one icon path and preserves unrelated icons", () => {
    const { manager } = managerHarness();
    const path = ".notidian/iconsets/atlas/compass.svg";
    const otherPath = ".notidian/iconsets/atlas/keep.svg";
    manager.iconsetCaches.set("atlas", new Map());
    (manager as any).iconPathMetadata.set(path, { iconsetId: "atlas", iconId: "compass" });
    (manager as any).iconPathMetadata.set(otherPath, { iconsetId: "atlas", iconId: "keep" });

    manager.cacheIconFromPath(path, "<svg>stale</svg>");
    manager.cacheIconFromPath(otherPath, "<svg>keep</svg>");
    (manager as any).invalidateIconPath?.(path);

    expect(manager.iconsCache.has(path)).toBe(false);
    expect(manager.iconsCache.has("compass")).toBe(false);
    expect(manager.iconsCache.has("atlas//compass")).toBe(false);
    expect(manager.iconsetCaches.get("atlas")?.has("compass")).toBe(false);
    expect(manager.iconsCache.get(otherPath)).toBe("<svg>keep</svg>");
    expect(manager.iconsCache.get("keep")).toBe("<svg>keep</svg>");
    expect(manager.iconsCache.get("atlas//keep")).toBe("<svg>keep</svg>");
  });

  it("prevents a deferred getIcon read from resurrecting a deleted source", async () => {
    const { manager, persister } = managerHarness();
    const path = ".notidian/iconsets/atlas/compass.svg";
    const read = deferred<string>();
    manager.iconPathMapping.set("atlas//compass", path);
    (manager as any).readPath = jest.fn(() => read.promise);

    const loading = manager.getIcon("atlas//compass");
    await flushUntil(() => (manager as any).readPath.mock.calls.length > 0);
    await Promise.resolve((manager as any).invalidateIconPath(path));
    read.resolve("<svg>stale</svg>");

    await expect(loading).resolves.toBeUndefined();
    expect(manager.getIconSync(path)).toBeUndefined();
    expect(manager.getIconSync("atlas//compass")).toBeUndefined();
    expect(persister.store).not.toHaveBeenCalled();
    expect(persister.remove).toHaveBeenCalledWith(path, "icon");
  });

  it("serializes same-path recreation through getIcon", async () => {
    const { manager } = managerHarness();
    const path = ".notidian/iconsets/atlas/compass.svg";
    const staleRead = deferred<string>();
    manager.iconPathMapping.set("atlas//compass", path);
    (manager as any).readPath = jest.fn()
      .mockImplementationOnce(() => staleRead.promise)
      .mockResolvedValueOnce("<svg>fresh</svg>");

    const stale = manager.getIcon("atlas//compass");
    await flushUntil(() => (manager as any).readPath.mock.calls.length === 1);
    const removal = Promise.resolve((manager as any).invalidateIconPath(path));
    const fresh = manager.getIcon("atlas//compass");
    staleRead.resolve("<svg>stale</svg>");

    await expect(stale).resolves.toBeUndefined();
    await removal;
    await expect(fresh).resolves.toBe("<svg>fresh</svg>");
    expect(manager.getIconSync("atlas//compass")).toBe("<svg>fresh</svg>");
  });

  it("prevents a deferred loadIconFromPath read from resurrecting a deleted source", async () => {
    const { manager, persister } = managerHarness();
    const path = ".notidian/iconsets/atlas/compass.svg";
    const read = deferred<string>();
    (manager as any).readPath = jest.fn(() => read.promise);

    const loading = manager.loadIconFromPath(path);
    await flushUntil(() => (manager as any).readPath.mock.calls.length > 0);
    await Promise.resolve((manager as any).invalidateIconPath(path));
    read.resolve("<svg>stale</svg>");

    await expect(loading).resolves.toBeUndefined();
    expect(manager.getIconSync(path)).toBeUndefined();
    expect(persister.store).not.toHaveBeenCalled();
    expect(persister.remove).toHaveBeenCalledWith(path, "icon");
  });

  it("serializes same-path recreation through loadIconFromPath", async () => {
    const { manager } = managerHarness();
    const path = ".notidian/iconsets/atlas/compass.svg";
    const staleRead = deferred<string>();
    (manager as any).readPath = jest.fn()
      .mockImplementationOnce(() => staleRead.promise)
      .mockResolvedValueOnce("<svg>fresh</svg>");

    const stale = manager.loadIconFromPath(path);
    await flushUntil(() => (manager as any).readPath.mock.calls.length === 1);
    const removal = Promise.resolve((manager as any).invalidateIconPath(path));
    const fresh = manager.loadIconFromPath(path);
    staleRead.resolve("<svg>stale</svg>");

    await expect(stale).resolves.toBeUndefined();
    await removal;
    await expect(fresh).resolves.toBe("<svg>fresh</svg>");
    expect(manager.getIconSync(path)).toBe("<svg>fresh</svg>");
  });

  it("invalidates only aliases still owned by the deleted source", async () => {
    const { manager } = managerHarness();
    const oldPath = ".notidian/iconsets/atlas/compass.svg";
    const newPath = ".notidian/iconsets/custom/compass.svg";
    const keepPath = ".notidian/iconsets/atlas/keep.svg";
    manager.iconsetCaches.set("atlas", new Map());
    manager.iconsetCaches.set("custom", new Map());
    (manager as any).iconPathMetadata.set(oldPath, { iconsetId: "atlas", iconId: "compass" });
    (manager as any).iconPathMetadata.set(newPath, { iconsetId: "custom", iconId: "compass" });
    (manager as any).iconPathMetadata.set(keepPath, { iconsetId: "atlas", iconId: "keep" });
    manager.iconPathMapping.set("legacy-compass", oldPath);
    manager.iconPathMapping.set("compass", newPath);
    manager.cacheIconFromPath(oldPath, "<svg>old</svg>");
    manager.cacheIconFromPath(newPath, "<svg>new</svg>");
    manager.cacheIconFromPath(keepPath, "<svg>keep</svg>");

    await Promise.resolve((manager as any).invalidateIconPath(oldPath));

    expect(manager.getIconSync(oldPath)).toBeUndefined();
    expect(manager.getIconSync("legacy-compass")).toBeUndefined();
    expect(manager.getIconSync("atlas//compass")).toBeUndefined();
    expect(manager.iconsetCaches.get("atlas")?.has("compass")).toBe(false);
    expect(manager.getIconSync(newPath)).toBe("<svg>new</svg>");
    expect(manager.getIconSync("compass")).toBe("<svg>new</svg>");
    expect(manager.getIconSync("custom//compass")).toBe("<svg>new</svg>");
    expect(manager.iconsetCaches.get("custom")?.get("compass")).toBe("<svg>new</svg>");
    expect(manager.getIconSync("keep")).toBe("<svg>keep</svg>");
  });
});
