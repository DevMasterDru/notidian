import {
  closestCenter,
  DndContext,
  DragEndEvent,
  KeyboardSensor,
  MeasuringStrategy,
  PointerSensor,
  useDroppable,
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
import {
  applyPropertyVisibilityDrag,
  hideAllProperties,
  propertyVisibilityKey,
  PropertyVisibilityGroupId,
  showAllProperties,
  splitPropertyVisibilityGroups,
  togglePropertyVisibility,
} from "core/utils/contexts/propertyVisibility";
import { filterPropertiesForNameQuery } from "core/utils/properties/allProperties";
import { Superstate } from "makemd-core";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { stickerForField } from "schemas/mdb";
import i18n from "shared/i18n";
import { SpaceTableColumn } from "shared/types/mdb";
import { Predicate } from "shared/types/predicate";
import { Rect } from "shared/types/Pos";

const SHOWN_GROUP_ID = "mk-properties-group-shown";
const HIDDEN_GROUP_ID = "mk-properties-group-hidden";

export type PropertyVisibilityMenuProps = {
  superstate: Superstate;
  cols: SpaceTableColumn[];
  colsOrder: string[];
  colsHidden: string[];
  savePredicate: (predicate: Partial<Predicate>) => void;
  editProperty?: (col: SpaceTableColumn, rect: Rect) => void;
  newProperty?: (rect: Rect) => void;
};

const PropertyVisibilityRow = (props: {
  superstate: Superstate;
  col: SpaceTableColumn;
  hidden: boolean;
  onToggle: (col: SpaceTableColumn, hidden: boolean) => void;
  onEdit?: (col: SpaceTableColumn, rect: Rect) => void;
}) => {
  const { superstate, col, hidden } = props;
  const key = propertyVisibilityKey(col);
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: key });
  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.5 : 1,
      }}
      className="mk-menu-option mk-property-visibility-row"
    >
      <div
        className="mk-property-visibility-handle"
        {...attributes}
        {...listeners}
        dangerouslySetInnerHTML={{
          __html: superstate.ui.getSticker("ui//mk-ui-handle"),
        }}
      ></div>
      <div
        className="mk-sticker"
        dangerouslySetInnerHTML={{
          __html: superstate.ui.getSticker(stickerForField(col)),
        }}
      ></div>
      <div
        className="mk-menu-options-inner"
        onClick={(e) =>
          // Anchor the edit popup to the bound menu row (currentTarget), not the
          // clicked child glyph within it (Notidian-74n).
          props.onEdit?.(col, e.currentTarget.getBoundingClientRect())
        }
      >
        {col.name}
      </div>
      <button
        className="mk-toolbar-button"
        aria-label={
          hidden ? i18n.menu.unhideProperty : i18n.menu.hideProperty
        }
        onClick={(e) => {
          e.stopPropagation();
          props.onToggle(col, !hidden);
        }}
        dangerouslySetInnerHTML={{
          __html: superstate.ui.getSticker(
            hidden ? "ui//eye-off" : "ui//eye"
          ),
        }}
      ></button>
    </div>
  );
};

const PropertyVisibilityGroup = (props: {
  groupId: string;
  label: string;
  action: string;
  onAction: () => void;
  children: React.ReactNode;
}) => {
  const { setNodeRef } = useDroppable({ id: props.groupId });
  return (
    <div ref={setNodeRef} className="mk-property-visibility-group">
      <div className="mk-menu-option mk-property-visibility-group-header">
        <div className="mk-menu-options-section">{props.label}</div>
        <button className="mk-property-visibility-bulk" onClick={props.onAction}>
          {props.action}
        </button>
      </div>
      {props.children}
    </div>
  );
};

const PropertyVisibilityMenuComponent = (
  props: {
    hide?: () => void;
  } & PropertyVisibilityMenuProps
) => {
  const { superstate, cols } = props;
  // The panel owns visibility/order state while open; each mutation persists
  // the complete pair through savePredicate so sequential edits cannot lose
  // each other to a stale predicate snapshot outside the menu.
  const [colsOrder, setColsOrder] = useState<string[]>(props.colsOrder ?? []);
  const [colsHidden, setColsHidden] = useState<string[]>(
    props.colsHidden ?? []
  );
  const [query, setQuery] = useState("");
  const input = useRef(null);
  useEffect(() => {
    setTimeout(() => {
      input.current?.focus();
    }, 50);
  }, []);

  const groups = useMemo(
    () => splitPropertyVisibilityGroups(cols, colsOrder, colsHidden),
    [cols, colsOrder, colsHidden]
  );
  const visiblePinned = useMemo(
    () => filterPropertiesForNameQuery(groups.pinned, query),
    [groups, query]
  );
  const visibleShown = useMemo(
    () => filterPropertiesForNameQuery(groups.shown, query),
    [groups, query]
  );
  const visibleHidden = useMemo(
    () => filterPropertiesForNameQuery(groups.hidden, query),
    [groups, query]
  );

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 4,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const apply = (change: { colsOrder?: string[]; colsHidden?: string[] }) => {
    const nextOrder = change.colsOrder ?? colsOrder;
    const nextHidden = change.colsHidden ?? colsHidden;
    setColsOrder(nextOrder);
    setColsHidden(nextHidden);
    props.savePredicate({ colsOrder: nextOrder, colsHidden: nextHidden });
  };

  const toggleVisibility = (col: SpaceTableColumn, hidden: boolean) =>
    apply({ colsHidden: togglePropertyVisibility(col, hidden, colsHidden) });

  const onDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over) return;
    const activeKey = active.id as string;
    const overId = over.id as string;
    let overKey: string;
    let targetGroup: PropertyVisibilityGroupId;
    if (overId == SHOWN_GROUP_ID) {
      targetGroup = "shown";
    } else if (overId == HIDDEN_GROUP_ID) {
      targetGroup = "hidden";
    } else {
      overKey = overId;
      targetGroup = groups.hidden.some(
        (f) => propertyVisibilityKey(f) == overId
      )
        ? "hidden"
        : "shown";
    }
    const result = applyPropertyVisibilityDrag(cols, colsOrder, colsHidden, {
      activeKey,
      overKey,
      targetGroup,
    });
    if (result) apply(result);
  };

  return (
    <div className="mk-menu-container mk-property-visibility-menu">
      <div className="mk-menu-suggestions">
        <div className="mk-menu-input">
          <input
            type="text"
            ref={input}
            placeholder={i18n.labels.searchProperties}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onMouseDown={(e) => e.stopPropagation()}
          />
        </div>
        <div className="mk-menu-separator"></div>
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={onDragEnd}
          measuring={{
            droppable: {
              strategy: MeasuringStrategy.Always,
            },
          }}
        >
          <PropertyVisibilityGroup
            groupId={SHOWN_GROUP_ID}
            label={i18n.labels.shownInView}
            action={i18n.labels.hideAllProperties}
            onAction={() =>
              apply({ colsHidden: hideAllProperties(cols, colsHidden) })
            }
          >
            {visiblePinned.map((col) => (
              <div
                key={propertyVisibilityKey(col)}
                className="mk-menu-option mk-property-visibility-row"
              >
                <div className="mk-property-visibility-handle"></div>
                <div
                  className="mk-sticker"
                  dangerouslySetInnerHTML={{
                    __html: superstate.ui.getSticker(stickerForField(col)),
                  }}
                ></div>
                <div className="mk-menu-options-inner">{col.name}</div>
              </div>
            ))}
            <SortableContext
              items={visibleShown.map((f) => propertyVisibilityKey(f))}
              strategy={verticalListSortingStrategy}
            >
              {visibleShown.map((col) => (
                <PropertyVisibilityRow
                  key={propertyVisibilityKey(col)}
                  superstate={superstate}
                  col={col}
                  hidden={false}
                  onToggle={toggleVisibility}
                  onEdit={props.editProperty}
                ></PropertyVisibilityRow>
              ))}
            </SortableContext>
          </PropertyVisibilityGroup>
          <div className="mk-menu-separator"></div>
          <PropertyVisibilityGroup
            groupId={HIDDEN_GROUP_ID}
            label={i18n.labels.hiddenInView}
            action={i18n.labels.showAllProperties}
            onAction={() =>
              apply({ colsHidden: showAllProperties(cols, colsHidden) })
            }
          >
            <SortableContext
              items={visibleHidden.map((f) => propertyVisibilityKey(f))}
              strategy={verticalListSortingStrategy}
            >
              {visibleHidden.map((col) => (
                <PropertyVisibilityRow
                  key={propertyVisibilityKey(col)}
                  superstate={superstate}
                  col={col}
                  hidden={true}
                  onToggle={toggleVisibility}
                  onEdit={props.editProperty}
                ></PropertyVisibilityRow>
              ))}
            </SortableContext>
          </PropertyVisibilityGroup>
        </DndContext>
        {props.newProperty && (
          <>
            <div className="mk-menu-separator"></div>
            <div
              className="mk-menu-option"
              onClick={(e) =>
                // Anchor to the bound new-property row (currentTarget), not the
                // clicked SVG plus-sticker child within it (Notidian-74n).
                props.newProperty(e.currentTarget.getBoundingClientRect())
              }
            >
              <div
                className="mk-sticker"
                dangerouslySetInnerHTML={{
                  __html: superstate.ui.getSticker("ui//plus"),
                }}
              ></div>
              <div className="mk-menu-options-inner">
                {i18n.labels.newProperty}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export const showPropertyVisibilityMenu = (
  superstate: Superstate,
  rect: Rect,
  win: Window,
  props: Omit<PropertyVisibilityMenuProps, "superstate">,
  onHide?: () => void
) => {
  return superstate.ui.openCustomMenu(
    rect,
    <PropertyVisibilityMenuComponent
      superstate={superstate}
      {...props}
    ></PropertyVisibilityMenuComponent>,
    {},
    win,
    null,
    onHide
  );
};
