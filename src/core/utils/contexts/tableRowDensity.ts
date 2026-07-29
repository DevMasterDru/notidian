import type { TableRowDensity } from "shared/types/predicate";

// H3 density mode (Notidian-pb7p.3 / Atlas ADR-0096 D1). Hub tabs are dense,
// mission-focused pages; "compact" tightens row height and cell padding so more
// rows fit the fold. Per view, persisted in the predicate beside the other
// view-shape knobs — no new data authority.
export const defaultTableRowDensity: TableRowDensity = "normal";

export const tableRowDensities: TableRowDensity[] = ["normal", "compact"];

export const tableRowDensityForValue = (value?: unknown): TableRowDensity =>
  tableRowDensities.includes(value as TableRowDensity)
    ? (value as TableRowDensity)
    : defaultTableRowDensity;

// Null for the default so an untouched view emits exactly the legacy DOM —
// the compact styling is opt-in and additive.
export const tableRowDensityClass = (value?: unknown): string | null =>
  tableRowDensityForValue(value) == "compact" ? "mk-table--compact" : null;
