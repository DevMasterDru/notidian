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
  // (resolvedPath, column) cells written since the last rendered-table reset.
  // The stale-conflict gate uses this to distinguish its own pathsIndex lag
  // (a cell we already wrote, whose canonical value simply hasn't settled) from
  // a genuine external change (a cell we have not touched this session). Reset
  // together with `latest` when the rendered table reloads, since a reload
  // re-syncs pathsIndex. (bd Notidian-2kf7)
  editedKeys: Set<string>;
  tail: Promise<unknown>;
};

export const createContextEditSerializerState =
  (): ContextEditSerializerState => ({
    lastRendered: null,
    latest: null,
    editedKeys: new Set<string>(),
    tail: Promise.resolve(),
  });

export type SerializedEditRun = (params: {
  tableData: SpaceTable;
  onRootTableSaved: (table: SpaceTable) => void;
  sessionEditedKeys: Set<string>;
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
      // A fresh rendered table means pathsIndex has caught up; the lag-tracking
      // record from the previous snapshot no longer applies.
      state.editedKeys = new Set<string>();
    }
    return run({
      tableData: state.latest ?? renderedTable,
      onRootTableSaved: (table) => {
        state.latest = table;
      },
      sessionEditedKeys: state.editedKeys,
    });
  };
  // Chain on the tail so transactions run strictly in order.
  const next = state.tail.then(exec, exec);
  state.tail = next.catch(() => {});
  return next;
};
