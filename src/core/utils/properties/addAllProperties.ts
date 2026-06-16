import { SpaceProperty, SpaceTable } from "shared/types/mdb";

// ---------------------------------------------------------------------------
// One-click "Add all properties" (bd Notidian-r6oj, Part C).
//
// The new-property window can materialize EVERY discovered frontmatter property
// in one click. The discovery + persistence orchestration (readTable → saveTable
// → reloadContextByPath) lives in the menu component, but the load-bearing,
// offline-testable step — composing the next persisted column set — is this pure
// reducer, shared by the prominent top-level action and the buried
// "Existing Property → All" sub-menu option so the two can never drift.
//
// AUTHORITY (ADR 0001/0014/0017): `discovered` MUST be the output of
// `discoverFrontmatterPropertiesFromObserved`, which excludes already-persisted
// columns BY NAME and stamps each new column `source:"frontmatter"`. Because the
// existing computed/notidian columns are already in `table.cols` (and therefore
// in the exclusion set the caller passes to discovery), this reducer can only
// ever APPEND new frontmatter-sourced columns — it never re-types or re-sources
// an existing computed or notidian column. The materialize authority guard
// (materializeFrontmatterBackedContextTable) still holds: this path does not
// rewrite any stored column, it only adds genuinely-new ones.
// ---------------------------------------------------------------------------

// Compose the next context-table column set when adding all discovered
// frontmatter properties: the existing columns, then every discovered column
// appended in discovery order. Pure + total: returns a NEW table object with a
// NEW cols array, never mutating the input. Rows are passed through unchanged
// (the new frontmatter-backed columns derive their values from each file's
// frontmatter at render time — they carry no stored row values to seed).
export const buildAddAllPropertiesTable = (
  table: SpaceTable,
  discovered: SpaceProperty[]
): SpaceTable => ({
  ...table,
  cols: [...(table?.cols ?? []), ...(discovered ?? [])],
});
