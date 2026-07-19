jest.mock("./api", () => ({ API: class {} }));
jest.mock("./commands", () => ({ SpacesCommandsAdapter: class {} }));

import { PathPropertyName } from "shared/types/context";
import { EventDispatcher } from "shared/utils/dispatchers/dispatcher";
import { IndexMap } from "shared/types/indexMap";
import { Superstate } from "./superstate";
import { SpaceManager } from "core/spaceManager/spaceManager";
import { Indexer } from "./workers/indexer/indexer";
import { applyTableMutation } from "core/utils/contexts/tableMutation";
import { TableMutationOperation } from "shared/types/spaceManager";

type Deferred<T> = { promise: Promise<T>; resolve: (value: T) => void };
const deferred = <T,>(): Deferred<T> => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
};

const contextTable = () => ({
  schema: { id: "context" },
  cols: [
    { name: PathPropertyName, type: "file" },
    { name: "relation", type: "link-multi", source: "frontmatter" },
  ],
  rows: [
    { [PathPropertyName]: "Old.md", relation: '["Keep.md"]' },
    { [PathPropertyName]: "Ref.md", relation: '["Old.md","Keep.md"]' },
  ],
} as any);

const pathState = (path: string) => ({
  path,
  type: "file",
  subtype: "md",
  tags: [] as string[],
  spaces: ["Space"],
  outlinks: [] as string[],
  metadata: { file: { extension: "md", filename: path, path } },
});

const harness = () => {
  const superstate = Object.create(Superstate.prototype) as Superstate;
  let table = contextTable();
  const frontmatter = new Map<string, Record<string, unknown>>([
    ["Ref.md", { relation: ["[[Old.md]]", "[[Keep.md]]"] }],
  ]);
  superstate.pathsIndex = new Map([["Old.md", pathState("Old.md") as any]]);
  superstate.spacesIndex = new Map([["Space", {
    path: "Space",
    space: { path: "Space" },
    metadata: { links: ["Old.md"] },
  } as any]]);
  superstate.contextsIndex = new Map([["Space", { path: "Space", outlinks: ["Old.md"] } as any]]);
  superstate.tagsMap = new IndexMap();
  superstate.linksMap = new IndexMap();
  superstate.spacesMap = new IndexMap();
  superstate.spacesMap.set("Old.md", new Set(["Space"]));
  superstate.imagesCache = new Map();
  superstate.focuses = [{ name: "Pinned", paths: ["Old.md"] }] as any;
  superstate.settings = { enhancedLogs: false, indexSVG: false } as any;
  superstate.eventsDispatcher = new EventDispatcher();
  superstate.assets = null;
  const view = { openPath: jest.fn() };
  superstate.ui = { viewsByPath: jest.fn((): any[] => [view]) } as any;
  superstate.persister = {
    remove: jest.fn().mockResolvedValue(undefined),
    store: jest.fn().mockResolvedValue(undefined),
  } as any;
  const primarySpaceAdapter = {
    saveFocuses: jest.fn().mockResolvedValue(undefined),
    readFocuses: jest.fn(async () => structuredClone(superstate.focuses)),
  } as any;
  const manager = new SpaceManager();
  manager.primarySpaceAdapter = primarySpaceAdapter;
  manager.superstate = superstate;
  Object.assign(manager, {
    contextForSpace: jest.fn(async () => structuredClone(table)),
    saveTable: jest.fn(async (_path: string, next: any) => {
      table = structuredClone(next);
      return true;
    }),
    mutateTable: jest.fn(async (
      _path: string,
      schemaId: string,
      operation: TableMutationOperation,
    ) => {
      if (schemaId !== table.schema.id) throw new Error(`unexpected schema ${schemaId}`);
      table = structuredClone(applyTableMutation(structuredClone(table), operation));
      return true;
    }),
    saveProperties: jest.fn(async (path: string, values: Record<string, unknown>) => {
      frontmatter.set(path, { ...(frontmatter.get(path) ?? {}), ...values });
      return true;
    }),
    mutateProperties: jest.fn(async (
      path: string,
      mutation: (current: Record<string, unknown>) => Record<string, unknown>,
    ) => {
      frontmatter.set(path, mutation(structuredClone(frontmatter.get(path) ?? {})));
      return true;
    }),
    saveSpace: jest.fn(async (path: string, update: (metadata: any) => any) => {
      const state = superstate.spacesIndex.get(path)!;
      state.metadata = update(state.metadata);
      return true;
    }),
    readProperties: jest.fn(async (path: string) => frontmatter.get(path) ?? {}),
    reloadContextByPath: jest.fn().mockResolvedValue(true),
    getPathInfo: jest.fn(async (path: string) => ({ path, obsidianFile: { path } })),
    resolvePath: jest.fn((path: string) => path),
    spaceInfoForPath: jest.fn((path: string) => ({ path })),
  });
  superstate.spaceManager = manager;
  superstate.reloadContext = jest.fn().mockResolvedValue(true);
  (superstate as any).updateSpaceMetadata = jest.fn(async (path: string, metadata: any) => {
    superstate.spacesIndex.get(path)!.metadata = metadata;
  });
  superstate.reloadPath = jest.fn().mockImplementation(async (path: string) => {
    superstate.pathsIndex.set(path, pathState(path) as any);
    superstate.spacesMap.set(path, new Set(["Space"]));
    return true;
  });
  superstate.dispatchEvent = jest.fn();
  (superstate as any).contextStateQueue = Promise.resolve();
  (superstate as any).indexer = new Indexer(1, superstate);
  return {
    frontmatter,
    primarySpaceAdapter,
    superstate,
    table: () => table,
    setTable: (next: any) => { table = structuredClone(next); },
    view,
  };
};

describe("Superstate path lifecycle serialization", () => {
  it("does not let queued deletion remove a same-path recreation", async () => {
    const { superstate, table, frontmatter } = harness();
    const blocker = deferred<void>();
    superstate.addToContextStateQueue(() => blocker.promise);

    const deletion = superstate.onPathDeleted("Old.md");
    expect(deletion).toBeInstanceOf(Promise);
    const recreation = superstate.onPathCreated("Old.md");
    blocker.resolve();
    await Promise.all([deletion, recreation]);
    await (superstate as any).contextStateQueue;

    expect(table().rows.map((row: any) => row[PathPropertyName])).toEqual(["Old.md", "Ref.md"]);
    expect(frontmatter.get("Ref.md")?.relation).toEqual(["[[Old.md]]", "[[Keep.md]]"]);
  });

  it("rolls back deletion invalidated during canonical link persistence", async () => {
    const { superstate, table, frontmatter } = harness();
    const canonicalGate = deferred<boolean>();
    const originalSave = superstate.spaceManager.mutateProperties as jest.Mock;
    originalSave.mockImplementationOnce(async (
      path: string,
      mutation: (current: Record<string, unknown>) => Record<string, unknown>,
    ) => {
      const saved = await canonicalGate.promise;
      if (saved) frontmatter.set(path, mutation(structuredClone(frontmatter.get(path) ?? {})));
      return saved;
    });

    const deletion = superstate.onPathDeleted("Old.md");
    while (originalSave.mock.calls.length === 0) await Promise.resolve();
    const recreation = superstate.onPathCreated("Old.md");
    canonicalGate.resolve(true);
    await Promise.all([deletion, recreation]);
    await (superstate as any).contextStateQueue;

    expect(table()).toEqual(contextTable());
    expect(frontmatter.get("Ref.md")?.relation).toEqual(["[[Old.md]]", "[[Keep.md]]"]);
  });

  it("carries original row and link identity through Old to New to Final", async () => {
    const { superstate, table, frontmatter, view } = harness();
    const blocker = deferred<void>();
    superstate.addToContextStateQueue(() => blocker.promise);
    superstate.invalidatePath("Old.md");

    const first = superstate.onPathRename("Old.md", "New.md");
    const second = superstate.onPathRename("New.md", "Final.md");
    blocker.resolve();
    await Promise.all([first, second]);

    expect(table().rows.map((row: any) => row[PathPropertyName])).toEqual(["Final.md", "Ref.md"]);
    expect(table().rows[1].relation).toBe('["Final.md","Keep.md"]');
    expect(frontmatter.get("Ref.md")?.relation).toEqual(["[[Final.md]]", "[[Keep.md]]"]);
    expect(superstate.focuses[0].paths).toEqual(["Final.md"]);
    expect((superstate.dispatchEvent as jest.Mock).mock.calls
      .filter(([event]) => event === "pathChanged"))
      .toEqual([
        ["pathChanged", { path: "Old.md", newPath: "New.md" }],
        ["pathChanged", { path: "New.md", newPath: "Final.md" }],
      ]);
    expect(view.openPath.mock.calls).toEqual([["New.md"], ["Final.md"]]);
    expect((superstate as any).renameLineages.size).toBe(0);
  });

  it("persists focuses before publishing exactly one committed event", async () => {
    const { superstate, primarySpaceAdapter } = harness();
    const gate = deferred<void>();
    primarySpaceAdapter.saveFocuses.mockReturnValueOnce(gate.promise);
    const events: string[] = [];
    superstate.dispatchEvent = jest.fn((event: string) => { events.push(event); }) as any;

    const rename = superstate.onPathRename("Old.md", "New.md");
    while (primarySpaceAdapter.saveFocuses.mock.calls.length === 0) await Promise.resolve();

    expect(superstate.focuses[0].paths).toEqual(["Old.md"]);
    expect(events).not.toContain("focusesChanged");
    gate.resolve();
    await expect(rename).resolves.toBe(true);
    expect(superstate.focuses[0].paths).toEqual(["New.md"]);
    expect(events.filter(event => event === "focusesChanged")).toHaveLength(1);
  });

  it("keeps original focus publication and emits nothing when persistence rejects", async () => {
    const { superstate, primarySpaceAdapter } = harness();
    primarySpaceAdapter.saveFocuses.mockRejectedValueOnce(new Error("focus write failed"));
    const error = jest.spyOn(console, "error").mockImplementation(() => undefined);

    await expect(superstate.onPathRename("Old.md", "New.md")).resolves.toBe(false);

    expect(superstate.focuses[0].paths).toEqual(["Old.md"]);
    expect(superstate.dispatchEvent).not.toHaveBeenCalledWith("focusesChanged", null);
    expect((superstate as any).renameLineages.size).toBe(0);
    error.mockRestore();
  });

  it("cleans failed lineage aliases so a later same-path rename starts fresh", async () => {
    const { superstate, primarySpaceAdapter } = harness();
    primarySpaceAdapter.saveFocuses.mockRejectedValueOnce(new Error("focus write failed"));
    const error = jest.spyOn(console, "error").mockImplementation(() => undefined);

    await expect(superstate.onPathRename("Old.md", "New.md")).resolves.toBe(false);
    expect((superstate as any).renameLineages.size).toBe(0);

    superstate.pathsIndex.set("Old.md", pathState("Old.md") as any);
    superstate.focuses = [{ name: "Pinned", paths: ["Old.md"] }] as any;
    await expect(superstate.onPathRename("Old.md", "Later.md")).resolves.toBe(true);
    expect((superstate as any).renameLineages.size).toBe(0);
    expect(superstate.focuses[0].paths).toEqual(["Later.md"]);
    error.mockRestore();
  });

  it("publishes a later completed physical hop after an earlier lifecycle hop fails", async () => {
    const { superstate, primarySpaceAdapter, table } = harness();
    primarySpaceAdapter.saveFocuses.mockRejectedValueOnce(new Error("first hop focus write failed"));
    const error = jest.spyOn(console, "error").mockImplementation(() => undefined);
    await superstate.invalidatePath("Old.md");

    const first = superstate.onPathRename("Old.md", "New.md");
    const second = superstate.onPathRename("New.md", "Final.md");

    await expect(Promise.all([first, second])).resolves.toEqual([false, true]);
    expect(table().rows.map((row: any) => row[PathPropertyName])).toEqual(["Final.md", "Ref.md"]);
    expect(superstate.focuses[0].paths).toEqual(["Final.md"]);
    expect((superstate.dispatchEvent as jest.Mock).mock.calls
      .filter(([event]) => event === "pathChanged"))
      .toEqual([["pathChanged", { path: "New.md", newPath: "Final.md" }]]);
    expect((superstate as any).renameLineages.size).toBe(0);
    error.mockRestore();
  });

  it("cancels and cleans queued hops when an intermediate destination is truly deleted", async () => {
    const { superstate, table, frontmatter } = harness();
    const blocker = deferred<void>();
    superstate.addToContextStateQueue(() => blocker.promise);
    superstate.invalidatePath("Old.md");

    const first = superstate.onPathRename("Old.md", "New.md");
    const second = superstate.onPathRename("New.md", "Final.md");
    const deletion = superstate.onPathDeleted("New.md");
    blocker.resolve();

    await expect(Promise.all([first, second, deletion])).resolves.toEqual([false, false, undefined]);
    expect(table()).toEqual(contextTable());
    expect(frontmatter.get("Ref.md")?.relation).toEqual(["[[Old.md]]", "[[Keep.md]]"]);
    expect((superstate as any).renameLineages.size).toBe(0);
  });
});
