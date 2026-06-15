// Collapsed-state model for the space note body region (Notidian-8sl).
//
// The "page" (folder/hub note body) that renders above a space's database can be
// (a) collapsible and (b) shrink-to-fit when expanded. Both behaviors ship behind
// a single default-OFF setting (`collapsibleNoteBody`) so the owner's current
// vault renders byte-identically until the flag is enabled and live-verified
// (this is a core render-path change that cannot be proven by tsc/jest/build —
// see docs/AUTONOMOUS-REVIEW-QUEUE.md / AGENTS.md "Autonomous Implementation
// Mode").
//
// WHY A SEPARATE PURE MODULE: the collapse decision (is the feature active? is
// the region currently collapsed? what value do we persist when the chevron is
// toggled?) is the offline-verifiable half (Q1). Keeping it as a pure, DOM-free
// function makes it directly unit-testable and keeps the React component a thin
// shell around a proven core.
//
// AUTHORITY (ADR 0001/0014/0017): `noteBodyCollapsed` is per-space *view state*,
// not row data. Its correct home is the space metadata (SpaceDefinition), saved
// via saveSpaceMetadataValue(superstate, path, "noteBodyCollapsed", v) — there is
// NO durable-MDB ownership and therefore NO `source: "notidian"` requirement.

import { SpaceDefinition } from "shared/types/spaceDef";

/**
 * Is the collapsible/shrink-to-fit note body behavior active?
 *
 * It is active only when BOTH the global setting is on AND there is a space to
 * carry per-space view state. When inactive, the component must render exactly
 * as it did before this feature (no header, no chevron, no shrink class) so the
 * default (flag-OFF) view is byte-identical.
 */
export const isCollapsibleNoteBodyEnabled = (
  settingEnabled: boolean | undefined,
  hasSpace: boolean
): boolean => Boolean(settingEnabled) && hasSpace;

/**
 * Resolve the persisted collapsed state for a space's note body.
 *
 * Default is EXPANDED (`false`): turning the feature on must not hide existing
 * note bodies — it only adds the ability to collapse them. `undefined`/missing
 * metadata (a space that never toggled) resolves to expanded.
 */
export const resolveNoteBodyCollapsed = (
  metadata: SpaceDefinition | null | undefined
): boolean => Boolean(metadata?.noteBodyCollapsed);

/**
 * The value to persist when the chevron is toggled.
 *
 * `collapsed` is the UICollapse contract's "next collapsed state". We normalize
 * to a strict boolean so the persisted SpaceDefinition value is always `true`/
 * `false` (never `undefined`), keeping the metadata roundtrip stable.
 */
export const nextNoteBodyCollapsed = (collapsed: boolean): boolean =>
  Boolean(collapsed);

/**
 * Should the NoteView (the actual note content) be rendered right now?
 *
 * - Feature inactive  → always render (legacy behavior, unchanged).
 * - Feature active    → render only when NOT collapsed.
 *
 * This is the single predicate the component uses to decide whether to mount the
 * note editor, so collapse genuinely unmounts the content rather than merely
 * hiding it.
 */
export const shouldRenderNoteContent = (
  active: boolean,
  collapsed: boolean
): boolean => (active ? !collapsed : true);
