jest.mock("./api", () => ({ API: class {} }));
jest.mock("./commands", () => ({ SpacesCommandsAdapter: class {} }));
jest.mock("../utils/contexts/context", () => ({
  removeLinkInContexts: jest.fn(() => Promise.resolve()),
  removePathLifecycleInContexts: jest.fn(() => Promise.resolve()),
  removePathInContexts: jest.fn(() => Promise.resolve()),
  removeTagInContexts: jest.fn(() => Promise.resolve()),
  renameLinkInContexts: jest.fn(() => Promise.resolve()),
  renamePathLifecycleInContexts: jest.fn(() => Promise.resolve()),
  renamePathInContexts: jest.fn(() => Promise.resolve()),
  renameTagInContexts: jest.fn(() => Promise.resolve()),
  updateContextWithProperties: jest.fn(() => Promise.resolve()),
}));

import {
  removePathLifecycleInContexts,
  removePathInContexts,
  renameLinkInContexts,
  renamePathInContexts,
  renamePathLifecycleInContexts,
  updateContextWithProperties,
} from "../utils/contexts/context";
import { EventDispatcher } from "shared/utils/dispatchers/dispatcher";
import { IndexMap } from "shared/types/indexMap";
import { Superstate } from "./superstate";
import { Indexer } from "./workers/indexer/indexer";

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
};

const deferred = <T>(): Deferred<T> => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

const pathState = (path: string, generation: string) => ({
  path,
  type: "file",
  subtype: "image",
  tags: [] as string[],
  spaces: [] as string[],
  outlinks: [`link-${generation}`],
  metadata: {
    file: {
      extension: "png",
      filename: `${generation}.png`,
      path,
    },
  },
});

const harness = () => {
  const superstate = Object.create(Superstate.prototype) as Superstate;
  superstate.pathsIndex = new Map();
  superstate.spacesIndex = new Map();
  superstate.contextsIndex = new Map();
  superstate.tagsMap = new IndexMap();
  superstate.linksMap = new IndexMap();
  superstate.spacesMap = new IndexMap();
  superstate.imagesCache = new Map();
  superstate.focuses = [];
  superstate.settings = { enhancedLogs: false, indexSVG: false } as any;
  superstate.eventsDispatcher = new EventDispatcher();
  superstate.assets = null;
  superstate.spaceManager = {
    readPath: jest.fn(),
    spaceInfoForPath: jest.fn(),
  } as any;
  superstate.spaceManager.superstate = superstate;
  superstate.persister = {
    store: jest.fn().mockResolvedValue(undefined),
    remove: jest.fn().mockResolvedValue(undefined),
  } as any;
  (superstate as any).contextStateQueue = Promise.resolve();
  (superstate as any).indexer = new Indexer(1, superstate);
  return superstate;
};

describe("Superstate deletion generation safety", () => {
  it("does not delete a path created and indexed while bulk initialization is pending", async () => {
    const superstate = harness();
    const bulk = deferred<Record<string, { cache: any; changed: boolean }>>();
    const currentPaths: string[][] = [[]];
    superstate.spaceManager.allPaths = jest.fn(() => currentPaths[currentPaths.length - 1]);
    superstate.ui = { notify: jest.fn() } as any;
    (superstate as any).indexer.reload = jest.fn(() => bulk.promise);
    const deleted: string[] = [];
    superstate.eventsDispatcher.addListener("pathDeleted", ({ path }) => { deleted.push(path); });

    const initialize = superstate.initializePaths();
    while (!(superstate as any).indexer.reload.mock.calls.length) await Promise.resolve();

    currentPaths.push(["Created.md"]);
    superstate.pathsIndex.set("Created.md", {
      ...pathState("Created.md", "fresh"),
      spaces: ["Space"],
    } as any);
    superstate.spacesMap.set("Created.md", new Set(["Space"]));
    superstate.spacesIndex.set("Space", { space: { path: "Space" } } as any);
    bulk.resolve({});
    await initialize;
    await Promise.resolve();

    expect(superstate.spaceManager.allPaths).toHaveBeenCalledTimes(2);
    expect(superstate.pathsIndex.has("Created.md")).toBe(true);
    expect(superstate.persister.remove).not.toHaveBeenCalledWith("Created.md", "path");
    expect(updateContextWithProperties).not.toHaveBeenCalled();
    expect(deleted).toEqual([]);
  });

  it("rejects bulk path results invalidated during the read and results absent from its snapshot", async () => {
    const superstate = harness();
    const bulk = deferred<Record<string, { cache: any; changed: boolean }>>();
    superstate.spaceManager.allPaths = jest.fn(() => ["Deleted.md"]);
    superstate.ui = { notify: jest.fn() } as any;
    (superstate as any).indexer.reload = jest.fn(() => bulk.promise);

    const initialize = superstate.initializePaths();
    while (!(superstate as any).indexer.reload.mock.calls.length) await Promise.resolve();
    await superstate.invalidatePath("Deleted.md");
    bulk.resolve({
      "Deleted.md": { cache: pathState("Deleted.md", "stale"), changed: true },
      "Injected.md": { cache: pathState("Injected.md", "unsnapshotted"), changed: true },
    });
    await initialize;

    expect(superstate.pathsIndex.has("Deleted.md")).toBe(false);
    expect(superstate.pathsIndex.has("Injected.md")).toBe(false);
    expect(superstate.imagesCache.has("stale.png")).toBe(false);
    expect(superstate.imagesCache.has("unsnapshotted.png")).toBe(false);
    expect(superstate.persister.store).not.toHaveBeenCalled();
  });

  it("does not commit after deletion while path persistence is awaiting", async () => {
    const superstate = harness();
    const storeGate = deferred<void>();
    (superstate.persister.store as jest.Mock).mockReturnValueOnce(storeGate.promise);
    (superstate as any).indexer.execute = jest
      .fn()
      .mockResolvedValue({ cache: pathState("Race.png", "stale"), changed: true });
    const events: string[] = [];
    superstate.eventsDispatcher.addListener("pathStateUpdated", () => { events.push("updated"); });

    const reload = superstate.reloadPath("Race.png", true);
    while (!(superstate.persister.store as jest.Mock).mock.calls.length) await Promise.resolve();
    superstate.onPathDeleted("Race.png");
    storeGate.resolve();

    await expect(reload).resolves.toBe(false);
    expect(superstate.pathsIndex.has("Race.png")).toBe(false);
    expect(superstate.tagsMap.get("Race.png").size).toBe(0);
    expect(superstate.linksMap.get("Race.png").size).toBe(0);
    expect(superstate.spacesMap.get("Race.png").size).toBe(0);
    expect(superstate.imagesCache.has("stale.png")).toBe(false);
    expect(events).toEqual([]);
    expect(superstate.persister.remove).toHaveBeenCalledWith("Race.png", "path");
  });

  it("purges every image mapping whose value is the deleted path", () => {
    const superstate = harness();
    superstate.imagesCache.set("first.png", "Deleted.png");
    superstate.imagesCache.set("alias.png", "Deleted.png");
    superstate.imagesCache.set("keep.png", "Other.png");

    superstate.onPathDeleted("Deleted.png");

    expect([...superstate.imagesCache.entries()]).toEqual([["keep.png", "Other.png"]]);
  });

  it("retains deletion context across the internal invalidation bridge", async () => {
    const superstate = harness();
    superstate.pathsIndex.set("Deleted.md", pathState("Deleted.md", "old") as any);
    const deleted: string[] = [];
    superstate.eventsDispatcher.addListener("pathDeleted", ({ path }) => { deleted.push(path); });

    superstate.invalidatePath("Deleted.md");
    await superstate.onPathDeleted("Deleted.md");

    expect(deleted).toEqual(["Deleted.md"]);
  });

  it("propagates a rejected path-persister removal to the deletion lifecycle", async () => {
    const superstate = harness();
    (superstate.persister.remove as jest.Mock).mockRejectedValueOnce(new Error("path cache unavailable"));
    await expect(superstate.onPathDeleted("Deleted.md")).rejects.toThrow("path cache unavailable");
  });

  it("preserves a fresh trailing recreation after invalidating active stale work", async () => {
    const superstate = harness();
    const staleGate = deferred<any>();
    (superstate as any).indexer.execute = jest
      .fn()
      .mockImplementationOnce(() => staleGate.promise)
      .mockResolvedValueOnce({ cache: pathState("Recreated.png", "fresh"), changed: true });

    const stale = superstate.reloadPath("Recreated.png", true);
    superstate.onPathDeleted("Recreated.png");
    const fresh = superstate.reloadPath("Recreated.png", true);
    staleGate.resolve({ cache: pathState("Recreated.png", "stale"), changed: true });

    await expect(stale).resolves.toBe(false);
    await expect(fresh).resolves.toBe(true);
    expect(superstate.pathsIndex.get("Recreated.png")?.metadata.file.filename).toBe("fresh.png");
    expect(superstate.imagesCache.get("fresh.png")).toBe("Recreated.png");
    expect(superstate.imagesCache.has("stale.png")).toBe(false);
  });

  it("orders stale persistence, invalidation removal, and fresh recreation persistence", async () => {
    const superstate = harness();
    const staleStore = deferred<void>();
    const operations: string[] = [];
    (superstate.persister.store as jest.Mock)
      .mockImplementationOnce(() => {
        operations.push("store-stale");
        return staleStore.promise;
      })
      .mockImplementationOnce(() => {
        operations.push("store-fresh");
        return Promise.resolve();
      });
    (superstate.persister.remove as jest.Mock).mockImplementation((_path, type) => {
      operations.push(`remove-${type}`);
      return Promise.resolve();
    });
    const staleExecution = deferred<any>();
    (superstate as any).indexer.execute = jest
      .fn()
      .mockImplementationOnce(() => staleExecution.promise)
      .mockResolvedValueOnce({ cache: pathState("Ordered.png", "fresh"), changed: true });

    const stale = superstate.reloadPath("Ordered.png", true);
    staleExecution.resolve({ cache: pathState("Ordered.png", "stale"), changed: true });
    while (!operations.length) await Promise.resolve();
    superstate.invalidatePath("Ordered.png");
    const fresh = superstate.reloadPath("Ordered.png", true);
    await Promise.resolve();

    expect(operations).toEqual(["store-stale"]);
    staleStore.resolve();
    await Promise.all([stale, fresh]);

    expect(operations).toEqual([
      "store-stale",
      "remove-path",
      "store-fresh",
    ]);
    expect(superstate.pathsIndex.get("Ordered.png")?.metadata.file.filename).toBe("fresh.png");
  });
});

describe("Superstate invalidated reload consumers", () => {
  beforeEach(() => {
    (updateContextWithProperties as jest.Mock).mockClear();
    (removePathInContexts as jest.Mock).mockClear();
    (removePathLifecycleInContexts as jest.Mock).mockClear();
    (renameLinkInContexts as jest.Mock).mockClear();
    (renamePathInContexts as jest.Mock).mockClear();
    (renamePathLifecycleInContexts as jest.Mock).mockClear();
  });

  it("does not begin queued context persistence after the originating reload is invalidated", async () => {
    const superstate = harness();
    const blocker = deferred<void>();
    superstate.spacesIndex.set("Space", { space: { path: "Space" } } as any);
    superstate.spacesMap.set("Queued.md", new Set(["Space"]));
    superstate.addToContextStateQueue(() => blocker.promise);
    const generation = (superstate as any).indexer.pathGeneration("Queued.md");

    await expect((superstate as any).pathReloaded(
      "Queued.md",
      { ...pathState("Queued.md", "queued"), spaces: ["Space"] },
      true,
      true,
      generation,
    )).resolves.toBe(true);
    superstate.invalidatePath("Queued.md");
    blocker.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(updateContextWithProperties).not.toHaveBeenCalled();
  });

  it("does not begin tag-space follow-on work after the originating reload is invalidated", async () => {
    const superstate = harness();
    const reloadSpaceGate = deferred<void>();
    superstate.settings = {
      enhancedLogs: false,
      indexSVG: false,
      spacesFolder: "Spaces",
      spaceSubFolder: ".notidian",
    } as any;
    superstate.reloadSpace = jest.fn(() => reloadSpaceGate.promise as any);
    superstate.reloadContext = jest.fn().mockResolvedValue(true);
    superstate.reloadPath = jest.fn().mockResolvedValue(true);
    const generation = (superstate as any).indexer.pathGeneration("Tagged.md");

    const reload = (superstate as any).pathReloaded(
      "Tagged.md",
      { ...pathState("Tagged.md", "tagged"), tags: ["Tag"], spaces: ["spaces://tag"] },
      true,
      false,
      generation,
    );
    while (!(superstate.reloadSpace as jest.Mock).mock.calls.length) await Promise.resolve();
    superstate.invalidatePath("Tagged.md");
    reloadSpaceGate.resolve();

    await expect(reload).resolves.toBe(false);
    expect(superstate.reloadContext).not.toHaveBeenCalled();
    expect(superstate.reloadPath).not.toHaveBeenCalled();
  });

  it("onMetadataChange stops when reloadPath returns false", async () => {
    const superstate = harness();
    superstate.pathsIndex.set("Deleted.md", pathState("Deleted.md", "old") as any);
    superstate.reloadPath = jest.fn().mockResolvedValue(false);
    superstate.dispatchEvent = jest.fn();
    superstate.addToContextStateQueue = jest.fn();

    superstate.onMetadataChange("Deleted.md");
    await Promise.resolve();
    await Promise.resolve();

    expect(superstate.dispatchEvent).not.toHaveBeenCalled();
    expect(superstate.addToContextStateQueue).not.toHaveBeenCalled();
  });

  it("onMetadataChange returns the promise for its full production flow", async () => {
    const superstate = harness();
    superstate.pathsIndex.set("Changed.md", pathState("Changed.md", "old") as any);
    superstate.reloadPath = jest.fn().mockResolvedValue(false);

    const change = superstate.onMetadataChange("Changed.md");

    expect(change).toBeInstanceOf(Promise);
    await change;
  });

  it("onMetadataChange stops after invalidation during space reload", async () => {
    const superstate = harness();
    const spaceGate = deferred<any>();
    superstate.pathsIndex.set("Changed.md", {
      ...pathState("Changed.md", "old"),
      spaces: ["Space"],
    } as any);
    superstate.spacesIndex.set("Changed.md", {
      path: "Changed.md",
      space: { path: "Changed.md" },
      metadata: { links: [] },
    } as any);
    superstate.spacesIndex.set("Space", { space: { path: "Space" } } as any);
    superstate.reloadPath = jest.fn().mockResolvedValue(true);
    superstate.reloadSpace = jest.fn(() => spaceGate.promise);
    superstate.onSpaceDefinitionChanged = jest.fn().mockResolvedValue(undefined);
    superstate.dispatchEvent = jest.fn();

    const change = superstate.onMetadataChange("Changed.md") as unknown as Promise<void>;
    while (!(superstate.reloadSpace as jest.Mock).mock.calls.length) await Promise.resolve();
    superstate.invalidatePath("Changed.md");
    spaceGate.resolve({ space: { path: "Changed.md" } });
    await change;
    await Promise.resolve();

    expect(superstate.onSpaceDefinitionChanged).not.toHaveBeenCalled();
    expect(updateContextWithProperties).not.toHaveBeenCalled();
    expect(superstate.dispatchEvent).not.toHaveBeenCalled();
  });

  it("onMetadataChange guards queued context work when invalidated before execution", async () => {
    const superstate = harness();
    const blocker = deferred<void>();
    superstate.pathsIndex.set("Changed.md", {
      ...pathState("Changed.md", "old"),
      spaces: ["Space"],
    } as any);
    superstate.spacesIndex.set("Space", { space: { path: "Space" } } as any);
    superstate.reloadPath = jest.fn().mockResolvedValue(true);
    superstate.dispatchEvent = jest.fn();
    superstate.addToContextStateQueue(() => blocker.promise);

    const change = superstate.onMetadataChange("Changed.md") as unknown as Promise<void>;
    await Promise.resolve();
    await Promise.resolve();
    superstate.invalidatePath("Changed.md");
    blocker.resolve();
    await (superstate as any).contextStateQueue;
    await change;

    expect(updateContextWithProperties).not.toHaveBeenCalled();
    expect(superstate.dispatchEvent).not.toHaveBeenCalled();
  });

  it("onMetadataChange rechecks generation after queued context mutation before success events", async () => {
    const superstate = harness();
    const contextGate = deferred<void>();
    superstate.pathsIndex.set("Changed.md", {
      ...pathState("Changed.md", "old"),
      spaces: ["Space"],
    } as any);
    superstate.spacesIndex.set("Space", { space: { path: "Space" } } as any);
    superstate.reloadPath = jest.fn().mockResolvedValue(true);
    (updateContextWithProperties as jest.Mock).mockImplementationOnce(() => contextGate.promise);
    superstate.dispatchEvent = jest.fn();

    const change = superstate.onMetadataChange("Changed.md") as unknown as Promise<void>;
    while (!(updateContextWithProperties as jest.Mock).mock.calls.length) await Promise.resolve();
    superstate.invalidatePath("Changed.md");
    contextGate.resolve();
    await (superstate as any).contextStateQueue;
    await change;

    expect(superstate.dispatchEvent).not.toHaveBeenCalled();
  });

  it("onPathCreated stops when reloadPath returns false", async () => {
    const superstate = harness();
    superstate.reloadPath = jest.fn().mockResolvedValue(false);
    superstate.dispatchEvent = jest.fn();

    await superstate.onPathCreated("Deleted.md");

    expect(superstate.dispatchEvent).not.toHaveBeenCalled();
  });

  it("onMetadataChange null-checks state re-fetched after a successful reload", async () => {
    const superstate = harness();
    superstate.pathsIndex.set("Deleted.md", pathState("Deleted.md", "old") as any);
    superstate.reloadPath = jest.fn().mockImplementation(async () => {
      superstate.pathsIndex.delete("Deleted.md");
      return true;
    });
    superstate.dispatchEvent = jest.fn();
    superstate.addToContextStateQueue = jest.fn();

    superstate.onMetadataChange("Deleted.md");
    await Promise.resolve();
    await Promise.resolve();

    expect(superstate.dispatchEvent).not.toHaveBeenCalled();
    expect(superstate.addToContextStateQueue).not.toHaveBeenCalled();
  });

  it("onPathRename stops follow-on work when the destination reload is invalidated", async () => {
    const superstate = harness();
    superstate.reloadPath = jest.fn().mockResolvedValue(false);
    superstate.dispatchEvent = jest.fn();
    superstate.ui = { viewsByPath: jest.fn((): any[] => []) } as any;
    const error = jest.spyOn(console, "error").mockImplementation(() => undefined);

    await superstate.onPathRename("Old.md", "New.md");

    expect(superstate.dispatchEvent).not.toHaveBeenCalled();
    expect(renamePathLifecycleInContexts).toHaveBeenCalledTimes(2);
    expect(superstate.persister.store).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });

  it("onPathRename recovers old state handed off by synchronous invalidation", async () => {
    const superstate = harness();
    superstate.pathsIndex.set("Old.md", {
      ...pathState("Old.md", "old"),
      spaces: ["Space"],
    } as any);
    superstate.spacesIndex.set("Space", { space: { path: "Space" } } as any);
    superstate.reloadPath = jest.fn().mockResolvedValue(true);
    superstate.reloadContext = jest.fn().mockResolvedValue(true);
    superstate.ui = { viewsByPath: jest.fn((): any[] => []) } as any;
    superstate.invalidatePath("Old.md");

    await expect(superstate.onPathRename("Old.md", "New.md")).resolves.toBe(true);

    expect(renamePathLifecycleInContexts).toHaveBeenCalledWith(
      superstate.spaceManager,
      "Old.md",
      "New.md",
      [{ path: "Space" }],
      [],
      expect.any(Function),
    );
    expect((superstate as any).invalidatedPathStates.has("Old.md")).toBe(false);
  });

  it("onPathRename guards queued link work at execution time", async () => {
    const superstate = harness();
    superstate.pathsIndex.set("Old.md", pathState("Old.md", "old") as any);
    superstate.contextsIndex.set("LinkContext", {
      path: "LinkSpace",
      outlinks: ["Old.md"],
    } as any);
    superstate.spacesIndex.set("LinkSpace", { space: { path: "LinkSpace" } } as any);
    superstate.reloadPath = jest.fn().mockResolvedValue(true);
    superstate.reloadContext = jest.fn().mockResolvedValue(true);
    superstate.ui = { viewsByPath: jest.fn((): any[] => []) } as any;
    const queued: Array<() => Promise<unknown>> = [];
    superstate.addToContextStateQueue = jest.fn((operation) => {
      queued.push(operation);
      return Promise.resolve();
    });

    await expect(superstate.onPathRename("Old.md", "New.md")).resolves.toBe(true);
    expect(queued.length).toBeGreaterThan(0);
    superstate.invalidatePath("New.md");
    await Promise.all(queued.map(operation => operation()));

    expect(renameLinkInContexts).not.toHaveBeenCalled();
  });

  it("onPathRename compensates a renamed context row when invalidated during recalculation", async () => {
    const superstate = harness();
    const contextGate = deferred<boolean>();
    superstate.pathsIndex.set("Old.md", {
      ...pathState("Old.md", "old"),
      spaces: ["Space"],
    } as any);
    superstate.spacesIndex.set("Space", { space: { path: "Space" } } as any);
    superstate.reloadPath = jest.fn().mockResolvedValue(true);
    superstate.reloadContext = jest.fn(() => contextGate.promise);
    superstate.ui = { viewsByPath: jest.fn((): any[] => []) } as any;
    const error = jest.spyOn(console, "error").mockImplementation(() => undefined);

    const rename = superstate.onPathRename("Old.md", "New.md");
    while (!(superstate.reloadContext as jest.Mock).mock.calls.length) await Promise.resolve();
    superstate.invalidatePath("New.md");
    contextGate.resolve(true);

    await expect(rename).resolves.toBe(false);
    expect(renamePathLifecycleInContexts).toHaveBeenLastCalledWith(
      superstate.spaceManager,
      "New.md",
      "Old.md",
      [{ path: "Space" }],
      [],
    );
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });

  it("onPathRename restores focus state and suppresses events when invalidated during focus persistence", async () => {
    const superstate = harness();
    const focusGate = deferred<void>();
    superstate.pathsIndex.set("Old.md", pathState("Old.md", "old") as any);
    superstate.focuses = [{ name: "Pinned", paths: ["Old.md"] }] as any;
    superstate.spaceManager.persistFocuses = jest.fn(() => focusGate.promise);
    superstate.reloadPath = jest.fn().mockResolvedValue(true);
    superstate.dispatchEvent = jest.fn();
    superstate.ui = { viewsByPath: jest.fn((): any[] => []) } as any;
    const error = jest.spyOn(console, "error").mockImplementation(() => undefined);

    const rename = superstate.onPathRename("Old.md", "New.md");
    while (!(superstate.spaceManager.persistFocuses as jest.Mock).mock.calls.length) await Promise.resolve();
    superstate.invalidatePath("New.md");
    focusGate.resolve();

    await expect(rename).resolves.toBe(false);
    expect(superstate.focuses[0].paths).toEqual(["Old.md"]);
    expect(superstate.dispatchEvent).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });

  it("deleteTagInPath suppresses its event when persistence is invalidated", async () => {
    const superstate = harness();
    superstate.pathsIndex.set("Deleted.md", {
      ...pathState("Deleted.md", "old"),
      tags: ["Tag"],
      spaces: ["spaces://Tag"],
    } as any);
    superstate.onPathReloaded = jest.fn().mockResolvedValue(false);
    superstate.dispatchEvent = jest.fn();

    await superstate.deleteTagInPath("Tag", "Deleted.md");

    expect(superstate.dispatchEvent).not.toHaveBeenCalled();
  });

  it.each(["indexed", "reload-first"] as const)(
    "deleteTagInPath persists the post-removal state through the real serializer (%s)",
    async (mode) => {
      const superstate = harness();
      const initialState = {
        ...pathState("Tagged.md", "kept"),
        tags: ["Remove", "Keep"],
        spaces: ["spaces://Remove", "spaces://Keep", "Folder"],
        metadata: { custom: { remains: true }, file: pathState("Tagged.md", "kept").metadata.file },
      } as any;
      if (mode === "indexed") {
        superstate.pathsIndex.set("Tagged.md", initialState);
      } else {
        superstate.reloadPath = jest.fn().mockImplementation(async () => {
          superstate.pathsIndex.set("Tagged.md", initialState);
          return true;
        });
      }

      await superstate.deleteTagInPath("Remove", "Tagged.md");

      const persisted = JSON.parse(
        (superstate.persister.store as jest.Mock).mock.calls.at(-1)?.[1],
      );
      expect(persisted.tags).toEqual(["Keep"]);
      expect(persisted.spaces).toEqual(["spaces://Keep", "Folder"]);
      expect(persisted.outlinks).toEqual(["link-kept"]);
      expect(persisted.metadata.custom).toEqual({ remains: true });
      expect(superstate.pathsIndex.get("Tagged.md")?.tags).toEqual(["Keep"]);
      expect([...superstate.tagsMap.get("Tagged.md")]).toEqual(["Keep"]);
      expect([...superstate.spacesMap.get("Tagged.md")]).toEqual(["spaces://Keep", "Folder"]);
    },
  );

  it("onTagRenamed stops downstream events and context mutations when path rename is invalidated", async () => {
    const superstate = harness();
    superstate.settings = {
      enhancedLogs: false,
      indexSVG: false,
      spacesFolder: "Spaces",
      spaceSubFolder: ".notidian",
    } as any;
    superstate.onSpaceRenamed = jest.fn().mockResolvedValue(undefined);
    superstate.onPathRename = jest.fn().mockResolvedValue(false);
    superstate.dispatchEvent = jest.fn();
    superstate.addToContextStateQueue = jest.fn();

    await superstate.onTagRenamed("Old", "New");

    expect(superstate.onSpaceRenamed).not.toHaveBeenCalled();
    expect(superstate.dispatchEvent).not.toHaveBeenCalled();
    expect(superstate.addToContextStateQueue).not.toHaveBeenCalled();
  });
});
