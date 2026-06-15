import { format, parseISO } from 'date-fns';
import { isDate, isFinite, isString } from 'lodash';
import { RRule } from 'rrule';
import { MakeMDSettings } from 'shared/types/settings';

export const isValidDate = (d: Date) => {
  return d instanceof Date && !isNaN(d as any);
};

export const isoDateFormat = `yyyy-MM-dd'T'HH:mm:ss`;

export const formatDate = (
  settings: MakeMDSettings,
  date: Date,
  dateFormat?: string,
) => {
  let dateString;
  
  try {
    const hasTime =
    date.getHours() > 0 || date.getMinutes() > 0 || date.getSeconds() > 0;
    dateString = format(
      date,
      dateFormat?.length > 0
        ? dateFormat
        : hasTime
          ? `${settings.defaultDateFormat} ${settings.defaultTimeFormat}`
          : settings.defaultDateFormat,
    );
  } catch (e) {
    dateString = '';
  }
  return dateString;
};

export const parseDate = (str: any) => {
  if (!str) return null;
  if (isFinite(str)) {
    return new Date(str);
  }
  if (isString(str)) {
    // Handle date-only strings (yyyy-MM-dd) as local dates to avoid timezone shift
    // parseISO treats these as UTC which can cause off-by-one day issues
    if (/^\d{4}-\d{2}-\d{2}$/.test(str)) {
      const [year, month, day] = str.split('-').map(Number);
      return new Date(year, month - 1, day);
    }
    return parseISO(str);
  }
  if (isDate(str)) return str;
  return null;
};

export const getFreqValue = (freq: string) => {
  if (freq == 'DAILY') return RRule.DAILY;
  if (freq == 'WEEKLY') return RRule.WEEKLY;
  if (freq == 'MONTHLY') return RRule.MONTHLY;
  if (freq == 'YEARLY') return RRule.YEARLY;
  if (freq == 'HOURLY') return RRule.HOURLY;
};
export const getWeekdayValue = (weekday: string) => {
  if (weekday == 'SU') return 6;
  if (weekday == 'MO') return 0;
  if (weekday == 'TU') return 1;
  if (weekday == 'WE') return 2;
  if (weekday == 'TH') return 3;
  if (weekday == 'FR') return 4;
  if (weekday == 'SA') return 5;
};

/**
 * Shape of a parsed `repeat` recurrence definition as authored by the user
 * (file/frontmatter-canonical JSON, e.g. `{ "freq": "WEEKLY", "byweekday": ["MO"] }`).
 * Every field is untrusted: tokens may be unknown, wrong-case, or missing.
 */
export type RepeatDefinition = {
  freq?: string;
  count?: unknown;
  interval?: unknown;
  byweekday?: unknown;
  wkst?: string;
  until?: unknown;
};

/**
 * Validated, ready-to-spread option object for `new RRule(...)`. Every key is
 * guaranteed safe for rrule: there are no `undefined`/`null`/`NaN` values,
 * `interval` is always >= 1 (a negative interval makes `.between()` loop
 * forever), and `byweekday`/`wkst` only ever contain known weekday integers.
 */
export type RRuleOptions = {
  dtstart: Date;
  freq: number;
  count?: number;
  interval: number;
  byweekday?: number[];
  wkst?: number;
  until?: Date;
};

/**
 * Pure, validated builder for the recurrence options handed to rrule.
 *
 * Why this exists (Notidian-l8l): `getFreqValue`/`getWeekdayValue` return
 * `undefined` for unknown or wrong-case tokens. The previous inline callers
 * built `byweekday` as `repeatDef.byweekday.map(getWeekdayValue)`, so an unknown
 * weekday (e.g. authoring `byweekday: ["mo"]` or `["MON"]`) produced
 * `[undefined]`. That array is itself defined/truthy, so the callers'
 * `value !== undefined` filter did NOT drop it, and `new RRule(...).between()`
 * then THREW `Cannot read properties of undefined (reading 'n')`, crashing the
 * calendar render (reproduced offline against rrule).
 *
 * Contract:
 *  - Returns `null` (skip recurrence) when `freq` is missing or not a known
 *    token — matching the old behavior where an unfilterable invalid freq would
 *    otherwise be silently dropped and leave a freq-less, invalid RRule.
 *  - `byweekday`/`wkst` tokens are mapped through `getWeekdayValue`; unknown
 *    tokens are dropped. If every `byweekday` token is unknown, the key is
 *    omitted entirely (rrule treats this as "no weekday restriction") rather
 *    than passed as `[undefined]`.
 *  - `count` is parsed and capped at <= 100 (the existing cap).
 *  - `interval` is `parseInt`-ed and clamped to >= 1 (fallback 1). A
 *    non-positive interval is rejected because a negative one makes rrule's
 *    `.between()` loop forever (a render-thread DoS from untrusted frontmatter).
 *  - `until` is taken verbatim from the caller (each caller owns its own window
 *    clamping); it is included only when it is a valid Date.
 *
 * This is deliberately UI-agnostic: callers compute `dtstart` and the already
 * clamped `until` from their own view window and pass them in.
 */
export const buildRepeatRRuleOptions = (
  repeatDef: RepeatDefinition | null | undefined,
  base: { dtstart: Date; until?: Date | null },
): RRuleOptions | null => {
  if (!repeatDef) return null;

  const freq = getFreqValue(repeatDef.freq as string);
  // Unknown/missing freq is invalid to rrule — skip recurrence entirely.
  if (freq === undefined) return null;

  const options: RRuleOptions = {
    dtstart: base.dtstart,
    freq,
    interval: 1,
  };

  // interval: parseInt with a fallback to 1 (matches DayView; parity for
  // MonthWeekRow, whose bare parseInt(NaN) was filtered out -> rrule default 1).
  // Must be >= 1: a negative interval (e.g. untrusted frontmatter
  // `{"freq":"DAILY","interval":-1}`) makes `new RRule(...).between(...)` enter a
  // synchronous infinite loop, freezing the render thread (verified against the
  // project's rrule). NaN, 0, and negatives all keep the default of 1.
  const parsedInterval = parseInt(repeatDef.interval as string, 10);
  if (!isNaN(parsedInterval) && parsedInterval >= 1)
    options.interval = parsedInterval;

  // count: parse + cap at 100. Omitted when absent / unparseable.
  if (repeatDef.count !== undefined && repeatDef.count !== null) {
    const parsedCount = parseInt(repeatDef.count as string, 10);
    if (!isNaN(parsedCount)) options.count = Math.min(parsedCount, 100);
  }

  // byweekday: drop unknown tokens; omit the key entirely if none survive so we
  // never hand rrule a `[undefined]` array (the crash this bead fixes).
  if (Array.isArray(repeatDef.byweekday)) {
    const days = repeatDef.byweekday
      .map((d) => getWeekdayValue(d as string))
      .filter(
        (v): v is NonNullable<ReturnType<typeof getWeekdayValue>> =>
          v !== undefined,
      );
    if (days.length > 0) options.byweekday = days;
  }

  // wkst: same undefined-on-unknown guard.
  const wkst = getWeekdayValue(repeatDef.wkst as string);
  if (wkst !== undefined) options.wkst = wkst;

  // until: caller-clamped; included only when valid.
  if (base.until && isValidDate(base.until)) options.until = base.until;

  return options;
};
