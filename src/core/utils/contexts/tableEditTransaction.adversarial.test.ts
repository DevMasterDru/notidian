/**
 * Adversarial / property-invariant tests for tableEditTransaction.
 *
 * These lock invariants that the functional tests do not probe:
 * accounting identities, idempotency, save-once-per-path, ordering
 * guarantees, linked-context isolation, path override consistency,
 * and empty-batch identity — plus adversarial scenarios such as
 * same-cell batches, missing rows, mixed authority writes, universal
 * conflict, undefined columnId, and large batches.
 *
 * Bead: Notidian-y23y
 */

import { defaultContextSchemaID } from "shared/schemas/context";
import { PathPropertyName } from "shared/types/context";
import { SpaceTable, SpaceTables } from "shared/types/mdb";
import {
  applyTableEditPathOverrides,
  combineTableEditTransactionResults,
  emptyTableEditTransactionResult,
  executeTableValueWrites,
  resolveTableEditPath,
  TableCellWrite,
  TableEditTransactionResult,
} from "./tableEditTransaction";

// ---------------------------------------------------------------------------
// Helpers — mirrors the existing test harness with extras for tracking
// ---------------------------------------------------------------------------

const rootTable = (): SpaceTable => ({
  schema: { id: defaultContextSchemaID, name: "Context", type: "context" },
  cols: [
    { name: PathPropertyName, type: "file" },
    { name: "status", type: "text", source: "frontmatter" },
    { name: "rating", type: "number", source: "frontmatter" },
    { name: "local", type: "text" },
  ],
  rows: [
    { [PathPropertyName]: "Folder/A.md", status: "old", rating: "3" },
    { [PathPropertyName]: "Folder/B.md", status: "old", rating: "2" },
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
      { [PathPropertyName]: "Folder/A.md", phase: "plan" },
      { [PathPropertyName]: "Folder/B.md", phase: "plan" },
    ],
  },
});

type ExecuteResult = {
  result: TableEditTransactionResult;
  savedFrontmatter: { path: string; properties: Record<string, unknown> }[];
  savedTables: SpaceTable[];
  savedContexts: { key: string; table: SpaceTable }[];
  operations: string[];
  saveFrontmatterCallCount: number;
  saveDBCallCount: number;
  saveContextDBCallCount: number;
};

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
  // Resolved paths whose frontmatter write should reject; overrides
  // frontmatterOk per path so a mid-batch multi-file failure can be exercised.
  frontmatterFailPaths?: string[];
  currentFrontmatterValues?: Record<string, Record<string, string>>;
  sessionEditedKeys?: Set<string>;
  allOrNothing?: boolean;
}): Promise<ExecuteResult> => {
  const savedFrontmatter: { path: string; properties: Record<string, unknown> }[] = [];
  const savedTables: SpaceTable[] = [];
  const savedContexts: { key: string; table: SpaceTable }[] = [];
  const operations: string[] = [];
  let saveFrontmatterCallCount = 0;
  let saveDBCallCount = 0;
  let saveContextDBCallCount = 0;

  const result = await executeTableValueWrites({
    writes,
    tableData: table,
    contextTable: contexts,
    dbSchemaId: defaultContextSchemaID,
    contextPath: "Folder",
    resolvePath: (path, contextPath) => `${contextPath}/${path}`,
    shouldWritePropertyToFrontmatter: (column) => column.source === "frontmatter",
    parseValue: (column, value) =>
      column.type === "number" ? Number(value) : value,
    currentFrontmatterValue: ({ path, column }) =>
      currentFrontmatterValues[path]?.[column.name],
    saveFrontmatterProperties: async ({ path, properties }) => {
      saveFrontmatterCallCount++;
      operations.push("frontmatter");
      savedFrontmatter.push({ path, properties });
      const ok = frontmatterFailPaths
        ? !frontmatterFailPaths.includes(path)
        : frontmatterOk;
      return ok ? { ok: true } : { ok: false };
    },
    saveDB: async (nextTable) => {
      saveDBCallCount++;
      operations.push("saveDB");
      savedTables.push(nextTable);
    },
    saveContextDB: async (nextTable, key) => {
      saveContextDBCallCount++;
      operations.push("saveContextDB");
      savedContexts.push({ key, table: nextTable });
    },
    contextKeyForTable: (tableName) => `contexts/${tableName}`,
    sessionEditedKeys,
    allOrNothing,
  });

  return {
    result,
    savedFrontmatter,
    savedTables,
    savedContexts,
    operations,
    saveFrontmatterCallCount,
    saveDBCallCount,
    saveContextDBCallCount,
  };
};

// ---------------------------------------------------------------------------
// Property invariant #7: empty batch identity
// ---------------------------------------------------------------------------
describe("empty batch identity", () => {
  it("returns an empty successful result for zero writes", async () => {
    const { result, savedFrontmatter, savedTables, savedContexts, operations } =
      await execute({ writes: [] });

    expect(result).toEqual({
      ok: true,
      applied: 0,
      skipped: [],
      failed: [],
    });
    expect(savedFrontmatter).toEqual([]);
    expect(savedTables).toEqual([]);
    expect(savedContexts).toEqual([]);
    expect(operations).toEqual([]);
  });

  it("emptyTableEditTransactionResult matches the empty-batch shape", () => {
    const empty = emptyTableEditTransactionResult();
    expect(empty.ok).toBe(true);
    expect(empty.applied).toBe(0);
    expect(empty.skipped).toEqual([]);
    expect(empty.failed).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Property invariant #1: transaction result accounting
// ---------------------------------------------------------------------------
describe("transaction result accounting", () => {
  it("applied + skipped + failed = total for a mixed batch", async () => {
    // Row 0 will succeed, row 99 (missing) will skip, row 1 will conflict
    const writes: TableCellWrite[] = [
      { rowId: "0", columnName: "status", table: "", value: "active" },
      { rowId: "99", columnName: "status", table: "", value: "fail" },
      {
        rowId: "1",
        columnName: "status",
        table: "",
        value: "new",
      },
    ];

    const { result } = await execute({
      writes,
      currentFrontmatterValues: {
        "Folder/Folder/B.md": { status: "external" },
      },
    });

    const total = writes.length;
    const accounted = result.applied + result.skipped.length + result.failed.length;
    expect(accounted).toBe(total);
  });

  it("ok is true iff failed.length === 0", async () => {
    // All succeed
    const { result: allOk } = await execute({
      writes: [{ rowId: "0", columnName: "local", table: "", value: "x" }],
    });
    expect(allOk.ok).toBe(true);
    expect(allOk.failed).toHaveLength(0);

    // Force a frontmatter failure
    const { result: withFail } = await execute({
      writes: [{ rowId: "0", columnName: "status", table: "", value: "x" }],
      frontmatterOk: false,
    });
    expect(withFail.ok).toBe(false);
    expect(withFail.failed.length).toBeGreaterThan(0);
  });

  it("accounting holds when combine merges multiple results", () => {
    const a: TableEditTransactionResult = {
      ok: true,
      applied: 3,
      skipped: [],
      failed: [],
    };
    const b: TableEditTransactionResult = {
      ok: false,
      applied: 1,
      skipped: [
        {
          reason: "missing-row",
          write: { rowId: "9", columnName: "x", table: "", value: "" },
        },
      ],
      failed: [
        {
          reason: "frontmatter-write-failed",
          write: { rowId: "0", columnName: "y", table: "", value: "" },
        },
      ],
    };

    const combined = combineTableEditTransactionResults(a, b);
    expect(combined.ok).toBe(false);
    expect(combined.applied).toBe(4);
    expect(combined.skipped).toHaveLength(1);
    expect(combined.failed).toHaveLength(1);
  });

  it("combineTableEditTransactionResults of zero results is empty-successful", () => {
    const combined = combineTableEditTransactionResults();
    expect(combined).toEqual({
      ok: true,
      applied: 0,
      skipped: [],
      failed: [],
    });
  });
});

// ---------------------------------------------------------------------------
// Property invariant #2: conflict detection idempotency
// ---------------------------------------------------------------------------
describe("conflict detection idempotency", () => {
  it("skips write when value matches the canonical frontmatter (no-op)", async () => {
    // The row says 'old'; canonical frontmatter also says 'old'; the write
    // wants to set 'old' — canonicalValue == baseValue so no conflict skip,
    // but the actual value does not change. The module still counts it as
    // applied (it can't distinguish a noop from a real change at this layer),
    // but the frontmatter write is issued with the same value.
    const { result, savedFrontmatter } = await execute({
      writes: [
        { rowId: "0", columnName: "status", table: "", value: "old" },
      ],
      currentFrontmatterValues: {
        "Folder/Folder/A.md": { status: "old" },
      },
    });

    expect(result.ok).toBe(true);
    expect(result.skipped).toHaveLength(0);
    // The frontmatter save is issued (the module does not short-circuit same-value)
    expect(savedFrontmatter).toHaveLength(1);
  });

  it("repeating the same conflict produces identical skip each time", async () => {
    const writes: TableCellWrite[] = [
      { rowId: "0", columnName: "status", table: "", value: "new" },
    ];
    const cfg = {
      currentFrontmatterValues: {
        "Folder/Folder/A.md": { status: "external" },
      },
    };

    const { result: r1 } = await execute({ writes, ...cfg });
    const { result: r2 } = await execute({ writes, ...cfg });

    expect(r1.skipped).toEqual(r2.skipped);
    expect(r1.applied).toEqual(r2.applied);
    expect(r1.ok).toEqual(r2.ok);
  });
});

// ---------------------------------------------------------------------------
// Property invariant #3: save-once-per-path
// ---------------------------------------------------------------------------
describe("save-once-per-path", () => {
  it("issues one saveFrontmatterProperties call per unique resolved path", async () => {
    // Two writes to the same row (same resolved path) should be batched into
    // a single saveFrontmatterProperties call.
    const { saveFrontmatterCallCount, savedFrontmatter } = await execute({
      writes: [
        { rowId: "0", columnName: "status", table: "", value: "active" },
        { rowId: "0", columnName: "rating", table: "", value: "5" },
      ],
    });

    expect(saveFrontmatterCallCount).toBe(1);
    expect(savedFrontmatter).toHaveLength(1);
    expect(savedFrontmatter[0].properties).toEqual({
      status: "active",
      rating: 5,
    });
  });

  it("issues separate saveFrontmatterProperties calls per distinct path", async () => {
    const { saveFrontmatterCallCount, savedFrontmatter } = await execute({
      writes: [
        { rowId: "0", columnName: "status", table: "", value: "x" },
        { rowId: "1", columnName: "status", table: "", value: "y" },
      ],
    });

    expect(saveFrontmatterCallCount).toBe(2);
    const paths = savedFrontmatter.map((f) => f.path);
    expect(new Set(paths).size).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Property invariant #4: field config ordering before frontmatter write
// ---------------------------------------------------------------------------
describe("field config ordering", () => {
  it("persists field config (saveDB) before frontmatter write when column is frontmatter-sourced", async () => {
    const { operations } = await execute({
      writes: [
        {
          rowId: "0",
          columnName: "status",
          table: "",
          value: "review",
          fieldValue: '{"options":[]}',
        },
      ],
    });

    // The first saveDB is the pre-save of field config; then frontmatter;
    // then final saveDB with the value applied.
    const firstSaveDB = operations.indexOf("saveDB");
    const firstFrontmatter = operations.indexOf("frontmatter");
    expect(firstSaveDB).toBeLessThan(firstFrontmatter);
  });

  it("persists field attrs before frontmatter write", async () => {
    const { operations } = await execute({
      writes: [
        {
          rowId: "1",
          columnName: "status",
          table: "",
          value: "review",
          fieldAttrs: '{"order":["a","b"]}',
        },
      ],
    });

    const firstSaveDB = operations.indexOf("saveDB");
    const firstFrontmatter = operations.indexOf("frontmatter");
    expect(firstSaveDB).toBeLessThan(firstFrontmatter);
  });
});

// ---------------------------------------------------------------------------
// Property invariant #5: linked context isolation
// ---------------------------------------------------------------------------
describe("linked context isolation", () => {
  it("skips cleanly when a linked context table is missing (no throw, no root corruption)", async () => {
    const { result, savedTables, savedContexts } = await execute({
      contexts: {}, // no context tables at all
      writes: [
        {
          rowId: "0",
          columnName: "phase",
          table: "projects",
          value: "build",
        },
      ],
    });

    expect(result.ok).toBe(true);
    expect(result.skipped).toEqual([
      expect.objectContaining({ reason: "missing-context-table" }),
    ]);
    expect(savedContexts).toEqual([]);
    // Root table should not be saved (no root writes)
    expect(savedTables).toEqual([]);
  });

  it("skips when a linked context row is missing but does not corrupt the root table", async () => {
    const ctx = contextTables();
    // Remove B.md from the context table rows
    ctx["contexts/projects"] = {
      ...ctx["contexts/projects"],
      rows: [ctx["contexts/projects"].rows[0]], // only A.md
    };

    const { result, savedContexts, savedTables } = await execute({
      contexts: ctx,
      writes: [
        {
          rowId: "1", // B.md — not in context
          columnName: "phase",
          table: "projects",
          value: "build",
        },
      ],
    });

    expect(result.ok).toBe(true);
    expect(result.skipped).toEqual([
      expect.objectContaining({ reason: "missing-context-row" }),
    ]);
    // Context should not be saved since the only write was skipped
    expect(savedContexts).toEqual([]);
    expect(savedTables).toEqual([]);
  });

  it("does not throw when multiple linked context tables are missing", async () => {
    const writes: TableCellWrite[] = [
      { rowId: "0", columnName: "x", table: "table_a", value: "1" },
      { rowId: "0", columnName: "y", table: "table_b", value: "2" },
      { rowId: "0", columnName: "z", table: "table_c", value: "3" },
    ];

    const { result } = await execute({ writes, contexts: {} });

    expect(result.ok).toBe(true);
    expect(result.skipped).toHaveLength(3);
    result.skipped.forEach((s) =>
      expect(s.reason).toBe("missing-context-table")
    );
  });
});

// ---------------------------------------------------------------------------
// Property invariant #6: row path override consistency
// ---------------------------------------------------------------------------
describe("row path override consistency after file rename", () => {
  it("subsequent property writes use the NEW path from applyTableEditPathOverrides", () => {
    const originalWrites: TableCellWrite[] = [
      { rowId: "0", columnName: "status", table: "", value: "active" },
      { rowId: "0", columnName: "rating", table: "", value: "5" },
      { rowId: "1", columnName: "status", table: "", value: "done" },
    ];

    const overridden = applyTableEditPathOverrides(
      originalWrites,
      new Map([["0", "Folder/Renamed.md"]])
    );

    // All writes for row 0 should have the new path
    expect(overridden[0].path).toBe("Folder/Renamed.md");
    expect(overridden[1].path).toBe("Folder/Renamed.md");
    // Row 1 is unaffected
    expect(overridden[2].path).toBeUndefined();
  });

  it("overridden path is used for frontmatter resolution", async () => {
    // Create a table where row 0 has been renamed
    const table: SpaceTable = {
      ...rootTable(),
      rows: [
        { [PathPropertyName]: "Folder/Renamed.md", status: "old" },
        rootTable().rows[1],
      ],
    };

    const overriddenWrites = applyTableEditPathOverrides(
      [{ rowId: "0", columnName: "status", table: "", value: "new" }],
      new Map([["0", "Folder/Renamed.md"]])
    );

    const { savedFrontmatter } = await execute({
      table,
      writes: overriddenWrites,
    });

    expect(savedFrontmatter).toHaveLength(1);
    expect(savedFrontmatter[0].path).toBe("Folder/Folder/Renamed.md");
  });
});

// ---------------------------------------------------------------------------
// resolveTableEditPath unit
// ---------------------------------------------------------------------------
describe("resolveTableEditPath", () => {
  it("prefers explicit path over row path", () => {
    expect(resolveTableEditPath("explicit.md", "row.md")).toBe("explicit.md");
  });

  it("falls back to row path when explicit is null", () => {
    expect(resolveTableEditPath(null, "row.md")).toBe("row.md");
  });

  it("falls back to row path when explicit is empty string", () => {
    expect(resolveTableEditPath("", "row.md")).toBe("row.md");
  });

  it("falls back to row path when explicit is whitespace", () => {
    expect(resolveTableEditPath("   ", "row.md")).toBe("row.md");
  });

  it("returns undefined when both are missing", () => {
    expect(resolveTableEditPath(undefined, undefined)).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Adversarial: same-cell batch (multiple writes to the same cell)
// ---------------------------------------------------------------------------
describe("adversarial: same-cell batch", () => {
  it("last-write-wins for frontmatter columns in the same batch", async () => {
    const { result, savedFrontmatter, savedTables } = await execute({
      writes: [
        { rowId: "0", columnName: "status", table: "", value: "first" },
        { rowId: "0", columnName: "status", table: "", value: "second" },
        { rowId: "0", columnName: "status", table: "", value: "third" },
      ],
    });

    expect(result.ok).toBe(true);
    // All three are accepted (the module applies them all)
    expect(result.applied).toBe(3);
    // The frontmatter save has the last value because Map accumulation overwrites
    expect(savedFrontmatter).toHaveLength(1);
    expect(savedFrontmatter[0].properties.status).toBe("third");
    // The saved table row should have the last value via reduce
    expect(savedTables[0].rows[0].status).toBe("third");
  });

  it("last-write-wins for local (non-frontmatter) columns in the same batch", async () => {
    const { result, savedTables } = await execute({
      writes: [
        { rowId: "1", columnName: "local", table: "", value: "a" },
        { rowId: "1", columnName: "local", table: "", value: "b" },
      ],
    });

    expect(result.ok).toBe(true);
    expect(savedTables[0].rows[1].local).toBe("b");
  });
});

// ---------------------------------------------------------------------------
// Adversarial: missing rows
// ---------------------------------------------------------------------------
describe("adversarial: missing rows", () => {
  it("skips all writes to non-existent rows", async () => {
    const writes: TableCellWrite[] = [
      { rowId: "50", columnName: "status", table: "", value: "x" },
      { rowId: "999", columnName: "status", table: "", value: "y" },
      { rowId: "-1", columnName: "status", table: "", value: "z" },
    ];

    const { result, savedTables, savedFrontmatter } = await execute({ writes });

    expect(result.ok).toBe(true);
    expect(result.applied).toBe(0);
    expect(result.skipped).toHaveLength(3);
    result.skipped.forEach((s) => expect(s.reason).toBe("missing-row"));
    expect(savedTables).toEqual([]);
    expect(savedFrontmatter).toEqual([]);
  });

  it("processes valid writes even when some are to missing rows", async () => {
    const writes: TableCellWrite[] = [
      { rowId: "0", columnName: "local", table: "", value: "ok" },
      { rowId: "100", columnName: "local", table: "", value: "miss" },
    ];

    const { result, savedTables } = await execute({ writes });

    expect(result.ok).toBe(true);
    expect(result.applied).toBe(1);
    expect(result.skipped).toHaveLength(1);
    expect(savedTables).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Adversarial: mixed authority writes (root + linked context + frontmatter)
// ---------------------------------------------------------------------------
describe("adversarial: mixed authority writes", () => {
  it("handles root, frontmatter, and linked context writes in one batch", async () => {
    const { result, savedFrontmatter, savedTables, savedContexts } =
      await execute({
        contexts: contextTables(),
        writes: [
          // Root + frontmatter write
          { rowId: "0", columnName: "status", table: "", value: "active" },
          // Root-only (local) write
          { rowId: "1", columnName: "local", table: "", value: "manual" },
          // Linked context write
          {
            rowId: "0",
            columnName: "phase",
            table: "projects",
            value: "build",
          },
        ],
      });

    expect(result.ok).toBe(true);
    // Root frontmatter + root local + linked context
    expect(result.applied).toBe(3);
    expect(savedFrontmatter).toHaveLength(1);
    expect(savedTables).toHaveLength(1);
    expect(savedContexts).toHaveLength(1);
    expect(savedContexts[0].table.rows[0].phase).toBe("build");
    expect(savedTables[0].rows[0].status).toBe("active");
    expect(savedTables[0].rows[1].local).toBe("manual");
  });
});

// ---------------------------------------------------------------------------
// Adversarial: universal conflict (every write conflicts)
// ---------------------------------------------------------------------------
describe("adversarial: universal conflict", () => {
  it("skips all writes when every frontmatter value conflicts", async () => {
    const { result, savedFrontmatter, savedTables } = await execute({
      currentFrontmatterValues: {
        "Folder/Folder/A.md": { status: "ext-a" },
        "Folder/Folder/B.md": { status: "ext-b" },
      },
      writes: [
        { rowId: "0", columnName: "status", table: "", value: "new-a" },
        { rowId: "1", columnName: "status", table: "", value: "new-b" },
      ],
    });

    expect(result.ok).toBe(true); // no *failed*, just skipped
    expect(result.applied).toBe(0);
    expect(result.skipped).toHaveLength(2);
    result.skipped.forEach((s) =>
      expect(s.reason).toBe("frontmatter-conflict")
    );
    expect(savedFrontmatter).toEqual([]);
    expect(savedTables).toEqual([]);
  });

  it("allOrNothing aborts on universal conflict with ok=false", async () => {
    const { result, savedFrontmatter, savedTables } = await execute({
      allOrNothing: true,
      currentFrontmatterValues: {
        "Folder/Folder/A.md": { status: "ext-a" },
        "Folder/Folder/B.md": { status: "ext-b" },
      },
      writes: [
        { rowId: "0", columnName: "status", table: "", value: "new-a" },
        { rowId: "1", columnName: "status", table: "", value: "new-b" },
      ],
    });

    expect(result.ok).toBe(false);
    expect(result.applied).toBe(0);
    expect(savedFrontmatter).toEqual([]);
    expect(savedTables).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Adversarial: undefined/empty columnId
// ---------------------------------------------------------------------------
describe("adversarial: undefined/null/empty columnId", () => {
  it("falls back to columnName when columnId is undefined", async () => {
    const { result, savedTables } = await execute({
      writes: [
        {
          rowId: "0",
          columnId: undefined,
          columnName: "local",
          table: "",
          value: "val",
        },
      ],
    });

    expect(result.ok).toBe(true);
    expect(result.applied).toBe(1);
    expect(savedTables[0].rows[0].local).toBe("val");
  });

  it("works with empty string columnId", async () => {
    const { result, savedTables } = await execute({
      writes: [
        {
          rowId: "0",
          columnId: "",
          columnName: "local",
          table: "",
          value: "val",
        },
      ],
    });

    expect(result.ok).toBe(true);
    expect(result.applied).toBe(1);
  });

  it("columnForWrite resolves via columnName when columnId does not match any column", async () => {
    const { result } = await execute({
      writes: [
        {
          rowId: "0",
          columnId: "nonexistent_id",
          columnName: "status",
          table: "",
          value: "ok",
        },
      ],
    });

    // The write proceeds because columnForWrite finds the column by name
    expect(result.ok).toBe(true);
    expect(result.applied).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Adversarial: large batch (100+ writes) — no quadratic blowup
// ---------------------------------------------------------------------------
describe("adversarial: large batch", () => {
  it("handles 200 writes to distinct rows without quadratic blowup", async () => {
    const rowCount = 200;
    const table: SpaceTable = {
      schema: { id: defaultContextSchemaID, name: "Context", type: "context" },
      cols: [
        { name: PathPropertyName, type: "file" },
        { name: "val", type: "text" },
      ],
      rows: Array.from({ length: rowCount }, (_, i) => ({
        [PathPropertyName]: `Folder/Row${i}.md`,
        val: "init",
      })),
    };

    const writes: TableCellWrite[] = Array.from({ length: rowCount }, (_, i) => ({
      rowId: String(i),
      columnName: "val",
      table: "",
      value: `updated-${i}`,
    }));

    const start = Date.now();
    const { result, savedTables } = await execute({ writes, table });
    const elapsed = Date.now() - start;

    expect(result.ok).toBe(true);
    expect(result.applied).toBe(rowCount);
    expect(savedTables).toHaveLength(1);
    // Verify first and last rows
    expect(savedTables[0].rows[0].val).toBe("updated-0");
    expect(savedTables[0].rows[rowCount - 1].val).toBe(`updated-${rowCount - 1}`);
    // Sanity: should complete well under 5 seconds even on slow CI
    expect(elapsed).toBeLessThan(5000);
  });

  it("handles 100 frontmatter writes to distinct paths", async () => {
    const rowCount = 100;
    const table: SpaceTable = {
      schema: { id: defaultContextSchemaID, name: "Context", type: "context" },
      cols: [
        { name: PathPropertyName, type: "file" },
        { name: "status", type: "text", source: "frontmatter" },
      ],
      rows: Array.from({ length: rowCount }, (_, i) => ({
        [PathPropertyName]: `Folder/Row${i}.md`,
        status: "init",
      })),
    };

    const writes: TableCellWrite[] = Array.from({ length: rowCount }, (_, i) => ({
      rowId: String(i),
      columnName: "status",
      table: "",
      value: `done-${i}`,
    }));

    const start = Date.now();
    const { result, saveFrontmatterCallCount } = await execute({
      writes,
      table,
    });
    const elapsed = Date.now() - start;

    expect(result.ok).toBe(true);
    expect(result.applied).toBe(rowCount);
    // One saveFrontmatterProperties call per unique path
    expect(saveFrontmatterCallCount).toBe(rowCount);
    expect(elapsed).toBeLessThan(5000);
  });

  it("handles 100 writes to the SAME row without blowup", async () => {
    const writes: TableCellWrite[] = Array.from({ length: 100 }, (_, i) => ({
      rowId: "0",
      columnName: "local",
      table: "",
      value: `v${i}`,
    }));

    const start = Date.now();
    const { result, savedTables } = await execute({ writes });
    const elapsed = Date.now() - start;

    expect(result.ok).toBe(true);
    expect(result.applied).toBe(100);
    // Last write wins
    expect(savedTables[0].rows[0].local).toBe("v99");
    expect(elapsed).toBeLessThan(5000);
  });
});

// ---------------------------------------------------------------------------
// Adversarial: clear writes
// ---------------------------------------------------------------------------
describe("adversarial: clear writes", () => {
  it("clear=true causes null to be written to frontmatter", async () => {
    const { result, savedFrontmatter } = await execute({
      writes: [
        {
          rowId: "0",
          columnName: "status",
          table: "",
          value: "",
          clear: true,
        },
      ],
    });

    expect(result.ok).toBe(true);
    expect(savedFrontmatter[0].properties.status).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Adversarial: allOrNothing mode with mixed outcomes
// ---------------------------------------------------------------------------
describe("adversarial: allOrNothing", () => {
  it("aborts entire batch when allOrNothing is true and one write has missing row", async () => {
    const { result, savedTables, savedFrontmatter } = await execute({
      allOrNothing: true,
      writes: [
        { rowId: "0", columnName: "local", table: "", value: "good" },
        { rowId: "999", columnName: "local", table: "", value: "bad" },
      ],
    });

    // missing-row is a skip; allOrNothing treats skips as abort
    expect(result.ok).toBe(false);
    expect(result.applied).toBe(0);
    expect(savedTables).toEqual([]);
    expect(savedFrontmatter).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Adversarial: writes to columns that do not exist in the schema
// ---------------------------------------------------------------------------
describe("adversarial: unknown column writes", () => {
  it("applies writes to columns not in the schema without error", async () => {
    // The module does not validate column existence for non-frontmatter writes;
    // it just applies the value to the row.
    const { result, savedTables } = await execute({
      writes: [
        {
          rowId: "0",
          columnName: "nonexistent_col",
          table: "",
          value: "phantom",
        },
      ],
    });

    expect(result.ok).toBe(true);
    expect(result.applied).toBe(1);
    expect(savedTables[0].rows[0].nonexistent_col).toBe("phantom");
  });
});

// ---------------------------------------------------------------------------
// Adversarial: sessionEditedKeys interaction with multiple cells
// ---------------------------------------------------------------------------
describe("adversarial: sessionEditedKeys multi-cell", () => {
  it("tracks each cell independently in sessionEditedKeys", async () => {
    const sessionEditedKeys = new Set<string>();

    // First batch: write status on row 0 and rating on row 1
    await execute({
      sessionEditedKeys,
      writes: [
        { rowId: "0", columnName: "status", table: "", value: "done" },
        { rowId: "1", columnName: "rating", table: "", value: "5" },
      ],
    });

    // sessionEditedKeys should have 2 entries
    expect(sessionEditedKeys.size).toBe(2);

    // Second batch with lagging canonical values: status on row 0 should
    // pass (we wrote it), but status on row 1 (never written) should conflict
    const table = rootTable();
    table.rows[0].status = "done";
    table.rows[1].rating = "5";

    const { result } = await execute({
      table,
      sessionEditedKeys,
      currentFrontmatterValues: {
        "Folder/Folder/A.md": { status: "lagging-old" }, // lag on our write
        "Folder/Folder/B.md": { status: "external" }, // genuine external change
      },
      writes: [
        { rowId: "0", columnName: "status", table: "", value: "re-edit" },
        { rowId: "1", columnName: "status", table: "", value: "attempted" },
      ],
    });

    // Row 0 status: we wrote it before, so lag is forgiven
    // Row 1 status: never written, external change = conflict
    expect(result.applied).toBe(1);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0].reason).toBe("frontmatter-conflict");
    expect(result.skipped[0].write.rowId).toBe("1");
  });
});

// ---------------------------------------------------------------------------
// Adversarial: sessionEditedKeys rollback on mid-batch frontmatter failure
// (Notidian-cytg)
// ---------------------------------------------------------------------------
describe("adversarial: sessionEditedKeys rollback on frontmatter commit failure", () => {
  it("only rolls back the failed path's key, leaving a sibling path's successful mark intact", async () => {
    const sessionEditedKeys = new Set<string>();

    // Same batch writes status to both A (succeeds) and B (frontmatter
    // commit rejects). Only B's speculative self-edited mark must be rolled
    // back; A's must survive since A's write actually landed.
    const { result } = await execute({
      sessionEditedKeys,
      frontmatterFailPaths: ["Folder/Folder/B.md"],
      writes: [
        { rowId: "0", columnName: "status", table: "", value: "done" },
        { rowId: "1", columnName: "status", table: "", value: "done" },
      ],
    });

    expect(result.ok).toBe(false);
    expect(result.applied).toBe(1);
    expect(result.failed).toEqual([
      {
        reason: "frontmatter-write-failed",
        write: expect.objectContaining({ rowId: "1" }),
      },
    ]);
    expect(sessionEditedKeys.has("Folder/Folder/A.md\0status")).toBe(true);
    expect(sessionEditedKeys.has("Folder/Folder/B.md\0status")).toBe(false);
  });

  it("does not let a failed write's leftover self-edited mark bypass the conflict gate on retry", async () => {
    const sessionEditedKeys = new Set<string>();

    // Attempt #1: no conflict (canonical == base), but the frontmatter commit
    // rejects.
    const first = await execute({
      sessionEditedKeys,
      currentFrontmatterValues: {
        "Folder/Folder/A.md": { status: "old" },
      },
      frontmatterFailPaths: ["Folder/Folder/A.md"],
      writes: [{ rowId: "0", columnName: "status", table: "", value: "active" }],
    });

    expect(first.result.ok).toBe(false);
    expect(sessionEditedKeys.size).toBe(0);

    // Retry after an out-of-band external change: the conflict gate must
    // fire since the row was never actually marked self-edited.
    const retry = await execute({
      sessionEditedKeys,
      currentFrontmatterValues: {
        "Folder/Folder/A.md": { status: "external" },
      },
      writes: [{ rowId: "0", columnName: "status", table: "", value: "active" }],
    });

    expect(retry.result.ok).toBe(true);
    expect(retry.result.applied).toBe(0);
    expect(retry.result.skipped).toEqual([
      expect.objectContaining({
        reason: "frontmatter-conflict",
        currentValue: "external",
        baseValue: "old",
      }),
    ]);
    expect(retry.savedFrontmatter).toEqual([]);
  });

  it("rolls back a newly-marked key when the whole batch aborts BEFORE any commit is attempted (allOrNothing early return)", async () => {
    // Row A has no conflict and gets speculatively marked self-edited by the
    // classification loop. Row B genuinely conflicts, and since this batch is
    // allOrNothing, the function returns ok:false/applied:0 at the early-return
    // guard — BEFORE saveFrontmatterProperties is ever called for ANY path, not
    // just B's. Row A's mark must not survive: nothing committed to disk for it
    // either, so leaving the mark in place would let a later, unrelated write to
    // the same cell skip the stale-conflict gate for an edit that never landed.
    const sessionEditedKeys = new Set<string>();

    const { result, savedFrontmatter } = await execute({
      allOrNothing: true,
      sessionEditedKeys,
      currentFrontmatterValues: {
        // Row A: no entry, so canonicalValue is undefined and the write is
        // accepted without a conflict check.
        "Folder/Folder/B.md": { status: "external" },
      },
      writes: [
        { rowId: "0", columnName: "status", table: "", value: "done" },
        { rowId: "1", columnName: "status", table: "", value: "done" },
      ],
    });

    expect(result.ok).toBe(false);
    expect(result.applied).toBe(0);
    expect(result.failed).toEqual([]);
    expect(result.skipped).toEqual([
      expect.objectContaining({ reason: "frontmatter-conflict", write: expect.objectContaining({ rowId: "1" }) }),
    ]);
    // The early return fires before the per-path commit loop, so nothing was
    // ever attempted on disk.
    expect(savedFrontmatter).toEqual([]);
    // Row A's speculative mark must be rolled back: it was newly introduced by
    // this aborted call and nothing committed for it.
    expect(sessionEditedKeys.has("Folder/Folder/A.md\0status")).toBe(false);
    expect(sessionEditedKeys.size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Adversarial: context field config without row write
// ---------------------------------------------------------------------------
describe("adversarial: field config without value change", () => {
  it("persists field config even with no row value change", async () => {
    const { result, savedTables } = await execute({
      writes: [
        {
          rowId: "0",
          columnName: "local",
          table: "",
          value: "init", // same value the row already has
          fieldValue: '{"options":[{"name":"new","value":"new"}]}',
        },
      ],
    });

    expect(result.ok).toBe(true);
    const localCol = savedTables[0].cols.find((c) => c.name === "local");
    expect(localCol?.value).toBe(
      '{"options":[{"name":"new","value":"new"}]}'
    );
  });
});

// ---------------------------------------------------------------------------
// Adversarial: forceFrontmatterWrite bypasses conflict on every row
// ---------------------------------------------------------------------------
describe("adversarial: forceFrontmatterWrite bulk", () => {
  it("bypasses conflict on all rows when forceFrontmatterWrite is set", async () => {
    const { result, savedFrontmatter } = await execute({
      currentFrontmatterValues: {
        "Folder/Folder/A.md": { status: "ext-a" },
        "Folder/Folder/B.md": { status: "ext-b" },
      },
      writes: [
        {
          rowId: "0",
          columnName: "status",
          table: "",
          value: "force-a",
          forceFrontmatterWrite: true,
        },
        {
          rowId: "1",
          columnName: "status",
          table: "",
          value: "force-b",
          forceFrontmatterWrite: true,
        },
      ],
    });

    expect(result.ok).toBe(true);
    expect(result.applied).toBe(2);
    expect(result.skipped).toHaveLength(0);
    expect(savedFrontmatter).toHaveLength(2);
  });
});
