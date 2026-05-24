import {
  PropertyAuthority,
  propertyAuthorityForColumn,
} from "core/utils/properties/propertyAuthority";
import { cellSelectionBounds, CellSelection } from "./tableSelection";

export type TablePasteColumn = {
  id: string;
  name: string;
  type: string;
  source?: string;
  table?: string;
};

export type TablePasteWrite = {
  rowId: string;
  columnId: string;
  columnName: string;
  table: string;
  value: string;
  authority: Exclude<PropertyAuthority, "computed">;
};

export type TablePasteRejectionReason =
  | "read-only"
  | "out-of-bounds"
  | "non-repeatable-range";

export type TablePasteRejection = {
  rowId: string;
  columnId: string;
  value: string;
  reason: TablePasteRejectionReason;
};

export type TablePasteMode = "property-paste" | "bulk-rename" | "mixed";

export type TablePastePlan = {
  writes: TablePasteWrite[];
  rejections: TablePasteRejection[];
  mode: TablePasteMode;
};

export type PlanTablePasteParams = {
  rowOrder: string[];
  columns: TablePasteColumn[];
  selection: CellSelection;
  clipboardGrid: string[][];
};

const dimensionsForPaste = (
  selection: CellSelection,
  rowOrder: string[],
  columnOrder: string[],
  clipboardGrid: string[][]
): {
  startRow: number;
  startColumn: number;
  rows: number;
  columns: number;
  repeat: boolean;
} => {
  const bounds = cellSelectionBounds(selection, rowOrder, columnOrder);
  const selectedRows = bounds.maxRow - bounds.minRow + 1;
  const selectedColumns = bounds.maxColumn - bounds.minColumn + 1;
  const sourceRows = clipboardGrid.length;
  const sourceColumns = Math.max(
    1,
    ...clipboardGrid.map((row) => row.length)
  );
  const selectedCellCount = selectedRows * selectedColumns;

  if (selectedCellCount > 1) {
    const singleSource = sourceRows == 1 && sourceColumns == 1;
    const repeatable =
      selectedRows % sourceRows == 0 && selectedColumns % sourceColumns == 0;
    return {
      startRow: bounds.minRow,
      startColumn: bounds.minColumn,
      rows: selectedRows,
      columns: selectedColumns,
      repeat: singleSource || repeatable,
    };
  }

  return {
    startRow: rowOrder.indexOf(selection.active.rowId),
    startColumn: columnOrder.indexOf(selection.active.columnId),
    rows: sourceRows,
    columns: sourceColumns,
    repeat: false,
  };
};

const modeForWrites = (writes: TablePasteWrite[]): TablePasteMode => {
  const hasFile = writes.some((write) => write.authority == "file");
  const hasNonFile = writes.some((write) => write.authority != "file");
  if (hasFile && hasNonFile) return "mixed";
  if (hasFile) return "bulk-rename";
  return "property-paste";
};

const valueAt = (
  clipboardGrid: string[][],
  row: number,
  column: number,
  repeat: boolean
): string => {
  const sourceRow = repeat ? row % clipboardGrid.length : row;
  const sourceColumn = repeat
    ? column % Math.max(1, ...clipboardGrid.map((r) => r.length))
    : column;
  return clipboardGrid[sourceRow]?.[sourceColumn] ?? "";
};

export const planTablePaste = ({
  rowOrder,
  columns,
  selection,
  clipboardGrid,
}: PlanTablePasteParams): TablePastePlan => {
  const columnOrder = columns.map((column) => column.id);
  const dimensions = dimensionsForPaste(
    selection,
    rowOrder,
    columnOrder,
    clipboardGrid
  );
  const writes: TablePasteWrite[] = [];
  const rejections: TablePasteRejection[] = [];

  if (dimensions.startRow < 0 || dimensions.startColumn < 0) {
    return {
      writes,
      rejections: [
        {
          rowId: selection.active.rowId,
          columnId: selection.active.columnId,
          value: clipboardGrid[0]?.[0] ?? "",
          reason: "out-of-bounds",
        },
      ],
      mode: "property-paste",
    };
  }

  if (!dimensions.repeat) {
    const bounds = cellSelectionBounds(selection, rowOrder, columnOrder);
    const selectedRows = bounds.maxRow - bounds.minRow + 1;
    const selectedColumns = bounds.maxColumn - bounds.minColumn + 1;
    const sourceRows = clipboardGrid.length;
    const sourceColumns = Math.max(
      1,
      ...clipboardGrid.map((row) => row.length)
    );
    const selectedCellCount = selectedRows * selectedColumns;

    if (
      selectedCellCount > 1 &&
      (selectedRows % sourceRows != 0 || selectedColumns % sourceColumns != 0)
    ) {
      return {
        writes,
        rejections: [
          {
            rowId: selection.active.rowId,
            columnId: selection.active.columnId,
            value: clipboardGrid[0]?.[0] ?? "",
            reason: "non-repeatable-range",
          },
        ],
        mode: "property-paste",
      };
    }
  }

  for (let rowOffset = 0; rowOffset < dimensions.rows; rowOffset++) {
    for (
      let columnOffset = 0;
      columnOffset < dimensions.columns;
      columnOffset++
    ) {
      const rowId = rowOrder[dimensions.startRow + rowOffset] ?? "";
      const column = columns[dimensions.startColumn + columnOffset];
      const value = valueAt(
        clipboardGrid,
        rowOffset,
        columnOffset,
        dimensions.repeat
      );

      if (!rowId || !column) {
        rejections.push({
          rowId,
          columnId: column?.id ?? "",
          value,
          reason: "out-of-bounds",
        });
        continue;
      }

      const authority = propertyAuthorityForColumn(column);
      if (authority == "computed") {
        rejections.push({
          rowId,
          columnId: column.id,
          value,
          reason: "read-only",
        });
        continue;
      }

      writes.push({
        rowId,
        columnId: column.id,
        columnName: column.name,
        table: column.table ?? "",
        value,
        authority,
      });
    }
  }

  return {
    writes,
    rejections,
    mode: modeForWrites(writes),
  };
};
