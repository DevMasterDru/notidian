import { safelyParseJSON } from "shared/utils/json";

export const TEXT_GROUP_ORDER_ATTR = "notidianGroupOrder";

const distinctNonEmptyStrings = (values: unknown): string[] => {
  if (!Array.isArray(values)) return [];
  const seen = new Set<string>();
  return values.reduce<string[]>((result, value) => {
    if (typeof value != "string" || value.length == 0 || seen.has(value)) {
      return result;
    }
    seen.add(value);
    result.push(value);
    return result;
  }, []);
};

export const parseTextGroupOrder = (value?: string): string[] => {
  if (!value) return [];
  try {
    return distinctNonEmptyStrings(JSON.parse(value));
  } catch {
    return [];
  }
};

export const serializeTextGroupOrder = (values: string[]): string =>
  JSON.stringify(distinctNonEmptyStrings(values));

const attrsObject = (attrs?: string): Record<string, unknown> => {
  if (!attrs?.length) return {};
  const parsed = safelyParseJSON(attrs);
  return parsed && typeof parsed == "object" && !Array.isArray(parsed)
    ? { ...parsed }
    : {};
};

/**
 * Text-backed group order is stored inside `attrs`, the existing persisted
 * metadata envelope for a field. `m_fields` deliberately has no arbitrary
 * extension columns, so adding `SpaceProperty.groupOrder` only created a
 * transient value that was discarded on every database write.
 */
export const textGroupOrderFromAttrs = (attrs?: string): string[] =>
  distinctNonEmptyStrings(attrsObject(attrs)[TEXT_GROUP_ORDER_ATTR]);

export const attrsWithTextGroupOrder = (
  attrs: string | undefined,
  values: string[]
): string | undefined => {
  const nextAttrs = attrsObject(attrs);
  const order = distinctNonEmptyStrings(values);
  if (order.length > 0) nextAttrs[TEXT_GROUP_ORDER_ATTR] = order;
  else delete nextAttrs[TEXT_GROUP_ORDER_ATTR];
  return Object.keys(nextAttrs).length > 0 ? JSON.stringify(nextAttrs) : undefined;
};

export const reorderGroupedIslandOptions = (
  values: string[],
  activeValue: string,
  overValue: string
): string[] => {
  const order = distinctNonEmptyStrings(values);
  const from = order.indexOf(activeValue);
  const to = order.indexOf(overValue);
  if (from < 0 || to < 0 || from == to) return order;
  const next = [...order];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
};

export const effectiveTextGroupOrder = (args: {
  observed: string[];
  global?: string[];
  view?: string[];
}): string[] => {
  const observed = distinctNonEmptyStrings(args.observed);
  const preferred = distinctNonEmptyStrings(
    args.view && args.view.length > 0 ? args.view : args.global
  );
  return [
    ...preferred.filter((value) => observed.includes(value)),
    ...observed.filter((value) => !preferred.includes(value)),
  ];
};
