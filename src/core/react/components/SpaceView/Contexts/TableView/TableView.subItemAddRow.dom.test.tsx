/**
 * @jest-environment jsdom
 */
// Offline (jsdom) coverage for the Notion-style "+ New sub-item" row (Notidian-gr8t).
// The add-row is PURELY PRESENTATIONAL: it renders after an expanded parent's last
// visible descendant, carries NO data-row-id (so it is invisible to selection /
// drag / copy DOM scans), and on click calls the one-way create path with the
// parent's path. This pins: it renders where the provider's subItemAddRows Map says,
// it is excluded from the real-row set, clicking creates a child of the right parent,
// and the kill-switch (provider returns null) removes it.
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
// Capture the one-way create call.
const createSubItemRowMock = jest.fn(
  (..._args: any[]) => Promise.resolve("Test/Space/Child.md")
);
jest.mock("core/utils/contexts/subItemCreate", () => ({
  createSubItemRow: (...args: any[]) => createSubItemRowMock(...args),
}));

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
// eslint-disable-next-line @typescript-eslint/no-var-requires
const i18n = require("shared/i18n").default ?? require("shared/i18n");

const cols = [
  { name: PathPropertyName, schemaId: "files", type: "fileprop", table: "", primary: "true" },
  { name: "Name", schemaId: "files", type: "text", table: "" },
] as any;

// Parent "Note 0" (expanded, has the child) + child "Note 1".
const data = [
  { _index: "0", [PathPropertyName]: "Note 0", Name: "parent" },
  { _index: "1", [PathPropertyName]: "Note 1", Name: "child" },
];

const subItemsInfo = new Map<string, any>([
  ["Note 0", { depth: 0, hasChildren: true, childCount: 1, surfacedAsRoot: false }],
  ["Note 1", { depth: 1, hasChildren: false, childCount: 0, surfacedAsRoot: false }],
]);

const predicate = {
  filters: [], sort: [], groupBy: [], colsOrder: [], colsHidden: [],
  colsSize: {}, colsCalc: {}, colsWrap: {}, colsHeaderDisplay: {}, colsDataAnchor: {},
  view: "table", listItem: "", tableDirection: "ltr", frozenColumnCount: 0,
} as any;

const makeContextValue = (subItemAddRows: any) =>
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
    subItemsInfo,
    subItemsField: "parent",
    collapsedSubItems: new Set<string>(),
    toggleSubItemCollapse: jest.fn(),
    subItemAddRows,
  } as any);

const superstate = {
  settings: { contextPagination: 25, rowVirtualization: true },
  ui: {
    notify: jest.fn(), openPath: jest.fn(), openMenu: jest.fn(),
    getSticker: () => "", setActivePath: jest.fn(),
    primaryInteractionType: () => 1, getScreenType: () => 1,
  },
  pathsIndex: new Map(),
} as any;

let container: HTMLDivElement;
let root: Root;

const render = async (subItemAddRows: any) => {
  await act(async () => {
    root.render(
      <SpaceContext.Provider
        value={{ spaceInfo: { path: "Test/Space" }, spaceState: { path: "Test/Space" } }}
      >
        <PathContext.Provider value={{ readMode: false }}>
          <ContextEditorContext.Provider value={makeContextValue(subItemAddRows)}>
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
  createSubItemRowMock.mockClear();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const addRowsMap = new Map([["Note 1", [{ parentPath: "Note 0", depth: 1 }]]]);

describe("TableView '+ New sub-item' row (Notidian-gr8t)", () => {
  it("renders one add-row after the parent's last child, labelled, with NO data-row-id", async () => {
    await render(addRowsMap);
    const addRows = container.querySelectorAll("tbody tr.mk-subitem-add-row");
    expect(addRows.length).toBe(1);
    expect(addRows[0].textContent).toContain(i18n.hintText.newSubItem);
    // Selection/drag/copy DOM scans key off tr[data-row-id]; the add-row must be
    // excluded so it never participates.
    expect((addRows[0] as HTMLElement).hasAttribute("data-row-id")).toBe(false);
    const realRows = container.querySelectorAll("tbody tr[data-row-id]");
    expect(realRows.length).toBe(2); // exactly the two data rows
  });

  it("clicking the add-row creates a child of THAT parent via the one-way path", async () => {
    await render(addRowsMap);
    const cell = container.querySelector(
      "tbody tr.mk-subitem-add-row .mk-subitem-add-cell"
    ) as HTMLElement;
    expect(cell).toBeTruthy();
    act(() => {
      cell.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });
    expect(createSubItemRowMock).toHaveBeenCalledTimes(1);
    const arg = createSubItemRowMock.mock.calls[0][0];
    expect(arg.parentPath).toBe("Note 0");
    expect(arg.subItemsField).toBe("parent");
    expect(arg.contextPath).toBe("Test/Space");
  });

  it("kill-switch: when the provider supplies no add-rows, none render", async () => {
    await render(null);
    expect(container.querySelectorAll("tbody tr.mk-subitem-add-row").length).toBe(0);
    // real rows unaffected
    expect(container.querySelectorAll("tbody tr[data-row-id]").length).toBe(2);
  });

  it("shows a child-count badge on the parent (Notidian-5ond.6)", async () => {
    await render(addRowsMap);
    const badges = container.querySelectorAll(".mk-subitem-count");
    // Only the parent ("Note 0", childCount 1) gets a badge; the leaf does not.
    expect(badges.length).toBe(1);
    expect(badges[0].textContent).toBe("1");
  });
});
