/**
 * @jest-environment jsdom
 */
// bd Notidian-jsvy — saveState concurrent-call race regression (sibling to
// the Notidian-06ix runRoot race, commit 636cc64).
//
// WHY THIS TEST EXISTS: saveState's `.then` used to call `setInstance(s)`
// UNCONDITIONALLY once its executeTreeNode promise settled. saveState DOES
// guard at CALL TIME (`if (activeRunID.current != runID) return;`, before
// executeTreeNode is even invoked) but that pre-check says nothing about
// what happens WHILE the call is in flight. If a fresher run supersedes this
// call afterward — e.g. a runRoot() re-run (rootProps/contexts change, a
// bless re-run) or another saveState call becomes active — and THIS
// (now-superseded) call's promise settles LAST, its `.then` still
// unconditionally clobbers `instance` via setInstance(s), silently
// regressing the rendered instance to stale content.
//
// THE FIX mirrors the Notidian-06ix runRoot `.then` guard: bail out (no-op,
// no setInstance) when `activeRunID.current !== runID`, where `runID` is the
// id captured in saveState's closure at call time (already destructured from
// the `instance` argument for the pre-existing pre-check). UNLIKE runRoot's
// `.then`, saveState's `.then` never reassigns `activeRunID.current` itself
// — only the setInstance clobber needs guarding here.
//
// METHOD: mirrors FrameInstanceContext.runRootRace.dom.test.tsx exactly —
// mock executeTreeNode (core/utils/frames/runner) so each call's promise
// resolves under direct test control; everything else (the real
// FrameInstanceProvider, its real activeRunID ref, the real guard logic,
// the real saveState/runRoot) stays live. Drive TWO overlapping saveState
// calls whose in-flight windows are separated by an intervening runRoot()
// call that moves activeRunID.current forward, settle the fresher saveState
// call first and the superseded one last, and assert the superseded call's
// `.then` is a no-op. A second scenario pins the single-call (non-race) path
// still applies its resolved state to instance normally.
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
// (same workaround as FrameInstanceContext.runRootRace.dom.test.tsx and the
// other .dom.test.tsx suites that pull it in transitively).
jest.mock("shared/utils/uuid", () => ({ genId: () => "test-uid" }));

// executeTreeNode is the slow/async tree-execution engine. Mocking it is the
// only way to hold multiple overlapping runs open simultaneously under test
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
// `settleOldest` idiom in TableView.undoReentrancy.dom.test.tsx and the
// `settle` helper in FrameInstanceContext.runRootRace.dom.test.tsx.
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

describe("FrameInstanceContext.saveState — concurrent-call race (Notidian-jsvy)", () => {
  it("a superseded saveState call's .then is a no-op: a fresher saveState call wins instance regardless of settle order", async () => {
    const superstate = makeSuperstate();
    renderProvider(superstate);

    // Mount's own effect fires ONE automatic runRoot — run0.
    expect(mockExecuteTreeNode).toHaveBeenCalledTimes(1);
    const run0 = pending[0];
    expect(run0).toBeDefined();

    const s0 = makeInstance(run0.runID, "0");
    await settle(run0, s0);
    expect(captured!.instance).toBe(s0);

    // saveA: a saveState call keyed to the CURRENT run (s0). Its call-time
    // pre-check passes (activeRunID.current === s0.id), so it starts
    // executeTreeNode — but we hold its promise open.
    act(() => {
      captured!.saveState({}, s0);
    });
    expect(mockExecuteTreeNode).toHaveBeenCalledTimes(2);
    const saveA = pending[1];
    expect(saveA).toBeDefined();
    expect(saveA.runID).toBe(s0.id);

    // While saveA is still in flight, a FRESH runRoot() re-run starts (e.g. a
    // rootProps/contexts change or a bless re-run). This immediately moves
    // activeRunID.current forward to the new run's id (runRoot assigns it
    // synchronously at call time, before executeTreeNode even resolves).
    act(() => {
      captured!.runRoot();
    });
    expect(mockExecuteTreeNode).toHaveBeenCalledTimes(3);
    const run1 = pending[2];
    expect(run1).toBeDefined();
    expect(run1.runID).not.toBe(run0.runID);

    const s1 = makeInstance(run1.runID, "1");
    await settle(run1, s1);
    expect(captured!.instance).toBe(s1);

    // saveB: a fresh saveState call keyed to the NEW current run (s1). Its
    // call-time pre-check passes (activeRunID.current === s1.id === run1's
    // id), so it too starts executeTreeNode and is held open.
    act(() => {
      captured!.saveState({}, s1);
    });
    expect(mockExecuteTreeNode).toHaveBeenCalledTimes(4);
    const saveB = pending[3];
    expect(saveB).toBeDefined();
    expect(saveB.runID).toBe(s1.id);
    expect(saveB.runID).not.toBe(saveA.runID);

    const sSaveB = makeInstance(saveB.runID, "saveB");
    const sSaveA = makeInstance(saveA.runID, "saveA");

    // The fresher call (saveB) settles FIRST.
    await settle(saveB, sSaveB);
    expect(captured!.instance).toBe(sSaveB);

    // The superseded call (saveA) settles LAST — exactly the race the bug
    // let win: at settle time, activeRunID.current has already moved on to
    // run1's id, but saveA's closure still carries run0's (stale) id.
    await settle(saveA, sSaveA);

    // FIX: saveA's .then must have been a no-op — instance still reflects
    // saveB, not the stale saveA payload.
    expect(captured!.instance).toBe(sSaveB);
    expect(captured!.instance).not.toBe(sSaveA);
  });

  it("single-call path is unchanged: a non-overlapping saveState call still applies its resolved state to instance", async () => {
    const superstate = makeSuperstate();
    renderProvider(superstate);

    expect(mockExecuteTreeNode).toHaveBeenCalledTimes(1);
    const run0 = pending[0];
    const s0 = makeInstance(run0.runID, "0");
    await settle(run0, s0);
    expect(captured!.instance).toBe(s0);

    // A single saveState call, keyed to the current (only) run, with no
    // overlapping run in flight.
    act(() => {
      captured!.saveState({}, s0);
    });
    expect(mockExecuteTreeNode).toHaveBeenCalledTimes(2);
    const saveOnly = pending[1];
    expect(saveOnly).toBeDefined();

    const sApplied = makeInstance(saveOnly.runID, "applied");
    await settle(saveOnly, sApplied);

    // activeRunID.current still equals s0.id (unchanged since mount), which
    // still equals saveOnly's captured runID, so the post-settle guard must
    // let this resolved state through normally.
    expect(captured!.instance).toBe(sApplied);
  });
});
