/**
 * @jest-environment jsdom
 */
// Offline (jsdom) coverage for the view-settings inline-bar IA (bd Notidian-vrmf),
// the core render-path half that tsc/jest-unit can't reach. It proves:
//   (1) INLINE EXPOSURE + ACTIVE-STATE: the Filter/Sort/Group-By trio renders
//       inline beside the 3-knobs button, each carrying a per-control active
//       indicator (data-mk-active + mk-active) derived from the predicate;
//   (2) DE-DUP (flag ON, default): the 3-knobs ("view options") menu does NOT
//       re-list Filter or Sort — their single home is inline;
//   (3) KILL-SWITCH (flag OFF): byte-for-byte legacy IA is RESTORED — the
//       net-new .mk-view-settings-bar wrapper, .mk-view-setting* classes and
//       data-mk-* / aria-pressed attrs are GONE (the trio reverts to bare
//       .mk-toolbar-button direct children of .mk-view-options with only the
//       legacy .mk-active background, no accent underline), AND Filter/Sort
//       REAPPEAR in the 3-knobs menu (the prior inside/outside duplication).
//
// It re-declares the same heavy-graph mock surface the sibling
// FilterBar.subItemsSetup.dom.test.tsx uses (each dom test file owns its mocks).
import React from "react";
import { act } from "react-dom/test-utils";
import { createRoot, Root } from "react-dom/client";
import { ScreenType } from "shared/types/ui";

jest.mock("makemd-core", () => ({
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  SelectOptionType: require("shared/types/menu").SelectOptionType,
}));
jest.mock("core/react/context/SpaceContext", () => ({
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  SpaceContext: require("react").createContext(null),
}));
jest.mock("core/react/context/PathContext", () => ({
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  PathContext: require("react").createContext({ readMode: false }),
}));
jest.mock("core/react/context/ContextEditorContext", () => ({
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  ContextEditorContext: require("react").createContext(null),
}));
jest.mock("core/react/context/FramesMDBContext", () => ({
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  FramesMDBContext: require("react").createContext(null),
}));
jest.mock("core/react/components/UI/Crumbs/PathCrumb", () => ({
  PathCrumb: (): null => null,
}));
jest.mock("core/react/components/UI/Menus/contexts/newSpacePropertyMenu", () => ({
  showNewPropertyMenu: () => {},
}));
jest.mock("core/react/components/UI/Menus/contexts/propertyVisibilityMenu", () => ({
  showPropertyVisibilityMenu: () => {},
}));
jest.mock("core/react/components/UI/Menus/contexts/spacePropertyMenu", () => ({
  showPropertyMenu: () => {},
}));
jest.mock("core/react/components/UI/Menus/navigator/showSpaceAddMenu", () => ({
  showSpaceAddMenu: () => {},
}));
jest.mock("core/react/components/UI/Menus/properties/datePickerMenu", () => ({
  showDatePickerMenu: () => {},
  DatePickerTimeMode: { None: 0 },
}));
jest.mock("core/react/components/UI/Menus/properties/linkMenu", () => ({
  showLinkMenu: () => {},
}));
jest.mock("core/react/components/UI/Menus/properties/propertyMenu", () => ({
  showSetValueMenu: () => {},
}));
jest.mock("core/react/components/UI/Menus/properties/selectSpaceMenu", () => ({
  showSpacesMenu: () => {},
}));
jest.mock("core/react/components/UI/Modals/ContextCreateItemModal", () => ({
  openContextCreateItemModal: () => {},
}));
jest.mock("core/react/components/UI/Modals/CsvImportModal", () => ({
  CsvImportModal: (): null => null,
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { FilterBar } = require("./FilterBar");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { SpaceContext } = require("core/react/context/SpaceContext");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { PathContext } = require("core/react/context/PathContext");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { ContextEditorContext } = require("core/react/context/ContextEditorContext");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { FramesMDBContext } = require("core/react/context/FramesMDBContext");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const i18n = require("shared/i18n").default ?? require("shared/i18n");

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const BUTTON_RECT = { x: 100, y: 200, width: 30, height: 30 };
const stubRect = (el: Element) => {
  (el as any).getBoundingClientRect = () => ({
    ...BUTTON_RECT,
    top: BUTTON_RECT.y,
    left: BUTTON_RECT.x,
    right: BUTTON_RECT.x + BUTTON_RECT.width,
    bottom: BUTTON_RECT.y + BUTTON_RECT.height,
    toJSON: () => BUTTON_RECT,
  });
};

type OpenMenuCall = { props: any };
const makeSuperstate = (
  calls: OpenMenuCall[],
  viewSettingsInlineBar: boolean
): any => ({
  settings: { experimental: false, subItemsSetup: true, viewSettingsInlineBar },
  ui: {
    getSticker: () => "<svg><path d='M0 0h1v1H0z'></path></svg>",
    getScreenType: () => ScreenType.Desktop,
    openMenu: (_rect: any, props: any) => {
      calls.push({ props });
      return { update: () => {}, hide: () => {} };
    },
    notify: () => {},
    openModal: () => {},
  },
  spaceManager: {
    uriByString: (s: string) => ({
      path: s,
      ref: null as string | null,
      authority: "",
    }),
    readFrame: async (): Promise<{ cols: unknown[] }> => ({ cols: [] }),
    readTags: (): string[] => [],
  },
  spacesIndex: new Map([["Some Space", { name: "Some Space" }]]),
  contextsIndex: new Map([["Some Space", { schemas: [] }]]),
  pathsIndex: new Map(),
  spacesMap: { getInverse: () => new Set<string>() },
  kitFrames: new Map(),
  getSpaceItems: (): unknown[] => [],
});

const basePredicate = {
  view: "table",
  filters: [],
  sort: [],
  groupBy: [],
  listView: "",
  listGroup: "",
  listItem: "",
  listViewProps: {},
  listGroupProps: {},
  listItemProps: {},
  colsHidden: [],
  colsOrder: [],
  // Matches the real defaultPredicate shape (shared/schemas/predicate.tsx):
  // validatePredicate always normalizes limit to a number, so production
  // never hands FilterBar an undefined predicate.limit. Included here so the
  // inline Limit control's editor menu (bd Notidian-4qjx.6) exercises the
  // same shape real callers provide.
  limit: 0,
} as any;

let openMenuCalls: OpenMenuCall[];
let root: Root;
let container: HTMLElement;

const plainCols = [{ name: "Status", type: "text", table: "", schemaId: "files" }];

const mount = (opts: {
  viewSettingsInlineBar: boolean;
  predicate?: any;
  cols?: any[];
  savePredicate?: (next: any) => void;
  dbSchema?: any;
}) => {
  openMenuCalls = [];
  const superstate = makeSuperstate(openMenuCalls, opts.viewSettingsInlineBar);
  const spaceState = {
    path: "Some Space",
    name: "Some Space",
    space: { readOnly: false },
    propertyTypes: [],
  } as any;
  const contextEditorValue = {
    source: "Some Space",
    dbSchema: opts.dbSchema ?? {
      id: "files",
      name: "Files",
      type: "db",
      primary: "true",
    },
    cols: opts.cols ?? plainCols,
    filteredData: [],
    predicate: opts.predicate ?? basePredicate,
    savePredicate: opts.savePredicate ?? (() => {}),
    setSearchString: () => {},
    setEditMode: () => {},
    hideColumn: () => {},
    delColumn: () => {},
    saveColumn: () => true,
    reloadContextData: async () => {},
    // The single view search's open toggle (ADR 0041) is read by the inline bar.
    searchActive: false,
    setSearchActive: () => {},
  } as any;
  const framesValue = {
    frameSchema: { id: "fs", name: "View", type: "view", def: {} },
    saveSchema: async () => {},
    setFrameSchema: () => {},
  } as any;

  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root.render(
      <SpaceContext.Provider value={{ spaceInfo: null, readMode: false, spaceState }}>
        <PathContext.Provider value={{ readMode: false } as any}>
          <ContextEditorContext.Provider value={contextEditorValue}>
            <FramesMDBContext.Provider value={framesValue}>
              <FilterBar superstate={superstate} />
            </FramesMDBContext.Provider>
          </ContextEditorContext.Provider>
        </PathContext.Provider>
      </SpaceContext.Provider>
    );
  });
  return superstate;
};

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

// Click the 3-knobs (last toolbar button in .mk-view-options) and return the
// menu's option names.
const openViewOptionsMenuNames = async (): Promise<string[]> => {
  const viewOptions = container.querySelector(".mk-view-options")!;
  // The 3-knobs button is the last DIRECT toolbar button of .mk-view-options
  // (the inline-bar trio is nested inside .mk-view-settings-bar).
  const directButtons = Array.from(viewOptions.children).filter(
    (el) => el.tagName === "BUTTON" && el.classList.contains("mk-toolbar-button")
  ) as HTMLButtonElement[];
  const knobsButton = directButtons[directButtons.length - 1];
  stubRect(knobsButton);
  openMenuCalls.length = 0;
  await act(async () => {
    knobsButton.dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true, view: window })
    );
    await Promise.resolve();
    await Promise.resolve();
  });
  expect(openMenuCalls.length).toBeGreaterThan(0);
  const options = openMenuCalls[openMenuCalls.length - 1].props.options ?? [];
  return options.map((o: any) => o.name).filter((n: any) => typeof n === "string");
};

const inlineControl = (id: string): HTMLButtonElement | null =>
  container.querySelector(
    `.mk-view-settings-bar button[data-mk-control="${id}"]`
  );

// OFF (legacy) markup has no wrapper and no data-mk-control: the trio are bare
// .mk-toolbar-button direct children of .mk-view-options, identified by their
// aria-label (exactly the pre-vrmf Notidian-ddk/-nmr markup).
const legacyControl = (ariaLabel: string): HTMLButtonElement | null =>
  container.querySelector(
    `.mk-view-options > button.mk-toolbar-button[aria-label="${ariaLabel}"]`
  );

describe("FilterBar inline view-settings bar (Notidian-vrmf)", () => {
  it("flag ON: the Filter/Sort/Group-By trio renders inline in the settings bar", () => {
    mount({ viewSettingsInlineBar: true });
    const bar = container.querySelector(".mk-view-settings-bar");
    expect(bar).toBeTruthy();
    expect(bar!.getAttribute("data-mk-inline-bar")).toBe("on");
    expect(inlineControl("filter")).toBeTruthy();
    expect(inlineControl("sort")).toBeTruthy();
    expect(inlineControl("groupBy")).toBeTruthy();
  });

  it("flag ON: each inline control reflects its predicate-derived active state", () => {
    mount({
      viewSettingsInlineBar: true,
      predicate: {
        ...basePredicate,
        filters: [{ field: "Status", fn: "is", value: "Done", fType: "text" }],
        groupBy: ["Status"],
        // sort intentionally empty -> inactive
      },
    });
    const filter = inlineControl("filter")!;
    const sort = inlineControl("sort")!;
    const groupBy = inlineControl("groupBy")!;
    expect(filter.getAttribute("data-mk-active")).toBe("true");
    expect(filter.classList.contains("mk-active")).toBe(true);
    expect(filter.getAttribute("aria-pressed")).toBe("true");
    expect(sort.getAttribute("data-mk-active")).toBe("false");
    expect(sort.classList.contains("mk-active")).toBe(false);
    expect(groupBy.getAttribute("data-mk-active")).toBe("true");
    expect(groupBy.classList.contains("mk-active")).toBe(true);
  });

  it("flag ON: an empty predicate leaves every inline control inactive", () => {
    mount({ viewSettingsInlineBar: true });
    for (const id of ["filter", "sort", "groupBy"]) {
      const el = inlineControl(id)!;
      expect(el.getAttribute("data-mk-active")).toBe("false");
      expect(el.classList.contains("mk-active")).toBe(false);
    }
  });

  it("flag ON (de-dup): the 3-knobs menu does NOT re-list Filter or Sort (single home: inline)", async () => {
    mount({ viewSettingsInlineBar: true });
    const names = await openViewOptionsMenuNames();
    // Their single home is inline; the overflow menu must not duplicate them.
    expect(names).not.toContain(i18n.menu.sortBy);
    expect(names).not.toContain(i18n.menu.filters);
    // Sanity: the menu still carries genuine overflow settings. (Limit itself
    // is no longer one of them as of bd Notidian-4qjx.6 — see the dedicated
    // "promoted inline controls" describe block below for its coverage.)
    expect(names).toContain(i18n.labels.source);
  });

  it("flag OFF (kill-switch): restores byte-for-byte legacy IA — no net-new wrapper/classes/attrs", () => {
    mount({ viewSettingsInlineBar: false });
    // The net-new inline-bar wrapper must be GONE (a true revert, not a tagged
    // bar) so the kill-switch cannot leak the new IA. data-mk-inline-bar="off"
    // is itself net-new, so it must not appear either.
    expect(container.querySelector(".mk-view-settings-bar")).toBeNull();
    expect(
      container.querySelector("[data-mk-inline-bar]")
    ).toBeNull();
    // None of the net-new per-control classes/attrs exist OFF.
    expect(container.querySelector(".mk-view-setting")).toBeNull();
    expect(container.querySelector("[data-mk-control]")).toBeNull();
    expect(container.querySelector("[data-mk-active]")).toBeNull();
    expect(container.querySelector("[aria-pressed]")).toBeNull();
    // The legacy trio still renders, as bare .mk-toolbar-button DIRECT children
    // of .mk-view-options (the pre-vrmf layout the accent-underline CSS, scoped
    // to data-mk-inline-bar="on", can no longer reach).
    expect(legacyControl("Filter")).toBeTruthy();
    expect(legacyControl("Sort")).toBeTruthy();
    expect(legacyControl("Group By")).toBeTruthy();
    for (const label of ["Filter", "Sort", "Group By"]) {
      const btn = legacyControl(label)!;
      expect(btn.classList.contains("mk-view-setting")).toBe(false);
      expect(btn.hasAttribute("data-mk-control")).toBe(false);
      expect(btn.hasAttribute("aria-pressed")).toBe(false);
    }
  });

  it("flag OFF (kill-switch): Filter + Sort REAPPEAR in the 3-knobs menu (legacy duplication restored)", async () => {
    mount({ viewSettingsInlineBar: false });
    const names = await openViewOptionsMenuNames();
    // The kill-switch restores byte-for-byte legacy IA: the overflow menu
    // re-lists Sort By and Filters (the prior inside/outside duplication).
    expect(names).toContain(i18n.menu.sortBy);
    expect(names).toContain(i18n.menu.filters);
  });

  it("flag OFF (kill-switch): legacy buttons show active via the legacy .mk-active background only (no data-mk-active attr)", () => {
    mount({
      viewSettingsInlineBar: false,
      predicate: {
        ...basePredicate,
        sort: [{ field: "Status", fn: "alphabetical" }],
      },
    });
    const sort = legacyControl("Sort")!;
    // OFF derives active from the exact legacy expression (predicate.sort.length
    // > 0) and reflects it ONLY through the pre-vrmf .mk-active background — the
    // net-new data-mk-active attribute must not exist OFF.
    expect(sort.classList.contains("mk-active")).toBe(true);
    expect(sort.hasAttribute("data-mk-active")).toBe(false);
    const filter = legacyControl("Filter")!;
    expect(filter.classList.contains("mk-active")).toBe(false);
  });
});

// Click an inline control button and capture the resulting openMenu call
// (anchored to the button, exactly the house idiom the Filter/Sort/Group-By
// trio's own onClick handlers use).
const clickControl = async (btn: HTMLButtonElement) => {
  stubRect(btn);
  openMenuCalls.length = 0;
  await act(async () => {
    btn.dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true, view: window })
    );
    await Promise.resolve();
  });
};

describe("FilterBar promoted inline controls: Limit + Display Property (bd Notidian-4qjx.6)", () => {
  it("flag ON: Limit and Display Property render inline with i18n-derived labels", () => {
    mount({ viewSettingsInlineBar: true });
    const limit = inlineControl("limit");
    const displayProperty = inlineControl("displayProperty");
    expect(limit).toBeTruthy();
    expect(displayProperty).toBeTruthy();
    expect(limit!.getAttribute("aria-label")).toBe(i18n.labels.limit);
    expect(displayProperty!.getAttribute("aria-label")).toBe(
      i18n.menu.displayProperty
    );
  });

  it("flag ON (de-dup): the 3-knobs menu does NOT list Limit or Display Property (single home: inline)", async () => {
    mount({ viewSettingsInlineBar: true });
    const names = await openViewOptionsMenuNames();
    expect(names).not.toContain(i18n.labels.limit);
    expect(names).not.toContain(i18n.menu.displayProperty);
    // Sanity: the menu still carries genuine overflow settings.
    expect(names).toContain(i18n.labels.source);
  });

  it("flag ON: Limit's active indicator reflects a positive predicate.limit", () => {
    mount({ viewSettingsInlineBar: true, predicate: { ...basePredicate, limit: 25 } });
    const limit = inlineControl("limit")!;
    expect(limit.getAttribute("data-mk-active")).toBe("true");
    expect(limit.classList.contains("mk-active")).toBe(true);
    expect(limit.getAttribute("aria-pressed")).toBe("true");
  });

  it("flag ON: Limit's active indicator is off when the predicate has no limit", () => {
    mount({ viewSettingsInlineBar: true });
    const limit = inlineControl("limit")!;
    expect(limit.getAttribute("data-mk-active")).toBe("false");
    expect(limit.classList.contains("mk-active")).toBe(false);
    expect(limit.getAttribute("aria-pressed")).toBe("false");
  });

  it("flag ON: Display Property's active indicator reflects a chosen listViewProps.displayProperty", () => {
    mount({
      viewSettingsInlineBar: true,
      predicate: {
        ...basePredicate,
        listViewProps: { displayProperty: "Status" },
      },
    });
    const displayProperty = inlineControl("displayProperty")!;
    expect(displayProperty.getAttribute("data-mk-active")).toBe("true");
    expect(displayProperty.classList.contains("mk-active")).toBe(true);
    expect(displayProperty.getAttribute("aria-pressed")).toBe("true");
  });

  it("flag ON: Display Property's active indicator is off when none is chosen", () => {
    mount({ viewSettingsInlineBar: true });
    const displayProperty = inlineControl("displayProperty")!;
    expect(displayProperty.getAttribute("data-mk-active")).toBe("false");
    expect(displayProperty.classList.contains("mk-active")).toBe(false);
  });

  it("flag ON: clicking Limit opens the limit editor (numeric options, editable, correct placeholder)", async () => {
    mount({ viewSettingsInlineBar: true });
    await clickControl(inlineControl("limit")!);
    expect(openMenuCalls.length).toBeGreaterThan(0);
    const menuProps = openMenuCalls[openMenuCalls.length - 1].props;
    expect(menuProps.editable).toBe(true);
    expect(menuProps.placeholder).toBe("Enter a number or select");
    const optionNames = menuProps.options.map((o: any) => o.name);
    expect(optionNames).toContain(i18n.labels.showAll);
    expect(optionNames).toContain("25");
  });

  it("flag ON: clicking Display Property opens the property picker (None + column options)", async () => {
    mount({ viewSettingsInlineBar: true });
    await clickControl(inlineControl("displayProperty")!);
    expect(openMenuCalls.length).toBeGreaterThan(0);
    const menuProps = openMenuCalls[openMenuCalls.length - 1].props;
    const optionNames = menuProps.options.map((o: any) => o.name);
    expect(optionNames).toContain(i18n.menu.none);
    expect(optionNames).toContain("Status");
  });

  it("flag ON: choosing a Limit value round-trips through savePredicate", async () => {
    const savePredicateCalls: any[] = [];
    mount({
      viewSettingsInlineBar: true,
      savePredicate: (next) => savePredicateCalls.push(next),
    });
    await clickControl(inlineControl("limit")!);
    const menuProps = openMenuCalls[openMenuCalls.length - 1].props;
    menuProps.saveOptions([], ["50"]);
    expect(savePredicateCalls).toContainEqual({ limit: 50 });
  });

  it("flag ON: choosing a Display Property value round-trips through savePredicate", async () => {
    const savePredicateCalls: any[] = [];
    mount({
      viewSettingsInlineBar: true,
      savePredicate: (next) => savePredicateCalls.push(next),
    });
    await clickControl(inlineControl("displayProperty")!);
    const menuProps = openMenuCalls[openMenuCalls.length - 1].props;
    menuProps.saveOptions([], ["Status"]);
    expect(savePredicateCalls).toContainEqual({
      listViewProps: { displayProperty: "Status" },
    });
  });

  it("flag OFF (kill-switch): Limit and Display Property render nothing inline (no legacy inline form ever existed for them)", () => {
    mount({ viewSettingsInlineBar: false });
    expect(container.querySelector('[data-mk-control="limit"]')).toBeNull();
    expect(
      container.querySelector('[data-mk-control="displayProperty"]')
    ).toBeNull();
  });

  it("flag OFF (kill-switch): Limit and Display Property fall back to their sole home in the 3-knobs menu", async () => {
    mount({ viewSettingsInlineBar: false });
    const names = await openViewOptionsMenuNames();
    expect(names).toContain(i18n.labels.limit);
    expect(names).toContain(i18n.menu.displayProperty);
  });
});
