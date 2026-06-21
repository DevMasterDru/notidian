import { defaultContextSchemaID } from "shared/schemas/context";
import { SpaceTableColumn } from "shared/types/mdb";

// Single CONSUMPTION gate for an already-persisted sub-items config (bd
// Notidian-8k9b). The FilterBar designate menu and the row-menu "Add sub-item"
// entry points are now hidden off the primary files schema, but a predicate
// written BEFORE that gate (the pre-fix designate path was ungated for any
// schema — verified at 65d32aa^) still carries `subItems.field` on a non-primary
// db table. Every sub-items consumer (tree render, chevron/indent, inline
// "+ New sub-item", delete subtree, inline create) derives SOLELY from the
// resolved parent-link column, so resolving that column to null off-primary
// neutralizes the entire dead surface in one place.
//
// Why a consumption gate (not a validation-time drop): it mirrors the
// materialization authority exactly — filesystemAdapter.syncContextRow writes a
// child's parent link back into its row ONLY for schema == defaultContextSchemaID
// (the "files" primary table), so a parent column can only ever round-trip into a
// tree there. Refusing to consume the config off-primary is symmetric with
// refusing to materialize it, and (unlike rewriting the stored predicate on read)
// it preserves the config byte-identically should the schema ever be primary
// again — honoring ADR 0050's "stored predicates round-trip byte-identical".
//
// Returns the live parent-link column (so the data key `name+table` matches the
// relations/rollup runtime), or null when sub-items is off, the field no longer
// resolves to a column, or the schema can't materialize the tree.
export const resolveSubItemsCol = (
  field: string | null | undefined,
  cols: SpaceTableColumn[],
  schemaId: string | null | undefined
): SpaceTableColumn | null => {
  if (!field) return null;
  // Off the primary files schema the parent link never materializes into the
  // row, so the tree can never form — ignore the stale config entirely.
  if (schemaId != defaultContextSchemaID) return null;
  return cols.find((c) => c.name + c.table == field) ?? null;
};

// Belt-and-suspenders write-path predicate (bd Notidian-8k9b). createSubItemRow
// is the single shared create surface (row menu + inline "+"); even with the
// render gate above, guard the write itself so no caller can ever materialize a
// child + parent-link into the canonical .md store on a schema where that link
// can never round-trip into the rendered tree (a silent dead write).
export const subItemsSchemaCanRoundTrip = (
  schemaId: string | null | undefined
): boolean => schemaId == defaultContextSchemaID;
