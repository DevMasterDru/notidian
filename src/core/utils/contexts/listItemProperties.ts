import { SpaceTableColumn } from "shared/types/mdb";
import { Predicate } from "shared/types/predicate";

// ---------------------------------------------------------------------------
// List-view per-item display-property picker (Notion "Properties" parity).
// bd Notidian-543 — flag-gated (Q3) behind the default-OFF `listItemPropertyPicker`
// setting. The model + menu adapter + persistence half is pure, offline-testable
// logic (this module). The frame-render half — applying the allowlist to the
// `_properties` array the list kit's `fieldsView` renders — is the core
// render-path change that ships gated and awaits owner live-verify.
//
// AUTHORITY (ADR 0016): `visibleProperties` is VIEW CONFIG. It lives in the
// predicate's `listItemProps` → frameSchema → `.notidian/context.mdb`. It is
// NOT row data and carries no `source:"notidian"` per-row state. The existing
// `savePredicate({ listItemProps })` path already persists it; validation
// (`validatePredicate`) carries `listItemProps` through whole.
// ---------------------------------------------------------------------------

// The per-item visible-property allowlist is keyed by name + table, the same
// convention `colsHidden`/`colsOrder` and `propertyVisibilityKey` use, so a key
// from a context-table column and a base column never collide.
export const listItemPropertyKey = (
  col: Pick<SpaceTableColumn, "name" | "table">
): string => col.name + (col.table ?? "");

// Reads and normalizes `predicate.listItemProps.visibleProperties` into a clean
// string[] of column keys, or null when unset/empty/malformed. An ABSENT or
// EMPTY allowlist means "not configured" → render every property (today's
// behavior); it never means "show nothing" (a useless view). Non-string and
// duplicate entries are dropped so a corrupt predicate can never crash the
// render pass.
export const listItemVisibleProperties = (
  predicate: Partial<Predicate> | null | undefined
): string[] | null => {
  const raw = predicate?.listItemProps?.visibleProperties;
  if (!Array.isArray(raw)) return null;
  const seen = new Set<string>();
  const cleaned: string[] = [];
  for (const entry of raw) {
    if (typeof entry != "string") continue;
    if (entry.length == 0) continue;
    if (seen.has(entry)) continue;
    seen.add(entry);
    cleaned.push(entry);
  }
  return cleaned.length > 0 ? cleaned : null;
};

// THE FLAG-GATED RENDER CHOKEPOINT. Given the columns that would render per
// item today (`visibleCols`, already filtered to non-hidden columns), return
// the columns to actually render.
//
//  - flag OFF (default): return `visibleCols` UNCHANGED (the SAME array
//    reference) — the owner's vault is byte-for-byte identical to today.
//  - flag ON but no allowlist configured: also return `visibleCols` unchanged.
//  - flag ON with an allowlist: keep only the columns whose key is in the
//    allowlist, ordered to follow the allowlist, with any allowlisted-but-
//    missing key skipped and any visible column not in the allowlist hidden.
//
// Pure + total: never throws, never mutates the input array.
export const applyListItemVisibleProperties = (
  visibleCols: SpaceTableColumn[],
  predicate: Partial<Predicate> | null | undefined,
  flagEnabled: boolean
): SpaceTableColumn[] => {
  if (!flagEnabled) return visibleCols;
  const allow = listItemVisibleProperties(predicate);
  if (!allow) return visibleCols;
  const byKey = new Map<string, SpaceTableColumn>();
  for (const col of visibleCols) {
    const key = listItemPropertyKey(col);
    // First occurrence wins so the allowlist order maps deterministically.
    if (!byKey.has(key)) byKey.set(key, col);
  }
  // Follow the allowlist's order; drop keys that no longer resolve to a column.
  const ordered: SpaceTableColumn[] = [];
  const used = new Set<string>();
  for (const key of allow) {
    const col = byKey.get(key);
    if (col && !used.has(key)) {
      used.add(key);
      ordered.push(col);
    }
  }
  // Defensive: if the allowlist matched nothing currently visible (e.g. every
  // chosen property was deleted/renamed), fall back to today's full set rather
  // than render an item with zero properties.
  if (ordered.length == 0) return visibleCols;
  return ordered;
};

// ----- Menu adapter (reuses showPropertyVisibilityMenu's colsHidden/colsOrder
// contract without forking the component) ---------------------------------
//
// The shared property-visibility menu speaks in (colsHidden, colsOrder) and
// saves `{ colsHidden, colsOrder }`. The per-item picker stores an ALLOWLIST
// (`visibleProperties`). These two functions translate between the two so the
// menu can drive the allowlist unchanged:
//
//  - listItemPropsToMenuState: derive the menu's (colsHidden, colsOrder) from
//    the current allowlist. With no allowlist, nothing is hidden (the menu
//    shows every property as shown — matching the unconfigured default).
//  - menuStateToVisibleProperties: turn the menu's saved (colsHidden, colsOrder)
//    back into an allowlist = the columns NOT hidden, ordered by colsOrder
//    (unordered ones trailing in their natural column order).

export type ListItemMenuState = {
  colsHidden: string[];
  colsOrder: string[];
};

// Pinned/primary columns are excluded everywhere (they are the row name, never
// a per-item display property — `fieldsView` already filters `primary`).
const isPickableColumn = (col: SpaceTableColumn): boolean =>
  col.primary != "true";

export const listItemPropsToMenuState = (
  cols: SpaceTableColumn[],
  predicate: Partial<Predicate> | null | undefined
): ListItemMenuState => {
  const allow = listItemVisibleProperties(predicate);
  const pickable = (cols ?? []).filter(isPickableColumn);
  if (!allow) {
    // Unconfigured: nothing hidden, no explicit order — the menu shows every
    // property as "shown", matching today's render-everything default.
    return { colsHidden: [], colsOrder: [] };
  }
  const allowSet = new Set(allow);
  // Hidden = every pickable column whose key is NOT in the allowlist.
  const colsHidden = pickable
    .map((f) => listItemPropertyKey(f))
    .filter((key) => !allowSet.has(key));
  // The allowlist's order IS the per-item display order; feed it to colsOrder.
  return { colsHidden, colsOrder: [...allow] };
};

export const menuStateToVisibleProperties = (
  cols: SpaceTableColumn[],
  state: ListItemMenuState
): string[] => {
  const pickable = (cols ?? []).filter(isPickableColumn);
  const hidden = new Set(state?.colsHidden ?? []);
  const order = state?.colsOrder ?? [];
  const shown = pickable
    .map((f) => listItemPropertyKey(f))
    .filter((key) => !hidden.has(key));
  const shownSet = new Set(shown);
  const ordered: string[] = [];
  const used = new Set<string>();
  // Ordered shown keys first, following colsOrder.
  for (const key of order) {
    if (shownSet.has(key) && !used.has(key)) {
      used.add(key);
      ordered.push(key);
    }
  }
  // Then any shown key not named in colsOrder, in natural column order.
  for (const key of shown) {
    if (!used.has(key)) {
      used.add(key);
      ordered.push(key);
    }
  }
  return ordered;
};
