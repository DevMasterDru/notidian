import type { ColumnHeaderDisplayMode } from "shared/types/predicate";

export const propertyHeaderMinimumColumnWidth = 24;
export const legacyPropertyHeaderMinimumColumnWidth = 26;
export const propertyHeaderCompactCellMaxWidth = 47;

export const defaultPropertyHeaderDisplayMode: ColumnHeaderDisplayMode =
  "adaptive";

export const propertyHeaderDisplayModes: ColumnHeaderDisplayMode[] = [
  "adaptive",
  "full",
  "text",
  "icon",
];

export const propertyHeaderDisplayModeForValue = (
  value?: unknown
): ColumnHeaderDisplayMode =>
  propertyHeaderDisplayModes.includes(value as ColumnHeaderDisplayMode)
    ? (value as ColumnHeaderDisplayMode)
    : defaultPropertyHeaderDisplayMode;

export type PropertyHeaderDisplayParts = {
  showIcon: boolean;
  showText: boolean;
  showContextMarker: boolean;
  effectiveMode: Exclude<ColumnHeaderDisplayMode, "adaptive">;
};

export const propertyHeaderDisplayParts = ({
  mode,
  columnWidth,
  textOnlyMaxWidth = 95,
  iconOnlyMaxWidth = 47,
}: {
  mode: ColumnHeaderDisplayMode;
  columnWidth?: number;
  textOnlyMaxWidth?: number;
  iconOnlyMaxWidth?: number;
}): PropertyHeaderDisplayParts => {
  const resolvedMode =
    mode == "adaptive"
      ? (columnWidth ?? textOnlyMaxWidth + 1) <= iconOnlyMaxWidth
        ? "icon"
        : (columnWidth ?? textOnlyMaxWidth + 1) <= textOnlyMaxWidth
        ? "text"
        : "full"
      : mode;

  return {
    showIcon: resolvedMode == "full" || resolvedMode == "icon",
    showText: resolvedMode == "full" || resolvedMode == "text",
    showContextMarker: resolvedMode != "icon",
    effectiveMode: resolvedMode,
  };
};

export const propertyHeaderColumnWidthForSize = (
  columnWidth?: number,
  defaultColumnWidth = 150
): number =>
  Math.max(
    columnWidth ?? defaultColumnWidth,
    propertyHeaderMinimumColumnWidth
  );

export const propertyHeaderColumnWidthStyle = (
  columnWidth: number
): {
  width: number;
  minWidth: number;
  maxWidth: number;
} => ({
  width: columnWidth,
  minWidth: columnWidth,
  maxWidth: columnWidth,
});

export const propertyHeaderColumnSizingWithMinimum = (
  colsSize: Record<string, number>
): Record<string, number> =>
  Object.fromEntries(
    Object.entries(colsSize ?? {}).map(([columnId, columnWidth]) => [
      columnId,
      columnWidth == legacyPropertyHeaderMinimumColumnWidth
        ? propertyHeaderMinimumColumnWidth
        : propertyHeaderColumnWidthForSize(columnWidth),
    ])
  );

export const propertyHeaderUsesCompactCellLayout = (
  columnWidth?: number
): boolean =>
  propertyHeaderColumnWidthForSize(columnWidth) <=
  propertyHeaderCompactCellMaxWidth;

export const colsSizeWithPreservedPropertyHeaderWidth = ({
  colsSize,
  columnId,
  columnWidth,
}: {
  colsSize: Record<string, number>;
  columnId: string;
  columnWidth: number;
}): Record<string, number> => ({
  ...(colsSize ?? {}),
  [columnId]: columnWidth,
});
