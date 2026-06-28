/**
 * @jest-environment jsdom
 */
import React from "react";
import { act } from "react-dom/test-utils";
import { createRoot, Root } from "react-dom/client";
import { PathPropertyName } from "shared/types/context";

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
jest.mock("core/utils/contexts/context", () => ({
  deleteRowsInTable: jest.fn(async () => {}),
  removePathInContexts: jest.fn(),
}));
jest.mock("core/superstate/utils/path", () => ({
  deletePath: jest.fn(),
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

const cols = [
  {
    name: PathPropertyName,
    schemaId: "table",
    type: "fileprop",
    table: "",
    primary: "true",
  },
  { name: "Status", schemaId: "table", type: "text", table: "" },
] as any;

const rows = [
  { _index: "0", [PathPropertyName]: "Rows/A.md", Status: "open" },
  { _index: "1", [PathPropertyName]: "Rows/B.md", Status: "done" },
] as any[];

const predicate = {
  filters: [],
  sort: [],
  groupBy: [],
  colsOrder: [],
  colsHidden: [],
  colsSize: {},
  colsCalc: {},
  colsWrap: {},
  colsHeaderDisplay: {},
  colsDataAnchor: {},
  view: "table",
  listItem: "",
  tableDirection: "ltr",
  frozenColumnCount: 0,
} as any;

const selectRows = jest.fn();

const contextValue = {
  tableData: { schema: { id: "table" }, rows, cols },
  dbSchema: { id: "table", primary: "false" },
  contextTable: {},
  saveDB: jest.fn(),
  source: "Rows",
  selectedRows: [],
  selectRows,
  sortedColumns: cols,
  filteredData: rows,
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
  subItemsField: null,
  subItemsParentKey: null,
  collapsedSubItems: new Set<string>(),
  toggleSubItemCollapse: jest.fn(),
  subItemAddRows: null,
  subItemsTreeNodes: null,
} as any;

const superstate = {
  settings: {
    contextPagination: 25,
    rowVirtualization: false,
    defaultDateFormat: "MMM dd yyyy",
    defaultTimeFormat: "h:mm a",
  },
  ui: {
    notify: jest.fn(),
    openPath: jest.fn(),
    openMenu: jest.fn(),
    getSticker: () => "",
    setActivePath: jest.fn(),
    primaryInteractionType: () => 1,
    getScreenType: () => 1,
  },
  spaceManager: {
    spaceInfoForPath: jest.fn(() => ({ path: "Rows" })),
  },
  pathsIndex: new Map(),
} as any;

let container: HTMLDivElement;
let root: Root;

const render = async () => {
  await act(async () => {
    root.render(
      <SpaceContext.Provider
        value={{
          spaceInfo: { path: "Rows" },
          spaceState: { path: "Rows" },
        }}
      >
        <PathContext.Provider value={{ readMode: false }}>
          <ContextEditorContext.Provider value={contextValue}>
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

const stubRect = (el: Element, rect: { left: number; top: number }) => {
  (el as any).getBoundingClientRect = () => ({
    left: rect.left,
    top: rect.top,
    x: rect.left,
    y: rect.top,
    right: rect.left + 300,
    bottom: rect.top + 200,
    width: 300,
    height: 200,
    toJSON: () => ({}),
  });
};

beforeEach(() => {
  selectRows.mockClear();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("TableView row marquee geometry", () => {
  it("starts under the cursor when the table scroll container is scrolled", async () => {
    await render();

    const table = container.querySelector(".mk-table") as HTMLElement;
    stubRect(table, { left: 100, top: 200 });
    table.scrollLeft = 40;
    table.scrollTop = 60;

    const selector = container.querySelector(".mk-row-selector") as HTMLElement;
    await act(async () => {
      selector.dispatchEvent(
        new MouseEvent("mousedown", {
          bubbles: true,
          cancelable: true,
          button: 0,
          clientX: 120,
          clientY: 230,
        })
      );
      await Promise.resolve();
    });

    const marquee = container.querySelector(".mk-row-marquee") as HTMLElement;
    expect(marquee).toBeTruthy();
    expect(marquee.style.left).toBe("60px");
    expect(marquee.style.top).toBe("90px");
    expect(selectRows).toHaveBeenCalledWith("0", ["0"]);
  });
});
