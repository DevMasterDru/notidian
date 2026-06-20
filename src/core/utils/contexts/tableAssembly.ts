// ===========================================================================
// PURE OFFLINE SEAM for the table's ASSEMBLE-BEFORE-PAGINATE data path
// (Notidian-yjg3, locking the contract the Notidian-8h9 virtualization flag-gate
// must preserve byte-for-byte).
//
// The TableView derives -> joins -> filters -> sorts ALL rows into one assembled
// set (ContextEditorContext.tsx `filteredSortedData`/`filteredData` useMemo), and
// only THEN limits what reaches the DOM (predicate.limit, and — behind 8h9 —
// virtualization). Pagination/virtualization are presentation: they pick a WINDOW
// over the assembled set; they must never change its membership or order.
//
// Two pure kernels live here so that contract can be locked offline (no React, no
// jsdom, no @tanstack), mirroring the pure-seam pattern of tablePagination.ts and
// tableVirtualWindow.ts:
//
//   applyAssemblyLimit(rows, limit)  — the predicate.limit clamp. Extracted
//     verbatim from the inline `predicate?.limit > 0 ? base.slice(0, limit) : base`
//     so the limit math (negative / 0 / huge / NaN / undefined) is testable
//     without rendering, and identical byte-for-byte to what the render path ran.
//
//   selectRowWindow(rows, start, end)  — the PURE VIEW the virtualizer (8h9) and
//     any pagination consumer take over the assembled set: the [start, end) slice.
//     It is the formal statement of the 8h9 invariant — selecting any window is a
//     read-only projection that NEVER mutates, reorders, or changes the membership
//     of the assembled set, and an empty assembled set yields an empty window
//     rather than a throw.
//
// ADVERSARIAL CONTRACT (every input is corruption- and runtime-reachable — a
// forward-version predicate.limit of NaN/Infinity, a fling-scroll window past the
// end of content, a 0-row collapsed view — so both kernels are TOTAL: they never
// throw and never mutate their input array):
//
//   PURE VIEW      selectRowWindow / applyAssemblyLimit return a NEW array; the
//                  input `rows` array is never mutated (same reference, same
//                  length, same element order afterwards).
//   SUBSEQUENCE    the returned rows are a contiguous, in-order slice of `rows`
//                  (membership ⊆ rows, order preserved, no row invented/dropped
//                  out of order, duplicate-key rows kept by position not identity).
//   EMPTY-SAFE     an empty `rows` (or an out-of-range / inverted window) yields
//                  an empty array, never a throw and never `undefined`.
//   CLAMPED        a window/limit beyond the data is clamped to the data; a
//                  negative/NaN/non-positive limit means "no limit" (all rows),
//                  matching the historical render-path behavior exactly.
// ===========================================================================

/**
 * Apply the view's `predicate.limit` to the fully-assembled row set.
 *
 * This is the pure extraction of the render path's inline limit step
 * (ContextEditorContext.tsx: `predicate?.limit > 0 ? base.slice(0, limit) : base`).
 * Behavior is preserved EXACTLY so the assembled-set contract is unchanged:
 *
 *   - `limit > 0`  -> the first `limit` rows (`Array.prototype.slice`, which
 *     itself clamps a `limit` larger than the array to the whole array).
 *   - `limit <= 0`, `NaN`, `undefined`, or any non-finite value -> ALL rows
 *     (limit disabled). `undefined > 0` / `NaN > 0` are both `false`, so the
 *     original `predicate?.limit > 0` guard already returned every row here; this
 *     keeps that precise semantics.
 *
 * Pure + total: returns a NEW array when a limit applies, otherwise returns the
 * SAME `rows` reference unsliced — exactly as the inline render-path code did
 * (`return base;`), preserving reference identity so wiring this in is a no-op for
 * the render path. Never mutates `rows`, never throws.
 */
export const applyAssemblyLimit = <T>(
  rows: T[],
  limit: number | undefined
): T[] => {
  // `limit > 0` is false for undefined/NaN/negative/0 — the "no limit" path that
  // returns every assembled row, mirroring the render path's `if (limit > 0)`.
  if (typeof limit === "number" && limit > 0) {
    return rows.slice(0, limit);
  }
  return rows;
};

/**
 * Select the [start, end) WINDOW of the assembled set — the pure view a
 * virtualizer (Notidian-8h9) or paginator mounts. This is the formal lock on the
 * 8h9 invariant: choosing which rows to render is a read-only projection over the
 * assembled set and can NEVER change its membership or order.
 *
 * The bounds are sanitized so ANY caller geometry is safe (TOTAL kernel):
 *   - non-finite / negative `start` -> 0; `start` past the end -> end of data.
 *   - non-finite `end` -> end of data; `end` past the end -> end of data.
 *   - `end <= start` (inverted / empty window) -> empty array.
 *   - empty `rows` -> empty array (never a throw).
 *
 * Returns a NEW array (`slice`), so the assembled set is never mutated by the act
 * of viewing a window. Fractional bounds are floored to whole row indices.
 */
export const selectRowWindow = <T>(
  rows: readonly T[],
  start: number,
  end: number
): T[] => {
  const total = rows.length;
  // Clamp start into [0, total]; non-finite/negative -> 0.
  const safeStart =
    Number.isFinite(start) && start > 0 ? Math.min(Math.floor(start), total) : 0;
  // Clamp end into [safeStart, total]; non-finite -> total (show to the end).
  const safeEnd = Number.isFinite(end)
    ? Math.min(Math.max(Math.floor(end), safeStart), total)
    : total;
  return rows.slice(safeStart, safeEnd);
};
