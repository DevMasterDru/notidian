import { UIManager } from "core/middleware/ui";
import { Anchors, Rect } from "shared/types/Pos";

import { formatDate, isValidDate, parseDate } from "core/utils/date";
import { addDays, addMonths, startOfDay } from "date-fns";
import i18n from "shared/i18n";
import React, { useEffect, useState } from "react";
import { CaptionProps, DayPicker, useNavigation } from "react-day-picker";
import {
  DateScheduleTransactionResult,
  DateScheduleValues,
  executeDateScheduleTransaction,
  Frequency,
  parseReminderRule,
  parseRepeatRule,
  serializeReminderRule,
  serializeRepeatRule,
  Weekday,
} from "core/utils/date-reminders/schedule";
import { saveFrontmatterProperties } from "core/utils/properties/frontmatterWrite";
import { Superstate } from "makemd-core";
import { DBRow } from "shared/types/mdb";

const SCHEDULE_FREQUENCIES: Array<[Frequency, string]> = [
  ["DAILY", "Daily"],
  ["WEEKLY", "Weekly"],
  ["MONTHLY", "Monthly"],
  ["YEARLY", "Yearly"],
  ["HOURLY", "Hourly"],
];
const SCHEDULE_WEEKDAYS: Weekday[] = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"];

export type DateScheduleEditorProps = {
  due: Date;
  repeat?: unknown;
  reminder?: unknown;
  dateRemindersEnabled: boolean;
  onSave: (values: DateScheduleValues) =>
    | Promise<DateScheduleTransactionResult>
    | DateScheduleTransactionResult;
};

export type DateScheduleEditorBinding = Omit<DateScheduleEditorProps, "due"> & {
  due?: Date | null;
};

const snapshotScheduleValue = (value: unknown): unknown => {
  if (value instanceof Date) return new Date(value.getTime());
  if (Array.isArray(value)) return value.map(snapshotScheduleValue);
  if (value && typeof value === "object") {
    return Object.entries(value).reduce<Record<string, unknown>>(
      (snapshot, [key, entry]) => {
        snapshot[key] = snapshotScheduleValue(entry);
        return snapshot;
      },
      {},
    );
  }
  return value;
};

export const dateScheduleBindingForRow = ({
  superstate,
  row,
  path,
  due,
  onSaved,
}: {
  superstate: Superstate;
  row: DBRow;
  path: string;
  due: unknown;
  onSaved?: (values: DateScheduleValues) => void;
}): DateScheduleEditorBinding => {
  const currentPathState = superstate.pathsIndex.get(path);
  const hasCurrentSnapshot = currentPathState !== undefined;
  const currentProperty = currentPathState?.metadata?.property;
  const hasCanonicalDue = !!currentProperty &&
    Object.prototype.hasOwnProperty.call(currentProperty, "due");
  const base: DateScheduleValues = {
    due: snapshotScheduleValue(hasCurrentSnapshot ? currentProperty?.due : due),
    repeat: snapshotScheduleValue(
      hasCurrentSnapshot ? currentProperty?.repeat : row?.repeat,
    ),
    reminder: snapshotScheduleValue(
      hasCurrentSnapshot ? currentProperty?.reminder : row?.reminder,
    ),
  };
  const presentedValue = (key: "repeat" | "reminder") =>
    currentProperty && Object.prototype.hasOwnProperty.call(currentProperty, key)
      ? base[key]
      : snapshotScheduleValue(row?.[key]);
  const presentedDue = parseDate(hasCanonicalDue ? base.due : due);
  return {
    due: isValidDate(presentedDue)
      ? presentedDue
      : hasCanonicalDue
        ? null
        : undefined,
    repeat: presentedValue("repeat"),
    reminder: presentedValue("reminder"),
    dateRemindersEnabled: superstate.settings?.dateReminders === true,
    onSave: async (next) => {
      const result = await executeDateScheduleTransaction({
        path,
        base,
        next,
        dueRepresentationSource: hasCanonicalDue ? base.due : due,
        readCurrent: (currentPath) => {
          const pathState = superstate.pathsIndex.get(currentPath);
          if (!pathState) return null;
          const property = pathState.metadata?.property;
          return {
            due: property?.due,
            repeat: property?.repeat,
            reminder: property?.reminder,
          };
        },
        write: (currentPath, properties) =>
          saveFrontmatterProperties({
            superstate,
            path: currentPath,
            properties,
            failureMessage: "Could not update the date schedule.",
          }),
      });
      if (result.ok) onSaved?.(next);
      return result;
    },
  };
};

const initialMapping = (value: unknown): Record<string, unknown> | null => {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  if (typeof value !== "string") return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
};

export const DateScheduleEditor = (props: DateScheduleEditorProps) => {
  const parsedInitialRepeat = parseRepeatRule(props.repeat, props.due);
  const rawRepeat = initialMapping(props.repeat);
  const initialRepeat = parsedInitialRepeat.value;
  const parsedInitialReminder = parseReminderRule(props.reminder);
  const rawReminder = initialMapping(props.reminder);
  const [repeatEnabled, setRepeatEnabled] = useState(
    props.repeat !== undefined && props.repeat !== null && props.repeat !== "",
  );
  const [frequency, setFrequency] = useState<Frequency>(
    initialRepeat?.freq ??
      (typeof rawRepeat?.freq === "string" &&
      SCHEDULE_FREQUENCIES.some(([value]) => value === rawRepeat.freq)
        ? rawRepeat.freq as Frequency
        : "DAILY"),
  );
  const [interval, setInterval] = useState(
    String(initialRepeat?.interval ?? rawRepeat?.interval ?? 1),
  );
  const [count, setCount] = useState(
    initialRepeat?.count === undefined ? "" : String(initialRepeat.count),
  );
  const [until, setUntil] = useState(() => {
    if (typeof rawRepeat?.until === "string") return rawRepeat.until.slice(0, 10);
    return "";
  });
  const [weekdays, setWeekdays] = useState<Weekday[]>(
    initialRepeat?.byweekday ?? [],
  );
  const [weekStart, setWeekStart] = useState<Weekday>(
    initialRepeat?.wkst ?? "MO",
  );
  const [reminderBefore, setReminderBefore] = useState(
    parsedInitialReminder.value?.before ??
      (typeof rawReminder?.before === "string" ? rawReminder.before : ""),
  );
  const [error, setError] = useState<string | null>(
    parsedInitialRepeat.error ?? parsedInitialReminder.error,
  );
  const [saving, setSaving] = useState(false);

  const chooseFrequency = (next: Frequency) => {
    setRepeatEnabled(true);
    setFrequency(next);
  };
  const toggleWeekday = (day: Weekday) =>
    setWeekdays((current) =>
      current.includes(day)
        ? current.filter((value) => value !== day)
        : [...current, day],
    );

  const save = async () => {
    const rawRule = repeatEnabled
      ? {
          freq: frequency,
          interval: Number(interval),
          ...(count === "" ? {} : { count: Number(count) }),
          ...(until === "" ? {} : { until }),
          ...(weekdays.length === 0 ? {} : { byweekday: weekdays }),
          ...(weekStart === "MO" ? {} : { wkst: weekStart }),
        }
      : null;
    const parsedRepeat = parseRepeatRule(rawRule, props.due);
    if (parsedRepeat.error) {
      setError(parsedRepeat.error);
      return;
    }
    const rawReminder = reminderBefore.trim() === ""
      ? null
      : { before: reminderBefore.trim() };
    const parsedReminder = parseReminderRule(rawReminder);
    if (parsedReminder.error) {
      setError(parsedReminder.error);
      return;
    }
    setSaving(true);
    const result = await props.onSave({
      due: props.due,
      repeat: serializeRepeatRule(parsedRepeat.value),
      reminder: serializeReminderRule(parsedReminder.value),
    });
    setSaving(false);
    if (result.ok) setError(null);
    else setError(
      ("error" in result ? result.error : undefined) ??
        "Could not save the schedule.",
    );
  };

  return (
    <section className="mk-date-schedule-editor" aria-label="Date schedule">
      <fieldset>
        <legend>Repeat</legend>
        <button
          type="button"
          aria-pressed={!repeatEnabled}
          onClick={() => setRepeatEnabled(false)}
        >
          Does not repeat
        </button>
        <div className="mk-date-schedule-frequencies">
          {SCHEDULE_FREQUENCIES.map(([value, label]) => (
            <button
              key={value}
              type="button"
              data-schedule-frequency={value}
              aria-pressed={repeatEnabled && frequency === value}
              onClick={() => chooseFrequency(value)}
            >
              {label}
            </button>
          ))}
        </div>
        {repeatEnabled && (
          <>
            <label>
              Interval
              <input
                aria-label="Repeat interval"
                type="number"
                min="1"
                step="1"
                value={interval}
                onChange={(event) => setInterval(event.target.value)}
              />
            </label>
            <label>
              Count
              <input
                aria-label="Repeat count"
                type="number"
                min="1"
                max="100"
                step="1"
                value={count}
                onChange={(event) => setCount(event.target.value)}
              />
            </label>
            <label>
              Until
              <input
                aria-label="Repeat until"
                type="date"
                value={until}
                onChange={(event) => setUntil(event.target.value)}
              />
            </label>
            <div role="group" aria-label="Repeat weekdays">
              {SCHEDULE_WEEKDAYS.map((day) => (
                <button
                  key={day}
                  type="button"
                  data-schedule-weekday={day}
                  aria-pressed={weekdays.includes(day)}
                  onClick={() => toggleWeekday(day)}
                >
                  {day}
                </button>
              ))}
            </div>
            <label>
              Week starts
              <select
                aria-label="Repeat week start"
                value={weekStart}
                onChange={(event) => setWeekStart(event.target.value as Weekday)}
              >
                {SCHEDULE_WEEKDAYS.map((day) => <option key={day}>{day}</option>)}
              </select>
            </label>
          </>
        )}
      </fieldset>
      <fieldset>
        <legend>Reminder</legend>
        <label>
          Before
          <input
            aria-label="Reminder before"
            value={reminderBefore}
            placeholder="PT30M"
            onChange={(event) => setReminderBefore(event.target.value)}
          />
        </label>
        {!props.dateRemindersEnabled && (
          <p role="status">
            Reminder delivery is off. This schedule will be saved, but no notification will be delivered.
          </p>
        )}
      </fieldset>
      {error && <p role="alert" aria-live="assertive">{error}</p>}
      <button
        type="button"
        data-schedule-save
        disabled={saving}
        onClick={save}
      >
        {saving ? "Saving…" : "Save schedule"}
      </button>
    </section>
  );
};

export enum DatePickerTimeMode {
  None,
  Toggle,
  Always,
}

export const datePickerDefaultDate = (
  existing: Date | null | undefined,
  includeTime: boolean,
  now = new Date(),
): Date => existing ?? (includeTime ? now : startOfDay(now));

export const showDatePickerMenu = (
  ui: UIManager,
  rect: Rect,
  win: Window,
  value: Date,
  setValue: (date: Date, hasTime: boolean) => void,
  time: DatePickerTimeMode,
  format?: string,
  anchor?: Anchors,
  schedule?: DateScheduleEditorBinding,
) => {
  return ui.openCustomMenu(
    rect,
    <DatePicker
      ui={ui}
      value={value}
      setValue={setValue}
      time={time}
      schedule={schedule}
    />,
    schedule
      ? { width: "420px", height: "720px" }
      : { width: "280px", height: "280px" },
    win,
    anchor
  );
};

const DatePickerHeader = (
  props: CaptionProps & {
    ui: UIManager;
  }
) => {
  const { goToMonth, nextMonth, previousMonth } = useNavigation();
  const [inputMode, setInputMode] = useState(false);
  return (
    <div className="mk-date-picker-header">
      <button
        disabled={!previousMonth}
        onClick={() => previousMonth && goToMonth(previousMonth)}
        dangerouslySetInnerHTML={{
          __html: props.ui.getSticker("ui//chevron-left"),
        }}
      ></button>
      {inputMode ? (
        <div className="mk-date-picker-header-input">
          <input
            type="text"
            value={props.displayMonth.getMonth() + 1}
            onKeyDown={(e) => {
              if (e.key === "ArrowUp") {
                const newDate = addMonths(props.displayMonth, 1);
                goToMonth(newDate);
              } else if (e.key === "ArrowDown") {
                const newDate = addMonths(props.displayMonth, -1);
                goToMonth(newDate);
              }
            }}
            onChange={(e) => {
              const newDate = props.displayMonth;
              newDate.setMonth(+e.target.value - 1);
              goToMonth(newDate);
            }}
          />
          <input
            type="text"
            value={props.displayMonth.getFullYear()}
            onKeyDown={(e) => {
              if (e.key === "ArrowUp") {
                const newDate = props.displayMonth;
                newDate.setFullYear(newDate.getFullYear() + 1);
                goToMonth(newDate);
              } else if (e.key === "ArrowDown") {
                const newDate = props.displayMonth;
                newDate.setFullYear(newDate.getFullYear() - 1);
                goToMonth(newDate);
              }
            }}
            onChange={(e) => {
              const newDate = props.displayMonth;
              newDate.setFullYear(+e.target.value);
              goToMonth(newDate);
            }}
          />
        </div>
      ) : (
        <div onClick={() => setInputMode(true)}>
          {formatDate(
            props.ui.superstate.settings,
            props.displayMonth,
            "MMM yyy"
          )}
        </div>
      )}

      <button
        disabled={!nextMonth}
        onClick={() => nextMonth && goToMonth(nextMonth)}
        dangerouslySetInnerHTML={{
          __html: props.ui.getSticker("ui//chevron-right"),
        }}
      ></button>
    </div>
  );
};

export const DatePicker = (props: {
  ui: UIManager;
  value: Date;
  setValue: (date: Date, hasTime: boolean) => void;
  time?: DatePickerTimeMode;
  schedule?: DateScheduleEditorBinding;
}) => {
  const [canonicalDueFallback] = useState(() =>
    datePickerDefaultDate(
      undefined,
      props.time !== DatePickerTimeMode.None,
    )
  );
  const presentedValue = props.schedule?.due === null
    ? canonicalDueFallback
    : props.schedule?.due ?? props.value;
  const [hour, setHour] = useState(0);
  const [minutes, setMinutes] = useState(0);
  const [seconds, setSeconds] = useState(0);
  const [date, setDate] = useState(presentedValue);
  const [mode, setMode] = useState(props.time == DatePickerTimeMode.Always);
  const [yearMode, setYearMode] = useState(false);
  const resetMode = () => {
    const date = presentedValue
      ? presentedValue
      : props.time == DatePickerTimeMode.None
      ? startOfDay(new Date())
      : new Date();
    const h = date.getHours();
    const m = date.getMinutes();
    const s = date.getSeconds();
    setHour(h);
    setMinutes(m);
    setSeconds(s);
    setDate(date);

    if (props.time == DatePickerTimeMode.Toggle) {
      if (h == 0 && m == 0 && s == 0 && !mode) {
      } else {
        setMode(true);
      }
    }
  };
  useEffect(() => {
    resetMode();
  }, [presentedValue, props.time]);
  useEffect(() => {
    resetMode();
  }, []);

  const updateDate = (time?: {
    y?: number;
    mo?: number;
    h?: number;
    m?: number;
    s?: number;
  }) => {
    const newDate = new Date(date);
    const h = time?.h ?? hour;
    const m = time?.m ?? minutes;
    const s = time?.s ?? seconds;
    if (time) {
      time.h !== undefined && setHour(time.h);
      time.m !== undefined && setMinutes(time.m);
      time.s !== undefined && setSeconds(time.s);
    }
    if (props.time) {
      newDate.setHours(h);
      newDate.setMinutes(m);
      newDate.setSeconds(s);
      if (h == 0 && m == 0 && s == 0) {
        setMode(false);
      }
    }
    setDate(newDate);
    if (time.y !== undefined) {
      newDate.setFullYear(time.y);
    }
    if (time.mo !== undefined) {
      newDate.setMonth(time.mo);
    }
    if (!props.schedule) {
      props.setValue(
        newDate,
        props.time != DatePickerTimeMode.None && !(h == 0 && m == 0 && s == 0)
      );
    }
  };

  // Richer date UX (Notidian-e6v): Notion-style quick shortcuts. Each reuses the
  // exact day-click path (props.setValue with a real Date, time applied only when
  // the time mode is on), so there is no new save/clear semantics — clearing
  // still goes through the table's canonical clear-cell path.
  const applyQuickDate = (target: Date) => {
    const newDate = target;
    if (mode) {
      newDate.setHours(hour);
      newDate.setMinutes(minutes);
      newDate.setSeconds(seconds);
    }
    setDate(newDate);
    if (!props.schedule) {
      props.setValue(
        newDate,
        props.time != DatePickerTimeMode.None &&
          !(hour == 0 && minutes == 0 && seconds == 0)
      );
    }
  };

  return (
    <div
      className={`mk-date-picker-container ${
        props.schedule ? "mk-date-picker-container--schedule" : ""
      }`}
    >
      <div className="mk-date-picker-shortcuts">
        <button onClick={() => applyQuickDate(startOfDay(new Date()))}>
          Today
        </button>
        <button
          onClick={() => applyQuickDate(startOfDay(addDays(new Date(), 1)))}
        >
          Tomorrow
        </button>
        <button
          onClick={() => applyQuickDate(startOfDay(addDays(new Date(), 7)))}
        >
          Next week
        </button>
      </div>
      <DayPicker
        defaultMonth={date}
        mode="single"
        classNames={{
          root: "mk-date-picker",
          day: "mk-date-picker-day",
          cell: "mk-date-picker-cell",
          months: "mk-date-picker-months",
          month: "mk-date-picker-month",
          day_today: "mk-date-picker-today",
          day_selected: "mk-date-picker-selected",
        }}
        components={{
          Caption: (_props) => DatePickerHeader({ ui: props.ui, ..._props }),
        }}
        labels={{
          labelMonthDropdown: () => undefined,
          labelYearDropdown: () => undefined,
          labelNext: () => undefined,
          labelPrevious: () => undefined,
          labelDay: () => undefined,
          labelWeekday: () => undefined,
          labelWeekNumber: () => undefined,
        }}
        onSelect={(date: Date, s, a, e) => {
          const newDate = date;

          if (mode) {
            newDate.setHours(hour);
            newDate.setMinutes(minutes);
            newDate.setSeconds(seconds);
          }
          setDate(newDate);
          if (!props.schedule) {
            props.setValue(
              newDate,
              props.time != DatePickerTimeMode.None &&
                !(hour == 0 && minutes == 0 && seconds == 0)
            );
          }
          e.stopPropagation();
        }}
      />
      {mode ? (
        <div className="mk-date-picker-time">
          <div
            dangerouslySetInnerHTML={{
              __html: props.ui.getSticker("ui//clock"),
            }}
          ></div>
          <input
            type="text"
            value={hour.toString().padStart(2, "0")}
            onKeyDown={(e) => {
              if (e.key === "ArrowUp") {
                updateDate({ h: (hour + 1) % 24 });
              } else if (e.key === "ArrowDown") {
                updateDate({ h: (hour + 23) % 24 });
              }
            }}
            onChange={(e) => {
              updateDate({ h: +e.target.value });
            }}
          />
          :
          <input
            type="text"
            value={minutes.toString().padStart(2, "0")}
            onKeyDown={(e) => {
              if (e.key === "ArrowUp") {
                updateDate({ m: (minutes + 1) % 60 });
              } else if (e.key === "ArrowDown") {
                updateDate({ m: (minutes + 59) % 60 });
              }
            }}
            onChange={(e) => {
              updateDate({ m: +e.target.value });
            }}
          />
          <button
            className="mk-date-picker-meridiem"
            onClick={() => {
              updateDate({ h: (hour + 12) % 24 });
            }}
          >
            {hour < 12 ? "AM" : "PM"}
          </button>
          <button
            onClick={() => updateDate({ h: 0, m: 0, s: 0 })}
            dangerouslySetInnerHTML={{
              __html: props.ui.getSticker("ui//close"),
            }}
          ></button>
        </div>
      ) : props.time == DatePickerTimeMode.Toggle ? (
        <button onClick={() => setMode(true)}>{i18n.buttons.addTime}</button>
      ) : null}
      {props.schedule && (
        <DateScheduleEditor
          {...props.schedule}
          due={date}
        />
      )}
    </div>
  );
};
