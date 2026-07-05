import fs from "fs";
import path from "path";
import initSqlJs from "sql.js";
import type { Database, SqlJsStatic } from "sql.js";

// ===========================================================================
// Notidian-g6f5 -- initiateDB(db) called replaceDB(db, { vault: vaultSchema })
// without checking its boolean result. vaultSchema is a fixed constant
// (non-empty cols: path/parent/created/sticker/color/folder/rank/name), so
// the empty-cols-with-rows refusal (Notidian-jn8p) can never fire here.
// initiateDB has ZERO callers anywhere in this repo today (grep across
// src/**/*.ts and every *.test.ts) -- this is a forward-looking correctness
// fix so any future caller gets an honest boolean instead of `undefined`,
// mirroring the saveDBToPath/saveZippedDBToPath contract (Notidian-jn41).
// ===========================================================================

jest.mock("adapters/mdb/db/db", () => {
  const actual = jest.requireActual("adapters/mdb/db/db");
  return {
    ...actual,
    replaceDB: jest.fn(actual.replaceDB),
  };
});

const actualDb = jest.requireActual("adapters/mdb/db/db");
import { replaceDB } from "adapters/mdb/db/db";
import { initiateDB } from "./mdb";

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

describe("Notidian-g6f5: initiateDB honors replaceDB's boolean result", () => {
  let db: Database;
  let warnSpy: jest.SpyInstance;

  beforeEach(() => {
    db = new SQL.Database();
    mockedReplaceDB.mockReset();
    mockedReplaceDB.mockImplementation(actualDb.replaceDB);
    warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    db.close();
    warnSpy.mockRestore();
  });

  it("happy path: seeds the vault table, returns true, and never warns", () => {
    const result = initiateDB(db);
    expect(result).toBe(true);
    expect(warnSpy).not.toHaveBeenCalled();

    const tables =
      db
        .exec("SELECT name FROM sqlite_master WHERE type='table';")[0]
        ?.values.map((r) => r[0] as string) ?? [];
    expect(tables).toContain("vault");
  });

  it("failure path: returns false and warns when replaceDB fails", () => {
    mockedReplaceDB.mockReturnValueOnce(false);
    const result = initiateDB(db);
    expect(result).toBe(false);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("Failed to initiate DB")
    );
  });
});
