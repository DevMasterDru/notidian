// Key-match foreign key resolution (Notidian-mx0k.1 / ADR 0029 B1): resolve
// a plain frontmatter value (e.g. board_id: "2") against a target database's
// matching field — no wikilinks needed. Pure function: iterates the target
// folder's rows (from superstate.contextsIndex paths + pathsIndex frontmatter)
// and returns matching file paths.
//
// The config shape is stored in the rollup column's `value` JSON alongside
// `{ref, field, fn}` — per ADR 0029 B1 (column config in MDB, never in
// frontmatter). When a rollup's config has `keyMatch`, the runtime bridge
// uses this resolver instead of wikilink parsing.
//
// Read-only: never writes to frontmatter, pathsIndex, or contextsIndex.

import { Superstate } from "makemd-core";

export type KeyMatchRelationConfig = {
  type: "key-match";
  sourceField: string; // field on the source row (e.g. "board_id")
  targetFolder: string; // Notidian database path (e.g. "Gidi/Hardware/Board Registry")
  targetField: string; // matching field on the target row (e.g. "board_id")
};

// Pure resolution: given a key-match config + source value + superstate,
// return the file paths in the target folder whose targetField matches the
// source value. Comparison is strict string equality (case-sensitive) after
// coercing both sides to strings — frontmatter values are always string-typed
// in Notidian's property model.
//
// Returns a deduplicated array of matched paths (order: iteration order of
// contextsIndex.paths, which is the folder's file order). Returns [] when:
// - sourceValue is null/undefined/empty string
// - targetFolder doesn't exist in contextsIndex
// - no rows match
//
// Never throws given a well-formed superstate (total over the production shape).
export const resolveKeyMatch = (
  superstate: Superstate,
  sourceValue: unknown,
  config: KeyMatchRelationConfig
): string[] => {
  // Null/undefined/empty source value can't match anything.
  if (sourceValue == null) return [];
  const sourceStr = String(sourceValue).trim();
  if (sourceStr.length === 0) return [];

  const { targetFolder, targetField } = config;
  if (!targetFolder || !targetField) return [];

  // Get the target folder's file paths from contextsIndex.
  const contextState = superstate.contextsIndex.get(targetFolder);
  const paths = contextState?.paths;
  if (!paths || paths.length === 0) return [];

  const matched: string[] = [];
  for (const path of paths) {
    const pathState = superstate.pathsIndex.get(path);
    const frontmatter = pathState?.metadata?.property;
    if (!frontmatter) continue;

    const targetValue = frontmatter[targetField];
    if (targetValue == null) continue;

    // String equality (case-sensitive). Array-valued targets match if any
    // element equals the source value.
    if (Array.isArray(targetValue)) {
      if (targetValue.some((v) => String(v).trim() === sourceStr)) {
        matched.push(path);
      }
    } else {
      if (String(targetValue).trim() === sourceStr) {
        matched.push(path);
      }
    }
  }

  return matched;
};

// Type guard: checks whether a parsed rollup config JSON contains a valid
// key-match relation config. Used by the runtime bridge and the RollupCell
// to branch between wikilink-based and key-match-based resolution.
export const isKeyMatchConfig = (
  config: Record<string, any> | null | undefined
): config is Record<string, any> & { keyMatch: KeyMatchRelationConfig } => {
  if (!config?.keyMatch) return false;
  const km = config.keyMatch;
  return (
    km.type === "key-match" &&
    typeof km.sourceField === "string" &&
    km.sourceField.length > 0 &&
    typeof km.targetFolder === "string" &&
    km.targetFolder.length > 0 &&
    typeof km.targetField === "string" &&
    km.targetField.length > 0
  );
};
