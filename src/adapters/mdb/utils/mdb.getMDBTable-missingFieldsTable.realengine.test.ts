import fs from "fs";
import path from "path";
import initSqlJs from "sql.js";
import type { Database, SqlJsStatic } from "sql.js";
import { replaceDB } from "../db/db";
import { getMDBTable } from "./mdb";

// ===========================================================================
// Notidian-m3t8 -- getMDBTable's m_fields read used to catch ANY exception on
// `SELECT * FROM m_fields ...` and treat it as "table missing", collapsing a
// genuinely different SQL error (corrupt schema, disk-image errors, etc.)
// into a silent empty field set instead of surfacing it. Narrow the catch to
// ONLY the missing-m_fields-table shape, mirroring the explicit
// sqlite_schema existence check getOrReconstructMDBTablePropertiesWithinWriteQueue
// already runs in this same file.
//
// METHOD: real sql.js engine over the pinned WASM (same loader pattern as
// mdb.orphaned-schema.realengine.test.ts), an in-memory middleware shim.
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

// Minimal in-memory middleware + adapter shim exposing only what getMDBTable
// touches (same shape as the mdb.orphaned-schema.realengine.test.ts shim).
const makeAdapter = (files: Map<string, ArrayBuffer>) => {
  const middleware = {
    fileExists: async (p: string) => files.has(p),
    readBinaryToFile: async (p: string) => files.get(p) ?? null,
    writeBinaryToFile: async (p: string, b: ArrayBuffer) => {
      files.set(p, b);
    },
  };
  return {
    middleware,
    sqlJS: async () => SQL,
    plugin: { superstate: { ui: { error: () => {} } } },
  } as any;
};

const SCHEMA_COLS = ["id", "name", "type", "def", "predicate", "primary"];

describe("Notidian-m3t8: getMDBTable narrows its m_fields catch to the missing-table case", () => {
  it("a genuinely missing m_fields table still yields empty fields (recoverable)", async () => {
    const files = new Map<string, ArrayBuffer>();
    const dbPath = "Missing/.notidian/context.mdb";
    const db: Database = new SQL.Database();
    try {
      const ok = replaceDB(db, {
        m_schema: {
          uniques: ["id"],
          cols: SCHEMA_COLS,
          rows: [{ id: "t1", name: "t1", type: "db", def: "", predicate: "", primary: "true" }],
        },
        t1: {
          uniques: [],
          cols: ["File"],
          rows: [{ File: "a.md" }],
        },
        // deliberately NO m_fields table at all.
      });
      expect(ok).toBe(true);
      files.set(dbPath, db.export().buffer as ArrayBuffer);
    } finally {
      db.close();
    }
    const adapter = makeAdapter(files);

    const table = await getMDBTable(adapter, dbPath, "t1");

    expect(table).not.toBeNull();
    expect(table.cols).toEqual([]);
    expect(table.rows).toEqual([{ File: "a.md" }]);
  });

  it("a genuinely different SQL error on the m_fields read is surfaced, not swallowed as empty fields", async () => {
    const files = new Map<string, ArrayBuffer>();
    const dbPath = "BadFields/.notidian/context.mdb";
    const db: Database = new SQL.Database();
    try {
      const ok = replaceDB(db, {
        m_schema: {
          uniques: ["id"],
          cols: SCHEMA_COLS,
          rows: [{ id: "t1", name: "t1", type: "db", def: "", predicate: "", primary: "true" }],
        },
        t1: {
          uniques: [],
          cols: ["File"],
          rows: [{ File: "a.md" }],
        },
      });
      expect(ok).toBe(true);
      // m_fields exists, but as a VIEW whose defining query references a
      // table that doesn't exist -- resolving it throws a DIFFERENT "no such
      // table" error (naming the view's dangling reference, not m_fields
      // itself), a real, un-contrived SQL failure distinct from "m_fields is
      // missing".
      db.exec(`CREATE VIEW "m_fields" AS SELECT * FROM "definitely_missing_base"`);
      files.set(dbPath, db.export().buffer as ArrayBuffer);
    } finally {
      db.close();
    }
    const errors: unknown[] = [];
    const adapter = makeAdapter(files);
    adapter.plugin.superstate.ui.error = (e: unknown) => errors.push(e);

    // Surfaced the same way the sibling m_schema read surfaces an unexpected
    // SQL error: reported to the user and reported as an unusable table --
    // NOT silently downgraded to an empty field set (the actual defect), and
    // not thrown, since no caller of getMDBTable catches.
    const table = await getMDBTable(adapter, dbPath, "t1");

    expect(table).toBeNull();
    expect(errors).toHaveLength(1);
    expect(String((errors[0] as Error).message)).toMatch(/no such table/i);
  });
});
