import { safelyParseJSON } from "shared/utils/json";

// H3 hover-tooltip elaboration (Notidian-pb7p.3 / Atlas ADR-0096 D1: hubs carry
// elaboration in hover tooltips rather than body prose).
//
// The description rides `attrs`, the existing persisted metadata envelope for a
// field, for the same reason the text group order does (groupedIslandOrder):
// `m_fields` has no arbitrary extension columns, so a new SpaceProperty field
// would be a transient value discarded on every database write.
export const PROPERTY_DESCRIPTION_ATTR = "notidianDescription";

const attrsObject = (attrs?: string): Record<string, unknown> => {
  if (!attrs?.length) return {};
  const parsed = safelyParseJSON(attrs);
  return parsed && typeof parsed == "object" && !Array.isArray(parsed)
    ? { ...parsed }
    : {};
};

export const propertyDescriptionFromAttrs = (
  attrs?: string
): string | undefined => {
  const value = attrsObject(attrs)[PROPERTY_DESCRIPTION_ATTR];
  if (typeof value != "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

// Writes through the whole envelope so sibling metadata (group order, future
// keys) survives; a blank description clears the key, and attrs collapses back
// to undefined once nothing is left in it.
export const attrsWithPropertyDescription = (
  attrs: string | undefined,
  description: string | undefined
): string | undefined => {
  const nextAttrs = attrsObject(attrs);
  const trimmed = typeof description == "string" ? description.trim() : "";
  if (trimmed.length > 0) nextAttrs[PROPERTY_DESCRIPTION_ATTR] = trimmed;
  else delete nextAttrs[PROPERTY_DESCRIPTION_ATTR];
  return Object.keys(nextAttrs).length > 0
    ? JSON.stringify(nextAttrs)
    : undefined;
};
