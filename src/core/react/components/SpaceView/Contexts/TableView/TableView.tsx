import {
  closestCenter,
  DndContext,
  DragEndEvent,
  DragOverEvent,
  DragOverlay,
  DragStartEvent,
  MeasuringStrategy,
  MouseSensor,
  TouchSensor,
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
import { DBRow, SpaceProperty } from "shared/types/mdb";
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
  incrementResetTokensForFeedback,
  pendingFeedbackForWrites,
  summaryForTableEditResult,
  tableCellFeedbackKey,
  TableCellResetTokens,
  TableEditFeedback,
  TableEditFeedbackWrite,
} from "core/utils/contexts/tableEditFeedback";
import { TableEditTransactionResult } from "core/utils/contexts/tableEditTransaction";
import { planTablePaste } from "core/utils/contexts/tablePastePlan";
import {
  CellSelection,
  cellSelectionBounds,
  extendCellSelection,
  moveCellSelection,
  selectionContainsCell,
} from "core/utils/contexts/tableSelection";
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
import { Filter } from "shared/types/predicate";
import { windowFromDocument } from "shared/utils/dom";
import { DataTypeView, DataTypeViewProps } from "../DataTypeView/DataTypeView";

declare module "@tanstack/table-core" {
  interface ColumnMeta<TData extends RowData, TValue> {
    table: string;
    editable: boolean;
    schemaId: string;
  }
}

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
    selectedRows,
    selectRows,
    sortedColumns: cols,
    filteredData: data,
    predicate,
    savePredicate,

    updateFieldValue,
    updateValue,
    applyTableEdits,
    renameRowTitle,
  } = useContext(ContextEditorContext);

  const pageSize = props.superstate.settings.contextPagination ?? 25;
  const [pagination, setPagination] = React.useState<PaginationState>({
    pageIndex: 0,
    pageSize: pageSize,
  });
  const [activeId, setActiveId] = useState(null);
  const [lastSelectedIndex, setLastSelectedIndex] = useState<string>(null);
  const [selectedColumn, setSelectedColumn] = useState<string>(null);
  const [currentEdit, setCurrentEdit] = useState<[string, string]>(null);
  const [cellSelection, setCellSelection] = useState<CellSelection>(null);
  const [cellEditFeedback, setCellEditFeedback] =
    useState<TableEditFeedback>({});
  const [cellResetTokens, setCellResetTokens] =
    useState<TableCellResetTokens>({});
  const [overId, setOverId] = useState(null);
  const [colsSize, setColsSize] = useState<ColumnSizingState>({});
  const feedbackOperationId = useRef(0);
  const ref = useRef(null);
  const primaryCol = cols.find((f) => f.primary == "true");
  useEffect(() => {
    setColsSize({ ...(predicate?.colsSize ?? {}), "+": 30 });
  }, [predicate]);

  useEffect(() => {
    setCurrentEdit(null);
  }, [selectedColumn, lastSelectedIndex]);

  // useEffect(() => {
  //   if (currentEdit == null) {
  //     ref.current.focus();
  //   }
  // }, [currentEdit]);

  const saveColsSize: OnChangeFn<ColumnSizingState> = (
    colSize: (old: ColumnSizingState) => ColumnSizingState
  ) => {
    const newColSize = colSize(colsSize);
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
      window.setTimeout(() => {
        if (feedbackOperationId.current == operationId) {
          setCellEditFeedback({});
        }
      }, 5000);
    }
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
    const visibleRowOrder = data.map((f) => f._index);
    const visibleColumnOrder = cols.map((f) => f.name + f.table);
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
          `${count} pasted cell${count == 1 ? " was" : "s were"} skipped.`
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
    const pasteSelection = async (clipboardText: string) => {
      if (!activeSelection) return;
      const plan = planTablePaste({
        rowOrder: visibleRowOrder,
        columns: pasteColumns,
        selection: activeSelection,
        clipboardGrid: parseTableClipboardText(clipboardText),
      });
      notifyRejections(plan.rejections.length);
      if (plan.writes.length == 0) return;

      const operationId = beginCellFeedbackOperation(plan.writes);
      const result = await applyTableEdits(plan.writes);
      finishCellFeedbackOperation(operationId, result);
    };
    const clearCell = () => {
      pasteSelection("");
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
      const nextSelection = e.shiftKey
        ? extendCellSelection(
            activeSelection,
            visibleRowOrder,
            visibleColumnOrder,
            direction
          )
        : moveCellSelection(
            activeSelection,
            visibleRowOrder,
            visibleColumnOrder,
            direction
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
          // enableResizing: true,
          meta: {
            table: f.table,
            editable: f.name != PathPropertyName,
            schemaId: dbSchema?.id,
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
                if (result) finishCellFeedbackOperation(operationId, result);
              }
              setCurrentEdit(null);
              setSelectedColumn(null);
            };
            const saveFieldValue = async (fieldValue: string, value: string) => {
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
              if (result) finishCellFeedbackOperation(operationId, result);
            };
            const renameValue = async (value: string) => {
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
            const cellProps: DataTypeViewProps = {
              compactMode: false,
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

  function handleDragStart(event: DragStartEvent) {
    const {
      active: { id: activeId },
    } = event;
    setActiveId(activeId);
    setOverId(overId);

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

  function handleDragEnd({ active, over }: DragEndEvent) {
    resetState();
    const currentCols = predicate?.colsOrder ?? [];
    savePredicate({
      colsOrder: arrayMove(
        currentCols,
        currentCols.findIndex((f) => f == activeId),
        currentCols.findIndex((f) => f == overId)
      ),
    });
  }

  function handleDragCancel() {
    resetState();
  }
  function resetState() {
    setOverId(null);
    setActiveId(null);
    // setDropPlaceholderItem(null);
    document.body.style.setProperty("cursor", "");
  }
  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      measuring={measuring}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
    >
      <div
        className="mk-table"
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
                <th></th>
                {headerGroup.headers.map((header) => (
                  <th
                    className="mk-th"
                    key={header.id}
                    style={{
                      minWidth: header.column.getIsGrouped()
                        ? "0px"
                        : // @ts-ignore
                          colsSize[header.column.columnDef.accessorKey] ??
                          "150px",
                      maxWidth: header.column.getIsGrouped()
                        ? "0px"
                        : // @ts-ignore
                          colsSize[header.column.columnDef.accessorKey] ??
                          "150px",
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
                            !readMode && header.column.columnDef.meta.editable
                          }
                          column={cols.find(
                            (f) =>
                              f.name == header.column.columnDef.header &&
                              f.table == header.column.columnDef.meta.table
                          )}
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
                ))}
              </tr>
            ))}
          </thead>
          <tbody>
            {table.getRowModel().rows.map((row) => {
              // Use row.original for reliable access to the row data
              // row.original is the actual data object from the data array
              const rowData = row.original as DBRow;
              const rowOriginalIndex = rowData?.["_index"];

              return (
              <tr
                className={
                  selectedRows?.some(
                    (f) => f == rowOriginalIndex
                  )
                    ? "mk-active"
                    : undefined
                }
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
                <td></td>
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
                    const feedback =
                      rowOriginalIndex !== undefined
                        ? cellEditFeedback[
                            tableCellFeedbackKey(rowOriginalIndex, accessorKey)
                          ]
                        : undefined;

                    return (
                    <td
                      onMouseDown={(e) =>
                        selectCell(
                          e,
                          cell.row.index,
                          accessorKey
                        )
                      }
                      onMouseEnter={(e) => {
                        if (e.buttons != 1) return;
                        extendSelectionToCell(
                          cell.row.index,
                          accessorKey
                        );
                      }}
                      title={feedback?.reason}
                      className={classNames(
                        "mk-td",
                        cell.getIsPlaceholder() && "mk-td-empty",
                        cellSelection &&
                          selectionContainsCell(
                            cellSelection,
                            data.map((f) => f._index),
                            cols.map((f) => f.name + f.table),
                            {
                              rowId: rowOriginalIndex,
                              columnId: accessorKey,
                            }
                          ) &&
                          "mk-selected-cell",
                        cellSelection?.active.rowId == rowOriginalIndex &&
                          cellSelection?.active.columnId == accessorKey &&
                          "mk-active-cell",
                        feedback?.state == "pending" && "mk-cell-pending",
                        feedback?.state == "failed" && "mk-cell-failed",
                        feedback?.state == "skipped" && "mk-cell-skipped"
                      )}
                      key={cell.id}
                      style={{
                        minWidth: cell.getIsPlaceholder()
                          ? "0px"
                          : // @ts-ignore
                            colsSize[cell.column.columnDef.accessorKey] ??
                            "50px",
                        maxWidth: cell.getIsPlaceholder()
                          ? "0px"
                          : // @ts-ignore
                            colsSize[cell.column.columnDef.accessorKey] ??
                            "unset",
                      }}
                    >
                      {cell.getIsPlaceholder()
                        ? null
                        : flexRender(
                            cell.column.columnDef.cell,
                            cell.getContext()
                          )}
                    </td>
                    );
                  })()
                )}
              </tr>
            );
            })}
          </tbody>
          <tfoot>
            {table.getCanNextPage() && (
              <tr>
                <th
                  className="mk-row-new"
                  colSpan={cols.length + (readMode ? 1 : 2)}
                  onClick={() =>
                    table.setPageSize(pagination.pageSize + pageSize)
                  }
                >
                  {i18n.buttons.loadMore}
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
              <td></td>
              {groupBy.map((f, i) => (
                <td key={i}></td>
              ))}
              {(groupBy.length > 0
                ? cols.filter((f) => !groupBy.includes(f.name))
                : cols
              ).map((col, i) => (
                <td
                  key={i}
                  className={classNames(
                    "mk-td-aggregate",
                    !predicate.colsCalc[col.name] && "mk-empty"
                  )}
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
                        aggregateFnTypes[f].type == fieldTypeForField(col) ||
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
              ))}
              <td></td>
            </tr>
          </tfoot>
        </table>

        {createPortal(
          <DragOverlay dropAnimation={null} zIndex={1600}>
            {activeId ? (
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
