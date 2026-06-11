import { shouldWriteAuthorityValueToFrontmatter } from "../properties/propertyAuthority";

// Pure helpers for grouped board/list drag persistence. Kept dependency-free so
// they are unit-testable without the React component graph. See bd Notidian-oec.

// `_groupField` is the full SpaceProperty column object (from `cols.find(...)`),
// so using it directly as a computed key coerces to the literal "[object Object]"
// and corrupts the target. Resolve the canonical column name instead.
export const resolveGroupFieldName = (groupField: any): string | null => {
  if (typeof groupField === "string") return groupField || null;
  const name = groupField?.name;
  return typeof name === "string" && name.length > 0 ? name : null;
};

// A grouped-drag change on a folder/default context maps to a frontmatter write.
// Only ordinary frontmatter-backed columns may be written to the Markdown file;
// computed/file columns and (until they are routed through context persistence)
// Notidian-owned columns are skipped instead of corrupting data.
export const frontmatterGroupDragWrite = (
  groupField: any,
  groupValue: any
): { key: string; value: any } | null => {
  const key = resolveGroupFieldName(groupField);
  if (!key) return null;
  const column = typeof groupField === "string" ? { name: key } : groupField;
  if (!shouldWriteAuthorityValueToFrontmatter(column)) return null;
  return { key, value: groupValue };
};
