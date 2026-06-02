import { SpaceTableColumn } from "shared/types/mdb";

export type FrozenColumnOffset = {
  left: number;
  width: number;
  isLast: boolean;
};

export const tableColumnId = (column: Pick<SpaceTableColumn, "name" | "table">): string =>
  column.name + (column.table ?? "");

export const visibleTableColumnIds = ({
  columns,
  hiddenColumnIds,
}: {
  columns: SpaceTableColumn[];
  hiddenColumnIds: string[];
}): string[] => {
  const hidden = new Set(hiddenColumnIds ?? []);
  return columns
    .map(tableColumnId)
    .filter((columnId) => columnId != "+" && !hidden.has(columnId));
};

export const clampFrozenColumnCount = ({
  columns,
  hiddenColumnIds,
  frozenColumnCount,
}: {
  columns: SpaceTableColumn[];
  hiddenColumnIds: string[];
  frozenColumnCount: number;
}): number => {
  const visibleColumnCount = visibleTableColumnIds({
    columns,
    hiddenColumnIds,
  }).length;
  const count = Number.isFinite(frozenColumnCount)
    ? Math.floor(frozenColumnCount)
    : 0;

  return Math.max(0, Math.min(count, visibleColumnCount));
};

export const frozenColumnCountForColumn = ({
  columns,
  hiddenColumnIds,
  columnId,
}: {
  columns: SpaceTableColumn[];
  hiddenColumnIds: string[];
  columnId: string;
}): number => {
  const visibleColumnIds = visibleTableColumnIds({ columns, hiddenColumnIds });
  const columnIndex = visibleColumnIds.indexOf(columnId);

  return columnIndex >= 0 ? columnIndex + 1 : 0;
};

export const frozenTableColumnIds = ({
  columns,
  hiddenColumnIds,
  frozenColumnCount,
}: {
  columns: SpaceTableColumn[];
  hiddenColumnIds: string[];
  frozenColumnCount: number;
}): string[] => {
  const visibleColumnIds = visibleTableColumnIds({ columns, hiddenColumnIds });
  return visibleColumnIds.slice(
    0,
    clampFrozenColumnCount({ columns, hiddenColumnIds, frozenColumnCount })
  );
};

export const stickyOffsetsForFrozenColumns = ({
  columns,
  hiddenColumnIds,
  frozenColumnCount,
  columnSizes,
  rowGutterWidth,
  defaultColumnWidth = 150,
}: {
  columns: SpaceTableColumn[];
  hiddenColumnIds: string[];
  frozenColumnCount: number;
  columnSizes: Record<string, number>;
  rowGutterWidth: number;
  defaultColumnWidth?: number;
}): Record<string, FrozenColumnOffset> => {
  const frozenColumnIds = frozenTableColumnIds({
    columns,
    hiddenColumnIds,
    frozenColumnCount,
  });
  const offsets: Record<string, FrozenColumnOffset> = {};
  let left = rowGutterWidth;

  frozenColumnIds.forEach((columnId, index) => {
    const width = columnSizes[columnId] ?? defaultColumnWidth;
    offsets[columnId] = {
      left,
      width,
      isLast: index == frozenColumnIds.length - 1,
    };
    left += width;
  });

  return offsets;
};
