/**
 * @jest-environment jsdom
 */
// Offline (jsdom) render-contract coverage for the grouping island header
// (Notidian-mx0k.2). Guarantees:
//
//   (1) ISLAND RENDERING: when the `groupingIslandHeader` kill-switch is ON and
//       the predicate has a valid `groupIsland` config, the group header displays
//       resolved target-record fields from the related database as text content
//       in a `.mk-group-header-island` span — text only (ADR 0017).
//
//   (2) KILL-SWITCH OFF: when the flag is false, the group header renders
//       byte-for-byte as the legacy header (no island metadata, no
//       `.mk-group-header-island` element).
//
//   (3) REGRESSION (no island config): grouped views without a `groupIsland`
//       predicate render identically to the existing group header tests.
//
//   (4) REGRESSION (ungrouped): ungrouped views are unaffected.
//
// Mirrors the harness in TableView.groupHeader.dom.test.tsx.
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

// --- Sever the heavy context graphs with fresh, real contexts ---------------
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
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  SelectOptionType: require("shared/types/menu").SelectOptionType,
}));

// --- Mock the heavy leaf children to recognizable sentinels -----------------
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
  () => ({
    ColumnHeader: (props: any) => (
      <div data-testid="col-header">{props.column?.name ?? ""}</div>
    ),
  })
);
jest.mock(
  "core/react/components/SpaceView/Contexts/TableView/SpaceChart",
  () => ({
    SpaceChart: () => <div data-testid="chart" />,
  })
);

const mockNewPathInSpace = jest.fn();
const mockNewRowPathInSpace = jest.fn();
jest.mock("core/superstate/utils/spaces", () => ({
  newPathInSpace: (...args: any[]) => mockNewPathInSpace(...args),
  newRowPathInSpace: (...args: any[]) => mockNewRowPathInSpace(...args),
}));

const mockSaveFrontmatterProperties = jest.fn();
jest.mock("core/utils/properties/frontmatterWrite", () => ({
  saveFrontmatterProperties: (...args: any[]) =>
    mockSaveFrontmatterProperties(...args),
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { SpaceContext } = require("core/react/context/SpaceContext");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { PathContext } = require("core/react/context/PathContext");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const {
  ContextEditorContext,
} = require("core/react/context/ContextEditorContext");

import { TableView, __resetTableUndoJournalForTest } from "./TableView";
import { PathPropertyName } from "shared/types/context";

// --- Scaffolding -----------------------------------------------------------

// A rollup column whose value JSON embeds a key-match config pointing at
// the "Boards" target folder.
const rollupColumnValue = JSON.stringify({
  ref: "board_ref",
  field: "board_name",
  fn: "values",
  keyMatch: {
    type: "key-match",
    sourceField: "board_id",
    targetFolder: "Hardware/Boards",
    targetField: "board_id",
  },
});

const cols = [
  {
    name: PathPropertyName,
    schemaId: "files",
    type: "fileprop",
    table: "",
    primary: "true",
  },
  {
    name: "board_id",
    schemaId: "files",
    type: "text",
    table: "",
    value: "",
  },
  {
    name: "board_rollup",
    schemaId: "files",
    type: "rollup",
    table: "",
    value: rollupColumnValue,
  },
] as any;

const groupedData = [
  { _index: "0", [PathPropertyName]: "02-ch01", board_id: "2" },
  { _index: "1", [PathPropertyName]: "02-ch05", board_id: "2" },
  { _index: "2", [PathPropertyName]: "03-ch01", board_id: "3" },
  { _index: "3", [PathPropertyName]: "03-ch02", board_id: "3" },
] as any[];

const ungroupedData = [
  { _index: "0", [PathPropertyName]: "Note A", board_id: "1" },
  { _index: "1", [PathPropertyName]: "Note B", board_id: "2" },
] as any[];

const basePredicate = {
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

const islandPredicate = {
  ...basePredicate,
  groupBy: ["board_id"],
  groupIsland: {
    relation: "board_rollup",
    fields: ["board_name", "model", "board_type"],
  },
};

const nonIslandGroupPredicate = {
  ...basePredicate,
  groupBy: ["board_id"],
};

// Build a superstate that has the Board Registry in its contextsIndex/pathsIndex.
const makeSuperstate = (
  flagOverrides: Partial<{
    groupingIslandHeader: boolean;
    contextPagination: number;
    rowVirtualization: boolean;
    defaultDateFormat: string;
    defaultTimeFormat: string;
  }> = {}
) => {
  const pathsIndex = new Map<string, any>();
  const contextsIndex = new Map<string, any>();

  // Board Registry target records
  const boardPaths = [
    "Hardware/Boards/slave-2.md",
    "Hardware/Boards/slave-3.md",
  ];
  pathsIndex.set("Hardware/Boards/slave-2.md", {
    metadata: {
      property: {
        board_id: "2",
        board_name: "Fill, Tap & Other Sols",
        model: "23IOB16",
        board_type: "SSR",
      },
    },
  });
  pathsIndex.set("Hardware/Boards/slave-3.md", {
    metadata: {
      property: {
        board_id: "3",
        board_name: "Nute Peris",
        model: "23IOD32",
        board_type: "SSR",
      },
    },
  });
  contextsIndex.set("Hardware/Boards", { paths: boardPaths });

  return {
    settings: {
      contextPagination: 25,
      rowVirtualization: false,
      groupingIslandHeader: true,
      defaultDateFormat: "MMM dd yyyy",
      defaultTimeFormat: "h:mm a",
      ...flagOverrides,
    },
    ui: {
      notify: jest.fn(),
      openPath: jest.fn(),
      openMenu: jest.fn(),
      openCustomMenu: jest.fn(() => ({ hide: jest.fn(), update: jest.fn() })),
      openModal: jest.fn(),
      getSticker: () => "",
      setActivePath: jest.fn(),
      primaryInteractionType: () => 1,
      getScreenType: () => 1,
    },
    pathsIndex,
    contextsIndex,
  } as any;
};

const makeContextValue = (data: any[], predicate: any, tableCols = cols) => ({
  tableData: { schema: { id: "files" }, rows: data, cols: tableCols },
  dbSchema: { id: "files", primary: "true" },
  contextTable: {},
  saveDB: jest.fn(),
  source: "Test/Space",
  selectedRows: [] as any[],
  selectRows: jest.fn(),
  sortedColumns: tableCols,
  filteredData: data,
  predicate,
  savePredicate: jest.fn(),
  saveColumn: jest.fn(),
  updateFieldValue: jest.fn(),
  updateValue: jest.fn(),
  applyValueEdits: jest.fn().mockResolvedValue({
    ok: true,
    applied: data.length,
    skipped: [],
    failed: [],
  }),
  applyTableEdits: jest.fn(),
  reloadContextData: jest.fn(),
  renameRowTitle: jest.fn(),
  setSearchActive: jest.fn(),
  subItemsInfo: null as any,
  collapsedSubItems: new Set<string>(),
  toggleSubItemCollapse: jest.fn(),
});

let container: HTMLDivElement;
let root: Root;

const render = async (
  data: any[],
  predicate: any,
  superstateOverrides: Parameters<typeof makeSuperstate>[0] = {},
  tableCols = cols
) => {
  const ss = makeSuperstate(superstateOverrides);
  await act(async () => {
    root.render(
      <SpaceContext.Provider
        value={{
          spaceInfo: { path: "Test/Space" },
          spaceState: { path: "Test/Space" },
        }}
      >
        <PathContext.Provider value={{ readMode: false }}>
          <ContextEditorContext.Provider
            value={makeContextValue(data, predicate, tableCols)}
          >
            <TableView superstate={ss} />
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
  __resetTableUndoJournalForTest();
  mockNewPathInSpace.mockReset();
  mockNewPathInSpace.mockResolvedValue("Test/Space/Note 5.md");
  mockNewRowPathInSpace.mockReset();
  mockNewRowPathInSpace.mockResolvedValue("Test/Space/Note 5.md");
  mockSaveFrontmatterProperties.mockReset();
  mockSaveFrontmatterProperties.mockResolvedValue({ ok: true });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const groupHeaderRows = () =>
  Array.from(
    container.querySelectorAll<HTMLTableRowElement>(
      "tbody tr.mk-row-group-header"
    )
  );

const islandSpans = () =>
  Array.from(
    container.querySelectorAll<HTMLSpanElement>(".mk-group-header-island")
  );

describe("grouping island header (Notidian-mx0k.2)", () => {
  it("displays resolved island fields in the group header when configured", async () => {
    await render(groupedData, islandPredicate);

    const headers = groupHeaderRows();
    expect(headers.length).toBe(2);

    const islands = islandSpans();
    expect(islands.length).toBe(2);

    // Board 2: "Fill, Tap & Other Sols", "23IOB16", "SSR"
    expect(islands[0].textContent).toContain("Fill, Tap & Other Sols");
    expect(islands[0].textContent).toContain("23IOB16");
    expect(islands[0].textContent).toContain("SSR");

    // Board 3: "Nute Peris", "23IOD32", "SSR"
    expect(islands[1].textContent).toContain("Nute Peris");
    expect(islands[1].textContent).toContain("23IOD32");
  });

  it("uses text content only, no innerHTML (ADR 0017)", async () => {
    await render(groupedData, islandPredicate);

    const islands = islandSpans();
    for (const island of islands) {
      // No child elements — text content only
      expect(island.children.length).toBe(0);
      // The span has a text node as its only child
      expect(island.childNodes.length).toBe(1);
      expect(island.childNodes[0].nodeType).toBe(Node.TEXT_NODE);
    }
  });

  it("formats island fields with em-dash separator and middle-dot delimiters", async () => {
    await render(groupedData, islandPredicate);

    const islands = islandSpans();
    // The format is " — field1 · field2 · field3"
    expect(islands[0].textContent).toMatch(
      /^\s*—\s*Fill, Tap & Other Sols\s*·\s*23IOB16\s*·\s*SSR$/
    );
  });

  it("shows no island when the kill-switch is OFF", async () => {
    await render(groupedData, islandPredicate, {
      groupingIslandHeader: false,
    });

    // Group headers still render
    const headers = groupHeaderRows();
    expect(headers.length).toBe(2);

    // But no island metadata
    expect(islandSpans().length).toBe(0);
  });

  it("shows no island when no groupIsland is configured (regression)", async () => {
    await render(groupedData, nonIslandGroupPredicate);

    // Group headers render normally
    const headers = groupHeaderRows();
    expect(headers.length).toBe(2);

    // No island metadata
    expect(islandSpans().length).toBe(0);

    // Standard group header structure is intact
    for (const header of headers) {
      expect(header.querySelector(".mk-group-header")).not.toBeNull();
      expect(header.querySelector(".mk-group-header-caret")).not.toBeNull();
      expect(
        header.querySelector(".mk-group-header-label-button")
      ).not.toBeNull();
      expect(header.querySelector(".mk-group-header-count")).not.toBeNull();
    }
  });

  it("ungrouped views are unaffected (regression)", async () => {
    await render(ungroupedData, basePredicate);

    // No group headers at all
    expect(groupHeaderRows().length).toBe(0);

    // No island metadata
    expect(islandSpans().length).toBe(0);

    // Data rows render normally
    const dataRows = container.querySelectorAll("tbody tr[data-row-id]");
    expect(dataRows.length).toBe(ungroupedData.length);
  });

  it("shows no island for the 'No <prop>' empty group", async () => {
    const dataWithEmpty = [
      ...groupedData,
      { _index: "4", [PathPropertyName]: "Empty", board_id: "" },
    ] as any[];

    await render(dataWithEmpty, islandPredicate);

    // Three groups: "2", "3", and "No board_id"
    const headers = groupHeaderRows();
    expect(headers.length).toBe(3);

    // Only two islands (for "2" and "3"), not three
    expect(islandSpans().length).toBe(2);
  });
});
