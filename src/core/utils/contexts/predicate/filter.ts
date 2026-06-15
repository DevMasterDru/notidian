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

export const startsWith: FilterFunction = (
  value: string,
  filterValue: string
): boolean => {
  return (value ?? "").startsWith(filterValue);
}

export const endsWith: FilterFunction = (
  value: string,
  filterValue: string
): boolean => {
  return (value ?? "").endsWith(filterValue);
}

export const lengthEquals: FilterFunction = (
  value: string,
  filterValue: string
): boolean => {
  // Nullish-guard the value like every sibling text predicate ((value ?? "")) so
  // an empty cell measures as length 0 instead of throwing on value.length. NaN
  // contract: a non-numeric filterValue parses to NaN and length == NaN is always
  // false, so a non-numeric operand makes every length fail (fail-closed) — mirrors
  // the NaN convention documented on lessThan/greaterThan.
  return (value ?? "").length == parseInt(filterValue);
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
  return (value ?? "").length == 0;
};

export const stringCompare: FilterFunction = (
  value: string,
  filterValue: string
): boolean => {
  return (value ?? "")
    .toLowerCase()
    .includes((filterValue ?? "").toLowerCase());
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


