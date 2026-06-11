/**
 * Regression test for bd Notidian-lg1: two concurrent context-owned value edits
 * captured the same rendered table snapshot, so the second save overwrote the
 * first (last-write-wins). The fix routes CEC value writes through a per-context
 * serializer (runSerializedContextEdit) that threads the latest root table from
 * each transaction into the next. This test mirrors that wiring and asserts both
 * edits survive.
 */
import { defaultContextSchemaID } from "shared/schemas/context";
import { PathPropertyName } from "shared/types/context";
import { SpaceTable } from "shared/types/mdb";
import { executeTableValueWrites, TableCellWrite } from "../tableEditTransaction";
import {
  createContextEditSerializerState,
  runSerializedContextEdit,
} from "../contextEditSerializer";

const baseContextTable = (): SpaceTable => ({
  schema: { id: defaultContextSchemaID, name: "Context", type: "context" },
  cols: [
    { name: PathPropertyName, type: "file" },
    { name: "local", type: "text" },
  ],
  rows: [
    { [PathPropertyName]: "Relays & Devices/A.md", local: "old-a" },
    { [PathPropertyName]: "Relays & Devices/B.md", local: "old-b" },
  ],
});

describe("audit c3 (FIXED): concurrent context-owned edits do not lose each other", () => {
  it("serializes two root context-owned writes that share one rendered snapshot", async () => {
    // The shared rendered snapshot — the same reference both edits close over,
    // exactly as CEC did before the serializer.
    const renderedTable = baseContextTable();
    const state = createContextEditSerializerState();
    let persisted = renderedTable;
    const savedSnapshots: SpaceTable[] = [];

    // Mirrors CEC.executeValueWrites wrapping executeTableValueWrites in the
    // serializer: the transaction runs against the threaded latest table, and
    // its root save updates the accumulator before the real save.
    const runContextEditorValueWrite = (write: TableCellWrite) =>
      runSerializedContextEdit(state, renderedTable, ({ tableData, onRootTableSaved }) =>
        executeTableValueWrites({
          writes: [write],
          tableData,
          contextTable: {},
          dbSchemaId: defaultContextSchemaID,
          contextPath: "Relays & Devices",
          resolvePath: (path) => path,
          shouldWritePropertyToFrontmatter: () => false,
          parseValue: (_column, value) => value,
          saveFrontmatterProperties: async () => ({ ok: true }),
          saveDB: async (nextTable) => {
            onRootTableSaved(nextTable);
            savedSnapshots.push(nextTable);
            persisted = nextTable;
          },
          saveContextDB: async () => {
            throw new Error("linked context save should not be used");
          },
          contextKeyForTable: (table) => table,
        })
      );

    await Promise.all([
      runContextEditorValueWrite({
        rowId: "0",
        columnId: "local",
        columnName: "local",
        table: "",
        value: "first-edit",
      }),
      runContextEditorValueWrite({
        rowId: "1",
        columnId: "local",
        columnName: "local",
        table: "",
        value: "second-edit",
      }),
    ]);

    // Both writes survive: the second transaction applied to the first's result.
    expect(savedSnapshots).toHaveLength(2);
    expect(savedSnapshots[0].rows[0].local).toBe("first-edit");
    expect(savedSnapshots[1].rows[0].local).toBe("first-edit");
    expect(savedSnapshots[1].rows[1].local).toBe("second-edit");
    expect(persisted.rows[0].local).toBe("first-edit");
    expect(persisted.rows[1].local).toBe("second-edit");
  });

  it("does not let an in-flight edit shadow a newer reloaded table (reset race)", async () => {
    const state = createContextEditSerializerState();
    const first = baseContextTable();
    const reloaded = baseContextTable();

    // Edit 1 is enqueued and starts running, but its root save is deferred so it
    // is still in flight when edit 2 (with the reloaded table) is enqueued.
    let releaseFirstSave: () => void = () => {};
    const firstSaveGate = new Promise<void>((resolve) => {
      releaseFirstSave = resolve;
    });
    const edit1 = runSerializedContextEdit(state, first, async ({ onRootTableSaved }) => {
      await firstSaveGate;
      onRootTableSaved({ ...first, rows: [{ [PathPropertyName]: "x", local: "older-save" }] });
      return { ok: true, applied: 1, skipped: [], failed: [] };
    });

    let seen: SpaceTable | null = null;
    const edit2 = runSerializedContextEdit(state, reloaded, async ({ tableData }) => {
      seen = tableData;
      return { ok: true, applied: 0, skipped: [], failed: [] };
    });

    // Release edit 1 (its onRootTableSaved fires) only now, while edit 2 is queued.
    releaseFirstSave();
    await Promise.all([edit1, edit2]);

    // Edit 2 must see the reloaded table, not edit 1's in-flight result.
    expect(seen).toBe(reloaded);
  });

  // Known residual (bd Notidian-yef): linked-context table writes (saveContextDB)
  // are not threaded by this serializer — only the root table is. Two concurrent
  // LINKED-context edits remain a narrower, separate case.
});
