/**
 * @jest-environment jsdom
 */
// Offline (jsdom) render-contract coverage for the grouped-view group header
// (Notidian-brlx). Two guarantees:
//
//   (1) CORRECTNESS (clear-correct): a group-header row is NOT a data row and
//       must render NO row-number gutter value. The subtle defect: react-table's
//       getGroupedRowModel builds a grouped row with `leafRows[0].original` as its
//       `.original`, so `row.original._index` on a group header is the FIRST
//       CHILD'S index — defined, not undefined. The pre-fix discriminator
//       (`_index === undefined`) therefore mis-classified group headers as data
//       rows and rendered them a row-number gutter + drag handle. The reliable
//       discriminator is `row.getIsGrouped()`. This test asserts the rendered
//       group header carries no `.mk-row-number` and no drag handle, while a
//       normal data row in the same table still does.
//
//   (2) ISLAND STYLING (owner-requested render-path): the group header is marked
//       as a distinct island band (`.mk-row-group-header` on the <tr>, the
//       `.mk-group-header` band button with caret + count) — the hooks the CSS
//       lifts into a Notion-like group band. (The visual is owner-verified live
//       via deploy:vault; here we assert the markup hooks render.)
//
// Mirrors the harness in TableView.virtualization.dom.test.tsx (fresh real
// contexts + sentinel leaf mocks) so the REAL TableView grouped-body branch runs
// over a genuine getGroupedRowModel without mounting the Obsidian editor graph.
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

// --- Sever the heavy context graphs with fresh, real contexts -------------
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

// --- Mock the heavy leaf children to recognizable sentinels ---------------
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

// --- Scaffolding ----------------------------------------------------------

const cols = [
  {
    name: PathPropertyName,
    schemaId: "files",
    type: "fileprop",
    table: "",
    primary: "true",
  },
  { name: "Status", schemaId: "files", type: "text", table: "" },
] as any;

// Two distinct Status values -> two groups, each with multiple member rows.
const groupedData = [
  { _index: "0", [PathPropertyName]: "Note 0", Status: "Open" },
  { _index: "1", [PathPropertyName]: "Note 1", Status: "Open" },
  { _index: "2", [PathPropertyName]: "Note 2", Status: "Done" },
  { _index: "3", [PathPropertyName]: "Note 3", Status: "Done" },
  { _index: "4", [PathPropertyName]: "Note 4", Status: "Open" },
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

const makeSuperstate = () =>
  ({
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
  } as any);

const makeContextValue = (data: any[], predicate: any) =>
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
    collapsedSubItems: new Set<string>(),
    toggleSubItemCollapse: jest.fn(),
  } as any);

let container: HTMLDivElement;
let root: Root;

const render = async (data: any[], predicate: any) => {
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
            value={makeContextValue(data, predicate)}
          >
            <TableView superstate={makeSuperstate()} />
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

const groupHeaderRows = () =>
  Array.from(
    container.querySelectorAll<HTMLTableRowElement>(
      "tbody tr.mk-row-group-header"
    )
  );

describe("grouped view group header (Notidian-brlx)", () => {
  it("renders group-header islands distinct from data rows", async () => {
    await render(groupedData, { ...basePredicate, groupBy: ["Status"] });

    // The view is genuinely grouped: at least one group-header island exists.
    const headers = groupHeaderRows();
    expect(headers.length).toBeGreaterThan(0);
    // Two distinct Status values -> two groups.
    expect(headers.length).toBe(2);

    // Each island carries the band markup the CSS lifts into a Notion-like band:
    // a collapse caret, a label, and a count badge.
    for (const header of headers) {
      expect(header.querySelector(".mk-group-header")).not.toBeNull();
      expect(header.querySelector(".mk-group-header-caret")).not.toBeNull();
      expect(header.querySelector(".mk-group-header-count")).not.toBeNull();
      // The header spans the columns via the dedicated group cell, not per-column
      // data cells.
      expect(header.querySelector(".mk-td-group")).not.toBeNull();
    }
  });

  it("group headers show NO row-number gutter value and no drag handle", async () => {
    await render(groupedData, { ...basePredicate, groupBy: ["Status"] });

    const headers = groupHeaderRows();
    expect(headers.length).toBeGreaterThan(0);

    for (const header of headers) {
      // The clear-correct guarantee: a group header is NOT a data row, so it must
      // render no row-number value and no row drag handle — even though its
      // react-table `.original` inherits the first child row's `_index`.
      expect(header.querySelector(".mk-row-number")).toBeNull();
      expect(header.querySelector(".mk-row-drag-handle")).toBeNull();
      // Its gutter cell is part of the island band, not a numbered data gutter.
      expect(header.querySelector(".mk-row-gutter-group")).not.toBeNull();
      // A group header carries no data-row identity on its <tr>.
      expect(header.getAttribute("data-row-id")).toBeFalsy();
    }
  });

  it("data rows in a grouped view still show their row number", async () => {
    await render(groupedData, { ...basePredicate, groupBy: ["Status"] });

    // Sanity: the fix did not strip row numbers from genuine data rows. Data rows
    // carry a data-row-id and a numbered gutter; group headers do not.
    const dataRows = Array.from(
      container.querySelectorAll<HTMLTableRowElement>(
        "tbody tr[data-row-id]"
      )
    ).filter((tr) => !tr.classList.contains("mk-row-group-header"));
    expect(dataRows.length).toBe(groupedData.length);
    for (const dataRow of dataRows) {
      expect(dataRow.querySelector(".mk-row-number")).not.toBeNull();
    }
  });

  // Notidian-kxka: rows with NO value for the grouped property must be shown as a
  // single "No <property>" ungrouped group — never dropped, and never split into
  // two separate blank bands. tanstack keys groups by String(groupingValue), so
  // an ABSENT value (key "undefined") and an EMPTY value (key "") would otherwise
  // render as two distinct unlabeled headers that read as "missing".
  const groupedDataWithEmpties = [
    { _index: "0", [PathPropertyName]: "Note 0", Status: "Open" },
    { _index: "1", [PathPropertyName]: "Note 1", Status: "Done" },
    { _index: "2", [PathPropertyName]: "Note 2", Status: "" }, // present, empty
    { _index: "3", [PathPropertyName]: "Note 3" }, // property absent (undefined)
    { _index: "4", [PathPropertyName]: "Note 4", Status: "Open" },
  ] as any[];

  it("merges absent + empty values into ONE labeled 'No <prop>' group, dropping nothing", async () => {
    await render(groupedDataWithEmpties, {
      ...basePredicate,
      groupBy: ["Status"],
    });

    const headers = groupHeaderRows();
    // Three groups: Open, Done, and the single merged no-value group — NOT four
    // (which is what the pre-fix undefined/"" split produced).
    expect(headers.length).toBe(3);

    // Exactly one merged ungrouped band, and it carries the real "No Status"
    // label (not a blank header).
    const emptyLabels = container.querySelectorAll(".mk-group-header-empty");
    expect(emptyLabels.length).toBe(1);
    expect(emptyLabels[0].textContent).toBe("No Status");

    // The no-value group's count badge reflects BOTH no-value rows (absent +
    // empty), proving neither was dropped.
    const emptyHeaderRow = emptyLabels[0].closest(
      "tr.mk-row-group-header"
    ) as HTMLTableRowElement;
    expect(emptyHeaderRow).not.toBeNull();
    expect(
      emptyHeaderRow.querySelector(".mk-group-header-count")?.textContent
    ).toBe("2");

    // Every data row still renders — no row vanished because it lacked the value.
    const dataRows = Array.from(
      container.querySelectorAll<HTMLTableRowElement>("tbody tr[data-row-id]")
    ).filter((tr) => !tr.classList.contains("mk-row-group-header"));
    expect(dataRows.length).toBe(groupedDataWithEmpties.length);
  });
});
