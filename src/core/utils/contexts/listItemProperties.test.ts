import { defaultPredicate } from "shared/schemas/predicate";
import { SpaceTableColumn } from "shared/types/mdb";
import { Predicate } from "shared/types/predicate";
import { DEFAULT_SETTINGS } from "core/schemas/settings";
import { validatePredicate } from "core/utils/contexts/predicate/predicate";
import {
  applyListItemVisibleProperties,
  listItemFrameId,
  listItemPropertyKey,
  listItemPropsToMenuState,
  listItemVisibleProperties,
  menuStateToVisibleProperties,
  shouldShowListItemPropertyPicker,
} from "./listItemProperties";

// ---------------------------------------------------------------------------
// bd Notidian-543 — list-view per-item display-property picker (flag-gated Q3).
// These cover the PURE, offline-provable half of the feature: the model
// reader/normalizer, the flag-gated render chokepoint (incl. the byte-identity
// guarantee when the flag is OFF), the menu adapter round-trip, and predicate
// persistence through validation. The frame-render half (eyes-on in the vault)
// is queued in docs/AUTONOMOUS-REVIEW-QUEUE.md.
// ---------------------------------------------------------------------------

const col = (
  name: string,
  extra: Partial<SpaceTableColumn> = {}
): SpaceTableColumn => ({
  name,
  type: "text",
  ...extra,
});

const primary = (name: string): SpaceTableColumn =>
  col(name, { primary: "true" });

const withVisible = (visibleProperties: unknown): Partial<Predicate> => ({
  listItemProps: { visibleProperties } as any,
});

describe("listItemPropertyKey", () => {
  it("keys by name + table, treating absent table as empty string", () => {
    expect(listItemPropertyKey({ name: "Status" })).toBe("Status");
    expect(listItemPropertyKey({ name: "Status", table: "" })).toBe("Status");
    expect(listItemPropertyKey({ name: "Status", table: "tasks" })).toBe(
      "Statustasks"
    );
  });
});

describe("listItemVisibleProperties (model reader/normalizer)", () => {
  it("returns null when unset, not an array, or empty", () => {
    expect(listItemVisibleProperties(null)).toBeNull();
    expect(listItemVisibleProperties(undefined)).toBeNull();
    expect(listItemVisibleProperties({})).toBeNull();
    expect(listItemVisibleProperties({ listItemProps: {} })).toBeNull();
    expect(listItemVisibleProperties(withVisible(undefined))).toBeNull();
    expect(listItemVisibleProperties(withVisible("Status"))).toBeNull();
    expect(listItemVisibleProperties(withVisible([]))).toBeNull();
  });

  it("returns the allowlist, dropping non-strings, empties, and duplicates", () => {
    expect(
      listItemVisibleProperties(
        withVisible(["Status", "", "Status", 3, null, "Due"])
      )
    ).toEqual(["Status", "Due"]);
  });

  it("preserves the configured order", () => {
    expect(
      listItemVisibleProperties(withVisible(["Due", "Status", "Owner"]))
    ).toEqual(["Due", "Status", "Owner"]);
  });
});

describe("applyListItemVisibleProperties (flag-gated render chokepoint)", () => {
  const cols = [
    primary("Name"),
    col("Status"),
    col("Due"),
    col("Owner"),
  ];

  it("FLAG OFF: returns the SAME array reference unchanged (byte-identity)", () => {
    // This is the core safety guarantee: with the default-OFF flag, the
    // per-item field set is untouched no matter what the predicate stores.
    expect(
      applyListItemVisibleProperties(cols, withVisible(["Status"]), false)
    ).toBe(cols);
    expect(
      applyListItemVisibleProperties(cols, withVisible(["Status"]), false)
    ).toEqual(cols);
  });

  it("FLAG ON, no allowlist: returns the input unchanged", () => {
    expect(applyListItemVisibleProperties(cols, {}, true)).toBe(cols);
    expect(applyListItemVisibleProperties(cols, withVisible([]), true)).toBe(
      cols
    );
    expect(applyListItemVisibleProperties(cols, null, true)).toBe(cols);
  });

  it("FLAG ON with allowlist: keeps only allowed columns, in allowlist order", () => {
    const result = applyListItemVisibleProperties(
      cols,
      withVisible(["Due", "Status"]),
      true
    );
    expect(result.map((f) => f.name)).toEqual(["Due", "Status"]);
  });

  it("FLAG ON: skips allowlist keys that no longer resolve to a column", () => {
    const result = applyListItemVisibleProperties(
      cols,
      withVisible(["Status", "Deleted", "Owner"]),
      true
    );
    expect(result.map((f) => f.name)).toEqual(["Status", "Owner"]);
  });

  it("FLAG ON: keys are name+table, so context-table columns do not collide", () => {
    const mixed = [
      col("Status"),
      col("Status", { table: "tasks" }),
    ];
    const result = applyListItemVisibleProperties(
      mixed,
      withVisible(["Statustasks"]),
      true
    );
    expect(result).toHaveLength(1);
    expect(result[0].table).toBe("tasks");
  });

  it("FLAG ON: falls back to the full set if the allowlist matches nothing visible", () => {
    // Never render an item with zero properties (e.g. every chosen property was
    // deleted/renamed) — degrade to today's behavior instead.
    expect(
      applyListItemVisibleProperties(cols, withVisible(["Gone", "AlsoGone"]), true)
    ).toBe(cols);
  });

  it("never mutates the input array", () => {
    const input = [...cols];
    applyListItemVisibleProperties(input, withVisible(["Due"]), true);
    expect(input.map((f) => f.name)).toEqual([
      "Name",
      "Status",
      "Due",
      "Owner",
    ]);
  });
});

describe("menu adapter round-trip (listItemPropsToMenuState / menuStateToVisibleProperties)", () => {
  const cols = [primary("Name"), col("Status"), col("Due"), col("Owner")];

  it("unconfigured: menu shows everything (nothing hidden, no order)", () => {
    const state = listItemPropsToMenuState(cols, {});
    expect(state.colsHidden).toEqual([]);
    expect(state.colsOrder).toEqual([]);
  });

  it("configured: hides pickable columns NOT in the allowlist, orders by allowlist", () => {
    const state = listItemPropsToMenuState(cols, withVisible(["Due", "Status"]));
    // Owner is the only pickable column not allowed; Name is primary (excluded).
    expect(state.colsHidden).toEqual(["Owner"]);
    expect(state.colsOrder).toEqual(["Due", "Status"]);
  });

  it("menuStateToVisibleProperties: allowlist = shown (not hidden), ordered by colsOrder then natural", () => {
    expect(
      menuStateToVisibleProperties(cols, {
        colsHidden: ["Owner"],
        colsOrder: ["Due", "Status"],
      })
    ).toEqual(["Due", "Status"]);
  });

  it("menuStateToVisibleProperties: trailing shown keys not in colsOrder keep natural order", () => {
    expect(
      menuStateToVisibleProperties(cols, {
        colsHidden: [],
        colsOrder: ["Due"],
      })
    ).toEqual(["Due", "Status", "Owner"]);
  });

  it("menuStateToVisibleProperties: never includes the primary column", () => {
    expect(
      menuStateToVisibleProperties(cols, { colsHidden: [], colsOrder: [] })
    ).not.toContain("Name");
  });

  it("round-trips a configured allowlist through the menu state and back", () => {
    const allow = ["Due", "Owner"];
    const state = listItemPropsToMenuState(cols, withVisible(allow));
    const back = menuStateToVisibleProperties(cols, state);
    expect(back).toEqual(allow);
  });

  it("hiding everything in the menu yields an empty allowlist", () => {
    // An empty allowlist persists; the reader then treats it as 'unconfigured'
    // so the render still shows all (never a zero-property item).
    const state = {
      colsHidden: ["Status", "Due", "Owner"],
      colsOrder: [] as string[],
    };
    expect(menuStateToVisibleProperties(cols, state)).toEqual([]);
    expect(
      listItemVisibleProperties(withVisible(menuStateToVisibleProperties(cols, state)))
    ).toBeNull();
  });
});

describe("flag gating (default-ON, kill-switch retained)", () => {
  it("listItemPropertyPicker now defaults to true (owner-requested feature is live)", () => {
    // bd Notidian-543: this owner-requested feature ships default-ON; the owner
    // verifies it by USE. The flag is retained purely as a kill-switch.
    expect(DEFAULT_SETTINGS.listItemPropertyPicker).toBe(true);
  });

  it("with the default setting ON, a configured allowlist filters the field set", () => {
    // Default-ON means the chokepoint honors a configured allowlist out of the
    // box — the feature is reachable without the owner toggling anything.
    const cols = [primary("Name"), col("Status"), col("Due")];
    expect(
      applyListItemVisibleProperties(
        cols,
        withVisible(["Status"]),
        DEFAULT_SETTINGS.listItemPropertyPicker === true
      )
    ).toEqual([col("Status")]);
  });

  it("the kill-switch (OFF) byte-restores legacy behavior, ignoring any allowlist", () => {
    // The retained flag is a TRUE kill-switch: with it OFF the chokepoint returns
    // the SAME array reference regardless of any stored visibleProperties, so the
    // per-item field set is byte-for-byte today's (no filtering whatsoever).
    const cols = [primary("Name"), col("Status"), col("Due")];
    const killSwitchOff = false;
    expect(
      applyListItemVisibleProperties(cols, withVisible(["Status"]), killSwitchOff)
    ).toBe(cols);
    // Even a fully-specified, valid allowlist is inert when the switch is OFF.
    expect(
      applyListItemVisibleProperties(
        cols,
        withVisible(["Status", "Due"]),
        killSwitchOff
      )
    ).toBe(cols);
  });

  // Notidian-r6oj added per-row Remove-property + reachable New-property +
  // one-click Add-all to the Item Properties MENU. Those affordances operate on
  // the DATABASE (column existence) and the new-property window — NOT on this
  // flag-gated render chokepoint. This pin documents that the render chokepoint
  // is byte-unchanged by that work: the OFF path returns the same array ref and
  // the ON path's allowlist filtering is exactly as before.
  it("render chokepoint is byte-unchanged by the menu enhancements (Notidian-r6oj)", () => {
    const cols = [primary("Name"), col("Status"), col("Due")];
    // OFF: same array reference (legacy behavior preserved).
    expect(
      applyListItemVisibleProperties(cols, withVisible(["Status"]), false)
    ).toBe(cols);
    // ON: allowlist filtering unchanged (keeps only allowlisted, in order).
    expect(
      applyListItemVisibleProperties(
        cols,
        withVisible(["Status"]),
        true
      ).map((c) => c.name)
    ).toEqual(["Status"]);
  });
});

describe("predicate persistence (round-trip through validatePredicate)", () => {
  it("survives validation on save and JSON load", () => {
    const validated = validatePredicate(
      {
        ...defaultPredicate,
        listItemProps: { visibleProperties: ["Status", "Due"] },
      } as Predicate,
      defaultPredicate
    );
    expect(validated.listItemProps.visibleProperties).toEqual([
      "Status",
      "Due",
    ]);

    const roundTripped = validatePredicate(
      JSON.parse(JSON.stringify(validated)),
      defaultPredicate
    );
    expect(listItemVisibleProperties(roundTripped)).toEqual(["Status", "Due"]);
  });

  it("stays absent for predicates that never set it", () => {
    const validated = validatePredicate(defaultPredicate, defaultPredicate);
    expect(listItemVisibleProperties(validated)).toBeNull();
  });

  it("does NOT touch row data — visibleProperties lives only in listItemProps", () => {
    const validated = validatePredicate(
      {
        ...defaultPredicate,
        listItemProps: { visibleProperties: ["Status"] },
      } as Predicate,
      defaultPredicate
    );
    // The allowlist must never leak into colsHidden/colsOrder (table column
    // visibility) — it is per-item view config, a separate concern.
    expect(validated.colsHidden).toEqual([]);
    expect(validated.colsOrder).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// bd Notidian-sxs1 — menu-trigger view-gate. The picker is surfaced on every
// fieldsView-based layout that renders the full `_properties` array (Cards,
// Board, Details), keyed on the active `listItem` frame, NOT `predicate.view`
// (every fieldsView layout shares view=="list"). It is correctly hidden where
// it would be a dead control (plain list/cover/image/flow, and non-list modes).
// ---------------------------------------------------------------------------

describe("listItemFrameId (frame-id extraction)", () => {
  it("extracts the trailing id from a kit URI", () => {
    expect(listItemFrameId("spaces://$kit/#*cardListItem")).toBe("cardListItem");
    expect(listItemFrameId("spaces://$kit/#*detailItem")).toBe("detailItem");
    expect(listItemFrameId("spaces://$kit/#*cardsListItem")).toBe(
      "cardsListItem"
    );
  });

  it("accepts a bare frame id", () => {
    expect(listItemFrameId("cardListItem")).toBe("cardListItem");
  });

  it("defaults nullish/empty to the plain list frame (rowItem)", () => {
    expect(listItemFrameId("")).toBe("rowItem");
    expect(listItemFrameId(null)).toBe("rowItem");
    expect(listItemFrameId(undefined)).toBe("rowItem");
  });

  it("is total on a path-shaped value with no kit anchor", () => {
    expect(listItemFrameId("a/b/detailItem")).toBe("detailItem");
  });
});

describe("shouldShowListItemPropertyPicker (menu-trigger gate)", () => {
  const listPredicate = (
    listItem: string
  ): Partial<Predicate> => ({ view: "list", listItem });

  it("shows on the three fieldsView layouts (Cards / Board / Details)", () => {
    for (const frame of [
      "spaces://$kit/#*cardsListItem", // Cards
      "spaces://$kit/#*cardListItem", // Board
      "spaces://$kit/#*detailItem", // Details
    ]) {
      expect(shouldShowListItemPropertyPicker(listPredicate(frame))).toBe(true);
    }
  });

  it("hides on layouts that render specific named fields (no-op picker)", () => {
    for (const frame of [
      "spaces://$kit/#*rowItem", // plain list (previewField/subtitle/prefix)
      "spaces://$kit/#*coverListItem",
      "spaces://$kit/#*imageListItem",
      "spaces://$kit/#*flowListItem",
      "spaces://$kit/#*overviewItem",
    ]) {
      expect(shouldShowListItemPropertyPicker(listPredicate(frame))).toBe(false);
    }
  });

  it("hides for a default/unconfigured predicate (defaults to plain rowItem)", () => {
    // defaultPredicate is view=="list", listItem=="" => rowItem => not eligible.
    expect(shouldShowListItemPropertyPicker(defaultPredicate)).toBe(false);
    expect(
      shouldShowListItemPropertyPicker({ view: "list", listItem: "" })
    ).toBe(false);
  });

  it("hides for non-list render modes regardless of frame", () => {
    for (const view of ["table", "day", "week", "month"]) {
      expect(
        shouldShowListItemPropertyPicker({
          view,
          listItem: "spaces://$kit/#*cardListItem",
        })
      ).toBe(false);
    }
  });

  it("is total on nullish / partial predicates", () => {
    expect(shouldShowListItemPropertyPicker(null)).toBe(false);
    expect(shouldShowListItemPropertyPicker(undefined)).toBe(false);
    expect(shouldShowListItemPropertyPicker({})).toBe(false);
    expect(shouldShowListItemPropertyPicker({ view: "list" })).toBe(false);
  });
});
