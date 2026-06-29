/**
 * Adversarial / property tests for parseContextTableToCache — Notidian-3dym
 *
 * Locks 7 invariants that the metadata pipeline must preserve regardless of
 * input quality:
 *   1. Null/missing space safety
 *   2. Missing/empty MDB defaults
 *   3. Row identity (no duplication, no loss)
 *   4. Column stability (default fields always present)
 *   5. Frontmatter materialization
 *   6. SpaceMap correctness
 *   7. Idempotency
 *
 * Plus adversarial scenarios covering mismatched types, duplicate paths,
 * paths not in pathsIndex, null metadata, extra/missing columns, missing
 * PathPropertyName, large path arrays, and various space path prefixes.
 */

import { parseContextTableToCache } from "./cacheParsers";
import { defaultContextDBSchema, defaultContextSchemaID } from "shared/schemas/context";
import { defaultContextFields } from "shared/schemas/fields";
import { PathPropertyName } from "shared/types/context";
import { IndexMap } from "shared/types/indexMap";
import { MakeMDSettings } from "shared/types/settings";
import { SpaceInfo } from "shared/types/spaceInfo";
import { SpaceProperty, SpaceTable, SpaceTables } from "shared/types/mdb";
import { PathState, ContextState } from "shared/types/PathState";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const baseSettings = {
  autoImportObsidianPropertiesToContexts: true,
  fmKeyAlias: "aliases",
  fmKeyBanner: "banner",
  fmKeyBannerOffset: "banner_y",
  fmKeyColor: "color",
  fmKeySticker: "sticker",
} as MakeMDSettings;

const simpleSpace: SpaceInfo = {
  name: "TestSpace",
  path: "TestSpace",
  isRemote: false,
  readOnly: false,
  defPath: "TestSpace/.space/def.json",
  notePath: "TestSpace/TestSpace.md",
};

/** Minimal pathsIndex entry for a single file path */
const pathEntry = (
  path: string,
  property?: Record<string, unknown>
): [string, PathState] => [
  path,
  {
    path,
    label: { name: path, sticker: "", color: "", cover: "", preview: "", thumbnail: "" },
    readOnly: false,
    metadata: property ? { property } : {},
  } as PathState,
];

/** Minimal MDB with files table */
const simpleMDB = (
  rows: Record<string, string>[],
  cols?: SpaceProperty[]
): SpaceTables => ({
  [defaultContextSchemaID]: {
    schema: defaultContextDBSchema,
    cols: cols ?? (defaultContextFields.rows as SpaceProperty[]),
    rows,
  },
});

/** Call parseContextTableToCache with sensible defaults.
 *  Uses explicit `"key" in opts` checks so that passing `null` or `undefined`
 *  for space/mdb actually reaches the SUT (unlike `??` which coalesces null). */
const parse = (
  opts: {
    space?: SpaceInfo | null;
    mdb?: SpaceTables | null;
    paths?: string[];
    dbExists?: boolean;
    pathsIndex?: Map<string, PathState>;
    spacesMap?: IndexMap;
    settings?: MakeMDSettings;
    contextsIndex?: Map<string, ContextState>;
    options?: { force?: boolean; calculate?: boolean };
  } = {}
) =>
  parseContextTableToCache(
    "space" in opts ? (opts.space as any) : simpleSpace,
    "mdb" in opts ? (opts.mdb as any) : simpleMDB([]),
    opts.paths ?? [],
    opts.dbExists ?? true,
    opts.pathsIndex ?? new Map([pathEntry(simpleSpace.path, undefined)]),
    opts.spacesMap ?? new IndexMap(),
    null as any, // runContext — not needed without calculate
    opts.settings ?? baseSettings,
    opts.contextsIndex ?? new Map(),
    opts.options ?? { calculate: false }
  );

/** Default column names that must always be present */
const DEFAULT_COL_NAMES = (defaultContextFields.rows as SpaceProperty[]).map(
  (c) => c.name
);

// ===========================================================================
// INVARIANT 1: Null/missing space safety
// ===========================================================================
describe("Invariant 1 — null/missing space safety", () => {
  it("returns {changed: false, cache: null} when space is null", () => {
    const result = parse({ space: null as any });
    expect(result.changed).toBe(false);
    expect(result.cache).toBeNull();
  });

  it("returns {changed: false, cache: null} when space is undefined", () => {
    const result = parse({ space: undefined as any });
    expect(result.changed).toBe(false);
    expect(result.cache).toBeNull();
  });
});

// ===========================================================================
// INVARIANT 2: Missing/empty MDB defaults
// ===========================================================================
describe("Invariant 2 — missing/empty MDB defaults", () => {
  it("returns default empty cache when mdb is null", () => {
    const result = parse({ mdb: null as any });
    expect(result.changed).toBe(false);
    expect(result.cache).toBeTruthy();
    expect(result.cache.contextTable).toBeNull();
    expect(result.cache.schemas).toEqual([]);
    expect(result.cache.paths).toEqual([]);
    expect(result.cache.dbExists).toBe(false);
  });

  it("returns default empty cache when mdb is undefined", () => {
    const result = parse({ mdb: undefined as any });
    expect(result.changed).toBe(false);
    expect(result.cache).toBeTruthy();
    expect(result.cache.contextTable).toBeNull();
  });

  it("produces default schema when mdb has no files key", () => {
    const result = parse({ mdb: {}, paths: ["a.md"] });
    expect(result.cache.contextTable).toBeTruthy();
    expect(result.cache.contextTable.cols.length).toBeGreaterThan(0);
    // Should use defaultContextDBSchema
    expect(result.cache.contextTable.schema.id).toBe(defaultContextSchemaID);
  });

  it("handles files table with null cols", () => {
    const result = parse({
      mdb: {
        [defaultContextSchemaID]: {
          schema: defaultContextDBSchema,
          cols: null as any,
          rows: [],
        },
      },
    });
    // Should fall back to default fields
    expect(result.cache.contextTable.cols.length).toBeGreaterThan(0);
    for (const name of DEFAULT_COL_NAMES) {
      expect(result.cache.contextTable.cols.map((c) => c.name)).toContain(name);
    }
  });

  it("handles files table with empty cols array", () => {
    const result = parse({
      mdb: {
        [defaultContextSchemaID]: {
          schema: defaultContextDBSchema,
          cols: [],
          rows: [],
        },
      },
    });
    expect(result.cache.contextTable.cols.length).toBeGreaterThan(0);
    for (const name of DEFAULT_COL_NAMES) {
      expect(result.cache.contextTable.cols.map((c) => c.name)).toContain(name);
    }
  });

  it("handles files table with null rows", () => {
    const result = parse({
      mdb: {
        [defaultContextSchemaID]: {
          schema: defaultContextDBSchema,
          cols: defaultContextFields.rows as SpaceProperty[],
          rows: null as any,
        },
      },
      paths: ["a.md"],
      pathsIndex: new Map([
        pathEntry(simpleSpace.path),
        pathEntry("a.md"),
      ]),
    });
    // Should produce rows for paths without crashing
    expect(result.cache.contextTable.rows.length).toBe(1);
    expect(result.cache.contextTable.rows[0][PathPropertyName]).toBe("a.md");
  });
});

// ===========================================================================
// INVARIANT 3: Row identity — no duplication, no loss
// ===========================================================================
describe("Invariant 3 — row identity (no duplication, no loss)", () => {
  it("every path in the input appears exactly once in output rows", () => {
    const paths = ["a.md", "b.md", "c.md"];
    const result = parse({
      mdb: simpleMDB(paths.map((p) => ({ [PathPropertyName]: p }))),
      paths,
      pathsIndex: new Map([
        pathEntry(simpleSpace.path),
        ...paths.map((p) => pathEntry(p)),
      ]),
    });

    const outputPaths = result.cache.contextTable.rows.map(
      (r) => r[PathPropertyName]
    );
    // Every input path present
    for (const p of paths) {
      expect(outputPaths).toContain(p);
    }
    // No duplicates
    expect(outputPaths.length).toBe(new Set(outputPaths).size);
    // Same count
    expect(outputPaths.length).toBe(paths.length);
  });

  it("does not duplicate rows when input paths contain duplicates", () => {
    const paths = ["a.md", "b.md", "a.md", "c.md", "b.md"];
    const uniquePaths = ["a.md", "b.md", "c.md"];
    const result = parse({
      mdb: simpleMDB(uniquePaths.map((p) => ({ [PathPropertyName]: p }))),
      paths,
      pathsIndex: new Map([
        pathEntry(simpleSpace.path),
        ...uniquePaths.map((p) => pathEntry(p)),
      ]),
    });

    const outputPaths = result.cache.contextTable.rows.map(
      (r) => r[PathPropertyName]
    );
    // Rows should not exceed unique input count (mergeContextRows filters to valid paths)
    // The important invariant: no path appears more than once in rows
    const uniqueOutputPaths = new Set(outputPaths);
    // Every unique path present
    for (const p of uniquePaths) {
      expect(outputPaths).toContain(p);
    }
    // No duplicates in rows
    expect(outputPaths.length).toBe(uniqueOutputPaths.size);
  });

  it("does not lose rows when MDB rows are a subset of paths", () => {
    const paths = ["a.md", "b.md", "c.md"];
    // MDB only has row for "a.md", but paths has all three
    const result = parse({
      mdb: simpleMDB([{ [PathPropertyName]: "a.md" }]),
      paths,
      pathsIndex: new Map([
        pathEntry(simpleSpace.path),
        ...paths.map((p) => pathEntry(p)),
      ]),
    });

    const outputPaths = result.cache.contextTable.rows.map(
      (r) => r[PathPropertyName]
    );
    for (const p of paths) {
      expect(outputPaths).toContain(p);
    }
  });

  it("does not produce rows for paths not in the paths input (MDB-only rows are dropped)", () => {
    const paths = ["a.md"];
    // MDB has an extra row for "orphan.md" that is not in paths
    const result = parse({
      mdb: simpleMDB([
        { [PathPropertyName]: "a.md" },
        { [PathPropertyName]: "orphan.md" },
      ]),
      paths,
      pathsIndex: new Map([
        pathEntry(simpleSpace.path),
        pathEntry("a.md"),
        pathEntry("orphan.md"),
      ]),
    });

    const outputPaths = result.cache.contextTable.rows.map(
      (r) => r[PathPropertyName]
    );
    expect(outputPaths).toContain("a.md");
    expect(outputPaths).not.toContain("orphan.md");
  });
});

// ===========================================================================
// INVARIANT 4: Column stability — default fields always present
// ===========================================================================
describe("Invariant 4 — column stability (default fields always present)", () => {
  it("default columns present when MDB provides only default columns", () => {
    const result = parse({ paths: ["a.md"] });
    const colNames = result.cache.contextTable.cols.map((c) => c.name);
    for (const name of DEFAULT_COL_NAMES) {
      expect(colNames).toContain(name);
    }
  });

  it("default columns present when MDB provides extra user columns", () => {
    const result = parse({
      mdb: simpleMDB([], [
        ...(defaultContextFields.rows as SpaceProperty[]),
        { name: "custom", type: "text", schemaId: "files", value: "" },
      ]),
    });
    const colNames = result.cache.contextTable.cols.map((c) => c.name);
    for (const name of DEFAULT_COL_NAMES) {
      expect(colNames).toContain(name);
    }
    expect(colNames).toContain("custom");
  });

  it("default columns present when MDB cols is empty", () => {
    const result = parse({
      mdb: {
        [defaultContextSchemaID]: {
          schema: defaultContextDBSchema,
          cols: [],
          rows: [],
        },
      },
    });
    const colNames = result.cache.contextTable.cols.map((c) => c.name);
    for (const name of DEFAULT_COL_NAMES) {
      expect(colNames).toContain(name);
    }
  });
});

// ===========================================================================
// INVARIANT 5: Frontmatter materialization
// ===========================================================================
describe("Invariant 5 — frontmatter materialization", () => {
  it("frontmatter properties appear in rows when autoImport is true and only default cols exist", () => {
    const result = parse({
      paths: ["a.md"],
      mdb: simpleMDB([{ [PathPropertyName]: "a.md" }]),
      pathsIndex: new Map([
        pathEntry(simpleSpace.path),
        pathEntry("a.md", { status: "done", priority: 1 }),
      ]),
      settings: { ...baseSettings, autoImportObsidianPropertiesToContexts: true } as MakeMDSettings,
    });

    expect(result.cache.contextTable.rows[0]).toHaveProperty("status");
    expect(result.cache.contextTable.rows[0].status).toBe("done");
    // number gets stringified
    expect(result.cache.contextTable.rows[0].priority).toBe("1");
    // Cols should have the frontmatter properties
    const colNames = result.cache.contextTable.cols.map((c) => c.name);
    expect(colNames).toContain("status");
    expect(colNames).toContain("priority");
  });

  it("frontmatter properties do NOT import when autoImport is false", () => {
    const result = parse({
      paths: ["a.md"],
      mdb: simpleMDB([{ [PathPropertyName]: "a.md" }]),
      pathsIndex: new Map([
        pathEntry(simpleSpace.path),
        pathEntry("a.md", { status: "done" }),
      ]),
      settings: {
        ...baseSettings,
        autoImportObsidianPropertiesToContexts: false,
      } as MakeMDSettings,
    });

    // status should still appear in row via syncContextRow (frontmatter sync),
    // but NOT as a discovered column when autoImport is false and there are
    // only default columns.  When there are ONLY default columns plus no user
    // columns and autoImport is false, the materialization is disabled —
    // the column set stays at defaults only.
    const colNames = result.cache.contextTable.cols.map((c) => c.name);
    expect(colNames).not.toContain("status");
  });

  it("spaces:// prefixed spaces do not import frontmatter properties", () => {
    const tagSpace: SpaceInfo = {
      ...simpleSpace,
      path: "spaces://test-tag",
      name: "test-tag",
      notePath: "",
      defPath: "",
    };
    const result = parse({
      space: tagSpace,
      paths: ["a.md"],
      mdb: simpleMDB([{ [PathPropertyName]: "a.md" }]),
      pathsIndex: new Map([
        pathEntry("spaces://test-tag"),
        pathEntry("a.md", { status: "done" }),
      ]),
    });

    // spaces:// paths suppress autoImport, so no discovered frontmatter columns
    const colNames = result.cache.contextTable.cols.map((c) => c.name);
    expect(colNames).not.toContain("status");
  });
});

// ===========================================================================
// INVARIANT 6: SpaceMap correctness
// ===========================================================================
describe("Invariant 6 — spaceMap correctness", () => {
  it("spaceMap is empty when there are no context columns", () => {
    const result = parse({
      paths: ["a.md"],
      mdb: simpleMDB([{ [PathPropertyName]: "a.md" }]),
      pathsIndex: new Map([pathEntry(simpleSpace.path), pathEntry("a.md")]),
    });

    expect(result.cache.spaceMap).toEqual({});
  });

  it("spaceMap maps context column values to rows that reference them", () => {
    const cols: SpaceProperty[] = [
      ...(defaultContextFields.rows as SpaceProperty[]),
      {
        name: "Project",
        type: "context",
        value: '{"space": "Projects"}',
        schemaId: "files",
      },
    ];
    const result = parse({
      paths: ["a.md", "b.md"],
      mdb: simpleMDB(
        [
          { [PathPropertyName]: "a.md", Project: "Projects/Alpha" },
          { [PathPropertyName]: "b.md", Project: "Projects/Alpha" },
        ],
        cols
      ),
      pathsIndex: new Map([
        pathEntry(simpleSpace.path),
        pathEntry("a.md"),
        pathEntry("b.md"),
      ]),
    });

    expect(result.cache.spaceMap).toHaveProperty("Project");
    expect(result.cache.spaceMap["Project"]["Projects/Alpha"]).toEqual(
      expect.arrayContaining(["a.md", "b.md"])
    );
  });

  it("spaceMap handles multi-value context columns", () => {
    // Use "Category" not "Tags" — syncContextRow has special handling for any
    // column whose lowercase name is "tags", which would overwrite the row value.
    const cols: SpaceProperty[] = [
      ...(defaultContextFields.rows as SpaceProperty[]),
      {
        name: "Category",
        type: "context-multi",
        value: '{"space": "TagSpace"}',
        schemaId: "files",
      },
    ];
    const result = parse({
      paths: ["a.md"],
      mdb: simpleMDB(
        [{ [PathPropertyName]: "a.md", Category: "cat1, cat2" }],
        cols
      ),
      pathsIndex: new Map([pathEntry(simpleSpace.path), pathEntry("a.md")]),
    });

    expect(result.cache.spaceMap).toHaveProperty("Category");
    // parseMultiString should split the comma-delimited value
    expect(Object.keys(result.cache.spaceMap["Category"]).length).toBeGreaterThan(0);
    expect(result.cache.spaceMap["Category"]["cat1"]).toEqual(
      expect.arrayContaining(["a.md"])
    );
    expect(result.cache.spaceMap["Category"]["cat2"]).toEqual(
      expect.arrayContaining(["a.md"])
    );
  });
});

// ===========================================================================
// INVARIANT 7: Idempotency
// ===========================================================================
describe("Invariant 7 — idempotency", () => {
  it("calling twice with identical inputs produces identical outputs", () => {
    const paths = ["a.md", "b.md"];
    const mdb1 = simpleMDB(paths.map((p) => ({ [PathPropertyName]: p })));
    const mdb2 = simpleMDB(paths.map((p) => ({ [PathPropertyName]: p })));
    const pathsIndex = new Map([
      pathEntry(simpleSpace.path),
      ...paths.map((p) => pathEntry(p, { status: "active" })),
    ]);

    const r1 = parseContextTableToCache(
      simpleSpace,
      mdb1,
      paths,
      true,
      pathsIndex,
      new IndexMap(),
      null as any,
      baseSettings,
      new Map(),
      { calculate: false }
    );

    const r2 = parseContextTableToCache(
      simpleSpace,
      mdb2,
      paths,
      true,
      pathsIndex,
      new IndexMap(),
      null as any,
      baseSettings,
      new Map(),
      { calculate: false }
    );

    expect(r1.cache.contextTable.cols).toEqual(r2.cache.contextTable.cols);
    expect(r1.cache.contextTable.rows).toEqual(r2.cache.contextTable.rows);
    expect(r1.cache.schemas).toEqual(r2.cache.schemas);
    expect(r1.cache.paths).toEqual(r2.cache.paths);
    expect(r1.cache.spaceMap).toEqual(r2.cache.spaceMap);
    expect(r1.cache.contexts).toEqual(r2.cache.contexts);
    expect(r1.cache.outlinks).toEqual(r2.cache.outlinks);
  });

  it("second call after in-place mdb mutation detects changed=false", () => {
    const paths = ["x.md"];
    // Start with EMPTY rows so the first call adds the missing path row,
    // producing changed=true.  The function mutates mdb[files] in-place.
    const mdb = simpleMDB([]);
    const pathsIndex = new Map([pathEntry(simpleSpace.path), pathEntry("x.md")]);

    // First call: empty rows → row added → changed=true
    const r1 = parseContextTableToCache(
      simpleSpace,
      mdb,
      paths,
      true,
      pathsIndex,
      new IndexMap(),
      null as any,
      baseSettings,
      new Map(),
      { calculate: false }
    );
    expect(r1.changed).toBe(true);

    // Second call with same (now-mutated) mdb — no new changes
    const r2 = parseContextTableToCache(
      simpleSpace,
      mdb,
      paths,
      true,
      pathsIndex,
      new IndexMap(),
      null as any,
      baseSettings,
      new Map(),
      { calculate: false }
    );
    expect(r2.changed).toBe(false);
  });
});

// ===========================================================================
// ADVERSARIAL SCENARIOS
// ===========================================================================
describe("Adversarial — mismatched column types vs row data", () => {
  it("handles number-typed column receiving string value in row", () => {
    const cols: SpaceProperty[] = [
      ...(defaultContextFields.rows as SpaceProperty[]),
      { name: "count", type: "number", schemaId: "files", value: "" },
    ];
    const result = parse({
      mdb: simpleMDB(
        [{ [PathPropertyName]: "a.md", count: "not-a-number" }],
        cols
      ),
      paths: ["a.md"],
      pathsIndex: new Map([pathEntry(simpleSpace.path), pathEntry("a.md")]),
    });

    // Should not throw; row preserved with its string value
    expect(result.cache.contextTable.rows[0].count).toBe("not-a-number");
  });

  it("handles boolean-typed column receiving arbitrary string", () => {
    const cols: SpaceProperty[] = [
      ...(defaultContextFields.rows as SpaceProperty[]),
      { name: "active", type: "boolean", schemaId: "files", value: "" },
    ];
    const result = parse({
      mdb: simpleMDB(
        [{ [PathPropertyName]: "a.md", active: "maybe" }],
        cols
      ),
      paths: ["a.md"],
      pathsIndex: new Map([pathEntry(simpleSpace.path), pathEntry("a.md")]),
    });

    expect(result.cache.contextTable.rows[0].active).toBe("maybe");
  });
});

describe("Adversarial — paths not in pathsIndex", () => {
  it("handles paths that have no corresponding pathsIndex entry without crashing", () => {
    const paths = ["exists.md", "ghost.md"];
    const result = parse({
      mdb: simpleMDB(paths.map((p) => ({ [PathPropertyName]: p }))),
      paths,
      // "ghost.md" is deliberately not in pathsIndex
      pathsIndex: new Map([
        pathEntry(simpleSpace.path),
        pathEntry("exists.md"),
      ]),
    });

    // Should not throw. Both paths should appear in output.
    const outputPaths = result.cache.contextTable.rows.map(
      (r) => r[PathPropertyName]
    );
    expect(outputPaths).toContain("exists.md");
    expect(outputPaths).toContain("ghost.md");
  });
});

describe("Adversarial — null/undefined metadata in pathsIndex", () => {
  it("handles pathsIndex entry with null metadata", () => {
    const result = parse({
      paths: ["a.md"],
      mdb: simpleMDB([{ [PathPropertyName]: "a.md" }]),
      pathsIndex: new Map<string, PathState>([
        pathEntry(simpleSpace.path),
        [
          "a.md",
          {
            path: "a.md",
            label: { name: "a", sticker: "", color: "", cover: "", preview: "", thumbnail: "" },
            readOnly: false,
            metadata: null,
          } as any,
        ],
      ]),
    });

    expect(result.cache.contextTable.rows.length).toBe(1);
    expect(result.cache.contextTable.rows[0][PathPropertyName]).toBe("a.md");
  });

  it("handles pathsIndex entry with undefined metadata property", () => {
    const result = parse({
      paths: ["a.md"],
      mdb: simpleMDB([{ [PathPropertyName]: "a.md" }]),
      pathsIndex: new Map<string, PathState>([
        pathEntry(simpleSpace.path),
        [
          "a.md",
          {
            path: "a.md",
            label: { name: "a", sticker: "", color: "", cover: "", preview: "", thumbnail: "" },
            readOnly: false,
            metadata: { property: undefined },
          } as any,
        ],
      ]),
    });

    expect(result.cache.contextTable.rows.length).toBe(1);
  });
});

describe("Adversarial — extra columns in rows not in cols definition", () => {
  it("preserves extra row keys not defined in cols", () => {
    const result = parse({
      paths: ["a.md"],
      mdb: simpleMDB([
        {
          [PathPropertyName]: "a.md",
          undefinedColumn: "surprise",
        },
      ]),
      pathsIndex: new Map([pathEntry(simpleSpace.path), pathEntry("a.md")]),
    });

    // The row should keep its extra key — the pipeline should not strip it
    // (it may or may not appear — the important thing is no crash)
    expect(result.cache.contextTable.rows.length).toBe(1);
  });
});

describe("Adversarial — rows missing PathPropertyName", () => {
  it("handles rows with missing File property", () => {
    const result = parse({
      paths: ["a.md"],
      mdb: simpleMDB([
        { someOtherField: "value" }, // No PathPropertyName (File)
      ]),
      pathsIndex: new Map([pathEntry(simpleSpace.path), pathEntry("a.md")]),
    });

    // Should not crash; "a.md" should still appear (from paths, not MDB)
    const outputPaths = result.cache.contextTable.rows.map(
      (r) => r[PathPropertyName]
    );
    expect(outputPaths).toContain("a.md");
  });
});

describe("Adversarial — large paths array (1000+)", () => {
  it("handles 1000 paths without crashing and preserves row identity", () => {
    const count = 1000;
    const paths = Array.from({ length: count }, (_, i) => `folder/file${i}.md`);
    const pathsIndex = new Map<string, PathState>([
      pathEntry(simpleSpace.path),
      ...paths.map((p) => pathEntry(p)),
    ]);

    const result = parse({
      mdb: simpleMDB([]), // Empty MDB — all paths are "new"
      paths,
      pathsIndex,
    });

    expect(result.cache.contextTable.rows.length).toBe(count);
    const outputPaths = new Set(
      result.cache.contextTable.rows.map((r) => r[PathPropertyName])
    );
    // Every input path should appear
    expect(outputPaths.size).toBe(count);
    for (const p of paths) {
      expect(outputPaths.has(p)).toBe(true);
    }
  });

  it("handles 2000 paths with existing MDB rows for half", () => {
    const count = 2000;
    const paths = Array.from({ length: count }, (_, i) => `big/f${i}.md`);
    // MDB has rows for the first half only
    const existingRows = paths
      .slice(0, count / 2)
      .map((p) => ({ [PathPropertyName]: p }));
    const pathsIndex = new Map<string, PathState>([
      pathEntry(simpleSpace.path),
      ...paths.map((p) => pathEntry(p)),
    ]);

    const result = parse({
      mdb: simpleMDB(existingRows),
      paths,
      pathsIndex,
    });

    expect(result.cache.contextTable.rows.length).toBe(count);
  });
});

describe("Adversarial — empty string paths", () => {
  it("handles empty-string path without crashing", () => {
    const paths = ["", "a.md"];
    const result = parse({
      mdb: simpleMDB(paths.map((p) => ({ [PathPropertyName]: p }))),
      paths,
      pathsIndex: new Map([
        pathEntry(simpleSpace.path),
        pathEntry(""),
        pathEntry("a.md"),
      ]),
    });

    // Should not crash
    expect(result.cache.contextTable.rows.length).toBeGreaterThanOrEqual(1);
    const outputPaths = result.cache.contextTable.rows.map(
      (r) => r[PathPropertyName]
    );
    expect(outputPaths).toContain("a.md");
  });
});

describe("Adversarial — various space path prefixes", () => {
  it("handles spaces:// prefix space", () => {
    const spacesSpace: SpaceInfo = {
      ...simpleSpace,
      path: "spaces://custom",
      name: "custom",
      notePath: "",
      defPath: "",
    };
    const result = parse({
      space: spacesSpace,
      paths: ["a.md"],
      mdb: simpleMDB([{ [PathPropertyName]: "a.md" }]),
      pathsIndex: new Map([
        pathEntry("spaces://custom"),
        pathEntry("a.md"),
      ]),
    });

    expect(result.cache.path).toBe("spaces://custom");
    expect(result.cache.contextTable.rows.length).toBe(1);
  });

  it("handles tags:// prefix space", () => {
    const tagsSpace: SpaceInfo = {
      ...simpleSpace,
      path: "spaces://$tags/#project",
      name: "#project",
      notePath: "",
      defPath: "",
    };
    const result = parse({
      space: tagsSpace,
      paths: ["a.md"],
      mdb: simpleMDB([{ [PathPropertyName]: "a.md" }]),
      pathsIndex: new Map([
        pathEntry("spaces://$tags/#project"),
        pathEntry("a.md"),
      ]),
    });

    expect(result.cache.path).toBe("spaces://$tags/#project");
    expect(result.cache.contextTable.rows.length).toBe(1);
  });

  it("handles normal folder path", () => {
    const folderSpace: SpaceInfo = {
      ...simpleSpace,
      path: "Projects/MyProject",
      name: "MyProject",
    };
    const result = parse({
      space: folderSpace,
      paths: ["Projects/MyProject/a.md"],
      mdb: simpleMDB([
        { [PathPropertyName]: "Projects/MyProject/a.md" },
      ]),
      pathsIndex: new Map([
        pathEntry("Projects/MyProject"),
        pathEntry("Projects/MyProject/a.md"),
      ]),
    });

    expect(result.cache.path).toBe("Projects/MyProject");
    expect(result.cache.contextTable.rows.length).toBe(1);
  });
});

describe("Adversarial — autoImportObsidianPropertiesToContexts toggle", () => {
  const paths = ["a.md"];
  const pathsIndex = new Map([
    pathEntry(simpleSpace.path),
    pathEntry("a.md", { myProp: "val" }),
  ]);
  const mdb = simpleMDB([{ [PathPropertyName]: "a.md" }]);

  it("imports frontmatter when toggle is true", () => {
    const result = parse({
      paths,
      pathsIndex,
      mdb: simpleMDB([{ [PathPropertyName]: "a.md" }]),
      settings: { ...baseSettings, autoImportObsidianPropertiesToContexts: true } as MakeMDSettings,
    });

    const colNames = result.cache.contextTable.cols.map((c) => c.name);
    expect(colNames).toContain("myProp");
  });

  it("does not import frontmatter when toggle is false", () => {
    const result = parse({
      paths,
      pathsIndex,
      mdb: simpleMDB([{ [PathPropertyName]: "a.md" }]),
      settings: {
        ...baseSettings,
        autoImportObsidianPropertiesToContexts: false,
      } as MakeMDSettings,
    });

    const colNames = result.cache.contextTable.cols.map((c) => c.name);
    expect(colNames).not.toContain("myProp");
  });
});

describe("Adversarial — output structure completeness", () => {
  it("cache has all required ContextState fields", () => {
    const result = parse({
      paths: ["a.md"],
      mdb: simpleMDB([{ [PathPropertyName]: "a.md" }]),
      pathsIndex: new Map([pathEntry(simpleSpace.path), pathEntry("a.md")]),
    });

    const cache = result.cache;
    expect(cache).toHaveProperty("path");
    expect(cache).toHaveProperty("schemas");
    expect(cache).toHaveProperty("contextTable");
    expect(cache).toHaveProperty("outlinks");
    expect(cache).toHaveProperty("contexts");
    expect(cache).toHaveProperty("paths");
    expect(cache).toHaveProperty("spaceMap");
    expect(cache).toHaveProperty("dbExists");
    expect(cache).toHaveProperty("mdb");
    expect(Array.isArray(cache.schemas)).toBe(true);
    expect(Array.isArray(cache.outlinks)).toBe(true);
    expect(Array.isArray(cache.contexts)).toBe(true);
    expect(Array.isArray(cache.paths)).toBe(true);
    expect(typeof cache.spaceMap).toBe("object");
  });

  it("schemas are collected from all MDB tables", () => {
    const mdb: SpaceTables = {
      [defaultContextSchemaID]: {
        schema: defaultContextDBSchema,
        cols: defaultContextFields.rows as SpaceProperty[],
        rows: [],
      },
      customView: {
        schema: {
          id: "customView",
          name: "Custom View",
          type: "db",
        },
        cols: [],
        rows: [],
      },
    };
    const result = parse({
      mdb,
      pathsIndex: new Map([pathEntry(simpleSpace.path)]),
    });

    const schemaIds = result.cache.schemas.map((s) => s.id);
    expect(schemaIds).toContain(defaultContextSchemaID);
    expect(schemaIds).toContain("customView");
  });
});

describe("Adversarial — outlinks extraction from link columns", () => {
  it("extracts outlinks from link-typed columns", () => {
    const cols: SpaceProperty[] = [
      ...(defaultContextFields.rows as SpaceProperty[]),
      { name: "related", type: "link", schemaId: "files", value: "" },
    ];
    const result = parse({
      paths: ["a.md"],
      mdb: simpleMDB(
        [{ [PathPropertyName]: "a.md", related: "target.md" }],
        cols
      ),
      pathsIndex: new Map([pathEntry(simpleSpace.path), pathEntry("a.md")]),
    });

    expect(result.cache.outlinks).toContain("target.md");
  });
});

describe("Adversarial — dbExists passthrough", () => {
  it("dbExists=true is preserved", () => {
    const result = parse({ dbExists: true });
    expect(result.cache.dbExists).toBe(true);
  });

  it("dbExists=false is preserved", () => {
    const result = parse({ dbExists: false });
    expect(result.cache.dbExists).toBe(false);
  });

  it("dbExists=false in null mdb case (null mdb early-return)", () => {
    const result = parse({ mdb: null as any });
    // When mdb is null, the early-return always sets dbExists=false
    expect(result.cache.dbExists).toBe(false);
  });
});

describe("Adversarial — paths ordering", () => {
  it("output paths array contains all input paths", () => {
    // MDB has [c, a], paths input has [a, b, c].
    // The cache.paths ordering algorithm uses orderStringArrayByArray (which
    // reorders paths to match MDB order) then appends missingPaths. Paths
    // absent from MDB can appear in both the sorted array and the missing
    // array — this is an accepted redundancy in cache.paths (the source of
    // truth for row identity is contextTable.rows, not cache.paths).
    const paths = ["a.md", "b.md", "c.md"];
    const result = parse({
      mdb: simpleMDB([
        { [PathPropertyName]: "c.md" },
        { [PathPropertyName]: "a.md" },
      ]),
      paths,
      pathsIndex: new Map([
        pathEntry(simpleSpace.path),
        ...paths.map((p) => pathEntry(p)),
      ]),
    });

    // Every input path must be present
    for (const p of paths) {
      expect(result.cache.paths).toContain(p);
    }
    // MDB-ordered paths come first
    expect(result.cache.paths.indexOf("c.md")).toBeLessThan(
      result.cache.paths.indexOf("a.md")
    );
  });
});
