/**
 * Property tests for contextEditSerializer — bd Notidian-du9s
 *
 * These tests lock six invariants of the serializer under adversarial
 * conditions that go beyond the deterministic unit tests in the sibling
 * .test.ts file. Each "property" is an invariant that must hold regardless
 * of the number, timing, or outcome of enqueued edits.
 *
 * Invariants:
 *   P1  Serial FIFO ordering
 *   P2  Table threading (each edit sees previous output)
 *   P3  Rendered-table reset on reference change
 *   P4  editedKeys accumulation + reset
 *   P5  Error isolation (rejected edit does not break chain)
 *   P6  No-op identity (passthrough without corruption)
 *
 * Adversarial scenarios:
 *   - 10 rapid edits on the same cell
 *   - Alternating rendered-table references between edits
 *   - Error in the middle of a 5-edit chain
 *   - Re-entrant enqueue during callback
 *   - Empty table edits
 */

import { SpaceTable } from "shared/types/mdb";
import {
  emptyTableEditTransactionResult,
  TableEditTransactionResult,
} from "./tableEditTransaction";
import {
  createContextEditSerializerState,
  runSerializedContextEdit,
  SerializedEditRun,
  ContextEditSerializerState,
} from "./contextEditSerializer";

// ── Test infrastructure (mirrors sibling .test.ts) ──────────────────────

type DeferredTxn = {
  run: SerializedEditRun;
  invoked: Promise<void>;
  invocations: number;
  lastTableData(): SpaceTable;
  lastSessionEditedKeys(): Set<string>;
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
      if (!capturedTableData)
        throw new Error("run has not been invoked yet");
      return capturedTableData;
    },
    lastSessionEditedKeys() {
      if (!capturedSessionEditedKeys)
        throw new Error("run has not been invoked yet");
      return capturedSessionEditedKeys;
    },
    saveRootTable(table: SpaceTable) {
      if (!capturedOnRootTableSaved)
        throw new Error("run has not been invoked yet");
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

let tableSeq = 0;
const makeTable = (label?: string): SpaceTable => {
  tableSeq += 1;
  const id = label ?? `table-${tableSeq}`;
  return {
    schema: { id, name: id, type: "db" },
    cols: [],
    rows: [],
  };
};

// Auto-resolving run: saves a new root table and resolves immediately.
const makeAutoRun = (
  savedTable: SpaceTable,
  result?: TableEditTransactionResult
): {
  run: SerializedEditRun;
  receivedTableData: () => SpaceTable;
  receivedEditedKeys: () => Set<string>;
} => {
  let capturedTable: SpaceTable | null = null;
  let capturedKeys: Set<string> | null = null;
  const run: SerializedEditRun = ({
    tableData,
    onRootTableSaved,
    sessionEditedKeys,
  }) => {
    capturedTable = tableData;
    capturedKeys = sessionEditedKeys;
    onRootTableSaved(savedTable);
    return Promise.resolve(result ?? emptyTableEditTransactionResult());
  };
  return {
    run,
    receivedTableData: () => {
      if (!capturedTable) throw new Error("not invoked");
      return capturedTable;
    },
    receivedEditedKeys: () => {
      if (!capturedKeys) throw new Error("not invoked");
      return capturedKeys;
    },
  };
};

// ── P1: Serial FIFO ordering ───────────────────────────────────────────

describe("P1: serial FIFO ordering", () => {
  it("10 rapid edits on the same cell execute in strict enqueue order", async () => {
    const state = createContextEditSerializerState();
    const rendered = makeTable("rendered");
    const N = 10;

    const executionOrder: number[] = [];
    const tables: SpaceTable[] = [];
    for (let i = 0; i < N; i++) {
      tables.push(makeTable(`saved-${i}`));
    }

    // Enqueue N edits as fast as possible (all share the same rendered ref).
    const promises: Promise<TableEditTransactionResult>[] = [];
    for (let i = 0; i < N; i++) {
      const idx = i;
      const savedTable = tables[idx];
      const run: SerializedEditRun = ({
        onRootTableSaved,
      }) => {
        executionOrder.push(idx);
        onRootTableSaved(savedTable);
        return Promise.resolve(emptyTableEditTransactionResult());
      };
      promises.push(runSerializedContextEdit(state, rendered, run));
    }

    await Promise.all(promises);

    // Must be exactly 0..9 in order.
    expect(executionOrder).toEqual(Array.from({ length: N }, (_, i) => i));
  });

  it("FIFO holds even when edits are enqueued across microtask boundaries", async () => {
    const state = createContextEditSerializerState();
    const rendered = makeTable("rendered");
    const order: number[] = [];

    // Enqueue 5 edits, each separated by a microtask flush.
    const promises: Promise<TableEditTransactionResult>[] = [];
    for (let i = 0; i < 5; i++) {
      const idx = i;
      const saved = makeTable(`saved-${idx}`);
      const run: SerializedEditRun = ({ onRootTableSaved }) => {
        order.push(idx);
        onRootTableSaved(saved);
        return Promise.resolve(emptyTableEditTransactionResult());
      };
      promises.push(runSerializedContextEdit(state, rendered, run));
      // Yield between enqueues so earlier edits may settle before later ones
      // are even enqueued. The chain must still respect the enqueue-time order.
      await new Promise<void>((r) => setImmediate(r));
    }

    await Promise.all(promises);
    expect(order).toEqual([0, 1, 2, 3, 4]);
  });
});

// ── P2: Table threading ────────────────────────────────────────────────

describe("P2: table threading (each edit sees previous output)", () => {
  it("10 rapid edits form a chain: edit N receives the table saved by edit N-1", async () => {
    const state = createContextEditSerializerState();
    const rendered = makeTable("rendered");
    const N = 10;

    const savedTables: SpaceTable[] = [];
    const receivedTables: SpaceTable[] = [];
    for (let i = 0; i < N; i++) {
      savedTables.push(makeTable(`saved-${i}`));
    }

    const promises: Promise<TableEditTransactionResult>[] = [];
    for (let i = 0; i < N; i++) {
      const idx = i;
      const run: SerializedEditRun = ({
        tableData,
        onRootTableSaved,
      }) => {
        receivedTables.push(tableData);
        onRootTableSaved(savedTables[idx]);
        return Promise.resolve(emptyTableEditTransactionResult());
      };
      promises.push(runSerializedContextEdit(state, rendered, run));
    }

    await Promise.all(promises);

    // Edit 0 receives the rendered table.
    expect(receivedTables[0]).toBe(rendered);
    // Edits 1..N-1 each receive the table saved by the previous edit.
    for (let i = 1; i < N; i++) {
      expect(receivedTables[i]).toBe(savedTables[i - 1]);
    }
  });

  it("edit that does not call onRootTableSaved still passes the latest table through", async () => {
    const state = createContextEditSerializerState();
    const rendered = makeTable("rendered");

    // Edit A saves a table.
    const savedByA = makeTable("saved-by-A");
    const autoA = makeAutoRun(savedByA);

    // Edit B does NOT save (no-op transaction: does not call onRootTableSaved).
    let bReceivedTable: SpaceTable | null = null;
    const noopRun: SerializedEditRun = ({ tableData }) => {
      bReceivedTable = tableData;
      // Intentionally does not call onRootTableSaved.
      return Promise.resolve(emptyTableEditTransactionResult());
    };

    // Edit C should receive savedByA (the last saved table), not rendered.
    let cReceivedTable: SpaceTable | null = null;
    const cRun: SerializedEditRun = ({ tableData, onRootTableSaved }) => {
      cReceivedTable = tableData;
      onRootTableSaved(makeTable("saved-by-C"));
      return Promise.resolve(emptyTableEditTransactionResult());
    };

    const pA = runSerializedContextEdit(state, rendered, autoA.run);
    const pB = runSerializedContextEdit(state, rendered, noopRun);
    const pC = runSerializedContextEdit(state, rendered, cRun);

    await Promise.all([pA, pB, pC]);

    expect(bReceivedTable).toBe(savedByA);
    // C receives savedByA because B did not update the accumulator.
    expect(cReceivedTable).toBe(savedByA);
  });
});

// ── P3: Rendered-table reset on reference change ───────────────────────

describe("P3: rendered-table reset on reference change", () => {
  it("alternating rendered references across 6 edits reset the accumulator each time", async () => {
    const state = createContextEditSerializerState();
    const refA = makeTable("ref-A");
    const refB = makeTable("ref-B");
    const refs = [refA, refB, refA, refB, refA, refB]; // alternating

    const receivedTables: SpaceTable[] = [];
    const savedTables: SpaceTable[] = [];
    for (let i = 0; i < 6; i++) {
      savedTables.push(makeTable(`saved-${i}`));
    }

    const promises: Promise<TableEditTransactionResult>[] = [];
    for (let i = 0; i < 6; i++) {
      const idx = i;
      const run: SerializedEditRun = ({
        tableData,
        onRootTableSaved,
      }) => {
        receivedTables.push(tableData);
        onRootTableSaved(savedTables[idx]);
        return Promise.resolve(emptyTableEditTransactionResult());
      };
      promises.push(runSerializedContextEdit(state, refs[idx], run));
    }

    await Promise.all(promises);

    // Every edit should receive its own rendered reference (because the ref
    // alternates on every edit, causing a reset each time).
    for (let i = 0; i < 6; i++) {
      expect(receivedTables[i]).toBe(refs[i]);
    }
  });

  it("consecutive edits sharing a reference thread; a new reference resets to it", async () => {
    const state = createContextEditSerializerState();
    const refA = makeTable("ref-A");
    const refB = makeTable("ref-B");

    // 3 edits on refA, then 2 edits on refB.
    const savedTables: SpaceTable[] = [];
    const receivedTables: SpaceTable[] = [];
    for (let i = 0; i < 5; i++) {
      savedTables.push(makeTable(`saved-${i}`));
    }

    const refs = [refA, refA, refA, refB, refB];
    const promises: Promise<TableEditTransactionResult>[] = [];
    for (let i = 0; i < 5; i++) {
      const idx = i;
      const run: SerializedEditRun = ({
        tableData,
        onRootTableSaved,
      }) => {
        receivedTables.push(tableData);
        onRootTableSaved(savedTables[idx]);
        return Promise.resolve(emptyTableEditTransactionResult());
      };
      promises.push(runSerializedContextEdit(state, refs[idx], run));
    }

    await Promise.all(promises);

    // Edit 0: first on refA -> reset -> receives refA
    expect(receivedTables[0]).toBe(refA);
    // Edit 1: same ref -> threads -> receives saved-0
    expect(receivedTables[1]).toBe(savedTables[0]);
    // Edit 2: same ref -> threads -> receives saved-1
    expect(receivedTables[2]).toBe(savedTables[1]);
    // Edit 3: new ref (refB) -> reset -> receives refB
    expect(receivedTables[3]).toBe(refB);
    // Edit 4: same ref -> threads -> receives saved-3
    expect(receivedTables[4]).toBe(savedTables[3]);
  });
});

// ── P4: editedKeys accumulation + reset ────────────────────────────────

describe("P4: editedKeys accumulation and reset", () => {
  it("keys accumulate across 5 edits sharing a rendered reference", async () => {
    const state = createContextEditSerializerState();
    const rendered = makeTable("rendered");

    const allKeys: string[][] = [];

    const promises: Promise<TableEditTransactionResult>[] = [];
    for (let i = 0; i < 5; i++) {
      const idx = i;
      const saved = makeTable(`saved-${idx}`);
      const run: SerializedEditRun = ({
        onRootTableSaved,
        sessionEditedKeys,
      }) => {
        // Record snapshot of existing keys, then add this edit's key.
        allKeys.push([...sessionEditedKeys]);
        sessionEditedKeys.add(`cell-${idx}`);
        onRootTableSaved(saved);
        return Promise.resolve(emptyTableEditTransactionResult());
      };
      promises.push(runSerializedContextEdit(state, rendered, run));
    }

    await Promise.all(promises);

    // Edit 0 starts with empty keys.
    expect(allKeys[0]).toEqual([]);
    // Edit 1 sees cell-0.
    expect(allKeys[1]).toEqual(["cell-0"]);
    // Edit 2 sees cell-0, cell-1.
    expect(allKeys[2]).toEqual(["cell-0", "cell-1"]);
    // Edit 3 sees cell-0, cell-1, cell-2.
    expect(allKeys[3]).toEqual(["cell-0", "cell-1", "cell-2"]);
    // Edit 4 sees cell-0..cell-3.
    expect(allKeys[4]).toEqual(["cell-0", "cell-1", "cell-2", "cell-3"]);
  });

  it("keys reset when the rendered reference changes", async () => {
    const state = createContextEditSerializerState();
    const refA = makeTable("ref-A");
    const refB = makeTable("ref-B");

    const keySnapshots: string[][] = [];

    // 2 edits on refA, then 2 on refB.
    const refs = [refA, refA, refB, refB];
    const promises: Promise<TableEditTransactionResult>[] = [];
    for (let i = 0; i < 4; i++) {
      const idx = i;
      const saved = makeTable(`saved-${idx}`);
      const run: SerializedEditRun = ({
        onRootTableSaved,
        sessionEditedKeys,
      }) => {
        keySnapshots.push([...sessionEditedKeys]);
        sessionEditedKeys.add(`key-${idx}`);
        onRootTableSaved(saved);
        return Promise.resolve(emptyTableEditTransactionResult());
      };
      promises.push(runSerializedContextEdit(state, refs[idx], run));
    }

    await Promise.all(promises);

    // Edit 0: fresh set (first use) -> empty.
    expect(keySnapshots[0]).toEqual([]);
    // Edit 1: same ref -> accumulated key-0.
    expect(keySnapshots[1]).toEqual(["key-0"]);
    // Edit 2: ref changed -> reset -> empty (key-0, key-1 are gone).
    expect(keySnapshots[2]).toEqual([]);
    // Edit 3: same ref -> accumulated key-2.
    expect(keySnapshots[3]).toEqual(["key-2"]);
  });

  it("keys reset on every reference change in an alternating sequence", async () => {
    const state = createContextEditSerializerState();
    const refA = makeTable("ref-A");
    const refB = makeTable("ref-B");
    const refs = [refA, refB, refA, refB];

    const keySnapshots: string[][] = [];
    const promises: Promise<TableEditTransactionResult>[] = [];
    for (let i = 0; i < 4; i++) {
      const idx = i;
      const saved = makeTable(`saved-${idx}`);
      const run: SerializedEditRun = ({
        onRootTableSaved,
        sessionEditedKeys,
      }) => {
        keySnapshots.push([...sessionEditedKeys]);
        sessionEditedKeys.add(`key-${idx}`);
        onRootTableSaved(saved);
        return Promise.resolve(emptyTableEditTransactionResult());
      };
      promises.push(runSerializedContextEdit(state, refs[idx], run));
    }

    await Promise.all(promises);

    // Every edit sees an empty set because the reference alternates every time,
    // resetting keys on each edit.
    for (let i = 0; i < 4; i++) {
      expect(keySnapshots[i]).toEqual([]);
    }
  });
});

// ── P5: Error isolation ────────────────────────────────────────────────

describe("P5: error isolation (rejected edit does not break chain)", () => {
  it("error in the middle of a 5-edit chain: edits before and after succeed", async () => {
    const state = createContextEditSerializerState();
    const rendered = makeTable("rendered");
    const N = 5;
    const errorIndex = 2; // middle edit fails

    const order: number[] = [];
    const savedTables: SpaceTable[] = [];
    for (let i = 0; i < N; i++) {
      savedTables.push(makeTable(`saved-${i}`));
    }

    const txns = Array.from({ length: N }, () => makeDeferredTxn());
    const promises: Promise<TableEditTransactionResult>[] = [];
    for (let i = 0; i < N; i++) {
      const idx = i;
      const txn = txns[idx];
      const wrappedRun: SerializedEditRun = (params) => {
        order.push(idx);
        return txn.run(params);
      };
      promises.push(runSerializedContextEdit(state, rendered, wrappedRun));
    }

    // Drive the chain: resolve each txn in order, rejecting the middle one.
    for (let i = 0; i < N; i++) {
      await txns[i].invoked;
      if (i !== errorIndex) {
        txns[i].saveRootTable(savedTables[i]);
        txns[i].resolve({
          ok: true,
          applied: 1,
          skipped: [],
          failed: [],
        });
      } else {
        // Reject the middle edit WITHOUT saving a root table.
        txns[i].reject(new Error(`edit-${i} failed`));
      }
    }

    // The errored promise rejects; all others resolve.
    const results = await Promise.allSettled(promises);
    for (let i = 0; i < N; i++) {
      if (i === errorIndex) {
        expect(results[i].status).toBe("rejected");
      } else {
        expect(results[i].status).toBe("fulfilled");
      }
    }

    // All 5 ran, in order.
    expect(order).toEqual([0, 1, 2, 3, 4]);
  });

  it("error in the middle does not corrupt table threading for subsequent edits", async () => {
    const state = createContextEditSerializerState();
    const rendered = makeTable("rendered");

    // A succeeds and saves, B fails (no save), C should still see A's save.
    const savedByA = makeTable("saved-by-A");
    const savedByC = makeTable("saved-by-C");

    let cReceivedTable: SpaceTable | null = null;

    const txnA = makeDeferredTxn();
    const txnB = makeDeferredTxn();

    const cRun: SerializedEditRun = ({
      tableData,
      onRootTableSaved,
    }) => {
      cReceivedTable = tableData;
      onRootTableSaved(savedByC);
      return Promise.resolve(emptyTableEditTransactionResult());
    };

    const pA = runSerializedContextEdit(state, rendered, txnA.run);
    const pB = runSerializedContextEdit(state, rendered, txnB.run);
    const pC = runSerializedContextEdit(state, rendered, cRun);

    await txnA.invoked;
    txnA.saveRootTable(savedByA);
    txnA.resolve();

    await txnB.invoked;
    // B fails without saving.
    txnB.reject(new Error("B failed"));
    await expect(pB).rejects.toThrow("B failed");

    await Promise.allSettled([pA, pC]);

    // C threads from A's save (B did not overwrite).
    expect(cReceivedTable).toBe(savedByA);
  });

  it("multiple consecutive errors do not break the chain — the first success after resumes correctly", async () => {
    const state = createContextEditSerializerState();
    const rendered = makeTable("rendered");

    // Edits 0..2 fail, edit 3 succeeds.
    const txns = Array.from({ length: 4 }, () => makeDeferredTxn());
    const promises: Promise<TableEditTransactionResult>[] = [];
    for (const txn of txns) {
      promises.push(runSerializedContextEdit(state, rendered, txn.run));
    }

    // Drive all: reject first three, resolve last.
    for (let i = 0; i < 3; i++) {
      await txns[i].invoked;
      txns[i].reject(new Error(`fail-${i}`));
    }

    await txns[3].invoked;
    // After 3 failures, the last edit still receives the rendered table
    // (no save ever happened).
    expect(txns[3].lastTableData()).toBe(rendered);

    txns[3].resolve();
    const results = await Promise.allSettled(promises);
    expect(results[0].status).toBe("rejected");
    expect(results[1].status).toBe("rejected");
    expect(results[2].status).toBe("rejected");
    expect(results[3].status).toBe("fulfilled");
  });
});

// ── P6: No-op identity ────────────────────────────────────────────────

describe("P6: no-op identity (passthrough without corruption)", () => {
  it("an edit that changes nothing preserves the accumulator for the next edit", async () => {
    const state = createContextEditSerializerState();
    const rendered = makeTable("rendered");
    const savedByA = makeTable("saved-by-A");

    // A saves a table.
    const autoA = makeAutoRun(savedByA);

    // B is a no-op (does not save).
    const noopRun: SerializedEditRun = () =>
      Promise.resolve(emptyTableEditTransactionResult());

    // C should see savedByA (A's output, unperturbed by B's no-op).
    let cReceivedTable: SpaceTable | null = null;
    const cRun: SerializedEditRun = ({ tableData }) => {
      cReceivedTable = tableData;
      return Promise.resolve(emptyTableEditTransactionResult());
    };

    const pA = runSerializedContextEdit(state, rendered, autoA.run);
    const pB = runSerializedContextEdit(state, rendered, noopRun);
    const pC = runSerializedContextEdit(state, rendered, cRun);

    await Promise.all([pA, pB, pC]);

    expect(cReceivedTable).toBe(savedByA);
  });

  it("a chain of 5 no-ops leaves the state identical to a single no-op", async () => {
    const state = createContextEditSerializerState();
    const rendered = makeTable("rendered");

    const receivedTables: SpaceTable[] = [];
    const promises: Promise<TableEditTransactionResult>[] = [];
    for (let i = 0; i < 5; i++) {
      const run: SerializedEditRun = ({ tableData }) => {
        receivedTables.push(tableData);
        // No-op: do not call onRootTableSaved.
        return Promise.resolve(emptyTableEditTransactionResult());
      };
      promises.push(runSerializedContextEdit(state, rendered, run));
    }

    await Promise.all(promises);

    // All 5 edits receive the rendered table (no accumulator mutation).
    for (const t of receivedTables) {
      expect(t).toBe(rendered);
    }
    // State reflects the rendered table.
    expect(state.latest).toBe(rendered);
    expect(state.lastRendered).toBe(rendered);
  });

  it("empty table edits are handled without corruption", async () => {
    const state = createContextEditSerializerState();
    const emptyTable: SpaceTable = {
      schema: { id: "empty", name: "empty", type: "db" },
      cols: [],
      rows: [],
    };

    const savedTable: SpaceTable = {
      schema: { id: "saved-empty", name: "saved-empty", type: "db" },
      cols: [],
      rows: [],
    };

    let receivedTable: SpaceTable | null = null;
    const run: SerializedEditRun = ({
      tableData,
      onRootTableSaved,
    }) => {
      receivedTable = tableData;
      onRootTableSaved(savedTable);
      return Promise.resolve(emptyTableEditTransactionResult());
    };

    await runSerializedContextEdit(state, emptyTable, run);
    expect(receivedTable).toBe(emptyTable);
    expect(state.latest).toBe(savedTable);
  });
});

// ── Adversarial: re-entrant enqueue during callback ────────────────────

describe("Adversarial: re-entrant enqueue during callback", () => {
  it("enqueuing a new edit from inside onRootTableSaved does not deadlock and threads correctly", async () => {
    const state = createContextEditSerializerState();
    const rendered = makeTable("rendered");
    const savedByA = makeTable("saved-by-A");
    const savedByReentrant = makeTable("saved-by-reentrant");

    let reentrantReceivedTable: SpaceTable | null = null;
    let reentrantPromise: Promise<TableEditTransactionResult> | null = null;

    const runA: SerializedEditRun = ({
      onRootTableSaved,
    }) => {
      onRootTableSaved(savedByA);

      // Re-entrant enqueue: add a new edit from inside the callback.
      const reentrantRun: SerializedEditRun = ({
        tableData,
        onRootTableSaved: reOnRootTableSaved,
      }) => {
        reentrantReceivedTable = tableData;
        reOnRootTableSaved(savedByReentrant);
        return Promise.resolve(emptyTableEditTransactionResult());
      };
      reentrantPromise = runSerializedContextEdit(
        state,
        rendered,
        reentrantRun
      );

      return Promise.resolve(emptyTableEditTransactionResult());
    };

    const pA = runSerializedContextEdit(state, rendered, runA);
    await pA;

    // The re-entrant edit must also complete.
    expect(reentrantPromise).not.toBeNull();
    await reentrantPromise;

    // The re-entrant edit sees A's saved table (threading works).
    expect(reentrantReceivedTable).toBe(savedByA);
    // Final state reflects the re-entrant edit's save.
    expect(state.latest).toBe(savedByReentrant);
  });

  it("re-entrant enqueue from inside run does not skip the intervening edit (FIFO preserved)", async () => {
    const state = createContextEditSerializerState();
    const rendered = makeTable("rendered");

    const order: string[] = [];
    let reentrantPromise: Promise<TableEditTransactionResult> | null = null;

    // A enqueues, then inside A's run, we enqueue C (re-entrant).
    // Meanwhile B was already enqueued before A began.
    // Expected order: A, B, C (FIFO by enqueue time).
    const txnB = makeDeferredTxn();

    const runA: SerializedEditRun = ({ onRootTableSaved }) => {
      order.push("A");
      onRootTableSaved(makeTable("saved-by-A"));

      // Re-entrant: enqueue C while A is still executing.
      const runC: SerializedEditRun = ({ onRootTableSaved: cSave }) => {
        order.push("C");
        cSave(makeTable("saved-by-C"));
        return Promise.resolve(emptyTableEditTransactionResult());
      };
      reentrantPromise = runSerializedContextEdit(state, rendered, runC);

      return Promise.resolve(emptyTableEditTransactionResult());
    };

    const wrappedB: SerializedEditRun = (params) => {
      order.push("B");
      return txnB.run(params);
    };

    const pA = runSerializedContextEdit(state, rendered, runA);
    const pB = runSerializedContextEdit(state, rendered, wrappedB);

    // A runs immediately (tail was resolved). A's run enqueues C.
    await pA;

    // B runs after A (it was enqueued second).
    await txnB.invoked;
    txnB.resolve();
    await pB;

    // C runs after B (it was enqueued third, from inside A).
    expect(reentrantPromise).not.toBeNull();
    await reentrantPromise;

    expect(order).toEqual(["A", "B", "C"]);
  });
});

// ── Adversarial: combined stress ───────────────────────────────────────

describe("Adversarial: combined stress", () => {
  it("10 rapid edits with errors at positions 3 and 7, alternating refs at 5: all invariants hold", async () => {
    const state = createContextEditSerializerState();
    const refA = makeTable("ref-A");
    const refB = makeTable("ref-B");
    const N = 10;

    // Refs: 0-4 use refA, 5-9 use refB (switch at position 5).
    const refs = Array.from({ length: N }, (_, i) =>
      i < 5 ? refA : refB
    );
    const errorPositions = new Set([3, 7]);

    const executionOrder: number[] = [];
    const receivedTables: SpaceTable[] = [];
    const keySnapshots: string[][] = [];
    const savedTables: SpaceTable[] = [];

    for (let i = 0; i < N; i++) {
      savedTables.push(makeTable(`saved-${i}`));
    }

    const txns = Array.from({ length: N }, () => makeDeferredTxn());
    const promises: Promise<TableEditTransactionResult>[] = [];

    for (let i = 0; i < N; i++) {
      const idx = i;
      const txn = txns[idx];
      const wrappedRun: SerializedEditRun = (params) => {
        executionOrder.push(idx);
        receivedTables.push(params.tableData);
        keySnapshots.push([...params.sessionEditedKeys]);
        return txn.run(params);
      };
      promises.push(runSerializedContextEdit(state, refs[idx], wrappedRun));
    }

    // Drive chain.
    for (let i = 0; i < N; i++) {
      await txns[i].invoked;
      if (errorPositions.has(i)) {
        txns[i].reject(new Error(`fail-${i}`));
      } else {
        txns[i].saveRootTable(savedTables[i]);
        txns[i].lastSessionEditedKeys().add(`key-${i}`);
        txns[i].resolve({
          ok: true,
          applied: 1,
          skipped: [],
          failed: [],
        });
      }
    }

    const results = await Promise.allSettled(promises);

    // P1: FIFO
    expect(executionOrder).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);

    // P5: error isolation
    for (let i = 0; i < N; i++) {
      if (errorPositions.has(i)) {
        expect(results[i].status).toBe("rejected");
      } else {
        expect(results[i].status).toBe("fulfilled");
      }
    }

    // P3: reference change at position 5 resets to refB.
    // Positions 0-4 use refA; position 0 resets to refA (first use).
    expect(receivedTables[0]).toBe(refA);
    // Position 5 resets to refB.
    expect(receivedTables[5]).toBe(refB);

    // P2: threading within each ref group.
    // Position 1 receives saved-0 (position 0 saved).
    expect(receivedTables[1]).toBe(savedTables[0]);
    // Position 2 receives saved-1.
    expect(receivedTables[2]).toBe(savedTables[1]);
    // Position 3 receives saved-2. (3 will fail but still receives the right input.)
    expect(receivedTables[3]).toBe(savedTables[2]);
    // Position 4 receives saved-2 (position 3 failed, no save).
    expect(receivedTables[4]).toBe(savedTables[2]);

    // Position 6 receives saved-5.
    expect(receivedTables[6]).toBe(savedTables[5]);
    // Position 7 receives saved-6.
    expect(receivedTables[7]).toBe(savedTables[6]);
    // Position 8 receives saved-6 (position 7 failed, no save).
    expect(receivedTables[8]).toBe(savedTables[6]);
    // Position 9 receives saved-8.
    expect(receivedTables[9]).toBe(savedTables[8]);

    // P4: keys reset at position 5 (ref change).
    expect(keySnapshots[5]).toEqual([]);
  });
});
