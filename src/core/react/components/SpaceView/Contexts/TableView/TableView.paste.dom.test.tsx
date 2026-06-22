/**
 * @jest-environment jsdom
 */
import React from "react";
import { act } from "react-dom/test-utils";
import { createRoot, Root } from "react-dom/client";
import { frontmatterPropertySource } from "core/utils/properties/allProperties";
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

const columns = [
  {
    name: PathPropertyName,
    schemaId: "files",
    type: "fileprop",
    table: "",
    primary: "true",
  },
  {
    name: "Status",
    schemaId: "files",
    type: "text",
    table: "",
    source: frontmatterPropertySource,
  },
  {
    name: "Rating",
    schemaId: "files",
    type: "number",
    table: "",
    source: frontmatterPropertySource,
  },
] as any;

const rows = [
  {
    _index: "0",
    [PathPropertyName]: "Test/One.md",
    Status: "old-one",
    Rating: "1",
  },
  {
    _index: "1",
    [PathPropertyName]: "Test/Two.md",
    Status: "old-two",
    Rating: "2",
  },
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

const applyTableEdits = jest.fn(async (writes) => ({
  ok: true,
  applied: writes.length,
  skipped: [] as any[],
  failed: [] as any[],
}));

const contextValue = {
  tableData: { schema: { id: "files" }, rows, cols: columns },
  dbSchema: { id: "files", primary: "true" },
  contextTable: {},
  saveDB: jest.fn(),
  source: "Test",
  selectedRows: [],
  selectRows: jest.fn(),
  sortedColumns: columns,
  filteredData: rows,
  predicate,
  savePredicate: jest.fn(),
  updateFieldValue: jest.fn(),
  updateValue: jest.fn(),
  applyValueEdits: jest.fn(),
  applyTableEdits,
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
  pathsIndex: new Map(),
} as any;

let container: HTMLDivElement;
let root: Root;

const render = async () => {
  await act(async () => {
    root.render(
      <SpaceContext.Provider
        value={{
          spaceInfo: { path: "Test" },
          spaceState: { path: "Test" },
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

const cellAt = (row: number, column: number): HTMLElement => {
  const dataRows = container.querySelectorAll<HTMLTableRowElement>(
    "tbody tr[data-row-id]"
  );
  return dataRows[row].querySelectorAll<HTMLElement>("td.mk-td")[column];
};

beforeEach(() => {
  applyTableEdits.mockClear();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("TableView multi-cell paste bridge", () => {
  it("routes a 2 by 2 clipboard grid to the selected 2 by 2 cells", async () => {
    await render();
    const clipboardDescriptor = Object.getOwnPropertyDescriptor(
      navigator,
      "clipboard"
    );
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { readText: jest.fn(async () => "open\t10\nclosed\t20") },
    });

    try {
      await act(async () => {
        cellAt(0, 1).dispatchEvent(
          new MouseEvent("mousedown", { bubbles: true, buttons: 1 })
        );
      });
      await act(async () => {
        cellAt(1, 2).dispatchEvent(
          new MouseEvent("mousedown", {
            bubbles: true,
            buttons: 1,
            shiftKey: true,
          })
        );
      });
      await act(async () => {
        (container.querySelector(".mk-table") as HTMLElement).dispatchEvent(
          new KeyboardEvent("keydown", {
            bubbles: true,
            cancelable: true,
            key: "v",
            metaKey: true,
          })
        );
        await Promise.resolve();
        await Promise.resolve();
      });
    } finally {
      if (clipboardDescriptor) {
        Object.defineProperty(navigator, "clipboard", clipboardDescriptor);
      } else {
        delete (navigator as any).clipboard;
      }
    }

    expect(applyTableEdits).toHaveBeenCalledWith([
      expect.objectContaining({
        rowId: "0",
        columnId: "Status",
        value: "open",
      }),
      expect.objectContaining({
        rowId: "0",
        columnId: "Rating",
        value: "10",
      }),
      expect.objectContaining({
        rowId: "1",
        columnId: "Status",
        value: "closed",
      }),
      expect.objectContaining({
        rowId: "1",
        columnId: "Rating",
        value: "20",
      }),
    ]);
  });
});
