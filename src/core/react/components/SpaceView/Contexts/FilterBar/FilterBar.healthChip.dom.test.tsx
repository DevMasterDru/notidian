/**
 * @jest-environment jsdom
 */
// Offline (jsdom) coverage for the Data Integrity Program header chip
// (Notidian-loan.5, ADR-0057 D3/D4 -- review round 2, unit tests #2). Mirrors
// FilterBar.viewSettings.dom.test.tsx's heavy-graph mock surface (each dom
// test file owns its mocks).
//
// Proves: the chip only renders when the kill-switch is ON; its
// data-violation-count reflects getViolationCount(dbPath); a reconciler
// onChange bump forces a re-render with a fresh count (scoped to THIS view's
// own dbPath -- Notidian-loan.5 review round 2 unit S1); and clicking it
// opens a modal carrying a DatabaseHealthPanel for this view's dbPath.
import React from "react";
import { act } from "react-dom/test-utils";
import { createRoot, Root } from "react-dom/client";
import { EventDispatcher } from "shared/utils/dispatchers/dispatcher";

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

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

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
} as any;

const plainCols = [{ name: "Status", type: "text", table: "", schemaId: "files" }];

let container: HTMLElement;
let root: Root;
let openMenuCalls: any[];
let openModalCalls: any[];

const makeSuperstate = (opts: {
  enableDataHealthSurfaces?: boolean;
  violationCount?: number;
  onChangeImpl?: jest.Mock;
}): any => {
  openMenuCalls = [];
  openModalCalls = [];
  return {
    settings: {
      experimental: false,
      subItemsSetup: true,
      viewSettingsInlineBar: false,
      enableDataHealthSurfaces: opts.enableDataHealthSurfaces ?? true,
    },
    ui: {
      getSticker: () => "<svg><path d='M0 0h1v1H0z'></path></svg>",
      getScreenType: () => 0,
      openMenu: (_rect: any, props: any) => {
        openMenuCalls.push({ props });
        return { update: () => {}, hide: () => {} };
      },
      openModal: (title: string, el: React.ReactElement) => {
        openModalCalls.push({ title, el });
      },
      notify: () => {},
    },
    spaceManager: {
      uriByString: (s: string) => ({ path: s, ref: null as string | null, authority: "" }),
      readFrame: async (): Promise<{ cols: unknown[] }> => ({ cols: [] }),
      readTags: (): string[] => [],
    },
    eventsDispatcher: new EventDispatcher(),
    reconciler: {
      onChange:
        opts.onChangeImpl ?? jest.fn(() => () => {}),
      getViolationCount: jest.fn(() => opts.violationCount ?? 0),
    },
    spacesIndex: new Map([["Some Space", { name: "Some Space" }]]),
    contextsIndex: new Map([["Some Space", { schemas: [] }]]),
    pathsIndex: new Map(),
    spacesMap: { getInverse: () => new Set<string>() },
    kitFrames: new Map(),
    getSpaceItems: (): unknown[] => [],
  };
};

const mount = (superstate: any) => {
  const spaceState = {
    path: "Some Space",
    name: "Some Space",
    space: { readOnly: false },
    propertyTypes: [],
  } as any;
  const contextEditorValue = {
    source: "Some Space",
    dbSchema: { id: "files", name: "Files", type: "db", primary: "true" },
    cols: plainCols,
    filteredData: [],
    predicate: basePredicate,
    savePredicate: () => {},
    setSearchString: () => {},
    setEditMode: () => {},
    hideColumn: () => {},
    delColumn: () => {},
    saveColumn: () => true,
    reloadContextData: async () => {},
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
};

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const chip = (): HTMLButtonElement | null =>
  container.querySelector(".mk-db-health-chip");

describe("FilterBar health chip (Notidian-loan.5 review round 2, unit tests #2)", () => {
  it("renders only when the kill-switch is ON", () => {
    mount(makeSuperstate({ enableDataHealthSurfaces: false }));
    expect(chip()).toBeNull();
  });

  it("carries data-violation-count reflecting getViolationCount for THIS view's dbPath", () => {
    const superstate = makeSuperstate({ violationCount: 3 });
    mount(superstate);
    expect(superstate.reconciler.getViolationCount).toHaveBeenCalledWith(
      "Some Space"
    );
    expect(chip()!.getAttribute("data-violation-count")).toBe("3");
  });

  it("re-renders the count when a matching-dbPath onChange bump fires (S1 dbPath-scoping honored)", () => {
    let listener: ((dbPath?: string) => void) | undefined;
    let currentCount = 0;
    const superstate = makeSuperstate({
      onChangeImpl: jest.fn((l: (dbPath?: string) => void) => {
        listener = l;
        return () => {};
      }),
    });
    superstate.reconciler.getViolationCount = jest.fn(() => currentCount);
    mount(superstate);
    expect(chip()!.getAttribute("data-violation-count")).toBe("0");

    // An unrelated database's mutation must NOT bump this chip's count.
    currentCount = 9;
    act(() => {
      listener?.("Some Other Space");
    });
    expect(chip()!.getAttribute("data-violation-count")).toBe("0");

    // THIS view's own database mutating DOES bump it.
    act(() => {
      listener?.("Some Space");
    });
    expect(chip()!.getAttribute("data-violation-count")).toBe("9");
  });

  it("clicking calls ui.openModal with a DatabaseHealthPanel for this view's dbPath", () => {
    const superstate = makeSuperstate({});
    mount(superstate);
    act(() => {
      chip()!.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true, view: window })
      );
    });
    expect(openModalCalls).toHaveLength(1);
    expect(openModalCalls[0].el.type.name).toBe("DatabaseHealthPanel");
    expect(openModalCalls[0].el.props.dbPath).toBe("Some Space");
  });
});
