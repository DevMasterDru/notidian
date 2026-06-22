/**
 * @jest-environment jsdom
 */
// Offline (jsdom) regression net for the undo/redo re-entrancy guard
// (Notidian-oxjk). A held Cmd+Z autorepeats ~30x/sec; before the guard each press
// fired a full async apply (file writes + reload), stacking dozens of overlapping
// operations that hung the table AND raced the journal (two presses popping the
// same entry). The guard (undoRedoInFlightRef) must:
//
//   (1) DROP a second undo press while the first's applyTableEdits is still
//       pending — exactly ONE operation applies per in-flight window.
//   (2) RELEASE once the in-flight op settles, so the NEXT press proceeds.
//
// Mirrors the harness in TableView.groupHeader.dom.test.tsx (fresh real contexts +
// sentinel leaf mocks) so the REAL TableView onKeyDown -> undoLastTableOperation
// branch runs, with applyTableEdits replaced by a deferred jest.fn we control.
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

import {
  TableView,
  __seedTableUndoJournalForTest,
  __resetTableUndoJournalForTest,
} from "./TableView";
import { PathPropertyName } from "shared/types/context";
import { TableUndoEntry } from "core/utils/contexts/tableUndoJournal";

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

const rows = [
  { _index: "0", [PathPropertyName]: "Note 0", Status: "Open" },
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

// The journal key TableView computes is `${source}::${dbSchema.id}`.
const SOURCE = "Test/Space";
const JOURNAL_KEY = `${SOURCE}::files`;

const makeEntry = (label: string, value: string): TableUndoEntry =>
  ({
    label,
    writes: [
      { rowId: "0", columnName: "Status", table: "", columnId: "Status", value },
    ],
    redoWrites: [
      { rowId: "0", columnName: "Status", table: "", columnId: "Status", value },
    ],
  } as any);

const okResult = {
  ok: true,
  applied: 1,
  failed: [] as any[],
  skipped: [] as any[],
};

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

let container: HTMLDivElement;
let root: Root;
let pendingResolvers: Array<(v: any) => void>;
let applyTableEdits: jest.Mock;

const makeContextValue = () =>
  ({
    tableData: { schema: { id: "files" }, rows, cols },
    dbSchema: { id: "files", primary: "true" },
    contextTable: {},
    saveDB: jest.fn(),
    source: SOURCE,
    selectedRows: [],
    selectRows: jest.fn(),
    sortedColumns: cols,
    filteredData: rows,
    predicate: basePredicate,
    savePredicate: jest.fn(),
    updateFieldValue: jest.fn(),
    updateValue: jest.fn(),
    applyValueEdits: jest.fn(),
    applyTableEdits,
    reloadContextData: jest.fn(),
    renameRowTitle: jest.fn(),
    setSearchActive: jest.fn(),
    subItemsInfo: null,
    collapsedSubItems: new Set<string>(),
    toggleSubItemCollapse: jest.fn(),
  } as any);

const render = async () => {
  await act(async () => {
    root.render(
      <SpaceContext.Provider
        value={{
          spaceInfo: { path: SOURCE },
          spaceState: { path: SOURCE },
        }}
      >
        <PathContext.Provider value={{ readMode: false }}>
          <ContextEditorContext.Provider value={makeContextValue()}>
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

const fireUndo = async () => {
  const el = container.querySelector(".mk-table") as HTMLElement;
  await act(async () => {
    el.dispatchEvent(
      new KeyboardEvent("keydown", { key: "z", metaKey: true, bubbles: true })
    );
    await Promise.resolve();
  });
};

// Resolve the oldest in-flight applyTableEdits and let its handler finish
// (including the `finally` that releases the guard).
const settleOldest = async () => {
  await act(async () => {
    pendingResolvers.shift()?.(okResult);
    await Promise.resolve();
    await Promise.resolve();
  });
};

beforeEach(() => {
  __resetTableUndoJournalForTest();
  pendingResolvers = [];
  applyTableEdits = jest.fn(
    () => new Promise((resolve) => pendingResolvers.push(resolve))
  );
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  __resetTableUndoJournalForTest();
});

describe("undo/redo re-entrancy guard (Notidian-oxjk)", () => {
  it("drops an overlapping undo press while one is in flight, then releases", async () => {
    // Two stacked undo entries; B (last) is undone first, then A.
    __seedTableUndoJournalForTest(JOURNAL_KEY, {
      undo: [makeEntry("edit A", "a"), makeEntry("edit B", "b")],
      redo: [],
    });

    await render();

    // First press starts an operation (B) that is now pending.
    await fireUndo();
    expect(applyTableEdits).toHaveBeenCalledTimes(1);

    // Second press WHILE the first is still in flight is dropped by the guard —
    // no second operation stacks up.
    await fireUndo();
    expect(applyTableEdits).toHaveBeenCalledTimes(1);

    // The in-flight op settles; the guard releases.
    await settleOldest();

    // A subsequent press now proceeds (applies A), proving the guard reset.
    await fireUndo();
    expect(applyTableEdits).toHaveBeenCalledTimes(2);

    // Sanity: no operation was left stuck pending beyond the ones we drove.
    await settleOldest();
    expect(applyTableEdits).toHaveBeenCalledTimes(2);
  });

  it("never stacks more than one in-flight op across a rapid burst of presses", async () => {
    __seedTableUndoJournalForTest(JOURNAL_KEY, {
      undo: [
        makeEntry("edit A", "a"),
        makeEntry("edit B", "b"),
        makeEntry("edit C", "c"),
      ],
      redo: [],
    });

    await render();

    // Five rapid presses with nothing settling between them: a held key.
    for (let i = 0; i < 5; i++) {
      await fireUndo();
    }

    // Only the first press's operation is in flight; the other four are dropped.
    expect(applyTableEdits).toHaveBeenCalledTimes(1);
    expect(pendingResolvers.length).toBe(1);
  });
});
