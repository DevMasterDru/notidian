import fs from "fs";
import path from "path";
import JSZip from "jszip";
import initSqlJs from "sql.js";
import type { Database, SqlJsStatic } from "sql.js";

import { replaceDB, saveZippedDBToPath, selectDB } from "./db";
import type { DBTables } from "shared/types/mdb";

// ===========================================================================
// Notidian-jn41 — saveZippedDBToPath ignored replaceDB's boolean result and
// ALWAYS exported+wrote the DB image, always returning true. Contrast the
// already-correct saveDBToPath (db.ts:586-591), which captures replaceDB's
// result, only writes when it is true, and returns the captured result.
//
// THE BUG'S TWO LIVE GAPS (both closed by mirroring saveDBToPath):
//   (a) an empty-cols-with-rows refusal (replaceDB returns false BEFORE
//       executing anything, per Notidian-jn8p) was still followed by a zip
//       write and a `true` return — the caller (localCache/localCacheMobile,
//       the .mkc space cache) believed the save succeeded.
//   (b) a partial multi-table batch where an EARLIER table's per-table
//       transaction (Notidian-jn8p, commit 6ca3bed) already committed and a
//       LATER table's exec throws: replaceDB still returns false (the whole
//       batch failed), but the in-memory db image — carrying the earlier
//       table's already-committed change — was exported and reported as full
//       success instead of surfacing the failure.
//
// THIS NET drives saveZippedDBToPath against the REAL sql.js 1.8.0 engine
// (the same WASM the plugin loads at runtime) through a tiny in-memory
// filesystem + JSZip round-trip, proving (1) the refusal case never rewrites
// the zip and returns false, (2) the mid-sequence-failure case never exports
// the partial batch and returns false, and (3) the happy path is unchanged:
// returns true and the zip IS rewritten with the new data.
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

const DB_PATH = "Space/.notidian/cache.mdc";

// A minimal in-memory FilesystemMiddleware + MDBFileTypeAdapter shim exposing
// only the surface saveZippedDBToPath actually touches. Files are ArrayBuffers
// in a Map; renameFile is real (so writeBinaryToFileWithTempReplace takes its
// atomic path). writeLog records every writeBinaryToFile call so tests can
// assert "no write happened" precisely (not just "bytes look the same").
const makeAdapter = (files: Map<string, ArrayBuffer>) => {
  const writeLog: string[] = [];
  const middleware = {
    fileExists: async (p: string) => files.has(p),
    readBinaryToFile: async (p: string) => files.get(p) ?? null,
    writeBinaryToFile: async (p: string, b: ArrayBuffer) => {
      writeLog.push(p);
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
  const adapter = {
    middleware,
    sqlJS: async () => SQL,
    plugin: { superstate: { ui: { error: () => {} } } },
  } as any;
  return { adapter, writeLog };
};

// Build a real sql.js DB seeded with `seed`, export it, and wrap the exported
// bytes as a "data.mdb" entry inside a zip archive — the exact shape
// openZippedDBWithStatus/getZippedDBFile expect on disk for a .mdc file.
const zipSeededDB = async (seed: DBTables): Promise<ArrayBuffer> => {
  const db = new SQL.Database();
  try {
    expect(replaceDB(db, seed)).toBe(true);
    const bytes = db.export().buffer as ArrayBuffer;
    const zip = new JSZip();
    zip.file("data.mdb", bytes);
    return await zip.generateAsync({ type: "arraybuffer" });
  } finally {
    db.close();
  }
};

// Unwrap a zipped "data.mdb" entry back into raw sql.js-loadable bytes.
const unzipDataMdb = async (zipped: ArrayBuffer): Promise<ArrayBuffer> => {
  const zip = new JSZip();
  await zip.loadAsync(zipped);
  return zip.file("data.mdb")!.async("arraybuffer");
};

const openZippedBytes = async (zipped: ArrayBuffer): Promise<Database> => {
  const raw = await unzipDataMdb(zipped);
  return new SQL.Database(new Uint8Array(raw));
};

const toBase64 = (buf: ArrayBuffer) => Buffer.from(buf).toString("base64");

const liveTables = (db: Database): string[] =>
  db
    .exec("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name;")[0]
    ?.values.map((r) => r[0] as string) ?? [];

describe("Notidian-jn41: saveZippedDBToPath honors replaceDB's boolean result (real engine)", () => {
  let files: Map<string, ArrayBuffer>;
  let seededBytes: ArrayBuffer;

  beforeEach(async () => {
    files = new Map<string, ArrayBuffer>();
    seededBytes = await zipSeededDB({
      t: { uniques: [], cols: ["File", "x"], rows: [{ File: "a.md", x: "v" }] },
    });
    files.set(DB_PATH, seededBytes);
  });

  it("empty-cols-with-rows refusal: returns false and the zip is NEVER rewritten", async () => {
    const { adapter, writeLog } = makeAdapter(files);
    const before = toBase64(files.get(DB_PATH)!);

    const result = await saveZippedDBToPath(adapter, DB_PATH, {
      // Notidian-jn8p: replaceDB refuses (returns false) before executing
      // anything when cols is empty but rows are present, to avoid a DROP
      // with no CREATE to follow.
      t: { uniques: [], cols: [], rows: [{ File: "a.md", x: "v" }] },
    } as any);

    expect(result).toBe(false);
    // No temp write, no rename target write -> no write call at all.
    expect(writeLog).toHaveLength(0);
    // The on-disk bytes are byte-identical to what was seeded.
    expect(toBase64(files.get(DB_PATH)!)).toBe(before);

    // The pre-existing table + row are intact when reopened.
    const reopened = await openZippedBytes(files.get(DB_PATH)!);
    try {
      expect(selectDB(reopened, "t")!.rows).toEqual([{ File: "a.md", x: "v" }]);
    } finally {
      reopened.close();
    }
  });

  it("a mid-sequence exec failure on a LATER table returns false and never exports the partial batch", async () => {
    const { adapter, writeLog } = makeAdapter(files);
    const before = toBase64(files.get(DB_PATH)!);

    // `first` commits cleanly (its own per-table BEGIN..COMMIT executes before
    // `second` is reached). `second` has 2001 distinct columns, exceeding
    // SQLITE_MAX_COLUMN (2000), so its CREATE TABLE throws mid-sequence and
    // replaceDB's catch ROLLBACKs the currently-open (second's) transaction
    // and returns false overall — even though `first` already committed to
    // the in-memory db object.
    const manyCols = Array.from({ length: 2001 }, (_, i) => `c${i}`);
    const result = await saveZippedDBToPath(adapter, DB_PATH, {
      first: { uniques: [], cols: ["id"], rows: [{ id: "1" }] },
      second: { uniques: [], cols: manyCols, rows: [{ c0: "1" }] },
    } as any);

    expect(result).toBe(false);
    // The partial batch (carrying `first`'s already-committed change) must
    // NEVER be exported to disk.
    expect(writeLog).toHaveLength(0);
    expect(toBase64(files.get(DB_PATH)!)).toBe(before);

    // Reopening the untouched, persisted bytes shows only the ORIGINAL table
    // -- `first` (which only ever existed in the discarded in-memory db) is
    // absent from disk.
    const reopened = await openZippedBytes(files.get(DB_PATH)!);
    try {
      const tables = liveTables(reopened);
      expect(tables).toContain("t");
      expect(tables).not.toContain("first");
      expect(tables).not.toContain("second");
      expect(selectDB(reopened, "t")!.rows).toEqual([{ File: "a.md", x: "v" }]);
    } finally {
      reopened.close();
    }
  });

  it("happy path unchanged: replaceDB succeeds -> returns true and the zip IS rewritten with the new data", async () => {
    const { adapter, writeLog } = makeAdapter(files);
    const before = toBase64(files.get(DB_PATH)!);

    const result = await saveZippedDBToPath(adapter, DB_PATH, {
      t: { uniques: [], cols: ["File", "x"], rows: [{ File: "b.md", x: "w" }] },
    } as any);

    expect(result).toBe(true);
    // A write did happen (the temp-file write, before the atomic rename).
    expect(writeLog.length).toBeGreaterThan(0);
    expect(toBase64(files.get(DB_PATH)!)).not.toBe(before);

    const reopened = await openZippedBytes(files.get(DB_PATH)!);
    try {
      expect(selectDB(reopened, "t")!.rows).toEqual([{ File: "b.md", x: "w" }]);
    } finally {
      reopened.close();
    }
  });
});
