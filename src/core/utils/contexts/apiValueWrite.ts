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
  // TOTALITY (bd Notidian-9wzv): this gate sits on a WRITE path fed by
  // potentially corrupt/legacy MDBs and external raw edits, so it must never
  // throw on a malformed contextTables list — a crashing write is strictly
  // worse than degrading to the verb default (a single-user vault). Same
  // defensive posture as validateRow: Array-guard the container and skip any
  // non-object column entry rather than dereferencing it. `optional-chaining`
  // alone was insufficient — `cols` a truthy non-array value (`{}`, a string)
  // reached `.find` on a value with no such method, and a null/undefined entry
  // threw on `c.name` inside the predicate. Well-formed schemas never produce
  // these shapes, so this is defensive-depth, not a reachable normal path.
  if (!Array.isArray(contextTables)) return undefined;
  for (const table of contextTables) {
    const cols = table?.cols;
    if (!Array.isArray(cols)) continue;
    const col = cols.find((c) => c != null && c.name === field);
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
