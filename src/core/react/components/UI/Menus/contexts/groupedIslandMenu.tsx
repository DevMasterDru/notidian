import { Superstate } from "makemd-core";
import {
  closestCenter,
  DndContext,
  DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Rect } from "shared/types/Pos";
import { reorderGroupedIslandOptions } from "core/utils/contexts/groupedIslandOrder";

export type GroupedIslandOption = {
  name: string;
  value: string;
  color?: string;
};

export type GroupedIslandMenuProps = {
  superstate: Superstate;
  options: GroupedIslandOption[];
  viewOrder?: string[];
  saveGlobalOrder: (values: string[]) => void;
  saveViewOrder: (values: string[]) => void;
  clearViewOrder: () => void;
  disabledReason?: string;
  renameOption?: (oldValue: string, nextValue: string) => void;
};

const completeOrder = (preferred: string[], options: GroupedIslandOption[]) => {
  const configured = options.map((option) => option.value);
  return [
    ...preferred.filter((value) => configured.includes(value)),
    ...configured.filter((value) => !preferred.includes(value)),
  ];
};

export const defaultGroupedIslandMenuWidth = (args: {
  labelWidths: number[];
  fixedRowWidth: number;
  maxWidth: number;
  minWidth?: number;
}): number => {
  const maxWidth = Math.max(0, args.maxWidth);
  const minWidth = Math.min(args.minWidth ?? 280, maxWidth);
  const longestLabel = Math.max(0, ...args.labelWidths);
  return Math.min(maxWidth, Math.max(minWidth, Math.ceil(longestLabel + args.fixedRowWidth)));
};

export const groupedIslandMenuFixedRowWidth = (args: {
  controlWidths: number[];
  gap: number;
  paddingStart: number;
  paddingEnd: number;
  marginStart: number;
  marginEnd: number;
}): number =>
  Math.ceil(
    args.controlWidths.reduce((total, width) => total + width, 0) +
      // A row has a label in addition to its controls, so each control adds
      // one inter-item gap (drag-label and label-rename, for example).
      args.controlWidths.length * args.gap +
      args.paddingStart +
      args.paddingEnd +
      args.marginStart +
      args.marginEnd
  );

const GroupedIslandOptionRow = (props: {
  superstate: Superstate;
  menuWindow: Window;
  option: GroupedIslandOption;
  renameOption?: (oldValue: string, nextValue: string) => void;
}) => {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: props.option.value });
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(props.option.name);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  const commitRename = () => {
    setEditing(false);
    const trimmed = draft.trim();
    if (trimmed.length > 0 && trimmed != props.option.value) {
      props.renameOption?.(props.option.value, trimmed);
    }
    setDraft(props.option.name);
  };

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.55 : 1,
      }}
      className="mk-menu-option mk-grouped-island-option"
    >
      <button
        type="button"
        className="mk-grouped-island-drag-handle"
        aria-label={`Reorder ${props.option.name}`}
        title="Drag to reorder"
        {...attributes}
        {...listeners}
      >
        ⠿
      </button>
      {editing ? (
        <input
          ref={inputRef}
          className="mk-grouped-island-option-input"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commitRename}
          onKeyDown={(e) => {
            if (e.key == "Enter") commitRename();
            if (e.key == "Escape") {
              setEditing(false);
              setDraft(props.option.name);
            }
          }}
        />
      ) : (
        <span
          className="mk-grouped-island-option-name"
          onClick={
            props.renameOption
              ? (e) => {
                  e.stopPropagation();
                  setDraft(props.option.name);
                  setEditing(true);
                }
              : undefined
          }
          style={props.renameOption ? { cursor: "text" } : undefined}
        >
          {props.option.name}
        </span>
      )}
    </div>
  );
};

const GroupedIslandMenuComponent = (
  props: { hide?: () => void; menuWindow: Window } & GroupedIslandMenuProps
) => {
  const menuRef = useRef<HTMLDivElement>(null);
  const hasMeasuredInitialWidth = useRef(false);
  const [initialWidth, setInitialWidth] = useState<number>();
  const initialGlobalOrder = props.options.map((option) => option.value);
  const [globalOrder, setGlobalOrder] = useState(initialGlobalOrder);
  const [scope, setScope] = useState<"global" | "view">(
    props.viewOrder?.length ? "view" : "global"
  );
  const [order, setOrder] = useState(() =>
    completeOrder(
      props.viewOrder?.length ? props.viewOrder : initialGlobalOrder,
      props.options
    )
  );

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  // CSS supplies the content-sized baseline. Measure the full, unclamped
  // labels once so the initial width includes the row controls too; thereafter
  // browser-native horizontal resize remains under the user's control.
  useLayoutEffect(() => {
    if (hasMeasuredInitialWidth.current || !menuRef.current) return;
    const menu = menuRef.current;
    const sizerWidths = Array.from(
      menu.querySelectorAll<HTMLElement>(".mk-grouped-island-width-sizer")
    ).map((sizer) => sizer.getBoundingClientRect().width);
    const fixedRowWidth = Math.max(
      0,
      ...Array.from(
        menu.querySelectorAll<HTMLElement>(".mk-grouped-island-option")
      ).map((row) => {
        const style = props.menuWindow.getComputedStyle(row);
        return groupedIslandMenuFixedRowWidth({
          controlWidths: Array.from(row.querySelectorAll<HTMLButtonElement>("button")).map(
            (button) => button.getBoundingClientRect().width
          ),
          gap: parseFloat(style.columnGap || style.gap) || 0,
          paddingStart: parseFloat(style.paddingLeft) || 0,
          paddingEnd: parseFloat(style.paddingRight) || 0,
          marginStart: parseFloat(style.marginLeft) || 0,
          marginEnd: parseFloat(style.marginRight) || 0,
        });
      })
    );
    hasMeasuredInitialWidth.current = true;
    setInitialWidth(
      defaultGroupedIslandMenuWidth({
        labelWidths: sizerWidths,
        fixedRowWidth,
        maxWidth: Math.min(720, props.menuWindow.innerWidth * 0.8),
      })
    );
  }, [props.menuWindow]);

  const apply = (next: string[]) => {
    setOrder(next);
    if (scope == "global") {
      setGlobalOrder(next);
      props.saveGlobalOrder(next);
    } else props.saveViewOrder(next);
  };
  const selectScope = (nextScope: "global" | "view") => {
    setScope(nextScope);
    setOrder(
      completeOrder(
        nextScope == "view" ? props.viewOrder ?? globalOrder : globalOrder,
        props.options
      )
    );
  };
  const useGlobalOrder = () => {
    props.clearViewOrder();
    setScope("global");
    setOrder(globalOrder);
  };
  const onDragEnd = (event: DragEndEvent) => {
    const activeValue = String(event.active.id);
    const overValue = event.over ? String(event.over.id) : undefined;
    if (!overValue) return;
    apply(reorderGroupedIslandOptions(order, activeValue, overValue));
  };

  return (
    <div
      ref={menuRef}
      className="mk-menu-container mk-grouped-island-menu"
      style={initialWidth == null ? undefined : { width: `${initialWidth}px` }}
    >
      <div className="mk-grouped-island-width-sizers" aria-hidden="true">
        {props.options.map((option) => (
          <span className="mk-grouped-island-width-sizer" key={option.value}>
            {option.name}
          </span>
        ))}
      </div>
      <div className="mk-menu-suggestions">
        <div className="mk-menu-option mk-grouped-island-menu-title">
          Manage groups
        </div>
        <div className="mk-menu-separator"></div>
        {props.disabledReason ? (
          <div className="mk-grouped-island-disabled-reason">
            {props.disabledReason}
          </div>
        ) : (
          <>
            <div className="mk-grouped-island-order-scope">
              <button
                type="button"
                className={scope == "global" ? "is-active" : ""}
                onClick={() => selectScope("global")}
              >
                Global order
              </button>
              <button
                type="button"
                className={scope == "view" ? "is-active" : ""}
                onClick={() => selectScope("view")}
              >
                This view
              </button>
              {props.viewOrder?.length ? (
                <button type="button" onClick={useGlobalOrder}>
                  Use global order
                </button>
              ) : null}
            </div>
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={onDragEnd}
            >
              <SortableContext items={order} strategy={verticalListSortingStrategy}>
                {order.map((value) => {
                  const option = props.options.find((item) => item.value == value);
                  return option ? (
                    <GroupedIslandOptionRow
                      key={value}
                      superstate={props.superstate}
                      menuWindow={props.menuWindow}
                      option={option}
                      renameOption={
                        props.renameOption
                          ? (oldValue, nextValue) => {
                              props.renameOption!(oldValue, nextValue);
                              props.hide?.();
                            }
                          : undefined
                      }
                    />
                  ) : null;
                })}
              </SortableContext>
            </DndContext>
          </>
        )}
      </div>
    </div>
  );
};

export const showGroupedIslandMenu = (
  superstate: Superstate,
  rect: Rect,
  win: Window,
  props: Omit<GroupedIslandMenuProps, "superstate">
) =>
  superstate.ui.openCustomMenu(
    rect,
    <GroupedIslandMenuComponent
      superstate={superstate}
      menuWindow={win}
      {...props}
    />,
    {},
    win,
    // The group label fills the whole table band. A right-anchored custom menu
    // therefore uses the far edge of a potentially very wide table and can be
    // positioned off-screen. Anchor below the label's left edge instead.
    "bottom"
  );
