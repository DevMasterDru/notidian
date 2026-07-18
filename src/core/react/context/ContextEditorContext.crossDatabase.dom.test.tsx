/** @jest-environment jsdom */
import React, { useContext } from "react";
import { act } from "react-dom/test-utils";
import { createRoot, Root } from "react-dom/client";
import { PathPropertyName } from "shared/types/context";
import { frontmatterPropertySource } from "core/utils/properties/allProperties";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

jest.mock("core/react/context/SpaceContext", () => ({
  SpaceContext: require("react").createContext({
    spaceInfo: { path: "My Day", readOnly: false },
    readMode: false,
    spaceState: { path: "My Day", contexts: [], properties: [] },
  }),
}));
jest.mock("core/react/context/PathContext", () => ({
  PathContext: require("react").createContext({
    pathState: { path: "My Day" },
    readMode: false,
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

const { SpaceContext } = require("core/react/context/SpaceContext");
const { PathContext } = require("core/react/context/PathContext");
const { FramesMDBContext } = require("core/react/context/FramesMDBContext");

import {
  ContextEditorContext,
  ContextEditorProvider,
} from "./ContextEditorContext";

const sourceTable = (
  path: string,
  field: string,
  value: string,
  type = "number"
) => ({
  schema: { id: "files", name: "Items", type: "db", primary: "true" },
  cols: [
    {
      name: PathPropertyName,
      type: "fileprop",
      schemaId: "files",
      primary: "true",
    },
    {
      name: field,
      type,
      schemaId: "files",
      source: frontmatterPropertySource,
    },
  ],
  rows: [{ [PathPropertyName]: path, [field]: value }],
});

const routinesTable = {
  ...sourceTable("Routines/Morning Walk.md", "priority_num", "1"),
  rows: [
    { [PathPropertyName]: "Routines/Morning Walk.md", priority_num: "1" },
    { [PathPropertyName]: "Routines/Inactive.md", priority_num: "0" },
  ],
};
const eventsTable = {
  ...sourceTable("Events/Dinner.md", "importance", "2"),
  rows: [
    { [PathPropertyName]: "Events/Dinner.md", importance: "2" },
    { [PathPropertyName]: "Events/Old.md", importance: "1" },
  ],
};
const hostTable = sourceTable("My Day/Host.md", "priority", "9");

const frameSchema = {
  id: "Next",
  name: "Next",
  type: "view",
  def: {
    db: "files",
    sources: [
      {
        context: "Routines",
        db: "files",
        label: "Routines",
        fields: { priority: "priority_num" },
        filters: [
          {
            field: "priority_num",
            fn: "isGreatThan",
            value: "0",
            fType: "number",
          },
        ],
      },
      {
        context: "Events",
        db: "files",
        label: "Events",
        fields: { priority: "importance" },
        filters: [
          {
            field: "importance",
            fn: "isGreatThan",
            value: "1",
            fType: "number",
          },
        ],
      },
    ],
  },
  predicate: JSON.stringify({
    filters: [],
    sort: [],
    groupBy: [],
    colsOrder: [PathPropertyName, "priority", "Source"],
    colsHidden: [],
    colsSize: {},
  }),
};

let capturedContext: any;
const CaptureContext = (): React.ReactElement | null => {
  capturedContext = useContext(ContextEditorContext);
  return null;
};

const mount = async (
  enabled: boolean | undefined,
  mountedFrameSchema: any = frameSchema
) => {
  const readTable = jest.fn(async (context: string) => {
    if (context == "Routines") return routinesTable;
    if (context == "Events") return eventsTable;
    return hostTable;
  });
  const saveTable = jest.fn(async () => true);
  const saveProperties = jest.fn(async () => true);
  const schemas = [
    { id: "files", name: "Items", type: "db", primary: "true" },
  ];
  const superstate = {
    settings: {
      autoImportObsidianPropertiesToContexts: false,
      ...(enabled === undefined ? {} : { crossDatabaseSavedViews: enabled }),
    },
    contextsIndex: new Map([
      ["My Day", { schemas }],
      ["Routines", { schemas }],
      ["Events", { schemas }],
    ]),
    spacesIndex: new Map([
      ["My Day", { type: "folder", path: "My Day", name: "My Day" }],
      ["Routines", { type: "folder", path: "Routines", name: "Routines" }],
      ["Events", { type: "folder", path: "Events", name: "Events" }],
    ]),
    spacesMap: {
      getInverse: (context: string) =>
        context == "Routines"
          ? ["Routines/Morning Walk.md"]
          : context == "Events"
            ? ["Events/Dinner.md"]
            : ["My Day/Host.md"],
    },
    pathsIndex: new Map([
      [
        "Routines/Morning Walk.md",
        { metadata: { property: { priority_num: 1 } } },
      ],
      ["Events/Dinner.md", { metadata: { property: { importance: 2 } } }],
      ["My Day/Host.md", { metadata: { property: { priority: 9 } } }],
    ]),
    eventsDispatcher: { addListener: jest.fn(), removeListener: jest.fn() },
    reloadContext: jest.fn(async (): Promise<void> => undefined),
    reloadContextByPath: jest.fn(async (): Promise<void> => undefined),
    spaceManager: {
      tablesForSpace: jest.fn(async () => schemas),
      readTable,
      saveTable,
      saveProperties,
      deleteProperty: jest.fn(async (): Promise<void> => undefined),
      resolvePath: (path: string) => path,
      contextForSpace: jest.fn(async (): Promise<null> => null),
    },
    ui: { notify: jest.fn(), setActivePath: jest.fn() },
  } as any;
  const saveSchema = jest.fn(async (): Promise<void> => undefined);
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root: Root = createRoot(container);

  await act(async () => {
    root.render(
      <SpaceContext.Provider
        value={{
          spaceInfo: { path: "My Day", readOnly: false },
          readMode: false,
          spaceState: {
            path: "My Day",
            contexts: [],
            properties: [],
            space: { readOnly: false },
          },
        }}
      >
        <PathContext.Provider value={{ pathState: { path: "My Day" }, readMode: false }}>
          <FramesMDBContext.Provider
            value={{
              frameSchemas: [mountedFrameSchema],
              frameSchema: mountedFrameSchema,
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
  return { superstate, readTable, saveTable, saveProperties, root, container };
};

const unmount = (root: Root, container: HTMLElement) => {
  act(() => root.unmount());
  container.remove();
};

describe("ContextEditorProvider cross-database read projection", () => {
  beforeEach(() => {
    capturedContext = null;
  });

  it("loads and maps every configured source when the default-on flag is enabled", async () => {
    const mounted = await mount(undefined);

    expect(capturedContext.crossDatabase).toBe(true);
    expect(capturedContext.cols.map((column: any) => column.name)).toEqual([
      PathPropertyName,
      "priority",
      "Source",
    ]);
    expect(capturedContext.data).toEqual([
      expect.objectContaining({
        [PathPropertyName]: "Routines/Morning Walk.md",
        priority: "1",
        Source: "Routines",
      }),
      expect.objectContaining({
        [PathPropertyName]: "Events/Dinner.md",
        priority: "2",
        Source: "Events",
      }),
    ]);
    expect(mounted.readTable).toHaveBeenCalledWith("Routines", "files");
    expect(mounted.readTable).toHaveBeenCalledWith("Events", "files");

    unmount(mounted.root, mounted.container);
  });

  it("fails one invalid configured source closed and notifies once for that source", async () => {
    const invalidFrameSchema = {
      ...frameSchema,
      def: {
        ...frameSchema.def,
        sources: frameSchema.def.sources.map((source, index) =>
          index == 0
            ? {
                ...source,
                filters: [
                  {
                    field: "priority_num",
                    fn: "futureOperator",
                    value: "0",
                    fType: "number",
                  },
                ],
              }
            : source
        ),
      },
    };

    const mounted = await mount(true, invalidFrameSchema);

    expect(capturedContext.data).toEqual([
      expect.objectContaining({
        [PathPropertyName]: "Events/Dinner.md",
        Source: "Events",
      }),
    ]);
    expect(mounted.superstate.ui.notify).toHaveBeenCalledTimes(1);
    expect(mounted.superstate.ui.notify).toHaveBeenCalledWith(
      expect.stringContaining("Routines")
    );

    unmount(mounted.root, mounted.container);
  });

  it("firewalls projected value writes from frontmatter and every context MDB", async () => {
    const mounted = await mount(true);

    let result: any;
    await act(async () => {
      result = await capturedContext.updateValue(
        "priority",
        "3",
        "",
        0,
        "Routines/Morning Walk.md"
      );
    });

    expect(result.applied).toBe(0);
    expect(result.skipped[0].reason).toBe("read-only-projection");
    expect(mounted.saveProperties).not.toHaveBeenCalled();
    expect(mounted.saveTable).not.toHaveBeenCalled();
    expect(
      capturedContext.newColumn({
        name: "new_field",
        type: "text",
        source: frontmatterPropertySource,
        table: "",
      })
    ).toBe(false);
    expect(mounted.saveProperties).not.toHaveBeenCalled();
    expect(mounted.saveTable).not.toHaveBeenCalled();

    unmount(mounted.root, mounted.container);
  });

  it("uses the singular legacy source when the kill switch is off", async () => {
    const mounted = await mount(false);

    expect(capturedContext.crossDatabase).toBe(false);
    expect(capturedContext.data).toEqual([
      expect.objectContaining({ [PathPropertyName]: "My Day/Host.md" }),
    ]);
    expect(mounted.readTable).toHaveBeenCalledWith("My Day", "files");
    expect(mounted.readTable).not.toHaveBeenCalledWith("Routines", "files");

    unmount(mounted.root, mounted.container);
  });
});
