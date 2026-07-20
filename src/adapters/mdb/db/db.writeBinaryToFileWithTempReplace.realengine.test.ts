import fs from "fs";
import path from "path";
import initSqlJs from "sql.js";
import type { Database, SqlJsStatic } from "sql.js";

import { replaceDB, saveDBFile } from "./db";
import type { DBTables } from "shared/types/mdb";

// ===========================================================================
// Notidian-euqe — writeBinaryToFileWithTempReplace (db.ts:238-263) wrote a temp
// file, then called `middleware.renameFile(tempPath, path)` UNCONDITIONALLY
// with no surrounding try/catch. Real Obsidian's fileManager.renameFile
// THROWS "Destination file already exists!" when `path` is already present
// (see src/adapters/obsidian/filesystem/filesystem.ts renameFile, which lets
// fileManager.renameFile's rejection propagate uncaught out through the
// middleware). That throw escaped writeBinaryToFileWithTempReplace entirely,
// so the intended non-atomic fallback (verifyTempDBReadable + a direct
// writeBinaryToFile at db.ts:257-259) was dead code: every overwrite of an
// already-existing .notidian mdb file rejected while callers assumed
// success. The prior test suite never caught this because every mocked
// renameFile happily overwrote an existing destination -- real Obsidian
// never does.
//
// THIS NET drives saveDBFile (the mdb, non-zipped writer) against the REAL
// sql.js 1.8.0 engine (the same WASM the plugin loads at runtime, matching
// the other *.realengine.test.ts files in this directory) through a tiny
// in-memory filesystem whose renameFile can be configured per-test to mirror
// real Obsidian's throw-on-existing-destination behavior, or any other
// rename failure mode. It proves the DESIGN ruling on Notidian-euqe:
//   (a) destination EXISTS + renameFile throws "Destination file already
//       exists!" -> saveDBFile still resolves, the destination ends up
//       holding the NEW bytes, and the temp file is cleaned up;
//   (b) destination exists -> renameFile is never even attempted (the fast
//       path is for absent destinations only -- probe first, don't
//       attempt-and-catch);
//   (c) destination absent -> the rename fast path IS used and the fallback
//       never double-writes the final path directly;
//   (d) a rename that resolves without throwing but returns an
//       unexpected/falsy path is treated as a non-success and falls through
//       to the fallback;
//   (e) a genuine fallback failure (the direct write itself throwing) still
//       propagates to the caller, but temp cleanup still runs.
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
let existingBytes: ArrayBuffer;
let newBytes: ArrayBuffer;

const DB_PATH = "Space/.notidian/context.mdb";

const buildBytes = (tables: DBTables): ArrayBuffer => {
  const db = new SQL.Database();
  try {
    expect(replaceDB(db, tables)).toBe(true);
    return db.export().buffer as ArrayBuffer;
  } finally {
    db.close();
  }
};

const readTableRows = (bytes: ArrayBuffer, table: string): unknown[] => {
  const db = new SQL.Database(new Uint8Array(bytes));
  try {
    const res = db.exec(`SELECT * FROM "${table}"`);
    return res[0]?.values ?? [];
  } finally {
    db.close();
  }
};

beforeAll(async () => {
  SQL = await loadRealSqlJS();
  existingBytes = buildBytes({
    t: { uniques: [], cols: ["File", "x"], rows: [{ File: "a.md", x: "old" }] },
  } as any);
  newBytes = buildBytes({
    t: { uniques: [], cols: ["File", "x"], rows: [{ File: "a.md", x: "new" }] },
  } as any);
}, 60000);

type RenameOverride = (from: string, to: string) => Promise<string>;

// A minimal in-memory FilesystemMiddleware shim exposing only the surface
// writeBinaryToFileWithTempReplace (via saveDBFile) touches. `files` seeds
// which paths already exist on "disk". renameFile defaults to a faithful
// move (matching the other *.realengine.test.ts shims in this directory);
// tests override it to mirror real Obsidian's throw-on-existing-destination
// behavior or other rename failure modes.
const makeHarness = (
  initialFiles: Record<string, ArrayBuffer>,
  overrides: { renameFile?: RenameOverride; writeBinaryToFile?: (p: string, b: ArrayBuffer) => Promise<void> } = {}
) => {
  const files = new Map<string, ArrayBuffer>(Object.entries(initialFiles));
  const writeLog: string[] = [];
  const defaultRename: RenameOverride = async (from, to) => {
    const bytes = files.get(from);
    if (bytes !== undefined) {
      files.set(to, bytes);
      files.delete(from);
    }
    return to;
  };
  const renameFile = jest.fn(overrides.renameFile ?? defaultRename);
  const defaultWrite = async (p: string, b: ArrayBuffer) => {
    writeLog.push(p);
    files.set(p, b);
  };
  const writeBinaryToFile = jest.fn(overrides.writeBinaryToFile ?? defaultWrite);
  const deleteFile = jest.fn(async (p: string) => {
    files.delete(p);
  });
  const middleware = {
    fileExists: jest.fn(async (p: string) => files.has(p)),
    readBinaryToFile: jest.fn(async (p: string) => files.get(p) ?? null),
    writeBinaryToFile,
    createFolder: jest.fn(async (_p: string) => {}),
    renameFile,
    deleteFile,
  };
  const plugin = {
    middleware,
    sqlJS: async () => SQL,
  } as any;
  return { plugin, files, writeLog, middleware };
};

const tempKeys = (files: Map<string, ArrayBuffer>) =>
  [...files.keys()].filter((k) => k.includes(".tmp-"));

describe("Notidian-euqe: writeBinaryToFileWithTempReplace's rename fast-path vs. non-atomic fallback", () => {
  it("(a) destination exists + renameFile throws 'Destination file already exists!' -> resolves, destination holds NEW bytes, temp cleaned up", async () => {
    const { plugin, files } = makeHarness(
      { [DB_PATH]: existingBytes },
      {
        renameFile: async () => {
          throw new Error("Destination file already exists!");
        },
      }
    );

    await expect(saveDBFile(plugin, DB_PATH, newBytes)).resolves.toBeUndefined();

    expect(readTableRows(files.get(DB_PATH)!, "t")).toEqual([["a.md", "new"]]);
    expect(tempKeys(files)).toHaveLength(0);
  });

  it("(b) destination exists -> renameFile is never attempted (fast path is absent-destination only)", async () => {
    const { plugin, middleware } = makeHarness(
      { [DB_PATH]: existingBytes },
      {
        renameFile: async () => {
          throw new Error("Destination file already exists!");
        },
      }
    );

    await saveDBFile(plugin, DB_PATH, newBytes);

    expect(middleware.renameFile).toHaveBeenCalledTimes(0);
  });

  it("(c) destination absent -> rename fast path used, no fallback double-write to the final path", async () => {
    const { plugin, files, writeLog, middleware } = makeHarness({});

    await saveDBFile(plugin, DB_PATH, newBytes);

    expect(middleware.renameFile).toHaveBeenCalledTimes(1);
    // Only the temp write happened -- the final path was populated by the
    // rename, never by a direct writeBinaryToFile call.
    expect(writeLog).toHaveLength(1);
    expect(writeLog[0]).toMatch(/\.tmp-/);
    expect(readTableRows(files.get(DB_PATH)!, "t")).toEqual([["a.md", "new"]]);
    expect(tempKeys(files)).toHaveLength(0);
  });

  it("(d) rename resolves without throwing but returns an unexpected path -> fallback write runs, bytes persisted", async () => {
    const { plugin, files, writeLog, middleware } = makeHarness(
      {},
      {
        // Doesn't move any bytes and doesn't return `path` -- a non-success
        // that must NOT be treated as though the rename succeeded.
        renameFile: async () => "unexpected-path",
      }
    );

    await saveDBFile(plugin, DB_PATH, newBytes);

    expect(middleware.renameFile).toHaveBeenCalledTimes(1);
    expect(writeLog).toContain(DB_PATH);
    expect(readTableRows(files.get(DB_PATH)!, "t")).toEqual([["a.md", "new"]]);
    expect(tempKeys(files)).toHaveLength(0);
  });

  it("(e) fallback write itself throws -> error propagates to the caller, but temp cleanup still runs", async () => {
    const { plugin, files, middleware } = makeHarness(
      { [DB_PATH]: existingBytes },
      {
        writeBinaryToFile: async (p: string, b: ArrayBuffer) => {
          if (p === DB_PATH) {
            throw new Error("disk full");
          }
          files.set(p, b);
        },
      }
    );

    await expect(saveDBFile(plugin, DB_PATH, newBytes)).rejects.toThrow("disk full");

    // The rename fast-path was never attempted (destination exists), so the
    // fallback's own direct write is what threw -- and cleanup still ran.
    expect(middleware.renameFile).toHaveBeenCalledTimes(0);
    expect(middleware.deleteFile).toHaveBeenCalledTimes(1);
    expect(tempKeys(files)).toHaveLength(0);
    // The destination was never touched by the failed write.
    expect(readTableRows(files.get(DB_PATH)!, "t")).toEqual([["a.md", "old"]]);
  });
});
