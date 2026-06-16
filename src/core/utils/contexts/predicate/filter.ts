import { parseFlexValue } from "core/schemas/parseFieldValue";
import { DBRow, SpaceTableColumn } from "shared/types/mdb";
import { Filter } from "shared/types/predicate";
import { parseMultiString } from "utils/parsers";
import { filterFnTypes } from "./filterFns/filterFnTypes";


export type FilterFunctionType = Record<
  string,
  { type: string[]; fn: FilterFunction; valueType: string }
>;
type FilterFunction = (v: any, f: any) => boolean;

// FAIL-CLOSED-EMPTY value guard for the TEXT matcher family (ADR 0043, Option A,
// Notidian-9i9i). The bare `(value ?? "")` guard caught null/undefined but NOT a
// non-string non-nullish primitive: a number `0` or boolean `false` flowed
// through unchanged and then hit a String.prototype method (.toLowerCase /
// .startsWith / .endsWith / .length), which numbers/booleans do not have — a
// TypeError that crashed the WHOLE table-view filter pass (filterReturnForCol has
// no try/catch; reachable live via a flex cell whose JSON value is a real 0/false).
//
// asText normalizes a non-string non-nullish operand to "" — i.e. a TEXT matcher
// treats a numeric/boolean cell as an EMPTY cell. Strings and null/undefined
// behave EXACTLY as before. This obeys the family's value-level fail-closed
// convention (a non-matching operand never spuriously matches, never throws —
// lessThan/greaterThan/lengthEquals/date), and deliberately does NOT coerce-to-
// string (rejected Option B: `0` would substring-match "0", `false` match
// "false" — surprising cross-type matching with no user signal).
const asText = (value: any): string =>
  typeof value === "string" ? value : "";

export const startsWith: FilterFunction = (
  value: string,
  filterValue: string
): boolean => {
  return asText(value).startsWith(filterValue);
}

export const endsWith: FilterFunction = (
  value: string,
  filterValue: string
): boolean => {
  return asText(value).endsWith(filterValue);
}

export const lengthEquals: FilterFunction = (
  value: string,
  filterValue: string
): boolean => {
  // asText-guard the value like every sibling text predicate so an empty cell
  // measures as length 0 instead of throwing on value.length, AND a non-string
  // non-nullish cell (number 0 / boolean false) measures as length 0 — explicitly
  // (ADR 0043), not by relying on `undefined.length` evaluating falsey. NaN
  // contract: a non-numeric filterValue parses to NaN and length == NaN is always
  // false, so a non-numeric operand makes every length fail (fail-closed) — mirrors
  // the NaN convention documented on lessThan/greaterThan.
  return asText(value).length == parseInt(filterValue);
}

export const listEquals: FilterFunction = (
  value: string,
  filterValue: string
): boolean => {
  const valueList = value ? parseMultiString(value) : [];
  const strings = filterValue ? parseMultiString(filterValue) : [];
  return strings.every((f) => valueList.some((g) => g == f)) && valueList.every((f) => strings.some((g) => g == f));
}

export const stringEqual: FilterFunction = (
  value: string,
  filterValue: string
): boolean => {
  return value == filterValue;
};

export const empty: FilterFunction = (
  value: string,
  filterValue: string
): boolean => {
  // asText-guard (ADR 0043): a non-string non-nullish cell (number 0 / boolean
  // false) measures length 0 -> would read as "empty". Today this was the
  // accidental `undefined.length == 0 -> false` (non-empty) result. We KEEP the
  // observed "a 0/false cell is NOT empty" verdict by measuring asText only when
  // the value IS nullish-or-string; a real non-string value is a real value, so
  // it stays non-empty. (asText(0) === "" would flip it to empty, which is
  // wrong — a 0 is a real value.) So `empty` measures the ORIGINAL value's
  // emptiness for non-strings: a non-string non-nullish primitive is a present
  // value => NOT empty.
  if (value !== null && value !== undefined && typeof value !== "string")
    return false; // a real non-string value (0 / false / {}) is present => not empty
  return asText(value).length == 0;
};

export const stringCompare: FilterFunction = (
  value: string,
  filterValue: string
): boolean => {
  return asText(value)
    .toLowerCase()
    .includes(asText(filterValue).toLowerCase());
};

export const greaterThan: FilterFunction = (
  value: string,
  filterValue: string
): boolean => {
  return parseFloat(value) > parseFloat(filterValue);
};

export const lessThan: FilterFunction = (
  value: string,
  filterValue: string
): boolean => {
  // Standardized on parseFloat to match greaterThan (single numeric-coercion
  // convention) — decimals and radix prefixes are now interpreted identically
  // by both operators, and by their isLessThanOrEqual/isGreatThanOrEqual
  // derivatives (defined as !greaterThan/!lessThan in filterFnTypes). NaN
  // contract: a non-numeric operand parses to NaN and NaN < x / x < NaN is
  // false, so a non-numeric value never satisfies a numeric < (or >).
  return parseFloat(value) < parseFloat(filterValue);
};
// Parse a stored date string into a Date the same way both date predicates
// historically did: Date.parse-able strings parse directly; otherwise fall back
// to an epoch-ms integer (e.g. a numeric timestamp string). Returns an Invalid
// Date (NaN-valued) for anything unparseable.
const parseDateOperand = (raw: string): Date =>
  isNaN(Date.parse(raw)) ? new Date(parseInt(raw)) : new Date(raw);

// Truncate a Date to the local-midnight start of its calendar day, so date
// filters compare at DAY granularity rather than instant granularity. Returns
// NaN for an Invalid Date (the NaN propagates, keeping malformed dates
// fail-closed in the comparisons below). ADR 0032 (Option A1).
const startOfDayValue = (d: Date): number => {
  const t = d.valueOf();
  if (isNaN(t)) return NaN;
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).valueOf();
};

// ADR 0032 (A1 + B1): date filters are DAY-granular and BOTH-INCLUSIVE.
// "after" matches a value whose calendar day is on-or-after the filter day;
// "before" matches a value whose calendar day is on-or-before the filter day.
// A row "on the boundary day" therefore satisfies both operators consistently,
// independent of any time-of-day stored in the row value. An unparseable value
// truncates to NaN, and every NaN comparison is false, so a malformed date stays
// invisible to both filters (fail-closed — never silently satisfies a date
// filter), matching the documented NaN convention on lessThan/greaterThan.
export const dateAfter: FilterFunction = (
  value: string,
  filterValue: string
): boolean => {
  const valueDay = startOfDayValue(parseDateOperand(value));
  const filterDay = startOfDayValue(parseDateOperand(filterValue));
  return valueDay >= filterDay;
};

export const dateBefore: FilterFunction = (
  value: string,
  filterValue: string
): boolean => {
  const valueDay = startOfDayValue(parseDateOperand(value));
  const filterDay = startOfDayValue(parseDateOperand(filterValue));
  return valueDay <= filterDay;
};

export const listIncludes: FilterFunction = (
  value: string,
  filterValue: string
): boolean => {
  const valueList = value ? parseMultiString(value) : [];
  const strings = filterValue ? parseMultiString(filterValue) : [];
  if (valueList.length == 0) return false;
  
  return strings.some((f) => valueList.some((g) => g == f));
};

// ADR 0032 (C1): "is this date" matches the same FULL calendar date — year,
// month and day. (Year was previously ignored, so e.g. 15 Mar 2024 matched
// 15 Mar 1999; that cross-year match was almost certainly unintended for an
// explicit date filter.) The intentionally year-agnostic "anniversary / same
// day-of-year as today" behavior remains in isSameDayAsToday by design. An
// unparseable operand yields NaN from a getter comparison (NaN === NaN is
// false), so a bad date still fails closed.
export const isSameDay: FilterFunction = (value: string, filterValue: string) : boolean => {
  if (!value) return false;
  const inputDate = new Date(`${value.toString().replace(".", ':')}`);

  // Get the filter date
  const currentDate = new Date(`${filterValue}`);
  // Compare the full calendar date: year, month and day.
  return inputDate.getFullYear() === currentDate.getFullYear()
    && inputDate.getMonth() === currentDate.getMonth()
    && inputDate.getDate() === currentDate.getDate();
}

export const isSameDayAsToday: FilterFunction = (value: string) : boolean => {
  if (!value) return false;
  const inputDate = new Date(`${value.toString()}T00:00`);

  // Get the current date
  const currentDate = new Date();
  // Compare the month and date
  return inputDate.getMonth() === currentDate.getMonth() && inputDate.getDate() === currentDate.getDate();
}

// FAIL-OPEN CONTRACT (ADR 0034, ratified — RECOMMENDED Option A).
// The per-row filter dispatcher returns `true` (row stays VISIBLE) whenever it
// cannot interpret the predicate: a null `col`, a null `filter`, a missing
// `filter.fn`, or an `fn` that is not a key in `filterFnTypes`. Only a KNOWN
// operator runs and can narrow the row set; an UNREADABLE constraint degrades to
// a no-op rather than hiding data.
//
// Why fail-open (not fail-closed) for an *unknown operator*: this is a
// single-user vault. Hiding the owner's own rows on an unrecognizable operator
// is the strictly worse failure mode — the user cannot tell "correctly filtered
// out" from "my notes vanished" — and it is forward-incompatible with a newer
// schema that emits an operator this build does not yet know. (Contrast ADR 0032:
// a malformed *value* inside a *known* date filter fails CLOSED, because there
// the constraint's intent is real and a garbage value must not silently satisfy
// it. Operator-level unknown != value-level malformed — they resolve oppositely
// by design.)
//
// This is the DEFENSIVE BACKSTOP, not the primary guard: `validatePredicate`
// (predicate.tsx, via `cleanPredicateType`) already STRIPS unknown fns at
// write/load time and now warns once when it does so. Every production call site
// also fails open of its own accord (`col ? … : true`, `reduce(…, true)`), so
// keeping the dispatcher fail-open is consistent end-to-end. The three
// characterization assertions in filter.test.ts (unknown fn / missing fn / null
// filter all return true) pin this contract; flipping them is a deliberate,
// reviewed decision, not an accident.
export const filterReturnForCol = (
  col: SpaceTableColumn,
  filter: Filter,
  row: DBRow,
  properties: Record<string, any>
) => {
  if (!col) return true;

  const filterType = filterFnTypes[filter?.fn];
  let result = true; // ADR 0034 fail-open default: visible until a KNOWN fn narrows.
  if (filterType && filterType.fn) {
    const value = (filter.fType == 'property') ? properties[filter.value] : filter.value;
    const rowValue = col.type == 'flex' ? parseFlexValue(row[filter.field])?.value : row[filter.field];
    result = filterType.fn(rowValue, value);
  }

  return result;
};


