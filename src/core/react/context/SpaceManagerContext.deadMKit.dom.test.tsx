/**
 * @jest-environment jsdom
 */
// Offline (jsdom) coverage for the dead-MKit-preview-runtime removal
// (bd Notidian-bnb / ADR 0018).
//
// WHY THIS TEST EXISTS: SpaceManagerContext is a core render-path context
// (consumed by SpaceView, MDBFileViewer, inlineContextLoader, NavigatorView, …)
// and the repo has no live render coverage, so a deletion's render-correctness
// cannot be proven by tsc/build alone (this is why the bead is flag-gated, per
// AGENTS.md "Autonomous Implementation Mode"). The deletion is, however,
// provably behavior-preserving by construction: the only thing that EVER mounted
// a real MKitProvider was the .mkit installer (MKitFileViewer), removed in
// Notidian-ala. With no provider mounted, the old `useMKitPreviewContext()`
// returned the inert createContext default (isPreviewMode:false), so every
// `mkit://preview/` branch in the non-MKit SpaceManagerProvider was already
// dead. These tests render the REAL provider (no mocked module internals) and
// assert that, in BOTH flag states:
//   - the public SpaceManager API shape is intact and stable,
//   - isPreviewMode is false (no preview branch is ever reached),
//   - read/resolve operations delegate to superstate.spaceManager — i.e. the
//     non-MKit "fallback" path that the live vault actually uses,
//   - the external-consumer contract (spaceManager.isPreviewMode /
//     isMKitPath / convertMKitPath) still resolves to the same inert values
//     that SpaceContext / PathCrumb / SpaceFragmentView depend on.
import React from "react";
import { act } from "react-dom/test-utils";
import { createRoot, Root } from "react-dom/client";
import {
  SpaceManagerProvider,
  useSpaceManager,
} from "./SpaceManagerContext";

// React 18 act() environment flag.
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

// ---- Test scaffolding ------------------------------------------------------

type Captured = ReturnType<typeof useSpaceManager>;

const makeSpaceManagerStub = (record: string[]) => ({
  // The methods the provider delegates to in non-preview (live) mode. Each
  // records the call so we can prove the fallback path — not a mkit branch —
  // was taken, and returns a recognizable sentinel.
  readTable: jest.fn(async (path: string, _schema: string) => {
    record.push(`readTable:${path}`);
    return {
      schema: { id: "s", name: "s", type: "db" },
      cols: [] as any[],
      rows: [] as any[],
    };
  }),
  readAllTables: jest.fn(async (path: string) => {
    record.push(`readAllTables:${path}`);
    return {
      main: {
        schema: { id: "m", name: "m", type: "db" },
        cols: [] as any[],
        rows: [] as any[],
      },
    };
  }),
  tablesForSpace: jest.fn(async (path: string) => {
    record.push(`tablesForSpace:${path}`);
    return [{ id: "t", name: "t", type: "db" }];
  }),
  resolvePath: jest.fn((path: string, source?: string) => {
    record.push(`resolvePath:${path}|${source ?? ""}`);
    return `RESOLVED:${path}`;
  }),
  pathExists: jest.fn(async (path: string) => {
    record.push(`pathExists:${path}`);
    return true;
  }),
  uriByString: jest.fn((uri: string) => ({
    scheme: "",
    authority: "",
    path: uri,
    basePath: uri,
    fullPath: uri,
    ref: null as string | null,
    trailSlash: false,
  })),
});

const makeSuperstate = (
  removeMKitPreviewRuntime: boolean,
  record: string[]
): any => {
  const pathsIndex = new Map<string, any>([
    ["note.md", { path: "note.md", name: "note", type: "file" }],
  ]);
  const contextsIndex = new Map<string, any>([
    ["space", { path: "space" } as any],
  ]);
  return {
    settings: { removeMKitPreviewRuntime },
    spaceManager: makeSpaceManagerStub(record),
    pathsIndex,
    contextsIndex,
    api: { sentinel: "superstate-api" },
  };
};

const renderProvider = (
  superstate: any
): { value: Captured; root: Root; container: HTMLElement } => {
  let captured: Captured = null;
  const Capture: React.FC = () => {
    captured = useSpaceManager();
    return null;
  };
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(
      <SpaceManagerProvider superstate={superstate}>
        <Capture />
      </SpaceManagerProvider>
    );
  });
  return { value: captured as Captured, root, container };
};

const PUBLIC_API_KEYS = [
  "readTable",
  "saveTable",
  "readFrame",
  "saveFrame",
  "tablesForSpace",
  "framesForSpace",
  "resolvePath",
  "uriByString",
  "pathExists",
  "createSpace",
  "deleteSpace",
  "spaceInfoForPath",
  "contextForSpace",
  "addSpaceProperty",
  "saveProperties",
  "deleteProperty",
  "renameProperty",
  "createItemAtPath",
  "deletePath",
  "readPath",
  "writeToPath",
  "parentPathForPath",
  "allSpaces",
  "childrenForSpace",
  "spaceInitiated",
  "contextInitiated",
  "readAllTables",
  "readAllFrames",
  "saveSpace",
  "renameSpace",
  "spaceDefForSpace",
  "allPaths",
  "renamePath",
  "copyPath",
  "getPathInfo",
  "readPathCache",
  "getPathState",
  "getPathsIndexMap",
  "childrenForPath",
  "saveFrameSchema",
  "deleteFrame",
  // The external-consumer contract (read off spaceManager by SpaceContext /
  // PathCrumb / SpaceFragmentView) — must survive the runtime removal.
  "isPreviewMode",
  "convertMKitPath",
  "isMKitPath",
  "getContextsIndexMap",
  "api",
  "spaceManager",
];

// ---- Tests -----------------------------------------------------------------

describe.each([
  ["flag OFF (default — dead branches present, inert)", false],
  ["flag ON (branches short-circuited)", true],
])("SpaceManagerProvider — %s", (_label, removeFlag) => {
  let record: string[];
  let value: Captured;
  let root: Root;
  let container: HTMLElement;
  let superstate: any;

  beforeEach(() => {
    record = [];
    superstate = makeSuperstate(removeFlag as boolean, record);
    ({ value, root, container } = renderProvider(superstate));
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("exposes the full, stable public SpaceManager API shape", () => {
    expect(value).not.toBeNull();
    for (const key of PUBLIC_API_KEYS) {
      expect(value).toHaveProperty(key);
    }
  });

  it("is never in preview mode (no MKit provider is ever mounted)", () => {
    expect(value.isPreviewMode).toBe(false);
  });

  it("isMKitPath/convertMKitPath degrade to inert non-preview values", () => {
    // No path is an mkit path in a real vault; the helpers must not rewrite it.
    expect(value.isMKitPath("note.md")).toBe(false);
    expect(value.isMKitPath("spaces://x")).toBe(false);
    expect(value.convertMKitPath("note.md")).toBe("note.md");
  });

  it("readTable delegates to superstate.spaceManager (the live fallback path)", async () => {
    await act(async () => {
      await value.readTable("note.md", "main");
    });
    expect(superstate.spaceManager.readTable).toHaveBeenCalledWith(
      "note.md",
      "main"
    );
    expect(record).toContain("readTable:note.md");
  });

  it("readAllTables / tablesForSpace delegate to superstate (no mkit branch)", async () => {
    await act(async () => {
      await value.readAllTables("space");
      await value.tablesForSpace("space");
    });
    expect(record).toContain("readAllTables:space");
    expect(record).toContain("tablesForSpace:space");
  });

  it("resolvePath delegates to superstate.spaceManager", () => {
    const out = value.resolvePath("./child", "space/");
    expect(out).toBe("RESOLVED:./child");
    expect(record).toContain("resolvePath:./child|space/");
  });

  it("pathExists delegates to superstate.spaceManager", async () => {
    let exists: boolean;
    await act(async () => {
      exists = await value.pathExists("note.md");
    });
    expect(exists!).toBe(true);
    expect(record).toContain("pathExists:note.md");
  });

  it("getPathState reads the superstate paths index, not an MKit context", () => {
    expect(value.getPathState("note.md")).toEqual({
      path: "note.md",
      name: "note",
      type: "file",
    });
    expect(value.getPathState("missing")).toBeNull();
  });

  it("getPathsIndexMap / getContextsIndexMap return the superstate indexes", () => {
    expect(value.getPathsIndexMap()).toBe(superstate.pathsIndex);
    expect(value.getContextsIndexMap()).toBe(superstate.contextsIndex);
  });

  it("exposes the superstate api reference unchanged", () => {
    expect(value.api).toBe(superstate.api);
    expect(value.spaceManager).toBe(superstate.spaceManager);
  });
});

describe("SpaceManagerProvider — flag equivalence (OFF vs ON)", () => {
  it("produces identical observable behavior in both flag states", async () => {
    const recOff: string[] = [];
    const recOn: string[] = [];
    const ssOff = makeSuperstate(false, recOff);
    const ssOn = makeSuperstate(true, recOn);

    const a = renderProvider(ssOff);
    const b = renderProvider(ssOn);

    // Same public surface.
    expect(Object.keys(a.value).sort()).toEqual(Object.keys(b.value).sort());
    // Same preview state.
    expect(a.value.isPreviewMode).toBe(b.value.isPreviewMode);
    // Same delegation behavior.
    expect(a.value.resolvePath("./x", "space/")).toBe(
      b.value.resolvePath("./x", "space/")
    );
    expect(a.value.convertMKitPath("note.md")).toBe(
      b.value.convertMKitPath("note.md")
    );

    act(() => a.root.unmount());
    act(() => b.root.unmount());
    a.container.remove();
    b.container.remove();
  });
});
