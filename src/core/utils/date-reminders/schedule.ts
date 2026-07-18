import { RRule } from "rrule";
import { isValid, parseISO } from "date-fns";

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_LEAD_MS = 365 * DAY_MS;
export const REMINDER_CATCH_UP_MS = 7 * DAY_MS;
export const MAX_REMINDER_OCCURRENCES_PER_ROW = 100;

const FREQUENCIES = {
  DAILY: RRule.DAILY,
  WEEKLY: RRule.WEEKLY,
  MONTHLY: RRule.MONTHLY,
  YEARLY: RRule.YEARLY,
  HOURLY: RRule.HOURLY,
} as const;

const WEEKDAYS = {
  MO: RRule.MO,
  TU: RRule.TU,
  WE: RRule.WE,
  TH: RRule.TH,
  FR: RRule.FR,
  SA: RRule.SA,
  SU: RRule.SU,
} as const;

type Frequency = keyof typeof FREQUENCIES;
type Weekday = keyof typeof WEEKDAYS;
type RecurrenceMode = "LOCAL" | "ABSOLUTE";

export type StrictRepeat = {
  freq: Frequency;
  interval: number;
  count?: number;
  byweekday?: Weekday[];
  until?: Date;
  wkst?: Weekday;
};

export type ReminderSchedule = {
  due: Date;
  beforeMs: number;
  repeat: StrictRepeat | null;
  recurrenceMode: RecurrenceMode;
  fingerprint: string;
};

export type DueReminderOccurrence = {
  occurrenceStartMs: number;
  reminderAtMs: number;
};

export type DueReminderOccurrences = DueReminderOccurrence[] & {
  truncated: boolean;
};

export type ReminderExpansionOptions = {
  afterOccurrenceStartMs?: number;
  maxOccurrences?: number;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);

const hasOnlyKeys = (value: Record<string, unknown>, allowed: string[]) =>
  Object.keys(value).every((key) => allowed.includes(key));

type ParsedStrictDate = {
  date: Date;
  recurrenceMode: RecurrenceMode;
};

const parseStrictDate = (value: unknown): ParsedStrictDate | null => {
  if (value instanceof Date) {
    return Number.isFinite(value.getTime())
      ? { date: new Date(value.getTime()), recurrenceMode: "ABSOLUTE" }
      : null;
  }
  if (typeof value !== "string") return null;
  if (
    !/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})?)?$/.test(
      value,
    )
  )
    return null;
  const numericOffset = /[+-](\d{2}):(\d{2})$/.exec(value);
  if (
    numericOffset &&
    (Number(numericOffset[1]) > 23 || Number(numericOffset[2]) > 59)
  )
    return null;
  const date = parseISO(value);
  if (!isValid(date)) return null;
  return {
    date,
    recurrenceMode: /(?:Z|[+-]\d{2}:\d{2})$/.test(value)
      ? "ABSOLUTE"
      : "LOCAL",
  };
};

const toFloatingLocalDate = (date: Date): Date =>
  new Date(
    Date.UTC(
      date.getFullYear(),
      date.getMonth(),
      date.getDate(),
      date.getHours(),
      date.getMinutes(),
      date.getSeconds(),
      date.getMilliseconds(),
    ),
  );

const fromFloatingLocalDate = (date: Date): Date =>
  new Date(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate(),
    date.getUTCHours(),
    date.getUTCMinutes(),
    date.getUTCSeconds(),
    date.getUTCMilliseconds(),
  );

const parseDuration = (value: unknown): number | null => {
  if (typeof value !== "string") return null;
  const weekMatch = /^P(\d+)W$/.exec(value);
  const dayTimeMatch =
    /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(value);
  if (
    dayTimeMatch &&
    value.includes("T") &&
    dayTimeMatch.slice(2).every((part) => part === undefined)
  )
    return null;
  if (
    !weekMatch &&
    (!dayTimeMatch || dayTimeMatch.slice(1).every((part) => part === undefined))
  )
    return null;
  const [weeks, days, hours, minutes, seconds] = weekMatch
    ? [Number(weekMatch[1]), 0, 0, 0, 0]
    : [0, ...dayTimeMatch!.slice(1).map((part) => Number(part ?? 0))];
  const totalMs =
    (((weeks * 7 + days) * 24 + hours) * 60 * 60 + minutes * 60 + seconds) *
    1000;
  return Number.isSafeInteger(totalMs) && totalMs <= MAX_LEAD_MS
    ? totalMs
    : null;
};

const parseRepeat = (value: unknown, due: Date): StrictRepeat | null | false => {
  if (value === undefined) return null;
  if (value === null) return false;
  if (!isRecord(value)) return false;
  if (
    !hasOnlyKeys(value, [
      "freq",
      "interval",
      "count",
      "byweekday",
      "until",
      "wkst",
    ]) ||
    typeof value.freq !== "string" ||
    !(value.freq in FREQUENCIES)
  )
    return false;
  const interval = value.interval;
  if (!Number.isSafeInteger(interval) || (interval as number) <= 0) return false;

  const repeat: StrictRepeat = {
    freq: value.freq as Frequency,
    interval: interval as number,
  };
  if (value.count !== undefined) {
    if (
      !Number.isInteger(value.count) ||
      (value.count as number) <= 0 ||
      (value.count as number) > MAX_REMINDER_OCCURRENCES_PER_ROW
    )
      return false;
    repeat.count = value.count as number;
  }
  if (value.byweekday !== undefined) {
    if (
      !Array.isArray(value.byweekday) ||
      value.byweekday.length === 0 ||
      !value.byweekday.every(
        (day): day is Weekday => typeof day === "string" && day in WEEKDAYS,
      )
    )
      return false;
    repeat.byweekday = Array.from(new Set(value.byweekday)).sort();
  }
  if (value.wkst !== undefined) {
    if (typeof value.wkst !== "string" || !(value.wkst in WEEKDAYS))
      return false;
    repeat.wkst = value.wkst as Weekday;
  }
  if (value.until !== undefined) {
    const parsedUntil = parseStrictDate(value.until);
    const until = parsedUntil?.date ?? null;
    if (until && typeof value.until === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value.until)) {
      until.setHours(23, 59, 59, 999);
    }
    if (!until || until.getTime() < due.getTime()) return false;
    repeat.until = until;
  }
  return repeat;
};

const normalizedRepeat = (repeat: StrictRepeat | null) =>
  repeat
    ? {
        freq: repeat.freq,
        interval: repeat.interval,
        ...(repeat.byweekday ? { byweekday: repeat.byweekday } : {}),
        ...(repeat.count !== undefined ? { count: repeat.count } : {}),
        ...(repeat.until ? { until: repeat.until.toISOString() } : {}),
        ...(repeat.wkst ? { wkst: repeat.wkst } : {}),
      }
    : null;

export const parseReminderSchedule = (
  metadata: unknown,
): ReminderSchedule | null => {
  if (!isRecord(metadata)) return null;
  const parsedDue = parseStrictDate(metadata.due);
  if (!parsedDue || !isRecord(metadata.reminder)) return null;
  const { date: due, recurrenceMode } = parsedDue;
  if (
    !hasOnlyKeys(metadata.reminder, ["before"]) ||
    !("before" in metadata.reminder)
  )
    return null;
  const beforeMs = parseDuration(metadata.reminder.before);
  if (beforeMs === null) return null;
  const repeat = parseRepeat(metadata.repeat, due);
  if (repeat === false) return null;
  return {
    due,
    beforeMs,
    repeat,
    recurrenceMode,
    fingerprint: JSON.stringify({
      due: due.toISOString(),
      recurrenceMode,
      reminder: { before: `PT${beforeMs / 1000}S` },
      repeat: normalizedRepeat(repeat),
    }),
  };
};

export const expandDueReminderOccurrences = (
  schedule: ReminderSchedule,
  now: Date,
  continuation: ReminderExpansionOptions = {},
): DueReminderOccurrences => {
  const requestedLimit = continuation.maxOccurrences;
  const occurrenceLimit = requestedLimit === undefined
    ? MAX_REMINDER_OCCURRENCES_PER_ROW
    : Math.min(
        MAX_REMINDER_OCCURRENCES_PER_ROW,
        Math.max(0, Math.trunc(requestedLimit)),
      ) || 0;
  const nowMs = now.getTime();
  const reminderWindowStart = nowMs - REMINDER_CATCH_UP_MS;
  const occurrenceWindowStart = new Date(
    Math.max(
      reminderWindowStart + schedule.beforeMs,
      continuation.afterOccurrenceStartMs === undefined
        ? Number.NEGATIVE_INFINITY
        : continuation.afterOccurrenceStartMs + 1,
    ),
  );
  const occurrenceWindowEnd = new Date(nowMs + schedule.beforeMs);
  let starts: Date[];

  if (!schedule.repeat) {
    starts = [schedule.due];
  } else {
    const repeat = schedule.repeat;
    const localRecurrence = schedule.recurrenceMode === "LOCAL";
    const rule = new RRule({
      dtstart: localRecurrence
        ? toFloatingLocalDate(schedule.due)
        : schedule.due,
      freq: FREQUENCIES[repeat.freq],
      interval: repeat.interval,
      ...(repeat.count !== undefined ? { count: repeat.count } : {}),
      ...(repeat.byweekday
        ? { byweekday: repeat.byweekday.map((day) => WEEKDAYS[day]) }
        : {}),
      ...(repeat.until
        ? {
            until: localRecurrence
              ? toFloatingLocalDate(repeat.until)
              : repeat.until,
          }
        : {}),
      ...(repeat.wkst ? { wkst: WEEKDAYS[repeat.wkst] } : {}),
    });
    starts = rule.between(
      localRecurrence
        ? toFloatingLocalDate(occurrenceWindowStart)
        : occurrenceWindowStart,
      localRecurrence
        ? toFloatingLocalDate(occurrenceWindowEnd)
        : occurrenceWindowEnd,
      true,
      (_date, index) => index < occurrenceLimit + 1,
    );
    if (localRecurrence) starts = starts.map(fromFloatingLocalDate);
  }

  let occurrences = starts
    .map((start) => ({
      occurrenceStartMs: start.getTime(),
      reminderAtMs: start.getTime() - schedule.beforeMs,
    }))
    .filter(
      ({ occurrenceStartMs, reminderAtMs }) =>
        (continuation.afterOccurrenceStartMs === undefined ||
          occurrenceStartMs > continuation.afterOccurrenceStartMs) &&
        reminderAtMs >= reminderWindowStart &&
        reminderAtMs <= nowMs,
    ) as DueReminderOccurrences;
  const truncated = occurrences.length > occurrenceLimit;
  if (truncated) {
    occurrences = occurrences.slice(0, occurrenceLimit) as DueReminderOccurrences;
  }
  Object.defineProperty(occurrences, "truncated", {
    value: truncated,
    enumerable: false,
  });
  return occurrences;
};
