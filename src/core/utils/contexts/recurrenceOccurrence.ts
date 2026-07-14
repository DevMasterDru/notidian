import { DBRow } from "shared/types/mdb";

export type RecurrenceOccurrenceScope = "today" | "iso-week";

export type RecurrenceOccurrenceFields = {
  cadenceField?: string;
  daysField?: string;
  timesPerWeekField?: string;
};

export const RECURRENCE_FILTER_FNS = [
  "occursToday",
  "occursThisWeek",
] as const;
export const RECURRENCE_FIELD_NAMES = ["cadence", "recurrence"] as const;

const DAY_TOKENS: Record<string, number> = {
  su: 0,
  sun: 0,
  sunday: 0,
  mo: 1,
  mon: 1,
  monday: 1,
  tu: 2,
  tue: 2,
  tuesday: 2,
  we: 3,
  wed: 3,
  wednesday: 3,
  th: 4,
  thu: 4,
  thursday: 4,
  fr: 5,
  fri: 5,
  friday: 5,
  sa: 6,
  sat: 6,
  saturday: 6,
};

const parseDays = (value: unknown): number[] => {
  let entries: unknown[];
  if (Array.isArray(value)) entries = value;
  else if (typeof value == "string") {
    const text = value.trim();
    if (!text) return [];
    try {
      const parsed = JSON.parse(text);
      entries = Array.isArray(parsed) ? parsed : [text];
    } catch {
      entries = text.split(",");
    }
  } else return [];
  return [
    ...new Set(
      entries
        .map((entry) => DAY_TOKENS[String(entry ?? "").trim().toLowerCase()])
        .filter((day): day is number => day !== undefined)
    ),
  ];
};

export const isRecurrenceFilterFn = (value: unknown): boolean =>
  RECURRENCE_FILTER_FNS.includes(value as (typeof RECURRENCE_FILTER_FNS)[number]);

export const recurrenceFilterFnsForFieldName = (value: unknown): string[] => {
  const field = String(value ?? "")
    .trim()
    .toLowerCase()
    .split(".")
    .pop();
  return RECURRENCE_FIELD_NAMES.includes(
    field as (typeof RECURRENCE_FIELD_NAMES)[number]
  )
    ? [...RECURRENCE_FILTER_FNS]
    : [];
};

export const recurrenceOccursInScope = (
  row: DBRow,
  scope: RecurrenceOccurrenceScope,
  now: Date = new Date(),
  fields: RecurrenceOccurrenceFields = {}
): boolean => {
  if (!(now instanceof Date) || !Number.isFinite(now.valueOf())) return false;
  const cadenceField = fields.cadenceField ?? "cadence";
  const daysField = fields.daysField ?? "days";
  const timesPerWeekField = fields.timesPerWeekField ?? "times_per_week";
  const cadence = String(row?.[cadenceField] ?? "").trim().toLowerCase();
  const days = parseDays(row?.[daysField]);
  const timesText = String(row?.[timesPerWeekField] ?? "").trim();
  const timesPerWeek = timesText ? Number(timesText) : NaN;

  if (cadence == "monthly") return false;
  if (cadence == "daily") return true;
  if (cadence == "weekdays") {
    return scope == "iso-week" || (now.getDay() >= 1 && now.getDay() <= 5);
  }
  if (cadence != "weekly" && cadence != "custom") return false;

  if (scope == "today") return days.includes(now.getDay());
  return (
    cadence == "weekly" ||
    days.length > 0 ||
    (Number.isFinite(timesPerWeek) && timesPerWeek > 0)
  );
};
