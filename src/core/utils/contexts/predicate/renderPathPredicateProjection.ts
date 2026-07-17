import { Predicate } from "shared/types/predicate";
import { resolveOverlayFilters } from "./overlayFilters";

export const applyRenderPathPredicateProjection = ({
  base,
  overlay,
  enabled,
}: {
  base: Predicate | null;
  overlay?: Partial<Predicate>;
  enabled: boolean;
}): Predicate | null => {
  if (!base || !enabled || !overlay || Object.keys(overlay).length == 0) {
    return base;
  }
  return {
    ...base,
    ...overlay,
    filters: resolveOverlayFilters({
      base: base.filters,
      overlay: overlay.filters,
      enabled: true,
    }) ?? [],
  };
};

export const stripRenderPathProjectionFromSave = ({
  candidate,
  overlay,
  enabled,
}: {
  candidate: Partial<Predicate>;
  overlay?: Partial<Predicate>;
  enabled: boolean;
}): Partial<Predicate> => {
  if (!enabled || !overlay || Object.keys(overlay).length == 0) return candidate;
  const native = { ...candidate };
  for (const key of Object.keys(overlay) as Array<keyof Predicate>) {
    if (key == "filters" && candidate.filters && overlay.filters) {
      const remainingOverlay = [...overlay.filters];
      native.filters = candidate.filters.filter((filter) => {
        const match = remainingOverlay.findIndex(
          (entry) =>
            entry.field == filter.field &&
            entry.fn == filter.fn &&
            entry.value == filter.value &&
            entry.fType == filter.fType
        );
        if (match < 0) return true;
        remainingOverlay.splice(match, 1);
        return false;
      });
      continue;
    }
    delete native[key];
  }
  return native;
};
