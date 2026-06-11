import { SpaceTable } from "shared/types/mdb";
import { TableEditTransactionResult } from "./tableEditTransaction";

// Per-context edit serializer. The raw transaction executor applies writes to
// whatever table it is given; the bug (bd Notidian-lg1) is that two concurrent
// context value edits captured the SAME rendered table snapshot before React
// re-rendered, so the second save overwrote the first (last-write-wins).
//
// This serializer runs context value-write transactions one at a time and
// threads the latest root table from each transaction into the next, so the
// second edit applies to the result of the first. The accumulator resets to the
// rendered table whenever that changes by reference (e.g. a reload), so external
// updates are picked up.
export type ContextEditSerializerState = {
  lastRendered: SpaceTable | null;
  latest: SpaceTable | null;
  tail: Promise<unknown>;
};

export const createContextEditSerializerState =
  (): ContextEditSerializerState => ({
    lastRendered: null,
    latest: null,
    tail: Promise.resolve(),
  });

export type SerializedEditRun = (params: {
  tableData: SpaceTable;
  onRootTableSaved: (table: SpaceTable) => void;
}) => Promise<TableEditTransactionResult>;

export const runSerializedContextEdit = (
  state: ContextEditSerializerState,
  renderedTable: SpaceTable,
  run: SerializedEditRun
): Promise<TableEditTransactionResult> => {
  // The reset and the latest-read happen INSIDE exec (in chain order, after the
  // previous edit fully completes), not at enqueue time. This prevents an
  // in-flight edit's onRootTableSaved from shadowing a newer rendered table
  // (reload): when this edit finally runs, a rendered-reference change resets the
  // accumulator to the reloaded table; two rapid edits sharing one reference do
  // not reset and thread the first's result into the second.
  const exec = (): Promise<TableEditTransactionResult> => {
    if (state.lastRendered !== renderedTable) {
      state.lastRendered = renderedTable;
      state.latest = renderedTable;
    }
    return run({
      tableData: state.latest ?? renderedTable,
      onRootTableSaved: (table) => {
        state.latest = table;
      },
    });
  };
  // Chain on the tail so transactions run strictly in order.
  const next = state.tail.then(exec, exec);
  state.tail = next.catch(() => {});
  return next;
};
