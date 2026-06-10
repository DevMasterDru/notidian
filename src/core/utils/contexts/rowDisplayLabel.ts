import { DBRow } from "shared/types/mdb";
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
