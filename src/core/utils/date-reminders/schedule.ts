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

const hasOwnToken = <T extends object>(
  tokens: T,
  value: unknown,
): value is keyof T =>
  typeof value === "string" &&
  Object.prototype.hasOwnProperty.call(tokens, value);

export type Frequency = keyof typeof FREQUENCIES;
export type Weekday = keyof typeof WEEKDAYS;
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

export type StrictReminder = {
  before: string;
};

export type ScheduleValueParseResult<T> = {
  value: T | null;
  error: string | null;
  legacy: boolean;
};

const mappingValue = (
  value: unknown,
  label: string,
): { value: Record<string, unknown> | null; legacy: boolean; error: string | null } => {
  if (value === undefined || value === null || value === "") {
    return { value: null, legacy: false, error: null };
  }
  if (isRecord(value)) return { value, legacy: false, error: null };
  if (typeof value !== "string") {
    return { value: null, legacy: false, error: `${label} must be a mapping.` };
  }
  try {
    const parsed = JSON.parse(value);
    return isRecord(parsed)
      ? { value: parsed, legacy: true, error: null }
      : { value: null, legacy: true, error: `${label} must be a mapping.` };
  } catch {
    return { value: null, legacy: true, error: `${label} must be a mapping.` };
  }
};

export const parseRepeatRule = (
  value: unknown,
  dueValue: unknown,
): ScheduleValueParseResult<StrictRepeat> => {
  const mapping = mappingValue(value, "Repeat rule");
  if (mapping.error || !mapping.value) {
    return { value: null, error: mapping.error, legacy: mapping.legacy };
  }
  const due = parseStrictDate(dueValue)?.date;
  if (!due) {
    return { value: null, error: "Due date is invalid.", legacy: mapping.legacy };
  }
  const unknown = Object.keys(mapping.value).filter(
    (key) => !["freq", "interval", "count", "byweekday", "until", "wkst"].includes(key),
  );
  if (unknown.length > 0) {
    return {
      value: null,
      error: `Repeat rule contains unknown key: ${unknown[0]}.`,
      legacy: mapping.legacy,
    };
  }
  if (
    !hasOwnToken(FREQUENCIES, mapping.value.freq)
  ) {
    return {
      value: null,
      error: "Repeat frequency must be DAILY, WEEKLY, MONTHLY, YEARLY, or HOURLY.",
      legacy: mapping.legacy,
    };
  }
  if (
    !Number.isSafeInteger(mapping.value.interval) ||
    (mapping.value.interval as number) <= 0
  ) {
    return {
      value: null,
      error: "Repeat interval must be a positive integer.",
      legacy: mapping.legacy,
    };
  }

  const repeat: StrictRepeat = {
    freq: mapping.value.freq as Frequency,
    interval: mapping.value.interval as number,
  };
  if (mapping.value.count !== undefined) {
    if (
      !Number.isInteger(mapping.value.count) ||
      (mapping.value.count as number) <= 0 ||
      (mapping.value.count as number) > MAX_REMINDER_OCCURRENCES_PER_ROW
    ) {
      return {
        value: null,
        error: "Repeat count must be a positive integer no greater than 100.",
        legacy: mapping.legacy,
      };
    }
    repeat.count = mapping.value.count as number;
  }
  if (mapping.value.byweekday !== undefined) {
    if (
      !Array.isArray(mapping.value.byweekday) ||
      mapping.value.byweekday.length === 0 ||
      !mapping.value.byweekday.every(
        (day): day is Weekday => hasOwnToken(WEEKDAYS, day),
      )
    ) {
      return {
        value: null,
        error: "Every repeat weekday must be MO, TU, WE, TH, FR, SA, or SU.",
        legacy: mapping.legacy,
      };
    }
    repeat.byweekday = Array.from(new Set(mapping.value.byweekday));
  }
  if (mapping.value.wkst !== undefined) {
    if (
      !hasOwnToken(WEEKDAYS, mapping.value.wkst)
    ) {
      return {
        value: null,
        error: "Repeat week start must be MO, TU, WE, TH, FR, SA, or SU.",
        legacy: mapping.legacy,
      };
    }
    repeat.wkst = mapping.value.wkst as Weekday;
  }
  if (mapping.value.until !== undefined) {
    const parsedUntil = parseStrictDate(mapping.value.until);
    const until = parsedUntil?.date;
    if (!until) {
      return {
        value: null,
        error: "Repeat until must be a valid date.",
        legacy: mapping.legacy,
      };
    }
    if (
      typeof mapping.value.until === "string" &&
      /^\d{4}-\d{2}-\d{2}$/.test(mapping.value.until)
    ) {
      until.setHours(23, 59, 59, 999);
    }
    if (until.getTime() < due.getTime()) {
      return {
        value: null,
        error: "Repeat until cannot be before the due date.",
        legacy: mapping.legacy,
      };
    }
    repeat.until = until;
  }
  return { value: repeat, error: null, legacy: mapping.legacy };
};

export const serializeRepeatRule = (
  repeat: StrictRepeat | null,
): Record<string, unknown> | null => {
  if (!repeat) return null;
  const until = repeat.until;
  const dateOnlyUntil =
    until &&
    until.getHours() === 23 &&
    until.getMinutes() === 59 &&
    until.getSeconds() === 59 &&
    until.getMilliseconds() === 999;
  return {
    freq: repeat.freq,
    interval: repeat.interval,
    ...(repeat.byweekday ? { byweekday: [...repeat.byweekday] } : {}),
    ...(repeat.count !== undefined ? { count: repeat.count } : {}),
    ...(until
      ? {
          until: dateOnlyUntil
            ? `${until.getFullYear()}-${String(until.getMonth() + 1).padStart(2, "0")}-${String(until.getDate()).padStart(2, "0")}`
            : until.toISOString(),
        }
      : {}),
    ...(repeat.wkst ? { wkst: repeat.wkst } : {}),
  };
};

export const parseReminderRule = (
  value: unknown,
): ScheduleValueParseResult<StrictReminder> => {
  const mapping = mappingValue(value, "Reminder");
  if (mapping.error || !mapping.value) {
    return { value: null, error: mapping.error, legacy: mapping.legacy };
  }
  const unknown = Object.keys(mapping.value).filter((key) => key !== "before");
  if (unknown.length > 0) {
    return {
      value: null,
      error: `Reminder contains unknown key: ${unknown[0]}.`,
      legacy: mapping.legacy,
    };
  }
  if (!("before" in mapping.value) || parseDuration(mapping.value.before) === null) {
    return {
      value: null,
      error: "Reminder before must be a valid ISO-8601 duration up to 365 days.",
      legacy: mapping.legacy,
    };
  }
  return {
    value: { before: mapping.value.before as string },
    error: null,
    legacy: mapping.legacy,
  };
};

export const serializeReminderRule = (
  reminder: StrictReminder | null,
): Record<string, unknown> | null =>
  reminder ? { before: reminder.before } : null;

const parseRepeat = (value: unknown, due: Date): StrictRepeat | null | false => {
  if (value === undefined) return null;
  if (value === null) return false;
  const parsed = parseRepeatRule(value, due);
  return parsed.error || !parsed.value
    ? false
    : {
        ...parsed.value,
        ...(parsed.value.byweekday
          ? { byweekday: [...parsed.value.byweekday].sort() }
          : {}),
      };
};

export type CalendarRecurrenceExpansion = {
  occurrences: Date[];
  error: string | null;
  truncated: boolean;
};

export type CalendarEventScheduleExpansion = {
  instances: Array<{ start: Date; end: Date }>;
  error: string | null;
  truncated: boolean;
};

export const expandCalendarRecurrence = ({
  due,
  repeat,
  windowStart,
  windowEnd,
  maxOccurrences = MAX_REMINDER_OCCURRENCES_PER_ROW,
}: {
  due: unknown;
  repeat: unknown;
  windowStart: Date;
  windowEnd: Date;
  maxOccurrences?: number;
}): CalendarRecurrenceExpansion => {
  const parsedDue = parseStrictDate(due);
  if (!parsedDue) {
    return { occurrences: [], error: "Due date is invalid.", truncated: false };
  }
  const baseInWindow =
    parsedDue.date >= windowStart && parsedDue.date <= windowEnd;
  if (repeat === undefined || repeat === null || repeat === "") {
    return {
      occurrences: baseInWindow ? [parsedDue.date] : [],
      error: null,
      truncated: false,
    };
  }
  const parsedRepeat = parseRepeatRule(repeat, due);
  if (parsedRepeat.error || !parsedRepeat.value) {
    return {
      occurrences: baseInWindow ? [parsedDue.date] : [],
      error: parsedRepeat.error ?? "Repeat rule is invalid.",
      truncated: false,
    };
  }

  const limit = Math.min(
    MAX_REMINDER_OCCURRENCES_PER_ROW,
    Math.max(0, Math.trunc(maxOccurrences)),
  );
  const localRecurrence = parsedDue.recurrenceMode === "LOCAL";
  const rule = new RRule({
    dtstart: localRecurrence
      ? toFloatingLocalDate(parsedDue.date)
      : parsedDue.date,
    freq: FREQUENCIES[parsedRepeat.value.freq],
    interval: parsedRepeat.value.interval,
    ...(parsedRepeat.value.count !== undefined
      ? { count: parsedRepeat.value.count }
      : {}),
    ...(parsedRepeat.value.byweekday
      ? {
          byweekday: parsedRepeat.value.byweekday.map((day) => WEEKDAYS[day]),
        }
      : {}),
    ...(parsedRepeat.value.until
      ? {
          until: localRecurrence
            ? toFloatingLocalDate(parsedRepeat.value.until)
            : parsedRepeat.value.until,
        }
      : {}),
    ...(parsedRepeat.value.wkst
      ? { wkst: WEEKDAYS[parsedRepeat.value.wkst] }
      : {}),
  });
  let starts = rule.between(
    localRecurrence ? toFloatingLocalDate(windowStart) : windowStart,
    localRecurrence ? toFloatingLocalDate(windowEnd) : windowEnd,
    true,
    (_date, index) => index < limit + 1,
  );
  if (localRecurrence) starts = starts.map(fromFloatingLocalDate);
  const truncated = starts.length > limit;
  return {
    occurrences: truncated ? starts.slice(0, limit) : starts,
    error: null,
    truncated,
  };
};

export const expandCalendarEventSchedule = ({
  due,
  repeat,
  selectedStart,
  selectedEnd,
  windowStart,
  windowEnd,
  maxOccurrences = MAX_REMINDER_OCCURRENCES_PER_ROW,
}: {
  due: unknown;
  repeat: unknown;
  selectedStart: Date;
  selectedEnd: Date;
  windowStart: Date;
  windowEnd: Date;
  maxOccurrences?: number;
}): CalendarEventScheduleExpansion => {
  const duration = selectedEnd.getTime() - selectedStart.getTime();
  const allDay =
    selectedStart.getHours() === 0 &&
    selectedStart.getMinutes() === 0 &&
    selectedStart.getSeconds() === 0 &&
    selectedStart.getMilliseconds() === 0 &&
    selectedEnd.getHours() === 0 &&
    selectedEnd.getMinutes() === 0 &&
    selectedEnd.getSeconds() === 0 &&
    selectedEnd.getMilliseconds() === 0;
  const calendarDaySpan = allDay
    ? Math.round(
        (Date.UTC(
          selectedEnd.getFullYear(),
          selectedEnd.getMonth(),
          selectedEnd.getDate(),
        ) -
          Date.UTC(
            selectedStart.getFullYear(),
            selectedStart.getMonth(),
            selectedStart.getDate(),
          )) /
          DAY_MS,
      )
    : null;
  const overlapLookupStart =
    calendarDaySpan !== null && calendarDaySpan > 0
      ? new Date(
          windowStart.getFullYear(),
          windowStart.getMonth(),
          windowStart.getDate() - calendarDaySpan,
          windowStart.getHours(),
          windowStart.getMinutes(),
          windowStart.getSeconds(),
          windowStart.getMilliseconds(),
        )
      : new Date(windowStart.getTime() - Math.max(0, duration));
  const expansion = expandCalendarRecurrence({
    due,
    repeat,
    windowStart: overlapLookupStart,
    windowEnd,
    maxOccurrences,
  });
  return {
    instances: expansion.occurrences
      .map((start) => ({
        start,
        end:
          calendarDaySpan !== null && calendarDaySpan >= 0
            ? new Date(
                start.getFullYear(),
                start.getMonth(),
                start.getDate() + calendarDaySpan,
                start.getHours(),
                start.getMinutes(),
                start.getSeconds(),
                start.getMilliseconds(),
              )
            : new Date(start.getTime() + duration),
      }))
      .filter(({ start, end }) => start <= windowEnd && end >= windowStart),
    error: expansion.error,
    truncated: expansion.truncated,
  };
};

export type DateScheduleValues = {
  due: unknown;
  repeat?: unknown;
  reminder?: unknown;
};

export const usesStrictDateSchedule = (
  settings: { dateScheduleAuthoring?: boolean } | null | undefined,
): boolean => settings?.dateScheduleAuthoring !== false;

export const calendarRepeatValue = (
  row: Record<string, unknown>,
  legacyRepeatKey: string | undefined,
  strict: boolean,
  canonicalProperty?: Record<string, unknown> | null,
  hasCanonicalSnapshot = false,
): unknown =>
  strict
    ? Object.prototype.hasOwnProperty.call(
        hasCanonicalSnapshot ? canonicalProperty ?? {} : row,
        "repeat",
      )
      ? (hasCanonicalSnapshot ? canonicalProperty : row)?.repeat
      : legacyRepeatKey
        ? row[legacyRepeatKey]
        : undefined
    : legacyRepeatKey
    ? row[legacyRepeatKey]
    : undefined;

export const calendarDueValue = (
  row: Record<string, unknown>,
  legacyDueKey: string,
  canonicalProperty?: Record<string, unknown> | null,
  hasCanonicalSnapshot = false,
): unknown => {
  const source = hasCanonicalSnapshot ? canonicalProperty ?? {} : row;
  return Object.prototype.hasOwnProperty.call(source, "due")
    ? source.due
    : row[legacyDueKey];
};

export type DateScheduleTransactionResult =
  | { ok: true }
  | { ok: false; conflict?: boolean; error?: string };

const comparableScheduleValue = (value: unknown): string => {
  const normalize = (input: unknown): unknown => {
    if (input instanceof Date) return input.toISOString();
    if (Array.isArray(input)) return input.map(normalize);
    if (isRecord(input)) {
      return Object.keys(input)
        .sort()
        .reduce<Record<string, unknown>>((result, key) => {
          result[key] = normalize(input[key]);
          return result;
        }, {});
    }
    return input;
  };
  return JSON.stringify(normalize(value));
};

const padDatePart = (value: number, length = 2): string =>
  String(value).padStart(length, "0");

const formatLocalDate = (date: Date): string =>
  `${padDatePart(date.getFullYear(), 4)}-${padDatePart(
    date.getMonth() + 1,
  )}-${padDatePart(date.getDate())}`;

const formatLocalDateTime = (date: Date): string => {
  const seconds = date.getSeconds() || date.getMilliseconds()
    ? `:${padDatePart(date.getSeconds())}`
    : "";
  const fraction = date.getMilliseconds()
    ? `.${padDatePart(date.getMilliseconds(), 3)}`
    : "";
  return `${formatLocalDate(date)}T${padDatePart(
    date.getHours(),
  )}:${padDatePart(date.getMinutes())}${seconds}${fraction}`;
};

const isLocalMidnight = (date: Date): boolean =>
  date.getHours() === 0 &&
  date.getMinutes() === 0 &&
  date.getSeconds() === 0 &&
  date.getMilliseconds() === 0;

const serializeDueForFrontmatter = (
  nextDue: unknown,
  baseDue: unknown,
): unknown => {
  if (!(nextDue instanceof Date)) return nextDue;
  if (typeof baseDue === "string") {
    const parsedBase = parseStrictDate(baseDue);
    if (parsedBase?.date.getTime() === nextDue.getTime()) return baseDue;
    if (isLocalMidnight(nextDue)) return formatLocalDate(nextDue);
    if (/^\d{4}-\d{2}-\d{2}$/.test(baseDue)) {
      return formatLocalDateTime(nextDue);
    }
    const localMatch =
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?(\.\d{1,3})?$/.exec(
        baseDue,
      );
    if (localMatch) {
      const seconds = localMatch[1]
        ? `:${padDatePart(nextDue.getSeconds())}`
        : "";
      const fraction = localMatch[2]
        ? `.${padDatePart(nextDue.getMilliseconds(), 3).slice(0, localMatch[2].length - 1)}`
        : "";
      return `${formatLocalDate(nextDue)}T${padDatePart(
        nextDue.getHours(),
      )}:${padDatePart(nextDue.getMinutes())}${seconds}${fraction}`;
    }
  }
  if (isLocalMidnight(nextDue)) return formatLocalDate(nextDue);
  return nextDue.toISOString();
};

export const calendarScheduleMetadataSignature = (
  rows: Array<Record<string, unknown>>,
  pathKey: string,
  pathsIndex?: Map<
    string,
    { metadata?: { property?: Record<string, unknown> } }
  >,
): string =>
  JSON.stringify(
    rows.map((row) => {
      const path = row[pathKey];
      if (typeof path !== "string") return null;
      const state = pathsIndex?.get(path);
      if (state === undefined) return null;
      const property = state.metadata?.property;
      return [
        path,
        property !== undefined,
        Object.prototype.hasOwnProperty.call(property ?? {}, "due"),
        comparableScheduleValue(property?.due),
        Object.prototype.hasOwnProperty.call(property ?? {}, "repeat"),
        comparableScheduleValue(property?.repeat),
      ];
    }),
  );

export const executeDateScheduleTransaction = async ({
  path,
  base,
  next,
  dueRepresentationSource,
  readCurrent,
  write,
}: {
  path: string;
  base: DateScheduleValues;
  next: DateScheduleValues;
  dueRepresentationSource?: unknown;
  readCurrent: (path: string) => DateScheduleValues | null | undefined;
  write: (
    path: string,
    properties: Record<"due" | "repeat" | "reminder", unknown>,
  ) => Promise<{ ok: boolean } | boolean>;
}): Promise<DateScheduleTransactionResult> => {
  if (!path) return { ok: false, error: "A Markdown file path is required." };
  const current = readCurrent(path);
  if (!current)
    return { ok: false, error: "The current frontmatter is unavailable." };
  for (const key of ["due", "repeat", "reminder"] as const) {
    if (
      comparableScheduleValue(current[key]) !==
      comparableScheduleValue(base[key])
    ) {
      return {
        ok: false,
        conflict: true,
        error: "Schedule changed outside Notidian. Reload before editing.",
      };
    }
  }

  const parsedDue = parseStrictDate(next.due);
  if (!parsedDue) return { ok: false, error: "Due date is invalid." };
  const parsedRepeat = parseRepeatRule(next.repeat, next.due);
  if (parsedRepeat.error) return { ok: false, error: parsedRepeat.error };
  const parsedReminder = parseReminderRule(next.reminder);
  if (parsedReminder.error) return { ok: false, error: parsedReminder.error };
  const dueValue = serializeDueForFrontmatter(
    next.due,
    dueRepresentationSource === undefined ? base.due : dueRepresentationSource,
  );
  const properties = {
    due: dueValue,
    repeat: serializeRepeatRule(parsedRepeat.value),
    reminder: serializeReminderRule(parsedReminder.value),
  };
  try {
    const result = await write(path, properties);
    return result === true || (!!result && result.ok === true)
      ? { ok: true }
      : { ok: false, error: "Could not update the schedule frontmatter." };
  } catch {
    return { ok: false, error: "Could not update the schedule frontmatter." };
  }
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
  if (!parsedDue) return null;
  const { date: due, recurrenceMode } = parsedDue;
  const parsedReminder = parseReminderRule(metadata.reminder);
  if (parsedReminder.error || !parsedReminder.value) return null;
  const beforeMs = parseDuration(parsedReminder.value.before);
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
