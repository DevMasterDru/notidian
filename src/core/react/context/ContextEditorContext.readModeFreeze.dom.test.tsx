/**
 * @jest-environment jsdom
 *
 * H2 embed hygiene (Notidian-pb7p.2 / Atlas ADR-0096) — hard read-only freezes
 * view-predicate persistence.
 *
 * An embed with `editable: false` mounts its provider chain under a
 * PathContext whose readMode is true (SpaceFragmentView -> PathProvider).
 * Before H2, ContextEditorContext.savePredicate persisted straight through
 * saveSchema regardless — a live write path into the saved view from a
 * derived read-only surface. H2's contract:
 *   (1) in read mode, savePredicate NEVER reaches saveSchema (the saved view
 *       is frozen), but
 *   (2) the change still applies to LOCAL predicate state, so ephemeral
 *       interactions (collapse toggles, local sorts) keep working, and
 *   (3) a non-read-mode mount persists exactly as before (gate polarity).
 *
 * Row-edit policy is explicitly OUT of scope (ADR-0095 edit-as-capture).
 */
import React, { useContext } from "react";
import { act } from "react-dom/test-utils";
import { createRoot } from "react-dom/client";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

jest.mock("core/react/context/SpaceContext", () => ({
  SpaceContext: require("react").createContext({
    spaceInfo: { path: "Test/Database", readOnly: false },
    readMode: false,
    spaceState: { contexts: [] },
  }),
}));
jest.mock("core/react/context/PathContext", () => ({
  PathContext: require("react").createContext({
    pathState: { path: "Test/Database" },
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
import { Filter } from "shared/types/predicate";

const contextPath = "Test/Database";
const rowPath = "Test/Database/Row.md";

const table = {
  schema: { id: "files", name: "Files", type: "db", primary: "true" },
  cols: [
    { name: PathPropertyName, type: "fileprop", schemaId: "files", primary: "true" },
    { name: "Status", type: "text", schemaId: "files", source: frontmatterPropertySource },
  ],
  rows: [{ [PathPropertyName]: rowPath, Status: "Open" }],
} as any;

const userFilter: Filter = {
  field: "Status",
  fn: "is",
  value: "Open",
  fType: "text",
};

let capturedContext: any;

const CaptureContext = (): React.ReactElement | null => {
  capturedContext = useContext(ContextEditorContext);
  return null;
};

const buildSuperstate = () =>
  ({
    settings: { autoImportObsidianPropertiesToContexts: false },
    contextsIndex: new Map([
      [
        contextPath,
        { schemas: [{ id: "files", name: "Files", type: "db", primary: "true" }] },
      ],
    ]),
    spacesIndex: new Map([[contextPath, { type: "folder" }]]),
    spacesMap: { getInverse: (): string[] => [rowPath] },
    pathsIndex: new Map([
      [rowPath, { metadata: { property: { Status: "Open" } } }],
    ]),
    eventsDispatcher: { addListener: jest.fn(), removeListener: jest.fn() },
    reloadContext: jest.fn().mockResolvedValue(undefined),
    reloadContextByPath: jest.fn().mockResolvedValue(undefined),
    spaceManager: {
      readTable: jest.fn(async () => table),
      saveTable: jest.fn(async () => true),
      mutateTable: jest.fn(async () => true),
      saveProperties: jest.fn().mockResolvedValue(true),
      deleteProperty: jest.fn().mockResolvedValue(undefined),
      resolvePath: (path: string) => path,
    },
    ui: { notify: jest.fn(), setActivePath: jest.fn() },
  } as any);

const frameSchema = {
  id: "filesView",
  name: "Files View",
  type: "view",
  def: { db: "files" },
  predicate: JSON.stringify({
    filters: [],
    sort: [],
    groupBy: [],
    colsOrder: [PathPropertyName, "Status"],
    colsHidden: [],
    colsSize: {},
  }),
} as any;

const mountProvider = async (opts: { readMode: boolean }) => {
  const superstate = buildSuperstate();
  const saveSchema = jest.fn().mockResolvedValue(undefined);
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  await act(async () => {
    root.render(
      <SpaceContext.Provider
        value={{
          spaceInfo: { path: contextPath, readOnly: false },
          readMode: false,
          spaceState: { contexts: [] },
        }}
      >
        <PathContext.Provider
          value={{ pathState: { path: contextPath }, readMode: opts.readMode }}
        >
          <FramesMDBContext.Provider
            value={{ frameSchemas: [frameSchema], frameSchema, saveSchema }}
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

  return { superstate, saveSchema, container, root };
};

describe("read-mode predicate freeze (Notidian-pb7p.2 / Atlas ADR-0096 H2)", () => {
  beforeEach(() => {
    capturedContext = null;
  });

  it("freezes predicate persistence in read mode — savePredicate never reaches saveSchema", async () => {
    const { root, container, saveSchema } = await mountProvider({
      readMode: true,
    });

    saveSchema.mockClear();
    await act(async () => {
      await capturedContext.savePredicate({ filters: [userFilter] });
    });

    expect(saveSchema).not.toHaveBeenCalled();

    act(() => root.unmount());
    container.remove();
  });

  it("still applies the frozen change to local predicate state (ephemeral)", async () => {
    const { root, container } = await mountProvider({ readMode: true });

    await act(async () => {
      await capturedContext.savePredicate({ filters: [userFilter] });
    });

    expect(capturedContext.predicate.filters).toEqual(
      expect.arrayContaining([expect.objectContaining({ field: "Status" })])
    );

    act(() => root.unmount());
    container.remove();
  });

  it("persists through saveSchema when not in read mode (gate polarity control)", async () => {
    const { root, container, saveSchema } = await mountProvider({
      readMode: false,
    });

    saveSchema.mockClear();
    await act(async () => {
      await capturedContext.savePredicate({ filters: [userFilter] });
    });

    expect(saveSchema).toHaveBeenCalled();
    const payload = saveSchema.mock.calls[saveSchema.mock.calls.length - 1][0];
    expect(JSON.parse(payload.predicate).filters).toEqual(
      expect.arrayContaining([expect.objectContaining({ field: "Status" })])
    );

    act(() => root.unmount());
    container.remove();
  });
});
