// ===========================================================================
// Notidian-043x -- plugin:reload leak. Nothing disposed the LocalStorageCache
// persister ObsidianFileSystem constructs (filesystem.ts:111) on plugin
// unload, so its debounced flush (localCache.ts's debounceSaveSpaceDatabase)
// kept firing against a closed/replaced db after a reload, producing
// uncaught "Destination file already exists!" rename collisions with the
// freshly reloaded instance's own persister writing to the same path. A full
// Obsidian restart cleared it (fresh process); plugin:reload alone did not.
//
// unload() must:
//   (a) cancel any pending debounced flush -- advancing timers afterwards
//       must never invoke saveZippedDBFile.
//   (b) be idempotent -- calling it twice must not double-close the db or
//       throw.
//   (c) let an already in-flight flush (timer already fired) complete, but
//       never schedule a successor afterwards.
//   (d) make any post-unload store()/remove() call a no-op, so no new flush
//       can ever be scheduled again.
// ===========================================================================

jest.mock("adapters/mdb/db/db", () => {
  const actual = jest.requireActual("adapters/mdb/db/db");
  return {
    ...actual,
    saveZippedDBFile: jest.fn(async (): Promise<void> => undefined),
    withDBPathWriteQueue: jest.fn(
      (_path: string, op: () => Promise<unknown>): Promise<unknown> => op()
    ),
  };
});

import fs from "fs";
import path from "path";
import initSqlJs from "sql.js";
import type { SqlJsStatic } from "sql.js";
import { saveZippedDBFile } from "adapters/mdb/db/db";
import { LocalStorageCache } from "./localCache";

const mockedSaveZippedDBFile = saveZippedDBFile as jest.MockedFunction<
  typeof saveZippedDBFile
>;

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
// only the surface LocalStorageCache actually touches (same shape as the
// localCache.replaceDBResult.test.ts shim).
const makeAdapter = () => {
  const files = new Map<string, ArrayBuffer>();
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

beforeEach(() => {
  mockedSaveZippedDBFile.mockClear();
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
});

describe("Notidian-043x: LocalStorageCache.unload disposes the debounced flush", () => {
  it("cancels a pending debounced flush so advancing timers after unload never calls saveZippedDBFile", async () => {
    const cache = new LocalStorageCache(
      "Space/.notidian/dispose-a.mkc",
      makeAdapter(),
      ["file"]
    );
    await cache.initialize();

    await cache.store("a.md", "{}", "file");
    // A flush is now pending on the 5s debounce timer.
    await cache.unload();

    await jest.advanceTimersByTimeAsync(10000);

    expect(mockedSaveZippedDBFile).not.toHaveBeenCalled();
  });

  it("is idempotent: calling unload twice does not throw and closes the db only once", async () => {
    const cache = new LocalStorageCache(
      "Space/.notidian/dispose-b.mkc",
      makeAdapter(),
      ["file"]
    );
    await cache.initialize();
    const closeSpy = jest.spyOn(cache.db, "close");

    await cache.unload();
    await cache.unload();

    expect(closeSpy).toHaveBeenCalledTimes(1);
  });

  it("lets an in-flight flush (timer already fired) complete, but schedules no successor", async () => {
    const cache = new LocalStorageCache(
      "Space/.notidian/dispose-c.mkc",
      makeAdapter(),
      ["file"]
    );
    await cache.initialize();

    await cache.store("a.md", "{}", "file");
    // Fire the trailing edge of the debounce so the flush is already in flight.
    await jest.advanceTimersByTimeAsync(5000);
    expect(mockedSaveZippedDBFile).toHaveBeenCalledTimes(1);

    await cache.unload();

    // No successor scheduled: further time advancement never triggers another flush.
    await jest.advanceTimersByTimeAsync(10000);
    expect(mockedSaveZippedDBFile).toHaveBeenCalledTimes(1);
  });

  it("late store()/remove() calls after unload never re-schedule a flush", async () => {
    const cache = new LocalStorageCache(
      "Space/.notidian/dispose-d.mkc",
      makeAdapter(),
      ["file"]
    );
    await cache.initialize();
    await cache.unload();

    await cache.store("late.md", "{}", "file");
    await cache.remove("late.md", "file");

    await jest.advanceTimersByTimeAsync(10000);
    expect(mockedSaveZippedDBFile).not.toHaveBeenCalled();
  });
});
