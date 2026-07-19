import {
  defaultDropAnimation,
  DragOverlay,
  useDndMonitor,
} from "@dnd-kit/core";
import { ContextEditorContext } from "core/react/context/ContextEditorContext";
import { applySat } from "core/utils/color";
import {
  buildRepeatRRuleOptions,
  formatDate,
  isoDateFormat,
  isValidDate,
  parseDate,
} from "core/utils/date";
import {
  calendarDueValue,
  calendarRepeatValue,
  calendarScheduleMetadataSignature,
  expandCalendarEventSchedule,
  usesStrictDateSchedule,
} from "core/utils/date-reminders/schedule";
import { isPhone } from "core/utils/ui/screen";
import {
  add,
  addHours,
  addMilliseconds,
  endOfDay,
  endOfWeek,
  startOfDay,
  startOfWeek,
} from "date-fns";
import { Superstate } from "makemd-core";
import React, { useContext, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { RRule } from "rrule";
import { BlinkMode } from "shared/types/blink";
import { PathPropertyName } from "shared/types/context";
import { DBRow, DBRows } from "shared/types/mdb";
import { safelyParseJSON } from "shared/utils/json";
import { strictCalendarScheduleEditor } from "../calendarScheduleEditor";
import { MonthDayCell } from "./MonthDayCell";
import { MonthWeekItem } from "./MonthWeekItem";

const scheduleOccurrenceIndex = Symbol("scheduleOccurrenceIndex");

type MonthEventLayout = {
  index: number;
  occurrenceId?: string;
  startDay: number;
  endDay: number;
  allDay: boolean;
  offset?: number;
  startTime: number;
  endTime: number;
  repeat: boolean;
  scheduleError?: string;
  scheduleTruncated?: boolean;
};

export const MonthWeekRow = (props: {
  superstate: Superstate;
  date: Date;
  events: DBRows;
  field: string;
  fieldEnd: string;
  fieldRepeat?: string;
  insertItem: (row: DBRow) => void;
  updateItem?: (row: DBRow) => void;
  scheduleWindowStart?: Date;
  scheduleWindowEnd?: Date;
}) => {
  const weekStart = startOfWeek(props.date);
  const weekEnd = endOfWeek(weekStart);
  const scheduleWindowStart = props.scheduleWindowStart ?? startOfDay(weekStart);
  const scheduleWindowEnd = props.scheduleWindowEnd ?? endOfDay(weekEnd);
  const strictSchedule = usesStrictDateSchedule(props.superstate.settings);
  const scheduleMetadataSignature = strictSchedule
    ? calendarScheduleMetadataSignature(
        props.events ?? [],
        PathPropertyName,
        props.superstate.pathsIndex,
      )
    : "";
  const { source } = useContext(ContextEditorContext);
  const weekEvents: MonthEventLayout[] = useMemo(() => {
    const events: MonthEventLayout[] = [];
    if (!props.fieldEnd || !props.field) return events;
    props.events.forEach((event, index) => {
      const instances = [];
      const eventPath = strictSchedule ? event[PathPropertyName] : undefined;
      const canonicalState = strictSchedule && typeof eventPath === "string"
        ? props.superstate.pathsIndex?.get(eventPath)
        : undefined;
      const hasCanonicalSnapshot = canonicalState !== undefined;
      const canonicalProperty = canonicalState?.metadata?.property;
      const repeatValue = calendarRepeatValue(
        event,
        props.fieldRepeat,
        strictSchedule,
        canonicalProperty,
        hasCanonicalSnapshot,
      );
      const repeatDef = safelyParseJSON(repeatValue as any);
      const rowDate = parseDate(event[props.field]);
      let rowEndDate = parseDate(event[props.fieldEnd]);
      let scheduleError: string | null = null;
      let scheduleTruncated = false;
      const hasRepeat = strictSchedule
        ? repeatValue !== undefined && repeatValue !== null && repeatValue !== ""
        : !!repeatDef;
      if (strictSchedule) {
        const dueValue = calendarDueValue(
          event,
          props.field,
          canonicalProperty,
          hasCanonicalSnapshot,
        );
        const canonicalDue = parseDate(dueValue);
        if (!isValidDate(canonicalDue)) return;
        const hasSelectedDuration =
          isValidDate(rowDate) && isValidDate(rowEndDate);
        const selectedStart = hasSelectedDuration ? rowDate : canonicalDue;
        const selectedEnd = hasSelectedDuration
          ? rowEndDate
          : addHours(selectedStart, 1);
        const expansion = expandCalendarEventSchedule({
          due: dueValue,
          repeat: repeatValue,
          selectedStart,
          selectedEnd,
          windowStart: scheduleWindowStart,
          windowEnd: scheduleWindowEnd,
        });
        scheduleError = expansion.error;
        scheduleTruncated = expansion.truncated;
        expansion.instances.forEach(({ start: startDate, end: instanceEnd }, occurrenceIndex) => {
          if (
            instanceEnd < startOfDay(weekStart) ||
            startDate > endOfDay(weekEnd)
          ) {
            return;
          }
          instances.push({
            ...event,
            [scheduleOccurrenceIndex]: occurrenceIndex,
            [props.field]: formatDate(
              props.superstate.settings,
              startDate,
              isoDateFormat
            ),
            [props.fieldEnd]: formatDate(
              props.superstate.settings,
              instanceEnd,
              isoDateFormat
            ),
          });
        });
      } else {
        if (!isValidDate(rowDate)) return;
        if (!isValidDate(rowEndDate)) {
          rowEndDate = rowDate;
        }
        if (rowDate <= endOfDay(weekEnd) && rowEndDate >= startOfDay(weekStart)) {
          instances.push(event);
        }
        if (repeatDef && repeatDef.freq) {
          const duration = rowEndDate.getTime() - rowDate.getTime();
          const rruleOptions = buildRepeatRRuleOptions(repeatDef, {
            dtstart: rowDate,
            until: parseDate(repeatDef.until),
          });
          // Unknown/missing freq token (or unknown weekday tokens) yields a null
          // / pruned options object; only generate recurrences when buildable.
          // The base event was already pushed above, so skipping here preserves
          // the prior no-recurrence-rendering behavior without crashing rrule.
          if (rruleOptions) {
            const rule = new RRule(rruleOptions);

            const starts: Date[] = rule.between(
              startOfDay(weekStart),
              endOfDay(weekEnd),
              true
            );

            starts.forEach((startDate) => {
              if (startDate.getTime() == rowDate.getTime()) return;
              instances.push({
                ...event,
                [props.field]: formatDate(
                  props.superstate.settings,
                  startDate,
                  isoDateFormat
                ),
                [props.fieldEnd]: formatDate(
                  props.superstate.settings,
                  addMilliseconds(startDate, duration),
                  isoDateFormat
                ),
              });
            });
          }
        }
      }

      instances.forEach((instance, occurrenceIndex) => {
        const start = parseDate(instance[props.field]);
        const parsedEnd = parseDate(instance[props.fieldEnd]);
        const end = parsedEnd
          ? parsedEnd
          : startOfDay(start).getTime() == start.getTime()
          ? startOfDay(start)
          : addHours(start, 1);
        const layoutStart = start > weekStart ? start : weekStart;
        const layoutEnd = end < weekEnd ? end : weekEnd;
        const startDay = layoutStart.getDay();
        const endDay = layoutEnd.getDay();
        events.push({
          index,
          occurrenceId: strictSchedule ? `${index}:${start.getTime()}` : undefined,
          startDay,
          endDay,
          startTime: start.getTime(),
          endTime: end.getTime(),
          repeat: hasRepeat,
          scheduleError: scheduleError ?? undefined,
          scheduleTruncated:
            scheduleTruncated &&
            (strictSchedule
              ? (instance as any)[scheduleOccurrenceIndex] === 0
              : occurrenceIndex === 0),
          allDay:
            (startOfDay(start).getTime() == start.getTime() &&
              startOfDay(end).getTime() == end.getTime()) ||
            startDay != endDay,
        });
      });
    });

    events.sort((a, b) => {
      if (a.startDay == b.startDay) {
        if (a.endDay == b.endDay) {
          return a.allDay ? -1 : 1;
        }
        return b.endDay - a.endDay;
      }
      return a.startDay - b.startDay;
    });
    return events.map((event, index, array) => {
      const offset = array.slice(0, index).reduce((acc, e) => {
        if (e.endDay >= event.startDay) {
          return acc + 1;
        }
        return acc;
      }, 0);
      return {
        ...event,
        offset,
      };
    });
  }, [
    props.events,
    props.fieldRepeat,
    props.field,
    props.fieldEnd,
    props.superstate.settings?.dateScheduleAuthoring,
    scheduleMetadataSignature,
    weekStart.getTime(),
    weekEnd.getTime(),
    scheduleWindowStart.getTime(),
    scheduleWindowEnd.getTime(),
  ]);

  const weekItemHeight = !isPhone(props.superstate.ui) ? 30 : 22;

  const [placeholderEvent, setPlaceholderEvent] =
    useState<MonthEventLayout>(null);
  const [dragStartDate, setDragStartDate] = useState<Date>(null);
  useDndMonitor({
    onDragStart: (event) => {
      if (event.active.data.current.type == "day") {
        setDragStartDate(new Date(event.active.data.current.date));
      }
    },
    onDragOver: (event) => {
      if (
        event.active?.data.current.type == "day" &&
        event.over?.data.current.type == "day"
      ) {
        const overDate = new Date(event.over?.data.current.date);
        const startDate = overDate > dragStartDate ? dragStartDate : overDate;
        const endDate = overDate > dragStartDate ? overDate : dragStartDate;

        if (startDate >= weekEnd || endDate <= weekStart) {
          setPlaceholderEvent(null);
          return;
        }
        const offset = weekEvents.reduce((acc, e) => {
          if (e.endDay >= weekEnd.getDay()) {
            return acc + 1;
          }
          return acc;
        }, 0);
        setPlaceholderEvent({
          offset,
          index: -1,
          startDay:
            weekStart < startDate ? startDate.getDay() : weekStart.getDay(),
          endDay: weekEnd > endDate ? endDate.getDay() : weekEnd.getDay(),
          allDay: false,
          repeat: false,
          startTime: startDate.getTime(),
          endTime: endDate.getTime(),
        });
      }
    },
    onDragEnd: (event) => {
      if (
        placeholderEvent &&
        event.over?.data.current.weekStart == weekStart.getTime()
      ) {
        const startDate = formatDate(
          props.superstate.settings,
          dragStartDate,
          "yyyy-MM-dd"
        );
        const endDate = formatDate(
          props.superstate.settings,
          new Date(event.over.data.current.date),
          "yyyy-MM-dd"
        );
        const rect = event.over?.data?.current?.rect;
        props.superstate.ui.quickOpen(
          BlinkMode.Open,
          rect,
          window,
          (link) => {
            if (link) {
              props.insertItem({
                [PathPropertyName]: link,
                [props.field]: startDate,
                [props.fieldEnd]: endDate,
              });
            }
            setPlaceholderEvent(null);
          },
          source
        );
      } else {
        setPlaceholderEvent(null);
      }

      setDragStartDate(null);
    },
  });
  return (
    <div className="mk-month-week">
      {Array.from({ length: 7 }).map((_, index) => {
        const date = add(weekStart, { days: index });
        const isActiveMonth = date.getMonth() === props.date.getMonth();
        return (
          <MonthDayCell
            key={index}
            superstate={props.superstate}
            weekStart={weekStart}
            active={isActiveMonth}
            date={date}
            insertItem={(e) => {
              const latestEventEnd = weekEvents.reduce((acc, event) => {
                const newHour = parseDate(
                  props.events[event.index]
                )?.getHours();
                return newHour > acc ? newHour : acc;
              }, 9);
              const newStart = formatDate(
                props.superstate.settings,
                addHours(startOfDay(date), latestEventEnd),
                isoDateFormat
              );
              const newEnd = formatDate(
                props.superstate.settings,
                addHours(startOfDay(date), latestEventEnd + 1),
                isoDateFormat
              );
              const offset = weekEvents.reduce((acc, e) => {
                if (e.endDay >= index) {
                  return acc + 1;
                }
                return acc;
              }, 0);
              setPlaceholderEvent({
                offset,
                index: -1,
                startDay: index,
                endDay: index,
                startTime: startOfDay(date).getTime(),
                endTime: endOfDay(date).getTime(),
                repeat: false,
                allDay: false,
              });
              const rect = e.currentTarget.getBoundingClientRect();
              props.superstate.ui.quickOpen(
                BlinkMode.Open,
                rect,
                window,
                (link: string) => {
                  if (link) {
                    props.insertItem({
                      [PathPropertyName]: link,
                      [props.field]: newStart,
                      [props.fieldEnd]: newEnd,
                    });
                  }
                  setPlaceholderEvent(null);
                }
              );
            }}
          >
            {placeholderEvent?.startDay == index && (
              <MonthWeekItem
                superstate={props.superstate}
                index={-1}
                style={
                  {
                    "--block-bg-color": applySat(40, "#0098FF"),
                    "--block-color": "#0098FF",
                    "--block-text-color": "var(--mk-ui-text-accent)",
                    top: `${30}px`,
                    width: `${
                      (placeholderEvent.endDay -
                        placeholderEvent.startDay +
                        1) *
                      100
                    }%`,
                  } as React.CSSProperties
                }
                data={{ [PathPropertyName]: "New Event" }}
                startEvent={placeholderEvent.startTime}
                endEvent={placeholderEvent.endTime}
                allDay={false}
              ></MonthWeekItem>
            )}
            {weekEvents
              .filter((f) => f.startDay == index)
              .map((event, i) => {
                const collidesWithPlaceholderEvent = placeholderEvent
                  ? event.startDay <= placeholderEvent.endDay &&
                    event.endDay >= placeholderEvent.startDay
                  : false;
                return (
                  <MonthWeekItem
                    superstate={props.superstate}
                    key={event.occurrenceId ?? i}
                    index={event.index}
                    occurrenceId={event.occurrenceId}
                    interactionDisabled={strictSchedule}
                    startEvent={event.startTime}
                    endEvent={event.endTime}
                    allDay={event.allDay}
                    repeat={event.repeat}
                    scheduleError={event.scheduleError}
                    scheduleTruncated={event.scheduleTruncated}
                    editRepeat={strictSchedule
                      ? strictCalendarScheduleEditor({
                          superstate: props.superstate,
                          row: props.events[event.index],
                          dueField: props.field,
                          repeatField: props.fieldRepeat,
                        })
                      : undefined}
                    style={
                      {
                        "--block-bg-color": event.allDay
                          ? applySat(40, "#0098FF")
                          : "transparent",
                        "--block-color": "#0098FF",
                        "--block-text-color": event.allDay
                          ? "var(--mk-ui-text-accent)"
                          : "var(--mk-ui-text-primary)",
                        top: `${
                          event.offset * weekItemHeight +
                          30 +
                          (collidesWithPlaceholderEvent ? weekItemHeight : 0)
                        }px`,
                        width: `${(event.endDay - event.startDay + 1) * 100}%`,
                        height: `${weekItemHeight - 2}px`,
                      } as React.CSSProperties
                    }
                    data={props.events[event.index]}
                  ></MonthWeekItem>
                );
              })}
          </MonthDayCell>
        );
      })}

      {dragStartDate &&
        createPortal(
          <DragOverlay dropAnimation={defaultDropAnimation}></DragOverlay>,
          document.body
        )}
    </div>
  );
};
