import { DBRows } from "shared/types/mdb";
import { moveVisibleRows, rowDragSet } from "./tableRowOrder";

// ===========================================================================
// ADVERSARIAL + PROPERTY NET for the table multi-select drag-reorder engine
// (Notidian-p1rh). tableRowOrder.ts is a PURE engine (no DOM/IO) that permanently
// reorders vault rows on a multi-row drag — a row-order CORRUPTION surface: a
// single off-by-one in the SortableJS-style insert math, or a dropped/duplicated
// row in the visible<->absolute remap, silently rewrites the user's data file
// order. The existing tableRowOrder.test.ts is example-based; this file HARDENS
// the engine by (a) locking every guard/branch edge the examples miss and (b)
// running mulberry32-seeded property loops that prove the corruption-proof
// invariants over thousands of random multi-select drags.
//
// CHARACTERIZATION, NOT CORRECTION. Every assertion LOCKS the current observed
// behaviour (probed exhaustively against the live implementation — see the
// LINE-106 proof below); no production code is changed. This is a test-depth bead
// (no render-path change).
//
// CONVENTION: hand-rolled mulberry32 PRNG + PROPERTY_RUNS loop, NO fast-check
// dependency, matching src/core/utils/contexts/tableRollup.property.test.ts,
// tableCsv.test.ts and sanitizers.test.ts.
//
// INVARIANTS PROVEN over random inputs (the "no row-order corruption" contract):
//   PERMUTATION  output rows are a permutation of input rows — no loss, no dup,
//                identical multiset of row objects (by reference).
//   IDENTITY     changed === false  <=>  the returned rows are the SAME array
//                reference as the input (no allocation, no reorder).
//   IN-RANGE     every id in movedRowIds AND selectedRowIds is a valid in-range
//                row index "0".."rows.length-1".
//   REMAP-TRUTH  every returned selectedRowId points at the NEW absolute index of
//                a moved row (the moved row objects actually sit there).
//   OFF-VIEW-FIX rows outside visibleRowOrder keep their ABSOLUTE positions; only
//                the visible slots are repermuted (paginated/filtered-view safety).
//   BLOCK-ORDER  the moved block lands contiguously, in visibleRowOrder order.
// ===========================================================================

// --- tiny deterministic PRNG (no external dep) -----------------------------
// mulberry32: fast, well-distributed, fully deterministic 32-bit generator so
// property runs are reproducible across machines/CI without a fixture file.
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
const pick = <T>(rng: () => number, pool: readonly T[]): T =>
  pool[randInt(rng, 0, pool.length - 1)];
const PROPERTY_RUNS = 1200;

// Mirror of the engine's (post-fix) isValidRowId contract: a row id is valid IFF
// it is a CANONICAL non-negative decimal integer string that is in range. The
// test references must filter exactly as the engine does — using the loose
// `Number(id)`-only check (which accepts "" / " " / "1.0") would desync the
// reference from the engine and produce phantom mismatches.
const isCanonicalRowId = (id: string, length: number): boolean =>
  /^\d+$/.test(id) && Number(id) < length && String(Number(id)) === id;

// A row carries a UNIQUE marker so PERMUTATION / OFF-VIEW invariants can track each
// row object by identity through the reorder. We compare by reference, not value.
const makeRows = (n: number): DBRows =>
  Array.from({ length: n }, (_v, i) => ({ name: `R${i}` }));

// Fisher-Yates shuffle using the seeded rng (for permuted visibleRowOrder views —
// a view that has already been hand-reordered, the hardest case for the no-op guard).
const shuffle = <T>(rng: () => number, arr: readonly T[]): T[] => {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = randInt(rng, 0, i);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
};

// Build a random drag scenario: n rows, a visibleRowOrder that is a (possibly
// permuted) subset of the row ids, a random multi-selection, an active row drawn
// from the selection (or outside it), and an over target.
const buildScenario = (rng: () => number) => {
  const n = randInt(rng, 2, 9);
  const rows = makeRows(n);
  const allIds = Array.from({ length: n }, (_v, i) => String(i));

  // visibleRowOrder: a subset of ids. 50% of the time keep natural ascending
  // order (the common case), 50% permute it (a previously-reordered view).
  let visibleRowOrder: string[];
  if (rng() < 0.5) {
    visibleRowOrder = allIds.filter(() => rng() < 0.75);
  } else {
    visibleRowOrder = shuffle(
      rng,
      allIds.filter(() => rng() < 0.75)
    );
  }
  // Occasionally inject GARBAGE ids into the visible order + selection to exercise
  // the isValidRowId filters (out-of-range, non-integer, negative, empty).
  const garbage = ["99", "-1", "1.5", "x", "", "abc"];
  if (rng() < 0.4 && visibleRowOrder.length > 0) {
    const at = randInt(rng, 0, visibleRowOrder.length);
    visibleRowOrder = [
      ...visibleRowOrder.slice(0, at),
      pick(rng, garbage),
      ...visibleRowOrder.slice(at),
    ];
  }
  // Occasionally inject a DUPLICATE in-range canonical id (Notidian-p1rh): the
  // garbage pool above carries no in-range duplicate, so without this the net is
  // blind to the duplicate-visible-id corruption surface. A dup must NOT break the
  // PERMUTATION / IN-RANGE / REMAP-TRUTH invariants (engine dedups visibleIds).
  if (rng() < 0.4 && visibleRowOrder.length > 0) {
    const dupId = pick(rng, visibleRowOrder);
    const at = randInt(rng, 0, visibleRowOrder.length);
    visibleRowOrder = [
      ...visibleRowOrder.slice(0, at),
      dupId,
      ...visibleRowOrder.slice(at),
    ];
  }

  // selection: a random subset of the (valid) visible ids, sometimes salted with garbage.
  const validVisible = visibleRowOrder.filter(
    (id) => Number.isInteger(Number(id)) && Number(id) >= 0 && Number(id) < n
  );
  const selectedRowIds = validVisible.filter(() => rng() < 0.5);
  if (rng() < 0.3) selectedRowIds.push(pick(rng, garbage));

  // active: usually drawn from the selection (multi-drag), sometimes a lone valid
  // visible id (single-drag with active NOT in selection), sometimes garbage.
  let activeRowId: string;
  const activePool =
    selectedRowIds.length > 0 && rng() < 0.7
      ? selectedRowIds
      : validVisible.length > 0
      ? validVisible
      : allIds;
  activeRowId = pick(rng, activePool);
  if (rng() < 0.1) activeRowId = pick(rng, garbage);

  // over: usually a valid visible id, sometimes the active id (no-op), sometimes garbage.
  let overRowId =
    validVisible.length > 0 ? pick(rng, validVisible) : pick(rng, allIds);
  if (rng() < 0.15) overRowId = activeRowId;
  if (rng() < 0.1) overRowId = pick(rng, garbage);

  return { rows, visibleRowOrder, activeRowId, overRowId, selectedRowIds };
};

// =====================================================================
// rowDragSet — single vs multi drag, order-preserving + dedup.
// =====================================================================
describe("rowDragSet — drag block resolution (characterization)", () => {
  it("active NOT in selection -> drags ONLY the active row (ignores the selection)", () => {
    expect(rowDragSet(["0", "1", "2"], "1", ["0", "2"])).toEqual(["1"]);
  });

  it("active NOT in selection, empty selection -> [active]", () => {
    expect(rowDragSet(["0", "1", "2"], "2")).toEqual(["2"]);
  });

  it("active IN selection -> drags the selected block in visibleRowOrder order", () => {
    expect(rowDragSet(["0", "1", "2", "3"], "2", ["1", "2"])).toEqual([
      "1",
      "2",
    ]);
  });

  it("block follows visibleRowOrder order, NOT selection order", () => {
    // visible order is 3,1,2,0; selection is given out of order -> result follows visible.
    expect(rowDragSet(["3", "1", "2", "0"], "2", ["0", "2", "3"])).toEqual([
      "3",
      "2",
      "0",
    ]);
  });

  it("dedups duplicate selected ids", () => {
    expect(rowDragSet(["3", "1", "2", "0"], "2", ["2", "0", "2", "3"])).toEqual([
      "3",
      "2",
      "0",
    ]);
  });

  it("a selected id NOT present in the visible order is dropped from the block", () => {
    // "9" is selected and active is selected, but "9" is not in visibleRowOrder.
    expect(rowDragSet(["0", "1", "2"], "1", ["1", "9"])).toEqual(["1"]);
  });

  it("PROPERTY: result is always a dedup'd subsequence of visibleRowOrder (or [active])", () => {
    const rng = makeRng(0xd2a601);
    for (let run = 0; run < PROPERTY_RUNS; run++) {
      const n = randInt(rng, 1, 8);
      const ids = Array.from({ length: n }, (_v, i) => String(i));
      const visible = shuffle(rng, ids).filter(() => rng() < 0.8);
      const selected = visible.filter(() => rng() < 0.5);
      const active =
        visible.length > 0 ? pick(rng, visible) : pick(rng, ids);
      const out = rowDragSet(visible, active, selected);

      // No duplicates ever.
      expect(out.length).toBe(new Set(out).size);

      const selSet = new Set(selected);
      if (selSet.has(active)) {
        // multi-drag: exactly the selected ids that appear in the visible order,
        // in visible order.
        const expected = visible.filter((id) => selSet.has(id));
        // dedup expected (visible could in theory repeat — it does not here, but be safe)
        expect(out).toEqual([...new Set(expected)]);
        // strict subsequence of visibleRowOrder
        const positions = out.map((id) => visible.indexOf(id));
        expect(positions).toEqual([...positions].sort((a, b) => a - b));
      } else {
        // single-drag: just the active row.
        expect(out).toEqual([active]);
      }
    }
  });
});

// =====================================================================
// moveVisibleRows — GUARD edges (the uncovered return-unchanged branches).
// =====================================================================
describe("moveVisibleRows — guard short-circuits (characterization)", () => {
  const rows = makeRows(4);

  const expectUnchanged = (
    args: Parameters<typeof moveVisibleRows>[0]
  ) => {
    const r = moveVisibleRows(args);
    expect(r.changed).toBe(false);
    expect(r.rows).toBe(args.rows); // SAME reference — no allocation on no-op
    expect(r.movedRowIds).toEqual([]);
    expect(r.selectedRowIds).toEqual([]);
    return r;
  };

  it("active rowId out of range -> unchanged (line 55)", () => {
    expectUnchanged({
      rows,
      visibleRowOrder: ["0", "1", "2", "3"],
      activeRowId: "9",
      overRowId: "1",
    });
  });

  it("active rowId non-integer -> unchanged (line 55)", () => {
    expectUnchanged({
      rows,
      visibleRowOrder: ["0", "1", "2", "3"],
      activeRowId: "1.5",
      overRowId: "1",
    });
  });

  it("active rowId negative -> unchanged (line 55)", () => {
    expectUnchanged({
      rows,
      visibleRowOrder: ["0", "1", "2", "3"],
      activeRowId: "-1",
      overRowId: "1",
    });
  });

  it("over rowId out of range -> unchanged (line 55)", () => {
    expectUnchanged({
      rows,
      visibleRowOrder: ["0", "1", "2", "3"],
      activeRowId: "0",
      overRowId: "99",
    });
  });

  it("active === over -> unchanged (line 55)", () => {
    expectUnchanged({
      rows,
      visibleRowOrder: ["0", "1", "2", "3"],
      activeRowId: "1",
      overRowId: "1",
    });
  });

  it("active valid but NOT in visibleRowOrder -> unchanged (line 62)", () => {
    expectUnchanged({
      rows,
      visibleRowOrder: ["0", "1"],
      activeRowId: "2",
      overRowId: "1",
      selectedRowIds: ["2"],
    });
  });

  it("over valid but NOT in visibleRowOrder -> unchanged (line 62)", () => {
    expectUnchanged({
      rows,
      visibleRowOrder: ["0", "1"],
      activeRowId: "0",
      overRowId: "3",
      selectedRowIds: ["0"],
    });
  });

  it("over is INSIDE the dragged block -> unchanged (line 68)", () => {
    expectUnchanged({
      rows,
      visibleRowOrder: ["0", "1", "2", "3"],
      activeRowId: "0",
      overRowId: "2",
      selectedRowIds: ["0", "2"],
    });
  });

  it("empty rows -> every id is out of range -> unchanged", () => {
    const empty: DBRows = [];
    const r = moveVisibleRows({
      rows: empty,
      visibleRowOrder: ["0"],
      activeRowId: "0",
      overRowId: "1",
    });
    expect(r.changed).toBe(false);
    expect(r.rows).toBe(empty);
  });
});

// =====================================================================
// moveVisibleRows — insertIndex MATH edges (down vs up, straddle, end-clamp).
// =====================================================================
describe("moveVisibleRows — insert-position math (characterization)", () => {
  const rows = makeRows(6);
  const names = (rs: DBRows) => rs.map((r) => r.name);

  it("DOWNWARD single drag (draggedBeforeOver>0): lands AFTER over, not at end", () => {
    // drag R1 over R4. draggedBeforeOver=1, insertIndex = 4-1+1 = 4 (after R4).
    const r = moveVisibleRows({
      rows,
      visibleRowOrder: ["0", "1", "2", "3", "4", "5"],
      activeRowId: "1",
      overRowId: "4",
      selectedRowIds: ["1"],
    });
    expect(names(r.rows)).toEqual(["R0", "R2", "R3", "R4", "R1", "R5"]);
    expect(r.selectedRowIds).toEqual(["4"]);
    expect(r.movedRowIds).toEqual(["1"]);
  });

  it("UPWARD single drag (draggedBeforeOver==0): lands AT over's slot", () => {
    // drag R4 over R1. draggedBeforeOver=0, insertIndex = overIndex = 1.
    const r = moveVisibleRows({
      rows,
      visibleRowOrder: ["0", "1", "2", "3", "4", "5"],
      activeRowId: "4",
      overRowId: "1",
      selectedRowIds: ["4"],
    });
    expect(names(r.rows)).toEqual(["R0", "R4", "R1", "R2", "R3", "R5"]);
    expect(r.selectedRowIds).toEqual(["1"]);
  });

  it("DOWNWARD block drag: contiguous block lands after over (block-order preserved)", () => {
    // drag {1,2,3} over R4. draggedBeforeOver=3, insertIndex = 4-3+1 = 2.
    const r = moveVisibleRows({
      rows,
      visibleRowOrder: ["0", "1", "2", "3", "4", "5"],
      activeRowId: "2",
      overRowId: "4",
      selectedRowIds: ["1", "2", "3"],
    });
    expect(names(r.rows)).toEqual(["R0", "R4", "R1", "R2", "R3", "R5"]);
    expect(r.selectedRowIds).toEqual(["2", "3", "4"]);
    expect(r.movedRowIds).toEqual(["1", "2", "3"]);
  });

  it("STRADDLE: dragged rows on BOTH sides of over (non-contiguous block)", () => {
    // drag {0,4} (0 above over, 4 below over), over R2. draggedBeforeOver=1.
    // insertIndex = 2-1+1 = 2. remaining=[1,2,3,5]; slice(0,2)=[1,2] + [0,4] + [3,5].
    const r = moveVisibleRows({
      rows,
      visibleRowOrder: ["0", "1", "2", "3", "4", "5"],
      activeRowId: "0",
      overRowId: "2",
      selectedRowIds: ["0", "4"],
    });
    expect(names(r.rows)).toEqual(["R1", "R2", "R0", "R4", "R3", "R5"]);
    // moved block {0,4} now occupies absolute indices 2 and 3.
    expect(r.selectedRowIds).toEqual(["2", "3"]);
    expect(r.movedRowIds).toEqual(["0", "4"]);
  });

  it("END-CLAMP (Math.min): dropping the block at the very last row clamps insertIndex", () => {
    // drag {0,1} over R5 (last). draggedBeforeOver=2, insertIndex would be 5-2+1=4,
    // remaining=[2,3,4,5] has length 4, so Math.min(4,4)=4 -> block at the very end.
    const r = moveVisibleRows({
      rows,
      visibleRowOrder: ["0", "1", "2", "3", "4", "5"],
      activeRowId: "0",
      overRowId: "5",
      selectedRowIds: ["0", "1"],
    });
    expect(names(r.rows)).toEqual(["R2", "R3", "R4", "R5", "R0", "R1"]);
    expect(r.selectedRowIds).toEqual(["4", "5"]);
  });

  it("END-CLAMP single: drag first row to last lands it at the end", () => {
    const r = moveVisibleRows({
      rows,
      visibleRowOrder: ["0", "1", "2", "3", "4", "5"],
      activeRowId: "0",
      overRowId: "5",
      selectedRowIds: ["0"],
    });
    expect(names(r.rows)).toEqual(["R1", "R2", "R3", "R4", "R5", "R0"]);
    expect(r.selectedRowIds).toEqual(["5"]);
  });
});

// =====================================================================
// moveVisibleRows — SUBSET (paginated/filtered) view: off-view rows stay fixed.
// =====================================================================
describe("moveVisibleRows — strict-subset visible view (characterization)", () => {
  const names = (rs: DBRows) => rs.map((r) => r.name);

  it("only visible slots are repermuted; off-view rows keep absolute positions", () => {
    // rows R0..R5. visible = absolute indices 1,3,5. Move R1 (visible head) to over R5.
    const rows = makeRows(6);
    const r = moveVisibleRows({
      rows,
      visibleRowOrder: ["1", "3", "5"],
      activeRowId: "1",
      overRowId: "5",
      selectedRowIds: ["1"],
    });
    // visible new order = [R3, R5, R1]; they fill absolute slots 1,3,5 in that order.
    // off-view R0,R2,R4 stay at slots 0,2,4.
    expect(names(r.rows)).toEqual(["R0", "R3", "R2", "R5", "R4", "R1"]);
    // R1 moved to absolute slot 5.
    expect(r.selectedRowIds).toEqual(["5"]);
    expect(r.movedRowIds).toEqual(["1"]);
  });

  it("garbage ids in visibleRowOrder are filtered before any math", () => {
    const rows = makeRows(4);
    const r = moveVisibleRows({
      rows,
      visibleRowOrder: ["0", "x", "1", "99", "2", "-1", "3"],
      activeRowId: "1",
      overRowId: "3",
      selectedRowIds: ["1", "abc"],
    });
    // valid visible = [0,1,2,3]; drag R1 down over R3 -> [R0,R2,R3,R1].
    expect(names(r.rows)).toEqual(["R0", "R2", "R3", "R1"]);
    expect(r.selectedRowIds).toEqual(["3"]);
  });

  // --- REGRESSION (Notidian-p1rh) -----------------------------------------
  // isValidRowId used to be `Number.isInteger(Number(id)) && 0<=id<len`, but
  // Number("")===0 (also " ", "00", "1.0", "+1", " 2 " coerce), so an EMPTY or
  // non-canonical id in visibleRowOrder was mistaken for a valid alias of row 0.
  // That polluted the visible set with a phantom id whose key was absent from the
  // canonical (index.toString()) index->row map, so the remap pulled `undefined`
  // and CRASHED on `.originalRowId` — a hard corruption of the row-reorder path.
  // The property net (TOTAL) surfaced it; this pins the exact minimal trigger.
  it("REGRESSION: an empty-string id in visibleRowOrder must not crash or alias row 0", () => {
    const rows = makeRows(8);
    let result: ReturnType<typeof moveVisibleRows> | undefined;
    expect(() => {
      result = moveVisibleRows({
        rows,
        visibleRowOrder: ["7", "3", "4", "1", "", "5", "2", "6"],
        activeRowId: "2",
        overRowId: "3",
        selectedRowIds: ["5", "2"],
      });
    }).not.toThrow();
    // The "" is dropped (not treated as row 0); result is a clean permutation.
    expect(result!.rows.length).toBe(8);
    expect(new Set(result!.rows).size).toBe(8);
    for (const row of result!.rows) expect(rows.includes(row)).toBe(true);
  });

  // --- REGRESSION (Notidian-p1rh, duplicate-canonical-id corruption) -------
  // The non-canonical-alias fix closed ONE Set-vs-array desync; a DUPLICATE
  // CANONICAL id in visibleRowOrder is the SAME class of desync. visibleIds was
  // filtered for validity but NOT deduped, so `visibleSet = new Set(visibleIds)`
  // collapsed the duplicate to one slot while nextVisibleIds/nextVisibleRows kept
  // BOTH copies; the visibleCursor++ walk then under-consumed nextVisibleRows,
  // DROPPING one row and DUPLICATING another — a silent corruption of the user's
  // row order. Fix: dedup visibleIds (keep first occurrence), matching rowDragSet.
  it("REGRESSION: a DUPLICATE canonical id in visibleRowOrder must not drop/duplicate a row", () => {
    const rows = makeRows(4);
    // visible repeats "1"; drag R0 down over R3.
    const r = moveVisibleRows({
      rows,
      visibleRowOrder: ["0", "1", "1", "2", "3"],
      activeRowId: "0",
      overRowId: "3",
      selectedRowIds: ["0"],
    });
    // Clean permutation — every input row present exactly once, none undefined.
    expect(r.rows.length).toBe(4);
    expect(new Set(r.rows).size).toBe(4);
    for (const row of r.rows) expect(rows.includes(row)).toBe(true);
    // Drag R0 to after R3 (collapsed view [0,1,2,3]) -> [R1,R2,R3,R0].
    expect(r.rows.map((row) => row.name)).toEqual(["R1", "R2", "R3", "R0"]);
    expect(r.movedRowIds).toEqual(["0"]);
    expect(r.selectedRowIds).toEqual(["3"]);
  });

  it("REGRESSION: a DUPLICATE canonical id in a MULTI-SELECT drag stays a permutation", () => {
    const rows = makeRows(5);
    // visible repeats "2"; drag block {0,1} down over R4.
    const r = moveVisibleRows({
      rows,
      visibleRowOrder: ["0", "1", "2", "2", "3", "4"],
      activeRowId: "0",
      overRowId: "4",
      selectedRowIds: ["0", "1"],
    });
    expect(r.rows.length).toBe(5);
    expect(new Set(r.rows).size).toBe(5);
    for (const row of r.rows) expect(rows.includes(row)).toBe(true);
    // collapsed view [0,1,2,3,4]; move {0,1} after R4 -> [R2,R3,R4,R0,R1].
    expect(r.rows.map((row) => row.name)).toEqual(["R2", "R3", "R4", "R0", "R1"]);
    expect(r.movedRowIds).toEqual(["0", "1"]);
    // moved block now at absolute slots 3,4.
    expect(r.selectedRowIds).toEqual(["3", "4"]);
  });

  it("REGRESSION: non-canonical numeric aliases ('00','1.0','+1',' 2 ') are all rejected", () => {
    const rows = makeRows(3);
    // Each of these coerces via Number() to an in-range integer but is NOT the
    // canonical id, so it must be filtered out of the visible projection. With all
    // visible ids non-canonical, there is nothing to reorder -> unchanged.
    const r = moveVisibleRows({
      rows,
      visibleRowOrder: ["00", "1.0", "+1", " 2 ", ""],
      activeRowId: "0",
      overRowId: "1",
      selectedRowIds: ["0"],
    });
    // activeRowId "0" is canonical/valid, but it is NOT in the (now empty) visible
    // projection -> guarded as unchanged (line 62).
    expect(r.changed).toBe(false);
    expect(r.rows).toBe(rows);
  });
});

// =====================================================================
// LINE-106 NO-OP GUARD — proven defensively unreachable, locked as such.
// =====================================================================
describe("moveVisibleRows — post-recompute no-op guard (line 106)", () => {
  it("EXHAUSTIVE PROOF: across ALL permuted visible orders + ALL selections, the early guards catch every no-op; line 106 never fires", () => {
    // The guard at line 106-107 returns `unchanged` when, after the SortableJS-style
    // remove+reinsert, nextVisibleIds equals visibleIds. We prove this is DEAD code
    // given the earlier guards (activeRowId != overRowId AND over not in the dragged
    // block): once those hold, the reinsert ALWAYS produces a genuinely different
    // order. Proof by exhaustion over n=5: every permutation of the visible order,
    // every non-empty selection, every active-in-selection, every over.
    const permute = (arr: string[]): string[][] => {
      if (arr.length <= 1) return [arr];
      const res: string[][] = [];
      for (let i = 0; i < arr.length; i++) {
        const rest = [...arr.slice(0, i), ...arr.slice(i + 1)];
        for (const p of permute(rest)) res.push([arr[i], ...p]);
      }
      return res;
    };
    const n = 5;
    const rows = makeRows(n);
    const ids = Array.from({ length: n }, (_v, i) => String(i));

    let total = 0;
    let unchanged = 0;
    let line106Fires = 0;

    for (const vis of permute(ids)) {
      for (let mask = 1; mask < 1 << n; mask++) {
        const sel = vis.filter((_id, i) => mask & (1 << i));
        for (const active of sel) {
          for (const over of vis) {
            if (over === active) continue;
            total++;
            const r = moveVisibleRows({
              rows,
              visibleRowOrder: vis,
              activeRowId: active,
              overRowId: over,
              selectedRowIds: sel,
            });
            if (!r.changed) {
              unchanged++;
              // Was this no-op caused by line 106, or by an EARLIER guard?
              // Reconstruct the dragged block exactly as the engine does.
              const selSet = new Set(sel);
              const dragged = selSet.has(active)
                ? vis.filter((id) => selSet.has(id))
                : [active];
              const caughtEarly =
                active === over || dragged.includes(over) || dragged.length === 0;
              if (!caughtEarly) line106Fires++;
            }
          }
        }
      }
    }

    // Sanity: the loop actually exercised the engine and hit no-op cases via the
    // early guards (so this is a real proof, not a vacuous one).
    expect(total).toBeGreaterThan(10000);
    expect(unchanged).toBeGreaterThan(0);
    // The load-bearing assertion: line 106 is NEVER the reason for a no-op.
    expect(line106Fires).toBe(0);
  });
});

// =====================================================================
// THE CORRUPTION-PROOF PROPERTY NET — seeded random multi-select drags.
// =====================================================================
describe("moveVisibleRows — corruption-proof invariants (property)", () => {
  it("PERMUTATION: output rows are always a permutation of input rows (no loss, no dup)", () => {
    const rng = makeRng(0xc0de01);
    for (let run = 0; run < PROPERTY_RUNS; run++) {
      const s = buildScenario(rng);
      const r = moveVisibleRows(s);
      // Same length.
      expect(r.rows.length).toBe(s.rows.length);
      // Same multiset of row OBJECTS by reference (Set sizes match input set,
      // and every output row is one of the input rows — so it is a bijection).
      const inputSet = new Set(s.rows);
      const outputSet = new Set(r.rows);
      expect(outputSet.size).toBe(inputSet.size);
      for (const row of r.rows) expect(inputSet.has(row)).toBe(true);
      // No row object appears twice in the output (no duplication).
      expect(outputSet.size).toBe(r.rows.length);
    }
  });

  it("IDENTITY: changed===false IFF the rows array is returned by reference unchanged", () => {
    const rng = makeRng(0xc0de02);
    for (let run = 0; run < PROPERTY_RUNS; run++) {
      const s = buildScenario(rng);
      const r = moveVisibleRows(s);
      if (!r.changed) {
        // No-op path returns the SAME array reference (zero allocation).
        expect(r.rows).toBe(s.rows);
        expect(r.movedRowIds).toEqual([]);
        expect(r.selectedRowIds).toEqual([]);
      } else {
        // A genuine change always returns a FRESH array (never the input ref).
        expect(r.rows).not.toBe(s.rows);
        // CHARACTERIZATION: `changed` tracks the VISIBLE-PROJECTION order, not the
        // absolute rows array. In a custom-ordered subset (paginated) view, a drag
        // can reorder the visible projection while each moved row coincidentally
        // re-lands in its own ABSOLUTE slot, so `changed===true` does NOT imply the
        // absolute rows order differs. We assert only the strong direction
        // (changed===false => identical reference, above); the absolute order MAY be
        // unchanged here, which is correct for a re-projected view.
      }
    }
  });

  it("IN-RANGE: every movedRowId and selectedRowId is a valid in-range index", () => {
    const rng = makeRng(0xc0de03);
    for (let run = 0; run < PROPERTY_RUNS; run++) {
      const s = buildScenario(rng);
      const r = moveVisibleRows(s);
      const inRange = (id: string) => {
        const i = Number(id);
        return Number.isInteger(i) && i >= 0 && i < r.rows.length;
      };
      for (const id of r.movedRowIds) expect(inRange(id)).toBe(true);
      for (const id of r.selectedRowIds) expect(inRange(id)).toBe(true);
      // movedRowIds and selectedRowIds describe the SAME number of moved rows.
      expect(r.selectedRowIds.length).toBe(r.movedRowIds.length);
      // No duplicate indices in either list.
      expect(new Set(r.movedRowIds).size).toBe(r.movedRowIds.length);
      expect(new Set(r.selectedRowIds).size).toBe(r.selectedRowIds.length);
    }
  });

  it("REMAP-TRUTH: each returned selectedRowId points at the NEW absolute index of a moved row", () => {
    const rng = makeRng(0xc0de04);
    for (let run = 0; run < PROPERTY_RUNS; run++) {
      const s = buildScenario(rng);
      const r = moveVisibleRows(s);
      if (!r.changed) continue;
      // The moved rows are the input rows at the movedRowIds (original) indices.
      const movedRowObjects = new Set(
        r.movedRowIds.map((id) => s.rows[Number(id)])
      );
      // selectedRowIds must index EXACTLY those row objects in the OUTPUT.
      const pointedAt = new Set(
        r.selectedRowIds.map((id) => r.rows[Number(id)])
      );
      expect(pointedAt).toEqual(movedRowObjects);
    }
  });

  it("OFF-VIEW-FIX: rows outside the visible set keep their absolute positions", () => {
    const rng = makeRng(0xc0de05);
    for (let run = 0; run < PROPERTY_RUNS; run++) {
      const s = buildScenario(rng);
      const r = moveVisibleRows(s);
      if (!r.changed) continue;
      // Recompute the valid visible absolute index set exactly as the engine does.
      const visibleSet = new Set(
        s.visibleRowOrder.filter((id) => isCanonicalRowId(id, s.rows.length))
      );
      // For every absolute index NOT in the visible set, the row object is untouched.
      for (let i = 0; i < s.rows.length; i++) {
        if (!visibleSet.has(String(i))) {
          expect(r.rows[i]).toBe(s.rows[i]);
        }
      }
      // And the set of absolute slots occupied by visible rows is itself unchanged —
      // only their ORDER among those slots may differ.
      const visibleAbsSlots = [...visibleSet].map((id) => Number(id)).sort((a, b) => a - b);
      for (const slot of visibleAbsSlots) {
        // the output row at a visible slot must be one of the original visible rows.
        const originalVisibleRows = new Set(
          [...visibleSet].map((id) => s.rows[Number(id)])
        );
        expect(originalVisibleRows.has(r.rows[slot])).toBe(true);
      }
    }
  });

  it("BLOCK-ORDER: the moved block is contiguous in the visible projection, in visibleRowOrder order", () => {
    const rng = makeRng(0xc0de06);
    for (let run = 0; run < PROPERTY_RUNS; run++) {
      const s = buildScenario(rng);
      const r = moveVisibleRows(s);
      if (!r.changed) continue;
      // Project the OUTPUT rows back onto just the visible absolute slots, in slot order.
      const visibleValid = s.visibleRowOrder.filter((id) =>
        isCanonicalRowId(id, s.rows.length)
      );
      const visibleSlots = [...new Set(visibleValid.map((id) => Number(id)))].sort(
        (a, b) => a - b
      );
      const movedSet = new Set(r.movedRowIds.map((id) => s.rows[Number(id)]));
      // Indices (within the visible projection) where moved rows now sit.
      const positions = visibleSlots
        .map((slot, idx) => ({ idx, row: r.rows[slot] }))
        .filter(({ row }) => movedSet.has(row))
        .map(({ idx }) => idx);
      // Contiguous: positions form a run with no gaps.
      for (let k = 1; k < positions.length; k++) {
        expect(positions[k]).toBe(positions[k - 1] + 1);
      }
      // Block order follows visibleRowOrder: the moved rows, read in their new slot
      // order, equal the dragged block computed by rowDragSet.
      const draggedIds = rowDragSet(
        visibleValid,
        s.activeRowId,
        s.selectedRowIds
      ).filter((id) => isCanonicalRowId(id, s.rows.length));
      const draggedRowsInOrder = draggedIds.map((id) => s.rows[Number(id)]);
      const movedRowsInNewSlotOrder = visibleSlots
        .map((slot) => r.rows[slot])
        .filter((row) => movedSet.has(row));
      expect(movedRowsInNewSlotOrder).toEqual(draggedRowsInOrder);
    }
  });

  it("STABLE: same input -> identical result across repeated calls (pure/deterministic)", () => {
    const rng = makeRng(0xc0de07);
    for (let run = 0; run < PROPERTY_RUNS; run++) {
      const s = buildScenario(rng);
      const a = moveVisibleRows(s);
      const b = moveVisibleRows(s);
      expect(a.changed).toBe(b.changed);
      expect(a.rows.map((r) => r.name)).toEqual(b.rows.map((r) => r.name));
      expect(a.movedRowIds).toEqual(b.movedRowIds);
      expect(a.selectedRowIds).toEqual(b.selectedRowIds);
    }
  });

  it("READ-ONLY: never mutates the input rows array or any row object", () => {
    const rng = makeRng(0xc0de08);
    for (let run = 0; run < PROPERTY_RUNS; run++) {
      const s = buildScenario(rng);
      const inputSnapshot = s.rows.map((r) => ({ ...r }));
      const inputOrderSnapshot = [...s.rows];
      const visBefore = [...s.visibleRowOrder];
      const selBefore = [...s.selectedRowIds];
      moveVisibleRows(s);
      // Input rows array order is untouched.
      expect(s.rows).toEqual(inputOrderSnapshot);
      // Each row object is value-unchanged.
      for (let i = 0; i < s.rows.length; i++) {
        expect(s.rows[i]).toEqual(inputSnapshot[i]);
        // and the SAME object reference (engine never clones a row).
        expect(s.rows[i]).toBe(inputOrderSnapshot[i]);
      }
      // Input args are untouched.
      expect(s.visibleRowOrder).toEqual(visBefore);
      expect(s.selectedRowIds).toEqual(selBefore);
    }
  });

  it("TOTAL: never throws on any seeded multi-select drag", () => {
    const rng = makeRng(0xc0de09);
    for (let run = 0; run < PROPERTY_RUNS; run++) {
      const s = buildScenario(rng);
      expect(() => moveVisibleRows(s)).not.toThrow();
    }
  });
});
