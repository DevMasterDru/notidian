import { defaultContextSchemaID } from "shared/schemas/context";
import { PathPropertyName } from "shared/types/context";
import { SpaceTable, SpaceTables } from "shared/types/mdb";
import {
  applyTableEditPathOverrides,
  combineTableEditTransactionResults,
  emptyTableEditTransactionResult,
  executeTableValueWrites,
  isOnlySchemaChangedSkip,
  TableCellWrite,
  TableEditTransactionResult,
} from "./tableEditTransaction";

const rootTable = (): SpaceTable => ({
  schema: { id: defaultContextSchemaID, name: "Context", type: "context" },
  cols: [
    { name: PathPropertyName, type: "file" },
    { name: "status", type: "text", source: "frontmatter" },
    { name: "rating", type: "number", source: "frontmatter" },
    { name: "local", type: "text" },
  ],
  rows: [
    { [PathPropertyName]: "Relays & Devices/A.md", status: "old" },
    { [PathPropertyName]: "Relays & Devices/B.md", status: "old" },
  ],
});

const contextTables = (): SpaceTables => ({
  "contexts/projects": {
    schema: { id: "projects", name: "Projects", type: "context" },
    cols: [
      { name: PathPropertyName, type: "file" },
      { name: "phase", type: "text" },
    ],
    rows: [
      { [PathPropertyName]: "Relays & Devices/A.md", phase: "old" },
      { [PathPropertyName]: "Relays & Devices/B.md", phase: "old" },
    ],
  },
});

const execute = async ({
  writes,
  table = rootTable(),
  contexts = {},
  frontmatterOk = true,
  frontmatterFailPaths,
  currentFrontmatterValues = {},
  sessionEditedKeys,
  allOrNothing = false,
}: {
  writes: TableCellWrite[];
  table?: SpaceTable;
  contexts?: SpaceTables;
  frontmatterOk?: boolean;
  // Resolved paths whose frontmatter write should fail; overrides frontmatterOk
  // per path so a mid-batch multi-file failure can be exercised.
  frontmatterFailPaths?: string[];
  currentFrontmatterValues?: Record<string, Record<string, string>>;
  sessionEditedKeys?: Set<string>;
  allOrNothing?: boolean;
}) => {
  const savedFrontmatter: { path: string; properties: Record<string, unknown> }[] =
    [];
  const savedTables: SpaceTable[] = [];
  const savedContexts: { key: string; table: SpaceTable }[] = [];
  const operations: string[] = [];

  const result = await executeTableValueWrites({
    writes,
    tableData: table,
    contextTable: contexts,
    dbSchemaId: defaultContextSchemaID,
    contextPath: "Relays & Devices",
    resolvePath: (path, contextPath) => `${contextPath}/${path}`,
    shouldWritePropertyToFrontmatter: (column) =>
      column.source == "frontmatter",
    parseValue: (column, value) =>
      column.type == "number" ? Number(value) : value,
    currentFrontmatterValue: ({ path, column }) =>
      currentFrontmatterValues[path]?.[column.name],
    saveFrontmatterProperties: async ({ path, properties }) => {
      operations.push("frontmatter");
      savedFrontmatter.push({ path, properties });
      const ok = frontmatterFailPaths
        ? !frontmatterFailPaths.includes(path)
        : frontmatterOk;
      return ok ? { ok: true } : { ok: false };
    },
    saveDB: async (nextTable) => {
      operations.push("saveDB");
      savedTables.push(nextTable);
    },
    saveContextDB: async (nextTable, key) => {
      operations.push("saveContextDB");
      savedContexts.push({ key, table: nextTable });
    },
    contextKeyForTable: (tableName) => `contexts/${tableName}`,
    sessionEditedKeys,
    ...(allOrNothing ? ({ allOrNothing: true } as any) : {}),
  });

  return {
    result,
    savedFrontmatter,
    savedTables,
    savedContexts,
    operations,
  };
};

describe("executeTableValueWrites", () => {
  it("keeps both values and option configuration untouched when an atomic batch conflicts", async () => {
    const fieldValue = JSON.stringify({
      options: [{ name: "Renamed", value: "renamed" }],
    });
    const { result, savedFrontmatter, savedTables } = await execute({
      allOrNothing: true,
      currentFrontmatterValues: {
        "Relays & Devices/Relays & Devices/A.md": { status: "external" },
      },
      writes: [
        {
          rowId: "0",
          columnName: "status",
          table: "",
          value: "renamed",
          fieldValue,
        },
        {
          rowId: "1",
          columnName: "status",
          table: "",
          value: "renamed",
          fieldValue,
        },
      ],
    });

    expect(result.ok).toBe(false);
    expect(result.applied).toBe(0);
    expect(result.skipped).toEqual([
      expect.objectContaining({ reason: "frontmatter-conflict" }),
    ]);
    expect(savedFrontmatter).toEqual([]);
    expect(savedTables).toEqual([]);
  });

  it("combines transaction results for mixed edit operations", () => {
    expect(
      combineTableEditTransactionResults(
        {
          ok: true,
          applied: 2,
          skipped: [],
          failed: [],
        },
        {
          ok: false,
          applied: 1,
          skipped: [
            {
              reason: "missing-row",
              write: {
                rowId: "8",
                columnName: "status",
                table: "",
                value: "active",
              },
            },
          ],
          failed: [
            {
              reason: "file-rename-failed",
              write: {
                rowId: "0",
                columnName: PathPropertyName,
                table: "",
                value: "Renamed",
              },
            },
          ],
        }
      )
    ).toEqual({
      ok: false,
      applied: 3,
      skipped: [
        {
          reason: "missing-row",
          write: {
            rowId: "8",
            columnName: "status",
            table: "",
            value: "active",
          },
        },
      ],
      failed: [
        {
          reason: "file-rename-failed",
          write: {
            rowId: "0",
            columnName: PathPropertyName,
            table: "",
            value: "Renamed",
          },
        },
      ],
    });
  });

  it("provides an empty successful transaction result", () => {
    expect(emptyTableEditTransactionResult()).toEqual({
      ok: true,
      applied: 0,
      skipped: [],
      failed: [],
    });
  });

  it("applies row path overrides to writes after mixed file rename transactions", () => {
    expect(
      applyTableEditPathOverrides(
        [
          {
            rowId: "0",
            columnName: "status",
            table: "",
            value: "active",
          },
          {
            rowId: "1",
            columnName: "status",
            table: "",
            value: "paused",
          },
        ],
        new Map([["0", "Relays & Devices/Renamed.md"]])
      )
    ).toEqual([
      {
        rowId: "0",
        columnName: "status",
        table: "",
        value: "active",
        path: "Relays & Devices/Renamed.md",
      },
      {
        rowId: "1",
        columnName: "status",
        table: "",
        value: "paused",
      },
    ]);
  });

  it("groups frontmatter writes by resolved row path and applies one root table snapshot", async () => {
    const { result, savedFrontmatter, savedTables } = await execute({
      writes: [
        {
          rowId: "0",
          columnName: "status",
          table: "",
          value: "active",
          path: "",
        },
        {
          rowId: "0",
          columnName: "rating",
          table: "",
          value: "5",
        },
      ],
    });

    expect(result).toMatchObject({ ok: true, applied: 2 });
    expect(savedFrontmatter).toEqual([
      {
        path: "Relays & Devices/Relays & Devices/A.md",
        properties: { status: "active", rating: 5 },
      },
    ]);
    expect(savedTables).toHaveLength(1);
    expect(savedTables[0].rows[0]).toMatchObject({
      status: "active",
      rating: "5",
    });
  });

  it("does not save table snapshots when a canonical frontmatter write fails", async () => {
    const { result, savedTables, savedContexts } = await execute({
      writes: [
        {
          rowId: "0",
          columnName: "status",
          table: "",
          value: "active",
        },
      ],
      frontmatterOk: false,
    });

    expect(result.ok).toBe(false);
    expect(result.failed).toHaveLength(1);
    expect(savedTables).toEqual([]);
    expect(savedContexts).toEqual([]);
  });

  it("keeps files committed before a mid-batch frontmatter failure applied and reports the rest failed (Notidian-9oxo)", async () => {
    // A 2-file paste: file A commits, file B's frontmatter write rejects. The
    // pre-fix code returned applied:0 with only B in failed, so the caller
    // pushed NO undo entry for the already-committed A. The fix must keep A
    // applied (undo-able) and report only B failed.
    const { result, savedFrontmatter, savedTables, savedContexts } =
      await execute({
        writes: [
          {
            rowId: "0",
            columnId: "status",
            columnName: "status",
            table: "",
            value: "x",
          },
          {
            rowId: "1",
            columnId: "status",
            columnName: "status",
            table: "",
            value: "y",
          },
        ],
        frontmatterFailPaths: ["Relays & Devices/Relays & Devices/B.md"],
      });

    // Every path is attempted (A committed, B attempted-and-failed) — nothing
    // silently dropped.
    expect(savedFrontmatter).toEqual([
      {
        path: "Relays & Devices/Relays & Devices/A.md",
        properties: { status: "x" },
      },
      {
        path: "Relays & Devices/Relays & Devices/B.md",
        properties: { status: "y" },
      },
    ]);
    // A stays applied so the caller keeps an undo entry for it; B is failed.
    expect(result.applied).toBe(1);
    expect(result.ok).toBe(false);
    expect(result.failed).toEqual([
      {
        reason: "frontmatter-write-failed",
        write: expect.objectContaining({ rowId: "1", value: "y" }),
      },
    ]);
    // The root snapshot reflects A's committed value but NOT B's failed one.
    expect(savedTables).toHaveLength(1);
    expect(savedTables[0].rows[0]).toMatchObject({ status: "x" });
    expect(savedTables[0].rows[1]).toMatchObject({ status: "old" });
    expect(savedContexts).toEqual([]);
  });

  it("resolves baseValue from the linked-context row for a frontmatter column that lives only there (Notidian-jwfr)", async () => {
    // "budget" is a frontmatter-backed column declared ONLY by the linked
    // #client context, not by the root table. Its displayed value lives in the
    // context row. Reading baseValue from the root row (which lacks the column)
    // yielded "" and false-skipped the edit as a frontmatter-conflict.
    const contexts: SpaceTables = {
      "contexts/client": {
        schema: { id: "client", name: "Client", type: "context" },
        cols: [
          { name: PathPropertyName, type: "file" },
          { name: "budget", type: "number", source: "frontmatter" },
        ],
        rows: [{ [PathPropertyName]: "Relays & Devices/A.md", budget: "5000" }],
      },
    };

    const { result, savedFrontmatter } = await execute({
      contexts,
      currentFrontmatterValues: {
        "Relays & Devices/Relays & Devices/A.md": { budget: "5000" },
      },
      writes: [
        {
          rowId: "0",
          columnId: "budgetclient",
          columnName: "budget",
          table: "client",
          value: "6000",
        },
      ],
    });

    // baseValue now equals the context row's 5000, matching canonical 5000 — no
    // false conflict, so the edit is written.
    expect(result).toMatchObject({ ok: true, applied: 1, skipped: [] });
    expect(savedFrontmatter).toEqual([
      {
        path: "Relays & Devices/Relays & Devices/A.md",
        properties: { budget: 6000 },
      },
    ]);
  });

  it("still false-negative-guards: a root column's baseValue is unaffected by the linked-context resolution (Notidian-jwfr scope boundary)", async () => {
    // A root frontmatter column keeps root-row baseValue resolution: an external
    // change is still detected as a conflict.
    const { result } = await execute({
      currentFrontmatterValues: {
        "Relays & Devices/Relays & Devices/A.md": { status: "external" },
      },
      writes: [
        {
          rowId: "0",
          columnId: "status",
          columnName: "status",
          table: "",
          value: "active",
        },
      ],
    });

    expect(result).toMatchObject({
      ok: true,
      applied: 0,
      skipped: [
        expect.objectContaining({
          reason: "frontmatter-conflict",
          baseValue: "old",
        }),
      ],
    });
  });

  it("skips stale frontmatter writes when the canonical value changed externally", async () => {
    const { result, savedFrontmatter, savedTables, savedContexts } =
      await execute({
        currentFrontmatterValues: {
          "Relays & Devices/Relays & Devices/A.md": {
            status: "external",
          },
        },
        writes: [
          {
            rowId: "0",
            columnName: "status",
            table: "",
            value: "active",
          },
        ],
      });

    expect(result).toEqual({
      ok: true,
      applied: 0,
      skipped: [
        {
          reason: "frontmatter-conflict",
          currentValue: "external",
          baseValue: "old",
          attemptedValue: "active",
          write: {
            rowId: "0",
            columnName: "status",
            table: "",
            value: "active",
          },
        },
      ],
      failed: [],
    });
    expect(savedFrontmatter).toEqual([]);
    expect(savedTables).toEqual([]);
    expect(savedContexts).toEqual([]);
  });

  it("reports frontmatter conflict details for inline resolution", async () => {
    const { result } = await execute({
      currentFrontmatterValues: {
        "Relays & Devices/Relays & Devices/A.md": {
          status: "external",
        },
      },
      writes: [
        {
          rowId: "0",
          columnId: "status",
          columnName: "status",
          table: "",
          value: "active",
        },
      ],
    });

    expect(result.skipped).toEqual([
      {
        reason: "frontmatter-conflict",
        currentValue: "external",
        baseValue: "old",
        attemptedValue: "active",
        write: {
          rowId: "0",
          columnId: "status",
          columnName: "status",
          table: "",
          value: "active",
        },
      },
    ]);
  });

  it("re-applies a write to a cell this session already wrote while the canonical index still lags", async () => {
    // Repro of the user-reported paste corruption (bd Notidian-2kf7): the edit
    // serializer threads the optimistically-updated table into the next
    // transaction, so baseValue reflects our own just-written value ('done'),
    // while pathsIndex (canonicalValue) still lags at the pre-edit value
    // ('todo') until the debounced reload settles. The gate must NOT read that
    // self-induced lag as an external conflict — otherwise the second paste is
    // silently skipped and the cell keeps a stale value (looks like a
    // hallucinated value / a stray space to the user).
    const sessionEditedKeys = new Set<string>();
    const inSyncTable: SpaceTable = {
      ...rootTable(),
      rows: [
        { [PathPropertyName]: "Relays & Devices/A.md", status: "todo" },
        { [PathPropertyName]: "Relays & Devices/B.md", status: "todo" },
      ],
    };

    // Paste #1: snapshot is in sync (canonical 'todo' == base 'todo').
    const first = await execute({
      table: inSyncTable,
      currentFrontmatterValues: {
        "Relays & Devices/Relays & Devices/A.md": { status: "todo" },
      },
      sessionEditedKeys,
      writes: [
        { rowId: "0", columnId: "status", columnName: "status", table: "", value: "done" },
      ],
    });
    expect(first.result).toMatchObject({ ok: true, applied: 1, skipped: [] });

    // Paste #2: the optimistically-threaded snapshot now shows 'done', but
    // pathsIndex still lags at 'todo' (reload not yet settled).
    const optimisticTable = first.savedTables[first.savedTables.length - 1];
    const second = await execute({
      table: optimisticTable,
      currentFrontmatterValues: {
        "Relays & Devices/Relays & Devices/A.md": { status: "todo" },
      },
      sessionEditedKeys,
      writes: [
        { rowId: "0", columnId: "status", columnName: "status", table: "", value: "in-progress" },
      ],
    });

    expect(second.result).toMatchObject({ ok: true, applied: 1, skipped: [] });
    expect(second.savedFrontmatter).toEqual([
      {
        path: "Relays & Devices/Relays & Devices/A.md",
        properties: { status: "in-progress" },
      },
    ]);
  });

  it("still skips a genuine external change on the first touch of a cell this session", async () => {
    // Companion guard to the test above: the relaxation must apply ONLY to
    // cells we already wrote this session. A first-touch conflict (the value
    // changed out of band before we ever wrote it) must still be protected
    // (bd Notidian-29g).
    const sessionEditedKeys = new Set<string>();
    const { result, savedFrontmatter } = await execute({
      currentFrontmatterValues: {
        "Relays & Devices/Relays & Devices/A.md": { status: "external" },
      },
      sessionEditedKeys,
      writes: [
        { rowId: "0", columnId: "status", columnName: "status", table: "", value: "active" },
      ],
    });

    expect(result).toMatchObject({
      ok: true,
      applied: 0,
      skipped: [expect.objectContaining({ reason: "frontmatter-conflict" })],
    });
    expect(savedFrontmatter).toEqual([]);
  });

  it("rolls back the self-edited mark for a write whose frontmatter commit rejected, so a retry still catches an external change (Notidian-cytg)", async () => {
    // sessionEditedKeys.add(editKey) fires in the pre-commit classification
    // loop, before the per-path commit loop knows whether the write will
    // actually land. Attempt #1 below is classified as a non-conflicting edit
    // (canonical == base) but its frontmatter write REJECTS in the commit
    // loop. If the speculative mark is left in place, a retry after an
    // out-of-band external change would see selfEditedThisSession=true and
    // skip the stale-conflict gate entirely, silently clobbering the external
    // edit. The fix rolls the mark back on commit failure so the retry's
    // conflict gate runs normally.
    const sessionEditedKeys = new Set<string>();
    const path = "Relays & Devices/Relays & Devices/A.md";

    const first = await execute({
      sessionEditedKeys,
      currentFrontmatterValues: {
        [path]: { status: "old" },
      },
      frontmatterFailPaths: [path],
      writes: [
        { rowId: "0", columnId: "status", columnName: "status", table: "", value: "active" },
      ],
    });

    expect(first.result.ok).toBe(false);
    expect(first.result.applied).toBe(0);
    expect(first.result.failed).toEqual([
      {
        reason: "frontmatter-write-failed",
        write: expect.objectContaining({ rowId: "0", value: "active" }),
      },
    ]);
    // The failed write's speculative self-edited mark must be gone: nothing
    // actually committed to disk for this (path, column).
    expect(sessionEditedKeys.size).toBe(0);

    // Between the failed attempt and the retry, another process changes the
    // file's frontmatter out of band.
    const retry = await execute({
      sessionEditedKeys,
      currentFrontmatterValues: {
        [path]: { status: "external" },
      },
      writes: [
        { rowId: "0", columnId: "status", columnName: "status", table: "", value: "active" },
      ],
    });

    // The stale-conflict gate fires because this (path, column) is no longer
    // marked self-edited — the external change is caught instead of being
    // silently overwritten.
    expect(retry.result).toMatchObject({
      ok: true,
      applied: 0,
      skipped: [
        expect.objectContaining({
          reason: "frontmatter-conflict",
          currentValue: "external",
          baseValue: "old",
        }),
      ],
    });
    expect(retry.savedFrontmatter).toEqual([]);
  });

  it("does not roll back a mark earned by an earlier, separately-committed call when a LATER call's commit to the same cell fails", async () => {
    // Regression for a second-order bug in the Notidian-cytg rollback fix
    // itself: the rollback must only revoke a mark THIS call speculatively
    // introduced, never one that predates it. Sequence:
    //   1. Call #1 writes (path, status) with no conflict; its frontmatter
    //      commit SUCCEEDS, legitimately marking the cell self-edited.
    //   2. Call #2 makes a second write to the SAME cell. Because the mark
    //      from call #1 is present, the stale-conflict gate tolerates
    //      pathsIndex still lagging at call #1's pre-edit value and proceeds
    //      to commit — but this time the frontmatter write REJECTS for an
    //      unrelated reason (e.g. transient I/O). A naive unconditional
    //      rollback would delete the mark here even though it protects call
    //      #1's already-landed write, not call #2's failed one.
    //   3. Call #3 makes a further legitimate edit to the same cell while
    //      pathsIndex is STILL lagging (never caught up in this synthetic
    //      repro). If the mark survived call #2's failure, the gate again
    //      tolerates the lag and the edit commits. If it was wrongly wiped,
    //      the gate misreads the session's own lag as an external conflict
    //      and skips the edit — the exact Notidian-2kf7 false-conflict class
    //      sessionEditedKeys exists to prevent.
    const sessionEditedKeys = new Set<string>();
    const path = "Relays & Devices/Relays & Devices/A.md";

    const first = await execute({
      sessionEditedKeys,
      currentFrontmatterValues: { [path]: { status: "old" } },
      writes: [
        { rowId: "0", columnId: "status", columnName: "status", table: "", value: "active" },
      ],
    });
    expect(first.result).toMatchObject({ ok: true, applied: 1, skipped: [] });
    expect(sessionEditedKeys.has(`${path}\0status`)).toBe(true);

    // Thread call #1's committed snapshot into call #2, as the real edit
    // serializer does — baseValue now reflects 'active'.
    const optimisticTable = first.savedTables[first.savedTables.length - 1];
    const second = await execute({
      table: optimisticTable,
      sessionEditedKeys,
      // pathsIndex has not caught up yet: still reports the pre-edit value.
      currentFrontmatterValues: { [path]: { status: "old" } },
      frontmatterFailPaths: [path],
      writes: [
        { rowId: "0", columnId: "status", columnName: "status", table: "", value: "active-retry" },
      ],
    });

    // The gate tolerated the lag (mark from call #1 present) and attempted the
    // commit, which then rejected.
    expect(second.result.ok).toBe(false);
    expect(second.result.failed).toEqual([
      {
        reason: "frontmatter-write-failed",
        write: expect.objectContaining({ rowId: "0", value: "active-retry" }),
      },
    ]);
    // The mark predates call #2, so call #2's failure must NOT erase it.
    expect(sessionEditedKeys.has(`${path}\0status`)).toBe(true);

    // Call #3: a further legitimate edit while pathsIndex is still lagging.
    // Table state is unaffected by call #2's failed write (it never landed),
    // so it still reflects call #1's committed 'active'.
    const third = await execute({
      table: optimisticTable,
      sessionEditedKeys,
      currentFrontmatterValues: { [path]: { status: "old" } },
      writes: [
        { rowId: "0", columnId: "status", columnName: "status", table: "", value: "in-progress" },
      ],
    });

    expect(third.result).toMatchObject({ ok: true, applied: 1, skipped: [] });
    expect(third.savedFrontmatter).toEqual([
      { path, properties: { status: "in-progress" } },
    ]);
  });

  it("allows explicit forced frontmatter writes after conflict review", async () => {
    const { result, savedFrontmatter, savedTables } = await execute({
      currentFrontmatterValues: {
        "Relays & Devices/Relays & Devices/A.md": {
          status: "external",
        },
      },
      writes: [
        {
          rowId: "0",
          columnId: "status",
          columnName: "status",
          table: "",
          value: "active",
          forceFrontmatterWrite: true,
        } as TableCellWrite & { forceFrontmatterWrite: true },
      ],
    });

    expect(result).toMatchObject({ ok: true, applied: 1, skipped: [] });
    expect(savedFrontmatter).toEqual([
      {
        path: "Relays & Devices/Relays & Devices/A.md",
        properties: { status: "active" },
      },
    ]);
    expect(savedTables[0].rows[0]).toMatchObject({ status: "active" });
  });

  it("applies linked context writes to the matching row path", async () => {
    const { result, savedContexts } = await execute({
      contexts: contextTables(),
      writes: [
        {
          rowId: "1",
          columnName: "phase",
          table: "projects",
          value: "build",
        },
      ],
    });

    expect(result).toMatchObject({ ok: true, applied: 1 });
    expect(savedContexts).toHaveLength(1);
    expect(savedContexts[0].key).toBe("contexts/projects");
    expect(savedContexts[0].table.rows[1]).toMatchObject({ phase: "build" });
  });

  it("reports missing linked context tables as skipped writes", async () => {
    const { result, savedContexts } = await execute({
      writes: [
        {
          rowId: "0",
          columnName: "phase",
          table: "projects",
          value: "build",
        },
      ],
    });

    expect(result).toMatchObject({ ok: true, applied: 0 });
    expect(result.skipped).toEqual([
      expect.objectContaining({ reason: "missing-context-table" }),
    ]);
    expect(savedContexts).toEqual([]);
  });

  it("stores field option updates in the same saved table snapshot as the value", async () => {
    const { savedTables } = await execute({
      writes: [
        {
          rowId: "1",
          columnName: "local",
          table: "",
          value: "manual",
          fieldValue: "manual,auto",
        },
      ],
    });

    expect(savedTables).toHaveLength(1);
    expect(savedTables[0].cols.find((col) => col.name == "local")).toMatchObject(
      { value: "manual,auto" }
    );
    expect(savedTables[0].rows[1]).toMatchObject({ local: "manual" });
  });

  it("persists root field config before frontmatter writes trigger a reload", async () => {
    const fieldValue = '{"options":[{"name":"review","value":"review"}]}';
    const { savedTables, savedFrontmatter, operations } = await execute({
      writes: [
        {
          rowId: "1",
          columnName: "status",
          table: "",
          value: "review",
          fieldValue,
        },
      ],
    });

    expect(savedFrontmatter).toHaveLength(1);
    expect(operations).toEqual(["saveDB", "frontmatter", "saveDB"]);
    expect(savedTables).toHaveLength(2);
    expect(savedTables[0].cols.find((col) => col.name == "status")).toMatchObject(
      { value: fieldValue }
    );
    expect(savedTables[0].rows[1]).toMatchObject({ status: "old" });
    expect(savedTables[1].cols.find((col) => col.name == "status")).toMatchObject(
      { value: fieldValue }
    );
    expect(savedTables[1].rows[1]).toMatchObject({ status: "review" });
  });

  it("persists root field attrs before frontmatter writes trigger a reload", async () => {
    const fieldAttrs = '{"notidianGroupOrder":["old","review","later"]}';
    const { savedTables, savedFrontmatter, operations } = await execute({
      writes: [
        {
          rowId: "1",
          columnName: "status",
          table: "",
          value: "review",
          fieldAttrs,
        },
      ],
    });

    expect(savedFrontmatter).toHaveLength(1);
    expect(operations).toEqual(["saveDB", "frontmatter", "saveDB"]);
    expect(savedTables).toHaveLength(2);
    expect(savedTables[0].cols.find((col) => col.name == "status")).toMatchObject(
      { attrs: fieldAttrs }
    );
    expect(savedTables[0].rows[1]).toMatchObject({ status: "old" });
    expect(savedTables[1].cols.find((col) => col.name == "status")).toMatchObject(
      { attrs: fieldAttrs }
    );
    expect(savedTables[1].rows[1]).toMatchObject({ status: "review" });
  });

  it("persists context field config updates when the context row is temporarily missing", async () => {
    const contexts = contextTables();
    contexts["contexts/projects"] = {
      ...contexts["contexts/projects"],
      cols: contexts["contexts/projects"].cols.map((col) =>
        col.name == "phase" ? { ...col, source: "frontmatter" } : col
      ),
      rows: [contexts["contexts/projects"].rows[0]],
    };

    const { result, savedContexts, savedFrontmatter } = await execute({
      contexts,
      writes: [
        {
          rowId: "1",
          columnName: "phase",
          table: "projects",
          value: "build",
          fieldValue: '{"options":[{"name":"build","value":"build"}]}',
        },
      ],
    });

    expect(savedFrontmatter).toHaveLength(1);
    expect(result.skipped).toEqual([
      expect.objectContaining({ reason: "missing-context-row" }),
    ]);
    expect(savedContexts).toHaveLength(1);
    expect(
      savedContexts[0].table.cols.find((col) => col.name == "phase")
    ).toMatchObject({
      value: '{"options":[{"name":"build","value":"build"}]}',
    });
  });

  it("persists field config updates when the value write is skipped for a frontmatter conflict", async () => {
    const { result, savedTables, savedFrontmatter } = await execute({
      currentFrontmatterValues: {
        "Relays & Devices/Relays & Devices/B.md": {
          status: "external",
        },
      },
      writes: [
        {
          rowId: "1",
          columnName: "status",
          table: "",
          value: "review",
          fieldValue: '{"options":[{"name":"review","value":"review"}]}',
        },
      ],
    });

    expect(savedFrontmatter).toEqual([]);
    expect(result.applied).toBe(0);
    expect(result.skipped).toEqual([
      expect.objectContaining({ reason: "frontmatter-conflict" }),
    ]);
    expect(savedTables).toHaveLength(1);
    expect(
      savedTables[0].cols.find((col) => col.name == "status")
    ).toMatchObject({
      value: '{"options":[{"name":"review","value":"review"}]}',
    });
    expect(savedTables[0].rows[1]).toMatchObject({ status: "old" });
  });

  it("does not clobber a field option added after a journaled edit when replaying an undo (Notidian-o8op)", async () => {
    const table = rootTable();
    table.cols = table.cols.map((col) =>
      col.name == "local" ? { ...col, value: "manual,auto,extra" } : col
    );

    const { savedTables } = await execute({
      table,
      writes: [
        {
          rowId: "0",
          columnName: "local",
          table: "",
          value: "manual",
          path: "Relays & Devices/A.md",
          // Restore the pre-edit list, expecting the list the edit produced.
          fieldValue: "manual",
          expectedFieldValue: "manual,auto",
          authority: "notidian",
        } as TableCellWrite,
      ],
    });

    expect(savedTables).toHaveLength(1);
    // "extra" was added through the column config after the journaled edit; it
    // must survive the undo of that earlier edit.
    expect(savedTables[0].cols.find((col) => col.name == "local")).toMatchObject({
      value: "manual,auto,extra",
    });
    // The cell value is still restored.
    expect(savedTables[0].rows[0]).toMatchObject({ local: "manual" });
  });

  it("restores a field option list on undo when the column configuration is unchanged (Notidian-o8op)", async () => {
    const table = rootTable();
    table.cols = table.cols.map((col) =>
      col.name == "local" ? { ...col, value: "manual,auto" } : col
    );

    const { savedTables } = await execute({
      table,
      writes: [
        {
          rowId: "0",
          columnName: "local",
          table: "",
          value: "manual",
          path: "Relays & Devices/A.md",
          fieldValue: "manual",
          expectedFieldValue: "manual,auto",
          authority: "notidian",
        } as TableCellWrite,
      ],
    });

    // The column list is unchanged since the edit, so the snapshot restore applies.
    expect(savedTables[0].cols.find((col) => col.name == "local")).toMatchObject({
      value: "manual",
    });
  });

  it("skips a frontmatter-authority replay write whose column was deleted instead of writing to the MDB (Notidian-8xzy)", async () => {
    const { result, savedTables, savedFrontmatter } = await execute({
      writes: [
        {
          rowId: "0",
          columnName: "priority", // column since deleted — not in cols
          table: "",
          value: "x",
          path: "Relays & Devices/A.md",
          expectedCurrentValue: "y",
          authority: "frontmatter",
        } as TableCellWrite,
      ],
    });

    expect(result.applied).toBe(0);
    expect(result.skipped).toEqual([
      expect.objectContaining({ reason: "schema-changed" }),
    ]);
    // Never demoted to a root MDB write (the authority violation this guards).
    expect(savedTables).toEqual([]);
    expect(savedFrontmatter).toEqual([]);
  });

  it("still routes a notidian replay write with a missing column to the MDB (Notidian-8xzy scope boundary)", async () => {
    const { result, savedTables } = await execute({
      writes: [
        {
          rowId: "0",
          columnName: "priority", // no column, but authority is notidian
          table: "",
          value: "x",
          path: "Relays & Devices/A.md",
          authority: "notidian",
        } as TableCellWrite,
      ],
    });

    // notidian values are MDB-owned by design, so the fix does not skip them.
    expect(result.applied).toBe(1);
    expect(savedTables).toHaveLength(1);
    expect(savedTables[0].rows[0]).toMatchObject({ priority: "x" });
  });
});

describe("isOnlySchemaChangedSkip", () => {
  const write: TableCellWrite = {
    rowId: "0",
    columnName: "status",
    table: "",
    value: "x",
  };

  it("is true when every skip is schema-changed and nothing failed", () => {
    const result: TableEditTransactionResult = {
      ok: true,
      applied: 0,
      skipped: [{ write, reason: "schema-changed" }],
      failed: [],
    };
    expect(isOnlySchemaChangedSkip(result)).toBe(true);
  });

  it("is true with multiple schema-changed skips and no failures", () => {
    const result: TableEditTransactionResult = {
      ok: true,
      applied: 0,
      skipped: [
        { write, reason: "schema-changed" },
        { write, reason: "schema-changed" },
      ],
      failed: [],
    };
    expect(isOnlySchemaChangedSkip(result)).toBe(true);
  });

  it("is false when a frontmatter-conflict skip is mixed in (transient, must not be treated as permanent)", () => {
    const result: TableEditTransactionResult = {
      ok: true,
      applied: 0,
      skipped: [
        { write, reason: "schema-changed" },
        { write, reason: "frontmatter-conflict" },
      ],
      failed: [],
    };
    expect(isOnlySchemaChangedSkip(result)).toBe(false);
  });

  it("is false when there is any failure, even alongside a schema-changed skip", () => {
    const result: TableEditTransactionResult = {
      ok: false,
      applied: 0,
      skipped: [{ write, reason: "schema-changed" }],
      failed: [{ write, reason: "frontmatter-write-failed" }],
    };
    expect(isOnlySchemaChangedSkip(result)).toBe(false);
  });

  it("is false when nothing was skipped", () => {
    const result: TableEditTransactionResult = {
      ok: true,
      applied: 1,
      skipped: [],
      failed: [],
    };
    expect(isOnlySchemaChangedSkip(result)).toBe(false);
  });

  it("is false for a purely transient frontmatter-conflict skip (regression guard)", () => {
    const result: TableEditTransactionResult = {
      ok: true,
      applied: 0,
      skipped: [{ write, reason: "frontmatter-conflict" }],
      failed: [],
    };
    expect(isOnlySchemaChangedSkip(result)).toBe(false);
  });
});
