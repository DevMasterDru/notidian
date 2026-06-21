import { filterReturnForCol } from "core/utils/contexts/predicate/filter";
import { defaultContextSchemaID } from "shared/schemas/context";
import { PathPropertyName } from "shared/types/context";
import { DBRow, SpaceTableColumn } from "shared/types/mdb";
import { Filter } from "shared/types/predicate";

// The narrow structural slice of SpaceManager this helper needs. Typing the
// dependency by shape (not the concrete class) keeps the per-row matcher pure
// and unit-testable with a tiny fake — no full Superstate/SpaceManager to wire.
export type RowMatchesSpaceManager = {
  getPathState: (path: string) => { tags?: string[] } | undefined | null;
};

export type MakeRowMatchesFiltersArgs = {
  filters: Filter[] | undefined | null;
  cols: SpaceTableColumn[];
  spaceManager: RowMatchesSpaceManager;
  // = spaceCache?.properties. Can be null/undefined during load or for views
  // whose spaceCache hasn't populated; MUST be tolerated (Notidian-iguu /
  // az2p): the predicate must never throw on a nullish cache.
  properties: Record<string, any> | undefined | null;
};

// Pure per-row predicate-filter match (Notidian-iguu). Extracted VERBATIM from
// the ContextEditorContext useMemo (Notidian-5ond.5) so the flat path AND the
// hierarchy-aware scope seam share the EXACT same match — including the
// tags-synthesis shim and the nullish-properties plumbing. Behavior is
// byte-identical to the inlined reduce; the only change is that it now lives in
// a pure, exported, co-located-tested helper so the null-spaceCache crash class
// (regression for 6ba6f3d / 5ond.5) is locked at the integration seam, not just
// the filterReturnForCol sink.
export const makeRowMatchesFilters = ({
  filters,
  cols,
  spaceManager,
  properties,
}: MakeRowMatchesFiltersArgs): ((row: DBRow) => boolean) => {
  // Whether this context exposes a synthesized "tags" column off the primary
  // files schema. Resolved once per build (not per row) — it depends only on
  // the column set, exactly as the original `cols.some(...)` inside the reduce.
  const hasTagsColumn = cols.some(
    (col) =>
      col.schemaId == defaultContextSchemaID && col.name.toLowerCase() == "tags"
  );
  return (f: DBRow) =>
    (filters ?? []).reduce((p, c) => {
      // Tags-synthesis shim: when a synthesized tags column is present, project
      // the row's live tags (from the path state) onto the tags field so a
      // tags filter can match. Null-safe path state -> [] (no throw on load).
      const row = hasTagsColumn
        ? {
            ...f,
            [f.name]: (
              spaceManager.getPathState(f[PathPropertyName])?.tags ?? []
            ).join(", "),
          }
        : f;
      return p
        ? filterReturnForCol(
            cols.find((col) => col.name + col.table == c.field),
            c,
            row,
            // Null-safe: a null/undefined properties cache resolves a
            // property-typed filter value to undefined (fail-open per ADR 0034
            // at the filterReturnForCol sink, az2p) instead of throwing.
            properties
          )
        : p;
    }, true);
};
