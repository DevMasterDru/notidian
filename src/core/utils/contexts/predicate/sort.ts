import i18n from "shared/i18n";
import { DBRow, SpaceTableColumn, SpaceProperty } from "shared/types/mdb";
import { Sort } from "shared/types/predicate";
import { parseMultiString } from "utils/parsers";
import { parseFlexValue } from "core/schemas/parseFieldValue";
import { safelyParseJSON } from "shared/utils/json";



export type SortFunctionType = Record<
  string,
  {
    type: string[];
    label: string;
    fn: SortFunction;
    desc: boolean;
    fieldDef?: SpaceProperty;
    // Optional disambiguator when a single (type, desc) pair is claimed by more
    // than one entry (e.g. option-multi has both an "order" and a "count" sort).
    // normalizedSortForType matches on subKey when one is requested, so every
    // variant is reachable through the resolver instead of being shadowed by the
    // first insertion-order match. Entries without a subKey are the default.
    subKey?: string;
    // Whether this fn compares the RAW multi-string of a flex cell (it measures
    // cardinality via parseMultiString(...).length) rather than a scalar key.
    // sortReturnForCol consults this to decide what to feed a flex column: the
    // count-family (multi:true) gets the raw multi-string for .length, every
    // other family gets a scalar key (see flexSortKey). Mirrors how filter.ts
    // and aggregates.ts unwrap a flex cell to its scalar `.value`.
    multi?: boolean;
  }
>;
export type SortFunction = (v: any, f: any, fieldDef?: SpaceProperty) => SortResultType;

type SortResultType = -1 | 0 | 1;

/**
 * Extract options order from field definition
 */
const getOptionsOrder = (fieldDef?: SpaceProperty): string[] => {
  if (!fieldDef?.value) return [];
  
  const parsed = safelyParseJSON(fieldDef.value);
  if (!parsed?.options) return [];
  
  // Return the values in the order they appear in options array
  return parsed.options
    .filter((opt: any) => opt?.value)
    .map((opt: any) => String(opt.value));
};

const simpleSort = (a: any, b: any) => {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
};

const stringSort = (value: string, filterValue: string): SortResultType => {
  if (value == null && filterValue == null) return 0;
  if (value == null) return 1;
  if (filterValue == null) return -1;
  return (value ?? '').localeCompare(filterValue ?? '', undefined, { numeric: true, sensitivity: "base" }) as SortResultType;
};

/**
 * Sort option fields based on their defined order
 */
const optionSort: SortFunction = (
  value: string,
  filterValue: string,
  fieldDef?: SpaceProperty
): SortResultType => {
  // If we have a field definition with option ordering, use that
  if (fieldDef?.type === 'option' || fieldDef?.type === 'option-multi') {
    const optionsOrder = getOptionsOrder(fieldDef);
    if (optionsOrder.length > 0) {
      const aIndex = optionsOrder.indexOf(String(value));
      const bIndex = optionsOrder.indexOf(String(filterValue));
      
      // If both values are in the options order, use that order
      if (aIndex !== -1 && bIndex !== -1) {
        return simpleSort(aIndex, bIndex);
      }
      // If only one is in options, that one comes first
      if (aIndex !== -1) return -1;
      if (bIndex !== -1) return 1;
    }
  }
  
  // Fallback to string sort for values not in options or if no field def
  return stringSort(value, filterValue);
};

const linkSort: SortFunction = (
  value: string,
  filterValue: string
): SortResultType => {
  if (value == null && filterValue == null) return 0;
  if (value == null) return 1;
  if (filterValue == null) return -1;
  const a = value.split("/").pop();
  const b = filterValue.split("/").pop();
  return stringSort(a, b);
}

// numSort must be a STRICT WEAK ORDERING for Array.prototype.sort. parseFloat of
// a non-numeric / empty cell yields NaN, and a naive `simpleSort(NaN, x)` returns
// 0 for ALL x (NaN is neither < nor >). That makes NaN "equal" to every number
// while distinct numbers are unequal — a NON-TRANSITIVE equivalence (the
// e8e/ADR-0025 bug class) that yields V8-version-dependent ordering on a number
// column containing junk text. FIX (mirrors stringSort's null-to-one-end
// discipline): coerce NaN to a deterministic sentinel by pushing it to one end —
// NaN sorts AFTER every real number, and NaN===NaN compares equal (0).
const numSort: SortFunction = (
  value: string,
  filterValue: string
): SortResultType => {
  const a = parseFloat(value);
  const b = parseFloat(filterValue);
  const aNaN = Number.isNaN(a);
  const bNaN = Number.isNaN(b);
  // Both NaN -> equal (reflexive within the NaN equivalence class).
  if (aNaN && bNaN) return 0;
  // Push NaN to the end (sorts after any real number), like null in stringSort.
  if (aNaN) return 1;
  if (bNaN) return -1;
  return simpleSort(a, b);
};
const boolSort: SortFunction = (
  value: string,
  filterValue: string
): SortResultType =>
  simpleSort(value == "true" ? 1 : 0, filterValue == "true" ? 1 : 0);
const countSort: SortFunction = (
  value: string,
  filterValue: string
): SortResultType =>
  simpleSort(parseMultiString(value).length, parseMultiString(filterValue).length);

/**
 * Sort option-multi fields based on their defined order (for first value)
 */
const optionMultiSort: SortFunction = (
  value: string,
  filterValue: string,
  fieldDef?: SpaceProperty
): SortResultType => {
  // Parse multi-values
  const values = parseMultiString(value);
  const filterValues = parseMultiString(filterValue);
  
  // Get first values for comparison
  const firstValue = values[0] || '';
  const firstFilterValue = filterValues[0] || '';
  
  // Use option sort for the first values
  return optionSort(firstValue, firstFilterValue, fieldDef);
};

/**
 * Resolve the sortFnTypes key for a (column type, descending) pair.
 *
 * When several entries claim the same (type, desc) — option-multi has BOTH an
 * "order" sort and a "count" sort per direction — a plain first-match resolver
 * SHADOWS the later entries, making them unreachable through this resolver
 * (the option-multi "count items" sorts were dead). The optional `subKey`
 * disambiguates additively: pass a subKey to select that specific variant; omit
 * it (the default, preserving every existing caller's behavior) to get the entry
 * with NO subKey, i.e. the canonical default for that type. No user-facing sort
 * option is removed — both Order and Count remain selectable for option-multi.
 */
export const normalizedSortForType = (
  type: string,
  desc: boolean,
  subKey?: string
) => {
  const matches = (f: string) =>
    sortFnTypes[f].type.some((g) => g == type) && sortFnTypes[f].desc == desc;
  if (subKey != null) {
    const exact = Object.keys(sortFnTypes).find(
      (f) => matches(f) && sortFnTypes[f].subKey === subKey
    );
    if (exact) return exact;
  }
  // Default: prefer the entry with no subKey (the canonical default for the
  // type); fall back to the first match for types that never set a subKey.
  return (
    Object.keys(sortFnTypes).find(
      (f) => matches(f) && sortFnTypes[f].subKey == null
    ) ?? Object.keys(sortFnTypes).find(matches)
  );
};

export const sortFnTypes: SortFunctionType = {
  alphabetical: {
    type: ["text"],
    fn: stringSort,
    label: i18n.sortTypes.alphaAsc,
    desc: false,
  },
  reverseAlphabetical: {
    type: ["text"],
    fn: (v, f) => (stringSort(v, f) * -1) as SortResultType,
    label: i18n.sortTypes.alphaDesc,
    desc: true,
  },
  optionOrder: {
    type: ["option"],
    fn: optionSort,
    label: "First → Last",
    desc: false,
  },
  reverseOptionOrder: {
    type: ["option"],
    fn: (v, f, fieldDef) => (optionSort(v, f, fieldDef) * -1) as SortResultType,
    label: "Last → First",
    desc: true,
  },
  linkAlphabetical: {
    type: ["link", "context", "file", "image"],
    fn: linkSort,
    label: i18n.sortTypes.alphaAsc,
    desc: false,
  },
  linkReverseAlphabetical: {
    type: ["link", "context", "file", "image"],
    fn: (v, f) => (linkSort(v, f) * -1) as SortResultType,
    label: i18n.sortTypes.alphaDesc,
    desc: true,
  },
  earliest: {
    type: ["date"],
    fn: stringSort,
    label: i18n.sortTypes.earliest,
    desc: false,
  },
  latest: {
    type: ["date"],
    fn: (v, f) => (stringSort(v, f) * -1) as SortResultType,
    label: i18n.sortTypes.latest,
    desc: true,
  },
  boolean: {
    type: ["boolean"],
    fn: boolSort,
    label: i18n.sortTypes.checkAsc,
    desc: false,
  },
  booleanReverse: {
    type: ["boolean"],
    fn: (v, f) => (boolSort(v, f) * -1) as SortResultType,
    label: i18n.sortTypes.checkDesc,
    desc: true,
  },
  number: {
    type: ["number"],
    fn: numSort,
    label: "1 → 9",
    desc: false,
  },
  reverseNumber: {
    type: ["number"],
    fn: (v, f) => (numSort(v, f) * -1) as SortResultType,
    label: i18n.labels.nineToOne,
    desc: true,
  },
  optionMultiOrder: {
    type: ["option-multi"],
    fn: optionMultiSort,
    label: "First → Last",
    desc: false,
    subKey: "order",
  },
  reverseOptionMultiOrder: {
    type: ["option-multi"],
    fn: (v, f, fieldDef) => (optionMultiSort(v, f, fieldDef) * -1) as SortResultType,
    label: "Last → First",
    desc: true,
    subKey: "order",
  },
  count: {
    type: ["context-multi", "link-multi", "tags-multi"],
    fn: countSort,
    label: i18n.sortTypes.itemsDesc,
    desc: true,
    multi: true,
  },
  reverseCount: {
    type: ["context-multi", "link-multi", "tags-multi"],
    fn: (v, f) => (countSort(v, f) * -1) as SortResultType,
    label: i18n.sortTypes.itemsAsc,
    desc: false,
    multi: true,
  },
  optionMultiCount: {
    type: ["option-multi"],
    fn: countSort,
    label: i18n.sortTypes.itemsDesc,
    desc: true,
    subKey: "count",
    multi: true,
  },
  reverseOptionMultiCount: {
    type: ["option-multi"],
    fn: (v, f) => (countSort(v, f) * -1) as SortResultType,
    label: i18n.sortTypes.itemsAsc,
    desc: false,
    subKey: "count",
    multi: true,
  },
};

/**
 * Derive a SCALAR comparison key from a flex cell's raw stored string, for the
 * string/number sort families (alphabetical, number, earliest/latest, option…).
 *
 * The flex branch USED to feed parseMultiString (always a string[]) straight to
 * stringSort/numSort, but those call `value.localeCompare(...)` / parseFloat —
 * an Array has no .localeCompare, so the comparator threw a TypeError. Because
 * Array.prototype.sort has no try/catch around its comparator, one flex column
 * under any string/number-family sort aborted the WHOLE table-view sort pass.
 *
 * The fix mirrors the unwrap convention already used by filter.ts:242
 * (parseFlexValue(...)?.value) and aggregates.ts:46 — derive the scalar `.value`.
 *
 * It must accept BOTH on-disk shapes a flex cell can carry:
 *   1. the JSON wrapper  '{"value":"a","type":"text"}'  -> parseFlexValue().value
 *   2. a bare multi-string  'a,b'  (as sort.test.ts feeds the count path) ->
 *      first parsed element.
 * parseFlexValue returns { value: undefined } for a non-JSON string, so we fall
 * back to the first parseMultiString element when no wrapped value is present.
 * Exported so the TanStack adapter path (Notidian-xy0s) can reuse the same key.
 *
 * CRITICAL (Notidian-av6s): parseFlexValue's `.value` is the RAW parsed JSON
 * value (typed `any`) — for a wrapper like '{"value":5,"type":"number"}' or
 * '{"value":false,"type":"boolean"}' it is the NUMBER 5 / BOOLEAN false, NOT a
 * string. The old `return parsed.value as string` was a no-op type ASSERTION
 * that cast the type away without coercing the runtime value, so flexSortKey's
 * `: string` contract was a lie: a numeric/boolean flex cell leaked a number/
 * boolean to stringSort/linkSort, whose `.localeCompare` / `.split` calls threw
 * a TypeError. Array.prototype.sort has no try/catch around its comparator, so
 * ONE such column aborted the WHOLE table-view sort pass — the identical crash
 * class this branch set out to kill, merely moved from 'Array.localeCompare' to
 * 'number.localeCompare'. We therefore COERCE with String(...) (the value is
 * present-but-non-string here), mirroring filter.ts's asText discipline — and
 * the `!= null` guard still admits present-but-falsy values (false/0/'') while
 * falling through to the multi-string fallback only for null/undefined.
 */
export const flexSortKey = (raw: string): string => {
  const parsed = parseFlexValue(raw);
  if (parsed?.value != null) return String(parsed.value);
  return parseMultiString(raw)[0] ?? '';
};

export const sortReturnForCol = (
  col: SpaceTableColumn,
  sort: Sort,
  row: DBRow,
  row2: DBRow
) => {
  if (!col) return 0;
  const sortType = sortFnTypes[sort.fn];
  if (sortType) {
    // For a flex column, count-family fns (multi:true) want the RAW multi-string
    // so countSort can measure parseMultiString(...).length; every other family
    // wants a SCALAR key (flexSortKey) so stringSort/numSort don't receive an
    // array and throw. Non-flex columns pass the raw cell through unchanged.
    const flexValue = (cell: string) =>
      sortType.multi ? cell : flexSortKey(cell);
    const value =
      col.type == "flex" ? flexValue(row[sort.field]) : row[sort.field];
    const value2 =
      col.type == "flex" ? flexValue(row2[sort.field]) : row2[sort.field];
    // Pass the column as field definition for option sorting
    return sortType.fn(value, value2, col);
  }
  return 0;
};

