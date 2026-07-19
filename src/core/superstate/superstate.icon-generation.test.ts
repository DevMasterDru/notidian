jest.mock("main", () => ({}));
jest.mock("obsidian", () => ({ normalizePath: (path: string) => path }), { virtual: true });
jest.mock("./api", () => ({ API: class {} }));
jest.mock("./commands", () => ({ SpacesCommandsAdapter: class {} }));
jest.mock("../utils/contexts/context", () => ({
  removeLinkInContexts: jest.fn(() => Promise.resolve()),
  removePathInContexts: jest.fn(() => Promise.resolve()),
  removeTagInContexts: jest.fn(() => Promise.resolve()),
  renameLinkInContexts: jest.fn(() => Promise.resolve()),
  renamePathInContexts: jest.fn(() => Promise.resolve()),
  renameTagInContexts: jest.fn(() => Promise.resolve()),
  updateContextWithProperties: jest.fn(() => Promise.resolve()),
}));

import { ObsidianAssetManager } from "adapters/obsidian/assets/ObsidianAssetManager";
import { EventDispatcher } from "shared/utils/dispatchers/dispatcher";
import { IndexMap } from "shared/types/indexMap";
import { Superstate } from "./superstate";
import { Indexer } from "./workers/indexer/indexer";

type Deferred = {
  promise: Promise<void>;
  resolve: () => void;
};

const deferred = (): Deferred => {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
};

const svgState = (path: string, version: string) => ({
  path,
  type: "file",
  subtype: "svg",
  tags: [] as string[],
  spaces: [] as string[],
  outlinks: [] as string[],
  metadata: { file: { extension: "svg", filename: `${version}.svg`, path } },
});

const flushUntil = async (predicate: () => boolean, turns = 20) => {
  for (let turn = 0; turn < turns && !predicate(); turn += 1) {
    await Promise.resolve();
  }
};

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
  superstate.settings = { enhancedLogs: false, indexSVG: true } as any;
  superstate.eventsDispatcher = new EventDispatcher();
  superstate.spaceManager = { readPath: jest.fn(), spaceInfoForPath: jest.fn() } as any;
  superstate.spaceManager.superstate = superstate;
  superstate.persister = {
    store: jest.fn().mockResolvedValue(undefined),
    remove: jest.fn().mockResolvedValue(undefined),
  } as any;
  superstate.assets = new ObsidianAssetManager(
    superstate.spaceManager as any,
    {} as any,
    superstate.persister,
    {} as any,
  );
  (superstate as any).contextStateQueue = Promise.resolve();
  (superstate as any).indexer = new Indexer(1, superstate);
  return superstate;
};

const configureIconsetAlias = (superstate: Superstate, path: string) => {
  superstate.assets.iconsetCaches.set("atlas", new Map());
  (superstate.assets as any).iconPathMetadata.set(path, {
    iconsetId: "atlas",
    iconId: "compass",
  });
};

describe("Superstate SVG generation and persistence", () => {
  it("orders stale icon store, invalidation removal, and fresh recreation store", async () => {
    const superstate = harness();
    const path = ".notidian/iconsets/atlas/compass.svg";
    configureIconsetAlias(superstate, path);
    const staleStore = deferred();
    const removeGate = deferred();
    const operations: string[] = [];
    (superstate.spaceManager.readPath as jest.Mock)
      .mockResolvedValueOnce("<svg>stale</svg>")
      .mockResolvedValueOnce("<svg>fresh</svg>");
    (superstate.persister.store as jest.Mock).mockImplementation(
      (_path: string, _content: string, type: string) => {
        if (type !== "icon") return Promise.resolve();
        if (!operations.includes("store-stale")) {
          operations.push("store-stale");
          return staleStore.promise;
        }
        operations.push("store-fresh");
        return Promise.resolve();
      },
    );
    (superstate.persister.remove as jest.Mock).mockImplementation(
      (_path: string, type: string) => {
        if (type === "icon") {
          operations.push("remove-icon");
          return removeGate.promise;
        }
        return Promise.resolve();
      },
    );

    const staleGeneration = (superstate as any).indexer.pathGeneration(path);
    const staleReload = (superstate as any).pathReloaded(
      path,
      svgState(path, "stale"),
      true,
      false,
      staleGeneration,
    );
    await flushUntil(() => operations.length > 0);
    expect(operations).toEqual(["store-stale"]);
    expect(superstate.assets.getIconSync("atlas//compass")).toBe("<svg>stale</svg>");

    const invalidation = superstate.invalidatePath(path);
    const freshGeneration = (superstate as any).indexer.pathGeneration(path);
    const freshReload = (superstate as any).pathReloaded(
      path,
      svgState(path, "fresh"),
      true,
      false,
      freshGeneration,
    );

    expect(superstate.assets.getIconSync("atlas//compass")).toBeUndefined();
    expect(operations).toEqual(["store-stale"]);
    staleStore.resolve();
    await expect(staleReload).resolves.toBe(false);
    await flushUntil(() => operations.includes("remove-icon"));
    expect(operations).toEqual(["store-stale", "remove-icon"]);
    removeGate.resolve();
    await invalidation;
    await freshReload;
    await flushUntil(() => operations.includes("store-fresh"));

    expect(operations).toEqual(["store-stale", "remove-icon", "store-fresh"]);
    expect(superstate.assets.getIconSync(path)).toBe("<svg>fresh</svg>");
    expect(superstate.assets.getIconSync("compass")).toBe("<svg>fresh</svg>");
    expect(superstate.assets.getIconSync("atlas//compass")).toBe("<svg>fresh</svg>");
  });

  it("continues icon persistence after stale store and removal rejections", async () => {
    const superstate = harness();
    const path = ".notidian/iconsets/atlas/compass.svg";
    configureIconsetAlias(superstate, path);
    const operations: string[] = [];
    (superstate.spaceManager.readPath as jest.Mock)
      .mockResolvedValueOnce("<svg>stale</svg>")
      .mockResolvedValueOnce("<svg>fresh</svg>");
    (superstate.persister.store as jest.Mock).mockImplementation(
      (_path: string, _content: string, type: string) => {
        if (type !== "icon") return Promise.resolve();
        if (!operations.includes("store-stale")) {
          operations.push("store-stale");
          const rejected = Promise.reject(new Error("stale icon store failed"));
          void rejected.catch((): void => undefined);
          return rejected;
        }
        operations.push("store-fresh");
        return Promise.resolve();
      },
    );
    (superstate.persister.remove as jest.Mock).mockImplementation(
      (_path: string, type: string) => {
        if (type === "icon") {
          operations.push("remove-icon");
          return Promise.reject(new Error("icon removal failed"));
        }
        return Promise.resolve();
      },
    );
    const error = jest.spyOn(console, "error").mockImplementation(() => undefined);
    await (superstate as any).pathReloaded(
      path,
      svgState(path, "stale"),
      true,
      false,
      (superstate as any).indexer.pathGeneration(path),
    );
    await flushUntil(() => operations.includes("store-stale"));
    const invalidation = expect(superstate.invalidatePath(path)).rejects.toThrow("icon removal failed");
    await (superstate as any).pathReloaded(
      path,
      svgState(path, "fresh"),
      true,
      false,
      (superstate as any).indexer.pathGeneration(path),
    );
    await flushUntil(() => operations.includes("store-fresh"));
    await invalidation;

    expect(operations).toEqual(["store-stale", "remove-icon", "store-fresh"]);
    expect(superstate.assets.getIconSync("atlas//compass")).toBe("<svg>fresh</svg>");
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });
});
