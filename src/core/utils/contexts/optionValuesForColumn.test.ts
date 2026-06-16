import {
  createNewRow,
  optionValuesForColumn,
} from "./optionValuesForColumn";
import { insert } from "shared/utils/array";
import { DBRow, SpaceTable } from "shared/types/mdb";

// ---------------------------------------------------------------------------
// DEPTH (Q1) — adversarial characterization net for the PURE functions in
// src/core/utils/contexts/optionValuesForColumn.ts (Notidian-1s2).
//
// Only the two genuinely pure functions are exercised here:
//   - optionValuesForColumn(column, table) — the distinct-option harvester that
//     feeds option/tag suggestion menus. It uniq()s the flat-mapped result of
//     parseMultiString over every row's cell, skipping non-string cells.
//   - createNewRow(mdb, row, index) — the immutable row inserter behind table
//     row creation / drag-create.
//
// defaultTableDataForContext and renameTagSpacePath are intentionally NOT
// tested — they require a live Superstate / spaceManager.
//
// These are characterization tests: they LOCK behavior so a refactor that
// changes it is caught. Where behavior is a latent footgun it is labelled
// ADVERSARIAL and the source line is cited.
//
// UPDATE (Notidian-9fla): the createNewRow off-by-falsy index defect first
// characterized here WAS a genuine correctness bug — `if (index)` dropped
// index 0 (insert-at-top) to the append branch. It is now fixed to
// `index !== undefined`; the createNewRow block below pins the corrected
// insert-at-top contract.
//
// Pure / offline: no DOM, no vault, no Superstate at call time.
// ---------------------------------------------------------------------------

const tableWith = (rows: DBRow[]): SpaceTable => ({
  schema: { id: "ctx", name: "ctx", type: "db" },
  cols: [],
  rows,
});

// Helper to build rows whose cell value is deliberately a non-string, so we can
// exercise the `!isString(c[column])` skip branch. DBRow is typed
// Record<string,string>, but at runtime rows carry mixed values; the cast keeps
// the fixture honest about that reality.
const row = (cell: unknown): DBRow => ({ col: cell as string });

describe("optionValuesForColumn — string cells, distinct values", () => {
  test("collects single-value string cells, de-duplicated, in first-seen order", () => {
    const table = tableWith([row("a"), row("b"), row("a"), row("c"), row("b")]);
    expect(optionValuesForColumn("col", table)).toEqual(["a", "b", "c"]);
  });

  test("returns [] for an empty rows array", () => {
    expect(optionValuesForColumn("col", tableWith([]))).toEqual([]);
  });

  test("a column absent from the rows yields [] (every cell is undefined -> skipped)", () => {
    const table = tableWith([row("a"), row("b")]);
    expect(optionValuesForColumn("missing", table)).toEqual([]);
  });

  test("blank-string cells contribute nothing (parseMultiString('') -> [])", () => {
    const table = tableWith([row(""), row("a"), row("")]);
    expect(optionValuesForColumn("col", table)).toEqual(["a"]);
  });
});

describe("optionValuesForColumn — parseMultiString expansion (multi-option cells)", () => {
  test("comma-delimited display strings expand into separate options", () => {
    const table = tableWith([row("a,b"), row("c")]);
    expect(optionValuesForColumn("col", table)).toEqual(["a", "b", "c"]);
  });

  test("comma-delimited values are trimmed (parseMultiDisplayString trims each)", () => {
    const table = tableWith([row("a, b ,  c")]);
    expect(optionValuesForColumn("col", table)).toEqual(["a", "b", "c"]);
  });

  test("JSON-array cells ('[...]'-prefixed) expand via safelyParseJSON", () => {
    const table = tableWith([row('["x","y"]'), row("z")]);
    expect(optionValuesForColumn("col", table)).toEqual(["x", "y", "z"]);
  });

  test("duplicate options across single and multi cells are de-duped", () => {
    const table = tableWith([row("a,b"), row("b,c"), row("a")]);
    expect(optionValuesForColumn("col", table)).toEqual(["a", "b", "c"]);
  });

  test("ADVERSARIAL: a malformed JSON-array cell ('[' prefix, broken body) does NOT throw; safelyParseJSON->undefined->ensureArray->[] so it contributes nothing", () => {
    // This is the whole reason json.ts must return undefined-on-failure: a
    // single stray '[' or a truncated mid-write array must degrade, not crash
    // the reduce. Lock that here at the integration point.
    const table = tableWith([row("["), row('["a", "b'), row("real")]);
    expect(() => optionValuesForColumn("col", table)).not.toThrow();
    expect(optionValuesForColumn("col", table)).toEqual(["real"]);
  });
});

describe("optionValuesForColumn — non-string cells are skipped (isString guard)", () => {
  test.each([
    ["number", 42],
    ["zero", 0],
    ["true", true],
    ["false", false],
    ["null", null],
    ["undefined", undefined],
    ["array", ["a", "b"]],
    ["object", { a: 1 }],
  ])("skips a %s cell without throwing", (_label, cell) => {
    const table = tableWith([row("keep"), row(cell), row("also")]);
    expect(optionValuesForColumn("col", table)).toEqual(["keep", "also"]);
  });

  test("a column where EVERY cell is non-string yields []", () => {
    const table = tableWith([row(1), row(2), row(null)]);
    expect(optionValuesForColumn("col", table)).toEqual([]);
  });
});

describe("optionValuesForColumn — null/undefined table guard", () => {
  test.each([
    ["undefined table", undefined],
    ["null table", null],
  ])(
    "ADVERSARIAL: %s is guarded by `table?.rows.reduce(...) ?? []` -> [] (the optional-chain short-circuits the whole .rows.reduce expr to undefined, then ?? [] catches it)",
    (_label, table) => {
      expect(
        optionValuesForColumn("col", table as unknown as SpaceTable)
      ).toEqual([]);
    }
  );

  test.each([
    ["rows: undefined", {} as unknown],
    ["rows: null", { rows: null } as unknown],
  ])(
    "ADVERSARIAL: a PRESENT table with %s THROWS — the `?.` only guards the table itself, NOT .rows, so undefined.reduce crashes (the ?? [] never gets a chance)",
    (_label, table) => {
      // Footgun characterization: the guard protects a missing table but NOT a
      // present-table-with-missing-rows. Source: optionValuesForColumn.ts:18
      // `table?.rows.reduce(...) ?? []`.
      expect(() =>
        optionValuesForColumn("col", table as unknown as SpaceTable)
      ).toThrow(TypeError);
    }
  );
});

describe("optionValuesForColumn — immutability", () => {
  test("does not mutate the input table or its rows", () => {
    const rows = [row("a,b"), row("c")];
    const table = tableWith(rows);
    const snapshot = JSON.stringify(table);
    optionValuesForColumn("col", table);
    expect(JSON.stringify(table)).toEqual(snapshot);
    expect(table.rows).toBe(rows);
  });
});

// ===========================================================================
// createNewRow
// ===========================================================================

const mdbWith = (rows: DBRow[]): SpaceTable => tableWith(rows);

describe("createNewRow — a positive index inserts at that position via array.insert", () => {
  test("index 1 inserts between existing rows", () => {
    const mdb = mdbWith([{ id: "0" }, { id: "1" }, { id: "2" }]);
    const newRow: DBRow = { id: "NEW" };
    const result = createNewRow(mdb, newRow, 1);
    expect(result.rows).toEqual([
      { id: "0" },
      { id: "NEW" },
      { id: "1" },
      { id: "2" },
    ]);
  });

  test("index === rows.length appends at the very end", () => {
    const mdb = mdbWith([{ id: "0" }, { id: "1" }]);
    const result = createNewRow(mdb, { id: "NEW" }, 2);
    expect(result.rows).toEqual([{ id: "0" }, { id: "1" }, { id: "NEW" }]);
  });

  test("delegates to array.insert for truthy index (same positional semantics)", () => {
    const rows = [{ id: "0" }, { id: "1" }, { id: "2" }];
    const mdb = mdbWith(rows);
    const newRow: DBRow = { id: "NEW" };
    expect(createNewRow(mdb, newRow, 2).rows).toEqual(insert(rows, 2, newRow));
  });

  test("returns a new table object and a new rows array (immutable; does not mutate input)", () => {
    const rows = [{ id: "0" }, { id: "1" }];
    const mdb = mdbWith(rows);
    const result = createNewRow(mdb, { id: "NEW" }, 1);
    expect(result).not.toBe(mdb);
    expect(result.rows).not.toBe(rows);
    expect(rows).toEqual([{ id: "0" }, { id: "1" }]); // untouched
  });

  test("preserves the rest of the table (schema, cols) unchanged", () => {
    const mdb = mdbWith([{ id: "0" }]);
    const result = createNewRow(mdb, { id: "NEW" }, 1);
    expect(result.schema).toBe(mdb.schema);
    expect(result.cols).toBe(mdb.cols);
  });
});

describe("createNewRow — index 0 / negative prepend (insert-at-top); only an absent index appends", () => {
  // REGRESSION (Notidian-9fla). The guard was `if (index)`, a truthiness test
  // under which index === 0 is falsy and fell through to the append branch — so
  // a row meant for position 0 (TableView newRow's "insert above the first
  // row") wrongly landed at the bottom. The guard is now `index !== undefined`,
  // so 0 (and any negative index) reaches array.insert, which front-inserts for
  // index <= 0 (shared/utils/array.ts `!index || index <= 0`). Only an ABSENT
  // index (undefined) appends.

  test("index === 0 PREPENDS the new row at position 0 (insert-at-top)", () => {
    const mdb = mdbWith([{ id: "0" }, { id: "1" }]);
    const result = createNewRow(mdb, { id: "NEW" }, 0);
    expect(result.rows).toEqual([{ id: "NEW" }, { id: "0" }, { id: "1" }]);
    // Explicitly a prepend, not an append:
    expect(result.rows[0]).toEqual({ id: "NEW" });
    expect(result.rows[result.rows.length - 1]).toEqual({ id: "1" });
  });

  test("a negative index also prepends (insert front-inserts for index <= 0)", () => {
    const mdb = mdbWith([{ id: "0" }, { id: "1" }]);
    const result = createNewRow(mdb, { id: "NEW" }, -3);
    expect(result.rows).toEqual([{ id: "NEW" }, { id: "0" }, { id: "1" }]);
  });

  test("index 0 delegates to array.insert (same front-insert semantics, no short-circuit)", () => {
    const rows = [{ id: "0" }, { id: "1" }];
    const mdb = mdbWith(rows);
    const newRow: DBRow = { id: "NEW" };
    expect(createNewRow(mdb, newRow, 0).rows).toEqual(insert(rows, 0, newRow));
  });

  test("CONTRAST baseline: array.insert(arr, 0, x) front-inserts — createNewRow now composes with it instead of short-circuiting", () => {
    const rows = [{ id: "0" }, { id: "1" }];
    expect(insert(rows, 0, { id: "NEW" })).toEqual([
      { id: "NEW" },
      { id: "0" },
      { id: "1" },
    ]);
  });

  test("ONLY an absent (undefined) index appends at the end", () => {
    const mdb = mdbWith([{ id: "0" }, { id: "1" }]);
    const result = createNewRow(mdb, { id: "NEW" });
    expect(result.rows).toEqual([{ id: "0" }, { id: "1" }, { id: "NEW" }]);
  });

  test("index 0 is immutable (new table object + new rows array; input untouched)", () => {
    const rows = [{ id: "0" }, { id: "1" }];
    const mdb = mdbWith(rows);
    const result = createNewRow(mdb, { id: "NEW" }, 0);
    expect(result).not.toBe(mdb);
    expect(result.rows).not.toBe(rows);
    expect(rows).toEqual([{ id: "0" }, { id: "1" }]); // untouched
  });

  test("empty table: index 0 and absent index both yield a single-row table", () => {
    expect(createNewRow(mdbWith([]), { id: "NEW" }).rows).toEqual([
      { id: "NEW" },
    ]);
    expect(createNewRow(mdbWith([]), { id: "NEW" }, 0).rows).toEqual([
      { id: "NEW" },
    ]);
  });
});
