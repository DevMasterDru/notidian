import {
  closestCenter,
  type CollisionDetection,
  DndContext,
  DragEndEvent,
  DragOverEvent,
  DragOverlay,
  DragStartEvent,
  MeasuringStrategy,
  MouseSensor,
  pointerWithin,
  TouchSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { arrayMove } from "@dnd-kit/sortable";
import {
  ColumnSizingState,
  flexRender,
  getCoreRowModel,
  getExpandedRowModel,
  getGroupedRowModel,
  getPaginationRowModel,
  OnChangeFn,
  PaginationState,
  RowData,
  useReactTable,
} from "@tanstack/react-table";

import React, {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { DBRow, SpaceProperty, SpaceTableColumn } from "shared/types/mdb";
import { uniq } from "shared/utils/array";
import { ColumnHeader } from "./ColumnHeader";

import classNames from "classnames";
import { showRowContextMenu } from "core/react/components/UI/Menus/contexts/rowContextMenu";
import { defaultMenu } from "core/react/components/UI/Menus/menu/SelectionMenu";

import { ContextEditorContext } from "core/react/context/ContextEditorContext";
import { PathContext } from "core/react/context/PathContext";
import { SpaceContext } from "core/react/context/SpaceContext";
import { parseFieldValue } from "core/schemas/parseFieldValue";
import { newPathInSpace } from "core/superstate/utils/spaces";
import { PointerModifiers } from "core/types/ui";
import { createNewRow } from "core/utils/contexts/optionValuesForColumn";
import { pageTitleFromPath } from "core/utils/contexts/pageTitle";
import {
  parseTableClipboardText,
  serializeTableClipboardGrid,
} from "core/utils/contexts/tableClipboard";
import {
  feedbackWriteForDirectCellEdit,
  feedbackForTableEditResult,
  hasTableEditFeedbackAction,
  incrementResetTokensForFeedback,
  pendingFeedbackForWrites,
  summaryForTableEditResult,
  tableCellFeedbackKey,
  TableCellResetTokens,
  TableEditFeedback,
  TableEditFeedbackWrite,
  titleForTableEditFeedback,
} from "core/utils/contexts/tableEditFeedback";
import {
  TableCellWrite,
  TableEditTransactionResult,
} from "core/utils/contexts/tableEditTransaction";
import {
  planTablePaste,
  TablePasteMode,
} from "core/utils/contexts/tablePastePlan";
import {
  createTableUndoEntry,
  filterTableUndoEntryForResult,
  pushTableUndoEntry,
  tableUndoWriteForDirectEdit,
  TableUndoEntry,
} from "core/utils/contexts/tableUndoJournal";
import {
  CellSelection,
  cellSelectionBounds,
  extendCellSelection,
  moveCellSelection,
  selectionContainsCell,
} from "core/utils/contexts/tableSelection";
import {
  moveVisibleRows,
  rowDragSet,
} from "core/utils/contexts/tableRowOrder";
import {
  clampFrozenColumnCount,
  rowGutterWidthForRowCount,
  stickyOffsetsForFrozenColumns,
} from "core/utils/contexts/tableFreeze";
import {
  propertyHeaderColumnSizingWithMinimum,
  propertyHeaderColumnWidthStyle,
  propertyHeaderColumnWidthForSize,
  propertyHeaderDisplayModeForValue,
  propertyHeaderMinimumColumnWidth,
  propertyHeaderUsesCompactCellLayout,
} from "core/utils/contexts/propertyHeaderDisplayMode";
import {
  columnDataAnchorForCells,
  columnDataAnchorModeForValue,
} from "core/utils/contexts/propertyDataAnchor";
import {
  isRowDndId,
  resolveRowDropTargetId,
  rowDndId,
  rowIdFromDndId,
  RowDragPoint,
} from "core/utils/contexts/tableRowDragTarget";
import {
  rowDragOverlayColumns,
  rowDragOverlayLabel,
} from "core/utils/contexts/tableRowDragOverlay";
import {
  nextTableLoadMorePageSize,
  tableLoadedRowCount,
  tableLoadAllPageSize,
} from "core/utils/contexts/tablePagination";
import {
  aggregateFnTypes,
  calculateAggregate,
} from "core/utils/contexts/predicate/aggregates";
import { safeFormatNumber } from "core/utils/number";
import { isTouchScreen } from "core/utils/ui/screen";
import {
  selectNextIndex,
  selectRange,
} from "core/utils/ui/selection";
import { debounce } from "lodash";
import { SelectOption, Superstate } from "makemd-core";
import { fieldTypeForField, fieldTypeForType } from "schemas/mdb";
import i18n from "shared/i18n";
import { defaultContextSchemaID } from "shared/schemas/context";
import { PathPropertyName } from "shared/types/context";
import {
  ColumnDataAnchorMode,
  ColumnHeaderDisplayMode,
  Filter,
} from "shared/types/predicate";
import { windowFromDocument } from "shared/utils/dom";
import { DataTypeView, DataTypeViewProps } from "../DataTypeView/DataTypeView";

declare module "@tanstack/table-core" {
  interface ColumnMeta<TData extends RowData, TValue> {
    table: string;
    editable: boolean;
    schemaId: string;
    fieldType?: string;
  }
}

type TableUndoJournalState = {
  undo: TableUndoEntry[];
  redo: TableUndoEntry[];
};

type TableMarqueeRect = {
  left: number;
  top: number;
  width: number;
  height: number;
};

type TableRowMarqueeItem = {
  rowId: string;
  rect: DOMRect;
};

type TableRowMarqueeState = {
  active: boolean;
  originX: number;
  originY: number;
  anchorRowId: string;
  rowRects: TableRowMarqueeItem[];
  tableRect: DOMRect;
};

const tableUndoJournalStore = new Map<string, TableUndoJournalState>();
const defaultTableColumnWidth = 150;

const tableUndoJournalForKey = (key: string): TableUndoJournalState =>
  tableUndoJournalStore.get(key) ?? { undo: [], redo: [] };

export enum CellEditMode {
  EditModeReadOnly,
  EditModeNone, //No Edit for Most Types except bool
  EditModeView, //View mode, toggleable to edit mode
  EditModeValueOnly, //Can Only Edit Value
  EditModeActive, //Active Edit mode, toggelable to view mode
  EditModeAlways, //Always Edit
}

export type TableCellProp = {
  initialValue: string;
  property: SpaceProperty;
  compactMode: boolean;
  saveValue: (value: string) => void;
  renameValue?: (value: string) => Promise<string | null>;
  startEditing?: () => void;
  editMode?: CellEditMode;
  setEditMode?: (editMode: [string, string]) => void;
  superstate: Superstate;
  propertyValue?: string;
  path?: string;
};

export type TableCellMultiProp = TableCellProp & {
  multi: boolean;
};

const rectFromPoints = (
  startX: number,
  startY: number,
  endX: number,
  endY: number
): TableMarqueeRect => ({
  left: Math.min(startX, endX),
  top: Math.min(startY, endY),
  width: Math.max(1, Math.abs(endX - startX)),
  height: Math.max(1, Math.abs(endY - startY)),
});

const rectsIntersect = (
  a: Pick<TableMarqueeRect, "left" | "top" | "width" | "height">,
  b: Pick<TableMarqueeRect, "left" | "top" | "width" | "height">
): boolean =>
  a.left < b.left + b.width &&
  a.left + a.width > b.left &&
  a.top < b.top + b.height &&
  a.top + a.height > b.top;

const rectRelativeTo = (
  rect: TableMarqueeRect,
  container: DOMRect
): TableMarqueeRect => ({
  left: rect.left - container.left,
  top: rect.top - container.top,
  width: rect.width,
  height: rect.height,
});

const rowDragPointFromEvent = (
  event:
    | React.MouseEvent<HTMLElement>
    | React.TouchEvent<HTMLElement>
    | MouseEvent
    | TouchEvent
): RowDragPoint | null => {
  if ("clientX" in event && "clientY" in event) {
    return { x: event.clientX, y: event.clientY };
  }

  const touch = event.touches?.[0] ?? event.changedTouches?.[0];
  return touch ? { x: touch.clientX, y: touch.clientY } : null;
};

const TableRowDragHandle = (props: {
  rowId: string;
  rowNumber: number;
  rowGutterWidth: number;
  selected: boolean;
  disabled: boolean;
  frozen: boolean;
  onReorderStart: (
    event:
      | React.MouseEvent<HTMLButtonElement>
      | React.TouchEvent<HTMLButtonElement>,
    rowId: string
  ) => void;
  onSelectStart: (
    event: React.MouseEvent<HTMLTableCellElement>,
    rowId: string
  ) => void;
}) => {
  const {
    attributes,
    listeners,
    setNodeRef,
    isDragging,
  } = useDraggable({
    id: rowDndId(props.rowId),
    disabled: props.disabled,
    data: { type: "row", rowId: props.rowId },
  });
  const listenerProps = props.disabled ? undefined : listeners;

  return (
    <td
      className={classNames(
        "mk-row-gutter",
        props.selected && "mk-row-gutter-selected",
        props.frozen && "mk-frozen-row-gutter"
      )}
      onMouseDown={(e) => props.onSelectStart(e, props.rowId)}
      style={propertyHeaderColumnWidthStyle(props.rowGutterWidth)}
    >
      <div className="mk-row-gutter-inner">
        <div
          className={classNames(
            "mk-row-selector",
            props.selected && "mk-row-selector-selected"
          )}
          role="button"
          aria-label={`Select row ${props.rowNumber}`}
          aria-pressed={props.selected}
        >
          <span className="mk-row-number">{props.rowNumber}</span>
        </div>
        <button
          ref={setNodeRef}
          type="button"
          className={classNames(
            "mk-row-drag-handle",
            props.selected && "mk-row-drag-handle-selected",
            isDragging && "mk-row-drag-handle-dragging"
          )}
          aria-label={`Select and drag row ${props.rowNumber}`}
          aria-pressed={props.selected}
          disabled={props.disabled}
          {...attributes}
          {...(listenerProps ?? {})}
          onMouseDown={(e) => {
            props.onReorderStart(e, props.rowId);
            listenerProps?.onMouseDown?.(e);
          }}
          onTouchStart={(e) => {
            props.onReorderStart(e, props.rowId);
            listenerProps?.onTouchStart?.(e);
          }}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
        >
          <span className="mk-row-grip" aria-hidden="true"></span>
        </button>
      </div>
    </td>
  );
};

const TableBodyRow = (props: {
  rowId: string;
  className?: string;
  draggingOver: boolean;
  onContextMenu: (e: React.MouseEvent<HTMLTableRowElement>) => void;
  children: React.ReactNode;
}) => {
  const { setNodeRef, isOver } = useDroppable({
    id: rowDndId(props.rowId ?? ""),
    disabled: !props.rowId,
    data: { type: "row", rowId: props.rowId },
  });

  return (
    <tr
      ref={setNodeRef}
      data-row-id={props.rowId}
      className={classNames(
        props.className,
        (props.draggingOver || isOver) && "mk-row-drag-over"
      )}
      onContextMenu={props.onContextMenu}
    >
      {props.children}
    </tr>
  );
};

const TableRowDragOverlay = (props: {
  rows: DBRow[];
  columns: SpaceTableColumn[];
}) => {
  const previewColumns = rowDragOverlayColumns(props.columns);
  const rows = props.rows.slice(0, 5);

  if (rows.length == 0 || previewColumns.length == 0) return null;

  return (
    <div className="mk-row-drag-overlay">
      {rows.map((row, rowIndex) => (
        <div className="mk-row-drag-overlay-row" key={rowIndex}>
          {previewColumns.map((column) => (
            <span
              className="mk-row-drag-overlay-cell"
              key={column.name + (column.table ?? "")}
            >
              {rowDragOverlayLabel(row, column)}
            </span>
          ))}
        </div>
      ))}
      {props.rows.length > rows.length ? (
        <div className="mk-row-drag-overlay-more">
          +{props.rows.length - rows.length} more
        </div>
      ) : null}
    </div>
  );
};

export const TableView = (props: { superstate: Superstate }) => {
  const {
    spaceInfo,

    spaceState: spaceCache,
  } = useContext(SpaceContext);
  const { readMode } = useContext(PathContext);
  const {
    tableData,

    dbSchema,
    contextTable,
    saveDB,
    source,
    selectedRows,
    selectRows,
    sortedColumns: cols,
    filteredData: data,
    predicate,
    savePredicate,

    updateFieldValue,
    updateValue,
    applyValueEdits,
    applyTableEdits,
    reloadContextData,
    renameRowTitle,
  } = useContext(ContextEditorContext);

  const pageSize = props.superstate.settings.contextPagination ?? 25;
  const [pagination, setPagination] = React.useState<PaginationState>({
    pageIndex: 0,
    pageSize: pageSize,
  });
  const [activeId, setActiveId] = useState(null);
  const [activeDragType, setActiveDragType] = useState<
    "column" | "row" | null
  >(null);
  const [activeRowDragIds, setActiveRowDragIds] = useState<string[]>([]);
  const [lastSelectedIndex, setLastSelectedIndex] = useState<string>(null);
  const [selectedColumn, setSelectedColumn] = useState<string>(null);
  const [currentEdit, setCurrentEdit] = useState<[string, string]>(null);
  const [cellSelection, setCellSelection] = useState<CellSelection>(null);
  const [cellEditFeedback, setCellEditFeedback] =
    useState<TableEditFeedback>({});
  const [cellResetTokens, setCellResetTokens] =
    useState<TableCellResetTokens>({});
  const [tableUndoStack, setTableUndoStack] = useState<TableUndoEntry[]>([]);
  const [tableRedoStack, setTableRedoStack] = useState<TableUndoEntry[]>([]);
  const tableUndoStackRef = useRef<TableUndoEntry[]>([]);
  const tableRedoStackRef = useRef<TableUndoEntry[]>([]);
  const selectedRowsRef = useRef<string[]>([]);
  const rowMarqueeRef = useRef<TableRowMarqueeState>(null);
  const activeDragTypeRef = useRef<"column" | "row" | null>(null);
  const rowDragPointerRef = useRef<RowDragPoint | null>(null);
  const [rowMarqueeRect, setRowMarqueeRect] =
    useState<TableMarqueeRect>(null);
  const [overId, setOverId] = useState(null);
  const [colsSize, setColsSize] = useState<ColumnSizingState>({});
  const feedbackOperationId = useRef(0);
  const ref = useRef(null);
  const primaryCol = cols.find((f) => f.primary == "true");
  const tableDirection = predicate?.tableDirection ?? "ltr";
  const isRTLTable = tableDirection == "rtl";
  const visibleRowOrder = useMemo(() => data.map((f) => f._index), [data]);
  const visibleColumnOrder = useMemo(
    () => cols.map((f) => f.name + f.table),
    [cols]
  );
  const loadedRowCount = tableLoadedRowCount({
    currentPageSize: pagination.pageSize,
    totalRows: data.length,
  });
  const rowGutterWidth = rowGutterWidthForRowCount(loadedRowCount);
  const frozenColumnCount = clampFrozenColumnCount({
    columns: cols,
    hiddenColumnIds: predicate?.colsHidden ?? [],
    frozenColumnCount: predicate?.frozenColumnCount ?? 0,
  });
  const frozenColumnOffsets = useMemo(
    () =>
      stickyOffsetsForFrozenColumns({
        columns: cols,
        hiddenColumnIds: predicate?.colsHidden ?? [],
        frozenColumnCount,
        columnSizes: colsSize,
        rowGutterWidth,
        defaultColumnWidth: defaultTableColumnWidth,
        tableDirection,
      }),
    [
      cols,
      predicate?.colsHidden,
      frozenColumnCount,
      colsSize,
      rowGutterWidth,
      tableDirection,
    ]
  );
  const tableUndoJournalKey = `${source ?? spaceCache?.path ?? ""}::${
    dbSchema?.id ?? ""
  }`;
  const replaceTableUndoJournal = (
    undo: TableUndoEntry[],
    redo: TableUndoEntry[]
  ) => {
    tableUndoJournalStore.set(tableUndoJournalKey, { undo, redo });
    tableUndoStackRef.current = undo;
    tableRedoStackRef.current = redo;
    setTableUndoStack(undo);
    setTableRedoStack(redo);
  };

  useEffect(() => {
    setColsSize({
      ...propertyHeaderColumnSizingWithMinimum(predicate?.colsSize ?? {}),
      "+": 30,
    });
  }, [predicate]);

  useEffect(() => {
    const journal = tableUndoJournalForKey(tableUndoJournalKey);
    tableUndoStackRef.current = journal.undo;
    tableRedoStackRef.current = journal.redo;
    setTableUndoStack(journal.undo);
    setTableRedoStack(journal.redo);
  }, [tableUndoJournalKey]);

  useEffect(() => {
    setCurrentEdit(null);
  }, [selectedColumn, lastSelectedIndex]);

  useEffect(() => {
    selectedRowsRef.current = selectedRows;
  }, [selectedRows]);

  useEffect(() => {
    activeDragTypeRef.current = activeDragType;
  }, [activeDragType]);

  // useEffect(() => {
  //   if (currentEdit == null) {
  //     ref.current.focus();
  //   }
  // }, [currentEdit]);

  const saveColsSize: OnChangeFn<ColumnSizingState> = (
    colSize: (old: ColumnSizingState) => ColumnSizingState
  ) => {
    const newColSize = propertyHeaderColumnSizingWithMinimum(
      colSize(colsSize)
    );
    setColsSize(newColSize);
    debouncedSavePredicate(newColSize);
  };

  const debouncedSavePredicate = useCallback(
    debounce(
      (nextValue) =>
        savePredicate({
          colsSize: nextValue,
        }),
      1000
    ),
    [predicate] // will be created only once initially
  );
  const beginCellFeedbackOperation = (writes: TableEditFeedbackWrite[]) => {
    const operationId = feedbackOperationId.current + 1;
    feedbackOperationId.current = operationId;
    setCellEditFeedback(pendingFeedbackForWrites(writes));
    return operationId;
  };

  const finishCellFeedbackOperation = (
    operationId: number,
    result: TableEditTransactionResult
  ) => {
    if (feedbackOperationId.current != operationId) return;

    const summary = summaryForTableEditResult(result);
    if (summary) props.superstate.ui.notify(summary);

    const resultFeedback = feedbackForTableEditResult(result);
    setCellEditFeedback(resultFeedback);

    if (Object.keys(resultFeedback).length > 0) {
      setCellResetTokens((tokens) =>
        incrementResetTokensForFeedback(tokens, resultFeedback)
      );
      if (!hasTableEditFeedbackAction(resultFeedback)) {
        window.setTimeout(() => {
          if (feedbackOperationId.current == operationId) {
            setCellEditFeedback({});
          }
        }, 5000);
      }
    }
  };

  const reloadConflictData = async () => {
    const operationId = feedbackOperationId.current;
    const feedbackKeys = Object.keys(cellEditFeedback);
    try {
      await reloadContextData();
    } catch (error) {
      props.superstate.ui.notify("Unable to reload current file value.");
      return;
    }
    if (feedbackOperationId.current != operationId) return;
    setCellEditFeedback({});
    setCellResetTokens((tokens) =>
      feedbackKeys.reduce<TableCellResetTokens>(
        (nextTokens, key) => ({
          ...nextTokens,
          [key]: (nextTokens[key] ?? 0) + 1,
        }),
        tokens
      )
    );
  };

  const applyConflictWrite = async (write: TableEditFeedbackWrite) => {
    const previousFeedback = cellEditFeedback;
    const forcedWrite: TableCellWrite = {
      ...write,
      forceFrontmatterWrite: true,
    };
    const operationId = beginCellFeedbackOperation([forcedWrite]);
    try {
      const result = await applyValueEdits([forcedWrite]);
      finishCellFeedbackOperation(operationId, result);
    } catch (error) {
      props.superstate.ui.notify("Unable to apply this value.");
      if (feedbackOperationId.current == operationId) {
        setCellEditFeedback(previousFeedback);
      }
    }
  };

  const labelForPasteUndo = (mode: TablePasteMode): string =>
    mode == "bulk-rename" ? "Rename files" : "Paste cells";

  const pushTableUndo = (entry: TableUndoEntry) => {
    if (entry.writes.length == 0) return;
    const nextUndoStack = pushTableUndoEntry(
      tableUndoStackRef.current,
      entry
    );
    replaceTableUndoJournal(nextUndoStack, []);
  };

  const pushDirectTableUndo = (
    write: ReturnType<typeof tableUndoWriteForDirectEdit>,
    result: TableEditTransactionResult,
    label = "Edit cell"
  ) => {
    if (!write || result.applied <= 0) return;
    const undoEntry = createTableUndoEntry({
      label,
      rows: data,
      columns: cols,
      writes: [write],
    });
    pushTableUndo(filterTableUndoEntryForResult(undoEntry, result));
  };

  const newRow = (name: string, index?: number, data?: DBRow) => {
    if (dbSchema?.id == defaultContextSchemaID) {
      newPathInSpace(props.superstate, spaceCache, "md", name, true);
    } else {
      saveDB(
        createNewRow(
          tableData,
          primaryCol
            ? { [primaryCol.name]: name ?? "", ...(data ?? {}) }
            : data ?? {},
          index
        )
      );
    }
  };

  const selectItem = (modifier: PointerModifiers, index: string) => {
    if (modifier.metaKey) {
      props.superstate.ui.openPath(
        tableData.rows[parseInt(index)][PathPropertyName],
        false
      );
      return;
    }
    if (modifier.ctrlKey) {
      selectedRows.some((f) => f == index)
        ? selectRows(
            null,
            selectedRows.filter((f) => f != index)
          )
        : selectRows(index, uniq([...selectedRows, index]));
    } else if (modifier.shiftKey) {
      selectRows(
        index,
        uniq([
          ...selectedRows,
          ...selectRange(
            lastSelectedIndex,
            index,
            data.map((f) => f._index)
          ),
        ])
      );
    } else {
      selectRows(index, [index]);
    }
    setLastSelectedIndex(index);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    const pasteColumns = cols.map((f) => ({
      id: f.name + f.table,
      name: f.name,
      type: f.type,
      source: f.source,
      table: f.table,
    }));
    const activeSelection =
      cellSelection ??
      (lastSelectedIndex && selectedColumn
        ? {
            anchor: { rowId: lastSelectedIndex, columnId: selectedColumn },
            focus: { rowId: lastSelectedIndex, columnId: selectedColumn },
            active: { rowId: lastSelectedIndex, columnId: selectedColumn },
          }
        : null);
    const notifyRejections = (count: number) => {
      if (count > 0) {
        props.superstate.ui.notify(
          `${count} table edit${count == 1 ? " was" : "s were"} skipped.`
        );
      }
    };
    const copySelection = () => {
      if (!activeSelection) return;
      const bounds = cellSelectionBounds(
        activeSelection,
        visibleRowOrder,
        visibleColumnOrder
      );
      const grid: string[][] = [];
      for (let row = bounds.minRow; row <= bounds.maxRow; row++) {
        const values: string[] = [];
        for (
          let column = bounds.minColumn;
          column <= bounds.maxColumn;
          column++
        ) {
          const rowData = data.find(
            (f) => f._index == visibleRowOrder[row]
          ) as DBRow;
          const columnId = visibleColumnOrder[column];
          const value = rowData?.[columnId] ?? "";
          values.push(
            columnId == PathPropertyName ? pageTitleFromPath(value) : value
          );
        }
        grid.push(values);
      }
      navigator.clipboard.writeText(serializeTableClipboardGrid(grid));
    };
    const pasteSelection = async (clipboardText: string, label?: string) => {
      if (!activeSelection) return;
      const plan = planTablePaste({
        rowOrder: visibleRowOrder,
        columns: pasteColumns,
        selection: activeSelection,
        clipboardGrid: parseTableClipboardText(clipboardText),
      });
      notifyRejections(plan.rejections.length);
      if (plan.writes.length == 0) return;

      const undoEntry = createTableUndoEntry({
        label: label ?? labelForPasteUndo(plan.mode),
        rows: data,
        writes: plan.writes,
      });
      const operationId = beginCellFeedbackOperation(plan.writes);
      const result = await applyTableEdits(plan.writes);
      finishCellFeedbackOperation(operationId, result);
      if (result.applied > 0) {
        pushTableUndo(filterTableUndoEntryForResult(undoEntry, result));
      }
    };
    const clearCell = () => {
      pasteSelection("", "Clear cells");
    };
    const undoLastTableOperation = async () => {
      const currentJournal = tableUndoJournalForKey(tableUndoJournalKey);
      const undoEntry = currentJournal.undo[currentJournal.undo.length - 1];
      if (!undoEntry) return;
      const nextUndoStack = currentJournal.undo.slice(0, -1);
      replaceTableUndoJournal(nextUndoStack, currentJournal.redo);

      const operationId = beginCellFeedbackOperation(undoEntry.writes);
      const result = await applyTableEdits(undoEntry.writes);
      finishCellFeedbackOperation(operationId, result);
      if (
        result.ok &&
        result.failed.length == 0 &&
        result.skipped.length == 0
      ) {
        const latestJournal = tableUndoJournalForKey(tableUndoJournalKey);
        const nextRedoStack = pushTableUndoEntry(
          latestJournal.redo,
          undoEntry
        );
        replaceTableUndoJournal(latestJournal.undo, nextRedoStack);
        props.superstate.ui.notify(`Undid ${undoEntry.label}.`);
      } else {
        const latestJournal = tableUndoJournalForKey(tableUndoJournalKey);
        const restoredUndoStack = pushTableUndoEntry(
          latestJournal.undo,
          undoEntry
        );
        replaceTableUndoJournal(restoredUndoStack, latestJournal.redo);
      }
    };
    const redoLastTableOperation = async () => {
      const currentJournal = tableUndoJournalForKey(tableUndoJournalKey);
      const redoEntry = currentJournal.redo[currentJournal.redo.length - 1];
      if (!redoEntry) return;
      const nextRedoStack = currentJournal.redo.slice(0, -1);
      replaceTableUndoJournal(currentJournal.undo, nextRedoStack);

      const operationId = beginCellFeedbackOperation(redoEntry.redoWrites);
      const result = await applyTableEdits(redoEntry.redoWrites);
      finishCellFeedbackOperation(operationId, result);
      if (
        result.ok &&
        result.failed.length == 0 &&
        result.skipped.length == 0
      ) {
        const latestJournal = tableUndoJournalForKey(tableUndoJournalKey);
        const nextUndoStack = pushTableUndoEntry(
          latestJournal.undo,
          redoEntry
        );
        replaceTableUndoJournal(nextUndoStack, latestJournal.redo);
        props.superstate.ui.notify(`Redid ${redoEntry.label}.`);
      } else {
        const latestJournal = tableUndoJournalForKey(tableUndoJournalKey);
        const restoredRedoStack = pushTableUndoEntry(
          latestJournal.redo,
          redoEntry
        );
        replaceTableUndoJournal(latestJournal.undo, restoredRedoStack);
      }
    };
    const nextRow = () => {
      const newIndex = selectNextIndex(
        lastSelectedIndex,
        data.map((f) => f._index)
      );
      selectRows(newIndex, [newIndex]);
      setLastSelectedIndex(newIndex);
    };
    const moveSelection = (direction: "up" | "down" | "left" | "right") => {
      if (!activeSelection) return;
      const visualDirection =
        tableDirection == "rtl"
          ? direction == "left"
            ? "right"
            : direction == "right"
            ? "left"
            : direction
          : direction;
      const nextSelection = e.shiftKey
        ? extendCellSelection(
            activeSelection,
            visibleRowOrder,
            visibleColumnOrder,
            visualDirection
          )
        : moveCellSelection(
            activeSelection,
            visibleRowOrder,
            visibleColumnOrder,
            visualDirection
          );
      setCellSelection(nextSelection);
      setSelectedColumn(nextSelection.active.columnId);
      setLastSelectedIndex(nextSelection.active.rowId);
      selectRows(nextSelection.active.rowId, [nextSelection.active.rowId]);
    };
    if (e.key == "c" && (e.metaKey || e.ctrlKey)) {
      copySelection();
      e.preventDefault();
    }
    if (e.key == "x" && (e.metaKey || e.ctrlKey)) {
      copySelection();
      clearCell();
      e.preventDefault();
    }
    if (e.key == "v" && (e.metaKey || e.ctrlKey)) {
      navigator.clipboard.readText().then((f) => pasteSelection(f));
      e.preventDefault();
    }
    if (
      ((e.key.toLowerCase() == "z" && e.shiftKey) ||
        e.key.toLowerCase() == "y") &&
      (e.metaKey || e.ctrlKey)
    ) {
      if (tableUndoJournalForKey(tableUndoJournalKey).redo.length > 0) {
        redoLastTableOperation();
        e.preventDefault();
      }
      return;
    }
    if (
      e.key.toLowerCase() == "z" &&
      (e.metaKey || e.ctrlKey) &&
      !e.shiftKey
    ) {
      if (tableUndoJournalForKey(tableUndoJournalKey).undo.length > 0) {
        undoLastTableOperation();
        e.preventDefault();
      }
      return;
    }
    if (e.key == "Escape") {
      selectRows(null, []);
      setLastSelectedIndex(null);
      setSelectedColumn(null);
      setCellSelection(null);
    }
    if (e.key == "Backspace" || e.key == "Delete") {
      clearCell();
      e.preventDefault();
    }
    if (e.key == "Enter") {
      if (selectedColumn && lastSelectedIndex) {
        if (e.shiftKey) {
          newRow("", parseInt(lastSelectedIndex) + 1);
          nextRow();
        } else {
          setCurrentEdit([selectedColumn, lastSelectedIndex]);
          e.preventDefault();
          e.stopPropagation();
        }
      }

      return;
    }
    if (e.key == "ArrowDown") {
      moveSelection("down");
      e.preventDefault();
    }
    if (e.key == "ArrowUp") {
      moveSelection("up");
      e.preventDefault();
    }
    if (e.key == "ArrowLeft") {
      moveSelection("left");
      e.preventDefault();
    }
    if (e.key == "ArrowRight") {
      moveSelection("right");
      e.preventDefault();
    }
  };
  const columns: any[] = useMemo(
    () => [
      ...(cols.map((f) => {
        return {
          header: f.name,
          footer: () => "test",
          accessorKey: f.name + f.table,
          minSize: propertyHeaderMinimumColumnWidth,
          // enableResizing: true,
          meta: {
            table: f.table,
            editable: f.name != PathPropertyName,
            schemaId: dbSchema?.id,
            fieldType: fieldTypeForType(f.type, f.name)?.type,
          },
          cell: ({
            // @ts-ignore
            getValue,
            // @ts-ignore
            row: { index },
            // @ts-ignore
            column: { colId },
            // @ts-ignore
            cell,
            // @ts-ignore
            table,
          }) => {
            const initialValue = getValue();
            // We need to keep and update the state of the cell normally
            const rowIndex = parseInt((data[index] as DBRow)["_index"]);
            const tableIndex = parseInt((data[index] as DBRow)["_index"]);
            const saveValue = async (value: string) => {
              if (initialValue != value) {
                const undoWrite = tableUndoWriteForDirectEdit({
                  rowId: rowIndex.toString(),
                  column: f,
                  value,
                });
                const operationId = beginCellFeedbackOperation([
                  feedbackWriteForDirectCellEdit({
                    rowId: rowIndex.toString(),
                    columnName: f.name,
                    table: f.table,
                    value,
                  }),
                ]);
                const result = await table.options.meta?.updateData(
                  f.name,
                  value,
                  f.table,
                  rowIndex
                );
                if (result) {
                  finishCellFeedbackOperation(operationId, result);
                  pushDirectTableUndo(undoWrite, result);
                }
              }
              setCurrentEdit(null);
              setSelectedColumn(null);
            };
            const saveFieldValue = async (fieldValue: string, value: string) => {
              const undoWrite = tableUndoWriteForDirectEdit({
                rowId: rowIndex.toString(),
                column: f,
                value,
                fieldValue,
              });
              const operationId = beginCellFeedbackOperation([
                feedbackWriteForDirectCellEdit({
                  rowId: rowIndex.toString(),
                  columnName: f.name,
                  table: f.table,
                  value,
                  fieldValue,
                }),
              ]);
              const result = await table.options.meta?.updateFieldValue(
                f.name,
                fieldValue,
                value,
                f.table,
                rowIndex
              );
              if (result) {
                finishCellFeedbackOperation(operationId, result);
                pushDirectTableUndo(undoWrite, result);
              }
            };
            const renameValue = async (value: string) => {
              const undoWrite = tableUndoWriteForDirectEdit({
                rowId: rowIndex.toString(),
                column: f,
                value,
              });
              const write = feedbackWriteForDirectCellEdit({
                rowId: rowIndex.toString(),
                columnName: f.name,
                table: f.table,
                value,
              });
              const operationId = beginCellFeedbackOperation([write]);
              const renamedPath = await renameRowTitle(
                data[index] as DBRow,
                value
              );
              finishCellFeedbackOperation(operationId, {
                ok: !!renamedPath,
                applied: renamedPath ? 1 : 0,
                skipped: [],
                failed: renamedPath
                  ? []
                  : [
                      {
                        write,
                        reason: "file-rename-failed",
                      },
                    ],
              });
              if (renamedPath) {
                pushDirectTableUndo(
                  undoWrite,
                  {
                    ok: true,
                    applied: 1,
                    skipped: [],
                    failed: [],
                  },
                  "Rename file"
                );
              }
              return renamedPath;
            };
            const editMode = readMode
              ? CellEditMode.EditModeReadOnly
              : !cell.getIsGrouped()
              ? isTouchScreen(props.superstate.ui)
                ? CellEditMode.EditModeAlways
                : currentEdit &&
                  currentEdit[0] == f.name + f.table &&
                  currentEdit[1] == tableIndex.toString()
                ? CellEditMode.EditModeActive
                : CellEditMode.EditModeView
              : CellEditMode.EditModeReadOnly;
            const cellWidth = propertyHeaderColumnWidthForSize(
              colsSize[f.name + f.table],
              defaultTableColumnWidth
            );
            const cellProps: DataTypeViewProps = {
              compactMode: propertyHeaderUsesCompactCellLayout(cellWidth),
              initialValue: initialValue as string,
              updateValue: saveValue,
              renameValue,
              updateFieldValue: saveFieldValue,
              superstate: props.superstate,
              setEditMode: setCurrentEdit,
              startEditing: () =>
                setCurrentEdit([f.name + f.table, tableIndex.toString()]),
              column: f,
              editMode,
              row: data[index] as DBRow,
              contextTable: contextTable,
              source:
                f.schemaId == defaultContextSchemaID &&
                data[index][PathPropertyName],
              columns: cols,
              contextPath: spaceCache?.path,
            };

            const fieldType = fieldTypeForType(f.type, f.name);
            if (!fieldType) {
              return <>{initialValue}</>;
            }
            const feedbackKey = tableCellFeedbackKey(
              rowIndex.toString(),
              f.name + f.table
            );
            return (
              <DataTypeView
                key={cellResetTokens[feedbackKey] ?? 0}
                {...cellProps}
              ></DataTypeView>
            );
          },
        };
      }) ?? []),
      ...(readMode
        ? []
        : [
            {
              header: "+",
              meta: { schemaId: dbSchema?.id },
              accessorKey: "+",
              size: 20,
              cell: () => <></>,
            },
          ]),
    ],
    [
      cols,
      data,
      currentEdit,
      predicate,
      dbSchema,
      contextTable,
      cellResetTokens,
      colsSize,
    ]
  );

  const groupBy = useMemo(
    () =>
      predicate?.groupBy?.length > 0 &&
      cols.find((f) => f.name + f.table == predicate.groupBy[0])
        ? predicate.groupBy
        : [],
    [predicate, cols]
  );
  const table = useReactTable({
    data,
    columns,

    columnResizeMode: "onChange",
    state: {
      columnVisibility: predicate?.colsHidden.reduce(
        (p, c) => ({ ...p, [c]: false }),
        {}
      ),
      columnOrder: predicate?.colsOrder,
      columnSizing: {
        ...columns.reduce((p, c) => ({ ...p, [c.accessorKey]: 150 }), {}),
        ...colsSize,
      },
      grouping: groupBy,
      expanded: true,
      pagination,
    },
    onColumnSizingChange: saveColsSize,
    getCoreRowModel: getCoreRowModel(),
    getExpandedRowModel: getExpandedRowModel(),
    getGroupedRowModel: getGroupedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    onPaginationChange: setPagination,
    meta: {
      updateData: updateValue,
      updateFieldValue: updateFieldValue,
    },
  });

  const sensors = useSensors(
    useSensor(MouseSensor, {
      activationConstraint: {
        distance: 10,
      },
    }),
    useSensor(TouchSensor, {
      activationConstraint: {
        delay: 250,
        tolerance: 5,
      },
    })
  );
  const measuring = {
    droppable: {
      strategy: MeasuringStrategy.Always,
    },
  };
  const tableCollisionDetection = useCallback<CollisionDetection>((args) => {
    if (!isRowDndId(args.active?.id?.toString())) return closestCenter(args);

    const rowDroppables = args.droppableContainers.filter((container) =>
      isRowDndId(container.id?.toString())
    );
    if (rowDroppables.length == 0) return [];

    const rowArgs = {
      ...args,
      droppableContainers: rowDroppables,
    };
    const pointerCollisions = pointerWithin(rowArgs);
    return pointerCollisions.length > 0
      ? pointerCollisions
      : closestCenter(rowArgs);
  }, []);

  function handleDragStart(event: DragStartEvent) {
    const {
      active: { id: activeId },
    } = event;
    const activeIdString = activeId?.toString();
    setActiveId(activeId);

    if (isRowDndId(activeIdString)) {
      const rowId = rowIdFromDndId(activeIdString);
      const dragSelection = selectedRowsRef.current;
      const dragRows = rowDragSet(visibleRowOrder, rowId, dragSelection);
      activeDragTypeRef.current = "row";
      setActiveDragType("row");
      setActiveRowDragIds(dragRows);
      if (!dragSelection.includes(rowId)) {
        selectWholeRows(rowId, [rowId]);
      }
    } else {
      activeDragTypeRef.current = "column";
      setActiveDragType("column");
      setActiveRowDragIds([]);
    }
    setOverId(null);

    document.body.style.setProperty("cursor", "grabbing");
  }

  function handleDragOver({ over }: DragOverEvent) {
    const overId = over?.id;
    if (overId) {
      setOverId(over?.id ?? null);
    }
  }

  const saveFilter = (filter: Filter) => {
    savePredicate({
      filters: [
        ...(predicate?.filters ?? []).filter((s) => s.field != filter.field),
        filter,
      ],
    });
  };

  const saveAggregate = (column: string, fn: string) => {
    savePredicate({
      colsCalc: {
        ...predicate.colsCalc,
        [column]: fn,
      },
    });
  };

  const valueForAggregate = (
    value: string,
    agType: string,
    col: SpaceProperty
  ) => {
    if (agType == "number") {
      const parsedValue = parseFieldValue(col.value, col.type);
      if (parsedValue?.format?.length > 0) {
        return safeFormatNumber(parsedValue.format, parseInt(value));
      }
    }
    return value;
  };
  const aggregateValues: Record<string, string> = useMemo(() => {
    const result: Record<string, string> = {};
    Object.keys(predicate.colsCalc).forEach((f) => {
      result[f] = calculateAggregate(
        props.superstate.settings,
        data.map((r) => r[f]),
        predicate.colsCalc[f],
        cols.find((c) => c.name == f)
      );
    });
    return result;
  }, [cols, data, predicate.colsCalc]);

  const selectWholeRows = useCallback((activeRowId: string, rowIds: string[]) => {
    const nextActiveRowId = rowIds.length > 0 ? activeRowId : null;
    selectedRowsRef.current = rowIds;
    selectRows(nextActiveRowId, rowIds);
    setLastSelectedIndex(nextActiveRowId);
    setSelectedColumn(null);
    setCurrentEdit(null);
    setCellSelection(null);
  }, [selectRows]);

  useEffect(() => {
    const updateRowMarqueeSelection = (event: MouseEvent) => {
      const marquee = rowMarqueeRef.current;
      if (!marquee?.active) return;

      const viewportRect = rectFromPoints(
        marquee.originX,
        marquee.originY,
        event.clientX,
        event.clientY
      );
      setRowMarqueeRect(rectRelativeTo(viewportRect, marquee.tableRect));

      const selected = marquee.rowRects
        .filter((row) => rectsIntersect(viewportRect, row.rect))
        .map((row) => row.rowId);
      selectWholeRows(
        selected[selected.length - 1] ?? marquee.anchorRowId,
        selected.length > 0 ? selected : [marquee.anchorRowId]
      );
    };

    const endRowMarqueeSelection = () => {
      rowMarqueeRef.current = null;
      setRowMarqueeRect(null);
    };

    document.addEventListener("mousemove", updateRowMarqueeSelection);
    document.addEventListener("mouseup", endRowMarqueeSelection);
    return () => {
      document.removeEventListener("mousemove", updateRowMarqueeSelection);
      document.removeEventListener("mouseup", endRowMarqueeSelection);
    };
  }, [selectWholeRows]);

  useEffect(() => {
    const updateRowDragPointer = (event: MouseEvent | TouchEvent) => {
      if (!rowDragPointerRef.current) return;
      const point = rowDragPointFromEvent(event);
      if (point) rowDragPointerRef.current = point;
    };
    const clearInactivePointer = () => {
      if (activeDragTypeRef.current != "row") {
        rowDragPointerRef.current = null;
      }
    };

    document.addEventListener("mousemove", updateRowDragPointer);
    document.addEventListener("touchmove", updateRowDragPointer, {
      passive: true,
    });
    document.addEventListener("mouseup", clearInactivePointer);
    document.addEventListener("touchend", clearInactivePointer);
    document.addEventListener("touchcancel", clearInactivePointer);
    return () => {
      document.removeEventListener("mousemove", updateRowDragPointer);
      document.removeEventListener("touchmove", updateRowDragPointer);
      document.removeEventListener("mouseup", clearInactivePointer);
      document.removeEventListener("touchend", clearInactivePointer);
      document.removeEventListener("touchcancel", clearInactivePointer);
    };
  }, []);

  const selectMovedWholeRows = (
    activeRowId: string,
    rowIds: string[],
    nextRows: DBRow[]
  ) => {
    selectedRowsRef.current = rowIds;
    selectRows(null, rowIds);
    setLastSelectedIndex(activeRowId);
    setSelectedColumn(null);
    setCurrentEdit(null);
    setCellSelection(null);

    if (dbSchema?.primary == "true") {
      const activePath = nextRows[parseInt(activeRowId)]?.[PathPropertyName];
      if (activePath) props.superstate.ui.setActivePath(activePath);
    }
  };

  const rowIdsForSelectionDrag = (anchorRowId: string, rowId: string) => {
    if (!anchorRowId) return [rowId];
    return uniq([
      anchorRowId,
      ...selectRange(anchorRowId, rowId, visibleRowOrder),
    ]);
  };

  const rowMarqueeItems = (): TableRowMarqueeItem[] => {
    const tableEl = ref.current as HTMLElement;
    if (!tableEl) return [];

    return Array.from(
      tableEl.querySelectorAll<HTMLTableRowElement>("tbody tr[data-row-id]")
    )
      .flatMap((row) => {
        const rowId = row.dataset.rowId;
        return rowId
          ? [
              {
                rowId,
                rect: row.getBoundingClientRect(),
              },
            ]
          : [];
      });
  };

  const startRowSelectionDrag = (
    e: React.MouseEvent<HTMLTableCellElement>,
    rowId: string
  ) => {
    if (e.button != 0) return;
    e.preventDefault();
    e.stopPropagation();

    const tableEl = ref.current as HTMLElement;
    tableEl?.focus();
    const tableRect = tableEl?.getBoundingClientRect();
    if (!tableRect) return;

    if (e.shiftKey && lastSelectedIndex) {
      const rowIds = rowIdsForSelectionDrag(lastSelectedIndex, rowId);
      rowMarqueeRef.current = {
        active: true,
        originX: e.clientX,
        originY: e.clientY,
        anchorRowId: lastSelectedIndex,
        rowRects: rowMarqueeItems(),
        tableRect,
      };
      setRowMarqueeRect({
        left: e.clientX - tableRect.left,
        top: e.clientY - tableRect.top,
        width: 0,
        height: 0,
      });
      selectWholeRows(rowId, rowIds);
      return;
    }

    if (e.ctrlKey || e.metaKey) {
      rowMarqueeRef.current = null;
      setRowMarqueeRect(null);
      const rowIds = selectedRows.some((selectedRow) => selectedRow == rowId)
        ? selectedRows.filter((selectedRow) => selectedRow != rowId)
        : uniq([...selectedRows, rowId]);
      selectWholeRows(rowId, rowIds);
      return;
    }

    rowMarqueeRef.current = {
      active: true,
      originX: e.clientX,
      originY: e.clientY,
      anchorRowId: rowId,
      rowRects: rowMarqueeItems(),
      tableRect,
    };
    setRowMarqueeRect({
      left: e.clientX - tableRect.left,
      top: e.clientY - tableRect.top,
      width: 0,
      height: 0,
    });
    selectWholeRows(rowId, [rowId]);
  };

  const prepareRowDrag = (
    e:
      | React.MouseEvent<HTMLButtonElement>
      | React.TouchEvent<HTMLButtonElement>,
    rowId: string
  ) => {
    e.stopPropagation();
    const tableEl = ref.current as HTMLElement;
    tableEl?.focus();
    rowDragPointerRef.current = rowDragPointFromEvent(e);
    const shiftKey = "shiftKey" in e ? e.shiftKey : false;
    const ctrlKey = "ctrlKey" in e ? e.ctrlKey : false;
    const metaKey = "metaKey" in e ? e.metaKey : false;

    if (shiftKey) {
      const rowIds = uniq([
        ...selectedRows,
        ...selectRange(lastSelectedIndex, rowId, visibleRowOrder),
      ]);
      selectWholeRows(rowId, rowIds);
      return;
    }

    if (ctrlKey || metaKey) {
      const rowIds = selectedRows.some((selectedRow) => selectedRow == rowId)
        ? selectedRows.filter((selectedRow) => selectedRow != rowId)
        : uniq([...selectedRows, rowId]);
      selectWholeRows(rowId, rowIds);
      return;
    }

    if (!selectedRows.some((selectedRow) => selectedRow == rowId)) {
      selectWholeRows(rowId, [rowId]);
      return;
    }

    setLastSelectedIndex(rowId);
    setCurrentEdit(null);
  };

  const selectCell = (e: React.MouseEvent, index: number, column: string) => {
    if (isTouchScreen(props.superstate.ui) || column == "+") return;
    const rowId = (data[index] as DBRow)["_index"];
    selectItem(
      {
        ctrlKey: e.ctrlKey,
        metaKey: e.metaKey,
        altKey: e.altKey,
        shiftKey: e.shiftKey,
      },
      rowId
    );
    if (e.metaKey) return;

    const coord = { rowId, columnId: column };
    const nextSelection =
      e.shiftKey && cellSelection
        ? { ...cellSelection, focus: coord, active: coord }
        : { anchor: coord, focus: coord, active: coord };
    setCellSelection(nextSelection);
    setSelectedColumn(column);
    setLastSelectedIndex(rowId);
    if (e.detail === 1) {
    } else if (e.detail === 2) {
      setCurrentEdit([column, rowId]);
    }
  };

  const extendSelectionToCell = (index: number, column: string) => {
    if (!cellSelection || isTouchScreen(props.superstate.ui) || column == "+") {
      return;
    }
    const rowId = (data[index] as DBRow)["_index"];
    const coord = { rowId, columnId: column };
    setCellSelection({ ...cellSelection, focus: coord, active: coord });
    setSelectedColumn(column);
    setLastSelectedIndex(rowId);
  };

  const rowIdAtPoint = (point: RowDragPoint): string | null => {
    const tableEl = ref.current as HTMLElement;
    if (!tableEl) return null;

    const target = tableEl.ownerDocument.elementFromPoint(point.x, point.y);
    const row = target?.closest?.(
      "tbody tr[data-row-id]"
    ) as HTMLTableRowElement;
    if (!row || !tableEl.contains(row)) return null;

    return row.dataset.rowId ?? null;
  };

  function handleDragEnd({ active, over }: DragEndEvent) {
    const activeDndId = active?.id?.toString();
    const overDndId = over?.id?.toString();

    if (isRowDndId(activeDndId)) {
      const activeRowId = rowIdFromDndId(activeDndId);
      const overRowId = resolveRowDropTargetId({
        activeId: activeDndId,
        overId: overDndId,
        pointer: rowDragPointerRef.current,
        rowIdAtPoint,
      });
      if (activeRowId && overRowId && tableData?.rows) {
        const moveResult = moveVisibleRows({
          rows: tableData.rows,
          visibleRowOrder,
          activeRowId,
          overRowId,
          selectedRowIds: selectedRowsRef.current,
        });

        if (moveResult.changed) {
          saveDB({
            ...tableData,
            rows: moveResult.rows,
          });
          const nextActiveRowId =
            moveResult.selectedRowIds[
              Math.min(
                moveResult.selectedRowIds.length - 1,
                Math.max(0, moveResult.movedRowIds.indexOf(activeRowId))
              )
            ] ?? moveResult.selectedRowIds[0];
          selectMovedWholeRows(
            nextActiveRowId,
            moveResult.selectedRowIds,
            moveResult.rows
          );

          if ((predicate?.sort?.length ?? 0) > 0 || groupBy.length > 0) {
            savePredicate({
              sort: [],
              groupBy: [],
            });
            props.superstate.ui.notify("Manual row order enabled.");
          }
        }
      }
      resetState();
      return;
    }

    if (activeDndId && overDndId) {
      const currentCols = predicate?.colsOrder ?? [];
      const activeIndex = currentCols.findIndex((f) => f == activeDndId);
      const overIndex = currentCols.findIndex((f) => f == overDndId);
      if (activeIndex >= 0 && overIndex >= 0 && activeIndex != overIndex) {
        savePredicate({
          colsOrder: arrayMove(currentCols, activeIndex, overIndex),
        });
      }
    }

    resetState();
  }

  function handleDragCancel() {
    resetState();
  }
  function resetState() {
    setOverId(null);
    setActiveId(null);
    activeDragTypeRef.current = null;
    rowDragPointerRef.current = null;
    setActiveDragType(null);
    setActiveRowDragIds([]);
    // setDropPlaceholderItem(null);
    document.body.style.setProperty("cursor", "");
  }
  const activeRowDragRows = activeRowDragIds
    .map((rowId) => data.find((row) => row._index == rowId) as DBRow)
    .filter(Boolean);

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={tableCollisionDetection}
      measuring={measuring}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
    >
      <div
        className={classNames("mk-table", isRTLTable && "mk-table-rtl")}
        dir={tableDirection}
        ref={ref}
        tabIndex={1}
        onKeyDown={onKeyDown}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <table
          {
            ...{
              // style: {
              //   width: table.getTotalSize(),
              // },
            }
          }
        >
          <thead>
            {table.getHeaderGroups().map((headerGroup) => (
              <tr key={headerGroup.id}>
                <th
                  className={classNames(
                    "mk-row-gutter-header",
                    frozenColumnCount > 0 && "mk-frozen-row-gutter"
                  )}
                  style={propertyHeaderColumnWidthStyle(rowGutterWidth)}
                ></th>
                {headerGroup.headers.map((header) => {
                  const accessorKey = (header.column.columnDef as any)
                    .accessorKey;
                  const frozenOffset = frozenColumnOffsets[accessorKey];
                  const columnWidth =
                    frozenOffset?.width ??
                    propertyHeaderColumnWidthForSize(
                      colsSize[accessorKey],
                      defaultTableColumnWidth
                    );
                  const headerDisplayMode = propertyHeaderDisplayModeForValue(
                    predicate?.colsHeaderDisplay?.[accessorKey]
                  );
                  const dataAnchorMode = columnDataAnchorModeForValue(
                    predicate?.colsDataAnchor?.[accessorKey]
                  );
                  const setHeaderDisplayMode = (
                    mode: ColumnHeaderDisplayMode
                  ) => {
                    const nextHeaderDisplay = {
                      ...(predicate?.colsHeaderDisplay ?? {}),
                    };
                    if (mode == "adaptive") {
                      delete nextHeaderDisplay[accessorKey];
                    } else {
                      nextHeaderDisplay[accessorKey] = mode;
                    }
                    savePredicate({
                      colsHeaderDisplay: nextHeaderDisplay,
                    });
                  };
                  const setDataAnchorMode = (mode: ColumnDataAnchorMode) => {
                    const nextDataAnchor = {
                      ...(predicate?.colsDataAnchor ?? {}),
                    };
                    if (mode == "auto") {
                      delete nextDataAnchor[accessorKey];
                    } else {
                      nextDataAnchor[accessorKey] = mode;
                    }
                    savePredicate({
                      colsDataAnchor: nextDataAnchor,
                    });
                  };

                  return (
                    <th
                      className={classNames(
                        "mk-th",
                        frozenOffset && "mk-frozen-column",
                        frozenOffset?.isLast && "mk-frozen-column-last"
                      )}
                      key={header.id}
                      style={{
                        ...(header.column.getIsGrouped()
                          ? {
                              width: 0,
                              minWidth: 0,
                              maxWidth: 0,
                            }
                          : propertyHeaderColumnWidthStyle(columnWidth)),
                        ...(frozenOffset
                          ? {
                              [frozenOffset.side]: frozenOffset.offset,
                            }
                          : {}),
                      }}
                    >
                      {header.isPlaceholder ? null : header.column.columnDef
                          .header != "+" ? (
                        header.column.getIsGrouped() ? (
                          <></>
                        ) : (
                          <ColumnHeader
                            superstate={props.superstate}
                            editable={
                              !readMode &&
                              header.column.columnDef.meta.editable
                            }
                            column={cols.find(
                              (f) =>
                                f.name == header.column.columnDef.header &&
                                f.table == header.column.columnDef.meta.table
                            )}
                            columnWidth={columnWidth}
                            headerDisplayMode={headerDisplayMode}
                            setHeaderDisplayMode={setHeaderDisplayMode}
                            dataAnchorMode={dataAnchorMode}
                            setDataAnchorMode={setDataAnchorMode}
                          ></ColumnHeader>
                        )
                      ) : (
                        <ColumnHeader
                          superstate={props.superstate}
                          isNew={true}
                          editable={true}
                          column={{
                            name: "",
                            schemaId: header.column.columnDef.meta.schemaId,
                            type: "text",
                            table: "",
                          }}
                        ></ColumnHeader>
                      )}
                      <div
                        {...{
                          onMouseDown: header.getResizeHandler(),
                          onTouchStart: header.getResizeHandler(),
                          className: `mk-resizer ${
                            header.column.getIsResizing() ? "isResizing" : ""
                          }`,
                        }}
                      />
                    </th>
                  );
                })}
              </tr>
            ))}
          </thead>
          <tbody>
            {table.getRowModel().rows.map((row, visibleIndex) => {
              // Use row.original for reliable access to the row data
              // row.original is the actual data object from the data array
              const rowData = row.original as DBRow;
              const rowOriginalIndex = rowData?.["_index"];
              const rowSelected = !!selectedRows?.some(
                (f) => f == rowOriginalIndex
              );

              return (
                <TableBodyRow
                  rowId={rowOriginalIndex}
                  className={classNames(rowSelected && "mk-active")}
                  draggingOver={overId == rowDndId(rowOriginalIndex)}
                  onContextMenu={(e) => {
                    // Skip context menu for group header rows (they don't have _index)
                    if (rowOriginalIndex === undefined) {
                      return;
                    }
                    const rowIndex = parseInt(rowOriginalIndex);
                    if (isNaN(rowIndex)) {
                      console.warn("Invalid row index:", rowOriginalIndex);
                      return;
                    }
                    showRowContextMenu(
                      e,
                      props.superstate,
                      spaceCache.path,
                      dbSchema.id,
                      rowIndex
                    );
                  }}
                  key={row.id}
                >
                  {rowOriginalIndex !== undefined && !readMode ? (
                    <TableRowDragHandle
                      rowId={rowOriginalIndex}
                      rowNumber={visibleIndex + 1}
                      rowGutterWidth={rowGutterWidth}
                      selected={rowSelected}
                      disabled={readMode}
                      frozen={frozenColumnCount > 0}
                      onReorderStart={prepareRowDrag}
                      onSelectStart={startRowSelectionDrag}
                    />
                  ) : (
                    <td
                      className={classNames(
                        "mk-row-gutter",
                        frozenColumnCount > 0 && "mk-frozen-row-gutter"
                      )}
                      style={propertyHeaderColumnWidthStyle(rowGutterWidth)}
                    ></td>
                  )}
                  {row.getVisibleCells().map((cell, i) =>
                    cell.getIsGrouped() ? (
                      // If it's a grouped cell, add an expander and row count
                      <td
                        key={i}
                        className="mk-td-group"
                        colSpan={cols.length + (readMode ? 0 : 1)}
                      >
                        <div
                          {...{
                            onClick: row.getToggleExpandedHandler(),
                            style: {
                              display: "flex",
                              alignItems: "center",
                              cursor: "normal",
                            },
                          }}
                        >
                          {flexRender(
                            cell.column.columnDef.cell,
                            cell.getContext()
                          )}{" "}
                          ({row.subRows.length})
                        </div>
                      </td>
                    ) : cell.getIsAggregated() ? (
                      // If the cell is aggregated, use the Aggregated
                      // renderer for cell
                      <React.Fragment key={i}>
                        {flexRender(
                          cell.column.columnDef.aggregatedCell ??
                            cell.column.columnDef.cell,
                          cell.getContext()
                        )}
                      </React.Fragment>
                    ) : (() => {
                      const accessorKey = (cell.column.columnDef as any)
                        .accessorKey;
                      const frozenOffset = frozenColumnOffsets[accessorKey];
                      const columnWidth =
                        frozenOffset?.width ??
                        propertyHeaderColumnWidthForSize(
                          colsSize[accessorKey],
                          defaultTableColumnWidth
                        );
                      const compactCell =
                        propertyHeaderUsesCompactCellLayout(columnWidth);
                      const fieldType = cell.column.columnDef.meta?.fieldType;
                      const headerDisplayMode = propertyHeaderDisplayModeForValue(
                        predicate?.colsHeaderDisplay?.[accessorKey]
                      );
                      const dataAnchor = columnDataAnchorForCells({
                        mode: columnDataAnchorModeForValue(
                          predicate?.colsDataAnchor?.[accessorKey]
                        ),
                        headerDisplayMode,
                        columnWidth,
                        values: table
                          .getRowModel()
                          .rows.map((row) => row.getValue(accessorKey)),
                        tableDirection,
                      });
                      const feedback =
                        rowOriginalIndex !== undefined
                          ? cellEditFeedback[
                              tableCellFeedbackKey(
                                rowOriginalIndex,
                                accessorKey
                              )
                            ]
                          : undefined;

                      return (
                        <td
                          onMouseDown={(e) =>
                            selectCell(e, cell.row.index, accessorKey)
                          }
                          onMouseEnter={(e) => {
                            if (e.buttons != 1) return;
                            extendSelectionToCell(
                              cell.row.index,
                              accessorKey
                            );
                          }}
                          title={titleForTableEditFeedback(feedback)}
                          className={classNames(
                            "mk-td",
                            cell.getIsPlaceholder() && "mk-td-empty",
                            cellSelection &&
                              selectionContainsCell(
                                cellSelection,
                                visibleRowOrder,
                                visibleColumnOrder,
                                {
                                  rowId: rowOriginalIndex,
                                  columnId: accessorKey,
                                }
                              ) &&
                              "mk-selected-cell",
                            cellSelection?.active.rowId == rowOriginalIndex &&
                              cellSelection?.active.columnId == accessorKey &&
                              "mk-active-cell",
                            feedback?.state == "pending" &&
                              "mk-cell-pending",
                            feedback?.state == "failed" && "mk-cell-failed",
                            feedback?.state == "skipped" && "mk-cell-skipped",
                            feedback?.action == "frontmatter-conflict" &&
                              "mk-cell-conflict",
                            compactCell && "mk-td-compact",
                            `mk-td-anchor-${dataAnchor}`,
                            fieldType == "boolean" && "mk-td-boolean",
                            frozenOffset && "mk-frozen-column",
                            frozenOffset?.isLast && "mk-frozen-column-last"
                          )}
                          key={cell.id}
                          style={{
                            ...(cell.getIsPlaceholder()
                              ? {
                                  width: 0,
                                  minWidth: 0,
                                  maxWidth: 0,
                                }
                              : propertyHeaderColumnWidthStyle(columnWidth)),
                            ...(frozenOffset
                              ? {
                                  [frozenOffset.side]: frozenOffset.offset,
                                }
                              : {}),
                          }}
                        >
                          {cell.getIsPlaceholder() ? null : (
                            <>
                              {flexRender(
                                cell.column.columnDef.cell,
                                cell.getContext()
                              )}
                              {feedback?.action == "frontmatter-conflict" &&
                              feedback.write ? (
                                <div
                                  className="mk-cell-conflict-actions"
                                  onMouseDown={(e) => e.stopPropagation()}
                                >
                                  <button
                                    className="mk-cell-conflict-action"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      reloadConflictData();
                                    }}
                                    title="Reload current file value"
                                  >
                                    Reload
                                  </button>
                                  <button
                                    className="mk-cell-conflict-action"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      applyConflictWrite(feedback.write);
                                    }}
                                    title="Apply this value to the file"
                                  >
                                    Apply anyway
                                  </button>
                                </div>
                              ) : null}
                            </>
                          )}
                        </td>
                      );
                    })()
                  )}
                </TableBodyRow>
              );
            })}
          </tbody>
          <tfoot>
            {table.getCanNextPage() && (
              <tr>
                <th
                  className="mk-row-new mk-row-pagination"
                  colSpan={cols.length + (readMode ? 1 : 2)}
                >
                  <div className="mk-table-pagination-actions">
                    <span className="mk-table-pagination-count">
                      {i18n.labels.tableRowsLoaded
                        .replace("${1}", loadedRowCount.toString())
                        .replace("${2}", data.length.toString())}
                    </span>
                    <button
                      className="mk-table-pagination-action"
                      type="button"
                      onClick={() =>
                        table.setPageSize(
                          nextTableLoadMorePageSize({
                            currentPageSize: pagination.pageSize,
                            increment: pageSize,
                            totalRows: data.length,
                          })
                        )
                      }
                    >
                      {i18n.buttons.loadMore}
                    </button>
                    <button
                      className="mk-table-pagination-action"
                      type="button"
                      onClick={() =>
                        table.setPageSize(tableLoadAllPageSize(data.length))
                      }
                    >
                      {i18n.buttons.loadAll}
                    </button>
                  </div>
                </th>
              </tr>
            )}
            {!readMode ? (
              <tr>
                <th
                  className="mk-row-new"
                  colSpan={cols.length + (readMode ? 1 : 2)}
                  data-placeholder={i18n.hintText.newItem}
                  onFocus={(e) => {
                    setSelectedColumn(null);
                    setLastSelectedIndex(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key == "Enter") {
                      newRow(e.currentTarget.innerText);
                      e.currentTarget.innerText = "";
                      e.preventDefault();
                    }
                  }}
                  contentEditable={true}
                ></th>
              </tr>
            ) : (
              <></>
            )}
            <tr>
              <td
                className={classNames(
                  "mk-row-gutter",
                  frozenColumnCount > 0 && "mk-frozen-row-gutter"
                )}
                style={propertyHeaderColumnWidthStyle(rowGutterWidth)}
              ></td>
              {groupBy.map((f, i) => (
                <td key={i}></td>
              ))}
              {(groupBy.length > 0
                ? cols.filter((f) => !groupBy.includes(f.name))
                : cols
              ).map((col, i) => {
                const columnId = col.name + col.table;
                const frozenOffset = frozenColumnOffsets[columnId];
                const columnWidth =
                  frozenOffset?.width ??
                  propertyHeaderColumnWidthForSize(
                    colsSize[columnId],
                    defaultTableColumnWidth
                  );

                return (
                  <td
                    key={i}
                    className={classNames(
                      "mk-td-aggregate",
                      !predicate.colsCalc[col.name] && "mk-empty",
                      frozenOffset && "mk-frozen-column",
                      frozenOffset?.isLast && "mk-frozen-column-last"
                    )}
                    style={
                      {
                        ...propertyHeaderColumnWidthStyle(columnWidth),
                        ...(frozenOffset
                          ? {
                              [frozenOffset.side]: frozenOffset.offset,
                            }
                          : {}),
                      }
                    }
                    onClick={(e) => {
                      const options: SelectOption[] = [];
                      options.push({
                        name: i18n.labels.none,
                        value: "",
                        onClick: () => {
                          saveAggregate(col.name, null);
                        },
                      });
                      Object.keys(aggregateFnTypes).forEach((f) => {
                        if (
                          aggregateFnTypes[f].type ==
                            fieldTypeForField(col) ||
                          aggregateFnTypes[f].type == "any" ||
                          col.type == "flex"
                        )
                          options.push({
                            name: i18n.aggregates[f],
                            value: f,
                            onClick: () => {
                              saveAggregate(col.name, f);
                            },
                          });
                      });
                      const rect = e.currentTarget.getBoundingClientRect();
                      props.superstate.ui.openMenu(
                        rect,
                        defaultMenu(props.superstate.ui, options),
                        windowFromDocument(e.view.document)
                      );
                    }}
                  >
                    {predicate.colsCalc[col.name]?.length > 0 ? (
                      <div>
                        <span>
                          {i18n.aggregates[predicate.colsCalc[col.name]]}
                        </span>
                        {valueForAggregate(
                          aggregateValues[col.name],
                          aggregateFnTypes[predicate.colsCalc[col.name]]
                            .valueType,
                          col
                        )}
                      </div>
                    ) : (
                      <div>
                        <span>{i18n.labels.calculate}</span>
                      </div>
                    )}
                  </td>
                );
              })}
              <td></td>
            </tr>
          </tfoot>
        </table>

        {rowMarqueeRect ? (
          <div
            className="mk-row-marquee"
            style={{
              left: rowMarqueeRect.left,
              top: rowMarqueeRect.top,
              width: rowMarqueeRect.width,
              height: rowMarqueeRect.height,
            }}
          ></div>
        ) : null}

        {createPortal(
          <DragOverlay dropAnimation={null} zIndex={1600}>
            {activeDragType == "row" ? (
              <TableRowDragOverlay
                rows={activeRowDragRows}
                columns={cols}
              ></TableRowDragOverlay>
            ) : activeDragType == "column" && activeId ? (
              <ColumnHeader
                superstate={props.superstate}
                editable={false}
                column={{
                  name: activeId,
                  schemaId: tableData.schema.id,
                  type: "text",
                  table: "",
                }}
              ></ColumnHeader>
            ) : null}
          </DragOverlay>,
          document.body
        )}
      </div>
    </DndContext>
  );
};
