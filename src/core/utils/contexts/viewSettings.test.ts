import { Predicate } from "shared/types/predicate";
import {
  deriveInlineControlActiveState,
  isInlineControlActive,
  findDuplicatedControls,
  hasSingleHomePerControl,
  inlineHomeControls,
  menuHomeControls,
  VIEW_SETTINGS_CONTROL_HOME,
} from "./viewSettings";

// Offline coverage for the view-settings IA decision logic (bd Notidian-vrmf):
//   (1) active-state derivation: predicate (+ search flag) -> per-control active
//       flag, the single source of truth for the inline `mk-active` indicator;
//   (2) single-home invariant: no control appears both inline AND in the
//       3-knobs menu (the de-dup decision).
// Both halves ship behind the default-ON kill-switch `viewSettingsInlineBar`;
// the render wiring is covered by FilterBar.viewSettings.dom.test.tsx.

const predicate = (over: Partial<Predicate>): Partial<Predicate> => ({
  filters: [],
  sort: [],
  groupBy: [],
  ...over,
});

const aFilter = { field: "Status", fn: "is", value: "Done", fType: "text" };
const aSort = { field: "Status", fn: "asc" };

describe("deriveInlineControlActiveState (active-state derivation)", () => {
  it("all-false for an empty predicate and inactive search", () => {
    expect(deriveInlineControlActiveState(predicate({}), false)).toEqual({
      filter: false,
      sort: false,
      groupBy: false,
      search: false,
      limit: false,
      displayProperty: false,
    });
  });

  it("lights limit exactly when a positive limit is set (bd Notidian-4qjx.6)", () => {
    expect(
      deriveInlineControlActiveState(predicate({ limit: 25 }), false).limit
    ).toBe(true);
    expect(
      deriveInlineControlActiveState(predicate({ limit: 0 }), false).limit
    ).toBe(false);
    expect(
      deriveInlineControlActiveState(predicate({}), false).limit
    ).toBe(false);
  });

  it("lights displayProperty exactly when listViewProps.displayProperty is a non-empty string (bd Notidian-4qjx.6)", () => {
    expect(
      deriveInlineControlActiveState(
        predicate({ listViewProps: { displayProperty: "Status" } }),
        false
      ).displayProperty
    ).toBe(true);
    expect(
      deriveInlineControlActiveState(
        predicate({ listViewProps: { displayProperty: "" } }),
        false
      ).displayProperty
    ).toBe(false);
    expect(
      deriveInlineControlActiveState(predicate({}), false).displayProperty
    ).toBe(false);
  });

  it("lights filter exactly when filters is non-empty", () => {
    expect(
      deriveInlineControlActiveState(predicate({ filters: [aFilter] }), false)
        .filter
    ).toBe(true);
    expect(
      deriveInlineControlActiveState(predicate({ filters: [] }), false).filter
    ).toBe(false);
  });

  it("lights sort exactly when sort is non-empty", () => {
    expect(
      deriveInlineControlActiveState(predicate({ sort: [aSort] }), false).sort
    ).toBe(true);
    expect(
      deriveInlineControlActiveState(predicate({ sort: [] }), false).sort
    ).toBe(false);
  });

  it("lights groupBy exactly when groupBy is non-empty", () => {
    expect(
      deriveInlineControlActiveState(predicate({ groupBy: ["Status"] }), false)
        .groupBy
    ).toBe(true);
    expect(
      deriveInlineControlActiveState(predicate({ groupBy: [] }), false).groupBy
    ).toBe(false);
  });

  it("lights search from the transient flag, independent of the predicate", () => {
    expect(deriveInlineControlActiveState(predicate({}), true).search).toBe(
      true
    );
    expect(deriveInlineControlActiveState(predicate({}), false).search).toBe(
      false
    );
  });

  it("derives every control independently when several are applied", () => {
    expect(
      deriveInlineControlActiveState(
        predicate({
          filters: [aFilter],
          groupBy: ["Status"],
          limit: 10,
          listViewProps: { displayProperty: "Status" },
        }),
        true
      )
    ).toEqual({
      filter: true,
      sort: false,
      groupBy: true,
      search: true,
      limit: true,
      displayProperty: true,
    });
  });

  it("is pure + total: null/undefined/partial predicate yields all-false, never throws", () => {
    expect(deriveInlineControlActiveState(null, false)).toEqual({
      filter: false,
      sort: false,
      groupBy: false,
      search: false,
      limit: false,
      displayProperty: false,
    });
    expect(deriveInlineControlActiveState(undefined, undefined)).toEqual({
      filter: false,
      sort: false,
      groupBy: false,
      search: false,
      limit: false,
      displayProperty: false,
    });
    // A predicate missing the arrays entirely must not throw.
    expect(() =>
      deriveInlineControlActiveState({} as Partial<Predicate>, null)
    ).not.toThrow();
    expect(deriveInlineControlActiveState({} as Partial<Predicate>, null)).toEqual(
      {
        filter: false,
        sort: false,
        groupBy: false,
        search: false,
        limit: false,
        displayProperty: false,
      }
    );
  });

  it("treats only `true` as active search (no truthy coercion of non-booleans)", () => {
    // Guards against passing a non-boolean and getting a surprise active light.
    expect(
      deriveInlineControlActiveState(predicate({}), "yes" as any).search
    ).toBe(false);
  });
});

describe("isInlineControlActive (single-control accessor)", () => {
  it("matches the corresponding field of the full state", () => {
    const p = predicate({
      filters: [aFilter],
      sort: [aSort],
      limit: 25,
      listViewProps: { displayProperty: "Status" },
    });
    const full = deriveInlineControlActiveState(p, true);
    for (const id of [
      "filter",
      "sort",
      "groupBy",
      "search",
      "limit",
      "displayProperty",
    ] as const) {
      expect(isInlineControlActive(id, p, true)).toBe(full[id]);
    }
  });
});

describe("single-home invariant (de-dup decision)", () => {
  it("the de-duped trio (filter/sort/groupBy) is inline, NOT in the menu", () => {
    expect(VIEW_SETTINGS_CONTROL_HOME.filter).toBe("inline");
    expect(VIEW_SETTINGS_CONTROL_HOME.sort).toBe("inline");
    expect(VIEW_SETTINGS_CONTROL_HOME.groupBy).toBe("inline");
  });

  // Owner ratification 2026-07-20 (gate Notidian-4qjx.12): promote exactly
  // Limit and Display Property inline; every other view setting stays in the
  // overflow menu (bd Notidian-4qjx.6).
  it("Limit and Display Property are promoted inline, NOT in the menu", () => {
    expect(VIEW_SETTINGS_CONTROL_HOME.limit).toBe("inline");
    expect(VIEW_SETTINGS_CONTROL_HOME.displayProperty).toBe("inline");
  });

  it("overflow settings (properties/source/etc.) live in the menu", () => {
    for (const id of [
      "properties",
      "chart",
      "subItems",
      "tableDirection",
      "source",
      "list",
    ]) {
      expect(VIEW_SETTINGS_CONTROL_HOME[id]).toBe("menu");
    }
  });

  it("inline and menu homes partition the controls with no overlap", () => {
    const inline = new Set(inlineHomeControls());
    const menu = new Set(menuHomeControls());
    for (const id of inline) expect(menu.has(id)).toBe(false);
    for (const id of menu) expect(inline.has(id)).toBe(false);
    // Together they cover the whole manifest (partition, not a subset).
    expect(inline.size + menu.size).toBe(
      Object.keys(VIEW_SETTINGS_CONTROL_HOME).length
    );
  });

  it("findDuplicatedControls returns the controls present in BOTH homes", () => {
    // The de-dup regression we guard against: Filter/Sort re-listed in the
    // menu while still inline.
    expect(
      findDuplicatedControls(["filter", "sort", "groupBy"], ["filter", "sort"])
    ).toEqual(["filter", "sort"]);
  });

  it("findDuplicatedControls is empty when homes are disjoint (invariant holds)", () => {
    expect(
      findDuplicatedControls(
        ["filter", "sort", "groupBy"],
        ["properties", "limit", "source"]
      )
    ).toEqual([]);
    expect(
      hasSingleHomePerControl(
        inlineHomeControls(),
        menuHomeControls()
      )
    ).toBe(true);
  });

  it("dedupes repeated ids in the menu list (reports each duplicate once)", () => {
    expect(
      findDuplicatedControls(["filter"], ["filter", "filter"])
    ).toEqual(["filter"]);
  });

  it("hasSingleHomePerControl is false when any control is in both homes", () => {
    expect(hasSingleHomePerControl(["filter"], ["filter"])).toBe(false);
  });
});
