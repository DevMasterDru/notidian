/**
 * @jest-environment jsdom
 */
// Offline (jsdom) coverage for the "Turn on sub-items" front-door (bd
// Notidian-xqxc). The sub-items tree engine is dormant until a view designates a
// self-relation parent-link column; most databases have none, so the FilterBar
// "Sub-items" submenu would dead-end at "None". This test proves:
//   (1) flag ON + no eligible column  -> the "Turn on sub-items" option appears,
//       and selecting it creates a frontmatter LINK column AND sets
//       predicate.subItems.field in one action (via enableSubItemsWithColumn);
//   (2) flag OFF (kill-switch)        -> the option is ABSENT (byte-for-byte
//       legacy submenu: None + eligible list only);
//   (3) an eligible column already present -> the option is hidden (reuse, not
//       create), regardless of the flag.
//
// It re-declares the same heavy-graph mock surface the sibling
// FilterBar.anchor.dom.test.tsx uses (each dom test file owns its mocks).
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
const makeSuperstate = (calls: OpenMenuCall[], subItemsSetup: boolean): any => ({
  settings: { experimental: false, subItemsSetup },
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

let openMenuCalls: OpenMenuCall[];
let root: Root;
let container: HTMLElement;
let saveColumnCalls: any[];
let savePredicateCalls: any[];

const mount = (opts: { subItemsSetup: boolean; cols: any[]; dbSchema?: any }) => {
  openMenuCalls = [];
  saveColumnCalls = [];
  savePredicateCalls = [];
  const superstate = makeSuperstate(openMenuCalls, opts.subItemsSetup);
  const spaceState = {
    path: "Some Space",
    name: "Some Space",
    space: { readOnly: false },
    propertyTypes: [],
  } as any;
  const contextEditorValue = {
    source: "Some Space",
    dbSchema:
      opts.dbSchema ?? { id: "files", name: "Files", type: "db", primary: "true" },
    cols: opts.cols,
    filteredData: [],
    predicate: tablePredicate,
    savePredicate: (p: any) => savePredicateCalls.push(p),
    setSearchString: () => {},
    setEditMode: () => {},
    hideColumn: () => {},
    delColumn: () => {},
    saveColumn: (c: any) => {
      saveColumnCalls.push(c);
      return true;
    },
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

// Open the async view-options ("3 knobs") menu and return its options array.
const openViewOptionsMenu = async (): Promise<any[]> => {
  const viewOptions = container.querySelector(".mk-view-options")!;
  const toolbarButtons = Array.from(
    viewOptions.querySelectorAll("button.mk-toolbar-button")
  ) as HTMLButtonElement[];
  const knobsButton = toolbarButtons[toolbarButtons.length - 1];
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
  return openMenuCalls[openMenuCalls.length - 1].props.options ?? [];
};

// Invoke the "Sub-items" disclosure option's onClick and return the submenu
// props handed to the NEXT openMenu call.
const openSubItemsSubmenu = (options: any[]): any => {
  const subItemsOption = options.find((o: any) => o.name === "Sub-items");
  expect(subItemsOption).toBeTruthy();
  openMenuCalls.length = 0;
  act(() => {
    subItemsOption.onClick({
      currentTarget: { getBoundingClientRect: () => BUTTON_RECT },
      view: { document },
    });
  });
  expect(openMenuCalls.length).toBeGreaterThan(0);
  return openMenuCalls[openMenuCalls.length - 1].props;
};

const linkCol = { name: "Parent", type: "link", table: "", schemaId: "files" };
const plainCols = [{ name: "Status", type: "text", table: "", schemaId: "files" }];

describe("FilterBar sub-items front-door (Notidian-xqxc)", () => {
  it("flag ON + no eligible column: offers 'Turn on sub-items', and selecting it creates the link column + sets the predicate", async () => {
    mount({ subItemsSetup: true, cols: plainCols });
    const submenu = openSubItemsSubmenu(await openViewOptionsMenu());

    const names = submenu.options.map((o: any) => o.name);
    expect(names).toContain(i18n.menu.turnOnSubItems);

    // Selecting it routes through enableSubItemsWithColumn.
    act(() => submenu.saveOptions([], ["__create__"]));
    expect(saveColumnCalls).toHaveLength(1);
    expect(saveColumnCalls[0]).toEqual({
      name: "Parent item",
      type: "link",
      value: "",
      table: "",
      schemaId: "files",
      source: "frontmatter",
    });
    expect(savePredicateCalls).toContainEqual({ subItems: { field: "Parent item" } });
  });

  it("flag OFF (kill-switch) + no eligible: option absent — submenu is exactly [None]", async () => {
    mount({ subItemsSetup: false, cols: plainCols });
    const submenu = openSubItemsSubmenu(await openViewOptionsMenu());

    const names = submenu.options.map((o: any) => o.name);
    expect(names).not.toContain(i18n.menu.turnOnSubItems);
    expect(names).toEqual([i18n.menu.none]);
  });

  it("flag OFF (kill-switch) + eligible present: byte-for-byte legacy submenu [None, eligible] — no create option", async () => {
    mount({ subItemsSetup: false, cols: [...plainCols, linkCol] });
    const submenu = openSubItemsSubmenu(await openViewOptionsMenu());

    const names = submenu.options.map((o: any) => o.name);
    // Completes the 2x2 of {flag on/off} x {eligible present/absent}: OFF must
    // still surface the eligible column and never inject __create__.
    expect(names).toEqual([i18n.menu.none, "Parent"]);
  });

  it("eligible column present: the create option is hidden (reuse path), the eligible col is listed", async () => {
    mount({ subItemsSetup: true, cols: [...plainCols, linkCol] });
    const submenu = openSubItemsSubmenu(await openViewOptionsMenu());

    const names = submenu.options.map((o: any) => o.name);
    expect(names).not.toContain(i18n.menu.turnOnSubItems);
    // The eligible self-relation column is offered for direct designation.
    expect(names).toContain("Parent");
  });

  it("non-primary (non-files) schema: the create option is NOT offered — it can't round-trip there", async () => {
    mount({
      subItemsSetup: true,
      cols: plainCols,
      dbSchema: { id: "customTable", name: "Custom", type: "db", primary: "" },
    });
    const submenu = openSubItemsSubmenu(await openViewOptionsMenu());

    const names = submenu.options.map((o: any) => o.name);
    // Gated to the primary files schema (frontmatter materialization is
    // files-only), so on a custom db table the front-door must stay hidden.
    expect(names).not.toContain(i18n.menu.turnOnSubItems);
    expect(names).toEqual([i18n.menu.none]);
  });
});
