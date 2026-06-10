import { SpaceTableColumn } from "shared/types/mdb";

// View-level property visibility/order state lives in the view predicate
// (colsHidden/colsOrder), keyed by name + table to match the rest of the
// predicate code paths. These helpers stay pure so the panel component can
// remain a thin shell over them.

export const propertyVisibilityKey = (
  col: Pick<SpaceTableColumn, "name" | "table">
): string => col.name + col.table;

export const isPinnedPropertyColumn = (
  col: Pick<SpaceTableColumn, "primary">
): boolean => col.primary == "true";

export type PropertyVisibilityGroups = {
  pinned: SpaceTableColumn[];
  shown: SpaceTableColumn[];
  hidden: SpaceTableColumn[];
};

// Pinned primary columns are excluded from both toggleable groups: they can
// never be hidden, even if a stale predicate still lists their key in
// colsHidden. Shown columns mirror the live table order (same comparator as
// the context's sortedColumns).
export const splitPropertyVisibilityGroups = (
  cols: SpaceTableColumn[],
  colsOrder: string[],
  colsHidden: string[]
): PropertyVisibilityGroups => {
  const order = colsOrder ?? [];
  const hiddenKeys = colsHidden ?? [];
  const pinned = cols.filter((f) => isPinnedPropertyColumn(f));
  const unpinned = cols.filter((f) => !isPinnedPropertyColumn(f));
  return {
    pinned,
    shown: unpinned
      .filter((f) => !hiddenKeys.some((c) => c == propertyVisibilityKey(f)))
      .sort(
        (a, b) =>
          order.findIndex((x) => x == propertyVisibilityKey(a)) -
          order.findIndex((x) => x == propertyVisibilityKey(b))
      ),
    hidden: unpinned.filter((f) =>
      hiddenKeys.some((c) => c == propertyVisibilityKey(f))
    ),
  };
};

export const togglePropertyVisibility = (
  col: SpaceTableColumn,
  hidden: boolean,
  colsHidden: string[]
): string[] => {
  const key = propertyVisibilityKey(col);
  const cleared = (colsHidden ?? []).filter((s) => s != key);
  if (!hidden) return cleared;
  if (isPinnedPropertyColumn(col)) return cleared;
  return [...cleared, key];
};

// Bulk actions only touch keys for the columns visible to the panel; unknown
// entries (other tables, stale columns) are preserved untouched.
export const showAllProperties = (
  cols: SpaceTableColumn[],
  colsHidden: string[]
): string[] => {
  const keys = cols.map((f) => propertyVisibilityKey(f));
  return (colsHidden ?? []).filter((s) => !keys.some((k) => k == s));
};

export const hideAllProperties = (
  cols: SpaceTableColumn[],
  colsHidden: string[]
): string[] => {
  const hideable = cols
    .filter((f) => !isPinnedPropertyColumn(f))
    .map((f) => propertyVisibilityKey(f));
  return [
    ...(colsHidden ?? []).filter((s) => !hideable.some((k) => k == s)),
    ...hideable,
  ];
};

export type PropertyVisibilityGroupId = "shown" | "hidden";

export type PropertyVisibilityDrag = {
  activeKey: string;
  // Key of the row the drag was dropped over; absent when dropping on the
  // group container itself (e.g. an empty group).
  overKey?: string;
  targetGroup: PropertyVisibilityGroupId;
};

export type PropertyVisibilityDragResult = {
  colsOrder?: string[];
  colsHidden?: string[];
} | null;

const moveOrderKey = (
  colsOrder: string[],
  activeKey: string,
  overKey: string
): string[] | null => {
  const order = colsOrder.some((f) => f == activeKey)
    ? [...colsOrder]
    : [...colsOrder, activeKey];
  const activeIndex = order.findIndex((f) => f == activeKey);
  const overIndex = order.findIndex((f) => f == overKey);
  if (activeIndex < 0 || overIndex < 0 || activeIndex == overIndex)
    return null;
  order.splice(overIndex, 0, ...order.splice(activeIndex, 1));
  return order;
};

// Applies a drag from the visibility panel to the predicate. Reordering
// within the shown group moves the key in colsOrder (same arrayMove shape the
// table header drag persists); dragging across groups toggles colsHidden.
// Returns only the changed predicate fields, or null when nothing changes.
export const applyPropertyVisibilityDrag = (
  cols: SpaceTableColumn[],
  colsOrder: string[],
  colsHidden: string[],
  drag: PropertyVisibilityDrag
): PropertyVisibilityDragResult => {
  const activeCol = cols.find(
    (f) => propertyVisibilityKey(f) == drag.activeKey
  );
  if (!activeCol || isPinnedPropertyColumn(activeCol)) return null;
  const isHidden = (colsHidden ?? []).some((s) => s == drag.activeKey);

  if (drag.targetGroup == "hidden") {
    if (isHidden) return null;
    return { colsHidden: togglePropertyVisibility(activeCol, true, colsHidden) };
  }

  const result: { colsOrder?: string[]; colsHidden?: string[] } = {};
  if (isHidden) {
    result.colsHidden = togglePropertyVisibility(activeCol, false, colsHidden);
  }
  if (drag.overKey && drag.overKey != drag.activeKey) {
    const reordered = moveOrderKey(colsOrder ?? [], drag.activeKey, drag.overKey);
    if (reordered) result.colsOrder = reordered;
  }
  return Object.keys(result).length > 0 ? result : null;
};
