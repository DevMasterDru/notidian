/**
 * @jest-environment jsdom
 */
// bd Notidian-06ix — runRoot concurrent-run race regression.
//
// WHY THIS TEST EXISTS: runRoot's `.then` used to call `setInstance(s)` and
// reassign `activeRunID.current = s.id` UNCONDITIONALLY. If a second runRoot
// call starts (e.g. a rootProps/contexts change, or a bless re-run) while an
// earlier call's executeTreeNode promise is still in flight, whichever
// execution's promise SETTLES LAST wins both the rendered instance and
// activeRunID — even when it is the SUPERSEDED (stale) run. That silently
// regresses the rendered instance to stale state, and — because later
// saveState calls are gated on `activeRunID.current == runID` (the guard a
// few lines above runRoot) — permanently drops the FRESH run's own saveState
// writes from then on (they keep bailing against the wrong id).
//
// THE FIX mirrors that pre-existing saveState guard inside runRoot's `.then`:
// bail out (no-op, no setInstance, no activeRunID reassignment) when
// `activeRunID.current !== runID`, where `runID` is the id captured in the
// closure at call time. A superseded run's `.then` can then never clobber a
// fresher run's instance/activeRunID, no matter the resolution order.
//
// METHOD: mock executeTreeNode (core/utils/frames/runner) so each call's
// promise resolves under direct test control — this is the slow/async
// boundary that genuinely needs external timing control to simulate the race;
// everything else (the real FrameInstanceProvider, its real activeRunID ref,
// the real guard logic, the real saveState) stays live. Drive TWO overlapping
// runRoot() calls (A automatically on mount, B manually while A is still in
// flight, so B supersedes A), resolve B first and A last, and assert:
//   - `instance` (the context's public, externally observable state) reflects
//     B both right after B resolves AND after A subsequently resolves — A's
//     `.then` must not clobber it;
//   - `activeRunID.current` — which has no direct external accessor — still
//     gates on B's runID and not A's, observed THROUGH the only other place
//     that reads it: the pre-existing saveState guard. A saveState call
//     carrying B's id must still proceed; one carrying A's (stale) id must
//     still bail. That is the sole externally observable surface for that
//     internal ref, so it is the correct way to pin its value from outside.
// A second scenario pins the single-run (non-race) path is unchanged.
import React from "react";
import { act } from "react-dom/test-utils";
import { createRoot, Root } from "react-dom/client";
import { FrameContexts, FrameRunInstance } from "shared/types/frameExec";
import { FrameRootContext } from "./FrameRootContext";
import {
  FrameInstanceContext,
  FrameInstanceProvider,
} from "./FrameInstanceContext";
import { resetFrameTrustSession } from "core/utils/frames/frameTrustSession";

// React 18 act() environment flag (matches the other .dom.test.tsx suites).
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

// shared/utils/uuid is an untransformed ESM .js file ts-jest cannot parse
// (same workaround as FrameContainerView.frameIdentity.dom.test.tsx and the
// other .dom.test.tsx suites that pull it in transitively).
jest.mock("shared/utils/uuid", () => ({ genId: () => "test-uid" }));

// executeTreeNode is the slow/async tree-execution engine. Mocking it is the
// only way to hold two overlapping runs open simultaneously under test
// control; the concurrency-guard logic under test lives entirely in the REAL
// (unmocked) runRoot/saveState in FrameInstanceContext.tsx.
jest.mock("core/utils/frames/runner", () => ({
  executeTreeNode: jest.fn(),
}));
// eslint-disable-next-line @typescript-eslint/no-var-requires
const runnerModule = require("core/utils/frames/runner");
const mockExecuteTreeNode: jest.Mock = runnerModule.executeTreeNode;

type Captured = React.ContextType<typeof FrameInstanceContext>;

type PendingRun = {
  runID: string;
  resolve: (value: FrameRunInstance) => void;
};

// A minimal, self-referential fake frame tree. Real trust/provenance helpers
// (restampSessionBless, reStampProvenanceFromSource, ...) are safe no-ops on
// this shape (guard-claused on `!tree?.node` / never-blessed-this-session),
// and it survives `_.cloneDeep`.
const FAKE_ROOT: any = {
  id: "root-node",
  node: { id: "root-node", type: "group", schemaId: "s1" },
  children: [],
};

const makeInstance = (runID: string, tag: string): FrameRunInstance => ({
  id: runID,
  state: {},
  slides: {},
  root: FAKE_ROOT,
  exec: { id: `exec-${tag}`, node: FAKE_ROOT.node, children: [] } as any,
  contexts: {} as FrameContexts,
});

const makeSuperstate = (): any => ({
  spaceManager: { api: { sentinel: "api" } },
  settings: {},
  ui: { notify: jest.fn() },
});

let container: HTMLDivElement;
let root: Root;
let pending: PendingRun[];
let captured: Captured;

const Capture: React.FC = () => {
  captured = React.useContext(FrameInstanceContext);
  return null;
};

const renderProvider = (superstate: any) => {
  act(() => {
    root.render(
      <FrameRootContext.Provider
        value={{ root: FAKE_ROOT, path: "test/frame/path" }}
      >
        <FrameInstanceProvider id="root" superstate={superstate} editable={false}>
          <Capture />
        </FrameInstanceProvider>
      </FrameRootContext.Provider>
    );
  });
};

// Resolves one pending run and flushes the microtasks its `.then` handler
// (and the resulting setInstance re-render) needs — mirrors the
// `settleOldest` idiom in TableView.undoReentrancy.dom.test.tsx.
const settle = async (run: PendingRun, value: FrameRunInstance) => {
  await act(async () => {
    run.resolve(value);
    await Promise.resolve();
    await Promise.resolve();
  });
};

beforeEach(() => {
  resetFrameTrustSession();
  pending = [];
  captured = null;
  mockExecuteTreeNode.mockReset();
  mockExecuteTreeNode.mockImplementation(
    (_tree: unknown, _store: unknown, ctx: { runID: string }) =>
      new Promise<FrameRunInstance>((resolve) => {
        pending.push({ runID: ctx.runID, resolve });
      })
  );
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("FrameInstanceContext.runRoot — concurrent-run race (Notidian-06ix)", () => {
  it("a superseded run's .then is a no-op: the fresher run wins instance + activeRunID regardless of settle order", async () => {
    const superstate = makeSuperstate();
    renderProvider(superstate);

    // Mount's own effect fires ONE automatic runRoot (instance.root starts
    // null, so the effect's else-branch calls runRoot()) — this is run A.
    expect(mockExecuteTreeNode).toHaveBeenCalledTimes(1);
    const runA = pending[0];
    expect(runA).toBeDefined();

    // Trigger run B directly through the exposed context contract (mirrors a
    // real re-run trigger — e.g. blessFrame(), or a rootProps/contexts
    // change) WHILE run A is still unsettled. B supersedes A.
    act(() => {
      captured!.runRoot();
    });
    expect(mockExecuteTreeNode).toHaveBeenCalledTimes(2);
    const runB = pending[1];
    expect(runB).toBeDefined();
    expect(runB.runID).not.toBe(runA.runID);

    const sA = makeInstance(runA.runID, "A");
    const sB = makeInstance(runB.runID, "B");

    // The fresher run (B) settles FIRST.
    await settle(runB, sB);
    expect(captured!.instance).toBe(sB);

    // The superseded run (A) settles LAST — exactly the race the bug let win.
    await settle(runA, sA);

    // FIX: A's .then must have been a no-op — instance still reflects B, not A.
    expect(captured!.instance).toBe(sB);
    expect(captured!.instance).not.toBe(sA);

    // activeRunID.current has no direct external accessor; the pre-existing
    // saveState guard (`if (activeRunID.current != runID) return;`) is the
    // ONLY other place that reads it, so probe THROUGH it.
    //
    // A saveState call carrying B's id must still proceed (proves
    // activeRunID.current === runB.runID, i.e. was never regressed to A's).
    mockExecuteTreeNode.mockClear();
    act(() => {
      captured!.saveState({}, sB);
    });
    expect(mockExecuteTreeNode).toHaveBeenCalledTimes(1);

    // A saveState call carrying A's (stale, superseded) id must still bail.
    mockExecuteTreeNode.mockClear();
    act(() => {
      captured!.saveState({}, sA);
    });
    expect(mockExecuteTreeNode).toHaveBeenCalledTimes(0);
  });

  it("single-run path is unchanged: instance + saveState still update normally with no overlapping run", async () => {
    const superstate = makeSuperstate();
    renderProvider(superstate);

    expect(mockExecuteTreeNode).toHaveBeenCalledTimes(1);
    const onlyRun = pending[0];
    const s = makeInstance(onlyRun.runID, "only");

    await settle(onlyRun, s);
    expect(captured!.instance).toBe(s);

    // activeRunID.current now equals this run's id (s.id === the captured
    // runID, unchanged single-run behavior) — a saveState call keyed to it
    // must proceed, exactly as before this fix.
    mockExecuteTreeNode.mockClear();
    act(() => {
      captured!.saveState({}, s);
    });
    expect(mockExecuteTreeNode).toHaveBeenCalledTimes(1);
  });
});
