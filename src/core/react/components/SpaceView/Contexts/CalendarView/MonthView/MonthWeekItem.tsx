import { useDraggable } from "@dnd-kit/core";
import { PathCrumb } from "core/react/components/UI/Crumbs/PathCrumb";
import { PathContext } from "core/react/context/PathContext";
import { SpaceContext } from "core/react/context/SpaceContext";
import { formatDate } from "core/utils/date";
import { Superstate } from "makemd-core";
import React, { useContext, useMemo } from "react";
import { PathPropertyName } from "shared/types/context";
import { DBRow } from "shared/types/mdb";

export const MonthWeekItem = (props: {
  superstate: Superstate;
  data: DBRow;
  index: number;
  startEvent: number;
  endEvent: number;
  allDay: boolean;
  repeat?: boolean;
  editRepeat?: (e: React.MouseEvent) => void;
  scheduleError?: string;
  scheduleTruncated?: boolean;
  occurrenceId?: string;
  interactionDisabled?: boolean;
  style: React.CSSProperties;
}) => {
  const { attributes, listeners, setNodeRef, transform } = useDraggable({
    id: `event-${props.occurrenceId ?? props.index}`,
    disabled: props.interactionDisabled === true,
    data: {
      type: "event",
      index: props.index,
    },
  });
  const {spaceState} = useContext(SpaceContext)
  const timeString = useMemo(() => {
    const startDate = new Date(props.startEvent);

    const startFormat = `h${startDate.getMinutes() == 0 ? "" : ":mm"} a`;
    return !props.allDay
      ? `${formatDate(props.superstate.settings, startDate, startFormat)}`
      : null;
  }, [props.startEvent, props.endEvent, props.allDay]);
  return (
    <div
      className="mk-month-event"
      ref={setNodeRef}
      style={props.style}
      {...attributes}
      {...listeners}
    >
      {!props.allDay && <div className="mk-day-block-inner-indicator"></div>}
      <PathCrumb
        superstate={props.superstate}
        path={props.data[PathPropertyName]}
        source={spaceState.path}
        hideIcon
      />
      <div className="mk-day-block-time">{timeString}</div>
      {props.scheduleError && (
        <span
          className="mk-date-schedule-warning"
          role="img"
          aria-label={`Invalid recurrence: ${props.scheduleError}`}
          title={props.scheduleError}
        >
          !
        </span>
      )}
      {props.scheduleTruncated && !props.scheduleError && (
        <span role="status" className="mk-date-schedule-warning">
          Showing the first 100 occurrences.
        </span>
      )}
      {(props.repeat || props.editRepeat) && (props.editRepeat ? (
        <button
          type="button"
          aria-label="Edit recurrence and reminder"
          onClick={props.editRepeat}
          className={`mk-icon-xsmall mk-day-block-repeat ${
            !props.repeat && "mk-day-block-repeat-hover"
          }`}
          dangerouslySetInnerHTML={{
            __html: props.superstate.ui.getSticker("ui//sync"),
          }}
        ></button>
      ) : (
        <span
          aria-label="Recurring event"
          role="img"
          className="mk-icon-xsmall mk-day-block-repeat"
          dangerouslySetInnerHTML={{
            __html: props.superstate.ui.getSticker("ui//sync"),
          }}
        />
      ))}
    </div>
  );
};
