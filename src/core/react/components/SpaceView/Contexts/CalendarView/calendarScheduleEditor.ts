import { parseDate, isValidDate } from "core/utils/date";
import {
  calendarDueValue,
  calendarRepeatValue,
  usesStrictDateSchedule,
} from "core/utils/date-reminders/schedule";
import {
  DatePickerTimeMode,
  dateScheduleBindingForRow,
  showDatePickerMenu,
} from "core/react/components/UI/Menus/properties/datePickerMenu";
import { Superstate } from "makemd-core";
import React from "react";
import { PathPropertyName } from "shared/types/context";
import { DBRow } from "shared/types/mdb";
import { windowFromDocument } from "shared/utils/dom";

export const strictCalendarScheduleEditor = ({
  superstate,
  row,
  dueField,
  repeatField,
}: {
  superstate: Superstate;
  row: DBRow | undefined;
  dueField: string | undefined;
  repeatField: string | undefined;
}): ((click: React.MouseEvent) => void) | undefined => {
  if (!usesStrictDateSchedule(superstate.settings)) return undefined;
  const rowPath = row?.[PathPropertyName];
  const canonicalState = typeof rowPath === "string"
    ? superstate.pathsIndex?.get(rowPath)
    : undefined;
  const hasCanonicalSnapshot = canonicalState !== undefined;
  const canonicalProperty = canonicalState?.metadata?.property;
  const dueValue = calendarDueValue(
    row ?? {},
    dueField,
    canonicalProperty,
    hasCanonicalSnapshot,
  );
  const dueDate = parseDate(dueValue);
  if (typeof rowPath !== "string" || !rowPath || !isValidDate(dueDate)) {
    return undefined;
  }
  return (click: React.MouseEvent) =>
    showDatePickerMenu(
      superstate.ui,
      click.currentTarget.getBoundingClientRect(),
      windowFromDocument(click.currentTarget.ownerDocument),
      dueDate,
      () => {},
      DatePickerTimeMode.Toggle,
      undefined,
      "bottom",
      dateScheduleBindingForRow({
        superstate,
        row: {
          ...row,
          due: dueValue as any,
          repeat: calendarRepeatValue(
            row,
            repeatField,
            true,
            canonicalProperty,
            hasCanonicalSnapshot,
          ) as any,
        },
        path: rowPath,
        due: dueValue,
      }),
    );
};
