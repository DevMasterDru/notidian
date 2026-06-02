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
