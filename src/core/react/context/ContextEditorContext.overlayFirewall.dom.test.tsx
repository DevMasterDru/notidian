/**
 * @jest-environment jsdom
 *
 * ADR-0066 (Topic Hub) / Notidian-ioxi — T2 ADVERSARIAL ANCHOR.
 *
 * The render-path declared-view overlay (a notidian embed `where:` block, here
 * modeled as ContextEditorProvider's `predicateOverlay` prop) must:
 *   (1) narrow the READ path (only matching rows render) when the
 *       renderPathViewOverlays kill-switch is on (default), and
 *   (2) NEVER leak into the WRITE path — savePredicate/saveSchema must persist
 *       ONLY the view's own filters, never the overlay filters (the ADR-0066
 *       Wave-3 write firewall), and
 *   (3) be fully ignored when the kill-switch flag is off (legacy: unfiltered).
 *
 * The firewall assertion is meaningful precisely because the overlay's fn (`is`)
 * IS a known filter operator — so it would survive cleanPredicateType if it ever
 * reached the write path. Its absence proves it is firewalled by architecture
 * (never entering `predicate` state / savePredicate), not by incidental
 * validation stripping.
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
import { Filter, Predicate } from "shared/types/predicate";

const contextPath = "Test/Database";
const gidiPath = "Test/Database/Gidi.md";
const otherPath = "Test/Database/Other.md";
const lowPriorityPath = "Test/Database/Low.md";
const donePath = "Test/Database/Done.md";

// A global database whose rows carry a `repo` property. The topic page overlays
// `where: repo = Gidi`.
const table = {
  schema: { id: "files", name: "Files", type: "db", primary: "true" },
  cols: [
    { name: PathPropertyName, type: "fileprop", schemaId: "files", primary: "true" },
    { name: "Status", type: "text", schemaId: "files", source: frontmatterPropertySource },
    { name: "repo", type: "text", schemaId: "files", source: frontmatterPropertySource },
    { name: "priority", type: "text", schemaId: "files", source: frontmatterPropertySource },
  ],
  rows: [
    { [PathPropertyName]: gidiPath, Status: "Open", repo: "Gidi", priority: "urgent" },
    { [PathPropertyName]: otherPath, Status: "Open", repo: "Other", priority: "urgent" },
    { [PathPropertyName]: lowPriorityPath, Status: "Open", repo: "Gidi", priority: "later" },
    { [PathPropertyName]: donePath, Status: "Done", repo: "Gidi", priority: "urgent" },
  ],
} as any;

const declarationOverlayFilter: Filter = {
  field: "repo",
  fn: "is",
  value: "Gidi",
  fType: "text",
};
const embedOverlayFilter: Filter = {
  field: "priority",
  fn: "is",
  value: "urgent",
  fType: "text",
};
const overlay = { filters: [declarationOverlayFilter, embedOverlayFilter] };
const richOverlay: Partial<Predicate> = {
  ...overlay,
  sort: [{ field: "priority", fn: "reverseAlphabetical" }],
  groupBy: ["repo"],
  colsOrder: [PathPropertyName, "priority"],
  colsHidden: ["Status", "repo"],
  limit: 1,
  view: "table",
  listView: "",
  listGroup: "",
  listItem: "",
};

let capturedContext: any;

const CaptureContext = (): React.ReactElement | null => {
  capturedContext = useContext(ContextEditorContext);
  return null;
};

const buildSuperstate = (renderPathViewOverlays: boolean | undefined) =>
  ({
    settings: {
      autoImportObsidianPropertiesToContexts: false,
      ...(renderPathViewOverlays === undefined
        ? {}
        : { renderPathViewOverlays }),
    },
    contextsIndex: new Map([
      [
        contextPath,
        { schemas: [{ id: "files", name: "Files", type: "db", primary: "true" }] },
      ],
    ]),
    spacesIndex: new Map([[contextPath, { type: "folder" }]]),
    spacesMap: { getInverse: (): string[] => [gidiPath, otherPath, lowPriorityPath, donePath] },
    pathsIndex: new Map([
      [gidiPath, { metadata: { property: { Status: "Open", repo: "Gidi", priority: "urgent" } } }],
      [otherPath, { metadata: { property: { Status: "Open", repo: "Other", priority: "urgent" } } }],
      [lowPriorityPath, { metadata: { property: { Status: "Open", repo: "Gidi", priority: "later" } } }],
      [donePath, { metadata: { property: { Status: "Done", repo: "Gidi", priority: "urgent" } } }],
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
  // The persisted view excludes Done; declaration + embed overlays narrow it
  // further by repo then priority.
  predicate: JSON.stringify({
    filters: [{ field: "Status", fn: "isNot", value: "Done", fType: "text" }],
    sort: [],
    groupBy: [],
    colsOrder: [PathPropertyName, "Status", "repo", "priority"],
    colsHidden: [],
    colsSize: {},
  }),
} as any;

const mountProvider = async (opts: {
  renderPathViewOverlays?: boolean;
  overlay?: Partial<Predicate>;
}) => {
  const superstate = buildSuperstate(opts.renderPathViewOverlays);
  const saveSchema = jest.fn().mockResolvedValue(undefined);
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

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
            value={{ frameSchemas: [frameSchema], frameSchema, saveSchema }}
          >
            <ContextEditorProvider
              superstate={superstate}
              predicateOverlay={opts.overlay}
            >
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

describe("render-path overlay — read-path only + write firewall (Notidian-ioxi)", () => {
  beforeEach(() => {
    capturedContext = null;
  });

  it("applies the overlay to the READ path — only matching rows render (default-on)", async () => {
    const { root, container } = await mountProvider({
      overlay,
    });

    const visibleRepos = (capturedContext.filteredData as any[])
      .map((r) => r.repo)
      .sort();
    expect(visibleRepos).toEqual(["Gidi"]);
    expect((capturedContext.filteredData as any[]).map((r) => r.priority)).toEqual([
      "urgent",
    ]);

    act(() => root.unmount());
    container.remove();
  });

  it("NEVER persists overlay filters through savePredicate/saveSchema (write firewall)", async () => {
    const { root, container, saveSchema } = await mountProvider({
      overlay,
    });

    // A genuine user edit through the FilterBar write path: add the view's OWN
    // filter. This is the only thing that may be persisted.
    saveSchema.mockClear();
    await act(async () => {
      await capturedContext.savePredicate({
        filters: [{ field: "Status", fn: "is", value: "Open", fType: "text" }],
      });
    });

    expect(saveSchema).toHaveBeenCalled();
    const payload = saveSchema.mock.calls[saveSchema.mock.calls.length - 1][0];
    const savedPredicate = JSON.parse(payload.predicate);

    // The user's own filter survives (proves the write path is live)...
    expect(savedPredicate.filters).toEqual(
      expect.arrayContaining([expect.objectContaining({ field: "Status" })])
    );
    // ...but the overlay filter is FIREWALLED out of the persisted payload.
    expect(
      savedPredicate.filters.some(
        (f: Filter) => f.field === "repo" || f.value === "Gidi"
      )
    ).toBe(false);
    // "Gidi" is the overlay filter's value and appears nowhere else in the view
    // schema (the column name "repo" legitimately lives in colsOrder, so it is
    // NOT a firewall signal); its absence from the raw payload is the guard.
    expect(payload.predicate).not.toContain("Gidi");
    expect(payload.predicate).not.toContain("urgent");

    // And a save that does not touch filters at all also never leaks the overlay.
    saveSchema.mockClear();
    await act(async () => {
      await capturedContext.savePredicate({ limit: 7 });
    });
    const payload2 = saveSchema.mock.calls[saveSchema.mock.calls.length - 1][0];
    expect(payload2.predicate).not.toContain("Gidi");
    expect(
      JSON.parse(payload2.predicate).filters.some(
        (f: Filter) => f.field === "repo"
      )
    ).toBe(false);

    act(() => root.unmount());
    container.remove();
  });

  it("projects rich values into render context without changing native state", async () => {
    const { root, container } = await mountProvider({ overlay: richOverlay });

    expect(capturedContext.predicate).toEqual(
      expect.objectContaining({
        sort: richOverlay.sort,
        groupBy: richOverlay.groupBy,
        colsOrder: richOverlay.colsOrder,
        colsHidden: richOverlay.colsHidden,
        limit: 1,
        view: "table",
      })
    );
    expect(capturedContext.filteredData).toHaveLength(1);

    act(() => root.unmount());
    container.remove();
  });

  it("NEVER persists rich projection values through savePredicate/saveSchema", async () => {
    const { root, container, saveSchema } = await mountProvider({
      overlay: richOverlay,
    });

    saveSchema.mockClear();
    await act(async () => {
      await capturedContext.savePredicate({
        sort: richOverlay.sort,
        groupBy: richOverlay.groupBy,
        colsOrder: richOverlay.colsOrder,
        colsHidden: richOverlay.colsHidden,
        limit: 99,
        view: "month",
        listView: "changed",
        listGroup: "changed",
        listItem: "changed",
        tableDirection: "rtl",
      });
    });

    const payload = saveSchema.mock.calls[saveSchema.mock.calls.length - 1][0];
    const savedPredicate = JSON.parse(payload.predicate);
    expect(savedPredicate.sort).toEqual([]);
    expect(savedPredicate.groupBy).toEqual([]);
    expect(savedPredicate.colsOrder).toEqual([
      PathPropertyName,
      "Status",
      "repo",
      "priority",
    ]);
    expect(savedPredicate.colsHidden).toEqual([]);
    expect(savedPredicate.limit).toBe(0);
    expect(savedPredicate.view).not.toBe("month");
    expect(savedPredicate.tableDirection).toBe("rtl");

    act(() => root.unmount());
    container.remove();
  });

  it("ignores the overlay when the kill-switch flag is OFF (legacy: unfiltered)", async () => {
    const { root, container } = await mountProvider({
      renderPathViewOverlays: false,
      overlay,
    });

    const visibleRepos = (capturedContext.filteredData as any[])
      .map((r) => r.repo)
      .sort();
    // Both rows render — the overlay was dropped at the merge seam.
    expect(visibleRepos).toEqual(["Gidi", "Gidi", "Other"]);

    act(() => root.unmount());
    container.remove();
  });

  it("restores every native rich value when the kill-switch flag is OFF", async () => {
    const { root, container } = await mountProvider({
      renderPathViewOverlays: false,
      overlay: richOverlay,
    });

    expect(capturedContext.predicate.sort).toEqual([]);
    expect(capturedContext.predicate.groupBy).toEqual([]);
    expect(capturedContext.predicate.colsOrder).toEqual([
      PathPropertyName,
      "Status",
      "repo",
      "priority",
    ]);
    expect(capturedContext.predicate.colsHidden).toEqual([]);
    expect(capturedContext.predicate.limit).toBe(0);

    act(() => root.unmount());
    container.remove();
  });

  it("renders unfiltered when no overlay is supplied (byte-for-byte legacy)", async () => {
    const { root, container } = await mountProvider({});

    const visibleRepos = (capturedContext.filteredData as any[])
      .map((r) => r.repo)
      .sort();
    expect(visibleRepos).toEqual(["Gidi", "Gidi", "Other"]);

    act(() => root.unmount());
    container.remove();
  });
});
