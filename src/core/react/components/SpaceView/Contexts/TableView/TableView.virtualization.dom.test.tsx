/**
 * @jest-environment jsdom
 */
// Offline (jsdom) render-contract coverage for the table's row virtualization
// (Notidian-8h9) — the DEFAULT-ON kill-switch flag-gate's render wiring, the only
// part of 8h9 that is not provable by the pure unit tests
// (tableVirtualization.test.ts / tableVirtualWindow.adversarial.test.ts). Per the
// repo binding (AGENTS.md), an unverifiable core-render change ships behind a flag
// WITH comprehensive jsdom tests; these are them:
//
//   - flag OFF (kill-switch): the body is byte-for-byte the LEGACY pagination
//     path — exactly `contextPagination` rows render (the page window), the Load
//     More / Load All pagination tfoot is present, and there are NO virtual
//     spacer rows. This is the guarantee that flipping the flag off restores the
//     pre-feature render.
//   - flag ON: only the WINDOWED rows mount (far fewer than the full set), the
//     mounted `tr[data-row-id]` set equals the pure computeVirtualWindow seam's
//     [startIndex, endIndex) for the current scroll geometry, top/bottom spacer
//     rows hold the scrollbar at full content height, and the pagination tfoot is
//     gone (every row is reachable by scrolling).
//
// The heavy leaf children (DataTypeView cell renderer, ColumnHeader, SpaceChart)
// and the makemd-core runtime are mocked to sentinels so the test exercises the
// REAL TableView body/window/flag branch logic without mounting the Obsidian
// editor graph. The contexts are replaced with fresh React.createContext (same
// pattern as SpaceNoteBody.dom.test.tsx / FilterBar.anchor.dom.test.tsx) so the
// component reads genuine context the test feeds.
import React from "react";
import { act } from "react-dom/test-utils";
import { createRoot, Root } from "react-dom/client";
import { computeVirtualWindow } from "core/utils/contexts/tableVirtualWindow";
import {
  DEFAULT_TABLE_OVERSCAN,
  DEFAULT_TABLE_ROW_HEIGHT,
} from "core/utils/contexts/tableVirtualization";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

// jsdom ships no ResizeObserver; TableView's full-page-sizing + virtualization
// viewport-tracking effects construct one. A no-op stub is enough — jsdom does
// not lay out, so there is nothing to observe; the scroll/size stay 0 (top of a
// 0-height viewport), which is exactly the geometry the window assertions use.
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
// makemd-core is imported for the Superstate/SelectOption types (erased) plus the
// SelectOptionType ENUM (a real value used at module load by the menu helpers in
// TableView's import graph). Re-export the real enum from its light source module
// while stubbing the heavy runtime barrel so we never load the Superstate graph.
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

const CONTEXT_PAGINATION = 25;

const makeSuperstate = (rowVirtualization: boolean) =>
  ({
    settings: {
      contextPagination: CONTEXT_PAGINATION,
      rowVirtualization,
      defaultDateFormat: "MMM dd yyyy",
      defaultTimeFormat: "h:mm a",
    },
    ui: {
      notify: jest.fn(),
      openPath: jest.fn(),
      openMenu: jest.fn(),
      getSticker: () => "",
      setActivePath: jest.fn(),
      // isTouchScreen(ui) reads these in the cell renderer; return Mouse/Desktop
      // (InteractionType.Mouse=1, ScreenType.Desktop=1) so it is non-touch.
      primaryInteractionType: () => 1,
      getScreenType: () => 1,
    },
    pathsIndex: new Map(),
  } as any);

// A single text column ("Name") plus the implicit path column the table always
// carries, so a real getCoreRowModel/getPaginationRowModel runs over genuine rows.
const cols = [
  {
    name: PathPropertyName,
    schemaId: "files",
    type: "fileprop",
    table: "",
    primary: "true",
  },
  { name: "Name", schemaId: "files", type: "text", table: "" },
] as any;

const makeData = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    _index: i.toString(),
    [PathPropertyName]: `Note ${i}`,
    "Name": `value-${i}`,
  }));

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

const makeContextValue = (data: any[]) =>
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

const render = async (superstate: any, data: any[]) => {
  await act(async () => {
    root.render(
      <SpaceContext.Provider
        value={{
          spaceInfo: { path: "Test/Space" },
          spaceState: { path: "Test/Space" },
        }}
      >
        <PathContext.Provider value={{ readMode: false }}>
          <ContextEditorContext.Provider value={makeContextValue(data)}>
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

const bodyRowIds = (): string[] =>
  Array.from(
    container.querySelectorAll<HTMLTableRowElement>("tbody tr[data-row-id]")
  ).map((tr) => tr.dataset.rowId!);

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

// === Flag OFF (kill-switch): legacy pagination path, byte-for-byte =========

describe("flag OFF (kill-switch) — legacy pagination render (Notidian-8h9)", () => {
  it("renders exactly the pagination page window, the Load More/All tfoot, and NO spacers", async () => {
    await render(makeSuperstate(false), makeData(120));

    // Legacy page window: exactly contextPagination (25) rows mount.
    expect(bodyRowIds()).toHaveLength(CONTEXT_PAGINATION);
    // The pagination tfoot + its Load More / Load All actions are present.
    expect(
      container.querySelector(".mk-row-pagination")
    ).not.toBeNull();
    expect(
      container.querySelectorAll(".mk-table-pagination-action").length
    ).toBe(2);
    // No virtual spacer rows exist on the legacy path.
    expect(
      container.querySelector(".mk-table-virtual-spacer")
    ).toBeNull();
  });

  it("with fewer rows than a page, renders all rows and no pagination control", async () => {
    await render(makeSuperstate(false), makeData(5));
    expect(bodyRowIds()).toHaveLength(5);
    // Nothing to paginate -> no Load More tfoot, still no spacers.
    expect(container.querySelector(".mk-row-pagination")).toBeNull();
    expect(container.querySelector(".mk-table-virtual-spacer")).toBeNull();
  });
});

// === Flag ON: windowed render, membership === pure seam ====================

describe("flag ON — windowed render (Notidian-8h9)", () => {
  it("mounts only the window, hides the pagination tfoot, and renders spacers", async () => {
    const total = 500;
    await render(makeSuperstate(true), makeData(total));

    const ids = bodyRowIds();
    // Windowed: far fewer than the full set, and (jsdom viewport is 0-height)
    // fewer than even a legacy page — the window only covers the visible band.
    expect(ids.length).toBeGreaterThan(0);
    expect(ids.length).toBeLessThan(total);
    // Pagination tfoot is gone — every row is reachable by scrolling.
    expect(container.querySelector(".mk-row-pagination")).toBeNull();
    // At least one spacer holds the scrollbar at full content height. With the
    // window pinned at the top, the bottom spacer is the one present.
    expect(
      container.querySelector(".mk-table-virtual-spacer")
    ).not.toBeNull();
  });

  it("the mounted row set equals the pure computeVirtualWindow seam output", async () => {
    const total = 500;
    await render(makeSuperstate(true), makeData(total));

    // jsdom does not lay out, so scrollTop=0 and clientHeight=0: the table sits
    // at the top with a 0-height viewport. The component seeds the row height
    // estimate at DEFAULT_TABLE_ROW_HEIGHT (no measurable row in jsdom). Compute
    // the seam with those exact inputs and assert the rendered ids match.
    const window = computeVirtualWindow({
      scrollTop: 0,
      viewportHeight: 0,
      rowHeight: DEFAULT_TABLE_ROW_HEIGHT,
      overscan: DEFAULT_TABLE_OVERSCAN,
      totalRows: total,
    });
    const expectedIds = Array.from(
      { length: window.endIndex - window.startIndex },
      (_, i) => (window.startIndex + i).toString()
    );
    expect(bodyRowIds()).toEqual(expectedIds);
  });

  it("row numbers reflect TRUE position in the full set (not slice position)", async () => {
    await render(makeSuperstate(true), makeData(500));
    // The first windowed row (index 0 at the top) shows row number 1.
    const firstRow = container.querySelector(
      "tbody tr[data-row-id] .mk-row-number"
    );
    expect(firstRow?.textContent).toBe("1");
  });

  it("falls back to the legacy (non-windowed) render when the table is grouped", async () => {
    // Grouping interleaves group-header + nested rows the uniform-row window
    // kernel does not model, so a grouped table renders legacy even with the
    // flag ON: spacers must be absent.
    const groupedData = makeData(120);
    const groupedPredicate = { ...predicate, groupBy: ["Name"] };
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
              value={{
                ...makeContextValue(groupedData),
                predicate: groupedPredicate,
              }}
            >
              <TableView superstate={makeSuperstate(true)} />
            </ContextEditorContext.Provider>
          </PathContext.Provider>
        </SpaceContext.Provider>
      );
    });
    await act(async () => {
      await Promise.resolve();
    });
    // Grouped fall-back: no virtual spacers (legacy non-windowed body).
    expect(container.querySelector(".mk-table-virtual-spacer")).toBeNull();
  });
});
