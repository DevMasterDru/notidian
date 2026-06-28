// ---------------------------------------------------------------------------
// Notidian-fi26 — DEPTH net for the canonical context-MDB write path in
// src/core/utils/contexts/context.ts.
//
// A symbol scan vs every test file showed the exported ASYNC mutators in
// context.ts had ZERO direct coverage of their orchestration — only their pure
// sub-helpers (pathUpdates.ts / links.ts) and insert/deletePropertyMultiValue,
// plus updateTableValue/updateContextValue's rank guard
// (context.reorderRankZero.test.ts), were pinned. These mutators are the exact
// authority-critical bug-class of closed Notidian-5tl / -sck / -oec / -lg1: they
// transform an MDB and persist it through `saveContext` ->
// `manager.saveTable(...).then(reloadContextByPath(...))`.
//
// THE CROSS-CUTTING INVARIANT THIS NET LOCKS — the SAVE-SKIP guard every mutator
// shares:  `if (!_.isEqual(oldTable, newTable)) saveContext(...)`.
//   * A NO-OP edit (value unchanged, path absent for a remove, already-present
//     for add-if-unique, tag not matching any context column) MUST NOT call
//     saveTable / reloadContextByPath — silent over-writes are how LWW/authority
//     regressions creep in.
//   * A REAL change MUST call saveContext EXACTLY ONCE, with the
//     correctly-transformed table at the SpaceManager boundary.
//
// Plus targeted CHARACTERIZATION of each transform's load-bearing edge:
//   - addPathInContexts        -> insertRowsIfUnique dedup (no duplicate row)
//   - removeTagInContexts      -> retype matching context cols to 'link-multi' ONLY
//   - renameTagInContexts      -> swap col.value on matching context cols ONLY
//   - renameLinkInContexts     -> replaceLinkInValue across link/context cols
//   - removeLinkInContexts     -> removeLinkInValue across link/context cols
//   - updateTableRow / addRowInTable / deleteRowInTable (index-positional)
//   - updateValueInContext (path-keyed value write)
//   - renamePathInContexts / removePathInContexts / removePathsInContext /
//     reorderPathsInContext (pathUpdates wiring + force/reload flags)
//   - updateContextWithProperties (objectExists append-vs-merge + multi-space)
//   - MULTI-SPACE FAN-OUT: each space is processed independently; an unchanged
//     space stays untouched while a changed sibling saves.
//
// Pure orchestration. Offline node env: a fake SpaceManager built from jest.fn
// (contextForSpace / readTable / saveTable / reloadContextByPath / saveProperties)
// + a superstate stub — exactly the seam pageTitleRename.test.ts /
// context.reorderRankZero.test.ts drive. No vault, Obsidian, or React mount.
// ---------------------------------------------------------------------------
import { PathPropertyName } from "shared/types/context";
import { DBRow, SpaceProperty, SpaceTable } from "shared/types/mdb";
import { SpaceInfo } from "shared/types/spaceInfo";
import {
  addPathInContexts,
  addRowInTable,
  deleteRowInTable,
  deleteRowsInTable,
  removeLinkInContexts,
  removePathInContexts,
  removePathsInContext,
  removeTagInContexts,
  renameLinkInContexts,
  renamePathInContexts,
  renameTagInContexts,
  reorderPathsInContext,
  updateContextWithProperties,
  updateTableRow,
  updateValueInContext,
} from "./context";

// --- fixtures ---------------------------------------------------------------

const SCHEMA = { id: "files", name: "Files", type: "db" };

const spaceInfo = (path: string): SpaceInfo => ({
  name: path,
  path,
  isRemote: false,
  readOnly: false,
  defPath: `${path}/.notidian/def.json`,
  notePath: `${path}/${path}.md`,
});

const SPACE = spaceInfo("Items");

const paths = (table: SpaceTable): string[] =>
  table.rows.map((r) => r[PathPropertyName]);

/**
 * Fake SpaceManager. `contextForSpace`/`readTable` serve the table registered
 * for each space path; `saveTable`/`reloadContextByPath`/`saveProperties` are
 * spies. A single manager can back several spaces (multi-space fan-out tests)
 * by mapping path -> table. `resolvePath`/`readProperties`/`uriByString` exist
 * for updateContextWithProperties.
 */
const makeManager = (
  tablesByPath: Record<string, SpaceTable>,
  opts: { enhancedLogs?: boolean; properties?: Record<string, any> } = {}
) => {
  const tables = { ...tablesByPath };
  const saveTable = jest.fn(
    async (
      _path: string,
      _newTable: SpaceTable,
      _forceCreate?: boolean
    ): Promise<boolean> => true
  );
  const reloadContextByPath = jest.fn(
    async (
      _path: string,
      _opts?: { force?: boolean; calculate?: boolean }
    ): Promise<void> => undefined
  );
  const saveProperties = jest.fn(
    async (_path: string, _props: Record<string, any>): Promise<void> =>
      undefined
  );
  const readTable = jest.fn(
    async (path: string, _table: string): Promise<SpaceTable> => tables[path]
  );
  const contextForSpace = jest.fn(
    async (path: string): Promise<SpaceTable> => tables[path]
  );
  const readProperties = jest.fn(
    async (_path: string): Promise<Record<string, any>> => opts.properties ?? {}
  );
  const manager = {
    readTable,
    contextForSpace,
    saveTable,
    saveProperties,
    readProperties,
    // identity resolver: paths are already canonical in these fixtures.
    resolvePath: (p: string, _from?: string) => p,
    uriByString: (p: string) => ({ basePath: p }),
    superstate: {
      reloadContextByPath,
      settings: { enhancedLogs: opts.enhancedLogs ?? false },
    },
  } as any;
  // self-reference so superstate.spaceManager === manager (updateContextWith*).
  manager.superstate.spaceManager = manager;
  return {
    manager,
    saveTable,
    reloadContextByPath,
    saveProperties,
    readTable,
    contextForSpace,
    readProperties,
  };
};

// ===========================================================================
// updateTableRow — updateRowAtIndex(mdb, row, index), index-positional
// ===========================================================================

describe("updateTableRow", () => {
  const tbl = (): SpaceTable => ({
    schema: SCHEMA,
    cols: [{ name: PathPropertyName, type: "file" }],
    rows: [{ [PathPropertyName]: "A.md" }, { [PathPropertyName]: "B.md" }],
  });

  it("writes the replaced row at the given index exactly once", async () => {
    const { manager, saveTable } = makeManager({ Items: tbl() });
    const next: DBRow = { [PathPropertyName]: "B-renamed.md" };

    await updateTableRow(manager, SPACE, "files", 1, next);

    expect(saveTable).toHaveBeenCalledTimes(1);
    const saved = saveTable.mock.calls[0][1] as SpaceTable;
    expect(saved.rows).toEqual([{ [PathPropertyName]: "A.md" }, next]);
    expect(saveTable.mock.calls[0][0]).toBe(SPACE.path);
  });

  it("SAVE-SKIP: replacing a row with a deep-equal copy is a no-op", async () => {
    const { manager, saveTable } = makeManager({ Items: tbl() });
    // Structurally identical row at index 0 -> _.isEqual short-circuits.
    await updateTableRow(manager, SPACE, "files", 0, {
      [PathPropertyName]: "A.md",
    });
    expect(saveTable).not.toHaveBeenCalled();
  });

  it("does nothing when the table cannot be read (processTable guard)", async () => {
    const { manager, saveTable } = makeManager({}); // readTable -> undefined
    await updateTableRow(manager, SPACE, "files", 0, {
      [PathPropertyName]: "Z.md",
    });
    expect(saveTable).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// addRowInTable / deleteRowInTable — index-positional insert/filter
// ===========================================================================

describe("addRowInTable", () => {
  const tbl = (): SpaceTable => ({
    schema: SCHEMA,
    cols: [{ name: PathPropertyName, type: "file" }],
    rows: [{ [PathPropertyName]: "A.md" }, { [PathPropertyName]: "B.md" }],
  });

  it("appends the row when no index is given", async () => {
    const { manager, saveTable } = makeManager({ Items: tbl() });
    await addRowInTable(manager, { [PathPropertyName]: "C.md" }, SPACE, "files");
    expect(saveTable).toHaveBeenCalledTimes(1);
    expect(paths(saveTable.mock.calls[0][1] as SpaceTable)).toEqual([
      "A.md",
      "B.md",
      "C.md",
    ]);
  });

  it("inserts at the requested index (positional)", async () => {
    const { manager, saveTable } = makeManager({ Items: tbl() });
    await addRowInTable(
      manager,
      { [PathPropertyName]: "C.md" },
      SPACE,
      "files",
      1
    );
    expect(paths(saveTable.mock.calls[0][1] as SpaceTable)).toEqual([
      "A.md",
      "C.md",
      "B.md",
    ]);
  });

  it("ADVERSARIAL: addRowInTable does NOT dedup — duplicate paths are inserted", async () => {
    // Unlike addPathInContexts (insertRowsIfUnique), addRowInTable uses the
    // plain insertRows: a row whose path already exists is still appended.
    const { manager, saveTable } = makeManager({ Items: tbl() });
    await addRowInTable(manager, { [PathPropertyName]: "A.md" }, SPACE, "files");
    expect(saveTable).toHaveBeenCalledTimes(1);
    expect(paths(saveTable.mock.calls[0][1] as SpaceTable)).toEqual([
      "A.md",
      "B.md",
      "A.md",
    ]);
  });
});

describe("deleteRowInTable", () => {
  const tbl = (): SpaceTable => ({
    schema: SCHEMA,
    cols: [{ name: PathPropertyName, type: "file" }],
    rows: [
      { [PathPropertyName]: "A.md" },
      { [PathPropertyName]: "B.md" },
      { [PathPropertyName]: "C.md" },
    ],
  });

  it("removes only the row at the given index", async () => {
    const { manager, saveTable } = makeManager({ Items: tbl() });
    await deleteRowInTable(manager, SPACE, "files", 1);
    expect(saveTable).toHaveBeenCalledTimes(1);
    expect(paths(saveTable.mock.calls[0][1] as SpaceTable)).toEqual([
      "A.md",
      "C.md",
    ]);
  });

  it("SAVE-SKIP: an out-of-range index removes nothing and does not save", async () => {
    const { manager, saveTable } = makeManager({ Items: tbl() });
    await deleteRowInTable(manager, SPACE, "files", 99);
    expect(saveTable).not.toHaveBeenCalled();
  });
});

describe("deleteRowsInTable", () => {
  const tbl = (): SpaceTable => ({
    schema: SCHEMA,
    cols: [{ name: PathPropertyName, type: "file" }],
    rows: [
      { [PathPropertyName]: "A.md" },
      { [PathPropertyName]: "B.md" },
      { [PathPropertyName]: "C.md" },
      { [PathPropertyName]: "D.md" },
    ],
  });

  it("removes scattered row indices in one save without index-shift drift", async () => {
    const { manager, saveTable } = makeManager({ Items: tbl() });
    await deleteRowsInTable(manager, SPACE, "files", [0, 2]);
    expect(saveTable).toHaveBeenCalledTimes(1);
    expect(paths(saveTable.mock.calls[0][1] as SpaceTable)).toEqual([
      "B.md",
      "D.md",
    ]);
  });

  it("deduplicates and ignores invalid indices", async () => {
    const { manager, saveTable } = makeManager({ Items: tbl() });
    await deleteRowsInTable(manager, SPACE, "files", [-1, 1, 1, 99, 3]);
    expect(saveTable).toHaveBeenCalledTimes(1);
    expect(paths(saveTable.mock.calls[0][1] as SpaceTable)).toEqual([
      "A.md",
      "C.md",
    ]);
  });

  it("SAVE-SKIP: no present indices removes nothing and does not save", async () => {
    const { manager, saveTable } = makeManager({ Items: tbl() });
    await deleteRowsInTable(manager, SPACE, "files", [-1, 99]);
    expect(saveTable).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// updateValueInContext — path-keyed single-field write
// ===========================================================================

describe("updateValueInContext", () => {
  const tbl = (): SpaceTable => ({
    schema: SCHEMA,
    cols: [
      { name: PathPropertyName, type: "file" },
      { name: "status", type: "text" },
    ],
    rows: [
      { [PathPropertyName]: "A.md", status: "open" },
      { [PathPropertyName]: "B.md", status: "open" },
    ],
  });

  it("writes the field for the matching path row only", async () => {
    const { manager, saveTable } = makeManager({ Items: tbl() });
    await updateValueInContext(manager, "A.md", "status", "done", SPACE);
    expect(saveTable).toHaveBeenCalledTimes(1);
    const saved = saveTable.mock.calls[0][1] as SpaceTable;
    expect(saved.rows).toEqual([
      { [PathPropertyName]: "A.md", status: "done" },
      { [PathPropertyName]: "B.md", status: "open" },
    ]);
  });

  it("SAVE-SKIP: writing the same value is a no-op", async () => {
    const { manager, saveTable } = makeManager({ Items: tbl() });
    await updateValueInContext(manager, "A.md", "status", "open", SPACE);
    expect(saveTable).not.toHaveBeenCalled();
  });

  it("SAVE-SKIP: a path that is not present matches no row and never saves", async () => {
    const { manager, saveTable } = makeManager({ Items: tbl() });
    await updateValueInContext(manager, "ABSENT.md", "status", "done", SPACE);
    expect(saveTable).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// addPathInContexts — insertRowsIfUnique dedup + multi-space fan-out
// ===========================================================================

describe("addPathInContexts", () => {
  const tbl = (): SpaceTable => ({
    schema: SCHEMA,
    cols: [{ name: PathPropertyName, type: "file" }],
    rows: [{ [PathPropertyName]: "A.md" }, { [PathPropertyName]: "B.md" }],
  });

  it("prepends a new path (no index) and saves once", async () => {
    const { manager, saveTable } = makeManager({ Items: tbl() });
    await addPathInContexts(manager, "C.md", [SPACE]);
    expect(saveTable).toHaveBeenCalledTimes(1);
    // insertRowsIfUnique with no index puts new rows FIRST.
    expect(paths(saveTable.mock.calls[0][1] as SpaceTable)).toEqual([
      "C.md",
      "A.md",
      "B.md",
    ]);
  });

  it("CHARACTERIZATION: dedup — adding an already-present path is a no-op (no duplicate row)", async () => {
    const { manager, saveTable } = makeManager({ Items: tbl() });
    await addPathInContexts(manager, "A.md", [SPACE]);
    // insertRowsIfUnique filters A.md out -> table is structurally unchanged ->
    // SAVE-SKIP fires. No duplicate row, no save.
    expect(saveTable).not.toHaveBeenCalled();
  });

  it("MULTI-SPACE FAN-OUT: changed space saves, sibling that already has the path is skipped", async () => {
    const other = spaceInfo("Other");
    const otherTable: SpaceTable = {
      schema: SCHEMA,
      cols: [{ name: PathPropertyName, type: "file" }],
      rows: [{ [PathPropertyName]: "C.md" }], // already has C.md -> no-op
    };
    const { manager, saveTable } = makeManager({
      Items: tbl(),
      Other: otherTable,
    });

    await addPathInContexts(manager, "C.md", [SPACE, other]);

    // Exactly one save: Items (gained C.md). Other already had C.md -> skipped.
    expect(saveTable).toHaveBeenCalledTimes(1);
    const [savedPath, savedTable] = saveTable.mock.calls[0];
    expect(savedPath).toBe("Items");
    expect(paths(savedTable as SpaceTable)).toContain("C.md");
  });
});

// ===========================================================================
// renameTagInContexts / removeTagInContexts — context-column retype/value swap
// ===========================================================================

describe("renameTagInContexts", () => {
  const tbl = (): SpaceTable => ({
    schema: SCHEMA,
    cols: [
      { name: PathPropertyName, type: "file" },
      { name: "rel", type: "context", value: "#project" },
      { name: "rel2", type: "context-multi", value: "#other" },
      { name: "plain", type: "text", value: "#project" }, // NOT a context col
    ],
    rows: [{ [PathPropertyName]: "A.md" }],
  });

  it("CHARACTERIZATION: swaps col.value on matching context cols ONLY", async () => {
    const { manager, saveTable } = makeManager({ Items: tbl() });
    await renameTagInContexts(manager, "#project", "#renamed", [SPACE]);

    expect(saveTable).toHaveBeenCalledTimes(1);
    const cols = (saveTable.mock.calls[0][1] as SpaceTable).cols;
    expect(cols.find((c) => c.name === "rel")?.value).toBe("#renamed");
    // non-matching context col (#other) untouched
    expect(cols.find((c) => c.name === "rel2")?.value).toBe("#other");
    // a non-context col with the SAME value string is NOT rewritten
    expect(cols.find((c) => c.name === "plain")?.value).toBe("#project");
  });

  it("SAVE-SKIP: renaming a tag no context column references is a no-op", async () => {
    const { manager, saveTable } = makeManager({ Items: tbl() });
    await renameTagInContexts(manager, "#absent", "#renamed", [SPACE]);
    expect(saveTable).not.toHaveBeenCalled();
  });
});

describe("removeTagInContexts", () => {
  const tbl = (): SpaceTable => ({
    schema: SCHEMA,
    cols: [
      { name: PathPropertyName, type: "file" },
      { name: "rel", type: "context", value: "#project" },
      { name: "rel2", type: "context-multi", value: "#other" },
      { name: "lnk", type: "link", value: "#project" }, // link, not context
    ],
    rows: [{ [PathPropertyName]: "A.md" }],
  });

  it("CHARACTERIZATION: retypes matching context cols to 'link-multi' ONLY", async () => {
    const { manager, saveTable } = makeManager({ Items: tbl() });
    await removeTagInContexts(manager, "#project", [SPACE]);

    expect(saveTable).toHaveBeenCalledTimes(1);
    const cols = (saveTable.mock.calls[0][1] as SpaceTable).cols;
    // matching context col is retyped to link-multi; value preserved.
    const rel = cols.find((c) => c.name === "rel");
    expect(rel?.type).toBe("link-multi");
    expect(rel?.value).toBe("#project");
    // non-matching context col stays a context col
    expect(cols.find((c) => c.name === "rel2")?.type).toBe("context-multi");
    // a `link` col with the same value is NOT a context col -> untouched
    expect(cols.find((c) => c.name === "lnk")?.type).toBe("link");
  });

  it("SAVE-SKIP: removing a tag no context column references is a no-op", async () => {
    const { manager, saveTable } = makeManager({ Items: tbl() });
    await removeTagInContexts(manager, "#nope", [SPACE]);
    expect(saveTable).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// renameLinkInContexts / removeLinkInContexts — link/context value rewrite
// ===========================================================================

describe("renameLinkInContexts", () => {
  const tbl = (): SpaceTable => ({
    schema: SCHEMA,
    cols: [
      { name: PathPropertyName, type: "file" },
      // Notidian-owned link col (source:notidian) -> persisted via context, no
      // frontmatter write; keeps the seam pure for this orchestration test.
      { name: "refs", type: "link-multi", source: "notidian" },
    ],
    rows: [
      { [PathPropertyName]: "A.md", refs: JSON.stringify(["[[Old.md]]"]) },
      { [PathPropertyName]: "B.md", refs: JSON.stringify(["[[Keep.md]]"]) },
    ],
  });

  it("CHARACTERIZATION: rewrites the link value in rows that reference it", async () => {
    const { manager, saveTable, saveProperties } = makeManager({
      Items: tbl(),
    });
    await renameLinkInContexts(manager, "Old.md", "New.md", [SPACE]);

    expect(saveTable).toHaveBeenCalledTimes(1);
    const saved = saveTable.mock.calls[0][1] as SpaceTable;
    expect(saved.rows[0].refs).toBe(JSON.stringify(["New.md"]));
    // the non-referencing row is untouched
    expect(saved.rows[1].refs).toBe(JSON.stringify(["[[Keep.md]]"]));
    // Notidian-owned col -> NO frontmatter write
    expect(saveProperties).not.toHaveBeenCalled();
  });

  it("SAVE-SKIP: renaming a link no row references is a no-op", async () => {
    const { manager, saveTable } = makeManager({ Items: tbl() });
    await renameLinkInContexts(manager, "Absent.md", "New.md", [SPACE]);
    expect(saveTable).not.toHaveBeenCalled();
  });
});

describe("removeLinkInContexts", () => {
  const tbl = (): SpaceTable => ({
    schema: SCHEMA,
    cols: [
      { name: PathPropertyName, type: "file" },
      { name: "refs", type: "link-multi", source: "notidian" },
    ],
    rows: [
      {
        [PathPropertyName]: "A.md",
        refs: JSON.stringify(["[[Gone.md]]", "[[Stay.md]]"]),
      },
      { [PathPropertyName]: "B.md", refs: JSON.stringify(["[[Stay.md]]"]) },
    ],
  });

  it("CHARACTERIZATION: strips the link from referencing rows, keeps the rest", async () => {
    const { manager, saveTable } = makeManager({ Items: tbl() });
    await removeLinkInContexts(manager, "Gone.md", [SPACE]);

    expect(saveTable).toHaveBeenCalledTimes(1);
    const saved = saveTable.mock.calls[0][1] as SpaceTable;
    // removeLinkInValue FILTERS by parsed identity but keeps each SURVIVING
    // entry in its ORIGINAL form — unlike replaceLinkInValue, it does not
    // re-serialize the kept entries to bare identity. So "[[Gone.md]]" drops
    // and "[[Stay.md]]" stays verbatim. (Pinned characterization, not a wish.)
    expect(saved.rows[0].refs).toBe(JSON.stringify(["[[Stay.md]]"]));
    expect(saved.rows[1].refs).toBe(JSON.stringify(["[[Stay.md]]"]));
  });

  it("SAVE-SKIP: removing a link no row references is a no-op", async () => {
    const { manager, saveTable } = makeManager({ Items: tbl() });
    await removeLinkInContexts(manager, "Absent.md", [SPACE]);
    expect(saveTable).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// renamePathInContexts / removePathInContexts / removePathsInContext —
// pathUpdates wiring (rename row, drop row(s))
// ===========================================================================

describe("renamePathInContexts", () => {
  const tbl = (): SpaceTable => ({
    schema: SCHEMA,
    cols: [{ name: PathPropertyName, type: "file" }],
    rows: [{ [PathPropertyName]: "Old.md" }, { [PathPropertyName]: "Keep.md" }],
  });

  it("renames the matching row's path in place", async () => {
    const { manager, saveTable } = makeManager({ Items: tbl() });
    await renamePathInContexts(manager, "Old.md", "New.md", [SPACE]);
    expect(saveTable).toHaveBeenCalledTimes(1);
    expect(paths(saveTable.mock.calls[0][1] as SpaceTable)).toEqual([
      "New.md",
      "Keep.md",
    ]);
  });

  it("SAVE-SKIP: renaming a path absent from the context is a no-op", async () => {
    const { manager, saveTable } = makeManager({ Items: tbl() });
    await renamePathInContexts(manager, "Absent.md", "New.md", [SPACE]);
    expect(saveTable).not.toHaveBeenCalled();
  });
});

describe("removePathInContexts / removePathsInContext", () => {
  const tbl = (): SpaceTable => ({
    schema: SCHEMA,
    cols: [{ name: PathPropertyName, type: "file" }],
    rows: [
      { [PathPropertyName]: "A.md" },
      { [PathPropertyName]: "B.md" },
      { [PathPropertyName]: "C.md" },
    ],
  });

  it("removePathInContexts drops only the named row", async () => {
    const { manager, saveTable } = makeManager({ Items: tbl() });
    await removePathInContexts(manager, "B.md", [SPACE]);
    expect(saveTable).toHaveBeenCalledTimes(1);
    expect(paths(saveTable.mock.calls[0][1] as SpaceTable)).toEqual([
      "A.md",
      "C.md",
    ]);
  });

  it("SAVE-SKIP: removePathInContexts on an absent path is a no-op", async () => {
    const { manager, saveTable } = makeManager({ Items: tbl() });
    await removePathInContexts(manager, "Absent.md", [SPACE]);
    expect(saveTable).not.toHaveBeenCalled();
  });

  it("removePathsInContext drops every named row in one save", async () => {
    const { manager, saveTable } = makeManager({ Items: tbl() });
    await removePathsInContext(manager, ["A.md", "C.md"], SPACE);
    expect(saveTable).toHaveBeenCalledTimes(1);
    expect(paths(saveTable.mock.calls[0][1] as SpaceTable)).toEqual(["B.md"]);
  });

  it("SAVE-SKIP: removePathsInContext with no present paths is a no-op", async () => {
    const { manager, saveTable } = makeManager({ Items: tbl() });
    await removePathsInContext(manager, ["X.md", "Y.md"], SPACE);
    expect(saveTable).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// reorderPathsInContext — reorderRowsForPath + force/reload flags
// ===========================================================================

describe("reorderPathsInContext", () => {
  const tbl = (): SpaceTable => ({
    schema: SCHEMA,
    cols: [{ name: PathPropertyName, type: "file" }],
    rows: [
      { [PathPropertyName]: "A.md" },
      { [PathPropertyName]: "B.md" },
      { [PathPropertyName]: "C.md" },
    ],
  });

  it("moves the named paths to the target index and forces a save+reload", async () => {
    const { manager, saveTable, reloadContextByPath } = makeManager({
      Items: tbl(),
    });
    // Move C to the top (index 0).
    await reorderPathsInContext(manager, ["C.md"], 0, SPACE);

    expect(saveTable).toHaveBeenCalledTimes(1);
    // forceCreate=true is passed (reorderPathsInContext saves with force).
    expect(saveTable.mock.calls[0][2]).toBe(true);
    expect(paths(saveTable.mock.calls[0][1] as SpaceTable)).toEqual([
      "C.md",
      "A.md",
      "B.md",
    ]);
    expect(reloadContextByPath).toHaveBeenCalledTimes(1);
  });

  it("index 0 is honored (not a falsy-guard drop) and reorders to the top", async () => {
    const { manager, saveTable } = makeManager({ Items: tbl() });
    await reorderPathsInContext(manager, ["B.md"], 0, SPACE);
    expect(paths(saveTable.mock.calls[0][1] as SpaceTable)).toEqual([
      "B.md",
      "A.md",
      "C.md",
    ]);
  });

  it("SAVE-SKIP: reordering to the same effective position is a no-op", async () => {
    const { manager, saveTable } = makeManager({ Items: tbl() });
    // A.md is already first; reinserting it at index 0 yields the same order.
    await reorderPathsInContext(manager, ["A.md"], 0, SPACE);
    expect(saveTable).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// updateContextWithProperties — objectExists append-vs-merge + fan-out.
//
// Driven with spaces:// paths so materializeFrontmatterBackedContextTable runs
// with enabled=false (a passthrough), isolating the orchestration: the
// objectExists branch (merge into existing row vs. append a new row) and the
// SAVE-SKIP guard, across multiple spaces independently.
// ===========================================================================

describe("updateContextWithProperties", () => {
  const remoteSpace = (path: string): SpaceInfo => spaceInfo(path);

  const baseTable = (rows: DBRow[]): SpaceTable => ({
    schema: SCHEMA,
    cols: [
      { name: PathPropertyName, type: "file" },
      { name: "status", type: "text" },
    ],
    rows,
  });

  it("merges frontmatter properties into an EXISTING row (objectExists)", async () => {
    const path = "spaces://Items/A.md";
    const space = remoteSpace("spaces://Items");
    const { manager, saveTable } = makeManager(
      {
        "spaces://Items": baseTable([
          { [PathPropertyName]: path, status: "old" },
          { [PathPropertyName]: "spaces://Items/B.md", status: "x" },
        ]),
      },
      { properties: { status: "fresh" } }
    );
    const superstate = buildSuperstate(manager, [path, "spaces://Items/B.md"]);

    await updateContextWithProperties(superstate, path, [space]);

    expect(saveTable).toHaveBeenCalledTimes(1);
    const saved = saveTable.mock.calls[0][1] as SpaceTable;
    // existing row gets the new property; no new row appended.
    expect(saved.rows).toHaveLength(2);
    expect(
      saved.rows.find((r) => r[PathPropertyName] === path)?.status
    ).toBe("fresh");
    // forceCreate=true on the property-sync save.
    expect(saveTable.mock.calls[0][2]).toBe(true);
  });

  it("APPENDS a new row when the path is not yet in the context", async () => {
    const path = "spaces://Items/New.md";
    const space = remoteSpace("spaces://Items");
    const { manager, saveTable } = makeManager(
      {
        "spaces://Items": baseTable([
          { [PathPropertyName]: "spaces://Items/A.md", status: "x" },
        ]),
      },
      { properties: { status: "born" } }
    );
    const superstate = buildSuperstate(manager, ["spaces://Items/A.md"]);

    await updateContextWithProperties(superstate, path, [space]);

    expect(saveTable).toHaveBeenCalledTimes(1);
    const saved = saveTable.mock.calls[0][1] as SpaceTable;
    expect(saved.rows).toHaveLength(2);
    const added = saved.rows.find((r) => r[PathPropertyName] === path);
    expect(added).toBeDefined();
    expect(added?.status).toBe("born");
  });

  it("SAVE-SKIP: existing row already holding the same properties is a no-op", async () => {
    const path = "spaces://Items/A.md";
    const space = remoteSpace("spaces://Items");
    const { manager, saveTable } = makeManager(
      {
        "spaces://Items": baseTable([
          { [PathPropertyName]: path, status: "same" },
        ]),
      },
      { properties: { status: "same" } }
    );
    const superstate = buildSuperstate(manager, [path]);

    await updateContextWithProperties(superstate, path, [space]);

    expect(saveTable).not.toHaveBeenCalled();
  });

  it("MULTI-SPACE FAN-OUT: each space is processed independently", async () => {
    const path = "spaces://Shared/A.md";
    const s1 = remoteSpace("spaces://One");
    const s2 = remoteSpace("spaces://Two");
    const { manager, saveTable } = makeManager(
      {
        // One already has the row with the right value -> no-op.
        "spaces://One": baseTable([{ [PathPropertyName]: path, status: "v" }]),
        // Two is missing the row -> append -> save.
        "spaces://Two": baseTable([
          { [PathPropertyName]: "spaces://Two/Other.md", status: "z" },
        ]),
      },
      { properties: { status: "v" } }
    );
    const superstate = buildSuperstate(manager, [
      path,
      "spaces://Two/Other.md",
    ]);

    await updateContextWithProperties(superstate, path, [s1, s2]);

    // Only Two saved; One was unchanged.
    expect(saveTable).toHaveBeenCalledTimes(1);
    expect(saveTable.mock.calls[0][0]).toBe("spaces://Two");
  });
});

// updateContextWithProperties reads several superstate surfaces beyond the
// SpaceManager. This builds the minimal stub: pathsIndex (empty metadata is
// fine — materialize runs disabled for spaces:// paths), settings, contextsIndex.
function buildSuperstate(manager: any, knownPaths: string[]) {
  const pathsIndex = new Map(
    knownPaths.map((p) => [p, { metadata: {} as any }])
  );
  return {
    spaceManager: manager,
    pathsIndex,
    // empty -> getPathProperties reads frontmatter directly off the path
    // (no metadata remap), keeping these orchestration tests deterministic.
    spacesIndex: new Map(),
    contextsIndex: new Map(),
    settings: {
      enhancedLogs: false,
      autoImportObsidianPropertiesToContexts: false,
    },
  } as any;
}

// ===========================================================================
// enhancedLogs branch — exercise the logging arm of one mutator so the
// settings-gated branch is covered (it is a side-effect-free guard today).
// ===========================================================================

describe("enhancedLogs branch is harmless", () => {
  it("still saves exactly once with enhancedLogs on", async () => {
    const tbl: SpaceTable = {
      schema: SCHEMA,
      cols: [{ name: PathPropertyName, type: "file" }],
      rows: [{ [PathPropertyName]: "A.md" }],
    };
    const { manager, saveTable } = makeManager(
      { Items: tbl },
      { enhancedLogs: true }
    );
    await addPathInContexts(manager, "B.md", [SPACE]);
    expect(saveTable).toHaveBeenCalledTimes(1);
  });
});
