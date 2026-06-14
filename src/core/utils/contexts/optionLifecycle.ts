import { safelyParseJSON } from "shared/utils/json";

// Lifecycle progression for ordered single-select option columns (Notidian-ucd).
// A select column's options array order IS its lifecycle order — the same order
// the option sort (predicate/sort.ts optionSort) and the picker already honor
// (e.g. wishlist -> evaluating -> to-install -> using -> retired). These pure
// helpers step a row's current value one position along that order so a status
// can progress with a single keystroke instead of reopening the picker. The
// caller supplies the column's stored option config + the current value and
// routes the result through the normal authority-aware write path.

export type LifecycleDirection = "next" | "previous";

// The ordered option *values* declared on a select column, parsed from its
// stored config ({ options: [{ value, ... }] }). Deduped, blanks dropped, order
// preserved. Empty when the column has no static options (e.g. a source-backed
// column whose options resolve from another context) — progression is a no-op
// there, by design.
export const lifecycleValuesFromColumnValue = (value: unknown): string[] => {
  const parsed = safelyParseJSON(typeof value == "string" ? value : "");
  const options = Array.isArray(parsed?.options) ? parsed.options : [];
  const out: string[] = [];
  for (const opt of options) {
    const raw = opt?.value;
    if (raw == null) continue;
    const v = String(raw);
    if (v.length > 0 && !out.includes(v)) out.push(v);
  }
  return out;
};

// Step a single-select value one position along the lifecycle order. Returns the
// new value, or null when there is nothing to do (no options, or already at the
// relevant end without wrap). Rules:
//  - current empty or not in the list: a forward step enters at the first state,
//    a backward step at the last — so an unset row can join the lifecycle.
//  - at the last state stepping forward (or the first stepping backward): clamp
//    by default (return null = no change). A lifecycle rarely wants a silent
//    retired -> wishlist roll-around, so clamp is the default; pass wrap:true to
//    cycle.
export const stepLifecycleValue = (params: {
  values: string[];
  current: string;
  direction: LifecycleDirection;
  wrap?: boolean;
}): string | null => {
  const { values, current, direction, wrap = false } = params;
  if (values.length == 0) return null;
  const delta = direction == "next" ? 1 : -1;
  const index = values.indexOf(current);
  if (index == -1) {
    // Not currently in the lifecycle: enter at the appropriate end.
    const entry = direction == "next" ? values[0] : values[values.length - 1];
    return entry == current ? null : entry;
  }
  let nextIndex = index + delta;
  if (nextIndex < 0 || nextIndex >= values.length) {
    if (!wrap) return null;
    nextIndex = (nextIndex + values.length) % values.length;
  }
  const next = values[nextIndex];
  return next == current ? null : next;
};
