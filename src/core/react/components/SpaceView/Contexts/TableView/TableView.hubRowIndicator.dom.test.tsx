/**
 * @jest-environment jsdom
 */
// Offline (jsdom) render-contract coverage for the row-as-child-hub indicator
// WIRING (Notidian-b0fm) — the wiring half of the bead that neither the
// standalone HubRowIndicator.dom.test.tsx (component contract) nor
// hubRowCascade.test.ts (pure shouldRenderHubRowIndicator gate) covers. It
// pins the DEFAULT-OFF flag gate end-to-end in the real TableView gutter,
// mirroring TableView.subItemAddRow.dom.test.tsx's "mock the heavy leaves,
// assert the flag-branch wiring" harness and MainList.filterKillSwitch.dom.test's
// flag-ON-renders / flag-OFF-absent precedent:
//
//   - flag OFF (enableHubRowIndicator=false, the default): NO
//     `.mk-hub-row-indicator` renders — byte-identical to the pre-feature
//     gutter, even for a genuine hub row.
//   - underlying nested-hub feature OFF (enableNestedHubRows=false): absent too
//     (the indicator makes no sense without the cascade/discovery behavior).
//   - non-hub row (no configured sibling folder): absent even with both flags
//     ON — the affordance can never appear on an ordinary row.
//   - flag ON + real hub row: exactly one indicator renders, and clicking it
//     opens that row's nested child-database folder via ui.openPath.
import React from "react";
import { act } from "react-dom/test-utils";
import { createRoot, Root } from "react-dom/client";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
if (typeof (globalThis as any).ResizeObserver === "undefined") {
  (globalThis as any).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

jest.mock("core/react/context/SpaceContext", () => ({
  SpaceContext: require("react").createContext(null),
}));
jest.mock("core/react/context/PathContext", () => ({
  PathContext: require("react").createContext({ readMode: false }),
}));
jest.mock("core/react/context/ContextEditorContext", () => ({
  ContextEditorContext: require("react").createContext(null),
}));
jest.mock("makemd-core", () => ({
  SelectOptionType: require("shared/types/menu").SelectOptionType,
}));
jest.mock(
  "core/react/components/SpaceView/Contexts/DataTypeView/DataTypeView",
  () => ({
    DataTypeView: (props: any) => (
      <span data-testid="cell">{String(props.initialValue ?? "")}</span>
    ),
  })
);
jest.mock(
  "core/react/components/SpaceView/Contexts/TableView/ColumnHeader",
  () => ({ ColumnHeader: () => <div data-testid="col-header" /> })
);
jest.mock(
  "core/react/components/SpaceView/Contexts/TableView/SpaceChart",
  () => ({ SpaceChart: () => <div data-testid="chart" /> })
);

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { SpaceContext } = require("core/react/context/SpaceContext");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { PathContext } = require("core/react/context/PathContext");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const {
  ContextEditorContext,
} = require("core/react/context/ContextEditorContext");

import { TableView } from "./TableView";
import { PathPropertyName } from "shared/types/context";

// "Test/Space/Gidi.md" is a row of the Space database AND the configured note
// of the same-named sibling folder "Test/Space/Gidi" (adjacent mode) — the
// hub-row relationship isHubRowPath keys off.
const HUB_ROW_PATH = "Test/Space/Gidi.md";
const HUB_ROW_FOLDER = "Test/Space/Gidi";

const cols = [
  { name: PathPropertyName, schemaId: "files", type: "fileprop", table: "", primary: "true" },
  { name: "Name", schemaId: "files", type: "text", table: "" },
] as any;

const data = [{ _index: "0", [PathPropertyName]: HUB_ROW_PATH, Name: "hub" }];

const predicate = {
  filters: [], sort: [], groupBy: [], colsOrder: [], colsHidden: [],
  colsSize: {}, colsCalc: {}, colsWrap: {}, colsHeaderDisplay: {}, colsDataAnchor: {},
  view: "table", listItem: "", tableDirection: "ltr", frozenColumnCount: 0,
} as any;

const makeContextValue = () =>
  ({
    tableData: { schema: { id: "files" }, rows: data, cols },
    dbSchema: { id: "files", primary: "true" },
    contextTable: {},
    saveDB: jest.fn(),
    source: "Test/Space",
    selectedRows: [],
    selectRows: jest.fn(),
    sortedColumns: cols,
    filteredData: data,
    predicate,
    savePredicate: jest.fn(),
    updateFieldValue: jest.fn(),
    updateValue: jest.fn(),
    applyValueEdits: jest.fn(),
    applyTableEdits: jest.fn(),
    reloadContextData: jest.fn(),
    renameRowTitle: jest.fn(),
    setSearchActive: jest.fn(),
    subItemsInfo: null,
    subItemsDisplay: "nested",
    collapsedSubItems: new Set<string>(),
    toggleSubItemCollapse: jest.fn(),
    subItemAddRows: null,
  } as any);

// `hubIndexed` seeds spacesIndex so HUB_ROW_FOLDER's configured note IS the
// row's file (a genuine hub row). Omit it for the "ordinary row" case.
const makeSuperstate = (opts: {
  enableHubRowIndicator: boolean;
  enableNestedHubRows: boolean;
  hubIndexed?: boolean;
}) => {
  const spacesIndex = new Map<string, any>();
  if (opts.hubIndexed) {
    spacesIndex.set(HUB_ROW_FOLDER, { space: { notePath: HUB_ROW_PATH } });
  }
  return {
    settings: {
      contextPagination: 25,
      rowVirtualization: false,
      enableHubRowIndicator: opts.enableHubRowIndicator,
      enableNestedHubRows: opts.enableNestedHubRows,
    },
    ui: {
      notify: jest.fn(),
      openPath: jest.fn(),
      openMenu: jest.fn(),
      getSticker: () => '<svg data-testid="hub-sticker"></svg>',
      setActivePath: jest.fn(),
      primaryInteractionType: () => 1,
      getScreenType: () => 1,
    },
    spacesIndex,
    pathsIndex: new Map(),
  } as any;
};

let container: HTMLDivElement;
let root: Root;

const render = async (superstate: any) => {
  await act(async () => {
    root.render(
      <SpaceContext.Provider
        value={{ spaceInfo: { path: "Test/Space" }, spaceState: { path: "Test/Space" } }}
      >
        <PathContext.Provider value={{ readMode: false }}>
          <ContextEditorContext.Provider value={makeContextValue()}>
            <TableView superstate={superstate} />
          </ContextEditorContext.Provider>
        </PathContext.Provider>
      </SpaceContext.Provider>
    );
  });
  await act(async () => {
    await Promise.resolve();
  });
};

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("TableView hub-row indicator wiring (Notidian-b0fm)", () => {
  it("flag OFF (default) + real hub row: no indicator renders (legacy gutter)", async () => {
    await render(
      makeSuperstate({
        enableHubRowIndicator: false,
        enableNestedHubRows: true,
        hubIndexed: true,
      })
    );
    expect(container.querySelector(".mk-hub-row-indicator")).toBeNull();
    // The row itself still renders normally (gutter unchanged).
    expect(container.querySelectorAll("tbody tr[data-row-id]").length).toBe(1);
  });

  it("underlying nested-hub feature OFF + real hub row: no indicator renders", async () => {
    await render(
      makeSuperstate({
        enableHubRowIndicator: true,
        enableNestedHubRows: false,
        hubIndexed: true,
      })
    );
    expect(container.querySelector(".mk-hub-row-indicator")).toBeNull();
  });

  it("both flags ON but the row is NOT a configured hub row: no indicator renders", async () => {
    await render(
      makeSuperstate({
        enableHubRowIndicator: true,
        enableNestedHubRows: true,
        hubIndexed: false,
      })
    );
    expect(container.querySelector(".mk-hub-row-indicator")).toBeNull();
  });

  it("both flags ON + real hub row: exactly one indicator renders", async () => {
    await render(
      makeSuperstate({
        enableHubRowIndicator: true,
        enableNestedHubRows: true,
        hubIndexed: true,
      })
    );
    const indicators = container.querySelectorAll(".mk-hub-row-indicator");
    expect(indicators.length).toBe(1);
    // The sticker HTML from getSticker made it in (component wiring intact).
    expect(container.querySelector('[data-testid="hub-sticker"]')).not.toBeNull();
  });

  it("clicking the indicator opens the row's nested child-database folder", async () => {
    const superstate = makeSuperstate({
      enableHubRowIndicator: true,
      enableNestedHubRows: true,
      hubIndexed: true,
    });
    await render(superstate);
    const button = container.querySelector(
      ".mk-hub-row-indicator"
    ) as HTMLButtonElement;
    expect(button).not.toBeNull();
    await act(async () => {
      button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(superstate.ui.openPath).toHaveBeenCalledWith(HUB_ROW_FOLDER, false);
  });
});
