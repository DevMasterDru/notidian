/**
 * @jest-environment jsdom
 */
import React from "react";
import { act } from "react-dom/test-utils";
import { createRoot, Root } from "react-dom/client";
import { PathPropertyName } from "shared/types/context";
import { postPhysicalLifecycleFailure } from "shared/utils/asyncContracts";

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
  restoreRowsInTable: jest.fn(async () => {}),
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
// eslint-disable-next-line @typescript-eslint/no-var-requires
const {
  deleteRowsInTable,
  restoreRowsInTable,
} = require("core/utils/contexts/context");

import {
  TableView,
  __resetTableUndoJournalForTest,
} from "./TableView";
import i18n from "shared/i18n";

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
  { _index: "1", [PathPropertyName]: "Rows/B.md", Status: "open" },
  { _index: "2", [PathPropertyName]: "Rows/C.md", Status: "done" },
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
const selectRows = jest.fn();
const spaceInfoForPath = jest.fn(() => ({ path: "Rows" }));
const readPath = jest.fn<Promise<string>, [string]>(
  async (path: string) => `contents:${path}`
);
const writeToPath = jest.fn<Promise<void>, [string, string, boolean]>(
  async () => {}
);
const deletePathFromSpace = jest.fn<Promise<void>, [string]>(async () => {});
const pathExists = jest.fn<Promise<boolean>, [string]>(async () => false);
const onPathDeleted = jest.fn<void, [string]>();
const onPathCreated = jest.fn<Promise<boolean>, [string]>(async () => true);

const contextValue = {
  tableData: { schema: { id: "table" }, rows, cols },
  dbSchema: { id: "table", primary: "false" },
  contextTable: {},
  saveDB: jest.fn(),
  source: "Rows",
  selectedRows: ["0", "2"],
  selectRows,
  sortedColumns: cols,
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
    openModal: jest.fn(),
    openMenu: jest.fn(),
    getSticker: () => "",
    setActivePath: jest.fn(),
    primaryInteractionType: () => 1,
    getScreenType: () => 1,
  },
  spaceManager: {
    spaceInfoForPath,
    readPath,
    writeToPath,
    deletePath: deletePathFromSpace,
    pathExists,
  },
  onPathDeleted,
  onPathCreated,
  pathsIndex: new Map(),
} as any;

let container: HTMLDivElement;
let root: Root;

const flushPromises = async (count = 5) => {
  for (let i = 0; i < count; i++) {
    await Promise.resolve();
  }
};

const render = async (contextOverrides: Record<string, any> = {}) => {
  await act(async () => {
    root.render(
      <SpaceContext.Provider
        value={{
          spaceInfo: { path: "Rows" },
          spaceState: { path: "Rows" },
        }}
      >
        <PathContext.Provider value={{ readMode: false }}>
          <ContextEditorContext.Provider
            value={{ ...contextValue, ...contextOverrides }}
          >
            <TableView superstate={superstate} />
          </ContextEditorContext.Provider>
        </PathContext.Provider>
      </SpaceContext.Provider>
    );
  });
  await act(async () => {
    await flushPromises();
  });
};

const pressKey = async (
  table: HTMLElement,
  key: string,
  options: Pick<KeyboardEventInit, "metaKey" | "shiftKey"> = {}
) => {
  await act(async () => {
    table.dispatchEvent(new KeyboardEvent("keydown", {
      bubbles: true,
      key,
      ...options,
    }));
    await flushPromises();
  });
};

beforeEach(() => {
  __resetTableUndoJournalForTest();
  deleteRowsInTable.mockClear();
  restoreRowsInTable.mockClear();
  applyTableEdits.mockClear();
  selectRows.mockClear();
  spaceInfoForPath.mockClear();
  readPath.mockClear();
  readPath.mockImplementation(async (path: string) => `contents:${path}`);
  writeToPath.mockClear();
  deletePathFromSpace.mockReset();
  deletePathFromSpace.mockResolvedValue(undefined);
  pathExists.mockClear();
  pathExists.mockImplementation(async () => false);
  onPathDeleted.mockClear();
  onPathCreated.mockReset();
  onPathCreated.mockResolvedValue(true);
  superstate.ui.notify.mockClear();
  superstate.ui.openModal.mockClear();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  __resetTableUndoJournalForTest();
});

describe("TableView whole-row Delete key", () => {
  it("deletes all selected whole rows instead of clearing a cell", async () => {
    await render();

    await act(async () => {
      (container.querySelector(".mk-table") as HTMLElement).dispatchEvent(
        new KeyboardEvent("keydown", {
          bubbles: true,
          cancelable: true,
          key: "Delete",
        })
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(deleteRowsInTable).toHaveBeenCalledTimes(1);
    expect(deleteRowsInTable.mock.calls[0][2]).toBe("table");
    expect(deleteRowsInTable.mock.calls[0][3]).toEqual([0, 2]);
    expect(applyTableEdits).not.toHaveBeenCalled();
    expect(selectRows).toHaveBeenCalledWith(null, []);
  });

  it("undo restores deleted selected rows and redo deletes them again", async () => {
    await render();
    const table = container.querySelector(".mk-table") as HTMLElement;

    await act(async () => {
      table.dispatchEvent(
        new KeyboardEvent("keydown", {
          bubbles: true,
          cancelable: true,
          key: "Delete",
        })
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(deleteRowsInTable).toHaveBeenCalledTimes(1);
    expect(restoreRowsInTable).not.toHaveBeenCalled();

    await act(async () => {
      table.dispatchEvent(
        new KeyboardEvent("keydown", {
          bubbles: true,
          cancelable: true,
          key: "z",
          metaKey: true,
        })
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(restoreRowsInTable).toHaveBeenCalledTimes(1);
    expect(restoreRowsInTable.mock.calls[0][2]).toBe("table");
    expect(restoreRowsInTable.mock.calls[0][3]).toEqual([
      { index: 0, row: rows[0] },
      { index: 2, row: rows[2] },
    ]);

    await act(async () => {
      table.dispatchEvent(
        new KeyboardEvent("keydown", {
          bubbles: true,
          cancelable: true,
          key: "z",
          metaKey: true,
          shiftKey: true,
        })
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(deleteRowsInTable).toHaveBeenCalledTimes(2);
    expect(deleteRowsInTable.mock.calls[1][3]).toEqual([0, 2]);
    expect(applyTableEdits).not.toHaveBeenCalled();
  });

  it("keeps the undo entry and notifies when the row restore write rejects (Notidian-w9lw)", async () => {
    await render();
    const table = container.querySelector(".mk-table") as HTMLElement;

    await act(async () => {
      table.dispatchEvent(
        new KeyboardEvent("keydown", {
          bubbles: true,
          cancelable: true,
          key: "Delete",
        })
      );
      await flushPromises();
    });
    expect(deleteRowsInTable).toHaveBeenCalledTimes(1);

    // The MDB restore write rejects on the first undo attempt.
    restoreRowsInTable.mockRejectedValueOnce(new Error("locked"));

    await act(async () => {
      table.dispatchEvent(
        new KeyboardEvent("keydown", {
          bubbles: true,
          cancelable: true,
          key: "z",
          metaKey: true,
        })
      );
      await flushPromises();
    });

    expect(restoreRowsInTable).toHaveBeenCalledTimes(1);
    expect(superstate.ui.notify).toHaveBeenCalledWith(
      i18n.notice.undoRestoreRowsFailed
    );

    // The entry stayed on the undo stack: a second undo retries the restore,
    // which now succeeds — the failed undo was never lost.
    await act(async () => {
      table.dispatchEvent(
        new KeyboardEvent("keydown", {
          bubbles: true,
          cancelable: true,
          key: "z",
          metaKey: true,
        })
      );
      await flushPromises();
    });

    expect(restoreRowsInTable).toHaveBeenCalledTimes(2);
  });

  it("undo restores primary file-backed selected rows and redo deletes them again", async () => {
    await render({ dbSchema: { id: "table", primary: "true" } });
    const table = container.querySelector(".mk-table") as HTMLElement;

    await act(async () => {
      table.dispatchEvent(
        new KeyboardEvent("keydown", {
          bubbles: true,
          cancelable: true,
          key: "Delete",
        })
      );
      await flushPromises();
    });

    expect(superstate.ui.openModal).toHaveBeenCalledTimes(1);
    await act(async () => {
      superstate.ui.openModal.mock.calls[0][1].props.confirmAction();
      await flushPromises();
    });

    expect(deleteRowsInTable).not.toHaveBeenCalled();
    expect(readPath.mock.calls.map((call) => call[0])).toEqual([
      "Rows/A.md",
      "Rows/C.md",
    ]);
    expect(deletePathFromSpace.mock.calls.map((call) => call[0])).toEqual([
      "Rows/A.md",
      "Rows/C.md",
    ]);
    expect(onPathDeleted).not.toHaveBeenCalled();

    await act(async () => {
      table.dispatchEvent(
        new KeyboardEvent("keydown", {
          bubbles: true,
          cancelable: true,
          key: "z",
          metaKey: true,
        })
      );
      await flushPromises();
    });

    expect(writeToPath.mock.calls).toEqual([
      ["Rows/A.md", "contents:Rows/A.md", false],
      ["Rows/C.md", "contents:Rows/C.md", false],
    ]);
    expect(onPathCreated.mock.calls.map((call) => call[0])).toEqual([
      "Rows/A.md",
      "Rows/C.md",
    ]);

    await act(async () => {
      table.dispatchEvent(
        new KeyboardEvent("keydown", {
          bubbles: true,
          cancelable: true,
          key: "z",
          metaKey: true,
          shiftKey: true,
        })
      );
      await flushPromises();
    });

    expect(deletePathFromSpace.mock.calls.map((call) => call[0])).toEqual([
      "Rows/A.md",
      "Rows/C.md",
      "Rows/A.md",
      "Rows/C.md",
    ]);
  });

  it("attempts every primary delete, journals only partial successes, and reports once at the modal boundary", async () => {
    deletePathFromSpace.mockImplementation(async (path: string) => {
      if (path === "Rows/C.md") throw new Error("C locked");
    });
    await render({ dbSchema: { id: "table", primary: "true" } });
    const table = container.querySelector(".mk-table") as HTMLElement;

    await act(async () => {
      table.dispatchEvent(new KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        key: "Delete",
      }));
      await flushPromises();
    });
    const modalProps = superstate.ui.openModal.mock.calls[0][1].props;
    let failure: unknown;
    await act(async () => {
      try {
        await modalProps.confirmAction();
      } catch (error) {
        failure = error;
      }
    });

    expect(failure).toMatchObject({
      name: "AggregateError",
      errors: [expect.objectContaining({ message: expect.stringContaining("C locked") })],
    });
    expect(deletePathFromSpace.mock.calls.map((call) => call[0])).toEqual([
      "Rows/A.md",
      "Rows/C.md",
    ]);
    expect(superstate.ui.notify).not.toHaveBeenCalled();
    modalProps.reportError(failure);
    expect(superstate.ui.notify).toHaveBeenCalledTimes(1);

    await act(async () => {
      table.dispatchEvent(new KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        key: "z",
        metaKey: true,
      }));
      await flushPromises();
    });
    expect(writeToPath.mock.calls).toEqual([
      ["Rows/A.md", "contents:Rows/A.md", false],
    ]);
  });

  it("attempts every primary delete and creates no undo entry when all fail", async () => {
    deletePathFromSpace.mockRejectedValue(new Error("locked"));
    await render({ dbSchema: { id: "table", primary: "true" } });
    const table = container.querySelector(".mk-table") as HTMLElement;

    await act(async () => {
      table.dispatchEvent(new KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        key: "Delete",
      }));
      await flushPromises();
    });
    await expect(
      superstate.ui.openModal.mock.calls[0][1].props.confirmAction()
    ).rejects.toMatchObject({
      name: "AggregateError",
      errors: [expect.any(Error), expect.any(Error)],
    });
    expect(deletePathFromSpace.mock.calls.map((call) => call[0])).toEqual([
      "Rows/A.md",
      "Rows/C.md",
    ]);

    await act(async () => {
      table.dispatchEvent(new KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        key: "z",
        metaKey: true,
      }));
      await flushPromises();
    });
    expect(writeToPath).not.toHaveBeenCalled();
  });

  it("retries only failed primary paths after a partial bulk deletion", async () => {
    deletePathFromSpace.mockImplementation(async (path: string) => {
      if (path === "Rows/C.md" && deletePathFromSpace.mock.calls.length === 2) {
        throw new Error("C locked");
      }
    });
    await render({ dbSchema: { id: "table", primary: "true" } });
    const table = container.querySelector(".mk-table") as HTMLElement;

    await act(async () => {
      table.dispatchEvent(new KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        key: "Delete",
      }));
      await flushPromises();
    });
    const confirmAction = superstate.ui.openModal.mock.calls[0][1].props
      .confirmAction;
    let firstFailure: unknown;
    await act(async () => {
      try {
        await confirmAction();
      } catch (error) {
        firstFailure = error;
      }
    });
    expect(firstFailure).toMatchObject({
      name: "AggregateError"
    });
    await act(async () => {
      await confirmAction();
    });

    expect(deletePathFromSpace.mock.calls.map((call) => call[0])).toEqual([
      "Rows/A.md",
      "Rows/C.md",
      "Rows/C.md",
    ]);
  });

  it("does not delete an unsnapshotted primary path and retries it with exact undo content", async () => {
    let cSnapshotAttempts = 0;
    readPath.mockImplementation(async (path: string) => {
      if (path === "Rows/C.md" && cSnapshotAttempts++ === 0) {
        throw new Error("C could not be read");
      }
      return `contents:${path}`;
    });
    await render({ dbSchema: { id: "table", primary: "true" } });
    const table = container.querySelector(".mk-table") as HTMLElement;

    await act(async () => {
      table.dispatchEvent(new KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        key: "Delete",
      }));
      await flushPromises();
    });
    const modalProps = superstate.ui.openModal.mock.calls[0][1].props;
    let firstFailure: unknown;
    await act(async () => {
      try {
        await modalProps.confirmAction();
      } catch (error) {
        firstFailure = error;
      }
    });

    expect(firstFailure).toMatchObject({
      name: "AggregateError",
      errors: [expect.objectContaining({ message: expect.stringContaining("prepare Rows/C.md") })],
    });
    expect(deletePathFromSpace.mock.calls.map((call) => call[0])).toEqual([
      "Rows/A.md",
    ]);
    expect(superstate.ui.notify).not.toHaveBeenCalled();
    modalProps.reportError(firstFailure);
    expect(superstate.ui.notify).toHaveBeenCalledTimes(1);

    await act(async () => {
      await modalProps.confirmAction();
    });
    expect(readPath.mock.calls.map((call) => call[0])).toEqual([
      "Rows/A.md",
      "Rows/C.md",
      "Rows/C.md",
    ]);
    expect(deletePathFromSpace.mock.calls.map((call) => call[0])).toEqual([
      "Rows/A.md",
      "Rows/C.md",
    ]);

    await pressKey(table, "z", { metaKey: true });
    await pressKey(table, "z", { metaKey: true });
    expect(writeToPath.mock.calls).toEqual([
      ["Rows/C.md", "contents:Rows/C.md", false],
      ["Rows/A.md", "contents:Rows/A.md", false],
    ]);
  });

  it("journals and does not retry a row deleted before lifecycle cleanup failed", async () => {
    deletePathFromSpace.mockImplementation(async (path: string) => {
      if (path === "Rows/A.md") {
        throw postPhysicalLifecycleFailure(
          "Delete lifecycle failed after physical removal",
          new Error("cache cleanup failed"),
        );
      }
    });
    await render({ dbSchema: { id: "table", primary: "true" } });
    const table = container.querySelector(".mk-table") as HTMLElement;

    await act(async () => {
      table.dispatchEvent(new KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        key: "Delete",
      }));
      await flushPromises();
    });
    const modalProps = superstate.ui.openModal.mock.calls[0][1].props;
    let failure: unknown;
    await act(async () => {
      try {
        await modalProps.confirmAction();
      } catch (error) {
        failure = error;
      }
    });

    expect(failure).toMatchObject({ name: "AggregateError" });
    modalProps.reportError(failure);
    expect(superstate.ui.notify).toHaveBeenCalledTimes(1);
    await act(async () => {
      await modalProps.confirmAction();
    });
    expect(deletePathFromSpace.mock.calls.map((call) => call[0])).toEqual([
      "Rows/A.md",
      "Rows/C.md",
    ]);

    await act(async () => {
      table.dispatchEvent(new KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        key: "z",
        metaKey: true,
      }));
      await flushPromises();
    });
    expect(writeToPath.mock.calls).toEqual([
      ["Rows/A.md", "contents:Rows/A.md", false],
      ["Rows/C.md", "contents:Rows/C.md", false],
    ]);
  });

  it("does not journal an invalidated primary-row recreation for redo", async () => {
    await render({ dbSchema: { id: "table", primary: "true" } });
    const table = container.querySelector(".mk-table") as HTMLElement;

    await act(async () => {
      table.dispatchEvent(new KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        key: "Delete",
      }));
      await flushPromises();
    });
    await act(async () => {
      superstate.ui.openModal.mock.calls[0][1].props.confirmAction();
      await flushPromises();
    });
    onPathCreated.mockResolvedValue(false);

    await act(async () => {
      table.dispatchEvent(new KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        key: "z",
        metaKey: true,
      }));
      await flushPromises();
    });
    await act(async () => {
      table.dispatchEvent(new KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        key: "z",
        metaKey: true,
        shiftKey: true,
      }));
      await flushPromises();
    });

    expect(deletePathFromSpace).toHaveBeenCalledTimes(2);
  });

  it("undo does not overwrite an existing path while restoring primary deleted rows", async () => {
    await render({ dbSchema: { id: "table", primary: "true" } });
    const table = container.querySelector(".mk-table") as HTMLElement;

    await act(async () => {
      table.dispatchEvent(
        new KeyboardEvent("keydown", {
          bubbles: true,
          cancelable: true,
          key: "Delete",
        })
      );
      await flushPromises();
    });
    await act(async () => {
      superstate.ui.openModal.mock.calls[0][1].props.confirmAction();
      await flushPromises();
    });

    pathExists.mockImplementation(async (path: string) => path == "Rows/A.md");

    await act(async () => {
      table.dispatchEvent(
        new KeyboardEvent("keydown", {
          bubbles: true,
          cancelable: true,
          key: "z",
          metaKey: true,
        })
      );
      await flushPromises();
    });

    expect(writeToPath.mock.calls).toEqual([
      ["Rows/C.md", "contents:Rows/C.md", false],
    ]);
    expect(superstate.ui.notify).toHaveBeenCalledWith(
      expect.stringContaining("already exists")
    );

    await act(async () => {
      table.dispatchEvent(
        new KeyboardEvent("keydown", {
          bubbles: true,
          cancelable: true,
          key: "z",
          metaKey: true,
          shiftKey: true,
        })
      );
      await flushPromises();
    });

    expect(deletePathFromSpace.mock.calls.map((call) => call[0])).toEqual([
      "Rows/A.md",
      "Rows/C.md",
      "Rows/C.md",
    ]);
  });

  it("keeps a raw redo delete failure retryable with the exact snapshot", async () => {
    await render({ dbSchema: { id: "table", primary: "true" } });
    const table = container.querySelector(".mk-table") as HTMLElement;
    await pressKey(table, "Delete");
    await act(async () => { await superstate.ui.openModal.mock.calls[0][1].props.confirmAction(); });
    await pressKey(table, "z", { metaKey: true });
    superstate.ui.notify.mockClear();
    deletePathFromSpace.mockRejectedValueOnce(new Error("redo locked"));

    await pressKey(table, "z", { metaKey: true, shiftKey: true });
    expect(superstate.ui.notify).toHaveBeenCalledTimes(1);
    expect(superstate.ui.notify).toHaveBeenCalledWith("Could not redo deleted rows.");

    await pressKey(table, "z", { metaKey: true, shiftKey: true });
    expect(deletePathFromSpace.mock.calls.slice(-3).map((call) => call[0])).toEqual([
      "Rows/A.md",
      "Rows/C.md",
      "Rows/A.md",
    ]);
  });

  it("moves a post-physical redo failure to undo without retrying the deleted snapshot", async () => {
    await render({
      dbSchema: { id: "table", primary: "true" },
      selectedRows: ["0"],
    });
    const table = container.querySelector(".mk-table") as HTMLElement;
    await pressKey(table, "Delete");
    await act(async () => { await superstate.ui.openModal.mock.calls[0][1].props.confirmAction(); });
    await pressKey(table, "z", { metaKey: true });
    superstate.ui.notify.mockClear();
    deletePathFromSpace.mockImplementationOnce(async () => {
      throw postPhysicalLifecycleFailure("lifecycle failed", new Error("cleanup failed"));
    });

    await pressKey(table, "z", { metaKey: true, shiftKey: true });
    const callsAfterFailedRedo = deletePathFromSpace.mock.calls.length;
    await pressKey(table, "z", { metaKey: true, shiftKey: true });
    expect(deletePathFromSpace).toHaveBeenCalledTimes(callsAfterFailedRedo);
    await pressKey(table, "z", { metaKey: true });

    expect(deletePathFromSpace.mock.calls.slice(-1).map((call) => call[0])).toEqual(["Rows/A.md"]);
    expect(writeToPath.mock.calls.slice(-1)).toEqual([
      ["Rows/A.md", "contents:Rows/A.md", false],
    ]);
    expect(superstate.ui.notify).toHaveBeenCalledWith("Could not redo deleted rows.");
  });

  it("partitions mixed redo outcomes without losing paths or contents and reports once", async () => {
    await render({
      dbSchema: { id: "table", primary: "true" },
      selectedRows: ["0", "1", "2"],
    });
    const table = container.querySelector(".mk-table") as HTMLElement;
    await pressKey(table, "Delete");
    await act(async () => { await superstate.ui.openModal.mock.calls[0][1].props.confirmAction(); });
    await pressKey(table, "z", { metaKey: true });
    superstate.ui.notify.mockClear();
    deletePathFromSpace.mockImplementation(async (path: string) => {
      if (path === "Rows/B.md") {
        throw postPhysicalLifecycleFailure("lifecycle failed", new Error("B cleanup failed"));
      }
      if (path === "Rows/C.md" && deletePathFromSpace.mock.calls.filter(
        (call) => call[0] === "Rows/C.md"
      ).length === 2) {
        throw new Error("C locked");
      }
    });

    await pressKey(table, "z", { metaKey: true, shiftKey: true });
    expect(superstate.ui.notify).toHaveBeenCalledTimes(1);
    expect(deletePathFromSpace.mock.calls.slice(-3).map((call) => call[0])).toEqual([
      "Rows/A.md", "Rows/B.md", "Rows/C.md",
    ]);

    deletePathFromSpace.mockResolvedValue(undefined);
    await pressKey(table, "z", { metaKey: true, shiftKey: true });
    expect(deletePathFromSpace.mock.calls.at(-1)?.[0]).toBe("Rows/C.md");

    await pressKey(table, "z", { metaKey: true });
    await pressKey(table, "z", { metaKey: true });
    expect(writeToPath.mock.calls.slice(-3)).toEqual([
      ["Rows/C.md", "contents:Rows/C.md", false],
      ["Rows/A.md", "contents:Rows/A.md", false],
      ["Rows/B.md", "contents:Rows/B.md", false],
    ]);
  });
});
