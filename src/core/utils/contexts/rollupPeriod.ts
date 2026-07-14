export type RollupPeriodConfig = {
  field: string;
  scope: "today" | "iso-week";
};

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

export const rollupDateValueMillis = (value: unknown): number => {
  if (value instanceof Date) return value.valueOf();
  if (typeof value == "number") return Number.isFinite(value) ? value : NaN;
  if (typeof value != "string") return NaN;
  const text = value.trim();
  if (!text) return NaN;

  const dateOnly = DATE_ONLY.exec(text);
  if (dateOnly) {
    const year = Number(dateOnly[1]);
    const month = Number(dateOnly[2]) - 1;
    const day = Number(dateOnly[3]);
    const local = new Date(year, month, day);
    return local.getFullYear() == year &&
      local.getMonth() == month &&
      local.getDate() == day
      ? local.valueOf()
      : NaN;
  }

  const parsed = new Date(text).valueOf();
  return Number.isFinite(parsed) ? parsed : NaN;
};

const localDayStart = (value: Date): number =>
  new Date(value.getFullYear(), value.getMonth(), value.getDate()).valueOf();

const isoWeekStart = (value: Date): number => {
  const start = new Date(value.getFullYear(), value.getMonth(), value.getDate());
  const daysSinceMonday = (start.getDay() + 6) % 7;
  start.setDate(start.getDate() - daysSinceMonday);
  return start.valueOf();
};

export const millisecondsUntilNextLocalDay = (
  now: Date = new Date()
): number => {
  const next = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() + 1
  );
  return Math.max(1, next.valueOf() - now.valueOf());
};

export const isValueInRollupPeriod = (
  value: unknown,
  period: RollupPeriodConfig,
  now: Date = new Date()
): boolean => {
  if (Array.isArray(value))
    return value.some((entry) => isValueInRollupPeriod(entry, period, now));
  if (!period?.field || (period.scope != "today" && period.scope != "iso-week"))
    return false;
  const millis = rollupDateValueMillis(value);
  if (!Number.isFinite(millis) || !Number.isFinite(now.valueOf())) return false;
  const date = new Date(millis);
  if (period.scope == "today") return localDayStart(date) == localDayStart(now);
  return isoWeekStart(date) == isoWeekStart(now);
};
