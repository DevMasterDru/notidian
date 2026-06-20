// ===========================================================================
// Pure activation + row-windowing glue for the table's row virtualization
// (Notidian-8h9, the DEFAULT-ON kill-switch flag-gate). This module is the thin,
// DOM-free decision layer that sits between the proven pure window kernel
// (computeVirtualWindow, Notidian-mnuk) and the TableView render wiring:
//
//   - shouldVirtualizeTable: the single predicate that decides whether the ON
//     (windowed) branch runs. It is the chokepoint the kill-switch flows through
//     so the component never re-derives the rule inline. When it returns false,
//     TableView takes the byte-for-byte legacy pagination path.
//   - tableVirtualRowSlice: given the assembled rows and the live scroll/viewport
//     geometry, returns EXACTLY the contiguous slice of rows to mount plus the
//     padTop/padBottom spacer heights — by delegating the index math to
//     computeVirtualWindow, so the slice membership is provably the pure-seam
//     output (the property the jsdom wiring test asserts: rendered <tr> set ===
//     computeVirtualWindow's [startIndex, endIndex)).
//
// Keeping this pure means the only genuinely-unverifiable-offline part of 8h9 is
// the React/DOM plumbing in the component; the activation rule and the
// rows-to-mount selection are locked here with ordinary unit tests.
// ===========================================================================

import { computeVirtualWindow, VirtualWindow } from "./tableVirtualWindow";

// Default measured row height (px) for the uniform-row virtual window. Notidian
// table rows are a single line of ~13px text with cell padding; 36px is a safe
// estimate that slightly OVER-estimates so the window never under-fills the
// viewport (an over-estimate renders a few extra rows; an under-estimate could
// leave a gap at the bottom edge mid-scroll). The component refines this from a
// real measured row when one is mounted, but a sane constant keeps the very first
// paint correct before any measurement exists.
export const DEFAULT_TABLE_ROW_HEIGHT = 36;

// Rows rendered above and below the strictly-visible band so a fast scroll does
// not flash blank rows before React commits the next window. 8 each side covers
// a typical fling on a trackpad without inflating the mounted DOM materially.
export const DEFAULT_TABLE_OVERSCAN = 8;

/**
 * The kill-switch chokepoint: should the table render the windowed (virtualized)
 * body instead of the legacy paginated body?
 *
 * Virtualization is active only when the setting is ON. Grouping is explicitly
 * excluded: grouped/expanded row models interleave group-header rows and nested
 * sub-rows whose heights and indices are not the flat uniform-row model the
 * window kernel assumes, so a grouped table falls back to the legacy
 * (non-windowed) render even with the flag ON. This keeps the windowed path
 * strictly on the flat, uniform-height case it is correct for.
 */
export const shouldVirtualizeTable = ({
  enabled,
  isGrouped,
  hasSubItemAddRows,
}: {
  enabled: boolean;
  isGrouped: boolean;
  // Notidian-gr8t: the "+ New sub-item" affordance renders a SHORTER presentational
  // <tr> interleaved between data rows, which violates the uniform-row-height the
  // window kernel assumes. When such add-rows are present, fall back to the legacy
  // (non-windowed) render — a narrow, data-driven opt-out (only views with an
  // expanded parent), NOT a blanket suppression of the 8h9 perf win.
  hasSubItemAddRows?: boolean;
}): boolean => !!enabled && !isGrouped && !hasSubItemAddRows;

export interface TableVirtualRowSliceInput<TRow> {
  /** The fully assembled (filtered + sorted) row list — every row, no pagination. */
  rows: TRow[];
  /** Live scrollTop of the table's scroll container, in px. */
  scrollTop: number;
  /** Live clientHeight (visible height) of the scroll container, in px. */
  viewportHeight: number;
  /** Uniform row height estimate, in px. */
  rowHeight: number;
  /** Extra rows to render above/below the visible band. */
  overscan: number;
}

export interface TableVirtualRowSlice<TRow> {
  /** The contiguous slice of rows to mount, in original order. */
  rows: TRow[];
  /** Index in `rows` (the input array) of the first mounted row (inclusive). */
  startIndex: number;
  /** One past the index of the last mounted row (exclusive). */
  endIndex: number;
  /** Spacer height above the mounted slice, in px. */
  padTop: number;
  /** Spacer height below the mounted slice, in px. */
  padBottom: number;
}

/**
 * Select the exact rows to mount for the current scroll window. Delegates the
 * index/padding math to the proven computeVirtualWindow kernel and then slices
 * the assembled row array with the kernel's [startIndex, endIndex). The returned
 * slice membership is therefore, by construction, the pure-seam output — which is
 * exactly what the jsdom wiring test asserts against. Pure: no DOM, no React.
 */
export const tableVirtualRowSlice = <TRow>({
  rows,
  scrollTop,
  viewportHeight,
  rowHeight,
  overscan,
}: TableVirtualRowSliceInput<TRow>): TableVirtualRowSlice<TRow> => {
  const totalRows = Array.isArray(rows) ? rows.length : 0;
  const window: VirtualWindow = computeVirtualWindow({
    scrollTop,
    viewportHeight,
    rowHeight,
    overscan,
    totalRows,
  });
  return {
    rows: rows.slice(window.startIndex, window.endIndex),
    startIndex: window.startIndex,
    endIndex: window.endIndex,
    padTop: window.padTop,
    padBottom: window.padBottom,
  };
};
