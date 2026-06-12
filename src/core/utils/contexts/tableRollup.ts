import { uniq } from "shared/utils/array";

// Frontmatter-link rollups (Notidian-9ln): aggregate a property across the rows
// a relation property links to. Read-only and frontmatter-canonical — the
// linked rows are resolved from their own frontmatter (in prod via
// superstate.pathsIndex, which is the in-memory frontmatter cache, so no
// per-render disk reads), never from a parallel MDB relationship table.

export type RollupConfig = {
  relationProperty: string; // the relation column whose links to follow
  targetProperty: string; // the property to read from each linked row
  fn: string; // count | count_values | values | unique | sum | avg | min | max
};

// Resolve a linked row's frontmatter. Prod: (path) =>
// superstate.pathsIndex.get(path)?.metadata?.property.
export type FrontmatterResolver = (
  path: string
) => Record<string, any> | null | undefined;

// Parse a relation property's frontmatter value into target paths. Accepts a
// YAML array or a string of `[[wikilinks]]` (aliases stripped), falling back to
// comma-separated plain paths.
export const parseRelationLinks = (value: unknown): string[] => {
  const out: string[] = [];
  // Process comma-separated segments in source order so a mixed value like
  // `A, [[B]]` keeps both paths (Notidian's naming charset has no commas, so
  // splitting on comma is safe for wikilink targets).
  const addFromString = (raw: unknown) => {
    for (const segment of String(raw ?? "").split(",")) {
      const seg = segment.trim();
      if (!seg) continue;
      const wikilinks = seg.match(/\[\[([^\]]+)\]\]/g);
      if (wikilinks) {
        for (const link of wikilinks) {
          const inner = link.slice(2, -2).split("|")[0].trim();
          if (inner) out.push(inner);
        }
      } else {
        out.push(seg);
      }
    }
  };
  if (value == null) return [];
  if (Array.isArray(value)) value.forEach(addFromString);
  else addFromString(value);
  return uniq(out);
};

// Strict numeric coercion: numbers and numeric strings only. Booleans, Dates,
// and blank/whitespace are not numbers (don't sum checkboxes or dates).
const toNumber = (value: unknown): number => {
  if (typeof value == "number") return value;
  if (typeof value == "boolean" || value instanceof Date) return NaN;
  const str = String(value).trim();
  if (str.length == 0) return NaN;
  return Number(str);
};

const formatNumber = (value: number): string =>
  Number.isInteger(value) ? String(value) : String(Number(value.toFixed(2)));

export const computeFrontmatterRollup = (params: {
  linkPaths: string[];
  config: RollupConfig;
  resolveFrontmatter: FrontmatterResolver;
}): string => {
  const { linkPaths, config, resolveFrontmatter } = params;

  // Count of relations is independent of whether each link resolves.
  if (config.fn == "count") return String(linkPaths.length);

  // Collect the target property from each resolvable linked row. Array-valued
  // frontmatter (e.g. a multi-value property) is flattened so count_values and
  // values reflect each element, not the whole list as one scalar.
  const rawValues: unknown[] = [];
  const pushValue = (value: unknown) => {
    if (value == null || String(value).trim().length == 0) return;
    rawValues.push(value);
  };
  for (const path of linkPaths) {
    const frontmatter = resolveFrontmatter(path);
    if (!frontmatter) continue;
    const value = frontmatter[config.targetProperty];
    if (Array.isArray(value)) value.forEach(pushValue);
    else pushValue(value);
  }

  if (config.fn == "count_values") return String(rawValues.length);
  if (config.fn == "values" || config.fn == "unique")
    return uniq(rawValues.map((value) => String(value))).join(", ");

  const numbers = rawValues.map(toNumber).filter((n) => !Number.isNaN(n));
  if (numbers.length == 0) return config.fn == "sum" ? "0" : "";
  switch (config.fn) {
    case "sum":
      return formatNumber(numbers.reduce((a, b) => a + b, 0));
    case "avg":
      return formatNumber(
        numbers.reduce((a, b) => a + b, 0) / numbers.length
      );
    // reduce, not Math.min(...spread), to avoid the arg-count limit on huge rollups.
    case "min":
      return formatNumber(numbers.reduce((a, b) => Math.min(a, b)));
    case "max":
      return formatNumber(numbers.reduce((a, b) => Math.max(a, b)));
    default:
      return "";
  }
};
