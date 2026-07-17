import { defaultTablePredicate } from "shared/schemas/predicate";
import { Predicate } from "shared/types/predicate";
import {
  applyRenderPathPredicateProjection,
  stripRenderPathProjectionFromSave,
} from "./renderPathPredicateProjection";

const base = (): Predicate => ({
  ...defaultTablePredicate,
  filters: [
    { field: "status", fn: "is", value: "open", fType: "text" },
  ],
  sort: [{ field: "created", fn: "latest" }],
  groupBy: ["team"],
  colsOrder: ["File", "team", "status", "created"],
  colsHidden: ["secret"],
  limit: 25,
});

const overlay = (): Partial<Predicate> => ({
  filters: [
    { field: "priority", fn: "is", value: "urgent", fType: "text" },
  ],
  sort: [{ field: "updated", fn: "latest" }],
  groupBy: ["status"],
  colsOrder: ["File", "status", "updated"],
  colsHidden: ["team", "created"],
  limit: 5,
  view: "list",
  listView: "spaces://$kit/#*listView",
  listGroup: "spaces://$kit/#*listGroup",
  listItem: "spaces://$kit/#*rowItem",
});

describe("render-path predicate projection", () => {
  it("conjoins filters and replaces every explicitly projected rich value", () => {
    const native = base();
    const projected = applyRenderPathPredicateProjection({
      base: native,
      overlay: overlay(),
      enabled: true,
    });

    expect(projected).toEqual({
      ...native,
      ...overlay(),
      filters: [...native.filters, ...(overlay().filters ?? [])],
    });
    expect(projected).not.toBe(native);
  });

  it("preserves every omitted base value", () => {
    const native = base();
    const projected = applyRenderPathPredicateProjection({
      base: native,
      overlay: { limit: 3 },
      enabled: true,
    });

    expect(projected.limit).toBe(3);
    expect(projected.sort).toBe(native.sort);
    expect(projected.groupBy).toBe(native.groupBy);
    expect(projected.colsOrder).toBe(native.colsOrder);
    expect(projected.view).toBe(native.view);
  });

  it("returns the native predicate by identity when disabled or absent", () => {
    const native = base();
    expect(
      applyRenderPathPredicateProjection({
        base: native,
        overlay: overlay(),
        enabled: false,
      })
    ).toBe(native);
    expect(
      applyRenderPathPredicateProjection({
        base: native,
        overlay: undefined,
        enabled: true,
      })
    ).toBe(native);
  });

  it("removes every overlay-owned key from a save payload", () => {
    const candidate: Partial<Predicate> = {
      filters: overlay().filters,
      sort: overlay().sort,
      groupBy: overlay().groupBy,
      colsOrder: overlay().colsOrder,
      colsHidden: overlay().colsHidden,
      limit: 99,
      view: "month",
      listView: "changed",
      listGroup: "changed",
      listItem: "changed",
      tableDirection: "rtl",
    };

    expect(
      stripRenderPathProjectionFromSave({
        candidate,
        overlay: overlay(),
        enabled: true,
      })
    ).toEqual({ filters: [], tableDirection: "rtl" });
    expect(
      stripRenderPathProjectionFromSave({
        candidate,
        overlay: overlay(),
        enabled: false,
      })
    ).toBe(candidate);
  });
});
