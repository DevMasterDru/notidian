/**
 * @jest-environment jsdom
 */
// H2 embed hygiene (Notidian-pb7p.2 / Atlas ADR-0096): hard read-only gates
// the FilterBar's WRITE affordances. With PathContext readMode true (an
// embed's editable:false surface), the bar must not render:
//   - the filter/sort/group-by chip rows + "+ Add Filter" (mk-filter-bar) —
//     the S3A live-verified friction,
//   - the inline view-settings write buttons (mk-view-settings-bar, or the
//     legacy bare trio when the kill-switch is OFF),
//   - the layout and 3-knobs (view options) menu buttons (every entry is a
//     write affordance).
// The search toggle stays — search is a local read operation. Row-edit
// affordances (+ new item) are explicitly out of H2 scope (ADR-0095).
//
// It re-declares the same heavy-graph mock surface the sibling
// FilterBar.viewSettings.dom.test.tsx uses (each dom test file owns its mocks).
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

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const makeSuperstate = (viewSettingsInlineBar: boolean): any => ({
  settings: { experimental: false, subItemsSetup: true, viewSettingsInlineBar },
  ui: {
    getSticker: () => "<svg><path d='M0 0h1v1H0z'></path></svg>",
    getScreenType: () => ScreenType.Desktop,
    openMenu: () => ({ update: () => {}, hide: () => {} }),
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

// A view that HAS filters, sort, and group-by — so the chip rows would render
// if readMode did not gate them.
const configuredPredicate = {
  view: "table",
  filters: [{ field: "Status", fn: "is", value: "Open", fType: "text" }],
  sort: [{ field: "Status", fn: "alphabetical" }],
  groupBy: ["Status"],
  listView: "",
  listGroup: "",
  listItem: "",
  listViewProps: {},
  listGroupProps: {},
  listItemProps: {},
  colsHidden: [],
  colsOrder: [],
  limit: 0,
} as any;

let root: Root;
let container: HTMLElement;

const plainCols = [{ name: "Status", type: "text", table: "", schemaId: "files" }];

const mount = (opts: {
  readMode: boolean;
  viewSettingsInlineBar?: boolean;
}) => {
  const superstate = makeSuperstate(opts.viewSettingsInlineBar ?? true);
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
    predicate: configuredPredicate,
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
        <PathContext.Provider value={{ readMode: opts.readMode } as any}>
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

describe("FilterBar read-mode gating (Notidian-pb7p.2 / Atlas ADR-0096 H2)", () => {
  it("hides the chip rows and + Add Filter in read mode", () => {
    mount({ readMode: true });

    expect(container.querySelector(".mk-filter-bar")).toBeNull();
    expect(container.querySelector(".mk-filter-add")).toBeNull();
    expect(container.querySelector(".mk-filter")).toBeNull();
  });

  it("hides the inline view-settings write buttons in read mode (flag ON)", () => {
    mount({ readMode: true, viewSettingsInlineBar: true });

    expect(container.querySelector(".mk-view-settings-bar")).toBeNull();
  });

  it("hides the legacy write trio in read mode (kill-switch OFF)", () => {
    mount({ readMode: true, viewSettingsInlineBar: false });

    expect(container.querySelector('button[aria-label="Filter"]')).toBeNull();
    expect(container.querySelector('button[aria-label="Sort"]')).toBeNull();
    expect(container.querySelector('button[aria-label="Group By"]')).toBeNull();
  });

  it("hides the layout and view-options menu buttons in read mode", () => {
    mount({ readMode: true });

    // The only surviving toolbar button in .mk-view-options is the search
    // toggle — layout and 3-knobs (both pure write menus) are gone.
    const viewOptions = container.querySelector(".mk-view-options")!;
    const toolbarButtons = Array.from(
      viewOptions.querySelectorAll("button.mk-toolbar-button")
    );
    expect(toolbarButtons).toHaveLength(1);
    expect(
      toolbarButtons[0].classList.contains("mk-view-search-toggle")
    ).toBe(true);
  });

  it("keeps the search toggle available in read mode", () => {
    mount({ readMode: true });

    expect(container.querySelector(".mk-view-search-toggle")).not.toBeNull();
  });

  it("renders chips and write buttons when not in read mode (gate polarity control)", () => {
    mount({ readMode: false });

    expect(container.querySelector(".mk-filter-bar")).not.toBeNull();
    expect(container.querySelector(".mk-filter-add")).not.toBeNull();
    expect(container.querySelector(".mk-view-settings-bar")).not.toBeNull();
    const viewOptions = container.querySelector(".mk-view-options")!;
    expect(
      viewOptions.querySelectorAll("button.mk-toolbar-button").length
    ).toBeGreaterThan(1);
  });
});
