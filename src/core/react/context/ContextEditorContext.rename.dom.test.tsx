/**
 * @jest-environment jsdom
 */
import React, { useContext } from "react";
import { act } from "react-dom/test-utils";
import { createRoot, Root } from "react-dom/client";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

jest.mock("core/react/context/SpaceContext", () => ({
  SpaceContext: require("react").createContext({
    spaceInfo: { path: "Test/Database", readOnly: false },
    readMode: true,
    spaceState: { contexts: [] },
  }),
}));
jest.mock("core/react/context/PathContext", () => ({
  PathContext: require("react").createContext({
    pathState: { path: "Test/Database" },
    readMode: true,
  }),
}));
jest.mock("core/react/context/FramesMDBContext", () => ({
  FramesMDBContext: require("react").createContext(null),
}));
jest.mock("core/react/context/SpaceManagerContext", () => ({
  useSpaceManager: (): null => null,
}));
jest.mock("core/react/components/UI/Menus/menu/concerns/matchers", () => ({
  matchAny: () => false,
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { SpaceContext } = require("core/react/context/SpaceContext");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { PathContext } = require("core/react/context/PathContext");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { FramesMDBContext } = require("core/react/context/FramesMDBContext");

import {
  ContextEditorContext,
  ContextEditorProvider,
} from "./ContextEditorContext";
import { PathPropertyName } from "shared/types/context";
import { frontmatterPropertySource } from "core/utils/properties/allProperties";

const contextPath = "Test/Database";
const filePath = "Test/Database/Row.md";

const table = {
  schema: { id: "files", name: "Files", type: "db", primary: "true" },
  cols: [
    {
      name: PathPropertyName,
      type: "fileprop",
      schemaId: "files",
      primary: "true",
    },
    {
      name: "Status",
      type: "text",
      schemaId: "files",
      source: frontmatterPropertySource,
    },
    {
      name: "Owner",
      type: "text",
      schemaId: "files",
      source: frontmatterPropertySource,
    },
  ],
  rows: [{ [PathPropertyName]: filePath, Status: "Open", Owner: "Dev" }],
} as any;

let capturedContext: any;

const CaptureContext = (): React.ReactElement | null => {
  capturedContext = useContext(ContextEditorContext);
  return null;
};

const deferred = <T,>() => {
  let resolve: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve: resolve! };
};

describe("frontmatter property rename", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    capturedContext = null;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("waits for the remapped view order to persist before reloading the renamed table", async () => {
    const predicateSave = deferred<void>();
    const reloadContextByPath = jest.fn().mockResolvedValue(undefined);
    const saveSchema = jest.fn(() => predicateSave.promise);
    let persistedTable = table;
    const superstate = {
      settings: { autoImportObsidianPropertiesToContexts: false },
      contextsIndex: new Map([
        [
          contextPath,
          {
            schemas: [
              { id: "files", name: "Files", type: "db", primary: "true" },
            ],
          },
        ],
      ]),
      spacesIndex: new Map([[contextPath, { type: "folder" }]]),
      spacesMap: { getInverse: (): string[] => [filePath] },
      pathsIndex: new Map([
        [filePath, { metadata: { property: { Status: "Open", Owner: "Dev" } } }],
      ]),
      eventsDispatcher: {
        addListener: jest.fn(),
        removeListener: jest.fn(),
      },
      reloadContext: jest.fn().mockResolvedValue(undefined),
      reloadContextByPath,
      spaceManager: {
        readTable: jest.fn(async () => persistedTable),
        saveTable: jest.fn(async (_path: string, nextTable: any) => {
          persistedTable = nextTable;
          return true;
        }),
        mutateTable: jest.fn(async (_path: string, _schemaId: string, operation: any) => {
          persistedTable = operation.desired;
          return true;
        }),
        saveProperties: jest.fn().mockResolvedValue(true),
        deleteProperty: jest.fn().mockResolvedValue(undefined),
        resolvePath: (path: string) => path,
      },
      ui: { notify: jest.fn(), setActivePath: jest.fn() },
    } as any;
    const frameSchema = {
      id: "filesView",
      name: "Files View",
      type: "view",
      def: { db: "files" },
      predicate: JSON.stringify({
        filters: [],
        sort: [],
        groupBy: [],
        colsOrder: [PathPropertyName, "Status", "Owner"],
        colsHidden: [],
        colsSize: {},
      }),
    } as any;

    await act(async () => {
      root.render(
        <SpaceContext.Provider
          value={{
            spaceInfo: { path: contextPath, readOnly: false },
            readMode: true,
            spaceState: { contexts: [] },
          }}
        >
          <PathContext.Provider value={{ pathState: { path: contextPath } }}>
            <FramesMDBContext.Provider
              value={{
                frameSchemas: [frameSchema],
                frameSchema,
                saveSchema,
              }}
            >
              <ContextEditorProvider superstate={superstate}>
                <CaptureContext />
              </ContextEditorProvider>
            </FramesMDBContext.Provider>
          </PathContext.Provider>
        </SpaceContext.Provider>
      );
      await Promise.resolve();
      await Promise.resolve();
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const statusColumn = capturedContext.cols.find(
      (column: any) => column.name == "Status"
    );
    saveSchema.mockClear();
    const rename = capturedContext.renameFrontmatterPropertyKey(
      statusColumn,
      "State",
      () => true
    );

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(saveSchema).toHaveBeenCalledWith(
      expect.objectContaining({
        predicate: expect.stringContaining('"colsOrder":["File","State","Owner"]'),
      })
    );
    expect(capturedContext.sortedColumns.map((column: any) => column.name)).toEqual([
      PathPropertyName,
      "Status",
      "Owner",
    ]);
    expect(reloadContextByPath).not.toHaveBeenCalled();

    predicateSave.resolve();
    await act(async () => {
      await expect(rename).resolves.toBe(true);
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(reloadContextByPath).toHaveBeenCalledWith(contextPath, {
      force: true,
      calculate: true,
    });
    expect(capturedContext.tableData.cols.map((column: any) => column.name)).toEqual([
      PathPropertyName,
      "State",
      "Owner",
    ]);
    expect(capturedContext.sortedColumns.map((column: any) => column.name)).toEqual([
      PathPropertyName,
      "State",
      "Owner",
    ]);
  });

  // Notidian-lqt4: this DOM harness is the only test file that exercises
  // renameFrontmatterPropertyKey's real UI wiring (the notify message built
  // by frontmatterRenameIssueMessage, its caseVariantCount computation, and
  // the resulting early-return-without-writing). The bead's own commit
  // message cited this file's pass count as "Verification" for that wiring
  // without adding a single case here that reaches the
  // "case-variant-frontmatter-key" branch -- so a future copy-paste error in
  // that switch case (e.g. swapping caseVariantCount for conflictCount)
  // would go undetected. This test closes that gap end to end, through the
  // real production code path (not by calling the private message-builder
  // directly).
  it("blocks the rename and notifies with the case-variant message when a stray differently-cased spelling of the new key already exists, without writing anything", async () => {
    const reloadContextByPath = jest.fn().mockResolvedValue(undefined);
    const saveSchema = jest.fn().mockResolvedValue(undefined);
    const saveProperties = jest.fn().mockResolvedValue(true);
    const deleteProperty = jest.fn().mockResolvedValue(undefined);
    const notify = jest.fn();
    const superstate = {
      settings: { autoImportObsidianPropertiesToContexts: false },
      contextsIndex: new Map([
        [
          contextPath,
          {
            schemas: [
              { id: "files", name: "Files", type: "db", primary: "true" },
            ],
          },
        ],
      ]),
      spacesIndex: new Map([[contextPath, { type: "folder" }]]),
      spacesMap: { getInverse: (): string[] => [filePath] },
      // "STATE" is a stray case-variant of the requested new key "State" --
      // the file already carries the exact old key "Status" too.
      pathsIndex: new Map([
        [
          filePath,
          {
            metadata: {
              property: { Status: "Open", Owner: "Dev", STATE: "Stale" },
            },
          },
        ],
      ]),
      eventsDispatcher: {
        addListener: jest.fn(),
        removeListener: jest.fn(),
      },
      reloadContext: jest.fn().mockResolvedValue(undefined),
      reloadContextByPath,
      spaceManager: {
        readTable: jest.fn(async () => table),
        saveTable: jest.fn().mockResolvedValue(true),
        mutateTable: jest.fn().mockResolvedValue(true),
        saveProperties,
        deleteProperty,
        resolvePath: (path: string) => path,
      },
      ui: { notify, setActivePath: jest.fn() },
    } as any;
    const frameSchema = {
      id: "filesView",
      name: "Files View",
      type: "view",
      def: { db: "files" },
      predicate: JSON.stringify({
        filters: [],
        sort: [],
        groupBy: [],
        colsOrder: [PathPropertyName, "Status", "Owner"],
        colsHidden: [],
        colsSize: {},
      }),
    } as any;

    await act(async () => {
      root.render(
        <SpaceContext.Provider
          value={{
            spaceInfo: { path: contextPath, readOnly: false },
            readMode: true,
            spaceState: { contexts: [] },
          }}
        >
          <PathContext.Provider value={{ pathState: { path: contextPath } }}>
            <FramesMDBContext.Provider
              value={{
                frameSchemas: [frameSchema],
                frameSchema,
                saveSchema,
              }}
            >
              <ContextEditorProvider superstate={superstate}>
                <CaptureContext />
              </ContextEditorProvider>
            </FramesMDBContext.Provider>
          </PathContext.Provider>
        </SpaceContext.Provider>
      );
      await Promise.resolve();
      await Promise.resolve();
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const statusColumn = capturedContext.cols.find(
      (column: any) => column.name == "Status"
    );

    let renameResult: boolean | undefined;
    await act(async () => {
      renameResult = await capturedContext.renameFrontmatterPropertyKey(
        statusColumn,
        "State",
        () => true
      );
    });

    expect(renameResult).toBe(false);
    expect(notify).toHaveBeenCalledTimes(1);
    const [message] = notify.mock.calls[0];
    expect(message).toContain("Status");
    expect(message).toContain("State");
    expect(message).toContain("STATE");
    expect(message).toContain("1 file");
    // No write of any kind happened -- neither the frontmatter save nor the
    // schema/predicate rename went through.
    expect(saveProperties).not.toHaveBeenCalled();
    expect(deleteProperty).not.toHaveBeenCalled();
    expect(saveSchema).not.toHaveBeenCalled();
    expect(reloadContextByPath).not.toHaveBeenCalled();
  });
});
