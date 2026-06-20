// ===========================================================================
// PURE OFFLINE SEAM for table row virtualization (Notidian-mnuk, ahead of the
// Notidian-8h9 default-ON virtualization flag-gate).
//
// computeVirtualWindow is a PURE, DOM-free, React-free function that turns a
// scroll position + viewport geometry into the [startIndex, endIndex) slice of
// rows that must be rendered, plus the top/bottom spacer heights (padTop /
// padBottom) that hold the scrollbar at full content size while only the visible
// slice is mounted. It mirrors the pure-seam pattern of tablePagination.ts so the
// 8h9 render-path wiring sits on a proven, offline-verifiable kernel: TableView
// will call this to decide which rows to mount and how tall the spacers are; the
// math lives here where it can be locked with adversarial + property tests with
// no jsdom and no @tanstack/react-virtual.
//
// ADVERSARIAL CONTRACT (every input is corruption- and runtime-reachable — a
// ResizeObserver mid-layout, a fling-scroll past content, a 0-height collapsed
// pane, a NaN from an unmeasured row — so the kernel is TOTAL: it never throws,
// never returns NaN/Infinity, and always satisfies the structural invariants):
//
//   IN-RANGE      0 <= startIndex <= endIndex <= safeTotalRows, and the slice is
//                 empty (start === end === 0) IFF there are no rows to show.
//   CONSERVATION  padTop + visibleHeight + padBottom === safeTotalRows * rowHeight
//                 EXACTLY (all three derive from the same sanitized integers, so
//                 the scrollbar never drifts from true content height).
//   NON-NEGATIVE  padTop >= 0, padBottom >= 0, and every output field is finite.
//   MONOTONIC     startIndex (and endIndex) are non-decreasing in scrollTop — the
//                 window only ever advances as the user scrolls down, never
//                 jitters backward, because every transform (clamp, floor, ceil,
//                 minus-constant, clamp) is monotonic.
// ===========================================================================

export interface VirtualWindowInput {
  /** Pixels scrolled from the top of the scroll container. */
  scrollTop: number;
  /** Visible height of the scroll viewport in pixels. */
  viewportHeight: number;
  /** Height of a single row in pixels (uniform-row model). */
  rowHeight: number;
  /** Extra rows to render above and below the strictly-visible band. */
  overscan: number;
  /** Total number of rows in the (assembled) data set. */
  totalRows: number;
}

export interface VirtualWindow {
  /** First row index to render (inclusive), in [0, totalRows]. */
  startIndex: number;
  /** One past the last row index to render (exclusive), in [startIndex, totalRows]. */
  endIndex: number;
  /** Spacer height above the rendered slice, in pixels (= startIndex * rowHeight). */
  padTop: number;
  /** Spacer height below the rendered slice, in pixels (= (totalRows - endIndex) * rowHeight). */
  padBottom: number;
}

// Fallback row height when the caller's value is non-finite or <= 0. A virtual
// window with a non-positive row height is meaningless (every row would occupy
// zero/NaN space and the division below would blow up), so we substitute a sane
// positive height rather than throw — the kernel must stay total. Callers should
// pass a real measured/estimated height; this only guards corrupt inputs.
export const DEFAULT_VIRTUAL_ROW_HEIGHT = 1;

// Hard ceiling on totalRows so a corrupt Infinity/huge value can never produce a
// non-finite content height (Infinity * rowHeight) and break the conservation
// invariant. 1e7 rows is far beyond any real Notidian context and still keeps
// every product below Number.MAX_SAFE_INTEGER for sane row heights.
const MAX_VIRTUAL_ROWS = 10_000_000;

/** Floor a value to a non-negative integer, mapping NaN/Infinity/negatives to 0. */
const toCount = (value: number, max: number): number => {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.min(Math.floor(value), max);
};

/** Coerce to a finite, non-negative pixel value (NaN/Infinity/negatives -> 0). */
const toPixels = (value: number): number => {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return value;
};

/**
 * Compute the visible-row window {startIndex, endIndex, padTop, padBottom} from a
 * scroll position and viewport geometry. Pure: no React, no DOM, no I/O. Total:
 * returns a structurally valid window for ANY input (see ADVERSARIAL CONTRACT).
 */
export const computeVirtualWindow = ({
  scrollTop,
  viewportHeight,
  rowHeight,
  overscan,
  totalRows,
}: VirtualWindowInput): VirtualWindow => {
  // --- sanitize every input into a clean, finite, in-domain value -----------
  const safeTotalRows = toCount(totalRows, MAX_VIRTUAL_ROWS);

  // Empty data set: the window is empty and there is nothing to pad. Returning
  // here keeps the IN-RANGE invariant (empty slice IFF no rows) crisp and avoids
  // any 0-row edge in the index math below.
  if (safeTotalRows === 0) {
    return { startIndex: 0, endIndex: 0, padTop: 0, padBottom: 0 };
  }

  const safeRowHeight =
    Number.isFinite(rowHeight) && rowHeight > 0
      ? rowHeight
      : DEFAULT_VIRTUAL_ROW_HEIGHT;
  const safeViewportHeight = toPixels(viewportHeight);
  const safeOverscan = toCount(overscan, MAX_VIRTUAL_ROWS);

  const contentHeight = safeTotalRows * safeRowHeight;
  // Clamp scrollTop into [0, maxScroll]. Clamping is monotonic non-decreasing in
  // the raw scrollTop, which is what preserves the MONOTONIC invariant even when
  // the caller flings past the end of the content (scrollTop > contentHeight).
  const maxScroll = Math.max(0, contentHeight - safeViewportHeight);
  const safeScrollTop = Number.isFinite(scrollTop)
    ? Math.min(Math.max(scrollTop, 0), maxScroll)
    : 0;

  const lastRowIndex = safeTotalRows - 1;

  // First strictly-visible row, then pull back by the overscan band. floor/clamp
  // and the constant subtraction are all monotonic in safeScrollTop.
  const firstVisible = Math.floor(safeScrollTop / safeRowHeight);
  const startIndex = Math.min(
    Math.max(firstVisible - safeOverscan, 0),
    lastRowIndex
  );

  // One past the last strictly-visible row, then push out by the overscan band.
  // ceil of the bottom edge gives the exclusive end; clamp into [startIndex+1,
  // totalRows] so the slice is always non-empty when rows exist and never spills
  // past the data.
  const lastVisible = Math.ceil(
    (safeScrollTop + safeViewportHeight) / safeRowHeight
  );
  const endIndex = Math.min(
    Math.max(lastVisible + safeOverscan, startIndex + 1),
    safeTotalRows
  );

  // padTop / visibleHeight / padBottom all derive from the SAME sanitized
  // integers and rowHeight, so their sum is exactly safeTotalRows * safeRowHeight
  // by construction (CONSERVATION) and each is finite and non-negative.
  const padTop = startIndex * safeRowHeight;
  const padBottom = (safeTotalRows - endIndex) * safeRowHeight;

  return { startIndex, endIndex, padTop, padBottom };
};
