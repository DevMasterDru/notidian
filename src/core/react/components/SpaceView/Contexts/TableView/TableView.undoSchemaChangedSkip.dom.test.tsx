/**
 * @jest-environment jsdom
 */
// Offline (jsdom) regression net for bd Notidian-0ykh: applyTableUndoRedoCommand's
// value-write branch (TableView.tsx) used to re-push a replay entry onto the SAME
// undo/redo stack on ANY skip, including a PERMANENT "schema-changed" skip (the
// write's column was deleted, so it can never succeed). That made the entry stick
// forever, re-skipping on every subsequent undo/redo press with no progress.
//
// The fix: when the ONLY outstanding issue on an entry is a schema-changed skip,
// drop the entry so undo/redo advances past it. A transient frontmatter-conflict
// skip must still re-push (that behaviour is correct and NOT a regression target).
//
// Mirrors the harness in TableView.undoReentrancy.dom.test.tsx (fresh real
// contexts + sentinel leaf mocks) so the REAL TableView onKeyDown ->
// applyTableUndoRedoCommand branch runs, with applyTableEdits replaced by a
// deferred jest.fn we control.
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
import { TableEditTransactionResult } from "core/utils/contexts/tableEditTransaction";

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

const makeEntry = (
  label: string,
  value: string,
  redoValue = `redo-${value}`
): TableUndoEntry =>
  ({
    label,
    writes: [
      { rowId: "0", columnName: "Status", table: "", columnId: "Status", value },
    ],
    redoWrites: [
      {
        rowId: "0",
        columnName: "Status",
        table: "",
        columnId: "Status",
        value: redoValue,
      },
    ],
  } as any);

const schemaChangedResult = (
  value: string
): TableEditTransactionResult =>
  ({
    ok: true,
    applied: 0,
    failed: [],
    skipped: [
      {
        write: {
          rowId: "0",
          columnName: "Status",
          table: "",
          columnId: "Status",
          value,
        },
        reason: "schema-changed",
      },
    ],
  } as any);

const frontmatterConflictResult = (
  value: string
): TableEditTransactionResult =>
  ({
    ok: true,
    applied: 0,
    failed: [],
    skipped: [
      {
        write: {
          rowId: "0",
          columnName: "Status",
          table: "",
          columnId: "Status",
          value,
        },
        reason: "frontmatter-conflict",
        currentValue: "external-value",
        baseValue: "Open",
        attemptedValue: value,
      },
    ],
  } as any);

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

const fireRedo = async () => {
  const el = container.querySelector(".mk-table") as HTMLElement;
  await act(async () => {
    el.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "z",
        metaKey: true,
        shiftKey: true,
        bubbles: true,
      })
    );
    await Promise.resolve();
  });
};

// Resolve the oldest in-flight applyTableEdits and let its handler finish
// (including the `finally` that releases the guard).
const settleOldest = async (result: TableEditTransactionResult) => {
  await act(async () => {
    pendingResolvers.shift()?.(result);
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

describe("undo/redo stack transitions on value-write skip", () => {
  it("(a) drops an entry whose only issue is a permanent schema-changed skip, advancing the undo stack", async () => {
    // Two stacked undo entries; B (last) is undone first, then A.
    __seedTableUndoJournalForTest(JOURNAL_KEY, {
      undo: [makeEntry("edit A", "a"), makeEntry("edit B", "b")],
      redo: [],
    });

    await render();

    // First undo press targets B; its column has since been deleted, so the
    // replay comes back with a permanent schema-changed skip.
    await fireUndo();
    expect(applyTableEdits).toHaveBeenCalledTimes(1);
    expect(applyTableEdits.mock.calls[0][0][0].value).toBe("b");
    await settleOldest(schemaChangedResult("b"));

    // If B had been re-pushed (the bug), this second undo press would apply B
    // again. With the fix, B was dropped and this press reaches A instead —
    // proving the stack advanced.
    await fireUndo();
    expect(applyTableEdits).toHaveBeenCalledTimes(2);
    expect(applyTableEdits.mock.calls[1][0][0].value).toBe("a");
  });

  it("(b) still re-pushes an entry on a transient frontmatter-conflict skip (regression guard)", async () => {
    __seedTableUndoJournalForTest(JOURNAL_KEY, {
      undo: [makeEntry("edit A", "a"), makeEntry("edit B", "b")],
      redo: [],
    });

    await render();

    await fireUndo();
    expect(applyTableEdits).toHaveBeenCalledTimes(1);
    expect(applyTableEdits.mock.calls[0][0][0].value).toBe("b");
    await settleOldest(frontmatterConflictResult("b"));

    // B is still on top of the undo stack (re-pushed) — the second press
    // retries B, not A.
    await fireUndo();
    expect(applyTableEdits).toHaveBeenCalledTimes(2);
    expect(applyTableEdits.mock.calls[1][0][0].value).toBe("b");
  });

  it("(c) drops an entry on the analogous redo path, advancing the redo stack", async () => {
    // Two stacked redo entries; B (last) is redone first, then A.
    __seedTableUndoJournalForTest(JOURNAL_KEY, {
      undo: [],
      redo: [makeEntry("edit A", "undo-a", "redo-a"), makeEntry("edit B", "undo-b", "redo-b")],
    });

    await render();

    await fireRedo();
    expect(applyTableEdits).toHaveBeenCalledTimes(1);
    expect(applyTableEdits.mock.calls[0][0][0].value).toBe("redo-b");
    await settleOldest(schemaChangedResult("redo-b"));

    // If B had been re-pushed onto the redo stack (the bug), this second redo
    // press would apply B again. With the fix, B was dropped and this press
    // reaches A instead.
    await fireRedo();
    expect(applyTableEdits).toHaveBeenCalledTimes(2);
    expect(applyTableEdits.mock.calls[1][0][0].value).toBe("redo-a");
  });
});
