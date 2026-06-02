import { DBRows } from "shared/types/mdb";

export type MoveVisibleRowsArgs = {
  rows: DBRows;
  visibleRowOrder: string[];
  activeRowId: string;
  overRowId: string;
  selectedRowIds?: string[];
};

export type MoveVisibleRowsResult = {
  changed: boolean;
  rows: DBRows;
  movedRowIds: string[];
  selectedRowIds: string[];
};

const isValidRowId = (rowId: string, rows: DBRows): boolean => {
  const index = Number(rowId);
  return Number.isInteger(index) && index >= 0 && index < rows.length;
};

export const rowDragSet = (
  visibleRowOrder: string[],
  activeRowId: string,
  selectedRowIds: string[] = []
): string[] => {
  const selected = new Set(selectedRowIds);
  const dragged = selected.has(activeRowId)
    ? visibleRowOrder.filter((rowId) => selected.has(rowId))
    : [activeRowId];

  return [...new Set(dragged)];
};

export const moveVisibleRows = ({
  rows,
  visibleRowOrder,
  activeRowId,
  overRowId,
  selectedRowIds = [],
}: MoveVisibleRowsArgs): MoveVisibleRowsResult => {
  const unchanged: MoveVisibleRowsResult = {
    changed: false,
    rows,
    movedRowIds: [],
    selectedRowIds: [],
  };

  if (
    !isValidRowId(activeRowId, rows) ||
    !isValidRowId(overRowId, rows) ||
    activeRowId == overRowId
  ) {
    return unchanged;
  }

  const visibleIds = visibleRowOrder.filter((rowId) =>
    isValidRowId(rowId, rows)
  );
  if (!visibleIds.includes(activeRowId) || !visibleIds.includes(overRowId)) {
    return unchanged;
  }

  const draggedIds = rowDragSet(visibleIds, activeRowId, selectedRowIds).filter(
    (rowId) => isValidRowId(rowId, rows)
  );
  if (draggedIds.length == 0 || draggedIds.includes(overRowId)) {
    return unchanged;
  }

  const overIndex = visibleIds.indexOf(overRowId);
  const draggedBeforeOver = draggedIds.filter(
    (rowId) => visibleIds.indexOf(rowId) < overIndex
  ).length;
  const remainingVisibleIds = visibleIds.filter(
    (rowId) => !draggedIds.includes(rowId)
  );
  const insertIndex = Math.min(
    draggedBeforeOver > 0
      ? overIndex - draggedBeforeOver + 1
      : overIndex,
    remainingVisibleIds.length
  );
  const nextVisibleIds = [
    ...remainingVisibleIds.slice(0, insertIndex),
    ...draggedIds,
    ...remainingVisibleIds.slice(insertIndex),
  ];

  if (nextVisibleIds.join("\u0000") == visibleIds.join("\u0000")) {
    return unchanged;
  }

  const indexedRows = rows.map((row, index) => ({
    originalRowId: index.toString(),
    row,
  }));
  const visibleSet = new Set(visibleIds);
  const indexedRowsById = new Map(
    indexedRows.map((item) => [item.originalRowId, item])
  );
  const nextVisibleRows = nextVisibleIds.map((rowId) =>
    indexedRowsById.get(rowId)
  );
  let visibleCursor = 0;
  const nextIndexedRows = indexedRows.map((item) =>
    visibleSet.has(item.originalRowId)
      ? nextVisibleRows[visibleCursor++]
      : item
  );
  const draggedSet = new Set(draggedIds);
  const nextDraggedIds = nextIndexedRows.reduce<string[]>(
    (nextIds, item, index) =>
      draggedSet.has(item.originalRowId)
        ? [...nextIds, index.toString()]
        : nextIds,
    []
  );

  return {
    changed: true,
    rows: nextIndexedRows.map((item) => item.row),
    movedRowIds: draggedIds,
    selectedRowIds: nextDraggedIds,
  };
};
