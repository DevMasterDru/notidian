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
//
// DURABILITY: the value is written to the canonical space-definition frontmatter
// (via spaceDefinitionFrontmatter, the single serializer saveSpace uses) and read
// back by parseSpaceMetadata, so it survives reload — not just in-memory. An
// earlier revision dropped it from both the write allowlist and the parser; the
// real serialize->parse round-trip is now covered in the test file.

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
 * Should the NoteView (the actual note content) be MOUNTED in the DOM right now?
 *
 * - Feature inactive              → always mount (legacy behavior, unchanged).
 * - Active, expanded              → mount (the note is shown normally).
 * - Active, collapsed, FULL       → do NOT mount (genuine unmount → zero note
 *                                   nodes → true "database-only" view). DEFAULT.
 * - Active, collapsed, kill-switch → mount but hidden (see `isNoteBodyHidden`);
 *                                   the OFF fallback keeps the editor alive.
 *
 * `fullCollapse` (Notidian-50hn, settings.spaceNoteBodyFullCollapse, default ON)
 * is the owner-directed contract: collapsing the folder note must hide 100% of
 * its text — no callout/heading/dataview remnant. The default UNMOUNTS the whole
 * subtree so nothing can leak. The kill-switch (OFF) reverts to a non-destructive
 * keep-mounted-then-CSS-hide, for the case where a live remount ever misbehaves.
 * It defaults to `true` so any 2-arg caller (and a pre-upgrade data.json that
 * lacks the key) gets the full-collapse contract.
 */
export const shouldRenderNoteContent = (
  active: boolean,
  collapsed: boolean,
  fullCollapse = true
): boolean => {
  if (!active) return true;
  if (!collapsed) return true;
  // Collapsed: full-collapse unmounts; kill-switch keeps it mounted (hidden).
  return !fullCollapse;
};

/**
 * Is the note body MOUNTED-BUT-HIDDEN (the kill-switch collapsed state)?
 *
 * True only when the feature is active, the note is collapsed, and full-collapse
 * is OFF: the body div is rendered (`shouldRenderNoteContent` → true) but must be
 * visually hidden via CSS (`.mk-space-note-body--hidden`). In the default
 * (full-collapse ON) path the body is never mounted while collapsed, so this is
 * false and no CSS hide is needed — the DOM is byte-identical to the pre-50hn
 * collapsed markup (header only). This predicate is the single source of truth
 * for the `--hidden` class so the component stays a thin shell over a proven core.
 */
export const isNoteBodyHidden = (
  active: boolean,
  collapsed: boolean,
  fullCollapse = true
): boolean => active && collapsed && !fullCollapse;

/**
 * Resolve the full-collapse setting to a strict boolean.
 *
 * `undefined` (pre-upgrade data.json) and any non-`false` value resolve to the
 * DEFAULT (full collapse ON) — only an explicit `false` engages the kill-switch.
 * This mirrors how the runtime read must never silently drop to the destructive-
 * -disabled state just because the key is absent from an older settings file.
 */
export const resolveNoteBodyFullCollapse = (
  settingEnabled: boolean | undefined
): boolean => settingEnabled !== false;
