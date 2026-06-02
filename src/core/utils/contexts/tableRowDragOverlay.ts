import { SpaceTableColumn } from "shared/types/mdb";
import { DBRow } from "shared/types/mdb";
import { PathPropertyName } from "shared/types/context";
import { pageTitleFromPath } from "./pageTitle";

export const rowDragOverlayColumns = (
  columns: SpaceTableColumn[]
): SpaceTableColumn[] => {
  const fileColumn = columns.find((column) => column.name == PathPropertyName);
  if (fileColumn) return [fileColumn];

  const fallbackColumn = columns.find((column) => column.name != "+");
  return fallbackColumn ? [fallbackColumn] : [];
};

export const rowDragOverlayLabel = (
  row: DBRow,
  column: SpaceTableColumn
): string => {
  const table = column.table ?? "";
  const value = row?.[column.name + table];
  const fallback = row?.[column.name];
  const rawValue = value ?? fallback ?? "";

  return column.name == PathPropertyName
    ? pageTitleFromPath(rawValue)
    : rawValue;
};
