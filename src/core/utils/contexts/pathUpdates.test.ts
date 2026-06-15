import { PathPropertyName } from "shared/types/context";
import { DBRow, SpaceTable } from "shared/types/mdb";
import {
  removeRowForPath,
  removeRowsForPath,
  renameRowForPath,
  reorderRowsForPath,
} from "./pathUpdates";

/**
 * pathUpdates.ts carries the row-identity-by-PATH logic that sits behind the
 * P0 reorder/undo data-loss bug (Notidian-sck: undo after a manual row reorder
 * wrote a stale frontmatter value into the WRONG file because rows were resolved
 * by stale index instead of by path). Every function here keys rows by
 * PathPropertyName ("File"), so the load-bearing guarantees are:
 *
 *   - identity is the path, never the array position;
 *   - non-targeted rows and non-path fields survive byte-identical;
 *   - the input table object is never mutated (pure, returns a fresh table);
 *   - reorder is a permutation of the input (no row dropped or duplicated) that
 *     preserves the relative order of BOTH the moved set and the survivors.
 *
 * These are pure/offline assertions — no SpaceManager, vault, or mocks.
 */

// ---------------------------------------------------------------------------
// Fixtures / helpers
// ---------------------------------------------------------------------------

/** Build a row with a path identity plus arbitrary extra (non-path) fields. */
const row = (path: string, extra: Record<string, string> = {}): DBRow => ({
  [PathPropertyName]: path,
  ...extra,
});

/**
 * A representative table: every row carries the path identity AND independent
 * non-path fields ("name", "value") so we can prove non-path data is untouched.
 */
const makeTable = (paths: string[]): SpaceTable => ({
  schema: { id: "files", name: "Files", type: "db" },
  cols: [
    { name: PathPropertyName, type: "file" },
    { name: "name", type: "text" },
    { name: "value", type: "number" },
  ],
  rows: paths.map((p, i) =>
    row(p, { name: `name-${p}`, value: `${i * 10}` })
  ),
});

/** Ordered list of path identities for a table's rows. */
const pathsOf = (t: SpaceTable): string[] =>
  t.rows.map((r) => r[PathPropertyName]);

/** Deep clone for "did the function mutate its input?" comparisons. */
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));

/** Sorted multiset of paths — order-independent identity check. */
const multiset = (xs: string[]): string[] => [...xs].sort();

/** Relative order of `subset` as it appears in `seq`. */
const relativeOrder = (seq: string[], subset: string[]): string[] =>
  seq.filter((x) => subset.includes(x));

const ALPHA = ["a", "b", "c", "d", "e", "f", "g"];

// ===========================================================================
// renameRowForPath
// ===========================================================================

describe("renameRowForPath", () => {
  it("rewrites only the matching path's identity, leaving every other field intact", () => {
    const table = makeTable(["a", "b", "c"]);
    const result = renameRowForPath(table, "b", "b-renamed");

    expect(pathsOf(result)).toEqual(["a", "b-renamed", "c"]);

    // The renamed row keeps all of its non-path fields verbatim.
    const renamed = result.rows.find(
      (r) => r[PathPropertyName] === "b-renamed"
    )!;
    expect(renamed.name).toBe("name-b");
    expect(renamed.value).toBe("10");
    // Only the path field changed; no field count drift.
    expect(Object.keys(renamed).sort()).toEqual(
      [PathPropertyName, "name", "value"].sort()
    );
  });

  it("leaves all non-matching rows byte-identical (same object references reused)", () => {
    const table = makeTable(["a", "b", "c"]);
    const result = renameRowForPath(table, "b", "b2");

    // map() returns the SAME reference for untouched rows (identity preserved).
    expect(result.rows[0]).toBe(table.rows[0]);
    expect(result.rows[2]).toBe(table.rows[2]);
    expect(result.rows[1]).not.toBe(table.rows[1]); // the renamed one is fresh
  });

  it("does not mutate the original table or its rows", () => {
    const table = makeTable(["a", "b", "c"]);
    const snapshot = clone(table);

    const result = renameRowForPath(table, "b", "b2");

    expect(table).toEqual(snapshot); // input untouched
    expect(result).not.toBe(table); // fresh table object
    expect(result.rows).not.toBe(table.rows); // fresh rows array
    // schema/cols are spread through unchanged (same references).
    expect(result.schema).toBe(table.schema);
    expect(result.cols).toBe(table.cols);
  });

  it("is a no-op (path-wise) when the path is absent", () => {
    const table = makeTable(["a", "b", "c"]);
    const result = renameRowForPath(table, "zzz", "whatever");
    expect(pathsOf(result)).toEqual(["a", "b", "c"]);
    expect(result.rows).toEqual(table.rows);
  });

  it("renames EVERY occurrence when duplicate paths exist (path == identity)", () => {
    // Duplicate paths should not exist in a healthy table, but the function must
    // behave deterministically: it rewrites all matches, never a stale subset.
    const table = makeTable(["a", "dup", "b", "dup"]);
    const result = renameRowForPath(table, "dup", "dup-new");
    expect(pathsOf(result)).toEqual(["a", "dup-new", "b", "dup-new"]);
  });

  it("preserves the input row count", () => {
    const table = makeTable(ALPHA);
    const result = renameRowForPath(table, "d", "d-new");
    expect(result.rows.length).toBe(table.rows.length);
  });
});

// ===========================================================================
// removeRowForPath
// ===========================================================================

describe("removeRowForPath", () => {
  it("removes exactly the targeted path and preserves survivor order", () => {
    const table = makeTable(["a", "b", "c", "d"]);
    const result = removeRowForPath(table, "c");
    expect(pathsOf(result)).toEqual(["a", "b", "d"]);
  });

  it("removes ALL rows that share the targeted path (duplicate handling)", () => {
    const table = makeTable(["a", "dup", "b", "dup", "c"]);
    const result = removeRowForPath(table, "dup");
    expect(pathsOf(result)).toEqual(["a", "b", "c"]);
  });

  it("is a no-op when the path is absent", () => {
    const table = makeTable(["a", "b", "c"]);
    const result = removeRowForPath(table, "zzz");
    expect(pathsOf(result)).toEqual(["a", "b", "c"]);
  });

  it("does not mutate the original table", () => {
    const table = makeTable(["a", "b", "c"]);
    const snapshot = clone(table);
    const result = removeRowForPath(table, "b");
    expect(table).toEqual(snapshot);
    expect(result.rows).not.toBe(table.rows);
    expect(result.schema).toBe(table.schema);
    expect(result.cols).toBe(table.cols);
  });

  it("leaves surviving rows byte-identical (same references)", () => {
    const table = makeTable(["a", "b", "c"]);
    const result = removeRowForPath(table, "b");
    expect(result.rows[0]).toBe(table.rows[0]);
    expect(result.rows[1]).toBe(table.rows[2]);
  });
});

// ===========================================================================
// removeRowsForPath
// ===========================================================================

describe("removeRowsForPath", () => {
  it("removes exactly the targeted set and preserves survivor order", () => {
    const table = makeTable(["a", "b", "c", "d", "e"]);
    const result = removeRowsForPath(table, ["b", "d"]);
    expect(pathsOf(result)).toEqual(["a", "c", "e"]);
  });

  it("preserves survivor order even for a scattered removal selection", () => {
    const table = makeTable(ALPHA);
    const result = removeRowsForPath(table, ["a", "c", "f"]);
    expect(pathsOf(result)).toEqual(["b", "d", "e", "g"]);
  });

  it("is a no-op for an empty target list", () => {
    const table = makeTable(["a", "b", "c"]);
    const result = removeRowsForPath(table, []);
    expect(pathsOf(result)).toEqual(["a", "b", "c"]);
  });

  it("ignores absent paths while still removing present ones", () => {
    const table = makeTable(["a", "b", "c"]);
    const result = removeRowsForPath(table, ["b", "zzz", "qqq"]);
    expect(pathsOf(result)).toEqual(["a", "c"]);
  });

  it("removes all duplicates of a targeted path", () => {
    const table = makeTable(["a", "dup", "b", "dup", "c"]);
    const result = removeRowsForPath(table, ["dup"]);
    expect(pathsOf(result)).toEqual(["a", "b", "c"]);
  });

  it("can remove the entire table", () => {
    const table = makeTable(["a", "b", "c"]);
    const result = removeRowsForPath(table, ["a", "b", "c"]);
    expect(result.rows).toEqual([]);
  });

  it("does not mutate the original table", () => {
    const table = makeTable(["a", "b", "c", "d"]);
    const snapshot = clone(table);
    const result = removeRowsForPath(table, ["b", "c"]);
    expect(table).toEqual(snapshot);
    expect(result.rows).not.toBe(table.rows);
    expect(result.schema).toBe(table.schema);
    expect(result.cols).toBe(table.cols);
  });

  it("matches removeRowForPath for a single-element list", () => {
    const table = makeTable(["a", "b", "c", "d"]);
    expect(removeRowsForPath(table, ["c"]).rows).toEqual(
      removeRowForPath(table, "c").rows
    );
  });
});

// ===========================================================================
// reorderRowsForPath  — the subtle one (Notidian-sck blast radius)
// ===========================================================================
//
// Semantics actually implemented:
//   1. Pull out the rows whose path is in `paths` (the "moved" block), in their
//      original relative order.
//   2. Filter them out of the table to get the "remaining" rows, in order.
//   3. insertMulti(remaining, index, moved): index is relative to the REMAINING
//      array (not the original table). index<=0 (or 0/falsy) prepends; otherwise
//      it splices the moved block in after `index` remaining rows.
//
// The load-bearing guarantees we lock down:
//   - output is a PERMUTATION of input (same multiset of paths; nothing dropped
//     or duplicated) — this is the data-loss guard;
//   - relative order of the moved block is preserved;
//   - relative order of the remaining rows is preserved;
//   - the moved block lands at `index` within the remaining sequence, clamped to
//     [0, remaining.length] for out-of-range indices (no corruption, no throw).
// ===========================================================================

describe("reorderRowsForPath", () => {
  // ---- invariant battery across many edge indices & selection shapes ----

  const selections: { label: string; paths: string[] }[] = [
    { label: "single", paths: ["c"] },
    { label: "contiguous block", paths: ["b", "c", "d"] },
    { label: "scattered", paths: ["a", "d", "f"] },
    { label: "reverse-listed scattered", paths: ["f", "d", "a"] },
    { label: "non-adjacent pair", paths: ["b", "f"] },
    { label: "all rows", paths: [...ALPHA] },
    { label: "none", paths: [] },
  ];

  const indices = [-5, -1, 0, 1, 2, 3, 4, 7, 10, 100];

  for (const sel of selections) {
    for (const index of indices) {
      it(`PERMUTATION invariant: ${sel.label} -> index ${index} keeps the exact multiset of paths`, () => {
        const table = makeTable(ALPHA);
        const result = reorderRowsForPath(table, sel.paths, index);
        // No row dropped, none duplicated — the core data-loss guard.
        expect(multiset(pathsOf(result))).toEqual(multiset(ALPHA));
        expect(result.rows.length).toBe(ALPHA.length);
      });

      it(`order invariant: ${sel.label} -> index ${index} preserves relative order of moved AND remaining rows`, () => {
        const table = makeTable(ALPHA);
        const result = reorderRowsForPath(table, sel.paths, index);
        const out = pathsOf(result);

        const moved = ALPHA.filter((p) => sel.paths.includes(p));
        const remaining = ALPHA.filter((p) => !sel.paths.includes(p));

        // Moved rows appear in their original relative order (NOT the order they
        // were listed in `paths` — identity-by-path, listing order is irrelevant).
        expect(relativeOrder(out, moved)).toEqual(moved);
        // Survivors keep their original relative order.
        expect(relativeOrder(out, remaining)).toEqual(remaining);
      });

      it(`placement invariant: ${sel.label} -> index ${index} drops the moved block at the clamped insertion slot`, () => {
        const table = makeTable(ALPHA);
        const result = reorderRowsForPath(table, sel.paths, index);
        const out = pathsOf(result);

        const moved = ALPHA.filter((p) => sel.paths.includes(p));
        const remaining = ALPHA.filter((p) => !sel.paths.includes(p));

        // Reconstruct the spec: clamp index into [0, remaining.length] and splice
        // the moved block into the remaining sequence there.
        const clamped = Math.max(0, Math.min(index, remaining.length));
        const expected = [
          ...remaining.slice(0, clamped),
          ...moved,
          ...remaining.slice(clamped),
        ];
        expect(out).toEqual(expected);
      });
    }
  }

  // ---- concrete, human-readable cases of the most bug-prone moves ----

  it("moves a single row to the front (index 0 / prepend path)", () => {
    const table = makeTable(["a", "b", "c", "d"]);
    expect(pathsOf(reorderRowsForPath(table, ["c"], 0))).toEqual([
      "c",
      "a",
      "b",
      "d",
    ]);
  });

  it("treats any negative index like a prepend (no throw, no corruption)", () => {
    const table = makeTable(["a", "b", "c", "d"]);
    expect(pathsOf(reorderRowsForPath(table, ["d"], -3))).toEqual([
      "d",
      "a",
      "b",
      "c",
    ]);
  });

  it("clamps index beyond the remaining length to the end (no gaps, no drops)", () => {
    const table = makeTable(["a", "b", "c", "d"]);
    // remaining = [a, b, d]; index 100 clamps to end -> moved block last.
    expect(pathsOf(reorderRowsForPath(table, ["c"], 100))).toEqual([
      "a",
      "b",
      "d",
      "c",
    ]);
  });

  it("relocates a contiguous block to an interior slot keeping block order", () => {
    const table = makeTable(["a", "b", "c", "d", "e"]);
    // moved = [b, c]; remaining = [a, d, e]; index 2 within remaining -> after a,d.
    expect(pathsOf(reorderRowsForPath(table, ["b", "c"], 2))).toEqual([
      "a",
      "d",
      "b",
      "c",
      "e",
    ]);
  });

  it("relocates a scattered selection, collapsing it into a contiguous block in original relative order", () => {
    const table = makeTable(["a", "b", "c", "d", "e"]);
    // moved = [a, c, e] (original relative order); remaining = [b, d].
    // index 1 within remaining -> after b.
    expect(pathsOf(reorderRowsForPath(table, ["a", "c", "e"], 1))).toEqual([
      "b",
      "a",
      "c",
      "e",
      "d",
    ]);
  });

  it("orders the moved block by ORIGINAL position, not by the order paths were listed", () => {
    const table = makeTable(["a", "b", "c", "d", "e"]);
    // Caller lists e before a, but identity-by-path means original order wins.
    const listedOneWay = pathsOf(reorderRowsForPath(table, ["e", "a"], 0));
    const listedOther = pathsOf(reorderRowsForPath(table, ["a", "e"], 0));
    expect(listedOneWay).toEqual(["a", "e", "b", "c", "d"]);
    expect(listedOther).toEqual(["a", "e", "b", "c", "d"]);
  });

  it("ignores paths that are not present in the table", () => {
    const table = makeTable(["a", "b", "c"]);
    // "zzz" is absent: moved = [b]; remaining = [a, c]; index 1 -> after a.
    expect(pathsOf(reorderRowsForPath(table, ["b", "zzz"], 1))).toEqual([
      "a",
      "b",
      "c",
    ]);
  });

  it("is a no-op shape when nothing is selected", () => {
    const table = makeTable(["a", "b", "c"]);
    // Empty selection: insertMulti(remaining=[a,b,c], index, moved=[]) === remaining.
    expect(pathsOf(reorderRowsForPath(table, [], 2))).toEqual(["a", "b", "c"]);
    expect(pathsOf(reorderRowsForPath(table, [], 0))).toEqual(["a", "b", "c"]);
  });

  it("preserves each row's non-path fields verbatim after a reorder (no value bleed)", () => {
    // Direct guard against the Notidian-sck class of bug: a reorder must move
    // WHOLE rows by identity; a row's non-path payload must travel with its path,
    // never get re-paired with a different path.
    const table = makeTable(["a", "b", "c", "d"]);
    const result = reorderRowsForPath(table, ["c", "a"], 1);

    for (const p of ["a", "b", "c", "d"]) {
      const before = table.rows.find((r) => r[PathPropertyName] === p)!;
      const after = result.rows.find((r) => r[PathPropertyName] === p)!;
      expect(after.name).toBe(before.name);
      expect(after.value).toBe(before.value);
    }
  });

  it("reuses the original row object references (rows travel intact, untouched)", () => {
    const table = makeTable(["a", "b", "c", "d"]);
    const result = reorderRowsForPath(table, ["b"], 3);
    for (const p of ["a", "b", "c", "d"]) {
      const before = table.rows.find((r) => r[PathPropertyName] === p)!;
      const after = result.rows.find((r) => r[PathPropertyName] === p)!;
      expect(after).toBe(before);
    }
  });

  it("does not mutate the original table", () => {
    const table = makeTable(ALPHA);
    const snapshot = clone(table);
    const result = reorderRowsForPath(table, ["b", "e"], 3);
    expect(table).toEqual(snapshot);
    expect(result).not.toBe(table);
    expect(result.rows).not.toBe(table.rows);
    expect(result.schema).toBe(table.schema);
    expect(result.cols).toBe(table.cols);
  });

  it("round-trips: reordering by the same call twice from a fixed input is idempotent in multiset", () => {
    const table = makeTable(ALPHA);
    const once = reorderRowsForPath(table, ["c", "d"], 2);
    const twice = reorderRowsForPath(once, ["c", "d"], 2);
    // Applying the same move to the already-moved table is stable (block already
    // sits at that slot) — and at minimum stays a permutation.
    expect(multiset(pathsOf(twice))).toEqual(multiset(ALPHA));
    expect(pathsOf(twice)).toEqual(pathsOf(once));
  });
});
