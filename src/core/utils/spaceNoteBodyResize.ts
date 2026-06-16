// Resize/scroll model for the space note body region (Notidian-egoh).
//
// Extends the collapsible note body (Notidian-8sl/xazq): in addition to
// collapse (binary hide) and the default shrink-to-fit, the user can drag a
// handle to give the region an explicit pixel height; once it has one, the body
// scrolls its content (overflow-y:auto) instead of pushing the database down at
// full content height.
//
// WHY A SEPARATE PURE MODULE (same rationale as spaceNoteBodyCollapse.ts): the
// height decision — clamp a dragged value, resolve the persisted height, decide
// auto-vs-fixed — is the offline-verifiable half. Keeping it DOM-free makes it
// directly unit-testable and keeps the React component a thin shell.
//
// AUTHORITY (ADR 0001/0014/0017): noteBodyHeight is per-space VIEW STATE, not row
// data — its home is the space metadata (SpaceDefinition), persisted via
// saveSpaceMetadataValue(superstate, path, "noteBodyHeight", v). No durable-MDB
// ownership, no source:"notidian".

import { SpaceDefinition } from "shared/types/spaceDef";

// Bounds for a dragged height. MIN keeps the handle reachable (the region can't
// be dragged to nothing — collapse is the way to fully hide it); MAX prevents an
// absurd value from a stray drag or a hand-edited frontmatter number.
export const MIN_NOTE_BODY_HEIGHT = 60;
export const MAX_NOTE_BODY_HEIGHT = 4000;

/**
 * Clamp a (possibly dirty) pixel height into [MIN, MAX] and round to an integer.
 * Non-finite input (NaN/Infinity) falls back to MIN rather than producing an
 * invalid style value.
 */
export const clampNoteBodyHeight = (px: number): number => {
  if (!Number.isFinite(px)) return MIN_NOTE_BODY_HEIGHT;
  return Math.min(
    MAX_NOTE_BODY_HEIGHT,
    Math.max(MIN_NOTE_BODY_HEIGHT, Math.round(px))
  );
};

/**
 * Resolve the effective fixed height for a space's note body.
 *
 * Returns `null` when there is no persisted height — meaning shrink-to-fit
 * (auto), the default established by Notidian-xazq. A persisted number is
 * clamped on read so an out-of-range hand-edited value still yields a sane,
 * scrollable height rather than a broken layout.
 */
export const resolveNoteBodyHeight = (
  metadata: SpaceDefinition | null | undefined
): number | null => {
  const h = metadata?.noteBodyHeight;
  if (h == null || !Number.isFinite(h)) return null;
  return clampNoteBodyHeight(h);
};

/**
 * Compute the new height during a drag: the body's height when the drag started
 * plus the pointer's vertical delta, clamped. Pure arithmetic so the drag math
 * is unit-tested without a DOM.
 */
export const nextNoteBodyHeightFromDrag = (
  startHeight: number,
  deltaY: number
): number => clampNoteBodyHeight(startHeight + deltaY);
