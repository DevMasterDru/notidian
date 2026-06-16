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
  // Row ids are CANONICAL stringified indices (`index.toString()`), so only a
  // bare non-negative decimal integer string is valid. Number() alone is too
  // loose: it coerces "" / " " / "1.0" / "+1" / " 2 " to a number, and those
  // non-canonical aliases would desync the index->row map built below (which is
  // keyed by `index.toString()`), corrupting the reorder or crashing the remap.
  if (!/^\d+$/.test(rowId)) {
    return false;
  }
  const index = Number(rowId);
  return index < rows.length && String(index) === rowId;
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

  // DEDUP (keep first occurrence) is load-bearing, not cosmetic: a DUPLICATE
  // canonical id in visibleRowOrder is the same Set-vs-array desync class as the
  // non-canonical alias bug. `visibleSet = new Set(visibleIds)` (below) collapses
  // a duplicate to one slot, but nextVisibleIds/nextVisibleRows keep BOTH copies,
  // so the visibleCursor++ walk under-consumes nextVisibleRows — dropping one row
  // and duplicating another (a silent row-order corruption of the user's data).
  // rowDragSet dedups for exactly this reason; do the same here at the source.
  const visibleIds = [
    ...new Set(visibleRowOrder.filter((rowId) => isValidRowId(rowId, rows))),
  ];
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
