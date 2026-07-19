import { useDraggable } from "@dnd-kit/core";
import { PathCrumb } from "core/react/components/UI/Crumbs/PathCrumb";
import { SpaceContext } from "core/react/context/SpaceContext";
import { Superstate } from "makemd-core";
import React, { useContext } from "react";
import { PathPropertyName } from "shared/types/context";
import { DBRow } from "shared/types/mdb";

export const AllDayItem = (props: {
  superstate: Superstate;
  data: DBRow;
  index: number;
  startDay: number;
  endDay: number;
  topOffset: number;
  style?: React.CSSProperties;
  repeat?: boolean;
  editRepeat?: (e: React.MouseEvent) => void;
  scheduleError?: string;
  scheduleTruncated?: boolean;
  occurrenceId?: string;
  interactionDisabled?: boolean;
}) => {
  const {spaceState} = useContext(SpaceContext)
  const { attributes, listeners, setNodeRef, transform } = useDraggable({
    id: `event-${props.occurrenceId ?? props.index}`,
    disabled: props.interactionDisabled === true,
    data: {
      type: "event",
      index: props.index,
    },
  });
  return (
    <div
      className="mk-week-event"
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      style={{
        ...props.style,
        left: "2px",
        width: `calc(${(props.endDay - props.startDay + 1) * 100}% - 4px)`,
        top: `${props.topOffset * 22 + 2}px`,
      }}
    >
      <PathCrumb
        superstate={props.superstate}
        path={props.data[PathPropertyName]}
        source={spaceState.path}
      />
      {props.scheduleError && (
        <span
          role="img"
          className="mk-date-schedule-warning"
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
          className="mk-icon-xsmall mk-day-block-repeat"
          dangerouslySetInnerHTML={{
            __html: props.superstate.ui.getSticker("ui//sync"),
          }}
        />
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
