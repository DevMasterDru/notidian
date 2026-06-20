/**
 * Write-bridge tests (bd Notidian-3dv).
 *
 * The pure transaction layer (executeTableValueWrites) and the rename engine
 * (executeBulkPageTitleRename) each have focused coverage. What was untested is
 * the BRIDGE that the provider's `applyTableEdits` performs: composing a bulk
 * file rename with the value-write transaction, retargeting value writes onto
 * the renamed paths, classifying partial-rename failures, and threading the
 * canonical read through Obsidian's LAGGED metadata cache.
 *
 * These tests run that real composition (applyTableEditsBridge — a node extract
 * of the provider method) against the FakeObsidianMetadataAdapter, which models
 * processFrontMatter timing, metadataCache.changed ordering, and rename side
 * effects. No React provider is mounted (infeasible under jest's node env per
 * the bead); the wiring under test is the real bridge code path.
 */
import { defaultContextSchemaID } from "shared/schemas/context";
import { PathPropertyName } from "shared/types/context";
import { SpaceTable } from "shared/types/mdb";
import { TablePasteWrite } from "../tablePastePlan";
import { createContextEditSerializerState } from "../contextEditSerializer";
import { applyTableEditsBridge } from "./__fakes__/applyTableEditsBridge";
import { FakeObsidianMetadataAdapter } from "./__fakes__/fakeObsidianMetadataAdapter";

const CONTEXT = "Projects";

const statusCol = { name: "status", type: "text", source: "frontmatter" };

const tableFor = (rows: { path: string; status?: string }[]): SpaceTable => ({
  schema: { id: defaultContextSchemaID, name: "Context", type: "context" },
  cols: [{ name: PathPropertyName, type: "file" }, statusCol],
  rows: rows.map((row, index) => ({
    _index: index.toString(),
    [PathPropertyName]: row.path,
    status: row.status ?? "",
  })),
});

const fileWrite = (
  rowId: string,
  value: string,
  path?: string
): TablePasteWrite => ({
  rowId,
  columnId: PathPropertyName,
  columnName: PathPropertyName,
  table: "",
  value,
  authority: "file",
  ...(path ? { path } : {}),
});

const statusWrite = (rowId: string, value: string): TablePasteWrite => ({
  rowId,
  columnId: "status",
  columnName: "status",
  table: "",
  value,
  authority: "frontmatter",
});

describe("write bridge: applyTableEdits composition over a fake Obsidian adapter", () => {
  it("mixed paste — renames the file AND writes the value onto the RENAMED path", async () => {
    const oldPath = `${CONTEXT}/Old.md`;
    const adapter = new FakeObsidianMetadataAdapter({ metadataLagTicks: 1 });
    adapter.seedFile(oldPath, { status: "todo" });
    const table = tableFor([{ path: oldPath, status: "todo" }]);
    adapter.seedContext(CONTEXT, table);

    const result = await applyTableEditsBridge({
      superstate: adapter.superstate,
      contextPath: CONTEXT,
      tableData: table,
      writes: [fileWrite("0", "New"), statusWrite("0", "doing")],
    });

    const newPath = `${CONTEXT}/New.md`;
    expect(result).toMatchObject({ ok: true, applied: 2, skipped: [], failed: [] });
    // File moved on disk; value landed on the NEW path, not the stale old one.
    expect(adapter.files.has(oldPath)).toBe(false);
    expect(adapter.fileValue(newPath, "status")).toBe("doing");
    expect(adapter.fileValue(oldPath, "status")).toBeUndefined();
  });

  it("mixed paste tolerates metadata lag — the value write is accepted even though the renamed path's cache still shows the pre-edit value at save time", async () => {
    const oldPath = `${CONTEXT}/Lag.md`;
    const newPath = `${CONTEXT}/Renamed.md`;
    // 3 ticks of lag: the rename's cache update and the value read race.
    const adapter = new FakeObsidianMetadataAdapter({ metadataLagTicks: 3 });
    adapter.seedFile(oldPath, { status: "todo" });
    const table = tableFor([{ path: oldPath, status: "todo" }]);
    adapter.seedContext(CONTEXT, table);

    const result = await applyTableEditsBridge({
      superstate: adapter.superstate,
      contextPath: CONTEXT,
      tableData: table,
      writes: [fileWrite("0", "Renamed"), statusWrite("0", "doing")],
    });

    // base value (todo) == canonical read (still todo or undefined under lag),
    // so the conflict gate must NOT fire on our own in-flight rename.
    expect(result).toMatchObject({ ok: true, applied: 2, failed: [] });
    expect(result.skipped).toEqual([]);
    adapter.settle();
    expect(adapter.fileValue(newPath, "status")).toBe("doing");
  });

  it("direct failure feedback — a rename failure rolls the WHOLE bulk batch back (atomic), reports every row file-rename-failed, drops every value write, and notifies (remount cue)", async () => {
    const okPath = `${CONTEXT}/Keep.md`;
    const failPath = `${CONTEXT}/Locked.md`;
    const adapter = new FakeObsidianMetadataAdapter({
      metadataLagTicks: 1,
      renameFails: new Set([failPath]),
    });
    adapter.seedFile(okPath, { status: "todo" });
    adapter.seedFile(failPath, { status: "todo" });
    const table = tableFor([
      { path: okPath, status: "todo" },
      { path: failPath, status: "todo" },
    ]);
    adapter.seedContext(CONTEXT, table);

    const result = await applyTableEditsBridge({
      superstate: adapter.superstate,
      contextPath: CONTEXT,
      tableData: table,
      writes: [
        fileWrite("0", "Kept"),
        statusWrite("0", "doing"),
        fileWrite("1", "Unlocked"),
        statusWrite("1", "doing"),
      ],
    });

    // The bulk rename is transactional: one phase-one failure rolls back the
    // sibling rename too, so applied=[] and BOTH renames report file-rename-failed.
    // This atomicity is the safety contract — a half-applied batch cannot leave
    // value writes pointed at files that were rolled back to their old paths.
    expect(result.ok).toBe(false);
    expect(result.failed).toHaveLength(2);
    expect(
      result.failed.map((issue) => issue.reason)
    ).toEqual(["file-rename-failed", "file-rename-failed"]);
    // Every value write is dropped (both rows failed); no file gains the value,
    // and the rolled-back files sit at their ORIGINAL paths.
    adapter.settle();
    expect(adapter.files.has(okPath)).toBe(true);
    expect(adapter.files.has(failPath)).toBe(true);
    expect(adapter.fileValue(okPath, "status")).toBe("todo");
    expect(adapter.fileValue(failPath, "status")).toBe("todo");
    expect(adapter.fileValue(`${CONTEXT}/Kept.md`, "status")).toBeUndefined();
    // A failure notification fired — the provider uses this to refeed/remount.
    expect(adapter.notifications).toContain("Could not rename all selected files.");
  });

  it("direct failure feedback — an ISOLATED single-row rename failure reports just that row failed and drops only its value write", async () => {
    const failPath = `${CONTEXT}/Locked.md`;
    const adapter = new FakeObsidianMetadataAdapter({
      metadataLagTicks: 1,
      renameFails: new Set([failPath]),
    });
    adapter.seedFile(failPath, { status: "todo" });
    const table = tableFor([{ path: failPath, status: "todo" }]);
    adapter.seedContext(CONTEXT, table);

    const result = await applyTableEditsBridge({
      superstate: adapter.superstate,
      contextPath: CONTEXT,
      tableData: table,
      writes: [fileWrite("0", "Unlocked"), statusWrite("0", "doing")],
    });

    expect(result.ok).toBe(false);
    expect(result.failed).toEqual([
      { write: expect.objectContaining({ authority: "file" }), reason: "file-rename-failed" },
    ]);
    // The value write was dropped — the file never moved, so "doing" is not written.
    adapter.settle();
    expect(adapter.fileValue(failPath, "status")).toBe("todo");
    expect(adapter.notifications).toContain("Could not rename all selected files.");
  });

  it("undo-after-external-reload — undo carries a baked path + expectedCurrentValue, and the conflict gate SKIPS it when the cache shows an external value the undo did not author", async () => {
    const path = `${CONTEXT}/Note.md`;
    const adapter = new FakeObsidianMetadataAdapter({ metadataLagTicks: 0 });
    // Forward edit set "doing"; user then reloaded and an EXTERNAL surface set
    // "blocked". The cache now shows "blocked".
    adapter.seedFile(path, { status: "doing" });
    adapter.externalEdit(path, "status", "blocked");
    const table = tableFor([{ path, status: "doing" }]);
    adapter.seedContext(CONTEXT, table);

    // Undo of the forward edit: revert to "todo", expecting the forward "doing".
    const undoWrite: TablePasteWrite = {
      ...statusWrite("0", "todo"),
      path,
      expectedCurrentValue: "doing",
    };

    const result = await applyTableEditsBridge({
      superstate: adapter.superstate,
      contextPath: CONTEXT,
      tableData: table,
      writes: [undoWrite],
    });

    // Undo must NOT clobber the external "blocked" with "todo".
    expect(result.ok).toBe(true);
    expect(result.applied).toBe(0);
    expect(result.skipped).toEqual([
      {
        write: undoWrite,
        reason: "frontmatter-conflict",
        currentValue: "blocked",
        baseValue: "doing",
        attemptedValue: "todo",
      },
    ]);
    expect(adapter.fileValue(path, "status")).toBe("blocked");
  });

  it("undo-after-external-reload — when the cache still proves the forward value, the undo IS applied (positive control)", async () => {
    const path = `${CONTEXT}/Note.md`;
    const adapter = new FakeObsidianMetadataAdapter({ metadataLagTicks: 0 });
    adapter.seedFile(path, { status: "doing" });
    const table = tableFor([{ path, status: "doing" }]);
    adapter.seedContext(CONTEXT, table);

    const undoWrite: TablePasteWrite = {
      ...statusWrite("0", "todo"),
      path,
      expectedCurrentValue: "doing",
    };

    const result = await applyTableEditsBridge({
      superstate: adapter.superstate,
      contextPath: CONTEXT,
      tableData: table,
      writes: [undoWrite],
    });

    expect(result).toMatchObject({ ok: true, applied: 1, skipped: [], failed: [] });
    expect(adapter.fileValue(path, "status")).toBe("todo");
  });

  it("concurrent value edits over one snapshot are serialized so neither is lost (provider editSerializerRef behavior)", async () => {
    const path = `${CONTEXT}/Shared.md`;
    const adapter = new FakeObsidianMetadataAdapter({ metadataLagTicks: 0 });
    adapter.seedFile(path, { status: "a", priority: "1" });
    const table: SpaceTable = {
      schema: { id: defaultContextSchemaID, name: "Context", type: "context" },
      cols: [
        { name: PathPropertyName, type: "file" },
        statusCol,
        { name: "priority", type: "text", source: "frontmatter" },
      ],
      rows: [{ _index: "0", [PathPropertyName]: path, status: "a", priority: "1" }],
    };
    adapter.seedContext(CONTEXT, table);

    // Both edits share ONE serializer state, like the provider's editSerializerRef.
    const sharedSerializer = createContextEditSerializerState();

    const edit1 = applyTableEditsBridge({
      superstate: adapter.superstate,
      contextPath: CONTEXT,
      tableData: table,
      serializer: sharedSerializer,
      writes: [statusWrite("0", "b")],
    });
    const edit2 = applyTableEditsBridge({
      superstate: adapter.superstate,
      contextPath: CONTEXT,
      tableData: table,
      serializer: sharedSerializer,
      writes: [
        {
          rowId: "0",
          columnId: "priority",
          columnName: "priority",
          table: "",
          value: "2",
          authority: "frontmatter",
        },
      ],
    });

    const [r1, r2] = await Promise.all([edit1, edit2]);
    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(true);
    adapter.settle();
    // Both writes survive — neither edit clobbered the other's column.
    expect(adapter.fileValue(path, "status")).toBe("b");
    expect(adapter.fileValue(path, "priority")).toBe("2");
  });
});
