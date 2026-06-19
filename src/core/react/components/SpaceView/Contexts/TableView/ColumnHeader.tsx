import { useDraggable, useDroppable } from "@dnd-kit/core";
import { showNewPropertyMenu } from "core/react/components/UI/Menus/contexts/newSpacePropertyMenu";
import { showPropertyMenu } from "core/react/components/UI/Menus/contexts/spacePropertyMenu";
import { ContextEditorContext } from "core/react/context/ContextEditorContext";
import { SpaceContext } from "core/react/context/SpaceContext";
import { useCombinedRefs } from "core/react/hooks/useCombinedRef";
import { optionValuesForColumn } from "core/utils/contexts/optionValuesForColumn";
import {
  colsSizeWithPreservedPropertyHeaderWidth,
  defaultPropertyHeaderDisplayMode,
  propertyHeaderDisplayParts,
} from "core/utils/contexts/propertyHeaderDisplayMode";
import {
  frozenColumnCountForColumn,
  tableColumnId,
} from "core/utils/contexts/tableFreeze";
import { isFrontmatterBackedProperty } from "core/utils/properties/allProperties";
import { propertyHeaderNameInfo } from "core/utils/contexts/propertyHeaderName";
import {
  propertyHeaderTooltipPosition,
  PropertyHeaderTooltipPosition,
  PropertyHeaderTooltipRect,
} from "core/utils/contexts/propertyHeaderTooltipPosition";
import { tagSpacePathFromTag } from "core/utils/strings";
import { Superstate } from "makemd-core";
import classNames from "classnames";
import React, {
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { stickerForField } from "schemas/mdb";
import i18n from "shared/i18n";
import { PathPropertyName } from "shared/types/context";
import { SpaceTableColumn } from "shared/types/mdb";
import {
  ColumnDataAnchorMode,
  ColumnHeaderDisplayMode,
  ColumnWrapMode,
} from "shared/types/predicate";
import { windowFromDocument } from "shared/utils/dom";

export const filePropTypes = [
  {
    name: i18n.properties.fileProperty.name,
    value: "name",
  },
  {
    name: i18n.properties.fileProperty.createdTime,
    value: "ctime",
  },
  {
    name: i18n.properties.fileProperty.modifiedTime,
    value: "mtime",
  },
  {
    name: i18n.properties.fileProperty.sticker,
    value: "sticker",
  },
  {
    name: i18n.properties.fileProperty.extension,
    value: "extension",
  },
  {
    name: i18n.properties.fileProperty.size,
    value: "size",
  },
  {
    name: i18n.properties.fileProperty.parentFolder,
    value: "folder",
  },
  {
    name: i18n.properties.fileProperty.links,
    value: "inlinks",
  },
  {
    name: i18n.properties.fileProperty.tags,
    value: "tags",
  },
  {
    name: i18n.properties.fileProperty.spaces,
    value: "spaces",
  },
];
type PropertyHeaderTooltipState = {
  title: string;
  anchorRect: PropertyHeaderTooltipRect;
  position: PropertyHeaderTooltipPosition;
};

const defaultPropertyHeaderTooltipSize = {
  width: 140,
  height: 34,
};

const rectForPropertyHeaderTooltip = (
  rect: DOMRect
): PropertyHeaderTooltipRect => ({
  left: rect.left,
  top: rect.top,
  width: rect.width,
  height: rect.height,
});

export const ColumnHeader = (props: {
  superstate: Superstate;
  editable: boolean;
  column: SpaceTableColumn;
  isNew?: boolean;
  columnWidth?: number;
  headerDisplayMode?: ColumnHeaderDisplayMode;
  setHeaderDisplayMode?: (mode: ColumnHeaderDisplayMode) => void;
  dataAnchorMode?: ColumnDataAnchorMode;
  setDataAnchorMode?: (mode: ColumnDataAnchorMode) => void;
  wrapMode?: ColumnWrapMode;
  setWrapMode?: (mode: ColumnWrapMode) => void;
}) => {
  const [field, setField] = useState(props.column);
  const menuRef = useRef(null);
  const { spaceInfo, spaceState: spaceCache } = useContext(SpaceContext);

  const {
    predicate,
    tableData,
    contextTable,
    cols,
    newColumn,
    saveColumn,
    renameFrontmatterPropertyKey,
    deleteFrontmatterPropertyKey,
    savePredicate,
    hideColumn,
    sortColumn,
    delColumn,
  } = useContext(ContextEditorContext);
  useEffect(() => {
    setField(props.column);
  }, [props.column]);

  const {
    attributes,
    listeners,
    setNodeRef: setDraggableNodeRef,
    transform,
  } = useDraggable({
    id: field.name + field.table,
    data: { name: field.name },
  });

  const {
    setNodeRef: setDroppableNodeRef,
    isOver,
    active,
  } = useDroppable({
    id: field.name + field.table,
    data: { name: field.name },
  });
  const saveField = (field: SpaceTableColumn) => {
    if (field.name.length > 0) {
      if (
        field.name != props.column.name ||
        field.type != props.column.type ||
        field.value != props.column.value ||
        field.attrs != props.column.attrs
      ) {
        const saveResult = saveColumn(field, props.column);
        if (saveResult) {
          if (props.isNew) {
            setField(props.column);
          }
        }
      }
    }
  };

  const showNewMenu = (e: React.MouseEvent) => {
    const offset = ref.current.getBoundingClientRect();

    showNewPropertyMenu(
      props.superstate,
      offset,
      windowFromDocument(e.view.document),
      {
        spaces: spaceCache?.contexts ?? [],
        fields: cols,
        saveField: (source, field) => {
          return newColumn({ ...field, table: source });
        },
        schemaId: tableData.schema.id,
        contextPath: spaceInfo.path,
        // Columns that already exist but are hidden — surfaced in the "Add
        // existing property" picker so they can be re-shown rather than being
        // unreachable (all frontmatter keys are persisted columns, so the
        // discover-only list is otherwise empty). Picking one un-hides it.
        hiddenColumns: cols.filter((c) =>
          (predicate?.colsHidden ?? []).includes(c.name + c.table)
        ),
        showColumn: (col) => hideColumn(col, false),
      }
    );
  };

  const toggleMenu = (e: React.MouseEvent) => {
    if (props.isNew) {
      showNewMenu(e);
    } else {
      // Anchor to the bound column header (currentTarget), not the clicked SVG
      // .mk-path-context-field-icon child within it (Notidian-3txp). Synchronous
      // read keeps currentTarget valid.
      const offset = e.currentTarget.getBoundingClientRect();
      const options = optionValuesForColumn(
        field.name,
        field.table == ""
          ? tableData
          : contextTable[tagSpacePathFromTag(field.table)]
      );
      const columnId = tableColumnId(field);
      const preserveColumnWidth =
        typeof props.columnWidth == "number"
          ? () =>
              savePredicate({
                colsSize: colsSizeWithPreservedPropertyHeaderWidth({
                  colsSize: predicate?.colsSize ?? {},
                  columnId,
                  columnWidth: props.columnWidth,
                }),
              })
          : undefined;

      showPropertyMenu({
        superstate: props.superstate,
        rect: offset,
        win: windowFromDocument(e.view.document),
        editable: field.name != PathPropertyName,
        options,
        field,
        fields: cols,
        contextPath: spaceInfo.path,
        saveField,
        hide: hideColumn,
        deleteColumn: delColumn,
        sortColumn,
        freezeColumn: () =>
          savePredicate({
            frozenColumnCount: frozenColumnCountForColumn({
              columns: cols,
              hiddenColumnIds: predicate?.colsHidden ?? [],
              columnId,
            }),
          }),
        unfreezeColumns: () =>
          savePredicate({
            frozenColumnCount: 0,
          }),
        renamePropertyKey:
          isFrontmatterBackedProperty(field) && field.table == ""
            ? (event) => {
                const win = windowFromDocument(event.view.document);
                const nextKey = win.prompt(
                  "Rename frontmatter property key",
                  field.name
                );
                if (nextKey == null) return;
                renameFrontmatterPropertyKey(field, nextKey, (message) =>
                  win.confirm(message)
                );
              }
            : undefined,
        deleteFrontmatterProperty:
          isFrontmatterBackedProperty(field) && field.table == ""
            ? (event) => {
                const win = windowFromDocument(event.view.document);
                deleteFrontmatterPropertyKey(field, (message) =>
                  win.confirm(message)
                );
              }
            : undefined,
        headerDisplayMode:
          props.headerDisplayMode ?? defaultPropertyHeaderDisplayMode,
        setHeaderDisplayMode: props.setHeaderDisplayMode,
        dataAnchorMode: props.dataAnchorMode ?? "auto",
        setDataAnchorMode: props.setDataAnchorMode,
        wrapMode: props.wrapMode ?? "clip",
        setWrapMode: props.setWrapMode,
        preserveColumnWidth,
        frozenColumnCount: predicate?.frozenColumnCount ?? 0,
        hidden: predicate?.colsHidden.includes(field.name + field.table),
      });
    }
  };
  const ref = useRef(null);
  const propertyHeaderRef = useRef<HTMLDivElement | null>(null);
  const tooltipRef = useRef<HTMLDivElement | null>(null);
  const [propertyHeaderTooltip, setPropertyHeaderTooltip] =
    useState<PropertyHeaderTooltipState | null>(null);
  const setNodeRef = useCombinedRefs(setDroppableNodeRef, setDraggableNodeRef);
  const headerNameInfo = field ? propertyHeaderNameInfo(field) : null;
  const headerName = headerNameInfo?.displayName ?? "";
  const headerDisplayParts = propertyHeaderDisplayParts({
    mode: props.headerDisplayMode ?? defaultPropertyHeaderDisplayMode,
    columnWidth: props.columnWidth,
  });

  const showPropertyHeaderTooltip = useCallback(() => {
    if (!propertyHeaderRef.current || !headerName) return;
    const win = propertyHeaderRef.current.ownerDocument.defaultView;
    if (!win) return;

    const anchorRect = rectForPropertyHeaderTooltip(
      propertyHeaderRef.current.getBoundingClientRect()
    );
    setPropertyHeaderTooltip({
      title: headerNameInfo?.tooltipName ?? headerName,
      anchorRect,
      position: propertyHeaderTooltipPosition({
        anchorRect,
        tooltipSize: defaultPropertyHeaderTooltipSize,
        viewportWidth: win.innerWidth,
      }),
    });
  }, [headerName, headerNameInfo?.tooltipName]);

  const hidePropertyHeaderTooltip = useCallback(() => {
    setPropertyHeaderTooltip(null);
  }, []);

  useLayoutEffect(() => {
    if (!propertyHeaderTooltip || !tooltipRef.current) return;
    const win = tooltipRef.current.ownerDocument.defaultView;
    if (!win) return;

    const tooltipRect = tooltipRef.current.getBoundingClientRect();
    const nextPosition = propertyHeaderTooltipPosition({
      anchorRect: propertyHeaderTooltip.anchorRect,
      tooltipSize: {
        width: tooltipRect.width,
        height: tooltipRect.height,
      },
      viewportWidth: win.innerWidth,
    });

    setPropertyHeaderTooltip((current) => {
      if (!current) return current;
      const samePosition =
        Math.abs(current.position.left - nextPosition.left) < 0.5 &&
        Math.abs(current.position.top - nextPosition.top) < 0.5 &&
        Math.abs(current.position.arrowLeft - nextPosition.arrowLeft) < 0.5;

      return samePosition
        ? current
        : {
            ...current,
            position: nextPosition,
          };
    });
  }, [
    propertyHeaderTooltip?.anchorRect.left,
    propertyHeaderTooltip?.anchorRect.top,
    propertyHeaderTooltip?.anchorRect.width,
    propertyHeaderTooltip?.anchorRect.height,
    propertyHeaderTooltip?.title,
  ]);

  useEffect(() => {
    if (!propertyHeaderTooltip || !propertyHeaderRef.current) return;
    const win = propertyHeaderRef.current.ownerDocument.defaultView;
    if (!win) return;

    win.addEventListener("resize", hidePropertyHeaderTooltip);
    win.addEventListener("scroll", hidePropertyHeaderTooltip, true);
    return () => {
      win.removeEventListener("resize", hidePropertyHeaderTooltip);
      win.removeEventListener("scroll", hidePropertyHeaderTooltip, true);
    };
  }, [hidePropertyHeaderTooltip, propertyHeaderTooltip]);

  const propertyHeaderTooltipPortalTarget =
    propertyHeaderRef.current?.ownerDocument.body;

  useEffect(() => {
    if (!propertyHeaderTooltip || !propertyHeaderTooltipPortalTarget) return;

    propertyHeaderTooltipPortalTarget.classList.add(
      "mk-property-header-tooltip-visible"
    );
    return () => {
      propertyHeaderTooltipPortalTarget.classList.remove(
        "mk-property-header-tooltip-visible"
      );
    };
  }, [propertyHeaderTooltip, propertyHeaderTooltipPortalTarget]);

  // Drop-target feedback for column reordering: show an insertion line on the
  // over-column indicating where the dragged header will land. handleDragEnd
  // uses arrayMove(colsOrder, activeIndex, overIndex), so dragging rightward
  // (active before over) inserts AFTER the target, leftward inserts BEFORE.
  // Side is logical (before/after); RTL flips the physical edge in CSS.
  const columnDropSide: "before" | "after" | null = (() => {
    if (!isOver) return null;
    const activeId = active?.id?.toString();
    const thisId = field.name + field.table;
    if (!activeId || activeId == thisId) return null;
    const order = cols.map((c) => c.name + c.table);
    const activeIndex = order.indexOf(activeId);
    const overIndex = order.indexOf(thisId);
    if (activeIndex == -1 || overIndex == -1) return "before";
    return activeIndex < overIndex ? "after" : "before";
  })();

  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      className={classNames(
        "mk-col-header",
        `mk-col-header--${headerDisplayParts.effectiveMode}`,
        columnDropSide && `mk-col-header--drop-${columnDropSide}`
      )}
      onClick={(e) => {
        toggleMenu(e);
      }}
    >
      <div ref={ref}>
        {props.column.name.length > 0 ? (
          <div
            ref={propertyHeaderRef}
            className={[
              "mk-property-header-content",
              `mk-property-header-content--${headerDisplayParts.effectiveMode}`,
              headerNameInfo?.hasGeneratedDisplayName
                ? "mk-property-header-name--generated"
                : "",
            ]
              .filter(Boolean)
              .join(" ")}
            onMouseEnter={showPropertyHeaderTooltip}
            onMouseLeave={hidePropertyHeaderTooltip}
          >
            {headerDisplayParts.showIcon ? (
              <div
                className="mk-path-context-field-icon mk-property-header-icon"
                dangerouslySetInnerHTML={{
                  __html: props.superstate.ui.getSticker(
                    stickerForField(field)
                  ),
                }}
              ></div>
            ) : null}
            {headerDisplayParts.showText ? (
              <div className="mk-path-context-field-key mk-property-header-name">
                <span className="mk-property-header-name-text">
                  {headerName}
                </span>
              </div>
            ) : null}
          </div>
        ) : (
          "+"
        )}
        {headerDisplayParts.showContextMarker ? (
          <span
            className="mk-col-header-context"
            aria-label={
              props.column.table.length > 0 ? props.column.table : ""
            }
          >
            {props.column.table.length > 0 ? "#" : ""}
          </span>
        ) : null}
      </div>
      {propertyHeaderTooltip && propertyHeaderTooltipPortalTarget
        ? createPortal(
            <div
              ref={tooltipRef}
              className="mk-property-header-tooltip"
              style={
                {
                  left: propertyHeaderTooltip.position.left,
                  top: propertyHeaderTooltip.position.top,
                  "--mk-property-header-tooltip-arrow-left": `${propertyHeaderTooltip.position.arrowLeft}px`,
                } as React.CSSProperties
              }
            >
              <div className="mk-property-header-tooltip-title">
                {propertyHeaderTooltip.title}
              </div>
            </div>,
            propertyHeaderTooltipPortalTarget
          )
        : null}
    </div>
  );
};
