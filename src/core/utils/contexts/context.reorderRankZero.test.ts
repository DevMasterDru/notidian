// ---------------------------------------------------------------------------
// Notidian-gfzw — index-0 reorder must NOT be silently dropped by a truthiness
// guard. context.ts had `if (rank)` around the reorder step in BOTH:
//
//   updateTableValue(...)   -> arrayMove(rows, index, rank)
//   updateContextValue(...) -> reorderRowsForPath(mdb, [path], rank)
//
// rank === 0 (drop a grouped row to the TOP of a group, or reorder to position 0)
// is FALSY, so the reorder was skipped: the group-field/property value updated but
// the requested top position was dropped. The sibling reorderRowsForPath /
// reorderPathsInContext already accept index 0 (no truthiness guard), so the old
// behavior was internally inconsistent (same bug-class as Notidian-oec / -sck).
//
// FIX: gate on `typeof rank === "number"` so 0 reorders and `undefined` is a no-op.
//
// These tests pin the persisted effect at the SpaceManager boundary — the seam
// saveContext writes through (`manager.saveTable(space.path, newTable, ...)` then
// `manager.superstate.reloadContextByPath(...)`). Offline / node env: a fake
// SpaceManager built from jest.fn (contextForSpace / readTable / saveTable /
// reloadContextByPath) + a superstate.settings stub, exactly the pattern used by
// pageTitleRename.test.ts. No vault, Obsidian, or React.
//
// REGRESSION GUARD (Notidian-gfzw follow-up): the ORIGINAL fix gated on
// `typeof rank === "number"`, but the SOLE production caller — the grouped drag
// handler at ContextListInstance.tsx:267-275 — passes rank=$context._index,
// which is a STRING ("0"/"1"/"2"): built as `index.toString()` at
// ContextEditorContext.tsx:628 and forwarded unchanged through
// ContextListView.tsx:259/301. `typeof "0" === "string"`, so that guard
// rejected EVERY grouped-drag reorder, silently dropping the user's requested
// order. The corrected guard is `rank != null`, which admits the string ranks
// the caller actually delivers (arrayMove/reorderRowsForPath coerce them) AND
// numeric 0, while still treating an absent rank as a pure value edit. The
// `... STRING rank` cases below reproduce the real caller's argument TYPE and
// go red on a `typeof rank === "number"` guard.
// ---------------------------------------------------------------------------
import { PathPropertyName } from "shared/types/context";
import { SpaceInfo } from "shared/types/spaceInfo";
import { DBRows, SpaceTable } from "shared/types/mdb";
import { updateContextValue, updateTableValue } from "./context";

// --- fixtures ---------------------------------------------------------------

const SCHEMA = { id: "files", name: "Files", type: "db" };

const SPACE: SpaceInfo = {
  name: "Items",
  path: "Items",
  isRemote: false,
  readOnly: false,
  defPath: "Items/.notidian/def.json",
  notePath: "Items/Items.md",
};

/** Three grouped rows; `group` is the field a grouped drag rewrites. */
const baseTable = (): SpaceTable => ({
  schema: SCHEMA,
  cols: [
    { name: PathPropertyName, type: "file" },
    { name: "group", type: "option" },
  ],
  rows: [
    { [PathPropertyName]: "Items/A.md", group: "alpha" },
    { [PathPropertyName]: "Items/B.md", group: "beta" },
    { [PathPropertyName]: "Items/C.md", group: "alpha" },
  ],
});

const paths = (rows: DBRows): string[] => rows.map((r) => r[PathPropertyName]);

/** Fake SpaceManager whose readTable/contextForSpace both serve `table`, and
 *  whose saveTable/reloadContextByPath are spies. `enhancedLogs` exercises the
 *  log branch without I/O. */
const makeManager = (table: SpaceTable) => {
  // Typed signatures so .mock.calls carries a real arg tuple (tsc indexes it below).
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
  const readTable = jest.fn(async (): Promise<SpaceTable> => table);
  const contextForSpace = jest.fn(async (): Promise<SpaceTable> => table);
  const manager = {
    readTable,
    contextForSpace,
    saveTable,
    superstate: {
      reloadContextByPath,
      settings: { enhancedLogs: false },
    },
  } as any;
  return { manager, saveTable, reloadContextByPath, readTable, contextForSpace };
};

// ===========================================================================
// updateTableValue — arrayMove(index, rank)
// ===========================================================================

describe("updateTableValue: rank 0 reorders to the top (Notidian-gfzw)", () => {
  it("moves the row to index 0 AND writes the new group value when rank === 0", async () => {
    // Drag C (index 2) to the TOP of group 'beta': set group=beta, rank=0.
    const table = baseTable();
    const { manager, saveTable } = makeManager(table);

    await updateTableValue(manager, SPACE, "files", 2, "group", "beta", 0);

    expect(saveTable).toHaveBeenCalledTimes(1);
    const [savedPath, savedTable, forceCreate] = saveTable.mock.calls[0];
    expect(savedPath).toBe(SPACE.path);
    expect(forceCreate).toBeUndefined();
    // C now sits at the very top; its group is rewritten to 'beta'.
    expect(savedTable.rows[0]).toEqual({
      [PathPropertyName]: "Items/C.md",
      group: "beta",
    });
    expect(paths(savedTable.rows)).toEqual([
      "Items/C.md",
      "Items/A.md",
      "Items/B.md",
    ]);
    // NOTE: updateTableValue calls processTable WITHOUT awaiting it (fire-and-forget),
    // so saveContext's deeper reloadContextByPath() is asserted on the awaited
    // updateContextValue path below, not here. saveTable firing with the reordered
    // table is the load-bearing fix.
  });

  it("rank === undefined updates the value in place and never reorders", async () => {
    const table = baseTable();
    const { manager, saveTable } = makeManager(table);

    // No rank: a plain value edit on row 2; order is untouched.
    await updateTableValue(manager, SPACE, "files", 2, "group", "beta");

    expect(saveTable).toHaveBeenCalledTimes(1);
    const savedTable = saveTable.mock.calls[0][1] as SpaceTable;
    expect(paths(savedTable.rows)).toEqual([
      "Items/A.md",
      "Items/B.md",
      "Items/C.md",
    ]);
    expect(savedTable.rows[2]).toEqual({
      [PathPropertyName]: "Items/C.md",
      group: "beta",
    });
  });

  it("a pure rank-0 reorder (value unchanged) still saves the moved order", async () => {
    // Move C to top of its OWN group value: only the position changes.
    const table = baseTable();
    const { manager, saveTable } = makeManager(table);

    await updateTableValue(manager, SPACE, "files", 2, "group", "alpha", 0);

    expect(saveTable).toHaveBeenCalledTimes(1);
    const savedTable = saveTable.mock.calls[0][1] as SpaceTable;
    expect(paths(savedTable.rows)).toEqual([
      "Items/C.md",
      "Items/A.md",
      "Items/B.md",
    ]);
  });

  it("a true no-op (same value, no rank) does not call saveTable", async () => {
    const table = baseTable();
    const { manager, saveTable } = makeManager(table);

    // Row 0 already has group 'alpha' and no rank -> _.isEqual short-circuits.
    await updateTableValue(manager, SPACE, "files", 0, "group", "alpha");

    expect(saveTable).not.toHaveBeenCalled();
  });

  it("rank === 0 to a non-zero source is honored even when the value is unchanged", async () => {
    // Row 1 (B) dragged to top, keeping its value: rank 0 must still reorder
    // (the old truthiness guard would have made this a silent no-op).
    const table = baseTable();
    const { manager, saveTable } = makeManager(table);

    await updateTableValue(manager, SPACE, "files", 1, "group", "beta", 0);

    expect(saveTable).toHaveBeenCalledTimes(1);
    const savedTable = saveTable.mock.calls[0][1] as SpaceTable;
    expect(paths(savedTable.rows)).toEqual([
      "Items/B.md",
      "Items/A.md",
      "Items/C.md",
    ]);
  });

  // --- real-caller contract: rank arrives as a STRING (_index) ---------------
  // The production grouped-drag caller passes rank=$context._index AND
  // index=$context._index, both STRINGS. These cases pass the strings the live
  // path delivers; they go red under a `typeof rank === "number"` guard.
  it('STRING rank "0" (drag to top) reorders — the real caller passes a string', async () => {
    const table = baseTable();
    const { manager, saveTable } = makeManager(table);

    // active.$context._index="2" (drag C), over.$context._index="0" (drop top).
    await updateTableValue(
      manager,
      SPACE,
      "files",
      "2" as unknown as number,
      "group",
      "beta",
      "0" as unknown as number
    );

    expect(saveTable).toHaveBeenCalledTimes(1);
    const savedTable = saveTable.mock.calls[0][1] as SpaceTable;
    expect(paths(savedTable.rows)).toEqual([
      "Items/C.md",
      "Items/A.md",
      "Items/B.md",
    ]);
    expect(savedTable.rows[0]).toEqual({
      [PathPropertyName]: "Items/C.md",
      group: "beta",
    });
  });

  it('STRING rank "1" (non-zero, value unchanged) still reorders', async () => {
    const table = baseTable();
    const { manager, saveTable } = makeManager(table);

    // Drag C (index "2") to position "1", keeping its 'alpha' group.
    await updateTableValue(
      manager,
      SPACE,
      "files",
      "2" as unknown as number,
      "group",
      "alpha",
      "1" as unknown as number
    );

    expect(saveTable).toHaveBeenCalledTimes(1);
    const savedTable = saveTable.mock.calls[0][1] as SpaceTable;
    expect(paths(savedTable.rows)).toEqual([
      "Items/A.md",
      "Items/C.md",
      "Items/B.md",
    ]);
  });
});

// ===========================================================================
// updateContextValue — reorderRowsForPath(mdb, [path], rank)
// ===========================================================================

describe("updateContextValue: rank 0 reorders to the top (Notidian-gfzw)", () => {
  it("moves the path to index 0 AND writes the new value when rank === 0", async () => {
    const table = baseTable();
    const { manager, saveTable, reloadContextByPath } = makeManager(table);

    await updateContextValue(
      manager,
      SPACE,
      "Items/C.md",
      "group",
      "beta",
      undefined, // default updateFunction (updateValue)
      0 // rank
    );

    expect(saveTable).toHaveBeenCalledTimes(1);
    const savedTable = saveTable.mock.calls[0][1] as SpaceTable;
    // reorderRowsForPath pulls C out then re-inserts it at index 0 of the rest.
    expect(paths(savedTable.rows)).toEqual([
      "Items/C.md",
      "Items/A.md",
      "Items/B.md",
    ]);
    expect(savedTable.rows[0].group).toBe("beta");
    expect(reloadContextByPath).toHaveBeenCalledTimes(1);
  });

  it("rank === undefined updates the value but leaves row order untouched", async () => {
    const table = baseTable();
    const { manager, saveTable } = makeManager(table);

    await updateContextValue(manager, SPACE, "Items/C.md", "group", "beta");

    expect(saveTable).toHaveBeenCalledTimes(1);
    const savedTable = saveTable.mock.calls[0][1] as SpaceTable;
    expect(paths(savedTable.rows)).toEqual([
      "Items/A.md",
      "Items/B.md",
      "Items/C.md",
    ]);
    expect(savedTable.rows[2].group).toBe("beta");
  });

  it("forwards force / calculate flags through saveContext on a rank-0 move", async () => {
    const table = baseTable();
    const { manager, saveTable, reloadContextByPath } = makeManager(table);

    await updateContextValue(
      manager,
      SPACE,
      "Items/B.md",
      "group",
      "alpha",
      undefined,
      0,
      true, // force
      false // calculate
    );

    const forceCreate = saveTable.mock.calls[0][2];
    expect(forceCreate).toBe(true);
    // calculate=false is threaded into the reload options.
    expect(reloadContextByPath).toHaveBeenCalledWith(SPACE.path, {
      force: true,
      calculate: false,
    });
    const savedTable = saveTable.mock.calls[0][1] as SpaceTable;
    expect(paths(savedTable.rows)).toEqual([
      "Items/B.md",
      "Items/A.md",
      "Items/C.md",
    ]);
  });

  it('STRING rank "0" reorders the path to index 0 (caller-contract parity)', async () => {
    const table = baseTable();
    const { manager, saveTable } = makeManager(table);

    await updateContextValue(
      manager,
      SPACE,
      "Items/C.md",
      "group",
      "beta",
      undefined,
      "0" as unknown as number
    );

    expect(saveTable).toHaveBeenCalledTimes(1);
    const savedTable = saveTable.mock.calls[0][1] as SpaceTable;
    expect(paths(savedTable.rows)).toEqual([
      "Items/C.md",
      "Items/A.md",
      "Items/B.md",
    ]);
    expect(savedTable.rows[0].group).toBe("beta");
  });
});
