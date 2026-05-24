export type CellCoord = {
  rowId: string;
  columnId: string;
};

export type CellSelection = {
  anchor: CellCoord;
  focus: CellCoord;
  active: CellCoord;
};

export type CellDirection = "up" | "down" | "left" | "right";

export type CellSelectionBounds = {
  minRow: number;
  maxRow: number;
  minColumn: number;
  maxColumn: number;
};

const clamp = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, value));

const indexOrZero = (value: string, values: string[]): number => {
  const index = values.indexOf(value);
  return index < 0 ? 0 : index;
};

const moveCoord = (
  coord: CellCoord,
  rowOrder: string[],
  columnOrder: string[],
  direction: CellDirection
): CellCoord => {
  const rowIndex = indexOrZero(coord.rowId, rowOrder);
  const columnIndex = indexOrZero(coord.columnId, columnOrder);
  const nextRow =
    direction === "up"
      ? clamp(rowIndex - 1, 0, rowOrder.length - 1)
      : direction === "down"
      ? clamp(rowIndex + 1, 0, rowOrder.length - 1)
      : rowIndex;
  const nextColumn =
    direction === "left"
      ? clamp(columnIndex - 1, 0, columnOrder.length - 1)
      : direction === "right"
      ? clamp(columnIndex + 1, 0, columnOrder.length - 1)
      : columnIndex;

  return {
    rowId: rowOrder[nextRow],
    columnId: columnOrder[nextColumn],
  };
};

export const moveCellSelection = (
  selection: CellSelection,
  rowOrder: string[],
  columnOrder: string[],
  direction: CellDirection
): CellSelection => {
  const active = moveCoord(selection.active, rowOrder, columnOrder, direction);
  return { anchor: active, focus: active, active };
};

export const extendCellSelection = (
  selection: CellSelection,
  rowOrder: string[],
  columnOrder: string[],
  direction: CellDirection
): CellSelection => {
  const active = moveCoord(selection.active, rowOrder, columnOrder, direction);
  return { ...selection, focus: active, active };
};

export const cellSelectionBounds = (
  selection: CellSelection,
  rowOrder: string[],
  columnOrder: string[]
): CellSelectionBounds => {
  const startRow = indexOrZero(selection.anchor.rowId, rowOrder);
  const endRow = indexOrZero(selection.focus.rowId, rowOrder);
  const startColumn = indexOrZero(selection.anchor.columnId, columnOrder);
  const endColumn = indexOrZero(selection.focus.columnId, columnOrder);

  return {
    minRow: Math.min(startRow, endRow),
    maxRow: Math.max(startRow, endRow),
    minColumn: Math.min(startColumn, endColumn),
    maxColumn: Math.max(startColumn, endColumn),
  };
};

export const cellSelectionRange = (
  selection: CellSelection,
  rowOrder: string[],
  columnOrder: string[]
): CellCoord[] => {
  const bounds = cellSelectionBounds(selection, rowOrder, columnOrder);
  const cells: CellCoord[] = [];

  for (let row = bounds.minRow; row <= bounds.maxRow; row++) {
    for (let column = bounds.minColumn; column <= bounds.maxColumn; column++) {
      cells.push({ rowId: rowOrder[row], columnId: columnOrder[column] });
    }
  }

  return cells;
};

export const selectionContainsCell = (
  selection: CellSelection,
  rowOrder: string[],
  columnOrder: string[],
  coord: CellCoord
): boolean => {
  const bounds = cellSelectionBounds(selection, rowOrder, columnOrder);
  const row = rowOrder.indexOf(coord.rowId);
  const column = columnOrder.indexOf(coord.columnId);

  return (
    row >= bounds.minRow &&
    row <= bounds.maxRow &&
    column >= bounds.minColumn &&
    column <= bounds.maxColumn
  );
};
