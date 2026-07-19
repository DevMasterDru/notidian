jest.mock("adapters/obsidian/utils/tags", () => ({}));
jest.mock("main", () => ({}));
jest.mock("obsidian", () => ({
  Platform: { isMobile: false },
  TFile: class {},
  TFolder: class {},
  normalizePath: (path: string) => path,
}), { virtual: true });
jest.mock("adapters/mdb/localCache/localCache", () => ({
  LocalStorageCache: jest.fn().mockImplementation(() => ({})),
}));
jest.mock("adapters/mdb/localCache/localCacheMobile", () => ({
  MobileCachePersister: jest.fn(),
}));
jest.mock("core/spaceManager/filesystemAdapter/filesystemAdapter", () => ({
  defaultFocusFile: "focus.md",
}));
jest.mock("../filetypes/frontmatter/fm", () => ({
  getAllFrontmatterKeys: jest.fn((): string[] => []),
}));
jest.mock("../utils/file", () => ({
  getAbstractFileAtPath: jest.fn(),
  getAllAbstractFilesInVault: jest.fn((): unknown[] => []),
  tFileToAFile: jest.fn((file: any) => file ? ({
    ctime: file.stat?.ctime ?? 0,
    extension: file.extension,
    filename: file.name,
    isFolder: false,
    name: file.basename,
    parent: file.parent?.path ?? "/",
    path: file.path,
  }) : null),
}));
jest.mock("shared/pluginIdentity", () => ({
  pluginDataPath: (...parts: string[]) => parts.join("/"),
  pluginDisplayName: "Notidian",
}));
jest.mock("utils/hide", () => ({
  excludePathPredicate: jest.fn(() => false),
}));

import { FilesystemMiddleware } from "core/middleware/filesystem";
import { isPostPhysicalLifecycleFailure } from "shared/utils/asyncContracts";
import { ObsidianFileSystem } from "./filesystem";

type Deferred = {
  promise: Promise<void>;
  resolve: () => void;
  reject: (reason: unknown) => void;
};

const deferred = (): Deferred => {
  let resolve!: () => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<void>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
};

const flushUntil = async (predicate: () => boolean, turns = 20) => {
  for (let turn = 0; turn < turns && !predicate(); turn += 1) {
    await Promise.resolve();
  }
};

const file = (basename = "Race", path = "Race.md") => ({
  basename,
  extension: "md",
  name: path.split("/").pop() ?? `${basename}.md`,
  parent: { path: "/" },
  path,
  stat: { ctime: 10, mtime: 20 },
});

const harness = () => {
  const deletedFile = file();
  const plugin = {
    app: {
      metadataCache: {},
      fileManager: { renameFile: jest.fn(async (): Promise<void> => undefined) },
      vault: {
        getAbstractFileByPath: jest.fn(() => deletedFile),
        delete: jest.fn(async (): Promise<void> => undefined),
        trash: jest.fn(async (): Promise<void> => undefined),
      },
    },
    mdbFileAdapter: {},
    superstate: { settings: { deleteFileOption: "permanent" } },
  } as any;
  const middleware = FilesystemMiddleware.create();
  const filesystem = new ObsidianFileSystem(plugin, middleware, ".notidian");
  filesystem.persister = {
    remove: jest.fn().mockResolvedValue(undefined),
    store: jest.fn().mockResolvedValue(undefined),
  } as any;
  middleware.initiateFileSystemAdapter(filesystem, true);
  return { deletedFile, filesystem, middleware, plugin };
};

describe("ObsidianFileSystem deletion invalidation", () => {
  it("rejects a physical rename failure instead of resolving null as success", async () => {
    const { filesystem, plugin } = harness();
    const physicalFailure = new Error("destination occupied");
    (plugin.app.fileManager.renameFile as jest.Mock).mockRejectedValueOnce(physicalFailure);
    let resolved = false;

    const rename = filesystem.renameFile("Race.md", "Moved.md").then(value => {
      resolved = true;
      return value;
    });

    await expect(rename).rejects.toBe(physicalFailure);
    expect(resolved).toBe(false);
  });

  it("marks lifecycle failure after explicit physical deletion but not physical failure", async () => {
    const { deletedFile, filesystem, plugin } = harness();
    const cleanupFailure = new Error("cache cleanup failed");
    (filesystem.persister.remove as jest.Mock).mockRejectedValueOnce(cleanupFailure);
    (plugin.app.vault.delete as jest.Mock).mockImplementationOnce(async () => {
      (filesystem as any).onVaultDelete?.(deletedFile);
    });
    jest.spyOn(console, "error").mockImplementation(() => undefined);

    let postPhysicalFailure: unknown;
    try {
      await filesystem.deleteFile("Race.md");
    } catch (error) {
      postPhysicalFailure = error;
    }

    expect(isPostPhysicalLifecycleFailure(postPhysicalFailure)).toBe(true);
    expect(postPhysicalFailure).toMatchObject({
      cause: expect.objectContaining({
        name: "AggregateError",
        errors: [cleanupFailure],
      }),
      errors: [cleanupFailure],
    });

    const physicalFailure = new Error("permission denied");
    (plugin.app.vault.getAbstractFileByPath as jest.Mock).mockReturnValue(deletedFile);
    (plugin.app.vault.delete as jest.Mock).mockRejectedValueOnce(physicalFailure);
    let rejected: unknown;
    try {
      await filesystem.deleteFile("Race.md");
    } catch (error) {
      rejected = error;
    }
    expect(rejected).toBe(physicalFailure);
    expect(isPostPhysicalLifecycleFailure(rejected)).toBe(false);
    jest.restoreAllMocks();
  });

  it("diagnostically contains an event-only delete rejection through the production void callback", async () => {
    const { deletedFile, filesystem } = harness();
    const diagnostic = jest.spyOn(console, "error").mockImplementation(() => undefined);
    (filesystem.persister.remove as jest.Mock).mockRejectedValueOnce(new Error("event cleanup failed"));

    const returned = (filesystem as any).onVaultDelete(deletedFile);
    await flushUntil(() => diagnostic.mock.calls.some(call => String(call[0]).includes("delete")));

    expect(returned).toBeUndefined();
    expect(diagnostic).toHaveBeenCalledWith(
      expect.stringContaining("delete"),
      expect.anything(),
    );
    diagnostic.mockRestore();
  });

  it("routes a detached raw delete through the shared invalidation lifecycle", async () => {
    const { filesystem, middleware, plugin } = harness();
    const markdownCache = new Map<string, any>([["Raw.md", { stale: true }]]);
    middleware.initiateFiletypeAdapter({
      cache: markdownCache,
      initiate: jest.fn(),
      supportedFileTypes: ["md"],
    } as any);
    filesystem.cache.set("Raw.md", { file: file("Raw", "Raw.md"), stale: true } as any);
    (plugin.app.vault.getAbstractFileByPath as jest.Mock).mockReturnValue(null);
    plugin.app.vault.adapter = {
      exists: jest.fn().mockResolvedValue(true),
      stat: jest.fn().mockResolvedValue({ type: "file", ctime: 10, mtime: 20 }),
      remove: jest.fn().mockResolvedValue(undefined),
    };
    const deleted: string[] = [];
    middleware.eventDispatch.addListener("onDelete", ({ file: deletedFile }) => {
      deleted.push(deletedFile.path);
    });

    await filesystem.deleteFile("Raw.md");

    expect(filesystem.cache.has("Raw.md")).toBe(false);
    expect(markdownCache.has("Raw.md")).toBe(false);
    expect(filesystem.persister.remove).toHaveBeenCalledWith("Raw.md", "file");
    expect(deleted).toEqual(["Raw.md"]);
  });

  it("shares concurrent explicit deletes of one incarnation without duplicate publication", async () => {
    const { deletedFile, filesystem, middleware, plugin } = harness();
    const vaultGate = deferred();
    (plugin.app.vault.delete as jest.Mock).mockImplementation(() => vaultGate.promise);
    const lifecycle = jest.fn().mockResolvedValue(undefined);
    middleware.eventDispatch.addListener("onDelete", lifecycle);

    const first = filesystem.deleteFile("Race.md");
    const second = filesystem.deleteFile("Race.md");
    await Promise.resolve();
    vaultGate.resolve();
    await Promise.all([first, second]);

    expect(plugin.app.vault.delete).toHaveBeenCalledTimes(1);
    expect(lifecycle).toHaveBeenCalledTimes(1);
    expect(lifecycle).toHaveBeenCalledWith(expect.objectContaining({
      file: expect.objectContaining({ path: deletedFile.path }),
    }));
  });

  it("deleteFile awaits the single vault-event lifecycle and propagates its rejection", async () => {
    const { deletedFile, filesystem, middleware, plugin } = harness();
    (plugin.app.vault.getAbstractFileByPath as jest.Mock).mockReturnValue(deletedFile);
    const gate = deferred();
    const lifecycle = jest.fn(() => gate.promise);
    middleware.eventDispatch.addListener("onDelete", lifecycle);
    const error = jest.spyOn(console, "error").mockImplementation(() => undefined);
    let settled = false;

    (plugin.app.vault.delete as jest.Mock).mockImplementationOnce(async (): Promise<void> => {
      void filesystem.onDelete(deletedFile as any).catch((): void => undefined);
    });
    const deletion = filesystem.deleteFile("Race.md").then(
      () => { settled = true; },
      error => { settled = true; throw error; },
    );
    await flushUntil(() => lifecycle.mock.calls.length > 0);

    expect(lifecycle).toHaveBeenCalledTimes(1);
    expect(settled).toBe(false);
    gate.reject(new Error("lifecycle rejected"));
    await expect(deletion).rejects.toEqual(expect.objectContaining({
      name: "PostPhysicalLifecycleError",
      cause: expect.objectContaining({
        name: "AggregateError",
        errors: [expect.objectContaining({ message: "lifecycle rejected" })],
      }),
    }));
    expect(lifecycle).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });

  it("ignores a delayed duplicate delete callback after same-path recreation", async () => {
    const { deletedFile, filesystem, middleware, plugin } = harness();
    const lifecycle = jest.fn().mockResolvedValue(undefined);
    middleware.eventDispatch.addListener("onDelete", lifecycle);

    await filesystem.onDelete(deletedFile as any);
    const recreated = file("Race", "Race.md");
    (plugin.app.vault.getAbstractFileByPath as jest.Mock).mockReturnValue(recreated);
    await filesystem.onDelete(deletedFile as any);

    expect(lifecycle).toHaveBeenCalledTimes(1);
  });

  it("does not mutate or publish a recreated same-path file during the original physical delete", async () => {
    const { deletedFile, filesystem, middleware, plugin } = harness();
    const recreated = file("Recreated", "Race.md");
    const lifecycle = jest.fn().mockResolvedValue(undefined);
    middleware.eventDispatch.addListener("onDelete", lifecycle);
    (plugin.app.vault.getAbstractFileByPath as jest.Mock).mockReturnValue(deletedFile);
    filesystem.cache.set("Race.md", { file: deletedFile, label: { name: "original" } } as any);
    (plugin.app.vault.delete as jest.Mock).mockImplementationOnce(async () => {
      (plugin.app.vault.getAbstractFileByPath as jest.Mock).mockReturnValue(recreated);
      filesystem.cache.set("Race.md", { file: recreated, label: { name: "recreated" } } as any);
      await filesystem.onDelete(deletedFile as any);
    });

    await filesystem.deleteFile("Race.md");

    expect(filesystem.cache.get("Race.md")?.label.name).toBe("recreated");
    expect(lifecycle).not.toHaveBeenCalled();
  });

  // Notidian-4qjx.9.20 (R20): the sibling half of the test above. That test
  // proves the replacement's *primary* cache entry survives; this proves the
  // guard at filesystem.ts:376-377 short-circuits performDeleteLifecycle
  // (filesystem.ts:373-409) before ANY of its stages run for the old identity
  // -- not just the final onDelete dispatch, but also the persisted file-cache
  // removal (persister.remove) and the onPathInvalidated dispatch that feeds
  // superstate.invalidatePath (superstate.ts:871-895, which itself drives
  // spacesMap/tagsMap/linksMap/pathsIndex/icon-cache cleanup). All of that
  // machinery is path-keyed, not identity-keyed, so running any of it here
  // would risk clobbering state the replacement's own onCreate lifecycle
  // already (or will still) own.
  it("protects every filesystem-layer replacement store -- cache, persisted file-cache, onDelete, onPathInvalidated -- when delete joins a same-path recreation", async () => {
    const { deletedFile, filesystem, middleware, plugin } = harness();
    const recreated = file("Recreated", "Race.md");
    const onDeleteListener = jest.fn().mockResolvedValue(undefined);
    const onPathInvalidatedListener = jest.fn().mockResolvedValue(undefined);
    middleware.eventDispatch.addListener("onDelete", onDeleteListener);
    middleware.eventDispatch.addListener("onPathInvalidated", onPathInvalidatedListener);
    (plugin.app.vault.getAbstractFileByPath as jest.Mock).mockReturnValue(deletedFile);
    filesystem.cache.set("Race.md", { file: deletedFile, label: { name: "original" } } as any);
    (plugin.app.vault.delete as jest.Mock).mockImplementationOnce(async () => {
      (plugin.app.vault.getAbstractFileByPath as jest.Mock).mockReturnValue(recreated);
      filesystem.cache.set("Race.md", { file: recreated, label: { name: "recreated" } } as any);
      await filesystem.onDelete(deletedFile as any);
    });

    await filesystem.deleteFile("Race.md");

    expect(filesystem.cache.get("Race.md")?.label.name).toBe("recreated");
    expect(filesystem.persister.remove).not.toHaveBeenCalled();
    expect(onDeleteListener).not.toHaveBeenCalled();
    expect(onPathInvalidatedListener).not.toHaveBeenCalled();
  });
  it("awaits the production create listener before settling", async () => {
    const { deletedFile, filesystem, middleware } = harness();
    const listenerGate = deferred();
    let settled = false;
    const listener = jest.fn(() => listenerGate.promise);
    middleware.eventDispatch.addListener("onCreate", listener);

    const creation = filesystem.onCreate(file() as any).then(() => {
      settled = true;
    });
    await flushUntil(() => listener.mock.calls.length > 0);
    await Promise.resolve();

    expect(listener).toHaveBeenCalledTimes(1);
    expect(settled).toBe(false);
    listenerGate.resolve();
    await creation;
    expect(settled).toBe(true);
  });

  it("serializes stale store, invalidation removal, and fresh recreation store", async () => {
    const { deletedFile, filesystem, middleware } = harness();
    const staleStore = deferred();
    const removeGate = deferred();
    const operations: string[] = [];
    (filesystem.persister.store as jest.Mock)
      .mockImplementationOnce(() => {
        operations.push("store-stale");
        return staleStore.promise;
      })
      .mockImplementationOnce(() => {
        operations.push("store-fresh");
        return Promise.resolve();
      });
    (filesystem.persister.remove as jest.Mock).mockImplementationOnce(() => {
      operations.push("remove");
      return removeGate.promise;
    });

    filesystem.updateFileCache("Race.md", { property: { generation: "stale" } } as any, false);
    const deletion = filesystem.onDelete(deletedFile as any);
    const freshGeneration = middleware.beginPathGeneration("Race.md");
    filesystem.updateFileCache(
      "Race.md",
      { property: { generation: "fresh" } } as any,
      false,
      freshGeneration,
    );

    while (operations.length === 0) await Promise.resolve();
    expect(operations).toEqual(["store-stale"]);
    staleStore.resolve();
    while (!operations.includes("remove")) await Promise.resolve();
    expect(operations).toEqual(["store-stale", "remove"]);
    removeGate.resolve();
    await deletion;
    while (!operations.includes("store-fresh")) await Promise.resolve();

    expect(operations).toEqual(["store-stale", "remove", "store-fresh"]);
    expect(filesystem.cache.get("Race.md")?.property).toEqual({ generation: "fresh" });
  });

  it("continues the persistence queue after stale store and removal rejections", async () => {
    const { deletedFile, filesystem, middleware } = harness();
    const operations: string[] = [];
    (filesystem.persister.store as jest.Mock)
      .mockImplementationOnce(() => {
        operations.push("store-stale");
        const rejected = Promise.reject(new Error("stale store failed"));
        void rejected.catch((): void => undefined);
        return rejected;
      })
      .mockImplementationOnce(() => {
        operations.push("store-fresh");
        return Promise.resolve();
      });
    (filesystem.persister.remove as jest.Mock).mockImplementationOnce(() => {
      operations.push("remove");
      return Promise.reject(new Error("remove failed"));
    });
    const error = jest.spyOn(console, "error").mockImplementation(() => undefined);

    filesystem.updateFileCache("Race.md", { property: { generation: "stale" } } as any, false);
    const deletion = filesystem.onDelete(deletedFile as any);
    const freshGeneration = middleware.beginPathGeneration("Race.md");
    filesystem.updateFileCache(
      "Race.md",
      { property: { generation: "fresh" } } as any,
      false,
      freshGeneration,
    );

    await expect(deletion).rejects.toEqual(expect.objectContaining({
      name: "AggregateError",
      errors: [expect.objectContaining({ message: "remove failed" })],
    }));
    while (!operations.includes("store-fresh")) await Promise.resolve();

    expect(operations).toEqual(["store-stale", "remove", "store-fresh"]);
    expect(filesystem.cache.get("Race.md")?.property).toEqual({ generation: "fresh" });
    expect(error).toHaveBeenCalledTimes(1);
    error.mockRestore();
  });

  it("bridges internal invalidation before awaiting persisted cache removal", async () => {
    const { deletedFile, filesystem, middleware } = harness();
    const removeGate = deferred();
    (filesystem.persister.remove as jest.Mock).mockReturnValueOnce(removeGate.promise);
    const order: string[] = [];
    middleware.eventDispatch.addListener("onPathInvalidated", () => { order.push("invalidated"); });
    middleware.eventDispatch.addListener("onDelete", () => { order.push("deleted"); });

    const deletion = filesystem.onDelete(deletedFile as any);
    await Promise.resolve();

    expect(order).toEqual(["invalidated"]);
    removeGate.resolve();
    await deletion;
    expect(order).toEqual(["invalidated", "deleted"]);
  });

  it("continues in-memory deletion after persisted cache removal rejects", async () => {
    const { deletedFile, filesystem, middleware } = harness();
    (filesystem.persister.remove as jest.Mock).mockRejectedValueOnce(new Error("cache unavailable"));
    const deleted: string[] = [];
    middleware.eventDispatch.addListener("onDelete", ({ file: deletedFile }) => { deleted.push(deletedFile.path); });
    const error = jest.spyOn(console, "error").mockImplementation(() => undefined);

    await expect(filesystem.onDelete(deletedFile as any)).rejects.toEqual(expect.objectContaining({
      name: "AggregateError",
      errors: [expect.objectContaining({ message: "cache unavailable" })],
    }));

    expect(deleted).toEqual(["Race.md"]);
    error.mockRestore();
  });

  it("completes every delete cleanup stage once before aggregating all stage failures", async () => {
    const { deletedFile, filesystem, middleware } = harness();
    const stages: string[] = [];
    middleware.eventDispatch.addListener("onPathInvalidated", () => {
      stages.push("invalidated");
      throw new Error("icon cleanup failed");
    });
    (filesystem.persister.remove as jest.Mock).mockImplementationOnce(async () => {
      stages.push("persisted-removal");
      throw new Error("persisted removal failed");
    });
    const finalDelete = jest.fn(async () => {
      stages.push("final-delete");
      throw new Error("context cleanup failed");
    });
    middleware.eventDispatch.addListener("onDelete", finalDelete);
    const error = jest.spyOn(console, "error").mockImplementation(() => undefined);

    const result = filesystem.onDelete(deletedFile as any);
    await expect(result).rejects.toEqual(expect.objectContaining({
      name: "AggregateError",
      errors: [
        expect.objectContaining({ message: "icon cleanup failed" }),
        expect.objectContaining({ message: "persisted removal failed" }),
        expect.objectContaining({ message: "context cleanup failed" }),
      ],
    }));

    expect(stages).toEqual(["invalidated", "persisted-removal", "final-delete"]);
    expect(filesystem.persister.remove).toHaveBeenCalledTimes(1);
    expect(finalDelete).toHaveBeenCalledTimes(1);
    error.mockRestore();
  });

  it("purges primary, persisted, and filetype caches before delete notification", async () => {
    const { deletedFile, filesystem, middleware } = harness();
    const markdownCache = new Map<string, any>([["Race.md", { property: { stale: true } }]]);
    middleware.initiateFiletypeAdapter({
      cache: markdownCache,
      initiate: jest.fn(),
      supportedFileTypes: ["md"],
    } as any);
    filesystem.cache.set("Race.md", { file: file(), stale: true } as any);
    filesystem.pathLastUpdated.set("Race.md", 20);

    const stateAtNotification: unknown[] = [];
    middleware.eventDispatch.addListener("onDelete", () => {
      stateAtNotification.push({
        filetype: markdownCache.has("Race.md"),
        modified: filesystem.pathLastUpdated.has("Race.md"),
        primary: filesystem.cache.has("Race.md"),
      });
    });

    await filesystem.onDelete(deletedFile as any);

    expect(filesystem.persister.remove).toHaveBeenCalledWith("Race.md", "file");
    expect(stateAtNotification).toEqual([{ filetype: false, modified: false, primary: false }]);
  });

  it("does not dispatch or restore caches when delete wins delayed create-cache work", async () => {
    const { filesystem, middleware, plugin } = harness();
    const parseGate = deferred();
    const filetypeCache = new Map<string, any>();
    const parseCache = jest.fn(async (createdFile: any, _refresh: boolean, generation?: number) => {
      await parseGate.promise;
      if ((middleware as any).isPathGenerationCurrent?.(createdFile.path, generation) === false) return;
      const cache = { property: { generation: "stale" } };
      filetypeCache.set(createdFile.path, cache);
      (middleware as any).updateFileCache(createdFile.path, cache, false, generation);
    });
    middleware.initiateFiletypeAdapter({
      cache: filetypeCache,
      initiate: jest.fn(),
      parseCache,
      supportedFileTypes: ["md"],
    } as any);
    const created: string[] = [];
    middleware.eventDispatch.addListener("onCreate", ({ file: createdFile }) => {
      created.push(createdFile.path);
    });

    const original = file();
    (plugin.app.vault.getAbstractFileByPath as jest.Mock).mockReturnValue(original);
    const createPromise = filesystem.onCreate(original as any);
    await Promise.resolve();
    const deletePromise = filesystem.onDelete(original as any);
    await deletePromise;
    parseGate.resolve();
    await Promise.allSettled([createPromise, deletePromise]);

    expect(created).toEqual([]);
    expect(filetypeCache.has("Race.md")).toBe(false);
    expect(filesystem.cache.has("Race.md")).toBe(false);
  });

  it("allows a successful same-path recreation while rejecting the deleted generation", async () => {
    const { filesystem, middleware, plugin } = harness();
    const staleGate = deferred();
    const filetypeCache = new Map<string, any>();
    let parseCount = 0;
    const parseCache = jest.fn(async (createdFile: any, _refresh: boolean, generation?: number) => {
      parseCount += 1;
      const value = parseCount === 1 ? "stale" : "fresh";
      if (value === "stale") await staleGate.promise;
      if ((middleware as any).isPathGenerationCurrent?.(createdFile.path, generation) === false) return;
      const cache = { property: { generation: value } };
      filetypeCache.set(createdFile.path, cache);
      (middleware as any).updateFileCache(createdFile.path, cache, false, generation);
    });
    middleware.initiateFiletypeAdapter({
      cache: filetypeCache,
      initiate: jest.fn(),
      parseCache,
      supportedFileTypes: ["md"],
    } as any);
    const created: string[] = [];
    middleware.eventDispatch.addListener("onCreate", ({ file: createdFile }) => {
      created.push(createdFile.path);
    });

    const original = file("Old");
    const recreated = file("New");
    (plugin.app.vault.getAbstractFileByPath as jest.Mock).mockReturnValue(original);
    const staleCreate = filesystem.onCreate(original as any);
    while (parseCache.mock.calls.length === 0) await Promise.resolve();
    await filesystem.onDelete(original as any);
    (plugin.app.vault.getAbstractFileByPath as jest.Mock).mockReturnValue(recreated);
    const recreation = filesystem.onCreate(recreated as any);
    await recreation;
    staleGate.resolve();
    await staleCreate;

    expect(created).toEqual(["Race.md"]);
    expect(filetypeCache.get("Race.md")?.property?.generation).toBe("fresh");
    expect(filesystem.cache.get("Race.md")?.property?.generation).toBe("fresh");
  });
});

describe("ObsidianFileSystem rename invalidation", () => {
  it("joins an explicit physical rename to the synchronous event lifecycle and propagates rejection once", async () => {
    const { filesystem, middleware, plugin } = harness();
    const original = file("Old", "Old.md");
    (plugin.app.vault.getAbstractFileByPath as jest.Mock).mockReturnValue(original);
    const listenerGate = deferred();
    const listener = jest.fn(() => listenerGate.promise);
    middleware.eventDispatch.addListener("onRename", listener);
    const diagnostic = jest.spyOn(console, "error").mockImplementation(() => undefined);
    (plugin.app.fileManager.renameFile as jest.Mock).mockImplementationOnce(
      async (renamedFile: any, newPath: string) => {
        renamedFile.path = newPath;
        renamedFile.name = "New.md";
        renamedFile.basename = "New";
        (filesystem as any).onVaultRename?.(renamedFile, "Old.md");
      },
    );
    let settled = false;

    const rename = filesystem.renameFile("Old.md", "New.md").then(
      value => { settled = true; return value; },
      error => { settled = true; throw error; },
    );
    await flushUntil(() => listener.mock.calls.length > 0);

    expect(listener).toHaveBeenCalledTimes(1);
    expect(settled).toBe(false);
    listenerGate.reject(new Error("rename listener rejected"));
    await expect(rename).rejects.toEqual(expect.objectContaining({
      name: "AggregateError",
      errors: [expect.objectContaining({ message: "rename listener rejected" })],
    }));
    expect(listener).toHaveBeenCalledTimes(1);
    expect(plugin.superstate.ui?.notify).toBeUndefined();
    diagnostic.mockRestore();
  });

  it("joins concurrent explicit calls for the same exact physical rename", async () => {
    const { filesystem, middleware, plugin } = harness();
    const original = file("Old", "Old.md");
    let current: any = original;
    (plugin.app.vault.getAbstractFileByPath as jest.Mock).mockImplementation(
      (path: string) => current?.path === path ? current : null,
    );
    plugin.app.vault.adapter = { rename: jest.fn() };
    const listenerGate = deferred();
    middleware.eventDispatch.addListener("onRename", () => listenerGate.promise);
    (plugin.app.fileManager.renameFile as jest.Mock).mockImplementationOnce(
      async (renamedFile: any, newPath: string) => {
        renamedFile.path = newPath;
        renamedFile.name = "New.md";
        renamedFile.basename = "New";
        current = renamedFile;
        (filesystem as any).onVaultRename(renamedFile, "Old.md");
      },
    );

    const first = filesystem.renameFile("Old.md", "New.md");
    await flushUntil(() => (plugin.app.fileManager.renameFile as jest.Mock).mock.calls.length > 0);
    const second = filesystem.renameFile("Old.md", "New.md");

    expect(plugin.app.fileManager.renameFile).toHaveBeenCalledTimes(1);
    expect(plugin.app.vault.adapter.rename).not.toHaveBeenCalled();
    listenerGate.resolve();
    await expect(Promise.all([first, second])).resolves.toEqual(["New.md", "New.md"]);
  });

  it("shares the exact pending rename rejection after the old path no longer resolves", async () => {
    const { filesystem, middleware, plugin } = harness();
    const diagnostic = jest.spyOn(console, "error").mockImplementation(() => undefined);
    const original = file("Old", "Old.md");
    let current: any = original;
    (plugin.app.vault.getAbstractFileByPath as jest.Mock).mockImplementation(
      (path: string) => current?.path === path ? current : null,
    );
    plugin.app.vault.adapter = { rename: jest.fn() };
    const listenerGate = deferred();
    middleware.eventDispatch.addListener("onRename", () => listenerGate.promise);
    (plugin.app.fileManager.renameFile as jest.Mock).mockImplementationOnce(
      async (renamedFile: any, newPath: string) => {
        renamedFile.path = newPath;
        renamedFile.name = "New.md";
        renamedFile.basename = "New";
        current = renamedFile;
        (filesystem as any).onVaultRename(renamedFile, "Old.md");
      },
    );

    const first = filesystem.renameFile("Old.md", "New.md");
    await flushUntil(() => (plugin.app.fileManager.renameFile as jest.Mock).mock.calls.length > 0);
    const second = filesystem.renameFile("Old.md", "New.md");
    const failure = new Error("rename publication failed");
    listenerGate.reject(failure);

    await expect(first).rejects.toMatchObject({
      name: "AggregateError",
      errors: [failure],
    });
    await expect(second).rejects.toMatchObject({
      name: "AggregateError",
      errors: [failure],
    });
    expect(plugin.app.fileManager.renameFile).toHaveBeenCalledTimes(1);
    expect(plugin.app.vault.adapter.rename).not.toHaveBeenCalled();
    diagnostic.mockRestore();
  });

  it("does not join an exact-path pending rename owned by a different file incarnation", async () => {
    const { filesystem, middleware, plugin } = harness();
    const original = file("Old", "Old.md");
    const replacement = file("Replacement", "Old.md");
    let current: any = original;
    (plugin.app.vault.getAbstractFileByPath as jest.Mock).mockImplementation(
      (path: string) => current?.path === path ? current : null,
    );
    const firstGate = deferred();
    middleware.eventDispatch.addListener("onRename", ({ file: renamedFile }) =>
      renamedFile.name === "New" ? firstGate.promise : Promise.resolve()
    );
    (plugin.app.fileManager.renameFile as jest.Mock).mockImplementation(
      async (renamedFile: any, newPath: string) => {
        const oldPath = renamedFile.path;
        renamedFile.path = newPath;
        renamedFile.name = renamedFile === original ? "New.md" : "Replacement-New.md";
        renamedFile.basename = renamedFile.name.replace(/\.md$/, "");
        current = renamedFile;
        (filesystem as any).onVaultRename(renamedFile, oldPath);
      },
    );

    const first = filesystem.renameFile("Old.md", "New.md");
    await flushUntil(() => (plugin.app.fileManager.renameFile as jest.Mock).mock.calls.length === 1);
    current = replacement;
    const second = filesystem.renameFile("Old.md", "New.md");
    await flushUntil(() => (plugin.app.fileManager.renameFile as jest.Mock).mock.calls.length === 2);

    expect(plugin.app.fileManager.renameFile).toHaveBeenNthCalledWith(2, replacement, "New.md");
    await expect(second).resolves.toBe("New.md");
    firstGate.resolve();
    await expect(first).resolves.toBe("New.md");
  });

  it("keeps later explicit physical hops publishing in lineage order after an earlier rejection", async () => {
    const { filesystem, middleware, plugin } = harness();
    const original = file("Old", "Old.md");
    let current = original;
    (plugin.app.vault.getAbstractFileByPath as jest.Mock).mockImplementation(() => current);
    const publications: Array<[string, string]> = [];
    const firstGate = deferred();
    middleware.eventDispatch.addListener("onRename", ({ file: renamedFile, oldPath }) => {
      publications.push([oldPath, renamedFile.path]);
      if (oldPath === "Old.md") return firstGate.promise;
    });
    jest.spyOn(console, "error").mockImplementation(() => undefined);
    (plugin.app.fileManager.renameFile as jest.Mock).mockImplementation(
      async (renamedFile: any, newPath: string) => {
        const oldPath = renamedFile.path;
        renamedFile.path = newPath;
        renamedFile.name = newPath;
        renamedFile.basename = newPath.replace(/\.md$/, "");
        current = renamedFile;
        (filesystem as any).onVaultRename?.(renamedFile, oldPath);
      },
    );

    const first = filesystem.renameFile("Old.md", "New.md");
    await flushUntil(() => publications.length === 1);
    const second = filesystem.renameFile("New.md", "Final.md");
    await flushUntil(() => publications.length === 2);
    firstGate.reject(new Error("first rejected"));

    await expect(first).rejects.toEqual(expect.objectContaining({ name: "AggregateError" }));
    await expect(second).resolves.toBe("Final.md");

    expect(publications).toEqual([
      ["Old.md", "New.md"],
      ["New.md", "Final.md"],
    ]);
    jest.restoreAllMocks();
  });

  it("propagates each listener rejection while later physical hops still publish in order", async () => {
    const { filesystem, middleware, plugin } = harness();
    const errorLog = jest.spyOn(console, "error").mockImplementation(() => undefined);
    const firstGate = deferred();
    const publications: string[] = [];
    middleware.eventDispatch.addListener("onRename", ({ file: renamedFile }) => {
      publications.push(renamedFile.path);
      if (renamedFile.path === "New.md") return firstGate.promise;
      if (renamedFile.path === "Final.md") throw new Error("final listener rejected");
      return Promise.resolve();
    });

    const newFile = file("New", "New.md");
    const finalFile = file("Final", "Final.md");
    const lateFile = file("Late", "Late.md");
    const destinations = new Map([
      [newFile.path, newFile],
      [finalFile.path, finalFile],
      [lateFile.path, lateFile],
    ]);
    (plugin.app.vault.getAbstractFileByPath as jest.Mock).mockImplementation(
      (path: string) => destinations.get(path) ?? null,
    );
    const first = filesystem.onRename(newFile as any, "Old.md");
    await flushUntil(() => publications.length === 1);
    const second = filesystem.onRename(finalFile as any, "New.md");
    const third = filesystem.onRename(lateFile as any, "Final.md");
    await flushUntil(() => publications.length === 3, 100);

    expect(publications).toEqual(["New.md", "Final.md", "Late.md"]);
    await expect(second).rejects.toEqual(expect.objectContaining({
      name: "AggregateError",
      errors: [expect.objectContaining({ message: "final listener rejected" })],
    }));
    await expect(third).resolves.toBeUndefined();
    firstGate.resolve();
    await expect(first).resolves.toBeUndefined();
    errorLog.mockRestore();
  });

  it("keeps a published hop pending while a late callback joins the same downstream lineage", async () => {
    const { filesystem, middleware, plugin } = harness();
    const firstListener = deferred();
    const publications: Array<[string, string]> = [];
    const listener = jest.fn(({ file: renamedFile, oldPath }) => {
      publications.push([oldPath, renamedFile.path]);
      return publications.length === 1 ? firstListener.promise : Promise.resolve();
    });
    middleware.eventDispatch.addListener("onRename", listener);
    let firstSettled = false;
    let secondSettled = false;

    const newFile = file("New", "New.md");
    const finalFile = file("Final", "Final.md");
    (plugin.app.vault.getAbstractFileByPath as jest.Mock).mockImplementation(
      (path: string) => path === newFile.path ? newFile : path === finalFile.path ? finalFile : null,
    );
    const first = filesystem.onRename(newFile as any, "Old.md")
      .then(() => { firstSettled = true; });
    await flushUntil(() => publications.length === 1);
    expect(firstSettled).toBe(false);

    const second = filesystem.onRename(finalFile as any, "New.md")
      .then(() => { secondSettled = true; });
    await flushUntil(() => publications.length === 2);

    expect(publications).toEqual([
      ["Old.md", "New.md"],
      ["New.md", "Final.md"],
    ]);
    expect(firstSettled).toBe(false);
    await second;
    expect(secondSettled).toBe(true);
    firstListener.resolve();
    await first;
    expect(firstSettled).toBe(true);
  });

  it("publishes overlapping physical rename hops once and in callback order", async () => {
    const { filesystem, middleware, plugin } = harness();
    const firstStore = deferred();
    const publications: Array<[string, string]> = [];
    let downstreamIdentity = "Old.md";
    (filesystem.persister.store as jest.Mock)
      .mockImplementationOnce(() => firstStore.promise)
      .mockResolvedValue(undefined);
    filesystem.cache.set("Old.md", {
      file: file("Old", "Old.md"),
      ctime: 10,
      label: { name: "Old" },
    } as any);
    middleware.eventDispatch.addListener("onRename", ({ file: renamedFile, oldPath }) => {
      publications.push([oldPath, renamedFile.path]);
      if (downstreamIdentity === oldPath) downstreamIdentity = renamedFile.path;
    });

    const newFile = file("New", "New.md");
    const finalFile = file("Final", "Final.md");
    (plugin.app.vault.getAbstractFileByPath as jest.Mock).mockImplementation(
      (path: string) => path === newFile.path ? newFile : path === finalFile.path ? finalFile : null,
    );
    const first = filesystem.onRename(newFile as any, "Old.md");
    await flushUntil(() => (filesystem.persister.store as jest.Mock).mock.calls.length > 0);
    const second = filesystem.onRename(finalFile as any, "New.md");
    await Promise.resolve();

    expect(publications).toEqual([]);
    firstStore.resolve();
    await Promise.all([first, second]);

    expect(publications).toEqual([
      ["Old.md", "New.md"],
      ["New.md", "Final.md"],
    ]);
    expect(downstreamIdentity).toBe("Final.md");
  });

  it("invalidates delayed old-path parse work before publishing the destination", async () => {
    const { filesystem, middleware, plugin } = harness();
    const parseGate = deferred();
    const filetypeCache = new Map<string, any>();
    const parseCache = jest.fn(async (createdFile: any, _refresh: boolean, generation?: number) => {
      await parseGate.promise;
      if (!middleware.isPathGenerationCurrent(createdFile.path, generation)) return;
      const cache = { property: { generation: "old-late" } };
      filetypeCache.set(createdFile.path, cache);
      middleware.updateFileCache(createdFile.path, cache, false, generation);
    });
    middleware.initiateFiletypeAdapter({
      cache: filetypeCache,
      initiate: jest.fn(),
      parseCache,
      supportedFileTypes: ["md"],
    } as any);
    const order: string[] = [];
    middleware.eventDispatch.addListener("onPathInvalidated", ({ path }) => { order.push(`invalidated:${path}`); });
    middleware.eventDispatch.addListener("onRename", ({ file: renamed }) => { order.push(`renamed:${renamed.path}`); });

    const oldFile = file("Old", "Old.md");
    const newFile = file("New", "New.md");
    (plugin.app.vault.getAbstractFileByPath as jest.Mock).mockImplementation(
      (path: string) => path === oldFile.path ? oldFile : path === newFile.path ? newFile : null,
    );
    const oldCreate = filesystem.onCreate(oldFile as any);
    while (parseCache.mock.calls.length === 0) await Promise.resolve();
    const oldGeneration = middleware.capturePathGeneration("Old.md");
    const rename = filesystem.onRename(newFile as any, "Old.md");

    expect(middleware.isPathGenerationCurrent("Old.md", oldGeneration)).toBe(false);
    expect(order[0]).toBe("invalidated:Old.md");
    parseGate.resolve();
    await Promise.all([oldCreate, rename]);

    expect(filetypeCache.has("Old.md")).toBe(false);
    expect(filesystem.cache.has("Old.md")).toBe(false);
    expect(order).toEqual(["invalidated:Old.md", "renamed:New.md"]);
    const oldStores = (filesystem.persister.store as jest.Mock).mock.calls.filter(
      ([path]) => path === "Old.md",
    );
    expect(oldStores).toEqual([]);
  });

  it("safely constructs and persists a destination when the old cache is missing", async () => {
    const { filesystem, middleware, plugin } = harness();
    const renamed: string[] = [];
    middleware.eventDispatch.addListener("onRename", ({ file: renamedFile }) => {
      renamed.push(renamedFile.path);
    });

    const newFile = file("New", "New.md");
    (plugin.app.vault.getAbstractFileByPath as jest.Mock).mockReturnValue(newFile);
    await expect(filesystem.onRename(newFile as any, "Missing.md")).resolves.toBeUndefined();

    expect(filesystem.cache.get("New.md")?.file.path).toBe("New.md");
    expect(filesystem.cache.get("New.md")?.label.name).toBe("New");
    expect(filesystem.persister.remove).toHaveBeenCalledWith("Missing.md", "file");
    expect(filesystem.persister.store).toHaveBeenCalledWith(
      "New.md",
      expect.any(String),
      "file",
    );
    expect(renamed).toEqual(["New.md"]);
  });

  it("serializes an active old store, old removal, and fresh destination persistence", async () => {
    const { filesystem, plugin } = harness();
    const staleStore = deferred();
    const removeGate = deferred();
    const operations: string[] = [];
    (filesystem.persister.store as jest.Mock)
      .mockImplementationOnce(() => {
        operations.push("store-old");
        return staleStore.promise;
      })
      .mockImplementationOnce(() => {
        operations.push("store-new");
        return Promise.resolve();
      });
    (filesystem.persister.remove as jest.Mock).mockImplementationOnce(() => {
      operations.push("remove-old");
      return removeGate.promise;
    });
    filesystem.cache.set("Old.md", {
      file: file("Old", "Old.md"),
      ctime: 10,
      label: { name: "Old" },
      property: { state: "old" },
    } as any);

    const newFile = file("New", "New.md");
    (plugin.app.vault.getAbstractFileByPath as jest.Mock).mockReturnValue(newFile);
    filesystem.updateFileCache("Old.md", { property: { state: "stale-write" } } as any, false);
    while (operations.length === 0) await Promise.resolve();
    const rename = filesystem.onRename(newFile as any, "Old.md");

    expect(operations).toEqual(["store-old"]);
    staleStore.resolve();
    await flushUntil(() => operations.includes("remove-old"));
    expect(operations).toEqual(["store-old", "remove-old"]);
    removeGate.resolve();
    await rename;

    expect(operations).toEqual(["store-old", "remove-old", "store-new"]);
    const persistedDestination = JSON.parse(
      (filesystem.persister.store as jest.Mock).mock.calls.at(-1)?.[1],
    );
    expect(persistedDestination.file.path).toBe("New.md");
    expect(persistedDestination.property).toEqual({ state: "stale-write" });
  });

  it("allows an old-path recreation without aborting the independent destination rename", async () => {
    const { filesystem, middleware, plugin } = harness();
    const removeGate = deferred();
    (filesystem.persister.remove as jest.Mock).mockReturnValueOnce(removeGate.promise);
    filesystem.cache.set("Old.md", {
      file: file("Old", "Old.md"),
      ctime: 10,
      label: { name: "Old" },
    } as any);
    const renamed: string[] = [];
    middleware.eventDispatch.addListener("onRename", ({ file: renamedFile }) => {
      renamed.push(renamedFile.path);
    });

    const newFile = file("New", "New.md");
    (plugin.app.vault.getAbstractFileByPath as jest.Mock).mockReturnValue(newFile);
    const rename = filesystem.onRename(newFile as any, "Old.md");
    await flushUntil(() => (filesystem.persister.remove as jest.Mock).mock.calls.length > 0);
    middleware.beginPathGeneration("Old.md");
    removeGate.resolve();
    await rename;

    expect(filesystem.persister.store).toHaveBeenCalledWith("New.md", expect.any(String), "file");
    expect(renamed).toEqual(["New.md"]);
  });

  it("ignores a delayed rename callback when the destination now resolves to a replacement incarnation", async () => {
    const { filesystem, middleware, plugin } = harness();
    const callbackFile = file("New", "New.md");
    const replacement = file("Replacement", "New.md");
    (plugin.app.vault.getAbstractFileByPath as jest.Mock).mockImplementation(
      (path: string) => path === "New.md" ? replacement : null,
    );
    const oldCache = { file: file("Old", "Old.md"), label: { name: "Old" } } as any;
    const replacementCache = { file: replacement, label: { name: "Replacement" } } as any;
    filesystem.cache.set("Old.md", oldCache);
    filesystem.cache.set("New.md", replacementCache);
    const invalidate = jest.spyOn(middleware, "invalidatePath");
    const beginGeneration = jest.spyOn(middleware, "beginPathGeneration");
    const listener = jest.fn();
    middleware.eventDispatch.addListener("onRename", listener);

    await expect(filesystem.onRename(callbackFile as any, "Old.md")).resolves.toBeUndefined();

    expect(filesystem.cache.get("Old.md")).toBe(oldCache);
    expect(filesystem.cache.get("New.md")).toBe(replacementCache);
    expect(invalidate).not.toHaveBeenCalled();
    expect(beginGeneration).not.toHaveBeenCalled();
    expect(filesystem.persister.remove).not.toHaveBeenCalled();
    expect(filesystem.persister.store).not.toHaveBeenCalled();
    expect(listener).not.toHaveBeenCalled();
  });

  it("rejects the exact rename lifecycle when persisted old-cache removal fails but still publishes", async () => {
    const { filesystem, middleware, plugin } = harness();
    const renamedFile = file("New", "New.md");
    (plugin.app.vault.getAbstractFileByPath as jest.Mock).mockReturnValue(renamedFile);
    const removalFailure = new Error("old cache removal failed");
    (filesystem.persister.remove as jest.Mock).mockRejectedValueOnce(removalFailure);
    const listener = jest.fn().mockResolvedValue(undefined);
    middleware.eventDispatch.addListener("onRename", listener);

    await expect(filesystem.onRename(renamedFile as any, "Old.md")).rejects.toMatchObject({
      name: "AggregateError",
      errors: [removalFailure],
    });

    expect(filesystem.persister.store).toHaveBeenCalledWith("New.md", expect.any(String), "file");
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("rejects the exact rename lifecycle when destination persistence fails but still publishes", async () => {
    const { filesystem, middleware, plugin } = harness();
    const renamedFile = file("New", "New.md");
    (plugin.app.vault.getAbstractFileByPath as jest.Mock).mockReturnValue(renamedFile);
    const storeFailure = new Error("destination cache store failed");
    (filesystem.persister.store as jest.Mock).mockRejectedValueOnce(storeFailure);
    const listener = jest.fn().mockResolvedValue(undefined);
    middleware.eventDispatch.addListener("onRename", listener);

    await expect(filesystem.onRename(renamedFile as any, "Old.md")).rejects.toMatchObject({
      name: "AggregateError",
      errors: [storeFailure],
    });

    expect(filesystem.persister.remove).toHaveBeenCalledWith("Old.md", "file");
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
