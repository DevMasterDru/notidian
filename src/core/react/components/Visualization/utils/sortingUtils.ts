/**
 * Utility functions for sorting data in visualizations
 */

import { safelyParseJSON } from "shared/utils/json";

/**
 * Extract options order from field definition
 */
export const getOptionsOrder = (fieldDefinition: any): string[] => {
  if (!fieldDefinition?.value) return [];
  
  const parsed = safelyParseJSON(fieldDefinition.value);
  if (!parsed?.options) return [];

  // Robustness guard (Notidian-dox item 1): a malformed/legacy/hand-edited
  // definition can have `options` as a truthy non-array (number/string/true).
  // Calling .filter on it throws; degrade to [] instead of crashing the chart
  // sort path. No observable change for valid (array) data — Q1 hardening only.
  if (!Array.isArray(parsed.options)) return [];

  // Return the values in the order they appear in options array
  return parsed.options
    .filter((opt: any) => opt?.value)
    .map((opt: any) => String(opt.value));
};

/**
 * Check if a string value looks like a date
 */
export const isDateLike = (val: string): boolean => {
  if (!val || typeof val !== 'string') return false;
  
  // Common date patterns
  return /\d{4}-\d{2}-\d{2}|\d{2}\/\d{2}\/\d{4}|\d{2}-\d{2}-\d{4}|\d{4}\/\d{2}\/\d{2}/.test(val) ||
         /\w{3}\s+\d{1,2},?\s+\d{4}|\d{1,2}\s+\w{3}\s+\d{4}/.test(val);
};

/**
 * Whole-string finite-numeric token recognizer (ADR 0033 Option B predicate).
 *
 * A value qualifies for the NUMBER bucket only when its ENTIRE trimmed string is
 * a finite decimal/scientific literal — not "10abc", not a date-shaped token, and
 * NOT "Infinity" / "-Infinity" / overflow literals like "1e999" (which parseFloat
 * maps to ±Infinity). Excluding non-finite tokens is what closes the legacy
 * NaN-reflexivity defect: "Infinity" falls to the string bucket, so its
 * self-compare is a localeCompare === 0 rather than `Infinity - Infinity === NaN`.
 */
const FINITE_NUMERIC = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;

type SortBucket = 0 | 1 | 2; // 0 = valid date, 1 = finite number, 2 = string

interface Classified {
  bucket: SortBucket;
  str: string; // original String()-coerced value (string-bucket localeCompare)
  date: number; // valid epoch ms when bucket === 0
  num: number; // finite numeric value when bucket === 1
}

/**
 * Classify a value into a STABLE per-value bucket (ADR 0033 Option B).
 *
 * The classification depends ONLY on the value itself — never on a comparison
 * partner — which is the whole point: it makes `intelligentCompare` a real strict
 * weak ordering (transitive by construction) instead of the legacy per-PAIR branch
 * selection that was V8/TimSort-order-dependent for mixed-type axis data.
 *
 * Cross-bucket order is fixed: dates (0) < numbers (1) < strings (2). This mirrors
 * the legacy intent (date path first, numeric second, string fallback last) so
 * single-type axes — all dates, all numbers, or all text — render identically to
 * before; only genuinely mixed-type axes (where the old comparator was incoherent)
 * change order.
 */
const classifyForSort = (value: any): Classified => {
  const str = String(value);

  // Date bucket: date-SHAPED *and* parses to a real time. Date-shaped-but-invalid
  // (e.g. "1234-56-78") falls through so it lands in a stable lower bucket rather
  // than poisoning the date bucket with a NaN time.
  if (isDateLike(str)) {
    const t = new Date(str).getTime();
    if (!isNaN(t)) return { bucket: 0, str, date: t, num: NaN };
  }

  // Number bucket: whole-string finite-numeric only.
  const trimmed = str.trim();
  if (trimmed !== "" && FINITE_NUMERIC.test(trimmed)) {
    const n = parseFloat(trimmed);
    if (isFinite(n)) return { bucket: 1, str, date: NaN, num: n };
  }

  // String bucket: everything else (including "Infinity", "0x10", free text, "").
  return { bucket: 2, str, date: NaN, num: NaN };
};

/**
 * Intelligent comparison function for sorting mixed data types.
 *
 * Handles dates, numbers, and strings with numeric awareness. Implements a real
 * strict weak ordering (reflexive, antisymmetric, transitive) per ADR 0033 by
 * classifying each value ONCE into a stable bucket (dates < numbers < strings) and
 * comparing within-bucket; the legacy per-PAIR branch selection was non-transitive
 * and non-reflexive on ±Infinity. Fed directly to Array.prototype.sort to order D3
 * chart axes/categories, so a real total order removes the V8/TimSort hazard.
 */
export const intelligentCompare = (a: any, b: any): number => {
  const ca = classifyForSort(a);
  const cb = classifyForSort(b);

  // Cross-bucket: fixed deterministic order dates < numbers < strings.
  if (ca.bucket !== cb.bucket) return ca.bucket - cb.bucket;

  // Within-bucket: type-appropriate ordering.
  switch (ca.bucket) {
    case 0:
      return ca.date - cb.date; // both valid epoch ms
    case 1:
      return ca.num - cb.num; // both finite numbers
    default:
      return ca.str.localeCompare(cb.str, undefined, {
        numeric: true,
        sensitivity: "base",
      });
  }
};

/**
 * Non-finite-disciplined numeric difference for the temporal/quantitative branches
 * of `sortByEncodingType` (ADR 0033 bug class — same defect classifyForSort fixed
 * for intelligentCompare; Notidian-zj8b).
 *
 * The legacy branches returned a bare `na - nb`, which has TWO non-finite failure
 * modes, both of which produce a NaN comparator return — an SWO violation that hands
 * Array.prototype.sort (LineChartUtility.ts:173,600) an input-dependent,
 * V8/TimSort-order-sensitive contract:
 *   1. NaN operands — an unparseable cell (a date string `new Date()` can't read, or
 *      non-numeric junk under `Number()`): `NaN - NaN === NaN` (so `compare(x, x)`
 *      could be NaN — NON-REFLEXIVE) and `valid - NaN === NaN` (relation undefined).
 *   2. ±Infinity operands — a quantitative cell whose `Number()` coercion is NOT NaN
 *      but ±Infinity: the string "Infinity"/"-Infinity", an overflow literal like
 *      "1e999", or an actual Infinity numeric value. Then `Infinity - Infinity ===
 *      NaN`, so `compare("Infinity","Infinity") === NaN` — the exact non-reflexive,
 *      NaN-returning self-compare ADR 0033 names as a core in-scope defect (the same
 *      "Infinity"/"1e999" NaN-reflexivity break classifyForSort closes by routing
 *      non-finite tokens to the string bucket via FINITE_NUMERIC + isFinite). Guarding
 *      only `Number.isNaN` would miss this; we guard `!Number.isFinite` so BOTH modes
 *      fold into the deterministic sort-last bucket. (The temporal branch never hits
 *      mode 2 — `Date.getTime()` is always a finite ms or NaN, never ±Infinity — but
 *      the shared helper must close it for the quantitative branch.)
 *
 * This applies the same non-finite-to-one-end discipline as classifyForSort's stable
 * buckets WITHOUT changing single-type axes: when BOTH values are finite it returns
 * the exact same `na - nb` as before (so all-valid temporal / quantitative axes stay
 * byte-identical); only when a value is non-finite (NaN or ±Infinity) does it diverge
 * — a non-finite value sorts AFTER every finite value and self-compares to 0:
 *   both non-finite -> 0   (reflexive; two non-finite cells are order-equivalent)
 *   a non-finite    -> +1  (non-finite a sorts after finite b)
 *   b non-finite    -> -1  (finite a sorts before non-finite b)
 *   else            -> na - nb
 */
const numericDiffNaNLast = (na: number, nb: number): number => {
  const aBad = !Number.isFinite(na);
  const bBad = !Number.isFinite(nb);
  if (aBad && bBad) return 0;
  if (aBad) return 1;
  if (bBad) return -1;
  return na - nb;
};

/**
 * Sort values based on encoding type
 */
export const sortByEncodingType = (
  a: any, 
  b: any, 
  encodingType: 'temporal' | 'quantitative' | 'nominal' | 'ordinal',
  field: string,
  scale?: any,
  fieldDefinition?: any
): number => {
  const aVal = a[field];
  const bVal = b[field];
  
  if (encodingType === 'temporal') {
    // getTime() is NaN for an unparseable date; numericDiffNaNLast keeps the
    // relation a strict weak ordering (NaN sorts last, self-compares 0) instead of
    // the legacy NaN-propagating `dateA - dateB` (ADR 0033; Notidian-zj8b).
    const dateA = aVal instanceof Date ? aVal : new Date(String(aVal));
    const dateB = bVal instanceof Date ? bVal : new Date(String(bVal));
    return numericDiffNaNLast(dateA.getTime(), dateB.getTime());
  }

  if (encodingType === 'quantitative') {
    // Number() yields NaN for non-numeric junk AND ±Infinity for "Infinity"/
    // "-Infinity"/overflow literals like "1e999" (or an actual Infinity value); the
    // non-finite-to-one-end discipline folds BOTH into the sort-last bucket so a
    // junk- OR Infinity-bearing quantitative axis stays a strict weak ordering with
    // no NaN self-compare (Notidian-zj8b; ADR 0033 Infinity NaN-reflexivity defect).
    return numericDiffNaNLast(Number(aVal), Number(bVal));
  }
  
  // For nominal/ordinal data, check if we have option field ordering
  if (fieldDefinition?.type === 'option' || fieldDefinition?.type === 'option-multi') {
    const optionsOrder = getOptionsOrder(fieldDefinition);
    if (optionsOrder.length > 0) {
      const aIndex = optionsOrder.indexOf(String(aVal));
      const bIndex = optionsOrder.indexOf(String(bVal));
      
      // If both values are in the options order, use that order
      if (aIndex !== -1 && bIndex !== -1) {
        return aIndex - bIndex;
      }
      // If only one is in options, that one comes first
      if (aIndex !== -1) return -1;
      if (bIndex !== -1) return 1;
    }
  }
  
  // For nominal/ordinal data, use the scale's domain order if available
  if (scale && scale.domain) {
    const xDomain = scale.domain();
    const aIndex = xDomain.indexOf(String(aVal));
    const bIndex = xDomain.indexOf(String(bVal));
    if (aIndex !== -1 && bIndex !== -1) {
      return aIndex - bIndex;
    }
  }
  
  // Fallback to intelligent comparison
  return intelligentCompare(aVal, bVal);
};

/**
 * Sort an array of unique values intelligently
 */
export const sortUniqueValues = (values: string[], fieldDefinition?: any): string[] => {
  // If we have option field definition, use that order
  if (fieldDefinition?.type === 'option' || fieldDefinition?.type === 'option-multi') {
    const optionsOrder = getOptionsOrder(fieldDefinition);
    if (optionsOrder.length > 0) {
      // Sort based on options order, with unknown values at the end
      return [...values].sort((a, b) => {
        const aIndex = optionsOrder.indexOf(a);
        const bIndex = optionsOrder.indexOf(b);
        
        if (aIndex !== -1 && bIndex !== -1) {
          return aIndex - bIndex;
        }
        if (aIndex !== -1) return -1;
        if (bIndex !== -1) return 1;
        
        // Fallback to intelligent comparison for values not in options
        return intelligentCompare(a, b);
      });
    }
  }
  
  return [...values].sort(intelligentCompare);
};

/**
 * Extract unique values from data and sort them intelligently
 */
export const getUniqueSortedValues = (data: any[], field: string, fieldDefinition?: any): string[] => {
  const values = data.map(d => String(d[field] || ''));
  const uniqueValues = Array.from(new Set(values));
  return sortUniqueValues(uniqueValues, fieldDefinition);
};