import fs from "fs";
import path from "path";
import initSqlJs from "sql.js";
import type { Database, SqlJsStatic } from "sql.js";

import { getMDBTables } from "./mdb";
import { mdbTablesToDBTables, replaceDB } from "../db/db";
import { mdbFrameToDBTables, mergeFrameFields } from "../../../core/utils/frames/frame";
import { fieldSchema } from "../../../shared/schemas/fields";
import type { SpaceProperty } from "../../../shared/types/mdb";
import type { MDBFrame } from "../../../shared/types/mframe";

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

// ===========================================================================
// Notidian-2y21 — VIEW-CUSTOMIZATION DURABILITY across the FRAME->DB / replaceDB
// round-trip (the SECOND, still-open reset vector after Notidian-eedq hardened the
// schema-recovery path).
//
// THE BUG. A frames `.mdb` file stores the m_schema row (with the view PREDICATE:
// colsHidden / colsSize / colsOrder / frozenColumnCount) AND the m_fields rows
// (the column definitions) for EVERY frame and view in the space. Saving ONE
// frame routed mdbFrameToDBTables({ [id]: frame }) -> saveDBToPath -> replaceDB.
// mdbFrameToDBTables rebuilds m_fields from ONLY the saved frame's cols, and
// replaceDB DROPs + recreates every table present in its argument — so the write
// wiped every OTHER view's column definitions. The m_schema PREDICATE itself
// survived (m_schema isn't in the written DBTables, so replaceDB left it alone),
// but a view stripped of its columns renders fully reset: the owner's hidden
// props / widths / order had no columns left to apply to. Net: every frame edit
// (and every AI rebuild/save touching a frame) reset sibling views vault-wide.
//
// THE FIX. mergeFrameFields folds the saved frame's columns OVER the persisted
// m_fields rows by schemaId, so unchanged views keep every field row — the same
// non-destructive merge the mdbTable save path already performs.
//
// THIS NET drives the real sql.js engine: seed a frames DB with two views (each
// with a non-empty header predicate) + a frame, all carrying field rows; simulate
// a single-frame save through the production mdbFrameToDBTables + mergeFrameFields
// + replaceDB pipeline; then assert sibling views' columns AND predicates survive
// byte-for-byte. Without mergeFrameFields the sibling field rows vanish and this
// FAILS.
// ===========================================================================

// Read the full m_fields table as objects, column-order-agnostic (the schema
// carries `source`, ADR 0017), so the helper does not couple to column order.
const readFields = (db: Database): SpaceProperty[] => {
  const res = db.exec(`SELECT * FROM "m_fields"`);
  const cols = res[0]?.columns ?? [];
  return (res[0]?.values ?? []).map((row) =>
    cols.reduce((acc, c, i) => ({ ...acc, [c]: row[i] }), {} as any)
  ) as SpaceProperty[];
};

const fieldRow = (name: string, schemaId: string): SpaceProperty =>
  ({
    name,
    schemaId,
    type: "text",
    value: "",
    source: "",
    attrs: "",
    hidden: "",
    unique: "",
    primary: "",
  } as unknown as SpaceProperty);

const VIEW_A_PREDICATE = JSON.stringify({
  colsHidden: ["Secret"],
  colsSize: { Name: 240, "O'Brien": 100 },
  colsOrder: ["Name", "Count"],
  frozenColumnCount: 1,
});
const VIEW_B_PREDICATE = JSON.stringify({
  colsHidden: ["Internal"],
  colsSize: { Title: 320 },
  colsOrder: ["Title", "Status"],
});

// Seed a frames-style DB: a `main` frame + two view rows (each with its own
// header predicate) and the m_fields column rows for ALL THREE.
const seedFramesWithSiblingViews = (): { files: Map<string, ArrayBuffer>; dbPath: string } => {
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
          { id: "viewA", name: "A", type: "view", def: JSON.stringify({ db: "files" }), predicate: VIEW_A_PREDICATE, primary: "" },
          { id: "viewB", name: "B", type: "view", def: JSON.stringify({ db: "files" }), predicate: VIEW_B_PREDICATE, primary: "" },
        ],
      },
      m_fields: {
        uniques: ["name,schemaId"],
        cols: ["name", "schemaId", "type", "value", "source", "attrs", "hidden", "unique", "primary"],
        rows: [
          fieldRow("$root", "main"),
          fieldRow("colA1", "viewA"),
          fieldRow("colA2", "viewA"),
          fieldRow("colB1", "viewB"),
        ] as any,
      },
      main: { uniques: [], cols: ["id", "schemaId", "name"], rows: [{ id: "$root", schemaId: "main", name: "root" }] },
    });
    writeDB(files, dbPath, db);
  } finally {
    db.close();
  }
  return { files, dbPath };
};

// The production single-frame save pipeline, exercised at the DB layer: convert
// the saved frame, merge over the persisted m_fields, replaceDB, persist bytes.
const saveSingleFrame = (
  files: Map<string, ArrayBuffer>,
  dbPath: string,
  frame: MDBFrame
) => {
  const db = new SQL.Database(new Uint8Array(files.get(dbPath) as ArrayBuffer));
  try {
    const persisted = readFields(db);
    const converted = mdbFrameToDBTables({ [frame.schema.id]: frame } as any);
    const merged = mergeFrameFields(converted, persisted, frame.schema.id);
    replaceDB(db, merged);
    writeDB(files, dbPath, db);
  } finally {
    db.close();
  }
};

describe("Notidian-2y21: a single-frame save preserves SIBLING views' columns + predicates (frame->DB / replaceDB round-trip, real engine)", () => {
  it("PINS THE BUG: the pre-fix path (raw mdbFrameToDBTables -> replaceDB, no merge) DROPS every sibling view's columns", () => {
    // This is the destructive conversion the fix replaces. It proves the reset
    // vector is real on the live engine: writing one frame's DBTables rebuilds
    // m_fields from ONLY that frame's cols, so replaceDB's DROP+recreate erases
    // viewA/viewB columns. (mergeFrameFields then carries them forward — see the
    // following cases.)
    const { files, dbPath } = seedFramesWithSiblingViews();
    const db = new SQL.Database(new Uint8Array(files.get(dbPath) as ArrayBuffer));
    try {
      const mainFrame: MDBFrame = {
        schema: { id: "main", name: "main", type: "frame", def: "", predicate: "", primary: "true" } as any,
        cols: [fieldRow("$root", "main")] as any,
        rows: [{ id: "$root", schemaId: "main", name: "root" }] as any,
      };
      // PRE-FIX: no mergeFrameFields.
      replaceDB(db, mdbFrameToDBTables({ main: mainFrame } as any));
      const fields = readFields(db);
      const bySchema = (id: string) => fields.filter((f) => f.schemaId == id).map((f) => f.name);
      // The sibling views' columns are GONE — the owner-visible reset.
      expect(bySchema("viewA")).toEqual([]);
      expect(bySchema("viewB")).toEqual([]);
      // (The m_schema predicate itself survives — m_schema isn't in the written
      //  DBTables — but a column-less view renders reset regardless.)
      const predA = db.exec(`SELECT predicate FROM "m_schema" WHERE id='viewA'`)[0]?.values?.[0]?.[0];
      expect(predA).toBe(VIEW_A_PREDICATE);
    } finally {
      db.close();
    }
  });

  it("saving the `main` frame keeps viewA + viewB columns AND header predicates byte-for-byte", () => {
    const { files, dbPath } = seedFramesWithSiblingViews();

    const mainFrame: MDBFrame = {
      schema: { id: "main", name: "main", type: "frame", def: "", predicate: "", primary: "true" } as any,
      cols: [fieldRow("$root", "main")] as any,
      rows: [{ id: "$root", schemaId: "main", name: "root-edited" }] as any,
    };
    saveSingleFrame(files, dbPath, mainFrame);

    const db = new SQL.Database(new Uint8Array(files.get(dbPath) as ArrayBuffer));
    try {
      // Sibling views' COLUMN DEFINITIONS must still be on disk (the lost artifact).
      const fields = readFields(db);
      const bySchema = (id: string) => fields.filter((f) => f.schemaId == id).map((f) => f.name).sort();
      expect(bySchema("viewA")).toEqual(["colA1", "colA2"]);
      expect(bySchema("viewB")).toEqual(["colB1"]);
      expect(bySchema("main")).toEqual(["$root"]);

      // Sibling views' PREDICATES (the header layout) survive byte-for-byte.
      const predOf = (id: string) =>
        db.exec(`SELECT predicate FROM "m_schema" WHERE id='${id}'`)[0]?.values?.[0]?.[0];
      expect(predOf("viewA")).toBe(VIEW_A_PREDICATE);
      expect(predOf("viewB")).toBe(VIEW_B_PREDICATE);

      // The edited frame's own row landed.
      const mainName = db.exec(`SELECT name FROM "main" WHERE id='$root'`)[0]?.values?.[0]?.[0];
      expect(mainName).toBe("root-edited");
    } finally {
      db.close();
    }
  });

  it("re-saving a view with FEWER columns prunes only that view, never its siblings", () => {
    const { files, dbPath } = seedFramesWithSiblingViews();

    // viewA loses colA2; viewB must be untouched.
    const viewAFrame: MDBFrame = {
      schema: { id: "viewA", name: "A", type: "view", def: JSON.stringify({ db: "files" }), predicate: VIEW_A_PREDICATE, primary: "" } as any,
      cols: [fieldRow("colA1", "viewA")] as any,
      rows: [] as any,
    };
    saveSingleFrame(files, dbPath, viewAFrame);

    const db = new SQL.Database(new Uint8Array(files.get(dbPath) as ArrayBuffer));
    try {
      const fields = readFields(db);
      const bySchema = (id: string) => fields.filter((f) => f.schemaId == id).map((f) => f.name).sort();
      expect(bySchema("viewA")).toEqual(["colA1"]); // pruned correctly
      expect(bySchema("viewB")).toEqual(["colB1"]); // sibling untouched
      expect(bySchema("main")).toEqual(["$root"]);

      const predOf = (id: string) =>
        db.exec(`SELECT predicate FROM "m_schema" WHERE id='${id}'`)[0]?.values?.[0]?.[0];
      expect(predOf("viewA")).toBe(VIEW_A_PREDICATE);
      expect(predOf("viewB")).toBe(VIEW_B_PREDICATE);
    } finally {
      db.close();
    }
  });
});

// ===========================================================================
// Notidian-2y21 — VIEW-CUSTOMIZATION DURABILITY across a ROW WRITE (the AI /
// api.context.insert path). A programmatic row write routes through
// saveContext -> saveTable -> saveContent('mdbTable') -> mdbTablesToDBTables +
// merged m_fields -> replaceDB. That write must NEVER touch m_schema, so a view's
// predicate (colsHidden / colsSize / colsOrder) and sibling field rows are
// untouched. ADR 0044 authority gate: a row INSERT writes row data only, never
// schema. This pins it against the real engine.
// ===========================================================================

describe("Notidian-2y21: an AI/api.context.insert row write never resets view predicates (real engine)", () => {
  it("inserting a row into a data table leaves m_schema predicates + sibling fields byte-preserved", () => {
    const files = new Map<string, ArrayBuffer>();
    const dbPath = "Space/.notidian/context.mdb";
    const db = new SQL.Database();
    try {
      replaceDB(db, {
        m_schema: {
          uniques: ["id"],
          cols: ["id", "name", "type", "def", "predicate", "primary"],
          rows: [
            // The data schema (rows live here) + a view carrying the header layout.
            { id: "files", name: "Files", type: "db", def: "", predicate: "", primary: "true" },
            { id: "filesView", name: "All", type: "view", def: JSON.stringify({ db: "files" }), predicate: VIEW_A_PREDICATE, primary: "" },
          ],
        },
        m_fields: {
          uniques: ["name,schemaId"],
          cols: ["name", "schemaId", "type", "value", "source", "attrs", "hidden", "unique", "primary"],
          rows: [fieldRow("Name", "files"), fieldRow("Count", "files"), fieldRow("colV", "filesView")] as any,
        },
        files: { uniques: [], cols: ["Name", "Count"], rows: [{ Name: "Row 1", Count: "1" }] },
      });
      writeDB(files, dbPath, db);
    } finally {
      db.close();
    }

    // Simulate the row-write sink: saveContent('mdbTable') = mdbTablesToDBTables +
    // merged m_fields, NO m_schema. replaceDB leaves m_schema untouched.
    const db2 = new SQL.Database(new Uint8Array(files.get(dbPath) as ArrayBuffer));
    try {
      const oldFields = readFields(db2);
      const newTable = {
        schema: { id: "files", name: "Files", type: "db", def: "", predicate: "", primary: "true" } as any,
        cols: [fieldRow("Name", "files"), fieldRow("Count", "files")] as any,
        rows: [
          { Name: "Row 1", Count: "1" },
          { Name: "AI Row", Count: "99" }, // the inserted row
        ] as any,
      };
      const dbTables = {
        ...mdbTablesToDBTables({ files: newTable } as any),
        m_fields: {
          uniques: ["name,schemaId"],
          cols: ["name", "schemaId", "type", "value", "source", "attrs", "hidden", "unique", "primary"],
          rows: [
            ...oldFields.filter((f) => f.schemaId != "files"),
            ...newTable.cols,
          ] as any,
        },
      };
      replaceDB(db2, dbTables as any);
      writeDB(files, dbPath, db2);
    } finally {
      db2.close();
    }

    const db3 = new SQL.Database(new Uint8Array(files.get(dbPath) as ArrayBuffer));
    try {
      // The view predicate is byte-preserved — a row write must not reset view state.
      const pred = db3.exec(`SELECT predicate FROM "m_schema" WHERE id='filesView'`)[0]?.values?.[0]?.[0];
      expect(pred).toBe(VIEW_A_PREDICATE);
      // The view's own field row survives the row write (m_fields merge preserved it).
      const fields = readFields(db3);
      expect(fields.filter((f) => f.schemaId == "filesView").map((f) => f.name)).toEqual(["colV"]);
      // The inserted row landed.
      const rows = db3.exec(`SELECT Name FROM "files" ORDER BY Name`)[0]?.values?.map((r) => r[0]);
      expect(rows).toEqual(["AI Row", "Row 1"]);
    } finally {
      db3.close();
    }
  });
});

// ===========================================================================
// Notidian-buqr — m_fields must NOT retain case-variant field rows that the
// physical data table deduped away (real engine).
//
// THE BUG. m_fields is a ROW-based table: a field's `name` is a row VALUE, not a
// SQLite identifier, and the table's unique key `name,schemaId` uses SQLite's
// default case-SENSITIVE BINARY collation. So m_fields can hold BOTH "Status" and
// "status" for one schemaId. The PHYSICAL data table it describes cannot: replaceDB
// folds column identifiers case-INSENSITIVELY (Notidian-1q8y), keeping only the
// first-seen casing, because "Status" and "status" in one CREATE TABLE throw
// `duplicate column name`. Observed live (Notidian-vonm.3): force-saving the
// degenerate cols list [File, Created, Status, status] wrote a 3-column data table
// but a 4-row m_fields, so contextForSpace afterwards reported four columns whose
// backing table has three.
//
// THE FIX. replaceDB now folds m_fields ROWS with the SAME first-seen-wins rule,
// per schemaId (uniqByKey on schemaId + name.toLowerCase()), keeping whole rows
// verbatim — no field merge, no source/authority tie-break. This net drives the
// real sql.js engine through the exact mdbTable save-path transformation
// (mdbTablesToDBTables + merged m_fields, the shape mdbAdapter.saveContent
// 'mdbTable' builds) and asserts the read-back field list matches the physical
// columns exactly. Without the fold, m_fields carries the extra "status" row and
// these FAIL.
// ===========================================================================

const CTX_ID = "files";

// The degenerate cols the bead force-saves: File, Created, Status, status.
const degenerateCols: SpaceProperty[] = [
  fieldRow("File", CTX_ID),
  fieldRow("Created", CTX_ID),
  fieldRow("Status", CTX_ID),
  fieldRow("status", CTX_ID),
];

// Seed a context DB whose m_schema carries the (type:'db') context schema + an
// empty m_fields, mirroring a freshly-created Notidian context.
const seedContextDB = (): { files: Map<string, ArrayBuffer>; dbPath: string } => {
  const files = new Map<string, ArrayBuffer>();
  const dbPath = "Space/.notidian/context.mdb";
  const db = new SQL.Database();
  try {
    replaceDB(db, {
      m_schema: {
        uniques: ["id"],
        cols: ["id", "name", "type", "def", "predicate", "primary"],
        rows: [{ id: CTX_ID, name: "Files", type: "db", def: "", predicate: "", primary: "true" }],
      },
      m_fields: { uniques: fieldSchema.uniques, cols: fieldSchema.cols, rows: [] },
    });
    writeDB(files, dbPath, db);
  } finally {
    db.close();
  }
  return { files, dbPath };
};

// Force-save through the exact mdbTable save-path transformation the adapter uses
// (mdbAdapter.saveContent 'mdbTable'): the new table content carries `cols`, and
// m_fields rows = other-schema oldFields (none here) + this table's cols verbatim.
const forceSaveMdbTable = (
  files: Map<string, ArrayBuffer>,
  dbPath: string,
  cols: SpaceProperty[],
  rows: Record<string, string>[]
) => {
  const db = new SQL.Database(new Uint8Array(files.get(dbPath) as ArrayBuffer));
  try {
    const oldFields = readFields(db);
    const content = {
      schema: { id: CTX_ID, name: "Files", type: "db", def: "", predicate: "", primary: "true" } as any,
      cols: cols as any,
      rows: rows as any,
    };
    const tables = { [CTX_ID]: content };
    const dbTables = {
      ...mdbTablesToDBTables(tables as any),
      m_fields: {
        uniques: fieldSchema.uniques,
        cols: fieldSchema.cols,
        rows: [
          ...oldFields.filter((f) => f.schemaId != CTX_ID),
          ...Object.values(tables).flatMap((f) => f.cols),
        ] as any,
      },
    };
    replaceDB(db, dbTables as any);
    writeDB(files, dbPath, db);
  } finally {
    db.close();
  }
};

// The physical data table's REAL columns, straight from SQLite.
const physicalColumns = (files: Map<string, ArrayBuffer>, dbPath: string): string[] => {
  const db = new SQL.Database(new Uint8Array(files.get(dbPath) as ArrayBuffer));
  try {
    return (db.exec(`PRAGMA table_info(${JSON.stringify(CTX_ID)})`)[0]?.values ?? []).map(
      (r) => r[1] as string
    );
  } finally {
    db.close();
  }
};

describe("Notidian-buqr: m_fields cannot keep case-variant rows the physical table deduped away (real engine)", () => {
  it("PINS THE DIVERGENCE: force-saving [File, Created, Status, status] yields a 3-column data table (SQLite folds status into Status)", () => {
    const { files, dbPath } = seedContextDB();
    forceSaveMdbTable(files, dbPath, degenerateCols, [
      { File: "Note A", Created: "", Status: "open", status: "IGNORED" },
    ]);
    // The physical table can only hold the first-seen casing.
    expect(physicalColumns(files, dbPath)).toEqual(["File", "Created", "Status"]);
  });

  it("THE FIX: m_fields is deduped to match the physical table — first-seen casing wins, whole row kept", () => {
    const { files, dbPath } = seedContextDB();
    forceSaveMdbTable(files, dbPath, degenerateCols, [
      { File: "Note A", Created: "", Status: "open", status: "IGNORED" },
    ]);

    // Raw m_fields rows for the context: the extra "status" row must be gone.
    const db = new SQL.Database(new Uint8Array(files.get(dbPath) as ArrayBuffer));
    try {
      const names = readFields(db)
        .filter((f) => f.schemaId == CTX_ID)
        .map((f) => f.name);
      expect(names).toEqual(["File", "Created", "Status"]);
    } finally {
      db.close();
    }

    // And they equal the physical columns exactly — the invariant the bead demands.
    expect(physicalColumns(files, dbPath)).toEqual(["File", "Created", "Status"]);
  });

  it("contextForSpace's read path (getMDBTables) reports deduped cols matching the physical table", async () => {
    const { files, dbPath } = seedContextDB();
    forceSaveMdbTable(files, dbPath, degenerateCols, [
      { File: "Note A", Created: "", Status: "open", status: "IGNORED" },
    ]);

    // getMDBTables is the read path filesystemAdapter.contextForSpace projects the
    // context's cols from; tables[CTX].cols is the per-schema m_fields projection.
    const adapter = makeAdapter(files);
    const tables = await getMDBTables(adapter, dbPath);
    expect(tables).not.toBeNull();
    const reportedCols = (tables![CTX_ID].cols ?? []).map((c) => c.name);
    expect(reportedCols).toEqual(["File", "Created", "Status"]);
    // Two frontmatter columns whose backing table has one can no longer occur:
    // the reported field list is exactly the physical table's columns.
    expect(reportedCols).toEqual(physicalColumns(files, dbPath));
  });

  it("does NOT collapse the SAME field name across DIFFERENT schemaIds (per-schema File/Created defaults are the norm)", () => {
    const files = new Map<string, ArrayBuffer>();
    const dbPath = "Space/.notidian/multi.mdb";
    const db = new SQL.Database();
    try {
      replaceDB(db, {
        m_schema: {
          uniques: ["id"],
          cols: ["id", "name", "type", "def", "predicate", "primary"],
          rows: [
            { id: "ctxA", name: "A", type: "db", def: "", predicate: "", primary: "true" },
            { id: "ctxB", name: "B", type: "db", def: "", predicate: "", primary: "true" },
          ],
        },
        m_fields: {
          uniques: fieldSchema.uniques,
          cols: fieldSchema.cols,
          // Same "File"/"Created" names on two schemas, plus a case-variant WITHIN ctxA.
          rows: [
            fieldRow("File", "ctxA"),
            fieldRow("Created", "ctxA"),
            fieldRow("file", "ctxA"), // <- case-variant duplicate, must be dropped
            fieldRow("File", "ctxB"), // <- same name, different schema, must survive
            fieldRow("Created", "ctxB"),
          ] as any,
        },
        ctxA: { uniques: [], cols: ["File", "Created"], rows: [] },
        ctxB: { uniques: [], cols: ["File", "Created"], rows: [] },
      });
      writeDB(files, dbPath, db);
    } finally {
      db.close();
    }

    const reopened = new SQL.Database(new Uint8Array(files.get(dbPath) as ArrayBuffer));
    try {
      const fields = readFields(reopened);
      const bySchema = (id: string) => fields.filter((f) => f.schemaId == id).map((f) => f.name);
      // ctxA collapsed its case-variant; ctxB's same-named fields are untouched.
      expect(bySchema("ctxA")).toEqual(["File", "Created"]);
      expect(bySchema("ctxB")).toEqual(["File", "Created"]);
    } finally {
      reopened.close();
    }
  });
});

// ===========================================================================
// Notidian-rcvg — replaceDB's m_fields ROW fold and physical COLUMN fold must
// pick a DETERMINISTIC, MUTUALLY-CONSISTENT survivor on an already case-colliding
// (name,schemaId) pair (real engine).
//
// THE RESIDUAL DEFECT (after Notidian-buqr closed the count divergence). Both folds
// are FIRST-SEEN passes: uniqByKey over m_fields.rows and uniqCaseInsensitive over
// the data table's cols. They run over two INDEPENDENTLY-built arrays (mdbTablesTo-
// DBTables derives the data cols from `tables[c].cols`; the m_fields rows are
// assembled separately by callers — e.g. `SELECT * FROM m_fields` with no ORDER BY,
// or mergeFrameFields concatenation). So the survivor is purely input-order-
// dependent: (a) the SAME schema can persist "Status" from one save-path assembly
// and "status" from another (churning the field's declared type/format on an option
// vs text case-variant), and (b) the two folds can keep DIFFERENT casings, leaving
// m_fields' field name mismatched with its physical column. The fix pre-sorts BOTH
// folds with stableCanonicalByKey (authority-neutral name-string tie-break — NOT a
// source/authority preference, ADR 0001/0014/0017), so the same survivor and casing
// win every time. These drive the REAL sql.js engine and FAIL before the fix.
// ===========================================================================

describe("Notidian-rcvg: replaceDB folds a case-colliding schema to a DETERMINISTIC, fold-consistent survivor (real engine)", () => {
  const RSCHEMA = "files";

  // Build a DB directly from an explicit m_fields ROW order and an explicit data-
  // table COL order, so the test can drive the two INDEPENDENT folds with DIFFERENT
  // orders — exactly the inconsistent-builder-ordering the bead describes.
  const buildDB = (mFieldsNames: string[], dataCols: string[]): Database => {
    const db = new SQL.Database();
    replaceDB(db, {
      m_schema: {
        uniques: ["id"],
        cols: ["id", "name", "type", "def", "predicate", "primary"],
        rows: [{ id: RSCHEMA, name: "Files", type: "db", def: "", predicate: "", primary: "true" }],
      },
      m_fields: {
        uniques: fieldSchema.uniques,
        cols: fieldSchema.cols,
        rows: mFieldsNames.map((n) => fieldRow(n, RSCHEMA)) as any,
      },
      [RSCHEMA]: { uniques: [], cols: dataCols, rows: [] },
    });
    return db;
  };
  const physCols = (db: Database): string[] =>
    (db.exec(`PRAGMA table_info(${JSON.stringify(RSCHEMA)})`)[0]?.values ?? []).map(
      (r) => r[1] as string
    );
  const fieldNames = (db: Database): string[] =>
    readFields(db)
      .filter((f) => f.schemaId == RSCHEMA)
      .map((f) => f.name);

  it("persists the SAME casing regardless of the input order of a case-colliding (name,schemaId) pair (deterministic survivor)", () => {
    const a = buildDB(["Status", "status"], ["Status", "status"]);
    const b = buildDB(["status", "Status"], ["status", "Status"]);
    try {
      // The persisted casing must NOT depend on which variant happened to be first.
      expect(fieldNames(a)).toEqual(fieldNames(b));
      expect(physCols(a)).toEqual(physCols(b));
      // Both assemblies collapse to a single field that agrees with its table.
      expect(fieldNames(a)).toEqual(physCols(a));
      expect(fieldNames(b)).toEqual(physCols(b));
      expect(fieldNames(a)).toEqual(["Status"]);
    } finally {
      a.close();
      b.close();
    }
  });

  it("m_fields survivor casing equals the physical column casing even when the m_fields-row order DIFFERS from the data-table col order (fold-consistency)", () => {
    // The two folds fed OPPOSITE orders: first-seen-per-array kept "status" in
    // m_fields but "Status" as the physical column — a persisted mismatch. The
    // pre-sort makes both keep the same casing.
    const db = buildDB(["status", "Status"], ["Status", "status"]);
    try {
      expect(fieldNames(db)).toEqual(physCols(db)); // no cross-fold casing drift
      expect(fieldNames(db).length).toBe(1); // the case-variant collapsed
      expect(fieldNames(db)).toEqual(["Status"]);
    } finally {
      db.close();
    }
  });

  it("a richer option row and a leaner text row that case-collide resolve to a STABLE survivor, not the input-order-first one", () => {
    // The churn the bead calls out: a text row shadowing a richer option row (or
    // vice-versa) whenever it lands first. The survivor is now the name-rank winner,
    // identical across assemblies — never a source/authority preference.
    const rich = (): SpaceProperty =>
      ({ ...fieldRow("Priority", RSCHEMA), type: "option", value: JSON.stringify({ options: [{ name: "High", value: "high" }] }) } as any);
    const lean = (): SpaceProperty => ({ ...fieldRow("priority", RSCHEMA), type: "text" } as any);

    const one = new SQL.Database();
    const two = new SQL.Database();
    try {
      // Assembly 1: rich ("Priority") first. Assembly 2: lean ("priority") first.
      replaceDB(one, {
        m_schema: { uniques: ["id"], cols: ["id", "name", "type", "def", "predicate", "primary"], rows: [{ id: RSCHEMA, name: "Files", type: "db", def: "", predicate: "", primary: "true" }] },
        m_fields: { uniques: fieldSchema.uniques, cols: fieldSchema.cols, rows: [rich(), lean()] as any },
        [RSCHEMA]: { uniques: [], cols: ["Priority", "priority"], rows: [] },
      });
      replaceDB(two, {
        m_schema: { uniques: ["id"], cols: ["id", "name", "type", "def", "predicate", "primary"], rows: [{ id: RSCHEMA, name: "Files", type: "db", def: "", predicate: "", primary: "true" }] },
        m_fields: { uniques: fieldSchema.uniques, cols: fieldSchema.cols, rows: [lean(), rich()] as any },
        [RSCHEMA]: { uniques: [], cols: ["priority", "Priority"], rows: [] },
      });
      const survivorOf = (db: Database) =>
        readFields(db).filter((f) => f.schemaId == RSCHEMA).map((f) => ({ name: f.name, type: (f as any).type }));
      // Same survivor (name AND type) whichever assembly order was used.
      expect(survivorOf(one)).toEqual(survivorOf(two));
      expect(survivorOf(one).length).toBe(1);
      // "Priority" ('P') < "priority" ('p') -> the name-rank winner, deterministically.
      expect(survivorOf(one)[0].name).toBe("Priority");
    } finally {
      one.close();
      two.close();
    }
  });
});
