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
  // Adaptive favours a DENSE icon+name: the property icon stays visible as the
  // column narrows (it is the fastest way to recognise a column at a glance) and
  // only the name truncates with an ellipsis. We collapse to icon-only just
  // below the compact threshold, where there is no longer room for meaningful
  // name text. Previously adaptive stepped icon-only → text-only (icon dropped)
  // → full, so the icon vanished across the whole mid-width band; the icon now
  // persists instead. The explicit "text"/"icon"/"full" modes are still
  // selectable for manual overrides. (textOnlyMaxWidth is retained for callers
  // that pass a custom value but no longer gates the adaptive icon.)
  void textOnlyMaxWidth;
  const resolvedMode =
    mode == "adaptive"
      ? (columnWidth ?? iconOnlyMaxWidth + 1) <= iconOnlyMaxWidth
        ? "icon"
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
