import { parseFlexValue } from "core/schemas/parseFieldValue";
import { DBRow, SpaceTableColumn } from "shared/types/mdb";
import { Filter } from "shared/types/predicate";
import { parseMultiString } from "utils/parsers";
import { filterFnTypes } from "./filterFns/filterFnTypes";


export type FilterFunctionType = Record<
  string,
  {
    type: string[];
    fn: FilterFunction;
    valueType: string;
    // Some operators are valid only for specially named fields even though
    // their storage type is ordinary (for example recurrence on an option).
    // Generic menus omit scoped entries; the owning UI appends them only when
    // its field-name contract matches.
    scopedFields?: string[];
  }
>;
type FilterFunction = (v: any, f: any, row?: DBRow) => boolean;

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

// ADR 0066 / Notidian-l12a: a now-relative offset token withinLast/olderThan
// (below) accept in place of an absolute date string -- an integer amount
// immediately followed by a unit letter, e.g. '7d' (7 days), '2w' (2 weeks),
// '1m' (1 calendar month), '1y' (1 calendar year). No sign, no 'now'/'today'
// prefix.
//
// This grammar is kept deliberately OUT of parseDateOperand. An earlier
// attempt at this bead folded relative-token parsing straight into
// parseDateOperand (shared by dateAfter/dateBefore) and, as an unreviewed
// side effect, made THOSE two existing absolute-date operators also silently
// accept a relative token -- a behavior change nobody asked for, which failed
// review. Isolating the grammar in its own sibling helper means
// dateAfter/dateBefore's operand parsing is completely untouched; only
// withinLast/olderThan resolve relative tokens.
const RELATIVE_TOKEN_PATTERN = /^(\d+)([dwmy])$/;

export type RelativeDateUnit = "d" | "w" | "m" | "y";

export const parseRelativeDateToken = (
  token: unknown
): { amount: string; unit: RelativeDateUnit } | null => {
  const match = RELATIVE_TOKEN_PATTERN.exec(
    typeof token === "string" ? token : ""
  );
  return match
    ? { amount: match[1], unit: match[2] as RelativeDateUnit }
    : null;
};

// Resolve a relative-date token (see RELATIVE_TOKEN_PATTERN) to the absolute
// Date it denotes: `now` stepped back the given amount of units, then
// truncated to that day's local start-of-day (so the result is always a
// whole calendar day, matching the day-granular convention startOfDayValue
// already enforces for every other date predicate in this file). `now`
// defaults to the real current time but is injectable for deterministic
// testing.
//
// Units: d = days, w = weeks (7 days), m = calendar months, y = calendar
// years. Month/year subtraction selects the target calendar period first and
// clamps the original day to that period's last valid day (ADR 0062), avoiding
// native Date rollover for month-end and leap-day operands.
//
// Returns an Invalid Date (NaN-valued) for any token that doesn't match
// RELATIVE_TOKEN_PATTERN, so a malformed token flows into the same
// NaN-propagating, fail-closed comparisons as a malformed absolute date
// (ADR 0032 B1) -- withinLast/olderThan below never throw and never silently
// match on a broken token.
export const resolveRelativeDateOperand = (
  token: string,
  now: Date = new Date()
): Date => {
  const parsed = parseRelativeDateToken(token);
  if (!parsed) return new Date(NaN);
  const amount = parseInt(parsed.amount, 10);
  const unit = parsed.unit;
  const threshold = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (unit === "d") threshold.setDate(threshold.getDate() - amount);
  else if (unit === "w") threshold.setDate(threshold.getDate() - amount * 7);
  else {
    const originalDay = threshold.getDate();
    const targetMonthIndex =
      threshold.getFullYear() * 12 +
      threshold.getMonth() -
      (unit === "m" ? amount : amount * 12);
    const targetYear = Math.floor(targetMonthIndex / 12);
    const targetMonth = ((targetMonthIndex % 12) + 12) % 12;
    const targetPeriodEnd = new Date(0);
    targetPeriodEnd.setHours(0, 0, 0, 0);
    targetPeriodEnd.setFullYear(targetYear, targetMonth + 1, 0);
    threshold.setDate(1);
    threshold.setFullYear(
      targetYear,
      targetMonth,
      Math.min(originalDay, targetPeriodEnd.getDate())
    );
  }
  return threshold;
};

// ADR 0066 / Notidian-l12a: now-relative date filters for the Topic Hub
// Recently-Closed/Stalled overlays (Notidian-ioxi is the render-path
// consumer). `token` is a relative offset per RELATIVE_TOKEN_PATTERN (e.g.
// '7d', '2w', '1m', '1y'), resolved against `now` via
// resolveRelativeDateOperand. Day-granular and boundary-inclusive like
// dateAfter (ADR 0032 A1): a value dated exactly on the threshold day counts
// as "within". Fail-closed like every date predicate in this file: a
// malformed `value` OR a malformed `token` truncates to NaN, and every NaN
// comparison is false, so a broken relative-date filter never silently
// narrows or widens the row set.
export const withinLast: FilterFunction = (
  value: string,
  token: string
): boolean => {
  const valueDay = startOfDayValue(parseDateOperand(value));
  const thresholdDay = startOfDayValue(resolveRelativeDateOperand(token));
  return valueDay >= thresholdDay;
};

// The strict complement of withinLast (< vs withinLast's inclusive >=): for
// any pair of valid operands exactly one of withinLast/olderThan is true,
// with no gap or overlap at the threshold day itself. Computed independently
// here (NOT `!withinLast(...)`) so that a malformed value or token is
// invisible to BOTH operators via its own NaN comparison, rather than
// olderThan becoming (wrongly) visible by virtue of negating withinLast's
// fail-closed false (ADR 0032 B1 parity: fail-closed for both, not fail-open
// for one).
export const olderThan: FilterFunction = (
  value: string,
  token: string
): boolean => {
  const valueDay = startOfDayValue(parseDateOperand(value));
  const thresholdDay = startOfDayValue(resolveRelativeDateOperand(token));
  return valueDay < thresholdDay;
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
    // ADR 0034 fail-open at the SINK, not just the caller. A property-fType filter
    // resolves its value from `properties`, but `properties` can be null/undefined
    // during load or in views whose spaceCache hasn't populated (the 6ba6f3d caller
    // fix made `spaceCache?.properties` null-safe, but `?.` yields `undefined`,
    // which STILL throws on `properties[filter.value]` here). Treat a nullish cache
    // as an empty record so the lookup resolves to `undefined` — which the
    // FilterFunctions already guard (-> fail-open visible) — instead of crashing the
    // whole context render. Pinned by filter.test.ts (property-fType + null/undefined
    // props -> no throw, fail-open true).
    const value = (filter.fType == 'property') ? (properties ?? {})[filter.value] : filter.value;
    const rowValue = col.type == 'flex' ? parseFlexValue(row[filter.field])?.value : row[filter.field];
    result = filterType.fn(rowValue, value, row);
  }

  return result;
};
