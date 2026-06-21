import { parseLinkDisplayString } from "core/utils/parser";
import { DBRow } from "shared/types/mdb";
import { PathState } from "shared/types/PathState";
import { Predicate } from "shared/types/predicate";

export const displayPropertyForPredicate = (
  predicate: Partial<Predicate> | null | undefined
): string | null => {
  const displayProperty = predicate?.listViewProps?.displayProperty;
  if (typeof displayProperty != "string") return null;
  return displayProperty.trim().length > 0 ? displayProperty : null;
};

// A display column whose type is link- or context-backed stores a path (and may
// be wrapped in a wikilink, possibly with an alias: `[[Folder/Parent|Parent]]`).
// Showing the raw materialized value as a list-view label leaks the qualifying
// folder ("Folder/Parent") instead of the human-facing basename ("Parent")
// (Notidian-xsau, exposed by the kg81 path-qualified parent-link writer). Render
// such values through parseLinkDisplayString to extract the basename; all other
// types keep the lossless String() behavior.
export const isLinkLikeDisplayType = (
  type: string | null | undefined
): boolean => !!type && (type.startsWith("link") || type.startsWith("context"));

const formatDisplayValue = (
  value: unknown,
  displayColumnType: string | null | undefined
): string => {
  if (isLinkLikeDisplayType(displayColumnType)) {
    return parseLinkDisplayString(String(value));
  }
  return String(value);
};

export const rowDisplayLabelOverride = (
  row: DBRow | null | undefined,
  displayProperty: string | null | undefined,
  displayColumnType?: string | null
): string | null => {
  if (!displayProperty) return null;
  const value = row?.[displayProperty];
  if (value == null) return null;
  const label = formatDisplayValue(value, displayColumnType);
  return label.trim().length > 0 ? label : null;
};

// Row dicts only carry PERSISTED context-table columns; a display property
// that lives in frontmatter but was never added as a column must resolve
// from the path state's frontmatter cache (metadata.property).
export const resolveRowDisplayLabel = (
  row: DBRow | null | undefined,
  pathState: Pick<PathState, "metadata"> | null | undefined,
  displayProperty: string | null | undefined,
  displayColumnType?: string | null
): string | null => {
  if (!displayProperty) return null;
  const fromRow = rowDisplayLabelOverride(row, displayProperty, displayColumnType);
  if (fromRow != null) return fromRow;
  const fmValue = pathState?.metadata?.property?.[displayProperty];
  if (fmValue == null) return null;
  const label = formatDisplayValue(fmValue, displayColumnType);
  return label.trim().length > 0 ? label : null;
};
