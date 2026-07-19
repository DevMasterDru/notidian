import {
  DatePickerTimeMode,
  dateScheduleBindingForRow,
  datePickerDefaultDate,
  showDatePickerMenu,
} from "core/react/components/UI/Menus/properties/datePickerMenu";
import {
  formatDate,
  isoDateFormat,
  isValidDate,
  parseDate,
} from "core/utils/date";
import { usesStrictDateSchedule } from "core/utils/date-reminders/schedule";

import classNames from "classnames";
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { windowFromDocument } from "shared/utils/dom";
import { safelyParseJSON } from "shared/utils/json";

import { CellEditMode, TableCellProp } from "../TableView/TableView";

export const DateCell = (props: TableCellProp) => {
  const [value, setValue] = useState(props.initialValue);
  useEffect(() => {
    setValue(props.initialValue);
  }, [props.initialValue]);
  const date = useMemo(() => {
    const dateTime = parseDate(value);
    if (!isValidDate(dateTime)) {
      return null;
    }
    return dateTime;
  }, [value]);
  const saveValue = (date: Date, hasTime: boolean) => {
    const newValue = formatDate(
      props.superstate.settings,
      date,
      hasTime ? isoDateFormat : "yyyy-MM-dd"
    );
    
    props.saveValue(newValue);
    setValue(newValue);
    props.setEditMode(null);
  };
  const menuRef = useRef(null);
  const ref = useRef(null);
  useEffect(() => {
    if (props.editMode == CellEditMode.EditModeActive) {
      if (ref.current) {
        showPicker();
        ref.current.focus();
      }
    }
  }, [props.editMode]);
  const defaultDate = datePickerDefaultDate(
    date,
    props.superstate.settings.datePickerTime,
  );
  const showPicker = useCallback(
    (e?: React.MouseEvent) => {
      if (props.editMode <= CellEditMode.EditModeNone) {
        return;
      }

      // Anchor to the bound .mk-cell-date control (currentTarget), not the clicked
      // child (Notidian-3txp). When invoked without an event, fall back to the
      // cell ref. Synchronous read.
      const offset = e
        ? e.currentTarget.getBoundingClientRect()
        : ref.current.getBoundingClientRect();
      menuRef.current = showDatePickerMenu(
        props.superstate.ui,
        offset,
        e ? windowFromDocument(e.view.document) : window,
        defaultDate,
        saveValue,
        DatePickerTimeMode.Toggle,
        null,
        "bottom",
        usesStrictDateSchedule(props.superstate.settings) &&
          props.property?.name === "due" &&
          props.path &&
          props.row
          ? dateScheduleBindingForRow({
              superstate: props.superstate,
              row: props.row,
              path: props.path,
              due: props.row.due ?? value,
              onSaved: (next) => {
                const savedDue = next.due instanceof Date
                  ? formatDate(
                      props.superstate.settings,
                      next.due,
                      next.due.getHours() || next.due.getMinutes() || next.due.getSeconds()
                        ? isoDateFormat
                        : "yyyy-MM-dd",
                    )
                  : String(next.due);
                setValue(savedDue);
                props.setEditMode(null);
              },
            })
          : undefined,
      );
    },
    [date, value, props.row, props.path, props.property?.name]
  );

  const onKeyDown = (e: React.KeyboardEvent) => {
    e.stopPropagation();
    if (e.key == "Enter" || e.key == "Escape") {
      (e.target as HTMLInputElement).blur();
      saveValue(date, false);
      menuRef.current.hide();
    }
  };
  const format = useMemo(
    () => safelyParseJSON(props.propertyValue)?.format,
    [props.propertyValue]
  );
  const isEmpty = !(value?.length > 0);
  return props.editMode > CellEditMode.EditModeNone ? (
    <div className="mk-cell-date" onClick={(e) => showPicker(e)}>
      <div
        className={classNames(
          "mk-cell-date-item",
          isEmpty && "mk-cell-date-new"
        )}
      >
        <div
          className="mk-icon-xsmall"
          dangerouslySetInnerHTML={{
            __html: props.superstate.ui.getSticker("ui//calendar"),
          }}
        ></div>
        {isEmpty && "Select"}
        {props.editMode != CellEditMode.EditModeActive ?
         <div className="mk-cell-text">
            {date
              ? formatDate(
                  props.superstate.settings,
                  date,
                  format?.length > 0 ? format : null
                )
              : value}
          </div> : 
        <input
            onClick={(e) => e.stopPropagation()}
            className="mk-cell-text"
            ref={ref}
            type="text"
            value={value as string}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={onKeyDown}
            // onBlur={onBlur}
          />}
      </div>
    </div>
  ) : 
          <div className="mk-cell-text">
            {date
              ? formatDate(
                  props.superstate.settings,
                  date,
                  format?.length > 0 ? format : null
                )
              : value}
          </div>;
};
