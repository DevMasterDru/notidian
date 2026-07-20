import JSZip from "jszip";
import { LocalStorageCache } from "../../localCache/localCache";
import { getDB, getZippedDB, replaceDB, saveDBFile, saveDBToPath } from "../db";
import { quoteIdent } from "../../../../shared/utils/sanitizers";

type TableState = {
  cols: string[];
  rows: string[][];
};

type DBState = {
  tables: Record<string, TableState>;
};

const emptyState = (): DBState => ({ tables: {} });

const encodeState = (state: DBState): ArrayBuffer => {
  const bytes = Buffer.from(JSON.stringify(state), "utf8");
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
};

const decodeState = (bytes?: Uint8Array): DBState => {
  if (!bytes || bytes.length === 0) return emptyState();
  const text = Buffer.from(bytes).toString("utf8");
  if (!text.startsWith("{")) return emptyState();
  return JSON.parse(text);
};

const parseQuotedIdent = (sql: string, start: number): { ident: string; end: number } => {
  if (sql[start] !== '"') {
    throw new Error(`expected quoted identifier in ${sql}`);
  }
  let ident = "";
  let i = start + 1;
  while (i < sql.length) {
    const char = sql[i];
    if (char === '"') {
      if (sql[i + 1] === '"') {
        ident += '"';
        i += 2;
        continue;
      }
      return { ident, end: i + 1 };
    }
    ident += char;
    i += 1;
  }
  throw new Error(`unterminated quoted identifier in ${sql}`);
};

const parseSingleQuotedIdent = (sql: string, start: number): { ident: string; end: number } => {
  if (sql[start] !== "'") {
    throw new Error(`expected single-quoted identifier in ${sql}`);
  }
  let ident = "";
  let i = start + 1;
  while (i < sql.length) {
    const char = sql[i];
    if (char === "'") {
      if (sql[i + 1] === "'") {
        ident += "'";
        i += 2;
        continue;
      }
      return { ident, end: i + 1 };
    }
    ident += char;
    i += 1;
  }
  throw new Error(`unterminated single-quoted identifier in ${sql}`);
};

const parseTableIdentAfter = (sql: string, prefix: RegExp) => {
  const match = sql.match(prefix);
  if (!match || match.index === undefined) {
    throw new Error(`missing table identifier in ${sql}`);
  }
  const start = match.index + match[0].length;
  return parseQuotedIdent(sql, start);
};

const splitSQLList = (value: string): string[] => {
  const result: string[] = [];
  let current = "";
  let quote: string | null = null;
  for (let i = 0; i < value.length; i += 1) {
    const char = value[i];
    if (quote) {
      current += char;
      if (char === quote) {
        if (value[i + 1] === quote) {
          current += value[i + 1];
          i += 1;
        } else {
          quote = null;
        }
      }
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      current += char;
      continue;
    }
    if (char === ",") {
      result.push(current.trim());
      current = "";
      continue;
    }
    current += char;
  }
  if (current.trim()) result.push(current.trim());
  return result;
};

const parseCreateColumns = (sql: string): string[] => {
  const start = sql.indexOf("(");
  const end = sql.lastIndexOf(")");
  if (start === -1 || end === -1 || end <= start) return [];
  return splitSQLList(sql.slice(start + 1, end)).map((field) => {
    const trimmed = field.trim();
    const parsed =
      trimmed[0] === "'"
        ? parseSingleQuotedIdent(trimmed, 0)
        : parseQuotedIdent(trimmed, 0);
    if (!/^\s+char\b/i.test(trimmed.slice(parsed.end))) {
      throw new Error(`invalid column definition in ${sql}`);
    }
    return parsed.ident;
  });
};

const parseValues = (sql: string): string[] => {
  // ADR 0045 (Notidian-k778): replaceDB now emits an EXPLICIT column list
  // (`REPLACE INTO "t" ("a","b") VALUES (...)`). Anchor on the VALUES clause so
  // the optional preceding column-list parens are not mistaken for the value
  // tuple. insertIntoDB's bare `... VALUES (...)` form also matches.
  const valuesMatch = sql.match(/\bVALUES\s*\(/i);
  const start = valuesMatch && valuesMatch.index !== undefined
    ? valuesMatch.index + valuesMatch[0].length - 1
    : sql.indexOf("(");
  const end = sql.lastIndexOf(")");
  if (start === -1 || end === -1 || end <= start) return [];
  return splitSQLList(sql.slice(start + 1, end)).map((value) => {
    const trimmed = value.trim();
    if (trimmed[0] !== "'" || trimmed[trimmed.length - 1] !== "'") {
      throw new Error(`invalid SQL value in ${sql}`);
    }
    return trimmed.slice(1, -1).replace(/''/g, "'");
  });
};

class StatefulFakeDB {
  public state: DBState;
  public statements: string[] = [];

  constructor(bytes?: Uint8Array) {
    this.state = decodeState(bytes);
  }

  exec(sql: string) {
    this.statements.push(sql);
    const statements = sql
      .split(";")
      .map((statement) => statement.trim())
      .filter(Boolean);
    let result: unknown[] = [];
    for (const statement of statements) {
      result = this.execOne(statement);
    }
    return result as any[];
  }

  private execOne(sql: string): unknown[] {
    if (/^SELECT name FROM sqlite_(schema|master)\b/i.test(sql)) {
      return [
        {
          columns: ["name"],
          values: Object.keys(this.state.tables).map((name) => [name]),
        },
      ];
    }
    if (/^DROP INDEX\b/i.test(sql) || /^CREATE UNIQUE INDEX\b/i.test(sql)) {
      return [];
    }
    if (/^BEGIN TRANSACTION$/i.test(sql) || /^COMMIT$/i.test(sql)) {
      return [];
    }
    if (/^DROP TABLE IF EXISTS\b/i.test(sql)) {
      const parsed = parseTableIdentAfter(sql, /^DROP TABLE IF EXISTS\s+/i);
      if (sql.slice(parsed.end).trim()) throw new Error(`invalid table identifier in ${sql}`);
      delete this.state.tables[parsed.ident];
      return [];
    }
    if (/^CREATE TABLE IF NOT EXISTS\b/i.test(sql)) {
      const parsed = parseTableIdentAfter(sql, /^CREATE TABLE IF NOT EXISTS\s+/i);
      if (sql.slice(parsed.end).trim()[0] !== "(") {
        throw new Error(`invalid table identifier in ${sql}`);
      }
      this.state.tables[parsed.ident] = {
        cols: parseCreateColumns(sql),
        rows: [],
      };
      return [];
    }
    if (/^CREATE TABLE\b/i.test(sql)) {
      const parsed = parseTableIdentAfter(sql, /^CREATE TABLE\s+/i);
      if (sql.slice(parsed.end).trim()[0] !== "(") {
        throw new Error(`invalid table identifier in ${sql}`);
      }
      this.state.tables[parsed.ident] = {
        cols: parseCreateColumns(sql),
        rows: [],
      };
      return [];
    }
    if (/^REPLACE INTO\b/i.test(sql)) {
      const parsed = parseTableIdentAfter(sql, /^REPLACE INTO\s+/i);
      const table = this.state.tables[parsed.ident];
      if (!table) throw new Error(`missing table ${parsed.ident}`);
      table.rows.push(parseValues(sql));
      return [];
    }
    throw new Error(`unsupported SQL in fake DB: ${sql}`);
  }

  export() {
    return { buffer: encodeState(this.state) };
  }

  close() {}
}

const fakeSqlJS = { Database: StatefulFakeDB } as any;

class ConstructorCorruptFakeDB extends StatefulFakeDB {
  constructor(bytes?: Uint8Array) {
    if (bytes?.[0] === 0xfe) {
      throw new Error("file is not a database");
    }
    super(bytes);
  }
}

const constructorCorruptSqlJS = { Database: ConstructorCorruptFakeDB } as any;

const constructorCorruptBytes = () => {
  const bytes = new Uint8Array([0xfe, 0x01, 0x02]);
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
};

const zippedConstructorCorruptBytes = async () => {
  const zip = new JSZip();
  zip.file("data.mdb", constructorCorruptBytes());
  return zip.generateAsync({ type: "arraybuffer" });
};

describe("W1: MDB storage hardening", () => {
  it("writes a same-directory temp file before replacing the DB target", async () => {
    const events: Array<{ op: string; path: string; to?: string }> = [];
    const plugin = {
      middleware: {
        // Notidian-euqe: the parent folder exists but the DB target itself
        // does not (a first-time write) -- the rename fast-path is only
        // attempted for an absent destination, so this must distinguish the
        // two rather than answering `true` for every path.
        fileExists: jest.fn(async (p: string) => p !== "folder/ctx.mdb"),
        createFolder: jest.fn(async () => {}),
        writeBinaryToFile: jest.fn(async (path: string) => {
          events.push({ op: "write", path });
        }),
        renameFile: jest.fn(async (path: string, to: string) => {
          events.push({ op: "rename", path, to });
          return to;
        }),
      },
    } as any;

    await saveDBFile(plugin, "folder/ctx.mdb", encodeState(emptyState()));

    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({ op: "write" });
    expect(events[0].path).toMatch(/^folder\/ctx\.mdb\.tmp-/);
    expect(events[1]).toEqual({
      op: "rename",
      path: events[0].path,
      to: "folder/ctx.mdb",
    });
    expect(events.some((event) => event.op === "write" && event.path === "folder/ctx.mdb")).toBe(
      false
    );
  });

  it("serializes same-path saveDBToPath calls so the second save keeps the first write", async () => {
    let stored = encodeState(emptyState());
    const temps = new Map<string, ArrayBuffer>();
    let targetWrites = 0;
    let targetRenames = 0;
    let firstReplaceStarted!: () => void;
    let releaseFirstReplace!: () => void;
    const firstReplaceStartedPromise = new Promise<void>((resolve) => {
      firstReplaceStarted = resolve;
    });
    const releaseFirstReplacePromise = new Promise<void>((resolve) => {
      releaseFirstReplace = resolve;
    });
    let firstReplaceInProgress = false;
    let secondReadDuringFirstReplace!: () => void;
    const secondReadDuringFirstReplacePromise = new Promise<void>((resolve) => {
      secondReadDuringFirstReplace = resolve;
    });
    const plugin = {
      sqlJS: async () => fakeSqlJS,
      middleware: {
        fileExists: jest.fn(async (path: string) => path === "" || path === "/" || path === "ctx.mdb" || temps.has(path)),
        createFolder: jest.fn(async () => {}),
        readBinaryToFile: jest.fn(async (path: string) => {
          if (path === "ctx.mdb" && firstReplaceInProgress) {
            secondReadDuringFirstReplace();
          }
          return temps.get(path) ?? stored;
        }),
        writeBinaryToFile: jest.fn(async (path: string, bytes: ArrayBuffer) => {
          if (path === "ctx.mdb") {
            targetWrites += 1;
            if (targetWrites === 1) {
              firstReplaceInProgress = true;
              firstReplaceStarted();
              await releaseFirstReplacePromise;
              firstReplaceInProgress = false;
            }
            stored = bytes;
            return;
          }
          temps.set(path, bytes);
        }),
        renameFile: jest.fn(async (path: string, to: string) => {
          if (to === "ctx.mdb") {
            targetRenames += 1;
            if (targetRenames === 1) {
              firstReplaceInProgress = true;
              firstReplaceStarted();
              await releaseFirstReplacePromise;
              firstReplaceInProgress = false;
            }
            stored = temps.get(path) ?? stored;
          }
          temps.delete(path);
          return to;
        }),
      },
    } as any;

    const first = saveDBToPath(plugin, "ctx.mdb", {
      first: { cols: ["id"], rows: [{ id: "1" }], uniques: [] },
    } as any);
    await firstReplaceStartedPromise;
    const second = saveDBToPath(plugin, "ctx.mdb", {
      second: { cols: ["id"], rows: [{ id: "2" }], uniques: [] },
    } as any);

    await Promise.race([
      secondReadDuringFirstReplacePromise,
      new Promise((resolve) => setTimeout(resolve, 10)),
    ]);
    releaseFirstReplace();
    await Promise.all([first, second]);

    const finalTables = decodeState(new Uint8Array(stored)).tables;
    expect(Object.keys(finalTables)).toEqual(
      expect.arrayContaining(["first", "second"])
    );
  });

  it("quotes SQL identifiers without dropping embedded quotes", () => {
    expect(quoteIdent('schema"table')).toBe('"schema""table"');

    const db = new StatefulFakeDB();
    const result = replaceDB(db as any, {
      'schema"table': {
        cols: ['col"name'],
        rows: [{ 'col"name': "value" }],
        uniques: ['col"name'],
      },
    } as any);

    expect(result).toBe(true);
    expect(db.state.tables['schema"table'].cols).toEqual(['col"name']);
    expect(db.statements.join("\n")).toContain('"schema""table"');
    expect(db.statements.join("\n")).toContain('"col""name"');
  });

  it("serializes local cache direct zipped flushes through the per-path write queue", async () => {
    const events: Array<{ op: string; path: string; to?: string }> = [];
    let firstRenameStarted!: () => void;
    let releaseFirstRename!: () => void;
    const firstRenameStartedPromise = new Promise<void>((resolve) => {
      firstRenameStarted = resolve;
    });
    const releaseFirstRenamePromise = new Promise<void>((resolve) => {
      releaseFirstRename = resolve;
    });
    let renameCount = 0;
    const plugin = {
      middleware: {
        fileExists: jest.fn(async (path: string) => path === "" || path === "/" || path.includes(".tmp-")),
        createFolder: jest.fn(async () => {}),
        writeBinaryToFile: jest.fn(async (path: string) => {
          events.push({ op: "write", path });
        }),
        renameFile: jest.fn(async (path: string, to: string) => {
          events.push({ op: "rename", path, to });
          renameCount += 1;
          if (renameCount === 1) {
            firstRenameStarted();
            await releaseFirstRenamePromise;
          }
          return to;
        }),
      },
    } as any;
    const makeCache = () => {
      const cache = new LocalStorageCache("cache.mdc", plugin, ["files"]);
      (cache as any).db = {
        export: () => ({ buffer: encodeState(emptyState()) }),
      };
      return cache as any;
    };
    const firstCache = makeCache();
    const secondCache = makeCache();
    const pendingFlushes: Array<Promise<void> | undefined> = [];
    const flushCacheSave = (cache: any) => {
      jest.useFakeTimers();
      try {
        cache.debounceSaveSpaceDatabase();
        return cache.debounceSaveSpaceDatabase.flush();
      } finally {
        jest.clearAllTimers();
        jest.useRealTimers();
      }
    };

    pendingFlushes.push(flushCacheSave(firstCache));
    await firstRenameStartedPromise;

    pendingFlushes.push(flushCacheSave(secondCache));
    await new Promise((resolve) => setTimeout(resolve, 0));

    try {
      expect(events.filter((event) => event.op === "write" && event.path.includes(".tmp-"))).toHaveLength(1);
    } finally {
      releaseFirstRename();
      await Promise.all(pendingFlushes.filter(Boolean));
    }

    expect(events.filter((event) => event.op === "rename")).toHaveLength(2);
  });

  it("returns null from read helpers instead of exposing a fresh DB for constructor-corrupt files", async () => {
    const zippedBytes = await zippedConstructorCorruptBytes();
    const makePlugin = (bytes: ArrayBuffer) =>
      ({
        middleware: {
          fileExists: jest.fn(async () => true),
          readBinaryToFile: jest.fn(async () => bytes),
        },
      }) as any;

    await expect(
      getDB(makePlugin(constructorCorruptBytes()), constructorCorruptSqlJS, "ctx.mdb")
    ).resolves.toBeNull();
    await expect(
      getZippedDB(makePlugin(zippedBytes), constructorCorruptSqlJS, "cache.mdc")
    ).resolves.toBeNull();
  });

  // Notidian-euqe: rewritten from "cleans up a temporary DB file when atomic
  // rename fails" (which asserted the OLD, buggy contract: any rename
  // failure -- even for an absent destination -- escaped saveDBFile
  // uncaught, and the non-atomic fallback at db.ts:257-259 was never
  // reached). The binding design is that ANY rename throw (not just
  // Obsidian's specific "Destination file already exists!") falls through
  // to the fallback rather than escaping, so a generic rename failure
  // (destination absent) must still be RESCUED by the fallback, not just
  // cleaned up after a rejection.
  it("rescues the save via the fallback when the atomic rename throws for a reason other than an existing destination, and still cleans up the temp file", async () => {
    const files = new Map<string, ArrayBuffer>();
    const writeLog: string[] = [];
    const plugin = {
      sqlJS: async () => fakeSqlJS,
      middleware: {
        fileExists: jest.fn(async (path: string) => path === "folder" || files.has(path)),
        createFolder: jest.fn(async () => {}),
        readBinaryToFile: jest.fn(async (path: string) => files.get(path)),
        writeBinaryToFile: jest.fn(async (path: string, bytes: ArrayBuffer) => {
          writeLog.push(path);
          files.set(path, bytes);
        }),
        renameFile: jest.fn(async () => {
          throw new Error("rename failed");
        }),
        deleteFile: jest.fn(async (path: string) => {
          files.delete(path);
        }),
      },
    } as any;

    await expect(
      saveDBFile(plugin, "folder/ctx.mdb", encodeState(emptyState()))
    ).resolves.toBeUndefined();

    // The rename fast-path WAS attempted (destination was absent) and threw,
    // but that failure never escaped -- the fallback rescued the write.
    expect(plugin.middleware.renameFile).toHaveBeenCalledTimes(1);
    expect(plugin.middleware.deleteFile).toHaveBeenCalledTimes(1);
    expect(writeLog.some((p) => p.includes(".tmp-"))).toBe(true);
    expect(files.has("folder/ctx.mdb")).toBe(true);
    expect([...files.keys()].some((p) => p.includes(".tmp-"))).toBe(false);
  });
});
