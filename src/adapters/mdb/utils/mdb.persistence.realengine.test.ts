import fs from "fs";
import path from "path";
import initSqlJs from "sql.js";
import type { Database, SqlJsStatic } from "sql.js";

import { getMDBTables } from "./mdb";
import { replaceDB } from "../db/db";

// ===========================================================================
// Notidian-eedq — REAL sql.js end-to-end regression for the per-DB header/view
// config (the view PREDICATE) surviving the m_schema recovery/init path.
//
// THE BUG. getMDBTables (src/adapters/mdb/utils/mdb.ts) ran a recovery/init block
// when its m_schema read found no rows. That block (a) treated a THROWN read as
// "empty" and then overwrote the file, (b) derived schemas from backing TABLE
// NAMES only — which silently DROPS every type:'view'/'frame' schema, since those
// rows have no data table — and (c) wrote an INSERT that listed only
// (id,name,type,primary), NULLing def + predicate. The predicate column is where
// the per-DB header layout lives (colsSize / colsHeaderDisplay / colsDataAnchor /
// colsWrap / colsHidden / colsOrder). Net: every time that path ran (e.g. on a
// plugin rebuild/reload), all persisted header config was lost.
//
// THIS NET drives the PUBLIC getMDBTables against the REAL sql.js 1.8.0 engine
// (the same WASM the plugin loads at runtime) through a tiny in-memory filesystem
// mock, then asserts:
//   1. A persisted view-schema predicate (full header layout) survives a reload.
//   2. The recovery/seed path, when it must seed a missing db-schema, PRESERVES
//      the pre-existing view/frame rows and their predicates (never derive-from-
//      scratch dropping them), and never writes def/predicate as NULL.
//   3. A purely-empty read does not clobber a DB whose m_schema read merely threw.
// These are offline-verifiable: real engine, no fakes, no jsdom.
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

// A minimal in-memory FilesystemMiddleware + MDBFileTypeAdapter shim exposing only
// the surface getMDBTables / saveDBFile actually touch. Files are ArrayBuffers in
// a Map; renameFile is real (so writeBinaryToFileWithTempReplace takes its atomic
// path). The real sql.js engine is returned by sqlJS().
const makeAdapter = (files: Map<string, ArrayBuffer>) => {
  const middleware = {
    fileExists: async (p: string) => files.has(p),
    readBinaryToFile: async (p: string) => files.get(p) ?? null,
    writeBinaryToFile: async (p: string, b: ArrayBuffer) => {
      files.set(p, b);
    },
    createFolder: async (_p: string) => {
      // parent folders are implicit in the flat map
    },
    renameFile: async (from: string, to: string) => {
      const b = files.get(from);
      if (b !== undefined) {
        files.set(to, b);
        files.delete(from);
      }
      return to;
    },
    deleteFile: async (p: string) => {
      files.delete(p);
    },
  };
  return {
    middleware,
    sqlJS: async () => SQL,
    plugin: { superstate: { ui: { error: () => {} } } },
  } as any;
};

// FORCE-THE-TRIGGER variant. The owner's bug fires when getMDBTables' initial
// `SELECT * FROM "m_schema"` read yields NO usable rows and the destructive
// recovery/seed path runs. The cleanest faithful reproduction is a sqlJS whose
// Database makes ONLY that first m_schema read throw (the swallowed catch then
// leaves schemas == [] and the recovery path engages), while every other exec —
// including the recovery path's own re-reads and the per-schema reads — hits the
// REAL engine. This proves the fix is non-destructive even when the trigger fires.
const makeAdapterFirstSchemaReadThrows = (files: Map<string, ArrayBuffer>) => {
  const base = makeAdapter(files);
  const SchemaReadOnceThrowingSQL = {
    ...SQL,
    Database: function (this: any, ...args: any[]) {
      const real = new (SQL.Database as any)(...args);
      let thrown = false;
      const wrapped = {
        exec: (sql: string) => {
          if (!thrown && /SELECT \* FROM "m_schema"\s*$/.test(sql.trim())) {
            thrown = true;
            throw new Error("simulated transient m_schema read failure (recovery trigger)");
          }
          return real.exec(sql);
        },
        export: () => real.export(),
        close: () => real.close(),
      };
      return wrapped;
    },
  } as unknown as SqlJsStatic;
  return { ...base, sqlJS: async () => SchemaReadOnceThrowingSQL } as any;
};

// Serialize a sql.js Database into the in-memory file map at `dbPath`.
const writeDB = (files: Map<string, ArrayBuffer>, dbPath: string, db: Database) => {
  files.set(dbPath, db.export().buffer as ArrayBuffer);
};

// Build a frames-style MDB whose m_schema carries a `main` frame row and a view
// row with a non-empty PREDICATE (the header layout). The view has NO backing
// data table — exactly the rows the old derive-from-table-names path dropped.
const seedFramesDB = (predicate: string): { files: Map<string, ArrayBuffer>; dbPath: string } => {
  const files = new Map<string, ArrayBuffer>();
  const dbPath = "Space/.notidian/space.mdb";
  const db = new SQL.Database();
  try {
    replaceDB(db, {
      m_schema: {
        uniques: ["id"],
        cols: ["id", "name", "type", "def", "predicate", "primary"],
        rows: [
          { id: "main", name: "main", type: "frame", def: "", predicate: "", primary: "true" },
          {
            id: "filesView",
            name: "All",
            type: "view",
            def: JSON.stringify({ db: "files", icon: "ui//file-stack" }),
            predicate,
            primary: "",
          },
        ],
      },
      m_fields: {
        uniques: ["name,schemaId"],
        cols: ["name", "schemaId", "type", "value", "hidden", "attrs", "unique", "primary"],
        rows: [],
      },
    });
    writeDB(files, dbPath, db);
  } finally {
    db.close();
  }
  return { files, dbPath };
};

// The header-layout payload an owner configures: widths, display, anchor, wrap,
// hidden, order — the full predicate. JSON, with adversarial quoting to also pin
// the escaping survives the recovery path.
const HEADER_PREDICATE = JSON.stringify({
  colsSize: { Name: 240, "O'Brien": 100 },
  colsHeaderDisplay: { Name: "dense" },
  colsDataAnchor: { Name: "center" },
  colsWrap: { Name: "wrap" },
  colsHidden: ["Secret"],
  colsOrder: ["Name", "Count", 'a"b'],
});

describe("Notidian-eedq: per-DB header predicate survives the m_schema recovery/reload path (real engine)", () => {
  it("a persisted view-schema predicate (header layout) survives a getMDBTables reload byte-for-byte", async () => {
    const { files, dbPath } = seedFramesDB(HEADER_PREDICATE);
    const adapter = makeAdapter(files);

    const tables = await getMDBTables(adapter, dbPath);

    expect(tables).not.toBeNull();
    // The view schema (where the predicate lives) must still be present...
    expect(tables!.filesView).toBeDefined();
    expect(tables!.filesView.schema.type).toBe("view");
    // ...and its predicate must round-trip identical (no NULL, no drop).
    expect(tables!.filesView.schema.predicate).toBe(HEADER_PREDICATE);
    // The frame row survives too.
    expect(tables!.main).toBeDefined();
    expect(tables!.main.schema.type).toBe("frame");
  });

  it("simulated reload (read -> getMDBTables -> persisted bytes) preserves every cols* field", async () => {
    const { files, dbPath } = seedFramesDB(HEADER_PREDICATE);
    const adapter = makeAdapter(files);

    // First read.
    const first = await getMDBTables(adapter, dbPath);
    expect(first!.filesView.schema.predicate).toBe(HEADER_PREDICATE);

    // Reload from whatever bytes are now on disk (the on-disk file must not have
    // been rewritten lossily by the recovery path).
    const second = await getMDBTables(adapter, dbPath);
    expect(second!.filesView.schema.predicate).toBe(HEADER_PREDICATE);

    // Every cols* sub-field of the header layout survives intact.
    const parsed = JSON.parse(second!.filesView.schema.predicate as string);
    expect(parsed.colsSize).toEqual({ Name: 240, "O'Brien": 100 });
    expect(parsed.colsHeaderDisplay).toEqual({ Name: "dense" });
    expect(parsed.colsDataAnchor).toEqual({ Name: "center" });
    expect(parsed.colsWrap).toEqual({ Name: "wrap" });
    expect(parsed.colsHidden).toEqual(["Secret"]);
    expect(parsed.colsOrder).toEqual(["Name", "Count", 'a"b']);
  });

  it("the recovery/seed path PRESERVES view+frame rows (and their predicates) while seeding a missing db schema", async () => {
    // Start from a frames DB that has the view/frame rows AND a real backing data
    // table ("files") whose m_schema row is MISSING — the exact situation that
    // makes getMDBTables seed: it finds a table with no schema row. The old code
    // would re-derive ALL schemas from table names (yielding ONLY {files}) and
    // overwrite, dropping the view/frame rows entirely.
    const files = new Map<string, ArrayBuffer>();
    const dbPath = "Space/.notidian/space.mdb";
    const db = new SQL.Database();
    try {
      replaceDB(db, {
        m_schema: {
          uniques: ["id"],
          cols: ["id", "name", "type", "def", "predicate", "primary"],
          rows: [
            { id: "main", name: "main", type: "frame", def: "", predicate: "", primary: "true" },
            {
              id: "filesView",
              name: "All",
              type: "view",
              def: JSON.stringify({ db: "files", icon: "ui//file-stack" }),
              predicate: HEADER_PREDICATE,
              primary: "",
            },
          ],
        },
        m_fields: {
          uniques: ["name,schemaId"],
          cols: ["name", "schemaId", "type", "value", "hidden", "attrs", "unique", "primary"],
          rows: [],
        },
        // a real backing data table whose schema row is intentionally absent
        files: { uniques: [], cols: ["File"], rows: [{ File: "Note A" }] },
      });
      writeDB(files, dbPath, db);
    } finally {
      db.close();
    }
    const adapter = makeAdapter(files);

    const tables = await getMDBTables(adapter, dbPath);

    // The view + frame rows must STILL be here (not dropped by a derive-from-
    // table-names overwrite), with the predicate intact.
    expect(tables!.filesView).toBeDefined();
    expect(tables!.filesView.schema.predicate).toBe(HEADER_PREDICATE);
    expect(tables!.main).toBeDefined();

    // Re-open the persisted bytes and confirm the predicate was not NULLed on disk.
    const reopened = new SQL.Database(new Uint8Array(files.get(dbPath) as ArrayBuffer));
    try {
      const res = reopened.exec(`SELECT id, def, predicate FROM "m_schema" WHERE id='filesView'`);
      const row = res[0]?.values?.[0];
      // predicate column is present and equals the layout (NOT null).
      expect(row?.[2]).toBe(HEADER_PREDICATE);
      // def is preserved too (not NULLed).
      expect(row?.[1]).toBe(JSON.stringify({ db: "files", icon: "ui//file-stack" }));
    } finally {
      reopened.close();
    }
  });

  it("a genuinely fresh DB (no m_schema table) still seeds derived db schemas WITH def+predicate columns (never NULL)", async () => {
    // No m_schema at all, but a backing data table named like a db schema. The
    // recovery path should seed a row for it carrying the full 6-column shape.
    const files = new Map<string, ArrayBuffer>();
    const dbPath = "Space/.notidian/space.mdb";
    const db = new SQL.Database();
    try {
      // Only a data table; no m_schema, no m_fields.
      db.exec(`CREATE TABLE "files" ("File" char); INSERT INTO "files" VALUES ('Note A');`);
      writeDB(files, dbPath, db);
    } finally {
      db.close();
    }
    const adapter = makeAdapter(files);

    const tables = await getMDBTables(adapter, dbPath);
    expect(tables).not.toBeNull();

    // The persisted m_schema row for the derived "files" schema must carry def +
    // predicate columns (empty string, not NULL) — proving the INSERT now writes
    // the full shape. (We assert against the on-disk bytes rather than the
    // returned tables map, because the per-schema projection separately skips a
    // schema whose m_fields read fails — pre-existing behavior, not the predicate
    // bug under test; the seeded m_schema row is what must carry the full shape.)
    const reopened = new SQL.Database(new Uint8Array(files.get(dbPath) as ArrayBuffer));
    try {
      const res = reopened.exec(`SELECT def, predicate FROM "m_schema" WHERE id='files'`);
      const row = res[0]?.values?.[0];
      expect(row).toBeDefined();
      // Empty string, explicitly NOT null.
      expect(row?.[0]).not.toBeNull();
      expect(row?.[1]).not.toBeNull();
    } finally {
      reopened.close();
    }
  });

  it("THE OWNER BUG: when the recovery path TRIGGERS (m_schema read throws), view+frame predicates survive (no derive-from-table-names drop, no NULL overwrite)", async () => {
    // Build a frames DB that has BOTH the persisted view/frame rows AND a backing
    // data table. Then force getMDBTables' first m_schema read to throw, engaging
    // the destructive recovery/seed path the owner hit on every rebuild.
    const files = new Map<string, ArrayBuffer>();
    const dbPath = "Space/.notidian/space.mdb";
    const db = new SQL.Database();
    try {
      replaceDB(db, {
        m_schema: {
          uniques: ["id"],
          cols: ["id", "name", "type", "def", "predicate", "primary"],
          rows: [
            { id: "main", name: "main", type: "frame", def: "", predicate: "", primary: "true" },
            {
              id: "filesView",
              name: "All",
              type: "view",
              def: JSON.stringify({ db: "files", icon: "ui//file-stack" }),
              predicate: HEADER_PREDICATE,
              primary: "",
            },
          ],
        },
        m_fields: {
          uniques: ["name,schemaId"],
          cols: ["name", "schemaId", "type", "value", "hidden", "attrs", "unique", "primary"],
          rows: [{ name: "File", schemaId: "files", type: "file", value: "", hidden: "", attrs: "", unique: "", primary: "true" }],
        },
        // backing data table so the OLD code would derive {files} and overwrite.
        files: { uniques: [], cols: ["File"], rows: [{ File: "Note A" }] },
      });
      writeDB(files, dbPath, db);
    } finally {
      db.close();
    }

    // Adapter whose first m_schema read throws -> recovery path engages.
    const adapter = makeAdapterFirstSchemaReadThrows(files);

    const tables = await getMDBTables(adapter, dbPath);

    // PRE-FIX, the derive-from-table-names overwrite would have produced ONLY a
    // {files} db schema and NULLed/dropped the view+frame rows. POST-FIX the
    // persisted view + frame rows are re-read and preserved with predicates.
    expect(tables!.filesView).toBeDefined();
    expect(tables!.filesView.schema.type).toBe("view");
    expect(tables!.filesView.schema.predicate).toBe(HEADER_PREDICATE);
    expect(tables!.main).toBeDefined();
    expect(tables!.main.schema.type).toBe("frame");

    // And the on-disk bytes must still hold the view predicate (the recovery path
    // must not have overwritten the file with a lossy schema set).
    const reopened = new SQL.Database(new Uint8Array(files.get(dbPath) as ArrayBuffer));
    try {
      const ids = (reopened.exec(`SELECT id FROM "m_schema" ORDER BY id`)[0]?.values ?? []).map(
        (r) => r[0]
      );
      expect(ids).toEqual(expect.arrayContaining(["filesView", "main"]));
      const pred = reopened.exec(`SELECT predicate FROM "m_schema" WHERE id='filesView'`)[0]
        ?.values?.[0]?.[0];
      expect(pred).toBe(HEADER_PREDICATE);
    } finally {
      reopened.close();
    }
  });
});
