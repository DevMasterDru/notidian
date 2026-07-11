import { Filter } from "shared/types/predicate";

export type ResolveOverlayFiltersArgs = {
  // The persisted view's own filters (predicate.filters). May be null/undefined
  // for a view with no filter config.
  base: Filter[] | undefined | null;
  // The render-path overlay filters (e.g. from a notidian embed `where:` block
  // or a frame node's predicate prop). READ-PATH ONLY.
  overlay: Filter[] | undefined | null;
  // The renderPathViewOverlays kill-switch. When false the overlay is dropped
  // entirely and the base is returned unchanged (exact legacy behavior).
  enabled: boolean;
};

// Conjunctive (AND) read-path merge of a declared-view overlay onto a view's
// persisted filters (ADR-0066 v1 view mechanism / Notidian-ioxi).
//
// The overlay clauses are appended AFTER the base clauses so the combined
// predicate evaluates as base AND overlay (makeRowMatchesFilters reduces the
// list with a logical AND, short-circuiting on the first miss).
//
// AUTHORITY INVARIANT (ADR-0066 Wave-3 write firewall): the returned array is
// for the READ path ONLY. When a merge actually happens it is a FRESH array
// (inputs are never mutated), and it must NEVER be fed back into
// savePredicate / saveSchema / frameSchema.predicate. When the flag is off, or
// there is no overlay to apply, the BASE reference is returned UNCHANGED so the
// row matcher and any downstream memoization stay byte-for-byte legacy.
export const resolveOverlayFilters = ({
  base,
  overlay,
  enabled,
}: ResolveOverlayFiltersArgs): Filter[] | undefined | null => {
  if (!enabled) return base;
  if (overlay == null || overlay.length == 0) return base;
  return [...(base ?? []), ...overlay];
};
