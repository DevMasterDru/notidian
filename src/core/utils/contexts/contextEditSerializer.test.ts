import { SpaceTable } from "shared/types/mdb";
import {
  emptyTableEditTransactionResult,
  TableEditTransactionResult,
} from "./tableEditTransaction";
import {
  createContextEditSerializerState,
  runSerializedContextEdit,
  SerializedEditRun,
} from "./contextEditSerializer";

// These tests pin the concurrency-authority invariants the serializer claims in
// its own comments. The serializer is the fix for bd Notidian-lg1 (two
// concurrent context value edits captured the SAME rendered-table snapshot, so
// the second save overwrote the first — last-write-wins). It is pure
// async-ordering logic with an injected `run` fn, so it is fully provable
// offline with controlled/deferred promises — no superstate or DOM mocks.

// A controllable transaction: capture exactly what `run` was called with and
// hand back a promise we resolve/reject by hand. This lets us interleave the
// chain deterministically and observe ordering / threading.
type DeferredTxn = {
  run: SerializedEditRun;
  // Resolves once `run` has actually been invoked by the serializer.
  invoked: Promise<void>;
  invocations: number;
  // The tableData the serializer passed in on the (latest) invocation.
  lastTableData(): SpaceTable;
  // The session-edited-keys set the serializer passed in on the (latest)
  // invocation (the stale-conflict lag tracker, bd Notidian-2kf7).
  lastSessionEditedKeys(): Set<string>;
  // Synchronously fire onRootTableSaved with a given table (simulating the
  // transaction having persisted a new root table) before settling.
  saveRootTable(table: SpaceTable): void;
  resolve(result?: TableEditTransactionResult): void;
  reject(error: unknown): void;
};

const makeDeferredTxn = (): DeferredTxn => {
  let invokedResolve!: () => void;
  const invoked = new Promise<void>((r) => {
    invokedResolve = r;
  });

  let settle!: (result: TableEditTransactionResult) => void;
  let fail!: (error: unknown) => void;
  const settlePromise = new Promise<TableEditTransactionResult>(
    (resolveFn, rejectFn) => {
      settle = resolveFn;
      fail = rejectFn;
    }
  );

  let capturedTableData: SpaceTable | null = null;
  let capturedOnRootTableSaved: ((table: SpaceTable) => void) | null = null;
  let capturedSessionEditedKeys: Set<string> | null = null;
  let invocations = 0;

  const run: SerializedEditRun = ({
    tableData,
    onRootTableSaved,
    sessionEditedKeys,
  }) => {
    invocations += 1;
    capturedTableData = tableData;
    capturedOnRootTableSaved = onRootTableSaved;
    capturedSessionEditedKeys = sessionEditedKeys;
    invokedResolve();
    return settlePromise;
  };

  return {
    run,
    invoked,
    get invocations() {
      return invocations;
    },
    lastTableData() {
      if (!capturedTableData) {
        throw new Error("run has not been invoked yet");
      }
      return capturedTableData;
    },
    lastSessionEditedKeys() {
      if (!capturedSessionEditedKeys) {
        throw new Error("run has not been invoked yet");
      }
      return capturedSessionEditedKeys;
    },
    saveRootTable(table: SpaceTable) {
      if (!capturedOnRootTableSaved) {
        throw new Error("run has not been invoked yet");
      }
      capturedOnRootTableSaved(table);
    },
    resolve(result = emptyTableEditTransactionResult()) {
      settle(result);
    },
    reject(error: unknown) {
      fail(error);
    },
  };
};

// Distinct, identity-comparable SpaceTable fixtures. The serializer's reset
// logic keys off reference identity, so each table must be its own object.
let tableSeq = 0;
const makeTable = (label?: string): SpaceTable => {
  tableSeq += 1;
  const id = label ?? `table-${tableSeq}`;
  return {
    schema: {
      id,
      name: id,
      type: "db",
    },
    cols: [],
    rows: [],
  };
};

// Flush the microtask queue so chained .then callbacks (exec) run.
const flushMicrotasks = () => new Promise<void>((r) => setImmediate(r));

describe("contextEditSerializer", () => {
  it("runs transactions strictly in tail order even when enqueued concurrently", async () => {
    const state = createContextEditSerializerState();
    const rendered = makeTable("rendered");

    const order: string[] = [];

    const txnA = makeDeferredTxn();
    const txnB = makeDeferredTxn();
    const txnC = makeDeferredTxn();

    const wrap =
      (label: string, txn: DeferredTxn): SerializedEditRun =>
      (params) => {
        order.push(`start:${label}`);
        return txn.run(params);
      };

    // Enqueue all three back-to-back (concurrently), before any settle.
    const pA = runSerializedContextEdit(state, rendered, wrap("A", txnA));
    const pB = runSerializedContextEdit(state, rendered, wrap("B", txnB));
    const pC = runSerializedContextEdit(state, rendered, wrap("C", txnC));

    // Only A may begin; B and C wait on the tail.
    await txnA.invoked;
    expect(order).toEqual(["start:A"]);
    expect(txnB.invocations).toBe(0);
    expect(txnC.invocations).toBe(0);

    txnA.resolve();
    await txnB.invoked;
    expect(order).toEqual(["start:A", "start:B"]);
    expect(txnC.invocations).toBe(0);

    txnB.resolve();
    await txnC.invoked;
    expect(order).toEqual(["start:A", "start:B", "start:C"]);

    txnC.resolve();
    await Promise.all([pA, pB, pC]);
    expect(order).toEqual(["start:A", "start:B", "start:C"]);
  });

  it("threads the first edit's saved root table into the next edit sharing the same rendered reference (no last-write-wins)", async () => {
    const state = createContextEditSerializerState();
    const rendered = makeTable("rendered");

    const txnA = makeDeferredTxn();
    const txnB = makeDeferredTxn();

    // Both edits enqueue against the SAME rendered reference (the React tree has
    // not re-rendered between the two rapid edits — the original lg1 scenario).
    const pA = runSerializedContextEdit(state, rendered, txnA.run);
    const pB = runSerializedContextEdit(state, rendered, txnB.run);

    await txnA.invoked;
    // The first edit starts from the rendered table.
    expect(txnA.lastTableData()).toBe(rendered);

    // The first transaction persists a NEW root table (its applied result).
    const savedByA = makeTable("saved-by-A");
    txnA.saveRootTable(savedByA);
    txnA.resolve();

    await txnB.invoked;
    // The second edit must build on A's saved table, NOT the stale rendered
    // snapshot. This is the anti-last-write-wins guarantee.
    expect(txnB.lastTableData()).toBe(savedByA);
    expect(txnB.lastTableData()).not.toBe(rendered);

    txnB.resolve();
    await Promise.all([pA, pB]);
  });

  it("resets the accumulator on a rendered-reference change so an in-flight save does not shadow the newer table (reload)", async () => {
    const state = createContextEditSerializerState();
    const renderedV1 = makeTable("rendered-v1");
    const renderedV2 = makeTable("rendered-v2");

    const txnA = makeDeferredTxn();
    const txnB = makeDeferredTxn();

    // Edit A enqueues against v1. Edit B enqueues against v2 (a reload happened
    // between the two edits — a NEW rendered reference).
    const pA = runSerializedContextEdit(state, renderedV1, txnA.run);
    const pB = runSerializedContextEdit(state, renderedV2, txnB.run);

    await txnA.invoked;
    expect(txnA.lastTableData()).toBe(renderedV1);

    // A's in-flight transaction persists a root table derived from the now-stale
    // v1. It must NOT shadow the freshly reloaded v2.
    const savedByA = makeTable("saved-by-A-stale");
    txnA.saveRootTable(savedByA);
    txnA.resolve();

    await txnB.invoked;
    // Because the rendered reference changed (v1 -> v2), the accumulator resets
    // to v2 at chain time; A's stale save is discarded.
    expect(txnB.lastTableData()).toBe(renderedV2);
    expect(txnB.lastTableData()).not.toBe(savedByA);
    expect(txnB.lastTableData()).not.toBe(renderedV1);

    txnB.resolve();
    await Promise.all([pA, pB]);
  });

  it("performs reset/latest-read INSIDE exec at chain time, not at enqueue time", async () => {
    const state = createContextEditSerializerState();
    const renderedV1 = makeTable("rendered-v1");
    const renderedV2 = makeTable("rendered-v2");

    const txnA = makeDeferredTxn();
    const txnB = makeDeferredTxn();

    // Enqueue A against v1 first; A begins immediately (tail was resolved).
    const pA = runSerializedContextEdit(state, renderedV1, txnA.run);
    await txnA.invoked;
    expect(txnA.lastTableData()).toBe(renderedV1);

    // While A is STILL in flight, A persists a new root table.
    const savedByA = makeTable("saved-by-A");
    txnA.saveRootTable(savedByA);

    // Enqueue B against v1 (same reference as A). If the reset/latest-read were
    // captured at ENQUEUE time, B would see the value of state.latest as it was
    // at enqueue (savedByA, since A already saved). That happens to match here —
    // so to disambiguate enqueue-time vs chain-time we mutate the accumulator
    // AFTER B is enqueued but BEFORE A settles: enqueue B, then have A save a
    // SECOND table. A chain-time read inside exec must observe the latest
    // (second) save, not whatever was current at enqueue.
    const pB = runSerializedContextEdit(state, renderedV1, txnB.run);
    expect(txnB.invocations).toBe(0); // B has not run yet — it waits on the tail.

    const savedByASecond = makeTable("saved-by-A-second");
    txnA.saveRootTable(savedByASecond);
    txnA.resolve();

    await txnB.invoked;
    // B's exec ran at chain time (after A fully settled) and read the LATEST
    // accumulator value — A's second save — proving the read is at chain time,
    // not frozen at enqueue.
    expect(txnB.lastTableData()).toBe(savedByASecond);
    expect(txnB.lastTableData()).not.toBe(savedByA);

    txnB.resolve();
    await Promise.all([pA, pB]);
  });

  it("does not reset on a rendered-reference change captured AFTER enqueue (reset is chain-time)", async () => {
    // Complements the prior test from the reset angle: if the rendered-reference
    // comparison were done at enqueue time, swapping `state.lastRendered` after
    // enqueue could not matter. We prove reset is decided when exec runs.
    const state = createContextEditSerializerState();
    const rendered = makeTable("rendered");

    const txnA = makeDeferredTxn();
    const txnB = makeDeferredTxn();

    const pA = runSerializedContextEdit(state, rendered, txnA.run);
    await txnA.invoked;
    const savedByA = makeTable("saved-by-A");
    txnA.saveRootTable(savedByA);

    // B enqueues against the SAME rendered reference. At this enqueue moment,
    // state.lastRendered === rendered and state.latest === savedByA.
    const pB = runSerializedContextEdit(state, rendered, txnB.run);
    txnA.resolve();

    await txnB.invoked;
    // No reference change -> no reset -> B threads A's saved table.
    expect(txnB.lastTableData()).toBe(savedByA);

    txnB.resolve();
    await Promise.all([pA, pB]);
  });

  it("keeps the chain alive after a rejected transaction (tail .catch) — the next edit still runs", async () => {
    const state = createContextEditSerializerState();
    const rendered = makeTable("rendered");

    const txnA = makeDeferredTxn();
    const txnB = makeDeferredTxn();

    const pA = runSerializedContextEdit(state, rendered, txnA.run);
    const pB = runSerializedContextEdit(state, rendered, txnB.run);

    await txnA.invoked;

    // The caller's promise for A must reject (the failure surfaces), but the
    // serializer's internal tail swallows it so the chain survives.
    const aError = new Error("transaction A failed");
    txnA.reject(aError);
    await expect(pA).rejects.toBe(aError);

    // B must still run despite A rejecting.
    await txnB.invoked;
    expect(txnB.invocations).toBe(1);
    // A rejected without saving a root table, so B falls back to the rendered
    // table (accumulator was the rendered reference).
    expect(txnB.lastTableData()).toBe(rendered);

    const okResult = emptyTableEditTransactionResult();
    txnB.resolve(okResult);
    await expect(pB).resolves.toBe(okResult);
  });

  it("a later edit chained after a rejected one threads the rejected edit's saved table if it saved before rejecting", async () => {
    // Defensive: onRootTableSaved is synchronous and independent of settle, so a
    // transaction can persist a root table and then still reject (partial
    // apply). The accumulator must retain that save for the next edit.
    const state = createContextEditSerializerState();
    const rendered = makeTable("rendered");

    const txnA = makeDeferredTxn();
    const txnB = makeDeferredTxn();

    const pA = runSerializedContextEdit(state, rendered, txnA.run);
    const pB = runSerializedContextEdit(state, rendered, txnB.run);

    await txnA.invoked;
    const partial = makeTable("partial-save-then-fail");
    txnA.saveRootTable(partial);
    txnA.reject(new Error("failed after partial save"));
    await expect(pA).rejects.toThrow("failed after partial save");

    await txnB.invoked;
    expect(txnB.lastTableData()).toBe(partial);

    txnB.resolve();
    await pB;
  });

  it("resets the accumulator on the very first edit (lastRendered starts null)", async () => {
    const state = createContextEditSerializerState();
    expect(state.lastRendered).toBeNull();
    expect(state.latest).toBeNull();

    const rendered = makeTable("rendered");
    const txnA = makeDeferredTxn();

    const pA = runSerializedContextEdit(state, rendered, txnA.run);
    await txnA.invoked;

    // First edit: lastRendered was null !== rendered, so it resets to rendered.
    expect(state.lastRendered).toBe(rendered);
    expect(txnA.lastTableData()).toBe(rendered);

    txnA.resolve();
    await pA;
  });

  it("threads ONE session-edited-keys set across edits sharing a rendered reference (cross-edit lag tracking)", async () => {
    // The stale-conflict gate's lag tracker (bd Notidian-2kf7) must persist
    // across consecutive edits on the same rendered snapshot: an edit records
    // the cells it wrote so the NEXT rapid edit can tell its own pathsIndex lag
    // from a genuine external change. Same rendered reference -> same Set.
    const state = createContextEditSerializerState();
    const rendered = makeTable("rendered");

    const txnA = makeDeferredTxn();
    const txnB = makeDeferredTxn();

    const pA = runSerializedContextEdit(state, rendered, txnA.run);
    const pB = runSerializedContextEdit(state, rendered, txnB.run);

    await txnA.invoked;
    // Simulate the transaction recording a written cell.
    txnA.lastSessionEditedKeys().add("Notes/A.md status");
    txnA.resolve();

    await txnB.invoked;
    // B sees the SAME set, including A's recorded write.
    expect(txnB.lastSessionEditedKeys()).toBe(txnA.lastSessionEditedKeys());
    expect(txnB.lastSessionEditedKeys().has("Notes/A.md status")).toBe(true);

    txnB.resolve();
    await Promise.all([pA, pB]);
  });

  it("resets session-edited-keys on a rendered-reference change (reload re-syncs pathsIndex)", async () => {
    // After a reload (new rendered reference) pathsIndex has caught up, so the
    // lag-relaxation must NOT carry stale keys forward — otherwise a genuine
    // external change to a previously-edited cell could slip past the gate.
    const state = createContextEditSerializerState();
    const renderedV1 = makeTable("rendered-v1");
    const renderedV2 = makeTable("rendered-v2");

    const txnA = makeDeferredTxn();
    const txnB = makeDeferredTxn();

    const pA = runSerializedContextEdit(state, renderedV1, txnA.run);
    await txnA.invoked;
    txnA.lastSessionEditedKeys().add("Notes/A.md status");
    txnA.resolve();
    await pA;

    const pB = runSerializedContextEdit(state, renderedV2, txnB.run);
    await txnB.invoked;
    // Fresh set on reload — A's recorded write does not leak across the reload.
    expect(txnB.lastSessionEditedKeys()).not.toBe(txnA.lastSessionEditedKeys());
    expect(txnB.lastSessionEditedKeys().size).toBe(0);

    txnB.resolve();
    await pB;
  });

  it("isolates serializer state per instance (two states do not cross-thread)", async () => {
    const stateOne = createContextEditSerializerState();
    const stateTwo = createContextEditSerializerState();
    const renderedOne = makeTable("rendered-one");
    const renderedTwo = makeTable("rendered-two");

    const txnOne = makeDeferredTxn();
    const txnTwo = makeDeferredTxn();

    const pOne = runSerializedContextEdit(stateOne, renderedOne, txnOne.run);
    const pTwo = runSerializedContextEdit(stateTwo, renderedTwo, txnTwo.run);

    await Promise.all([txnOne.invoked, txnTwo.invoked]);
    expect(txnOne.lastTableData()).toBe(renderedOne);
    expect(txnTwo.lastTableData()).toBe(renderedTwo);

    const savedByOne = makeTable("saved-by-one");
    txnOne.saveRootTable(savedByOne);
    txnOne.resolve();
    txnTwo.resolve();
    await Promise.all([pOne, pTwo]);

    // state two never saw state one's saved table.
    expect(stateTwo.latest).toBe(renderedTwo);
    expect(stateOne.latest).toBe(savedByOne);
  });

  it("returns each transaction's own result to its own caller", async () => {
    const state = createContextEditSerializerState();
    const rendered = makeTable("rendered");

    const txnA = makeDeferredTxn();
    const txnB = makeDeferredTxn();

    const pA = runSerializedContextEdit(state, rendered, txnA.run);
    const pB = runSerializedContextEdit(state, rendered, txnB.run);

    const resultA: TableEditTransactionResult = {
      ok: true,
      applied: 1,
      skipped: [],
      failed: [],
    };
    const resultB: TableEditTransactionResult = {
      ok: false,
      applied: 0,
      skipped: [],
      failed: [],
    };

    await txnA.invoked;
    txnA.resolve(resultA);
    await txnB.invoked;
    txnB.resolve(resultB);

    await expect(pA).resolves.toBe(resultA);
    await expect(pB).resolves.toBe(resultB);
  });

  it("does not begin a queued edit before the prior edit settles (microtask flush proof)", async () => {
    const state = createContextEditSerializerState();
    const rendered = makeTable("rendered");

    const txnA = makeDeferredTxn();
    const txnB = makeDeferredTxn();

    const pA = runSerializedContextEdit(state, rendered, txnA.run);
    const pB = runSerializedContextEdit(state, rendered, txnB.run);

    await txnA.invoked;
    // Flush microtasks repeatedly while A is unsettled — B must still not start.
    await flushMicrotasks();
    await flushMicrotasks();
    expect(txnB.invocations).toBe(0);

    txnA.resolve();
    await txnB.invoked;
    expect(txnB.invocations).toBe(1);

    txnB.resolve();
    await Promise.all([pA, pB]);
  });
});
