/**
 * @jest-environment jsdom
 */
// Offline (jsdom) regression coverage for Notidian-i23:
//   "View-options (3-knobs) menu jumps to click position — anchor to the
//    button via e.currentTarget, not e.target."
//
// WHY THIS TEST EXISTS
// --------------------
// The toolbar buttons in FilterBar render their icon via
// `dangerouslySetInnerHTML` SVG. Before the fix, the menu openers computed
// their anchor rect from `(e.target as HTMLElement).getBoundingClientRect()`.
// Because the click can land on any SVG child (svg / path / g) — each laid out
// at a different position — `e.target` resolved to a different element (and
// therefore a different rect) depending on exactly where the pointer hit,
// making the popup menu "jump" to the click position instead of staying anchored
// to the button. The fix anchors to `e.currentTarget`, which React always sets to
// the element the handler is bound to (the <button>), giving a stable anchor.
//
// jsdom does not perform layout, so getBoundingClientRect() returns all-zero
// rects by default and the button vs. SVG-child distinction is invisible. We
// therefore stub getBoundingClientRect() with DISTINCT, recognizable rects on
// the button and on its inner SVG child, then dispatch a real click whose
// `target` is the inner SVG child (it bubbles to the button's React listener,
// which is where currentTarget is resolved). We assert the rect handed to
// `superstate.ui.openMenu` is the BUTTON's rect — not the SVG child's. This test
// fails on the pre-fix code (it would receive the child rect) and passes after.
import React from "react";
import { act } from "react-dom/test-utils";
import { createRoot, Root } from "react-dom/client";
import { ScreenType } from "shared/types/ui";

// ---- Heavy-graph isolation -------------------------------------------------
// FilterBar's import surface transitively reaches the `makemd-core` app barrel
// (via PathCrumb -> pathContextMenu and the property/space menu modules), which
// drags in ESM-only deps (d3) and untransformed .js helpers that ts-jest's
// .ts/.tsx-only transform cannot parse. We are testing FilterBar's OWN menu
// anchoring logic, not those collaborators, so we replace them with light stubs.
// The only runtime symbol FilterBar needs from `makemd-core` is the
// SelectOptionType enum (used to tag menu options it builds); we re-export the
// REAL enum from its source of truth so the built menu options are faithful.
// None of the stubbed menu openers are invoked on the paths these tests exercise
// (table view; submenus are lazy onSubmenu callbacks that are never triggered).
jest.mock("makemd-core", () => ({
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  SelectOptionType: require("shared/types/menu").SelectOptionType,
}));
// The four React contexts FilterBar consumes are each replaced with a fresh,
// real React.createContext. This severs their heavy implementation graphs (which
// transitively import ESM .js helpers the repo's ts-jest transform cannot parse,
// e.g. uuid.js / matchers.js) while still giving FilterBar a genuine context to
// read and the test a matching <Provider> to feed. Because jest.mock returns a
// single stable module instance, FilterBar and the test share the same context
// objects.
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
// Capturing spies so the Item Properties path tests (Notidian-r6oj) can assert
// the props FilterBar threads into the shared menus.
const showNewPropertyMenuMock = jest.fn();
const showPropertyVisibilityMenuMock = jest.fn();
jest.mock("core/react/components/UI/Menus/contexts/newSpacePropertyMenu", () => ({
  showNewPropertyMenu: (...args: unknown[]) => showNewPropertyMenuMock(...args),
}));
jest.mock(
  "core/react/components/UI/Menus/contexts/propertyVisibilityMenu",
  () => ({
    showPropertyVisibilityMenu: (...args: unknown[]) =>
      showPropertyVisibilityMenuMock(...args),
  })
);
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
const {
  ContextEditorContext,
} = require("core/react/context/ContextEditorContext");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { FramesMDBContext } = require("core/react/context/FramesMDBContext");

// React 18 act() environment flag.
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

// Distinct, recognizable rects so an anchor sourced from the button is
// unmistakably different from one sourced from a clicked SVG child.
type XYWH = { x: number; y: number; width: number; height: number };
const BUTTON_RECT: XYWH = { x: 100, y: 200, width: 30, height: 30 };
const SVG_CHILD_RECT: XYWH = { x: 555, y: 777, width: 12, height: 12 };

const stubRect = (el: Element, rect: XYWH) => {
  (el as any).getBoundingClientRect = () => ({
    ...rect,
    top: rect.y,
    left: rect.x,
    right: rect.x + rect.width,
    bottom: rect.y + rect.height,
    toJSON: () => rect,
  });
};

type OpenMenuCall = { rect: { x: number; y: number } };

const makeSuperstate = (openMenuCalls: OpenMenuCall[]): any => ({
  settings: { experimental: false },
  ui: {
    // A real SVG string so React materializes queryable child nodes
    // (button.querySelector('svg path')) for the icon buttons.
    getSticker: () => "<svg><path d='M0 0h1v1H0z'></path></svg>",
    getScreenType: () => ScreenType.Desktop,
    openMenu: (rect: any) => {
      openMenuCalls.push({ rect: { x: rect.x, y: rect.y } });
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
  // showViewOptionsMenu reads spacesIndex.get(source).name and
  // contextsIndex.get(source)?.schemas to build the Source/List submenu values.
  spacesIndex: new Map([["Some Space", { name: "Some Space" }]]),
  contextsIndex: new Map([["Some Space", { schemas: [] }]]),
  pathsIndex: new Map(),
  spacesMap: { getInverse: () => new Set<string>() },
  kitFrames: new Map(),
  getSpaceItems: (): unknown[] => [],
});

const tablePredicate = {
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
} as any;

const renderFilterBar = (
  superstate: any,
  predicateOverride?: any
): { root: Root; container: HTMLElement } => {
  const spaceState = {
    path: "Some Space",
    name: "Some Space",
    space: { readOnly: false },
    propertyTypes: [],
  } as any;
  const contextEditorValue = {
    source: "Some Space",
    dbSchema: { id: "files", name: "Files", type: "db", primary: "false" },
    cols: [],
    filteredData: [],
    predicate: predicateOverride ?? tablePredicate,
    savePredicate: () => {},
    setSearchString: () => {},
    setFindOpen: () => {},
    setEditMode: () => {},
    hideColumn: () => {},
    delColumn: () => {},
    saveColumn: () => false,
    reloadContextData: async () => {},
  } as any;
  const framesValue = {
    frameSchema: { id: "fs", name: "View", type: "view", def: {} },
    saveSchema: async () => {},
    setFrameSchema: () => {},
  } as any;

  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(
      <SpaceContext.Provider
        value={{ spaceInfo: null, readMode: false, spaceState }}
      >
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
  return { root, container };
};

describe("FilterBar toolbar menu anchoring (Notidian-i23)", () => {
  let openMenuCalls: OpenMenuCall[];
  let superstate: any;
  let root: Root;
  let container: HTMLElement;

  beforeEach(() => {
    openMenuCalls = [];
    superstate = makeSuperstate(openMenuCalls);
    ({ root, container } = renderFilterBar(superstate));
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  // Click a toolbar <button> on its inner SVG child and assert the menu
  // anchored to the BUTTON rect, not the clicked child rect.
  const clickIconButtonAndGetAnchor = (button: HTMLButtonElement) => {
    const svgChild = button.querySelector("path") ?? button.querySelector("svg");
    expect(svgChild).toBeTruthy();

    stubRect(button, BUTTON_RECT);
    stubRect(svgChild as Element, SVG_CHILD_RECT);

    openMenuCalls.length = 0;
    act(() => {
      // A real, bubbling click whose target is the inner SVG child. React
      // resolves currentTarget to the button as the event bubbles to its
      // listener — exactly the live-DOM scenario the bug came from.
      svgChild!.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true, view: window })
      );
    });

    expect(openMenuCalls.length).toBeGreaterThan(0);
    return openMenuCalls[openMenuCalls.length - 1].rect;
  };

  it("renders the view-options (3-knobs) toolbar button", () => {
    const viewOptions = container.querySelector(".mk-view-options");
    expect(viewOptions).toBeTruthy();
    const buttons = viewOptions!.querySelectorAll("button.mk-toolbar-button");
    // search, filter, sort, layout, view-options (3-knobs) are all rendered.
    expect(buttons.length).toBeGreaterThanOrEqual(4);
  });

  // ADR 0041 (Notidian-z8q): the view was consolidated to ONE search
  // affordance. The standalone quick-find (⌕) toolbar button is removed and the
  // single magnifier search-toggle remains (Cmd/Ctrl+F now opens it).
  it("renders one consolidated search toggle and no standalone quick-find button (ADR 0041)", () => {
    const viewOptions = container.querySelector(".mk-view-options")!;
    expect(viewOptions.querySelector(".mk-quick-find-toggle")).toBeNull();
    const searchToggle = viewOptions.querySelector(".mk-view-search-toggle");
    expect(searchToggle).toBeTruthy();
    expect(searchToggle!.getAttribute("aria-label")).toBe("Search");
  });

  it("anchors the 3-knobs (view-options) menu to the button, not the clicked SVG child", () => {
    const viewOptions = container.querySelector(".mk-view-options")!;
    const toolbarButtons = Array.from(
      viewOptions.querySelectorAll("button.mk-toolbar-button")
    ) as HTMLButtonElement[];
    // The 3-knobs (view-options) opener is the last toolbar button in the bar.
    const knobsButton = toolbarButtons[toolbarButtons.length - 1];

    const anchor = clickIconButtonAndGetAnchor(knobsButton);

    expect(anchor.x).toBe(BUTTON_RECT.x);
    expect(anchor.y).toBe(BUTTON_RECT.y);
    // And explicitly NOT the clicked SVG child's rect (the pre-fix behavior).
    expect(anchor.x).not.toBe(SVG_CHILD_RECT.x);
    expect(anchor.y).not.toBe(SVG_CHILD_RECT.y);
  });

  it("anchors the layout menu to its button, not the clicked SVG child", () => {
    const viewOptions = container.querySelector(".mk-view-options")!;
    const toolbarButtons = Array.from(
      viewOptions.querySelectorAll("button.mk-toolbar-button")
    ) as HTMLButtonElement[];
    // Layout is the second-to-last toolbar button (immediately before 3-knobs).
    const layoutButton = toolbarButtons[toolbarButtons.length - 2];

    const anchor = clickIconButtonAndGetAnchor(layoutButton);

    expect(anchor.x).toBe(BUTTON_RECT.x);
    expect(anchor.y).toBe(BUTTON_RECT.y);
    expect(anchor.x).not.toBe(SVG_CHILD_RECT.x);
  });

  it("anchors the inline Filter/Sort menus to their buttons, not the clicked SVG child", () => {
    const viewOptions = container.querySelector(".mk-view-options")!;
    // The Filter and Sort buttons carry aria-labels.
    const filterButton = viewOptions.querySelector(
      'button[aria-label="Filter"]'
    ) as HTMLButtonElement;
    const sortButton = viewOptions.querySelector(
      'button[aria-label="Sort"]'
    ) as HTMLButtonElement;
    expect(filterButton).toBeTruthy();
    expect(sortButton).toBeTruthy();

    const filterAnchor = clickIconButtonAndGetAnchor(filterButton);
    expect(filterAnchor.x).toBe(BUTTON_RECT.x);
    expect(filterAnchor.y).toBe(BUTTON_RECT.y);

    const sortAnchor = clickIconButtonAndGetAnchor(sortButton);
    expect(sortAnchor.x).toBe(BUTTON_RECT.x);
    expect(sortAnchor.y).toBe(BUTTON_RECT.y);
  });
});

// ---------------------------------------------------------------------------
// Notidian-nmr: Group-By hoisted to a dedicated toolbar button next to
// Filter/Sort (Notion-style), and removed from the view-options ("3 knobs")
// overflow menu so it is no longer duplicated.
//
// These tests capture the full menu props handed to superstate.ui.openMenu
// (not just the anchor rect) so we can assert the Group-By button renders,
// opens the property-grouping menu anchored to the button, toggles its
// mk-active badge with predicate.groupBy, and that the view-options menu no
// longer contains a Group-By submenu entry.
// ---------------------------------------------------------------------------
type OpenMenuFullCall = { rect: { x: number; y: number }; props: any };

const makeSuperstateCapturingProps = (calls: OpenMenuFullCall[]): any => {
  const ss = makeSuperstate([]);
  ss.ui.openMenu = (rect: any, props: any) => {
    calls.push({ rect: { x: rect.x, y: rect.y }, props });
    return { update: () => {}, hide: () => {} };
  };
  return ss;
};

describe("FilterBar Group-By toolbar button (Notidian-nmr)", () => {
  let openMenuCalls: OpenMenuFullCall[];
  let superstate: any;
  let root: Root;
  let container: HTMLElement;

  const mount = (predicateOverride?: any) => {
    openMenuCalls = [];
    superstate = makeSuperstateCapturingProps(openMenuCalls);
    ({ root, container } = renderFilterBar(superstate, predicateOverride));
  };

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  const clickIconButton = (button: HTMLButtonElement) => {
    const svgChild =
      button.querySelector("path") ?? button.querySelector("svg");
    expect(svgChild).toBeTruthy();
    stubRect(button, BUTTON_RECT);
    stubRect(svgChild as Element, SVG_CHILD_RECT);
    openMenuCalls.length = 0;
    act(() => {
      svgChild!.dispatchEvent(
        new MouseEvent("click", {
          bubbles: true,
          cancelable: true,
          view: window,
        })
      );
    });
  };

  it("renders a dedicated Group By toolbar button in the bar", () => {
    mount();
    const viewOptions = container.querySelector(".mk-view-options")!;
    const groupByButton = viewOptions.querySelector(
      'button[aria-label="Group By"]'
    ) as HTMLButtonElement;
    expect(groupByButton).toBeTruthy();
    expect(groupByButton.classList.contains("mk-toolbar-button")).toBe(true);
  });

  it("opens the group-by menu anchored to the button, not the clicked SVG child", () => {
    mount();
    const viewOptions = container.querySelector(".mk-view-options")!;
    const groupByButton = viewOptions.querySelector(
      'button[aria-label="Group By"]'
    ) as HTMLButtonElement;

    clickIconButton(groupByButton);

    expect(openMenuCalls.length).toBeGreaterThan(0);
    const call = openMenuCalls[openMenuCalls.length - 1];
    // Anchored to the BUTTON rect (e.currentTarget), never the SVG child rect.
    expect(call.rect.x).toBe(BUTTON_RECT.x);
    expect(call.rect.y).toBe(BUTTON_RECT.y);
    expect(call.rect.x).not.toBe(SVG_CHILD_RECT.x);
    expect(call.rect.y).not.toBe(SVG_CHILD_RECT.y);
    // It is the single-select property-grouping menu (saveOptions wired up).
    expect(call.props.multi).toBe(false);
    expect(typeof call.props.saveOptions).toBe("function");
  });

  it("is NOT marked active when no grouping is applied", () => {
    mount({ ...tablePredicate, groupBy: [] });
    const groupByButton = container.querySelector(
      'button[aria-label="Group By"]'
    ) as HTMLButtonElement;
    expect(groupByButton.classList.contains("mk-active")).toBe(false);
  });

  it("is marked active (mk-active) when predicate.groupBy is non-empty", () => {
    mount({ ...tablePredicate, groupBy: ["Status"] });
    const groupByButton = container.querySelector(
      'button[aria-label="Group By"]'
    ) as HTMLButtonElement;
    expect(groupByButton.classList.contains("mk-active")).toBe(true);
  });

  it("no longer lists Group By inside the view-options (3-knobs) overflow menu", () => {
    mount();
    const viewOptions = container.querySelector(".mk-view-options")!;
    const toolbarButtons = Array.from(
      viewOptions.querySelectorAll("button.mk-toolbar-button")
    ) as HTMLButtonElement[];
    // The 3-knobs (view-options) opener is the last toolbar button.
    const knobsButton = toolbarButtons[toolbarButtons.length - 1];

    stubRect(knobsButton, BUTTON_RECT);
    openMenuCalls.length = 0;
    act(() => {
      knobsButton.dispatchEvent(
        new MouseEvent("click", {
          bubbles: true,
          cancelable: true,
          view: window,
        })
      );
    });

    expect(openMenuCalls.length).toBeGreaterThan(0);
    const menuProps = openMenuCalls[openMenuCalls.length - 1].props;
    const optionNames: string[] = (menuProps.options ?? []).map(
      (o: any) => o.name
    );
    // Sort and Filter submenus remain in the overflow menu; Group By must not.
    expect(optionNames).not.toContain("Group By");
    // i18n.menu.groupBy currently resolves to "Group By"; assert against both
    // the literal and the i18n source-of-truth to stay robust to wording.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const i18n = require("shared/i18n").default ?? require("shared/i18n");
    const groupByLabel = i18n?.menu?.groupBy;
    if (groupByLabel) {
      expect(optionNames).not.toContain(groupByLabel);
    }
  });
});

// ---------------------------------------------------------------------------
// Notidian-r6oj: the Item Properties picker (Cards/Board/Details) gains a
// reachable Remove-property affordance (Part A) and a reachable New-property
// row (Part B). FilterBar's showItemPropertiesMenu now threads BOTH deleteColumn
// (the same delColumn the table-column header menu uses) and newProperty (the
// same showNewPropertyMenu wiring the table path uses) into the shared
// property-visibility menu. We capture the props handed to
// showPropertyVisibilityMenu when the Item Properties submenu opens and assert
// they are present + correctly wired — and that the table-column header path
// (Properties submenu) still threads them too (regression).
// ---------------------------------------------------------------------------
describe("FilterBar Item Properties picker — remove + new-property threading (Notidian-r6oj)", () => {
  let openMenuCalls: OpenMenuFullCall[];
  let superstate: any;
  let root: Root;
  let container: HTMLElement;

  // A list-view predicate on the "Cards" layout (cardsListItem) so
  // shouldShowListItemPropertyPicker(predicate) is true and the Item Properties
  // option is surfaced in the view-options menu.
  const cardsListPredicate = {
    ...tablePredicate,
    view: "list",
    listItem: "spaces://$kit/#*cardsListItem",
  } as any;

  // The Item Properties option is gated on dbSchema.primary == "true"; render
  // FilterBar with a primary db schema and one deletable column.
  const mountListView = () => {
    openMenuCalls = [];
    superstate = makeSuperstateCapturingProps(openMenuCalls);
    const spaceState = {
      path: "Some Space",
      name: "Some Space",
      space: { readOnly: false },
      propertyTypes: [],
    } as any;
    const delColumnCalls: any[] = [];
    const contextEditorValue = {
      source: "Some Space",
      dbSchema: { id: "files", name: "Files", type: "db", primary: "true" },
      cols: [
        { name: "manual", type: "text", table: "", schemaId: "files" },
      ],
      filteredData: [],
      predicate: cardsListPredicate,
      savePredicate: () => {},
      setSearchString: () => {},
      setFindOpen: () => {},
      setEditMode: () => {},
      hideColumn: () => {},
      delColumn: (col: any) => delColumnCalls.push(col),
      saveColumn: () => false,
      reloadContextData: async () => {},
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
        <SpaceContext.Provider
          value={{ spaceInfo: null, readMode: false, spaceState }}
        >
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
    return { delColumnCalls };
  };

  // FilterBar's predicate effect resolves propertiesForPredicate(...) async and
  // calls setState; flush those microtasks inside act() so the resulting state
  // update is settled (no act() warning) before the test inspects menus.
  const flushEffects = async () => {
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
  };

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    showPropertyVisibilityMenuMock.mockClear();
    showNewPropertyMenuMock.mockClear();
  });

  // Open the async view-options ("3 knobs") menu and return the captured
  // options array passed to openMenu.
  const openViewOptionsMenu = async (): Promise<any[]> => {
    const viewOptions = container.querySelector(".mk-view-options")!;
    const toolbarButtons = Array.from(
      viewOptions.querySelectorAll("button.mk-toolbar-button")
    ) as HTMLButtonElement[];
    const knobsButton = toolbarButtons[toolbarButtons.length - 1];
    stubRect(knobsButton, BUTTON_RECT);
    openMenuCalls.length = 0;
    await act(async () => {
      knobsButton.dispatchEvent(
        new MouseEvent("click", {
          bubbles: true,
          cancelable: true,
          view: window,
        })
      );
      // showViewOptionsMenu is async; flush microtasks so openMenu is called.
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(openMenuCalls.length).toBeGreaterThan(0);
    return openMenuCalls[openMenuCalls.length - 1].props.options ?? [];
  };

  it("surfaces an Item Properties submenu whose menu threads deleteColumn + newProperty (Parts A+B reachable)", async () => {
    const { delColumnCalls } = mountListView();
    await flushEffects();
    const options = await openViewOptionsMenu();
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const i18n = require("shared/i18n").default ?? require("shared/i18n");
    const itemPropsOption = options.find(
      (o: any) => o.name == i18n.menu.itemProperties
    );
    expect(itemPropsOption).toBeTruthy();
    expect(typeof itemPropsOption.onSubmenu).toBe("function");

    // Invoke the submenu — it calls showItemPropertiesMenu →
    // showPropertyVisibilityMenu (our capturing mock).
    showPropertyVisibilityMenuMock.mockClear();
    act(() => {
      itemPropsOption.onSubmenu(BUTTON_RECT, ((): void => undefined));
    });
    expect(showPropertyVisibilityMenuMock).toHaveBeenCalledTimes(1);
    // showPropertyVisibilityMenu(superstate, rect, win, props, onHide)
    const menuProps = showPropertyVisibilityMenuMock.mock.calls[0][3];

    // PART A: deleteColumn is threaded and is the SAME delColumn the table path
    // uses (calling it forwards to ContextEditorContext.delColumn).
    expect(typeof menuProps.deleteColumn).toBe("function");
    const col = { name: "manual", type: "text", table: "", schemaId: "files" };
    menuProps.deleteColumn(col);
    expect(delColumnCalls).toEqual([col]);

    // PART B: newProperty is threaded; invoking it opens the new-property menu
    // (the same durable showNewPropertyMenu path the table path uses).
    expect(typeof menuProps.newProperty).toBe("function");
    showNewPropertyMenuMock.mockClear();
    menuProps.newProperty(BUTTON_RECT);
    expect(showNewPropertyMenuMock).toHaveBeenCalledTimes(1);
    // The durable new-property call targets this context with the default schema.
    const newPropArgs = showNewPropertyMenuMock.mock.calls[0];
    expect(newPropArgs[3].schemaId).toBe("files");
    expect(newPropArgs[3].contextPath).toBe("Some Space");
    expect(typeof newPropArgs[3].saveField).toBe("function");
  });

  it("regression: the table-column header (Properties) path still threads editProperty + newProperty unchanged", async () => {
    mountListView();
    await flushEffects();
    const options = await openViewOptionsMenu();
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const i18n = require("shared/i18n").default ?? require("shared/i18n");
    const propertiesOption = options.find(
      (o: any) => o.name == i18n.menu.properties
    );
    expect(propertiesOption).toBeTruthy();

    showPropertyVisibilityMenuMock.mockClear();
    act(() => {
      propertiesOption.onSubmenu(BUTTON_RECT, ((): void => undefined));
    });
    expect(showPropertyVisibilityMenuMock).toHaveBeenCalledTimes(1);
    const menuProps = showPropertyVisibilityMenuMock.mock.calls[0][3];
    // The table path threads delete via the per-row editProperty popup (the
    // PropertyMenu's "Delete Property"), NOT a top-level deleteColumn on the
    // visibility menu — so deleteColumn is absent here and the Item Properties
    // path's new top-level deleteColumn is additive, not a change to this path.
    expect(menuProps.deleteColumn).toBeUndefined();
    expect(typeof menuProps.newProperty).toBe("function");
    expect(typeof menuProps.editProperty).toBe("function");
  });
});
