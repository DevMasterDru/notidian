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
          // Strip the alias (|display) then any heading/block fragment
          // (#heading, #^block) so the link resolves to the target file path.
          const inner = link
            .slice(2, -2)
            .split("|")[0]
            .split("#")[0]
            .trim();
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

// Detailed rollup (ADR 0029 D2): the aggregate value PLUS the counts behind it,
// so a cell can honestly show "N of M counted — K unresolved/non-numeric".
//   relationCount = the number of relation links (always linkPaths.length).
//   resolvedCount = the number of links that actually CONTRIBUTE to this fn,
//                   attributed PER LINK (not per flattened value): a non-empty
//                   resolved value for the listing fns, or a value that coerces
//                   to a finite number for the numeric fns. `count` is never
//                   partial (resolvedCount == relationCount) and, as before,
//                   never touches the resolver.
// The `value` field is byte-identical to the legacy computeFrontmatterRollup
// output (same order, same flatten, same filter), so the string API below can
// delegate here without changing any caller.
export const computeFrontmatterRollupDetailed = (params: {
  linkPaths: string[];
  config: RollupConfig;
  resolveFrontmatter: FrontmatterResolver;
}): { value: string; relationCount: number; resolvedCount: number } => {
  const { linkPaths, config, resolveFrontmatter } = params;
  const relationCount = linkPaths.length;

  // Count of relations is independent of whether each link resolves.
  if (config.fn == "count") {
    return {
      value: String(relationCount),
      relationCount,
      resolvedCount: relationCount,
    };
  }

  const numericFn =
    config.fn == "sum" ||
    config.fn == "avg" ||
    config.fn == "min" ||
    config.fn == "max";
  const isUsable = (value: unknown) =>
    !(value == null || String(value).trim().length == 0);

  // Progress rollups (Notidian-5ond.7): the share (0..100) of RESOLVED links whose
  // target property is non-empty ("percent") or checked-true ("percent_checked",
  // tolerating the "true" string). Denominator = resolved links (dangling links
  // are excluded and surface via the D2 partial marker). Empty string when there
  // is nothing resolved to measure.
  if (config.fn == "percent" || config.fn == "percent_checked") {
    let denom = 0;
    let num = 0;
    for (const path of linkPaths) {
      const frontmatter = resolveFrontmatter(path);
      if (!frontmatter) continue;
      denom++;
      const value = frontmatter[config.targetProperty];
      const hit =
        config.fn == "percent_checked"
          ? Array.isArray(value)
            ? value.some((v) => v === true || v === "true")
            : value === true || value === "true"
          : Array.isArray(value)
          ? value.some((v) => isUsable(v))
          : isUsable(value);
      if (hit) num++;
    }
    return {
      value: denom == 0 ? "" : String(Math.round((100 * num) / denom)),
      relationCount,
      resolvedCount: denom,
    };
  }

  // Collect the target property from each resolvable linked row. Array-valued
  // frontmatter (e.g. a multi-value property) is flattened so count_values and
  // values reflect each element, not the whole list as one scalar. The per-link
  // buffer preserves resolution attribution (D2) without disturbing value order.
  const rawValues: unknown[] = [];
  let resolvedCount = 0;
  for (const path of linkPaths) {
    const frontmatter = resolveFrontmatter(path);
    if (!frontmatter) continue;
    const value = frontmatter[config.targetProperty];
    const perLink: unknown[] = [];
    if (Array.isArray(value)) {
      for (const element of value) if (isUsable(element)) perLink.push(element);
    } else if (isUsable(value)) {
      perLink.push(value);
    }
    if (perLink.length == 0) continue;
    for (const v of perLink) rawValues.push(v);
    // Numeric fns need at least one finite number to have "counted" this link.
    if (numericFn) {
      if (perLink.some((v) => !Number.isNaN(toNumber(v)))) resolvedCount++;
    } else {
      resolvedCount++;
    }
  }

  let value: string;
  if (config.fn == "count_values") {
    value = String(rawValues.length);
  } else if (config.fn == "values" || config.fn == "unique") {
    value = uniq(rawValues.map((v) => String(v))).join(", ");
  } else if (numericFn) {
    const numbers = rawValues.map(toNumber).filter((n) => !Number.isNaN(n));
    if (numbers.length == 0) {
      value = config.fn == "sum" ? "0" : "";
    } else {
      switch (config.fn) {
        case "sum":
          value = formatNumber(numbers.reduce((a, b) => a + b, 0));
          break;
        case "avg":
          value = formatNumber(
            numbers.reduce((a, b) => a + b, 0) / numbers.length
          );
          break;
        // reduce, not Math.min(...spread), to avoid the arg-count limit on huge rollups.
        case "min":
          value = formatNumber(numbers.reduce((a, b) => Math.min(a, b)));
          break;
        case "max":
          value = formatNumber(numbers.reduce((a, b) => Math.max(a, b)));
          break;
        default:
          value = "";
      }
    }
  } else {
    // Unknown fn -> "" (matches the legacy default branch).
    value = "";
  }

  return { value, relationCount, resolvedCount };
};

export const computeFrontmatterRollup = (params: {
  linkPaths: string[];
  config: RollupConfig;
  resolveFrontmatter: FrontmatterResolver;
}): string => computeFrontmatterRollupDetailed(params).value;
