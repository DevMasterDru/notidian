import fs from "fs";
import path from "path";
import initSqlJs from "sql.js";
import type { SqlJsStatic } from "sql.js";

// ===========================================================================
// Notidian-g6f5 -- audit of the OTHER replaceDB call sites that ignored its
// boolean result (LocalStorageCache.initialize/reset, MobileCachePersister.
// initialize/reset). Unlike saveZippedDBToPath's bug (Notidian-jn41), these
// seed from a FIXED, known-good schema (CacheDBSchema: non-empty cols
// path/cache/version, no rows at seed time), so the empty-cols-with-rows
// refusal (Notidian-jn8p) can never fire in practice -- confirmed by
// inspection, not by a forced-empty-cols test here.
//
// What COULD still (rarely) return false is a genuine exec exception inside
// replaceDB's per-table transaction (mirroring the mid-batch-failure class
// Notidian-jn41 closed for saveZippedDBToPath). This net simulates exactly
// that residual class by mocking replaceDB's return value, then asserts:
//   - LocalStorageCache.initialize()/reset(): logs a warning (defense in
//     depth); behavior is otherwise unchanged since these methods have no
//     disk-write step of their own to gate.
//   - MobileCachePersister.initialize()/reset(): the disk write (the actual
//     live risk, structurally identical to the saveZippedDBToPath bug) is
//     SKIPPED when replaceDB fails, and always happens on the happy path.
// ===========================================================================

jest.mock("adapters/mdb/db/db", () => {
  const actual = jest.requireActual("adapters/mdb/db/db");
  return {
    ...actual,
    replaceDB: jest.fn(actual.replaceDB),
  };
});

// eslint-disable-next-line @typescript-eslint/no-var-requires
const actualDb = jest.requireActual("adapters/mdb/db/db");
import { replaceDB } from "adapters/mdb/db/db";
import { LocalStorageCache } from "./localCache";
import { MobileCachePersister } from "./localCacheMobile";

const mockedReplaceDB = replaceDB as jest.MockedFunction<typeof replaceDB>;

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

// A minimal in-memory FilesystemMiddleware + MDBFileTypeAdapter shim exposing
// only the surface these persisters actually touch (same shape as the
// db.saveZippedDBToPath.realengine.test.ts shim).
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

let warnSpy: jest.SpyInstance;

beforeEach(() => {
  mockedReplaceDB.mockReset();
  mockedReplaceDB.mockImplementation(actualDb.replaceDB);
  warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  warnSpy.mockRestore();
});

describe("Notidian-g6f5: LocalStorageCache honors replaceDB's boolean result (defense in depth)", () => {
  it("initialize(): happy path seeds the fixed schema with no warning", async () => {
    const { adapter } = makeAdapter(new Map());
    const cache = new LocalStorageCache(
      "Space/.notidian/cache-happy.mkc",
      adapter,
      ["files"]
    );
    await cache.initialize();
    expect(warnSpy).not.toHaveBeenCalled();
    expect(cache.isInitialized()).toBe(true);
  });

  it("initialize(): logs a warning when replaceDB fails, still completes initialization", async () => {
    mockedReplaceDB.mockReturnValueOnce(false);
    const { adapter } = makeAdapter(new Map());
    const cache = new LocalStorageCache(
      "Space/.notidian/cache-fail.mkc",
      adapter,
      ["files"]
    );
    await cache.initialize();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("Failed to seed local cache schema")
    );
    expect(cache.isInitialized()).toBe(true);
  });

  it("reset(): logs a warning when replaceDB fails", async () => {
    const { adapter } = makeAdapter(new Map());
    const cache = new LocalStorageCache(
      "Space/.notidian/cache-reset.mkc",
      adapter,
      ["files"]
    );
    await cache.initialize();
    warnSpy.mockClear();

    mockedReplaceDB.mockReturnValueOnce(false);
    cache.reset();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("Failed to reset local cache schema")
    );
  });

  it("reset(): no warning on the happy path", async () => {
    const { adapter } = makeAdapter(new Map());
    const cache = new LocalStorageCache(
      "Space/.notidian/cache-reset-ok.mkc",
      adapter,
      ["files"]
    );
    await cache.initialize();
    warnSpy.mockClear();

    cache.reset();
    expect(warnSpy).not.toHaveBeenCalled();
  });
});

describe("Notidian-g6f5: MobileCachePersister gates its disk write on replaceDB's result", () => {
  it("initialize(): happy path writes the seeded db to disk", async () => {
    const { adapter, writeLog } = makeAdapter(new Map());
    const cache = new MobileCachePersister(
      "Space/.notidian/mobile-happy.mkc",
      adapter,
      ["files"]
    );
    await cache.initialize();
    expect(writeLog.length).toBeGreaterThan(0);
    expect(warnSpy).not.toHaveBeenCalled();
    expect(cache.isInitialized()).toBe(true);
  });

  it("initialize(): skips the disk write and warns when replaceDB fails", async () => {
    mockedReplaceDB.mockReturnValueOnce(false);
    const { adapter, writeLog } = makeAdapter(new Map());
    const cache = new MobileCachePersister(
      "Space/.notidian/mobile-fail.mkc",
      adapter,
      ["files"]
    );
    await cache.initialize();
    expect(writeLog).toHaveLength(0);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("Failed to seed local cache schema")
    );
    // Still marks initialized, matching the existing (unchanged) semantics --
    // downstream reads/writes on the missing table are no-ops via the
    // pre-existing try/catch swallowing in selectDB/insertIntoDB/deleteFromDB.
    expect(cache.isInitialized()).toBe(true);
  });

  it("reset(): skips the disk write and warns when replaceDB fails", async () => {
    const { adapter, writeLog } = makeAdapter(new Map());
    const cache = new MobileCachePersister(
      "Space/.notidian/mobile-reset.mkc",
      adapter,
      ["files"]
    );
    await cache.initialize();
    writeLog.length = 0;
    warnSpy.mockClear();

    mockedReplaceDB.mockReturnValueOnce(false);
    await cache.reset();
    expect(writeLog).toHaveLength(0);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("Failed to reset local cache schema")
    );
  });

  it("reset(): writes to disk on the happy path", async () => {
    const { adapter, writeLog } = makeAdapter(new Map());
    const cache = new MobileCachePersister(
      "Space/.notidian/mobile-reset-ok.mkc",
      adapter,
      ["files"]
    );
    await cache.initialize();
    writeLog.length = 0;
    warnSpy.mockClear();

    await cache.reset();
    expect(writeLog.length).toBeGreaterThan(0);
    expect(warnSpy).not.toHaveBeenCalled();
  });
});
