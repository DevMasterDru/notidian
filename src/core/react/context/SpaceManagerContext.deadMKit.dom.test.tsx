/**
 * @jest-environment jsdom
 */
// Offline (jsdom) regression coverage for the dead-MKit-preview-runtime removal
// (bd Notidian-rzv, finalizing the Notidian-bnb live-verify / ADR 0018).
//
// WHY THIS TEST EXISTS: SpaceManagerContext is a core render-path context
// (consumed by SpaceView, MDBFileViewer, inlineContextLoader, NavigatorView, …)
// and the repo has no live render coverage, so a deletion's render-correctness
// cannot be proven by tsc/build alone. The deletion is provably
// behavior-preserving by construction: the only thing that EVER mounted a real
// MKitProvider was the .mkit installer (MKitFileViewer), removed in Notidian-ala;
// MKitContext.tsx was then deleted (Notidian-bnb). With no provider mounted, the
// old `useMKitPreviewContext()` returned the inert createContext default
// (isPreviewMode:false), so every `mkit://preview/` branch in the non-MKit
// SpaceManagerProvider was already dead. The owner live-verified the
// short-circuited state, so this change DELETES those dead branches outright; the
// `removeMKitPreviewRuntime` flag is retired. This test now pins the SINGLE
// post-prune state: render the REAL provider (no mocked module internals) and
// assert that:
//   - the public SpaceManager API shape is intact and stable,
//   - isPreviewMode is false (no preview branch exists),
//   - read/resolve/pathState operations delegate to superstate.spaceManager —
//     i.e. the non-MKit path the live vault actually uses,
//   - the external-consumer contract (spaceManager.isPreviewMode, read by
//     SpaceContext / PathCrumb / SpaceFragmentView) still resolves to the same
//     inert `false` those consumers depend on.
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
  // The methods the provider delegates to in the live (non-preview) path. Each
  // records the call so we can prove the fallback path was taken, and returns a
  // recognizable sentinel.
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

const makeSuperstate = (record: string[]): any => {
  const pathsIndex = new Map<string, any>([
    ["note.md", { path: "note.md", name: "note", type: "file" }],
  ]);
  const contextsIndex = new Map<string, any>([
    ["space", { path: "space" } as any],
  ]);
  return {
    // No removeMKitPreviewRuntime flag exists post-prune; the provider must
    // behave identically regardless of any leftover setting.
    settings: {},
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
  // The external-consumer contract (spaceManager.isPreviewMode, read by
  // SpaceContext / PathCrumb / SpaceFragmentView) — must survive the prune.
  "isPreviewMode",
  "getContextsIndexMap",
  "api",
  "spaceManager",
];

// ---- Tests -----------------------------------------------------------------

describe("SpaceManagerProvider — dead MKit-preview runtime pruned (Notidian-rzv)", () => {
  let record: string[];
  let value: Captured;
  let root: Root;
  let container: HTMLElement;
  let superstate: any;

  beforeEach(() => {
    record = [];
    superstate = makeSuperstate(record);
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

  it("is never in preview mode (the MKit preview runtime no longer exists)", () => {
    expect(value.isPreviewMode).toBe(false);
  });

  it("readTable delegates to superstate.spaceManager (the live path)", async () => {
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

  it("exposes the superstate api + spaceManager references unchanged", () => {
    expect(value.api).toBe(superstate.api);
    expect(value.spaceManager).toBe(superstate.spaceManager);
  });

  it("no longer exposes the removed MKit path helpers", () => {
    // isMKitPath / convertMKitPath were internal-only (besides the value) and are
    // gone after the prune; only the inert isPreviewMode contract remains.
    expect(value).not.toHaveProperty("isMKitPath");
    expect(value).not.toHaveProperty("convertMKitPath");
  });
});
