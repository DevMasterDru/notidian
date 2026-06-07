import type { SpaceTableColumn } from "shared/types/mdb";
import { safelyParseJSON } from "shared/utils/json";

const attrsForField = (attrs?: string): Record<string, unknown> => {
  if (!attrs?.length) return {};
  const parsed = safelyParseJSON(attrs);
  return parsed && typeof parsed == "object" && !Array.isArray(parsed)
    ? parsed
    : {};
};

const attrsStringForField = (
  attrs: Record<string, unknown>
): string | undefined => {
  const entries = Object.entries(attrs).filter(([, value]) => value != null);
  return entries.length > 0 ? JSON.stringify(Object.fromEntries(entries)) : undefined;
};

export const fieldWithPropertyHeaderIcon = <
  T extends Pick<SpaceTableColumn, "attrs">
>(
  field: T,
  icon: string
): T => ({
  ...field,
  attrs: JSON.stringify({
    ...attrsForField(field.attrs),
    icon,
  }),
});

export const fieldWithoutPropertyHeaderIcon = <
  T extends Pick<SpaceTableColumn, "attrs">
>(
  field: T
): T => {
  const attrs = attrsForField(field.attrs);
  delete attrs.icon;
  return {
    ...field,
    attrs: attrsStringForField(attrs),
  };
};

export const hasPropertyHeaderIcon = (
  field: Pick<SpaceTableColumn, "attrs">
): boolean => {
  const icon = attrsForField(field.attrs).icon;
  return typeof icon == "string" && icon.length > 0;
};
