import { SpaceProperty, SpaceTable } from "shared/types/mdb";
import {
  ApiValueWriteTarget,
  apiValueWriteTarget,
} from "../properties/propertyAuthority";

// Authority gating for the programmatic API value-write surface
// (api.context.update / api.path.setProperty). Pure, offline-testable: it decides
// *where* a single field write should land, but performs no I/O. See bd
// Notidian-1da and propertyAuthority.apiValueWriteTarget for the authority model.

export type { ApiValueWriteTarget };

// Resolve the column definition that governs `field` for an API value write.
//
// A path can belong to several spaces, so the caller supplies the candidate
// context tables (e.g. the target space's context table, or every space the path
// is a member of). The first table that defines the field wins. Returns undefined
// when no context table defines the field — the field may be an unmaterialized
// frontmatter property with no column yet, in which case the caller keeps the
// verb's default target rather than guessing the field's durable home.
export const resolveApiFieldColumn = (
  field: string,
  contextTables: ReadonlyArray<SpaceTable | undefined | null>
): SpaceProperty | undefined => {
  for (const table of contextTables) {
    const col = table?.cols?.find((c) => c.name === field);
    if (col) return col;
  }
  return undefined;
};

// Decide where an API value write should land, given the candidate context
// tables and the verb's pre-gate default. Combines column resolution with the
// authority gate so both API call sites share one decision.
export const apiFieldWriteTarget = (
  field: string,
  contextTables: ReadonlyArray<SpaceTable | undefined | null>,
  defaultTarget: "frontmatter" | "context"
): ApiValueWriteTarget => {
  const column = resolveApiFieldColumn(field, contextTables);
  return apiValueWriteTarget(column, defaultTarget);
};
