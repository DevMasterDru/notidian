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

export const rowDisplayLabelOverride = (
  row: DBRow | null | undefined,
  displayProperty: string | null | undefined
): string | null => {
  if (!displayProperty) return null;
  const value = row?.[displayProperty];
  if (value == null) return null;
  const label = String(value);
  return label.trim().length > 0 ? label : null;
};

// Row dicts only carry PERSISTED context-table columns; a display property
// that lives in frontmatter but was never added as a column must resolve
// from the path state's frontmatter cache (metadata.property).
export const resolveRowDisplayLabel = (
  row: DBRow | null | undefined,
  pathState: Pick<PathState, "metadata"> | null | undefined,
  displayProperty: string | null | undefined
): string | null => {
  if (!displayProperty) return null;
  const fromRow = rowDisplayLabelOverride(row, displayProperty);
  if (fromRow != null) return fromRow;
  const fmValue = pathState?.metadata?.property?.[displayProperty];
  if (fmValue == null) return null;
  const label = String(fmValue);
  return label.trim().length > 0 ? label : null;
};
