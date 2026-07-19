import fs from "fs";
import path from "path";
import initSqlJs from "sql.js";
import type { Database, SqlJsStatic } from "sql.js";
import { replaceDB } from "../db/db";
import { MDBFileTypeAdapter } from "../mdbAdapter";
import { getMDB } from "./mdb";

// The adapter class is imported for its REAL parseCache implementation. Its
// module graph reaches the WASM-bundling sql.js loader (db/sqljs.js — ESM the
// jest transform ignores), which the adapter shim below overrides anyway, so
// it is mocked out of the graph here.
jest.mock("../db/sqljs", () => ({
  loadSQL: async () => {
    throw new Error("loadSQL is not used — the test shim provides sqlJS()");
  },
}));

// ===========================================================================
// Notidian-jn8p — ORPHANED SCHEMA MUST NOT POISON THE WHOLE FILE (real engine).
//
// THE BUG'S WORSE CONSEQUENCE (live-reproduced): after a degenerate save
// DROPped a data table without recreating it, m_schema still referenced the
// missing table. getMDB built ALL per-schema tables inside ONE try/catch, so
// the `SELECT * FROM t` throw made it return null for the ENTIRE file —
// parseCache then never populated the cache and every intact sibling table in
// the .mdb became unloadable on the next real reload.
//
// THE FIX: getMDB builds each schema's table individually, skips only the
// broken schema, keeps the rest, and surfaces a user-visible notice (deduped
// once per file+schema-set per session so a permanent orphan is not a toast
// storm).
//
// METHOD: real sql.js 1.8.0 engine over the pinned WASM (same loader pattern
// as mdb.persistence.realengine.test.ts), an in-memory middleware shim, and a
// ui.notify spy. No fakes of the engine, no jsdom.
// ===========================================================================

const loadRealSqlJS = async (): Promise<SqlJsStatic> => {
  const buf = fs.readFileSync(
    path.join(path.dirname(require.resolve("sql.js")), "sql-wasm.wasm")
  );
  const wasmBinary = buf.buffer.slice(
    buf.byteOffset,
    buf.byteOffset + buf.byteLength
  ) as ArrayBuffer;
  return initSqlJs({ wasmBinary });
};

let SQL: SqlJsStatic;
beforeAll(async () => {
  SQL = await loadRealSqlJS();
}, 60000);

// Minimal in-memory middleware + adapter shim exposing only what getMDB /
// parseCache touch, with a notify spy on the plugin's ui surface.
const makeAdapter = (files: Map<string, ArrayBuffer>) => {
  const notify = jest.fn();
  const updateFileCache = jest.fn();
  const pathGenerations = new Map<string, number>();
  const beginPathGeneration = jest.fn((p: string) => {
    const generation = (pathGenerations.get(p) ?? 0) + 1;
    pathGenerations.set(p, generation);
    return generation;
  });
  const middleware = {
    fileExists: async (p: string) => files.has(p),
    readBinaryToFile: async (p: string) => files.get(p) ?? null,
    writeBinaryToFile: async (p: string, b: ArrayBuffer) => {
      files.set(p, b);
    },
    updateFileCache,
    beginPathGeneration,
    capturePathGeneration: jest.fn((p: string) => pathGenerations.get(p) ?? 0),
    isPathGenerationCurrent: jest.fn(
      (p: string, generation?: number) =>
        generation === undefined ||
        (pathGenerations.get(p) ?? 0) === generation
    ),
    invalidatePath: jest.fn((p: string) => beginPathGeneration(p)),
  };
  const adapter = {
    middleware,
    cache: new Map(),
    sqlJS: async () => SQL,
    plugin: { superstate: { ui: { notify, error: () => {} } } },
  } as any;
  return { adapter, notify, updateFileCache };
};

const SCHEMA_COLS = ["id", "name", "type", "def", "predicate", "primary"];
const FIELD_COLS = [
  "name",
  "schemaId",
  "type",
  "value",
  "hidden",
  "attrs",
  "unique",
  "primary",
];

const fieldRow = (name: string, schemaId: string) => ({
  name,
  schemaId,
  type: "text",
  value: "",
  hidden: "",
  attrs: "",
  unique: "",
  primary: "",
});

// Seed a context-style MDB whose m_schema lists TWO db-type schemas but whose
// physical tables include only `intact` — `orphan` is the dangling reference
// the degenerate empty-cols save used to leave behind.
const seedOrphanedDB = (
  files: Map<string, ArrayBuffer>,
  dbPath: string,
  { withOrphan = true }: { withOrphan?: boolean } = {}
) => {
  const db: Database = new SQL.Database();
  try {
    const ok = replaceDB(db, {
      m_schema: {
        uniques: ["id"],
        cols: SCHEMA_COLS,
        rows: [
          { id: "intact", name: "intact", type: "db", def: "", predicate: "", primary: "true" },
          ...(withOrphan
            ? [{ id: "orphan", name: "orphan", type: "db", def: "", predicate: "", primary: "" }]
            : []),
        ],
      },
      m_fields: {
        uniques: ["name,schemaId"],
        cols: FIELD_COLS,
        rows: [
          fieldRow("File", "intact"),
          fieldRow("x", "intact"),
          ...(withOrphan ? [fieldRow("File", "orphan")] : []),
        ],
      },
      intact: {
        uniques: [],
        cols: ["File", "x"],
        rows: [{ File: "a.md", x: "v" }],
      },
      // deliberately NO physical `orphan` table
    });
    expect(ok).toBe(true);
    files.set(dbPath, db.export().buffer as ArrayBuffer);
  } finally {
    db.close();
  }
};

describe("Notidian-jn8p: getMDB with an orphaned m_schema row (real engine)", () => {
  it("returns the remaining tables instead of null and surfaces the orphan via ui.notify", async () => {
    const files = new Map<string, ArrayBuffer>();
    const dbPath = "Orphan A/.notidian/context.mdb";
    seedOrphanedDB(files, dbPath);
    const { adapter, notify } = makeAdapter(files);

    const mdb = await getMDB(adapter, dbPath);

    // The WHOLE-FILE null is the retired behavior — the file stays loadable.
    expect(mdb).not.toBeNull();
    // Both schema rows survive (the orphan's name/def/predicate are the
    // user's recoverable view config; a later save recreates its table).
    expect(mdb.schemas.map((s) => s.id).sort()).toEqual(["intact", "orphan"]);
    // The intact table's data is fully readable.
    expect(mdb.tables.intact.rows).toEqual([{ File: "a.md", x: "v" }]);
    // Only the orphaned schema's TABLE entry is skipped.
    expect(Object.keys(mdb.tables)).toEqual(["intact"]);
    // The corruption is surfaced to the user, naming the schema and the file.
    expect(notify).toHaveBeenCalledTimes(1);
    const message = notify.mock.calls[0][0] as string;
    expect(message).toContain("orphan");
    expect(message).toContain(dbPath);
  });

  it("notifies ONCE per file+schema-set per session (no toast storm on re-parse)", async () => {
    const files = new Map<string, ArrayBuffer>();
    const dbPath = "Orphan B/.notidian/context.mdb";
    seedOrphanedDB(files, dbPath);
    const { adapter, notify } = makeAdapter(files);

    await getMDB(adapter, dbPath);
    await getMDB(adapter, dbPath);

    expect(notify).toHaveBeenCalledTimes(1);
  });

  it("does not notify for a healthy file and returns every table", async () => {
    const files = new Map<string, ArrayBuffer>();
    const dbPath = "Healthy/.notidian/context.mdb";
    seedOrphanedDB(files, dbPath, { withOrphan: false });
    const { adapter, notify } = makeAdapter(files);

    const mdb = await getMDB(adapter, dbPath);

    expect(mdb).not.toBeNull();
    expect(Object.keys(mdb.tables)).toEqual(["intact"]);
    expect(notify).not.toHaveBeenCalled();
  });

  it("parseCache populates the cache from the surviving tables (the file is loadable again after a reload)", async () => {
    const files = new Map<string, ArrayBuffer>();
    const dbPath = "Orphan C/.notidian/context.mdb";
    seedOrphanedDB(files, dbPath);
    const { adapter, updateFileCache } = makeAdapter(files);

    // Drive the REAL parseCache implementation over the shim — this is the
    // exact path that used to abort with an empty cache after a real reload.
    await MDBFileTypeAdapter.prototype.parseCache.call(
      adapter,
      { path: dbPath } as any,
      true
    );

    const cached = adapter.cache.get(dbPath);
    expect(cached).toBeTruthy();
    expect(cached.schemas.map((s: any) => s.id).sort()).toEqual([
      "intact",
      "orphan",
    ]);
    expect(cached.tables.intact.rows).toEqual([{ File: "a.md", x: "v" }]);
    expect(updateFileCache).toHaveBeenCalledWith(dbPath, cached, true, 0);
  });
});
