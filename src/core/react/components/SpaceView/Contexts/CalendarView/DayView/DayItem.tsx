import { useDraggable } from "@dnd-kit/core";
import { PathCrumb } from "core/react/components/UI/Crumbs/PathCrumb";
import { showPathContextMenu } from "core/react/components/UI/Menus/navigator/pathContextMenu";
import { SpaceContext } from "core/react/context/SpaceContext";
import { applySat } from "core/utils/color";
import { formatDate } from "core/utils/date";
import { addMinutes, startOfDay } from "date-fns";
import { Superstate } from "makemd-core";
import React, { useContext, useMemo, useState } from "react";
import { PathPropertyName } from "shared/types/context";
import { DBRow } from "shared/types/mdb";
import { windowFromDocument } from "shared/utils/dom";
import { FrameDraggableHandle } from "../../../Frames/FrameNodeEditor/Overlays/FrameDraggableHandle";
import { EventLayout } from "./DayView";
import { PathContext } from "core/react/context/PathContext";

export const DayItem = (props: {
  superstate: Superstate;
  event: EventLayout;
  item: DBRow;
  hourHeight: number;
  startHour: number;
  endHour?: number;
  clone?: boolean;
  updateStartEnd?: (startOffset: number, endOffset: number) => void;
  style?: React.CSSProperties;
  editRepeat?: (e: React.MouseEvent) => void;
  scheduleError?: string;
  scheduleTruncated?: boolean;
  interactionDisabled?: boolean;
}) => {
  const { event, hourHeight, startHour, endHour = 24 } = props;
  const { pathState } = useContext(PathContext);
  const { spaceState } = useContext(SpaceContext);
  
  const { attributes, listeners, setNodeRef, transform } = useDraggable({
    id: `event-${
      event?.occurrenceId ??
      `${event?.index ?? ""}-${event?.start?.getTime().toString() ?? ""}`
    }-${props.clone ? "clone" : ""}`,
    disabled: props.interactionDisabled === true,
    data: {
      type: "event",
      index: event?.index,
    },
  });

  const blockColor = "#0098FF";
  const [intermediate, setIntermediate] = useState<EventLayout>(null);
  const displayEvent: EventLayout = intermediate || event;
  const timeString = useMemo(() => {
    const startDate =
      event.start ??
      addMinutes(startOfDay(new Date()), props.event.startOffset);
    const endDate =
      event.end ?? addMinutes(startOfDay(new Date()), props.event.endOffset);
    const startAndEndAMPM =
      formatDate(props.superstate.settings, startDate, "a") ===
      formatDate(props.superstate.settings, endDate, "a");
    const startFormat = `h${startDate.getMinutes() == 0 ? "" : ":mm"} ${
      startAndEndAMPM ? "" : "a"
    }`;
    const endFormat = `h${endDate.getMinutes() == 0 ? "" : ":mm"} a`;
    return props.event.startOffset > 0
      ? `${formatDate(
          props.superstate.settings,
          startDate,
          startFormat
        )} - ${formatDate(props.superstate.settings, endDate, endFormat)}`
      : null;
  }, [props.event]);

  return (
    <div
      key={event.index}
      onMouseDown={(e) => {
        e.stopPropagation();
      }}
      onContextMenu={(e) => {
        const rect = e.currentTarget.getBoundingClientRect();
       
        showPathContextMenu(
          props.superstate,
          props.item[PathPropertyName],
          spaceState.path,
          rect,
          windowFromDocument(e.currentTarget.ownerDocument)
        );
      }}
      className="mk-day-block"
      style={{
        zIndex: 1,
        ...{
          ...(props.style || {}),
          ...(props.clone
            ? {
                top: `${
                  (displayEvent.startOffset / 60 - startHour) * hourHeight
                }px`,
                width: `calc(${event.widthPercentage}% - ${
                  event.leftOffset * 8
                }px)`,
                height: `${
                  ((displayEvent.endOffset - displayEvent.startOffset) *
                    hourHeight) /
                  60
                }px`,
              }
            : {
                top: `${
                  (displayEvent.startOffset / 60 - startHour) * hourHeight
                }px`,
                height: `${
                  ((displayEvent.endOffset - displayEvent.startOffset) *
                    hourHeight) /
                  60
                }px`,
                left: `calc(${
                  displayEvent.column * displayEvent.widthPercentage
                }% + ${displayEvent.leftOffset * 8}px)`,
                width: `calc(${displayEvent.widthPercentage}% - ${
                  displayEvent.leftOffset * 8
                }px)`,
              }),
        },
      }}
    >
      <div
        {...attributes}
        {...listeners}
        ref={setNodeRef}
        className="mk-day-block-inner"
        style={
          {
            "--block-color": blockColor,
            "--block-bg-color": applySat(40, blockColor),
          } as React.CSSProperties
        }
      >
        <div className="mk-day-block-inner-indicator"></div>
        <div className="mk-day-block-content">
          {props.item[PathPropertyName] ? (
            <PathCrumb
              superstate={props.superstate}
              path={props.item[PathPropertyName]}
              source={spaceState.path}
              hideIcon
            ></PathCrumb>
          ) : (
            "New Event"
          )}
          {timeString && (
            <div className="mk-day-block-time">
              <div
                dangerouslySetInnerHTML={{
                  __html: props.superstate.ui.getSticker("ui//clock"),
                }}
              ></div>
              {timeString}
            </div>
          )}
        </div>
        <span></span>
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
        {(displayEvent.repeat || props.editRepeat) && (props.editRepeat ? (
          <button
            type="button"
            aria-label="Edit recurrence and reminder"
            onClick={props.editRepeat}
            className={`mk-icon-xsmall mk-day-block-repeat ${
              !displayEvent.repeat && "mk-day-block-repeat-hover"
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
        {!displayEvent.allDay && !props.interactionDisabled && (
          <>
            <div className="mk-day-handle-n">
              <FrameDraggableHandle
                value={displayEvent.startOffset}
                cursor="s"
                reverseY={true}
                disableX={true}
                step={60 / hourHeight}
                min={startHour * 60}
                max={displayEvent.endOffset - 15}
                onDragMove={(value) => {
                  const clampedValue = Math.max(startHour * 60, Math.min(value, displayEvent.endOffset - 15));
                  const newIntermediate = {
                    ...event,
                    startOffset: Math.round(clampedValue / 15) * 15,
                  };
                  setIntermediate(newIntermediate);
                }}
                onDragEnd={(value) => {
                  const clampedValue = Math.max(startHour * 60, Math.min(value, displayEvent.endOffset - 15));
                  if (props.updateStartEnd)
                    props.updateStartEnd(
                      Math.round(clampedValue / 15) * 15,
                      displayEvent.endOffset
                    );
                  setIntermediate(null);
                }}
              ></FrameDraggableHandle>
            </div>
            <div className="mk-day-handle-s">
              <FrameDraggableHandle
                value={displayEvent.endOffset}
                cursor="s"
                reverseY={true}
                disableX={true}
                step={60 / hourHeight}
                min={displayEvent.startOffset + 15}
                max={endHour * 60}
                onDragMove={(value) => {
                  const clampedValue = Math.max(displayEvent.startOffset + 15, Math.min(value, endHour * 60));
                  const newIntermediate = {
                    ...event,
                    endOffset: Math.round(clampedValue / 15) * 15,
                  };
                  setIntermediate(newIntermediate);
                }}
                onDragEnd={(value) => {
                  const clampedValue = Math.max(displayEvent.startOffset + 15, Math.min(value, endHour * 60));
                  if (props.updateStartEnd)
                    props.updateStartEnd(
                      displayEvent.startOffset,
                      Math.round(clampedValue / 15) * 15
                    );
                  setIntermediate(null);
                }}
              ></FrameDraggableHandle>
            </div>
          </>
        )}
      </div>
    </div>
  );
};
