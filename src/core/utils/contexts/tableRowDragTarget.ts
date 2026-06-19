export type RowDragPoint = {
  x: number;
  y: number;
};

export const rowDndIdPrefix = "notidian-row:";

export const rowDndId = (rowId: string): string => `${rowDndIdPrefix}${rowId}`;

export const isRowDndId = (id: unknown): boolean =>
  typeof id == "string" && id.startsWith(rowDndIdPrefix);

export const rowIdFromDndId = (id: unknown): string | null =>
  typeof id == "string" && id.startsWith(rowDndIdPrefix)
    ? id.slice(rowDndIdPrefix.length)
    : null;

export type TableDragType = "column" | "row" | null;

/**
 * Gate the `overId` that drives the row drop-indicator state (`.mk-row-drag-over`).
 *
 * The table runs ONE dnd-kit DndContext for BOTH column-header reordering and
 * row reordering. During a column-header drag the collision detection can match
 * a row droppable, which would otherwise set `overId` to a row id and light the
 * green row-drop line on body rows — even though a header can only move within
 * the header row. This drops any row-droppable `overId` unless an actual row
 * drag is active, while passing column-header droppables (and `null`) through
 * unchanged so the column-reorder header indicator and the real row-drag
 * indicator both keep working.
 */
export const resolveDragOverId = ({
  overId,
  activeDragType,
}: {
  overId: unknown;
  activeDragType: TableDragType;
}): unknown => {
  if (isRowDndId(overId) && activeDragType !== "row") return null;
  return overId;
};

export const resolveRowDropTargetId = ({
  activeId,
  overId,
  pointer,
  rowIdAtPoint,
}: {
  activeId: unknown;
  overId: unknown;
  pointer: RowDragPoint | null;
  rowIdAtPoint: (point: RowDragPoint) => string | null;
}): string | null => {
  if (!isRowDndId(activeId)) return null;

  const overRowId = rowIdFromDndId(overId);
  if (overRowId) return overRowId;

  return pointer ? rowIdAtPoint(pointer) : null;
};
