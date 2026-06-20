import { DBRow, DBRows, SpaceTableColumn } from "shared/types/mdb";
import { Filter, Sort } from "shared/types/predicate";
import { filterReturnForCol } from "./predicate/filter";
import { sortReturnForCol } from "./predicate/sort";
import { applyAssemblyLimit, selectRowWindow } from "./tableAssembly";

// ===========================================================================
// ADVERSARIAL + PROPERTY LOCK for the ASSEMBLE-BEFORE-PAGINATE data seam
// (Notidian-yjg3). The table derives -> joins -> filters -> sorts ALL rows into
// one assembled set (ContextEditorContext.tsx filteredSortedData/filteredData
// useMemo, ~L716/L806), and ONLY THEN limits what reaches the DOM
// (predicate.limit at L811; and — behind the Notidian-8h9 flag — virtualization).
//
// This file is the OFFLINE LOCK on that seam: it never renders React. It pins
//
//   (A) the FULL filter -> sort -> limit COMPOSITION over the REAL pure modules
//       (filterReturnForCol, sortReturnForCol, applyAssemblyLimit) — exactly the
//       reduce-pipeline the component runs — and proves it is STABLE and
//       IDEMPOTENT under re-derive (re-assembling the same inputs yields the same
//       rows in the same order, byte-for-byte), survives empty + duplicate-key
//       rows, and that filter then sort then limit is order-independent in the
//       sense the render path relies on (limiting the assembled set == taking the
//       first N of that same assembled set).
//
//   (B) the predicate.limit CLAMP (applyAssemblyLimit): negative / 0 / huge / NaN
//       / undefined all behave EXACTLY as the inline `limit > 0 ? slice : base`
//       it replaced, and limiting is a PURE non-mutating prefix view.
//
//   (C) the 8h9 KEY INVARIANT (selectRowWindow): selecting ANY row window [a, b)
//       is a PURE VIEW that NEVER changes the membership or order of the assembled
//       set, the union of disjoint windows reconstructs the set exactly, and an
//       empty assembled set (or an out-of-range / inverted window) yields an
//       EMPTY window — never a throw. This is the contract the virtualization
//       flag-gate must preserve byte-for-byte.
//
// CONVENTION: hand-rolled mulberry32 PRNG + PROPERTY_RUNS loop, NO fast-check
// dependency — matching tableVirtualWindow.adversarial.test.ts and the other
// property suites in this tree.
// ===========================================================================

// --- tiny deterministic PRNG (no external dep) -----------------------------
const makeRng = (seed: number) => {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};
const randInt = (rng: () => number, min: number, max: number) =>
  min + Math.floor(rng() * (max - min + 1));

const PROPERTY_RUNS = 3000;

// --- the assembly pipeline, mirrored from ContextEditorContext exactly ------
// filteredSortedData = data.filter(filters-reduce).sort(sort-reduce)
// filteredData       = applyAssemblyLimit(filteredSortedData, limit)
// (the search + sub-items joins are additional pre-limit steps in the component;
// they do not change the seam's algebra — every step is an assemble-before-limit
// derivation, and the limit/window math is what this file locks.)

const NAME_COL: SpaceTableColumn = { name: "name", schemaId: "s", type: "text" };
const NUM_COL: SpaceTableColumn = { name: "score", schemaId: "s", type: "number" };
const ALL_COLS = [NAME_COL, NUM_COL];

const findCol = (field: string): SpaceTableColumn | undefined =>
  ALL_COLS.find((c) => (c.name ?? "") + (c.table ?? "") == field);

const assembleFilterSort = (
  data: DBRows,
  filters: Filter[],
  sort: Sort[]
): DBRows =>
  data
    .filter((row) =>
      filters.reduce<boolean>(
        (p, c) => (p ? filterReturnForCol(findCol(c.field), c, row, {}) : p),
        true
      )
    )
    .sort((a, b) =>
      sort.reduce<number>(
        (p, c) => (p == 0 ? sortReturnForCol(findCol(c.field), c, a, b) : p),
        0
      )
    );

const assemble = (
  data: DBRows,
  filters: Filter[],
  sort: Sort[],
  limit: number | undefined
): DBRows => applyAssemblyLimit(assembleFilterSort(data, filters, sort), limit);

// A pseudo-random row population that intentionally seeds DUPLICATE keys
// (same name, same score) and EMPTY cells, since the assembled set is keyed by
// position, not identity, and must survive both.
const makeRows = (rng: () => number, n: number): DBRows => {
  const rows: DBRows = [];
  for (let i = 0; i < n; i++) {
    // small value domains => frequent duplicate keys
    const name = String.fromCharCode(97 + randInt(rng, 0, 4)); // a..e
    const score =
      rng() < 0.15 ? "" : String(randInt(rng, 0, 6)); // some empty number cells
    rows.push({ _index: String(i), name, score });
  }
  return rows;
};

const rowsEqual = (a: DBRows, b: DBRows): boolean =>
  a.length === b.length &&
  a.every((r, i) => r._index === b[i]._index && r.name === b[i].name && r.score === b[i].score);

// ===========================================================================
// (A) COMPOSITION: filter -> sort -> limit is stable + idempotent under re-derive
// ===========================================================================
describe("assemble-before-paginate — filter/sort/limit composition is stable", () => {
  const NAME_ASC: Sort = { field: "name", fn: "alphabetical" };
  const SCORE_DESC: Sort = { field: "score", fn: "reverseNumber" };

  it("re-deriving the SAME inputs yields byte-for-byte the same assembled rows", () => {
    const rng = makeRng(0xa11ce);
    for (let run = 0; run < PROPERTY_RUNS; run++) {
      const data = makeRows(rng, randInt(rng, 0, 40));
      const filters: Filter[] =
        rng() < 0.5
          ? [{ field: "score", fn: "isGreatThan", value: "2", fType: "value" }]
          : [];
      const sort: Sort[] = rng() < 0.5 ? [NAME_ASC] : [SCORE_DESC];
      const limit = rng() < 0.3 ? randInt(rng, 0, 50) : 0;

      // Fresh copies each derive (the component re-runs the memo over `data`).
      const first = assemble(data.map((r) => ({ ...r })), filters, sort, limit);
      const second = assemble(data.map((r) => ({ ...r })), filters, sort, limit);
      expect(rowsEqual(first, second)).toBe(true);
    }
  });

  it("the assembled set is a SUBSEQUENCE of the input (membership ⊆, no rows invented)", () => {
    const rng = makeRng(0xbeef);
    for (let run = 0; run < PROPERTY_RUNS; run++) {
      const data = makeRows(rng, randInt(rng, 0, 30));
      const inputIds = new Set(data.map((r) => r._index));
      const filters: Filter[] = [
        { field: "name", fn: "include", value: rng() < 0.5 ? "a" : "", fType: "value" },
      ];
      const assembled = assemble(data, filters, [NAME_ASC], 0);
      // every assembled row came from the input; none invented
      for (const r of assembled) expect(inputIds.has(r._index)).toBe(true);
      // filtering only ever removes rows, never adds
      expect(assembled.length).toBeLessThanOrEqual(data.length);
    }
  });

  it("limit applied to the assembled set == first-N of the same assembled set (limit is a prefix view, not a re-sort)", () => {
    const rng = makeRng(0xc0ffee);
    for (let run = 0; run < PROPERTY_RUNS; run++) {
      const data = makeRows(rng, randInt(rng, 0, 40));
      const sort: Sort[] = rng() < 0.5 ? [NAME_ASC] : [SCORE_DESC];
      const limit = randInt(rng, 0, data.length + 5);

      const fullSorted = assembleFilterSort(data, [], sort);
      const limited = assemble(data, [], sort, limit);
      const expectedPrefix = limit > 0 ? fullSorted.slice(0, limit) : fullSorted;
      // the limited view is EXACTLY the first-N prefix of the assembled set —
      // it never reorders or re-filters, it only truncates the tail.
      expect(rowsEqual(limited, expectedPrefix)).toBe(true);
    }
  });

  it("survives an EMPTY data set and an all-duplicate-key data set without throwing", () => {
    expect(assemble([], [], [NAME_ASC], 0)).toEqual([]);
    expect(assemble([], [], [NAME_ASC], 10)).toEqual([]);

    const dupes: DBRows = Array.from({ length: 8 }, (_, i) => ({
      _index: String(i),
      name: "z",
      score: "3",
    }));
    const sorted = assemble(dupes, [], [NAME_ASC], 0);
    // all 8 duplicate-key rows are retained, in stable (positional) form
    expect(sorted.length).toBe(8);
    expect(new Set(sorted.map((r) => r._index)).size).toBe(8);
  });
});

// ===========================================================================
// (B) predicate.limit CLAMP — applyAssemblyLimit pins the inline render-path math
// ===========================================================================
describe("applyAssemblyLimit — predicate.limit clamping is total + pure", () => {
  const data: DBRows = Array.from({ length: 5 }, (_, i) => ({ _index: String(i) }));

  it("limit > 0 returns the first N rows (slice semantics)", () => {
    expect(applyAssemblyLimit(data, 3).map((r) => r._index)).toEqual(["0", "1", "2"]);
    expect(applyAssemblyLimit(data, 1).map((r) => r._index)).toEqual(["0"]);
  });

  it("limit 0 / negative / NaN / undefined all mean NO LIMIT (every row), matching `limit > 0 ? slice : base`", () => {
    // The original guard was `predicate?.limit > 0`. undefined > 0, NaN > 0,
    // -5 > 0, 0 > 0 are ALL false -> the inline code returned `base` (all rows).
    for (const limit of [0, -1, -9999, NaN, undefined as unknown as number]) {
      expect(applyAssemblyLimit(data, limit)).toBe(data); // same reference, all rows
    }
  });

  it("a HUGE limit clamps to the data (slice never over-reads)", () => {
    expect(applyAssemblyLimit(data, 1e9).map((r) => r._index)).toEqual([
      "0", "1", "2", "3", "4",
    ]);
    expect(applyAssemblyLimit(data, Number.MAX_SAFE_INTEGER).length).toBe(5);
    // Infinity > 0 is true, so it takes the slice path; slice(0, Infinity) == all.
    expect(applyAssemblyLimit(data, Infinity).length).toBe(5);
  });

  it("limiting NEVER mutates the input array (pure view)", () => {
    const rng = makeRng(0xd00d);
    for (let run = 0; run < PROPERTY_RUNS; run++) {
      const rows = makeRows(rng, randInt(rng, 0, 20));
      const before = rows.map((r) => r._index);
      const limit = randInt(rng, -5, rows.length + 5);
      const out = applyAssemblyLimit(rows, limit);
      // input untouched
      expect(rows.map((r) => r._index)).toEqual(before);
      // output is a prefix of the input (contiguous, in order)
      expect(out.map((r) => r._index)).toEqual(
        before.slice(0, limit > 0 ? limit : before.length)
      );
    }
  });

  it("limiting an empty set yields an empty set, never a throw", () => {
    expect(applyAssemblyLimit([], 10)).toEqual([]);
    expect(applyAssemblyLimit([], 0)).toEqual([]);
    expect(applyAssemblyLimit([], NaN)).toEqual([]);
  });
});

// ===========================================================================
// (C) 8h9 KEY INVARIANT — selectRowWindow: any [a,b) window is a PURE VIEW
// ===========================================================================
describe("selectRowWindow — row window is a pure view over the assembled set", () => {
  const makeSet = (n: number): DBRows =>
    Array.from({ length: n }, (_, i) => ({ _index: String(i) }));

  it("happy path: [start, end) is the in-order contiguous slice", () => {
    const set = makeSet(10);
    expect(selectRowWindow(set, 2, 5).map((r) => r._index)).toEqual(["2", "3", "4"]);
    expect(selectRowWindow(set, 0, 10).map((r) => r._index)).toEqual(
      set.map((r) => r._index)
    );
  });

  it("an EMPTY assembled set yields an EMPTY window for ANY bounds — never a throw", () => {
    for (const [a, b] of [
      [0, 0],
      [0, 5],
      [3, 1],
      [-2, 10],
      [NaN, NaN],
      [Infinity, Infinity],
    ]) {
      expect(selectRowWindow([], a, b)).toEqual([]);
    }
  });

  it("an inverted / out-of-range / non-finite window yields an empty or clamped slice, never a throw", () => {
    const set = makeSet(6);
    expect(selectRowWindow(set, 4, 2)).toEqual([]); // end <= start
    expect(selectRowWindow(set, 10, 20)).toEqual([]); // start past end
    expect(selectRowWindow(set, -5, 3).map((r) => r._index)).toEqual(["0", "1", "2"]);
    expect(selectRowWindow(set, 3, 999).map((r) => r._index)).toEqual(["3", "4", "5"]);
    expect(selectRowWindow(set, NaN, 3).map((r) => r._index)).toEqual(["0", "1", "2"]);
    expect(selectRowWindow(set, 2, NaN).map((r) => r._index)).toEqual(["2", "3", "4", "5"]);
    expect(selectRowWindow(set, 2.9, 5.1).map((r) => r._index)).toEqual(["2", "3", "4"]); // floored
  });

  it("PROPERTY: selecting any window never mutates or reorders the assembled set, and is always a contiguous subsequence", () => {
    const rng = makeRng(0x5eed);
    for (let run = 0; run < PROPERTY_RUNS; run++) {
      const n = randInt(rng, 0, 40);
      const set = makeSet(n);
      const snapshot = set.map((r) => r._index);
      const a = randInt(rng, -5, n + 5);
      const b = randInt(rng, -5, n + 5);
      const win = selectRowWindow(set, a, b);

      // PURE VIEW: the assembled set is byte-for-byte unchanged afterwards.
      expect(set.map((r) => r._index)).toEqual(snapshot);
      // SUBSEQUENCE: the window is a contiguous, in-order slice of the set.
      const safeStart = a > 0 ? Math.min(Math.floor(a), n) : 0;
      const safeEnd = Math.min(Math.max(Math.floor(b), safeStart), n);
      expect(win.map((r) => r._index)).toEqual(snapshot.slice(safeStart, safeEnd));
      // never longer than the set
      expect(win.length).toBeLessThanOrEqual(n);
    }
  });

  it("PROPERTY: a partition into consecutive windows reconstructs the assembled set exactly (no row lost or duplicated)", () => {
    const rng = makeRng(0xfade);
    for (let run = 0; run < PROPERTY_RUNS; run++) {
      const n = randInt(rng, 0, 50);
      const set = makeSet(n);
      // walk the set in random-sized consecutive windows and concatenate them
      const reassembled: string[] = [];
      let cursor = 0;
      while (cursor < n) {
        const step = randInt(rng, 1, 7);
        const win = selectRowWindow(set, cursor, cursor + step);
        for (const r of win) reassembled.push(r._index);
        cursor += step;
      }
      // the disjoint windows tile the assembled set exactly, in order
      expect(reassembled).toEqual(set.map((r) => r._index));
    }
  });

  it("the assembled-then-limited set viewed through a window equals limiting then windowing the same set (window ⟂ limit commute on a prefix)", () => {
    const rng = makeRng(0x1357);
    for (let run = 0; run < PROPERTY_RUNS; run++) {
      const n = randInt(rng, 0, 40);
      const set = makeSet(n);
      const limit = randInt(rng, 0, n + 3);
      const limited = applyAssemblyLimit(set, limit);
      const a = randInt(rng, 0, n);
      const b = randInt(rng, a, n);
      // A window over the LIMITED set is the same rows as windowing the full set
      // and intersecting with the limit prefix — both are pure prefix views, so
      // they agree wherever the window lies inside the limit.
      const effLen = limit > 0 ? Math.min(limit, n) : n;
      const winA = selectRowWindow(limited, a, Math.min(b, effLen)).map((r) => r._index);
      const winB = selectRowWindow(set, a, Math.min(b, effLen)).map((r) => r._index);
      expect(winA).toEqual(winB);
    }
  });
});
