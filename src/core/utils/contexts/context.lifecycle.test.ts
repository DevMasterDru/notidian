import { PathPropertyName } from "shared/types/context";
import { SpaceTable } from "shared/types/mdb";
import { TableMutationOperation } from "shared/types/spaceManager";
import {
  removePathLifecycleInContexts,
  renamePathLifecycleInContexts,
} from "./context";

type Deferred<T> = { promise: Promise<T>; resolve: (value: T) => void };
const deferred = <T,>(): Deferred<T> => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
};

const space = { path: "Space" } as any;
const originalTable = (): SpaceTable => ({
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

const harness = () => {
  let table = originalTable();
  const frontmatter = new Map<string, Record<string, unknown>>([
    ["Ref.md", { relation: ["[[Old.md]]", "[[Keep.md]]"] }],
  ]);
  const manager = {
    superstate: {
      settings: { enhancedLogs: false },
      spacesMap: { getInverse: jest.fn(() => ["Old.md", "Ref.md"]) },
      reloadContextByPath: jest.fn().mockResolvedValue(true),
    },
    contextForSpace: jest.fn(async () => structuredClone(table)),
    readProperties: jest.fn(async (path: string) => structuredClone(frontmatter.get(path) ?? {})),
    saveProperties: jest.fn(async (path: string, values: Record<string, unknown>) => {
      frontmatter.set(path, { ...(frontmatter.get(path) ?? {}), ...values });
      return true;
    }),
    mutateProperties: jest.fn(async (
      path: string,
      mutation: (properties: Record<string, unknown>) => Record<string, unknown>,
    ) => {
      const next = mutation(structuredClone(frontmatter.get(path) ?? {}));
      frontmatter.set(path, structuredClone(next));
      return true;
    }),
    saveTable: jest.fn(async (_path: string, next: SpaceTable) => {
      table = structuredClone(next);
      return true;
    }),
    mutateTable: jest.fn(async (
      _path: string,
      _schemaId: string,
      operation: TableMutationOperation,
    ) => {
      if (operation.kind !== "transform") throw new Error("expected transform");
      table = structuredClone(operation.apply(structuredClone(table)));
      return true;
    }),
    deleteProperty: jest.fn(async (path: string, property: string) => {
      const next = { ...(frontmatter.get(path) ?? {}) };
      delete next[property];
      frontmatter.set(path, next);
      return true;
    }),
  } as any;
  return {
    frontmatter,
    manager,
    table: () => table,
    setTable: (next: SpaceTable) => { table = structuredClone(next); },
  };
};

describe("context path lifecycle transactions", () => {
  it("awaits canonical link persistence before committing renamed context rows", async () => {
    const { manager, table, frontmatter } = harness();
    const canonicalGate = deferred<boolean>();
    manager.mutateProperties.mockImplementationOnce(async (
      path: string,
      mutation: (properties: Record<string, unknown>) => Record<string, unknown>,
    ) => {
      const saved = await canonicalGate.promise;
      if (saved) frontmatter.set(path, mutation(structuredClone(frontmatter.get(path) ?? {})));
      return saved;
    });
    let settled = false;

    const rename = renamePathLifecycleInContexts(
      manager,
      "Old.md",
      "New.md",
      [space],
      [space],
    ).then(() => { settled = true; });
    while (manager.mutateProperties.mock.calls.length === 0) await Promise.resolve();

    expect(manager.mutateTable).not.toHaveBeenCalled();
    expect(settled).toBe(false);
    canonicalGate.resolve(true);
    await rename;

    expect(table().rows.map(row => row[PathPropertyName])).toEqual(["New.md", "Ref.md"]);
    expect(table().rows[1].relation).toBe('["New.md","Keep.md"]');
    expect(frontmatter.get("Ref.md")?.relation).toEqual(["[[New.md]]", "[[Keep.md]]"]);
  });

  it("restores exact rows and canonical links when a table persistence fails after writing", async () => {
    const { manager, table, frontmatter, setTable } = harness();
    const before = originalTable();
    manager.mutateTable.mockImplementationOnce(async (_path: string, _schemaId: string, operation: TableMutationOperation) => {
      const next = operation.kind === "transform" ? operation.apply(table()) : table();
      setTable(next);
      throw new Error("table persistence failed after write");
    });

    await expect(renamePathLifecycleInContexts(
      manager,
      "Old.md",
      "New.md",
      [space],
      [space],
    )).rejects.toThrow("table persistence failed after write");

    expect(table()).toEqual(before);
    expect(frontmatter.get("Ref.md")?.relation).toEqual(["[[Old.md]]", "[[Keep.md]]"]);
    expect(manager.mutateTable).toHaveBeenLastCalledWith(
      "Space", "context", expect.objectContaining({ kind: "transform" }), true,
    );
  });

  it("rolls back to fresh canonical frontmatter instead of a stale table projection", async () => {
    const { manager, table, frontmatter, setTable } = harness();
    frontmatter.set("Ref.md", { relation: ["[[External.md]]"] });
    manager.mutateTable.mockImplementationOnce(async (_path: string, _schemaId: string, operation: TableMutationOperation) => {
      const next = operation.kind === "transform" ? operation.apply(table()) : table();
      setTable(next);
      throw new Error("table failed");
    });

    await expect(renamePathLifecycleInContexts(
      manager, "Old.md", "New.md", [space], [space],
    )).rejects.toThrow("table failed");

    expect(table()).toEqual(originalTable());
    expect(frontmatter.get("Ref.md")).toEqual({ relation: ["[[External.md]]"] });
  });

  it("restores exact property absence when the first canonical save rejects before mutation", async () => {
    const { manager, frontmatter } = harness();
    frontmatter.set("Ref.md", {});
    manager.mutateProperties.mockRejectedValueOnce(new Error("save rejected before mutation"));

    await expect(renamePathLifecycleInContexts(
      manager, "Old.md", "New.md", [space], [space],
    )).rejects.toThrow("save rejected before mutation");

    expect(frontmatter.get("Ref.md")).toEqual({});
    expect(manager.deleteProperty).not.toHaveBeenCalled();
  });

  it("removes a path row and its canonical links as one persistence transaction", async () => {
    const { manager, table, frontmatter } = harness();

    await removePathLifecycleInContexts(manager, "Old.md", [space], [space]);

    expect(table().rows.map(row => row[PathPropertyName])).toEqual(["Ref.md"]);
    expect(table().rows[0].relation).toBe('["Keep.md"]');
    expect(frontmatter.get("Ref.md")?.relation).toEqual(["[[Keep.md]]"]);
  });

  it("rebases the forward table save over an unrelated concurrent append", async () => {
    const { manager, table, setTable } = harness();
    const canonicalGate = deferred<boolean>();
    manager.mutateProperties.mockImplementationOnce(async () => canonicalGate.promise);
    const rename = renamePathLifecycleInContexts(manager, "Old.md", "New.md", [space], [space]);
    while (manager.mutateProperties.mock.calls.length === 0) await Promise.resolve();
    setTable({
      ...table(),
      rows: [...table().rows, { [PathPropertyName]: "Concurrent.md", relation: '[]' }],
    });
    canonicalGate.resolve(true);
    await rename;

    expect(table().rows.map(row => row[PathPropertyName])).toEqual([
      "New.md", "Ref.md", "Concurrent.md",
    ]);
  });

  it("preserves a production table mutation committed after lifecycle reread but before commit", async () => {
    const { manager, table, setTable } = harness();
    manager.mutateTable.mockImplementationOnce(async (
      _path: string,
      _schemaId: string,
      operation: TableMutationOperation,
    ) => {
      setTable({
        ...table(),
        rows: [...table().rows, { [PathPropertyName]: "Concurrent.md", relation: '[]' }],
      });
      if (operation.kind === "transform") setTable(operation.apply(table()));
      return true;
    });

    await renamePathLifecycleInContexts(manager, "Old.md", "New.md", [space], [space]);

    expect(table().rows.map(row => row[PathPropertyName])).toEqual([
      "New.md", "Ref.md", "Concurrent.md",
    ]);
  });

  it("rebases rollback over an unrelated concurrent append", async () => {
    const { manager, table, setTable } = harness();
    manager.mutateTable.mockImplementationOnce(async (_path: string, _schemaId: string, operation: TableMutationOperation) => {
      const next = operation.kind === "transform" ? operation.apply(table()) : table();
      setTable({
        ...next,
        rows: [...next.rows, { [PathPropertyName]: "Concurrent.md", relation: '[]' }],
      });
      throw new Error("table failed after concurrent append");
    });

    await expect(renamePathLifecycleInContexts(
      manager, "Old.md", "New.md", [space], [space],
    )).rejects.toThrow("table failed after concurrent append");

    expect(table().rows.map(row => row[PathPropertyName])).toEqual([
      "Old.md", "Ref.md", "Concurrent.md",
    ]);
  });

  it("restores a deleted row by identity without corrupting the edited survivor shifted into its position", async () => {
    const { manager, table, setTable } = harness();
    manager.mutateTable.mockImplementationOnce(async (_path: string, _schemaId: string, operation: TableMutationOperation) => {
      const next = operation.kind === "transform" ? operation.apply(table()) : table();
      const survivor = next.rows.find(row => row[PathPropertyName] === "Ref.md");
      setTable({
        ...next,
        rows: next.rows.map(row => row === survivor
          ? { ...row, relation: '["Concurrent.md"]' }
          : row),
      });
      throw new Error("table failed after survivor edit");
    });

    await expect(removePathLifecycleInContexts(
      manager, "Old.md", [space], [space],
    )).rejects.toThrow("table failed after survivor edit");

    expect(table().rows).toEqual([
      { [PathPropertyName]: "Old.md", relation: '["Keep.md"]' },
      { [PathPropertyName]: "Ref.md", relation: '["Concurrent.md"]' },
    ]);
  });

  it("derives canonical link removal from live YAML rather than the table projection", async () => {
    const { manager, frontmatter } = harness();
    frontmatter.set("Ref.md", { relation: ["[[Old.md]]", "[[External.md]]"] });

    await removePathLifecycleInContexts(manager, "Old.md", [space], [space]);

    expect(frontmatter.get("Ref.md")?.relation).toEqual(["[[External.md]]"]);
  });

  it("rewrites a live canonical link even when the stale table projection omits the target", async () => {
    const { manager, frontmatter, table, setTable } = harness();
    setTable({
      ...table(),
      rows: table().rows.map(row => row[PathPropertyName] === "Ref.md"
        ? { ...row, relation: '["Keep.md"]' }
        : row),
    });

    await renamePathLifecycleInContexts(manager, "Old.md", "New.md", [space], [space]);

    expect(frontmatter.get("Ref.md")?.relation).toEqual(["[[New.md]]", "[[Keep.md]]"]);
  });

  it("rewrites a canonical link when the authoritative live member row is wholly omitted", async () => {
    const { manager, frontmatter, table, setTable } = harness();
    setTable({ ...table(), rows: table().rows.filter(row => row[PathPropertyName] !== "Ref.md") });

    await renamePathLifecycleInContexts(manager, "Old.md", "New.md", [space], [space]);

    expect(frontmatter.get("Ref.md")?.relation).toEqual(["[[New.md]]", "[[Keep.md]]"]);
  });

  it("removes a canonical link when the authoritative live member row is wholly omitted", async () => {
    const { manager, frontmatter, table, setTable } = harness();
    setTable({ ...table(), rows: table().rows.filter(row => row[PathPropertyName] !== "Ref.md") });

    await removePathLifecycleInContexts(manager, "Old.md", [space], [space]);

    expect(frontmatter.get("Ref.md")?.relation).toEqual(["[[Keep.md]]"]);
  });

  it("does not invent an empty canonical property when the live property is absent", async () => {
    const { manager, frontmatter } = harness();
    frontmatter.set("Ref.md", {});

    await renamePathLifecycleInContexts(manager, "Old.md", "New.md", [space], [space]);

    expect(Object.prototype.hasOwnProperty.call(frontmatter.get("Ref.md"), "relation")).toBe(false);
  });

  it("rebases the canonical rewrite over a same-property edit made before the atomic mutation", async () => {
    const { manager, frontmatter } = harness();
    manager.mutateProperties.mockImplementation(async (
      path: string,
      mutation: (properties: Record<string, unknown>) => Record<string, unknown>,
    ) => {
      if (path === "Ref.md") {
        frontmatter.set(path, { relation: ["[[Old.md]]", "[[Concurrent.md|Keep alias]]"] });
      }
      frontmatter.set(path, mutation(structuredClone(frontmatter.get(path) ?? {})));
      return true;
    });

    await renamePathLifecycleInContexts(manager, "Old.md", "New.md", [space], [space]);

    expect(frontmatter.get("Ref.md")?.relation).toEqual([
      "[[New.md]]", "[[Concurrent.md|Keep alias]]",
    ]);
  });

  it("does not write the forward canonical result into a same-path recreation during mutation", async () => {
    const { manager, frontmatter } = harness();
    manager.mutateProperties.mockImplementation(async (
      path: string,
      mutation: (properties: Record<string, unknown>) => Record<string, unknown>,
    ) => {
      mutation(structuredClone(frontmatter.get(path) ?? {}));
      if (path === "Ref.md") frontmatter.set(path, { relation: ["[[Recreated.md]]"] });
      return true;
    });

    await renamePathLifecycleInContexts(manager, "Old.md", "New.md", [space], [space]);

    expect(frontmatter.get("Ref.md")?.relation).toEqual(["[[Recreated.md]]"]);
  });

  it("does not overwrite an external canonical edit during compensation", async () => {
    const { manager, frontmatter, table, setTable } = harness();
    manager.mutateTable.mockImplementationOnce(async (_path: string, _schemaId: string, operation: TableMutationOperation) => {
      const next = operation.kind === "transform" ? operation.apply(table()) : table();
      setTable(next);
      frontmatter.set("Ref.md", { relation: ["[[External.md]]"] });
      throw new Error("table failed after external edit");
    });

    await expect(renamePathLifecycleInContexts(
      manager, "Old.md", "New.md", [space], [space],
    )).rejects.toThrow("table failed after external edit");

    expect(frontmatter.get("Ref.md")?.relation).toEqual(["[[External.md]]"]);
  });
});
