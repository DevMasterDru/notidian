// ===========================================================================
// Notidian-b6lv -- same leak shape as Notidian-043x (localCache.dispose.test.ts)
// but for the mobile persister's own hand-rolled debounce. Nothing cancelled
// MobileCachePersister's debounced flush (localCacheMobile.ts's
// debounceSaveSpaceDatabase, 2000ms) on unload(), so it kept firing
// saveZippedDBToPath after plugin:reload discarded the instance, racing the
// freshly reloaded instance's own writes to the same .notidian/*.mdc path.
//
// unload() must:
//   (a) cancel any pending debounced flush -- advancing timers afterwards
//       must never invoke saveZippedDBToPath.
//   (b) be idempotent -- calling it twice must not throw.
//   (c) let an already in-flight flush (timer already fired) complete, but
//       never schedule a successor afterwards.
//   (d) make any post-unload store()/remove() call a no-op, so no new flush
//       can ever be scheduled again.
// ===========================================================================

// saveZippedDBFile is mocked too (not just saveZippedDBToPath): it's what
// initialize()'s schema-seed write uses, and its real implementation shells
// out to JSZip's generateAsync, which internally yields via setTimeout --
// that hangs forever under this file's fake timers unless stubbed out.
jest.mock("adapters/mdb/db/db", () => {
  const actual = jest.requireActual("adapters/mdb/db/db");
  return {
    ...actual,
    saveZippedDBFile: jest.fn(async (): Promise<void> => undefined),
    saveZippedDBToPath: jest.fn(async (): Promise<boolean> => true),
  };
});

import fs from "fs";
import path from "path";
import initSqlJs from "sql.js";
import type { SqlJsStatic } from "sql.js";
import { saveZippedDBToPath } from "adapters/mdb/db/db";
import { MobileCachePersister } from "./localCacheMobile";

const mockedSaveZippedDBToPath = saveZippedDBToPath as jest.MockedFunction<
  typeof saveZippedDBToPath
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
// only the surface MobileCachePersister actually touches (same shape as the
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
  mockedSaveZippedDBToPath.mockClear();
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
});

describe("Notidian-b6lv: MobileCachePersister.unload disposes the debounced flush", () => {
  it("cancels a pending debounced flush so advancing timers after unload never calls saveZippedDBToPath", async () => {
    const cache = new MobileCachePersister(
      "Space/.notidian/mobile-dispose-a.mdc",
      makeAdapter(),
      ["file"]
    );
    await cache.initialize();

    await cache.store("a.md", "{}", "file");
    // A flush is now pending on the 2s debounce timer.
    cache.unload();

    await jest.advanceTimersByTimeAsync(10000);

    expect(mockedSaveZippedDBToPath).not.toHaveBeenCalled();
  });

  it("is idempotent: calling unload twice does not throw", async () => {
    const cache = new MobileCachePersister(
      "Space/.notidian/mobile-dispose-b.mdc",
      makeAdapter(),
      ["file"]
    );
    await cache.initialize();

    expect(() => {
      cache.unload();
      cache.unload();
    }).not.toThrow();
    expect(cache.isInitialized()).toBe(false);
  });

  it("lets an in-flight flush (timer already fired) complete, but schedules no successor", async () => {
    const cache = new MobileCachePersister(
      "Space/.notidian/mobile-dispose-c.mdc",
      makeAdapter(),
      ["file"]
    );
    await cache.initialize();

    await cache.store("a.md", "{}", "file");
    // Fire the trailing edge of the debounce so the flush is already in flight.
    await jest.advanceTimersByTimeAsync(2000);
    expect(mockedSaveZippedDBToPath).toHaveBeenCalledTimes(1);

    cache.unload();

    // No successor scheduled: further time advancement never triggers another flush.
    await jest.advanceTimersByTimeAsync(10000);
    expect(mockedSaveZippedDBToPath).toHaveBeenCalledTimes(1);
  });

  it("late store()/remove() calls after unload never re-schedule a flush", async () => {
    const cache = new MobileCachePersister(
      "Space/.notidian/mobile-dispose-d.mdc",
      makeAdapter(),
      ["file"]
    );
    await cache.initialize();
    cache.unload();

    await cache.store("late.md", "{}", "file");
    await cache.remove("late.md", "file");

    await jest.advanceTimersByTimeAsync(10000);
    expect(mockedSaveZippedDBToPath).not.toHaveBeenCalled();
  });
});
