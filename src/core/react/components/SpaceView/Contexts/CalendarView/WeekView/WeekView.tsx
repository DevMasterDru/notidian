import { formatDate, isValidDate, parseDate } from "core/utils/date";
import {
  calendarDueValue,
  calendarRepeatValue,
  calendarScheduleMetadataSignature,
  expandCalendarEventSchedule,
  usesStrictDateSchedule,
} from "core/utils/date-reminders/schedule";
import { add, addDays, addHours, startOfDay, startOfWeek } from "date-fns";
import { Superstate } from "makemd-core";
import i18n from "shared/i18n";
import React, { useMemo, useState } from "react";
import { PathPropertyName } from "shared/types/context";
import { DBRow, DBRows } from "shared/types/mdb";
import { CalendarHeaderView } from "../CalendarHeaderView";
import { DayGutter } from "../DayView/DayGutter";
import { DayView } from "../DayView/DayView";
import { AllDayCell } from "./AllDayCell";
import { AllDayItem } from "./AllDayItem";
import { strictCalendarScheduleEditor } from "../calendarScheduleEditor";

type AllDayLayout = {
  index: number;
  occurrenceId?: string;
  startDay: number;
  endDay: number;
  topOffset: number;
  repeat?: boolean;
  scheduleError?: string;
  scheduleTruncated?: boolean;
};

export const WeekView = (props: {
  superstate: Superstate;
  weekStart?: Date;
  data?: DBRows;
  field: string;
  fieldEnd: string;
  fieldRepeat: string;
  hourHeight?: number;
  header?: boolean;
  startHour?: number;
  endHour?: number;
  showHours?: boolean;
  insertItem: (row: DBRow) => void;
  updateItem: (row: DBRow) => void;
}) => {
  const hourHeight = props.hourHeight;
  const [date, setDate] = useState<Date>(
    isValidDate(props.weekStart)
      ? startOfWeek(props.weekStart)
      : startOfWeek(new Date())
  );

  const startHour = props.startHour ?? 0;
  const endHour = props.endHour ?? 24;
  const strictSchedule = usesStrictDateSchedule(props.superstate.settings);

  const [maxOffset, setMaxOffset] = useState(0);
  const scheduleMetadataSignature = strictSchedule
    ? calendarScheduleMetadataSignature(
        props.data ?? [],
        PathPropertyName,
        props.superstate.pathsIndex,
      )
    : "";

  const allDayRows = useMemo(() => {
    const rows: AllDayLayout[] = [];
    props.data.forEach((row, index) => {
      if (!strictSchedule) {
        const rowDate = parseDate(row[props.field]);
        const endDate = parseDate(row[props.fieldEnd]) ?? rowDate;
        if (
          endDate >= date &&
          rowDate <= add(date, { days: 7 }) &&
          (props.showHours === false ||
            (startOfDay(rowDate).getTime() == rowDate.getTime() &&
              startOfDay(endDate).getTime() == endDate.getTime()))
        ) {
          rows.push({
            index,
            startDay: new Date(
              Math.max(date.getTime(), rowDate.getTime())
            ).getDay(),
            endDay: new Date(
              Math.min(add(date, { days: 7 }).getTime(), endDate.getTime())
            ).getDay(),
            topOffset: 0,
          });
        }
        return;
      }

      const eventPath = row[PathPropertyName];
      const canonicalState = typeof eventPath === "string"
        ? props.superstate.pathsIndex?.get(eventPath)
        : undefined;
      const hasCanonicalSnapshot = canonicalState !== undefined;
      const canonicalProperty = canonicalState?.metadata?.property;
      const dueValue = calendarDueValue(
        row,
        props.field,
        canonicalProperty,
        hasCanonicalSnapshot,
      );
      const canonicalDue = parseDate(dueValue);
      if (!isValidDate(canonicalDue)) return;
      const repeatValue = calendarRepeatValue(
        row,
        props.fieldRepeat,
        true,
        canonicalProperty,
        hasCanonicalSnapshot,
      );
      const selectedStart = parseDate(row[props.field]);
      const selectedEnd = parseDate(row[props.fieldEnd]);
      const hasSelectedDuration =
        isValidDate(selectedStart) && isValidDate(selectedEnd);
      const expansion = expandCalendarEventSchedule({
        due: dueValue,
        repeat: repeatValue,
        selectedStart: hasSelectedDuration ? selectedStart : canonicalDue,
        selectedEnd: hasSelectedDuration
          ? selectedEnd
          : addHours(canonicalDue, 1),
        windowStart: date,
        windowEnd: new Date(add(date, { days: 7 }).getTime() - 1),
      });
      const hasRepeat =
        repeatValue !== undefined && repeatValue !== null && repeatValue !== "";
      expansion.instances.forEach(({ start, end }, occurrenceIndex) => {
        if (
          props.showHours !== false &&
          (startOfDay(start).getTime() !== start.getTime() ||
            startOfDay(end).getTime() !== end.getTime())
        ) {
          return;
        }
        rows.push({
          index,
          occurrenceId: `${index}:${start.getTime()}`,
          startDay: new Date(
            Math.max(date.getTime(), start.getTime())
          ).getDay(),
          endDay: new Date(
            Math.min(add(date, { days: 7 }).getTime() - 1, end.getTime())
          ).getDay(),
          topOffset: 0,
          repeat: hasRepeat,
          scheduleError: expansion.error ?? undefined,
          scheduleTruncated: expansion.truncated && occurrenceIndex === 0,
        });
      });
    });
    let _maxOffset = 0;
    rows.forEach((row, index) => {
      for (let i = 0; i < index; i++) {
        if (
          rows[i].startDay <= row.startDay &&
          rows[i].endDay >= row.endDay &&
          rows[i].topOffset == rows[index].topOffset
        ) {
          rows[index].topOffset += 1;
          _maxOffset = Math.max(_maxOffset, rows[index].topOffset);
        }
      }
    });
    setMaxOffset(_maxOffset);
    return rows;
  }, [
    props.data,
    date,
    props.field,
    props.fieldEnd,
    props.fieldRepeat,
    props.showHours,
    props.superstate.settings?.dateScheduleAuthoring,
    scheduleMetadataSignature,
  ]);
  return (
    <div
      className="mk-week-view"
      style={
        {
          "--hour-height": `${hourHeight}px`,
        } as React.CSSProperties
      }
    >
      {props.header && (
        <CalendarHeaderView
          superstate={props.superstate}
          date={date}
          mode="week"
          setDate={setDate}
        ></CalendarHeaderView>
      )}
      <div className="mk-week-view-header">
        {props.showHours !== false && <div className="mk-day-view-gutter"></div>}
        {Array.from({ length: 7 }).map((_, day) => {
          return (
            <div key={day}>
              {formatDate(
                props.superstate.settings,
                add(date, { days: day }),
                "EEE d"
              )}
            </div>
          );
        })}
      </div>
      <div className="mk-week-view-all-day" style={props.showHours === false ? { borderBottom: 'none' } : undefined}>
        {props.showHours !== false && (
          <div className="mk-day-view-gutter">
            <div
              className="mk-day-view-hour-title"
              style={{
                height: `${maxOffset * 30}px`,
              }}
            >
              {i18n.labels.allDay}
            </div>
          </div>
        )}
        {Array.from({ length: 7 }).map((_, day) => {
          return (
            <AllDayCell
              key={day}
              height={maxOffset + 2}
              superstate={props.superstate}
              date={addDays(date, day)}
              insertItem={(path: string) => {
                props.insertItem({
                  [props.field]: formatDate(
                    props.superstate.settings,
                    addDays(date, day),
                    "yyyy-MM-dd"
                  ),
                  [props.fieldEnd]: formatDate(
                    props.superstate.settings,
                    addDays(date, day),
                    "yyyy-MM-dd"
                  ),
                  [PathPropertyName]: path,
                });
              }}
            >
              {allDayRows
                .filter((f) => f.startDay == day)
                .map((row, i) => (
                  <AllDayItem
                    superstate={props.superstate}
                    data={props.data[row.index]}
                    occurrenceId={row.occurrenceId}
                    interactionDisabled={strictSchedule}
                    index={row.index}
                    startDay={row.startDay}
                    endDay={row.endDay}
                    topOffset={row.topOffset}
                    repeat={row.repeat}
                    scheduleError={row.scheduleError}
                    scheduleTruncated={row.scheduleTruncated}
                    editRepeat={strictSchedule
                      ? strictCalendarScheduleEditor({
                          superstate: props.superstate,
                          row: props.data[row.index],
                          dueField: props.field,
                          repeatField: props.fieldRepeat,
                        })
                      : undefined}
                    key={row.occurrenceId ?? i}
                  ></AllDayItem>
                ))}
            </AllDayCell>
          );
        })}
      </div>
      {props.showHours !== false && (
        <div className="mk-week-view-content">
          <DayGutter
            hourHeight={hourHeight}
            startHour={startHour}
            endHour={endHour}
          />
          {Array.from({ length: 7 }).map((_, day) => {
            return (
              <DayView
                superstate={props.superstate}
                key={add(date, { days: day }).getTime()}
                field={props.field}
                fieldEnd={props.fieldEnd}
                fieldRepeat={props.fieldRepeat}
                date={add(date, { days: day })}
                scheduleWindowStart={date}
                scheduleWindowEnd={new Date(
                  add(date, { days: 7 }).getTime() - 1,
                )}
                data={props.data}
                hourHeight={hourHeight}
                startHour={startHour}
                endHour={endHour}
                insertItem={(row: DBRow) => {
                  props.insertItem(row);
                }}
                updateItem={(row: DBRow) => {
                  props.updateItem(row);
                }}
              />
            );
          })}
        </div>
      )}
    </div>
  );
};
