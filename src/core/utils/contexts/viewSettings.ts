import { displayPropertyForPredicate } from "core/utils/contexts/rowDisplayLabel";
import { Predicate } from "shared/types/predicate";

// ---------------------------------------------------------------------------
// View-settings information architecture (bd Notidian-vrmf).
//
// Owner report (2026-06-21): the FilterBar view-settings layout should be
// STANDARDIZED. Two halves, both routed through the default-ON kill-switch
// `viewSettingsInlineBar` (the owner's USE is the verification):
//
//   (1) DE-DUP / single home: a control must not appear BOTH inline (the
//       toolbar buttons beside the 3-knobs button) AND inside the 3-knobs
//       ("view options") overflow menu. Group-By already moved inline-only
//       (Notidian-nmr); this completes the trio by making Filter and Sort
//       inline-only too, so the 3-knobs menu stops re-listing them.
//   (2) INLINE ACTIVE-STATE: the inline controls carry a per-control
//       active/inactive indicator derived from the predicate, so the owner
//       sees at a glance which settings are applied — using the unused
//       horizontal space beside the 3-knobs button rather than burying state
//       in a hidden menu.
//
// AUTHORITY: nothing here is data authority. Filter/sort/group-by/search are
// VIEW CONFIG already owned by the predicate (filters/sort/groupBy) and the
// transient search state. This module is PURE derivation over those — no
// frontmatter, no MDB writes, no row mutation.
//
// KILL-SWITCH semantics: when `viewSettingsInlineBar` is OFF, FilterBar takes
// the LEGACY render branch — the Filter/Sort/Group-By trio reverts to bare
// .mk-toolbar-button direct children of .mk-view-options (no
// .mk-view-settings-bar wrapper, no .mk-view-setting* classes, no data-mk-* /
// aria-pressed, no accent-underline CSS) with their pre-feature inline
// `predicate?.x.length > 0` active expressions, AND the 3-knobs menu re-lists
// Filter and Sort (the prior duplication). So `false` restores byte-for-byte
// legacy IA — markup AND visual. The pure logic here is exercised only on the
// ON branch.
//
// bd Notidian-4qjx.6 (owner-ratified 2026-07-20, gate Notidian-4qjx.12):
// Limit and Display Property are promoted from the overflow menu into this
// same inline bar. Unlike Filter/Sort/Group-By, neither ever had a LEGACY
// inline form to fall back to — their kill-switch behavior is therefore
// simpler: OFF means their sole home is (once again) the 3-knobs overflow
// menu, and they render nothing inline at all (no bare-button fallback is
// invented, because none existed before this promotion).
// ---------------------------------------------------------------------------

// The canonical inline controls whose single home is the toolbar bar beside the
// 3-knobs button. Search is included because it, too, lives inline (the
// magnifier toggle, ADR 0041) and carries an active state, but its active flag
// is driven by transient UI state rather than the predicate. Limit and
// Display Property (bd Notidian-4qjx.6) are the next promoted pair.
export type InlineControlId =
  | "filter"
  | "sort"
  | "groupBy"
  | "search"
  | "limit"
  | "displayProperty";

// Per-control active flags for the inline settings bar. Each is true exactly
// when that setting is currently APPLIED to the view, so the render can light
// the control's active indicator (`mk-active`).
export type InlineControlActiveState = {
  filter: boolean;
  sort: boolean;
  groupBy: boolean;
  search: boolean;
  limit: boolean;
  displayProperty: boolean;
};

// Derive the per-control active state from the predicate + the transient search
// flag. This is the single source of truth for the inline controls' `mk-active`
// class, replacing the scattered inline `predicate?.filters.length > 0`
// expressions so the decision is unit-testable and uniform across controls.
//
// Pure + total: a null/undefined/partial predicate yields all-false (nothing is
// applied), never throws, and never reads anything but the view-config fields
// it owns. `limit` lights exactly when a positive row limit is set (matching
// the overflow menu's own `predicate?.limit > 0` check); `displayProperty`
// reuses the existing `displayPropertyForPredicate` accessor so the two call
// sites can never diverge on what counts as "a display property is chosen".
export const deriveInlineControlActiveState = (
  predicate: Partial<Predicate> | null | undefined,
  searchActive: boolean | null | undefined
): InlineControlActiveState => ({
  filter: (predicate?.filters?.length ?? 0) > 0,
  sort: (predicate?.sort?.length ?? 0) > 0,
  groupBy: (predicate?.groupBy?.length ?? 0) > 0,
  search: searchActive === true,
  limit: (predicate?.limit ?? 0) > 0,
  displayProperty: displayPropertyForPredicate(predicate) !== null,
});

// Convenience single-control accessor (same derivation, one control). Kept so a
// render site can ask for exactly one flag without materializing the whole
// object — semantically identical to reading the field off the full state.
export const isInlineControlActive = (
  control: InlineControlId,
  predicate: Partial<Predicate> | null | undefined,
  searchActive: boolean | null | undefined
): boolean => deriveInlineControlActiveState(predicate, searchActive)[control];

// ---------------------------------------------------------------------------
// Single-home invariant (the de-dup DECISION, made testable).
//
// Every settings control has exactly ONE canonical home: either INLINE (a
// dedicated toolbar control beside the 3-knobs button) or IN_MENU (an entry in
// the 3-knobs overflow menu). The invariant the de-dup must satisfy is: NO
// control id appears in both homes. We encode the homes as a manifest and
// expose a checker so a unit test can prove the de-dup holds (and would catch a
// regression that re-adds Filter/Sort to the menu while they live inline).
// ---------------------------------------------------------------------------

export type ControlHome = "inline" | "menu";

// The canonical home of every view-settings control that this IA governs.
// Filter / Sort / Group-By are the de-duped trio — their single home is INLINE
// (the toolbar), so they are intentionally ABSENT from the 3-knobs menu when
// the flag is ON. Search is inline-only (the magnifier toggle). Limit and
// Display Property (bd Notidian-4qjx.6, owner-ratified 2026-07-20 via gate
// Notidian-4qjx.12) are the next promoted pair — high-frequency, clear active
// state, one control home. The remaining controls are overflow settings whose
// single home is the 3-knobs menu; do not extend the inline set without a new
// owner ruling.
//
// This manifest is the source of truth for the de-dup test; FilterBar's render
// + menu construction must match it on the ON branch.
export const VIEW_SETTINGS_CONTROL_HOME: Record<string, ControlHome> = {
  // De-duped inline trio (Notidian-nmr group-by + Notidian-ddk filter/sort,
  // finalized inline-only here).
  filter: "inline",
  sort: "inline",
  groupBy: "inline",
  // Inline-only search (ADR 0041 single view search).
  search: "inline",
  layout: "inline",
  // Promoted inline pair (bd Notidian-4qjx.6): each keeps exactly one home
  // (inline) and falls back to its sole overflow-menu home when the
  // `viewSettingsInlineBar` kill-switch is OFF (see FilterBar.tsx).
  limit: "inline",
  displayProperty: "inline",
  // Overflow settings whose single home is the 3-knobs menu.
  properties: "menu",
  chart: "menu",
  subItems: "menu",
  importCsv: "menu",
  exportCsv: "menu",
  tableDirection: "menu",
  source: "menu",
  list: "menu",
  itemProperties: "menu",
};

// The inline-home control ids, in canonical bar order.
export const inlineHomeControls = (): string[] =>
  Object.entries(VIEW_SETTINGS_CONTROL_HOME)
    .filter(([, home]) => home === "inline")
    .map(([id]) => id);

// The menu-home control ids.
export const menuHomeControls = (): string[] =>
  Object.entries(VIEW_SETTINGS_CONTROL_HOME)
    .filter(([, home]) => home === "menu")
    .map(([id]) => id);

// The single-home invariant check. Given the set of control ids the render
// currently surfaces INLINE and the set it surfaces IN the 3-knobs MENU, return
// the ids that violate single-home (appear in BOTH). An empty array means the
// de-dup holds: every control has exactly one home. Pure + total.
export const findDuplicatedControls = (
  inlineIds: Iterable<string>,
  menuIds: Iterable<string>
): string[] => {
  const inline = new Set(inlineIds);
  const duplicated: string[] = [];
  const seen = new Set<string>();
  for (const id of menuIds) {
    if (inline.has(id) && !seen.has(id)) {
      seen.add(id);
      duplicated.push(id);
    }
  }
  return duplicated;
};

// True iff no control appears in both homes (the de-dup invariant holds).
export const hasSingleHomePerControl = (
  inlineIds: Iterable<string>,
  menuIds: Iterable<string>
): boolean => findDuplicatedControls(inlineIds, menuIds).length === 0;
