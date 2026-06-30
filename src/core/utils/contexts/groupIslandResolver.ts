// Group island header resolution (Notidian-mx0k.2): resolve each unique group
// value through a key-match relation to fetch display fields from the related
// target record. Read-only — never writes to frontmatter, pathsIndex, or
// contextsIndex.
//
// One resolution per unique group value, NOT per row. Performance is bounded by
// the number of groups (typically 5-20), not the number of rows.
//
// Ships behind the `groupingIslandHeader` kill-switch (default ON — the owner
// explicitly requested this feature). When OFF, this module is never called.

import {
  isKeyMatchConfig,
  KeyMatchRelationConfig,
  resolveKeyMatch,
} from "core/utils/contexts/keyMatchResolver";
import { Superstate } from "makemd-core";
import { SpaceTableColumn } from "shared/types/mdb";

// ---------------------------------------------------------------------------
// Config extraction
// ---------------------------------------------------------------------------

// Extract a KeyMatchRelationConfig from a column's value JSON. The column is
// expected to be a rollup column whose value JSON contains a `keyMatch` field
// (written by the S1 key-match relation config UI).
//
// Returns null if the column is absent, has no value, the value is unparseable,
// or the parsed value does not contain a valid key-match config.
export const extractKeyMatchFromColumn = (
  column: SpaceTableColumn | undefined | null
): KeyMatchRelationConfig | null => {
  if (!column?.value) return null;
  try {
    const parsed = JSON.parse(column.value);
    if (isKeyMatchConfig(parsed)) return parsed.keyMatch;
  } catch {
    // invalid JSON — treat as no config
  }
  return null;
};

// ---------------------------------------------------------------------------
// Island resolution
// ---------------------------------------------------------------------------

// Resolve island fields for each unique group value. For each value, resolves
// the key-match relation to a target path and reads the requested frontmatter
// fields from the resolved target record.
//
// Returns a Map from group value (string) to an array of resolved field values
// (strings). Groups whose value resolves to no target, or whose target has no
// matching frontmatter fields, are omitted from the result.
//
// Pure + total: never throws given a well-formed superstate. Never mutates any
// input. Deterministic: same inputs produce the same output.
export const resolveGroupIslandFields = (
  superstate: Superstate,
  groupValues: string[],
  keyMatchConfig: KeyMatchRelationConfig,
  fields: string[]
): Map<string, string[]> => {
  const result = new Map<string, string[]>();
  if (!fields || fields.length === 0) return result;

  // Deduplicate group values — one resolution per unique value.
  const seen = new Set<string>();
  for (const value of groupValues) {
    if (seen.has(value)) continue;
    seen.add(value);

    // Skip empty/sentinel values — they can't resolve to a target.
    if (!value || value.trim().length === 0) continue;

    const paths = resolveKeyMatch(superstate, value, keyMatchConfig);
    if (paths.length === 0) continue;

    // Use the first matched path (primary resolution).
    const pathState = superstate.pathsIndex.get(paths[0]);
    const frontmatter = pathState?.metadata?.property;
    if (!frontmatter) continue;

    const fieldValues: string[] = [];
    for (const field of fields) {
      const val = frontmatter[field];
      if (val != null) {
        const str = String(val).trim();
        if (str.length > 0) fieldValues.push(str);
      }
    }
    if (fieldValues.length > 0) {
      result.set(value, fieldValues);
    }
  }

  return result;
};
