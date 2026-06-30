import fs from "fs";
import path from "path";
import initSqlJs from "sql.js";
import { replaceDB, selectDB } from "./db";
import { uniq } from "shared/utils/array";
import type { DBTables } from "shared/types/mdb";
import type { Database, SqlJsStatic } from "sql.js";

// ===========================================================================
// PRNG-driven property tests for replaceDB -> selectDB round-trip
// (Notidian-e92d) — DEPTH hardening that proves general invariants over the
// full distribution of table shapes, column names, and row values against the
// real sql.js engine.
//
// The existing db.realengine.roundtrip.test.ts (Notidian-0jtp) pins 34 FIXED
// adversarial cases. This complement uses a seeded PRNG (Mulberry32) to
// generate 500+ random table shapes and proves four invariants:
//
//   LOSSLESS:    every value survives replaceDB -> selectDB; the readback
//                equals the input with NUL bytes stripped. sanitizeSQLStatement
//                doubles single quotes for SQL string escaping, but the engine
//                stores the original value — the readback is the input with
//                NUL stripped, NOT sanitizeSQLStatement(input).
//                (Confirmed by db.realengine.roundtrip.test.ts line 106:
//                `expect(sel!.rows[0].v).toBe(v)` — value round-trips as-is,
//                and the NUL test at line 541: `"a\x00b"` -> `"ab"`.)
//   TOTAL:       replaceDB never returns false on PRNG-generated data.
//                selectDB never returns null when the table has >= 1 row.
//                (Note: selectDB returns null for 0-row tables because sql.js
//                returns an empty QueryExecResult[] for SELECT on an empty
//                table — this is expected sql.js behavior, not data loss.)
//   CONSISTENT:  the column count in the readback matches the expected liveCols
//                count (uniq + falsy-filter of the input cols).
//   STABLE:      two consecutive replaceDB calls with the same input produce
//                byte-identical readback (no nondeterminism).
//
// All random generation is deterministic (seeded), so failures reproduce by
// seed alone. No UNIQUE constraints are used in the core invariant tests —
// the unique-index path is already well-tested in the existing roundtrip test
// (section 4, 3 cases). This separation isolates VALUE/COLUMN fidelity from
// the REPLACE-conflict deduplication path, which changes row order and count.
// ===========================================================================

// --- Real sql.js engine bootstrap (same as roundtrip test) ---
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

const freshDB = (): Database => new SQL.Database();

// --- Mulberry32 seeded PRNG ---
// Returns a function that yields [0, 1) deterministically from a 32-bit seed.
function mulberry32(seed: number): () => number {
  let t = seed | 0;
  return () => {
    t = (t + 0x6d2b79f5) | 0;
    let x = Math.imul(t ^ (t >>> 15), 1 | t);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

// --- Random generation helpers ---
const randInt = (rng: () => number, lo: number, hi: number): number =>
  lo + Math.floor(rng() * (hi - lo + 1));

const randChoice = <T>(rng: () => number, arr: readonly T[]): T =>
  arr[Math.floor(rng() * arr.length)];

// The canonical transform that a value undergoes through the round-trip:
// NUL (0x00) stripping only. sanitizeSQLStatement also doubles single quotes,
// but that is SQL string escaping — the engine stores the original value with
// quotes undoubled. The readback is NUL-stripped input.
const expectedReadback = (input: string): string =>
  (input ?? "").replace(/\x00/g, "");

// --- Character pools for adversarial generation ---

// NOTE: all ASCII letters are lowercase to avoid SQLite's case-insensitive
// identifier collision (SQLite treats "A" and "a" as the same column name, but
// JavaScript Set considers them distinct — so uniq() won't dedup them, and
// CREATE TABLE throws "duplicate column name"). Unicode is unaffected (SQLite
// only folds ASCII case without ICU). SQL keywords are lowercase to match.
const IDENT_ATOMS: readonly string[] = [
  // Alphanumeric (lowercase only — see note above)
  "a", "b", "z", "0", "9",
  // Unicode: CJK, accents, emoji, zero-width space
  "世", "界", "é", "ü", "ñ",
  "😀", "​",
  // Double quote (the identifier escape char)
  '"',
  // SQL keywords (lowercase — as raw text in an identifier)
  "select", "drop", "table", "insert", "delete", "where", "from",
  // Structural chars
  "_", "$", ".", "-",
  // Empty (will be filtered by liveCols)
  "",
];

const VALUE_ATOMS: readonly string[] = [
  // Single quote (the value escape char)
  "'",
  // Double quote
  '"',
  // Semicolons, newlines, backslashes
  ";", "\n", "\r", "\\",
  // SQL comment markers
  "--", "/*", "*/",
  // Multi-byte Unicode
  "世界", "😀", "é",
  // Control chars (non-NUL)
  "\x01", "\x1f", "\x7f",
  // NUL (will be stripped by sanitizeSQLStatement / ADR 0047 B)
  "\x00",
  // Alphanumeric
  "a", "Z", "0", "9",
  // Empty
  "",
  // Boolean/number/date lookalikes
  "true", "false", "null", "0", "1", "3.14", "2026-06-30",
  // Injection payloads
  "'); DROP TABLE victim; --",
  "x\"; DROP TABLE t; --",
  // Whitespace
  " ", "  \t  ",
];

/** Generate a random column name from IDENT_ATOMS (1-4 atoms concatenated). */
const randomColName = (rng: () => number): string => {
  const len = randInt(rng, 1, 4);
  let name = "";
  for (let i = 0; i < len; i++) {
    name += randChoice(rng, IDENT_ATOMS);
  }
  return name;
};

/** Generate a random cell value from VALUE_ATOMS (1-5 atoms concatenated),
 * with a 5% chance of producing a long string (1000-2000 chars). */
const randomValue = (rng: () => number): string => {
  if (rng() < 0.05) {
    const longLen = randInt(rng, 1000, 2000);
    let s = "";
    for (let i = 0; i < longLen; i++) {
      s += randChoice(rng, VALUE_ATOMS);
    }
    return s;
  }
  const parts = randInt(rng, 1, 5);
  let result = "";
  for (let i = 0; i < parts; i++) {
    result += randChoice(rng, VALUE_ATOMS);
  }
  return result;
};

/**
 * Compute the expected liveCols for a given input cols array,
 * matching replaceDB's pipeline: uniq(cols).filter(f => f).
 */
const expectedLiveCols = (cols: string[]): string[] =>
  uniq(cols).filter((f: string) => f);

/**
 * Generate a random DBTables entry with a single table.
 * @param rng Seeded PRNG
 * @param minRows Minimum row count (default 1; avoids the 0-row selectDB=null edge)
 * @param maxRows Maximum row count (default 50)
 * @param maxCols Maximum raw column count (default 30)
 */
const randomTable = (
  rng: () => number,
  minRows = 1,
  maxRows = 50,
  maxCols = 30,
): { cols: string[]; rows: Record<string, string>[]; liveCols: string[] } => {
  const colCount = randInt(rng, 1, maxCols);
  const rawCols: string[] = [];
  for (let i = 0; i < colCount; i++) {
    rawCols.push(randomColName(rng));
  }

  // If liveCols is empty (all cols were falsy), add a guaranteed non-empty col
  if (expectedLiveCols(rawCols).length === 0) {
    rawCols.push("_fallback_col");
  }

  const liveCols = expectedLiveCols(rawCols);

  const rowCount = randInt(rng, minRows, maxRows);
  const rows: Record<string, string>[] = [];
  for (let i = 0; i < rowCount; i++) {
    const row: Record<string, string> = {};
    for (const col of liveCols) {
      row[col] = randomValue(rng);
    }
    rows.push(row);
  }

  return { cols: rawCols, rows, liveCols };
};

const TABLE_NAME = "prng_t";

// =========================================================================
// INVARIANT 1: LOSSLESS — every value survives replaceDB -> selectDB.
// The readback for each cell equals the input with NUL bytes stripped.
// =========================================================================
describe("PRNG property: LOSSLESS — values survive replaceDB -> selectDB round-trip (500 shapes)", () => {
  const ITERATIONS = 500;
  const SEED = 0xdeadbeef;

  it(`${ITERATIONS} random table shapes round-trip all values losslessly`, () => {
    const rng = mulberry32(SEED);

    for (let i = 0; i < ITERATIONS; i++) {
      const { cols, rows, liveCols } = randomTable(rng);

      const db = freshDB();
      try {
        const tables: DBTables = {
          [TABLE_NAME]: { uniques: [], cols, rows },
        };

        const ok = replaceDB(db, tables);
        if (!ok) {
          throw new Error(
            `LOSSLESS/replaceDB returned false at seed=0x${SEED.toString(16)} iter=${i}, ` +
            `cols=${JSON.stringify(cols)}`
          );
        }

        const sel = selectDB(db, TABLE_NAME);
        if (!sel) {
          throw new Error(
            `LOSSLESS/selectDB returned null at seed=0x${SEED.toString(16)} iter=${i}`
          );
        }

        expect(sel.cols.length).toBe(liveCols.length);
        expect(sel.rows.length).toBe(rows.length);

        // Value fidelity: readback == input with NUL stripped
        for (let r = 0; r < rows.length; r++) {
          for (const col of liveCols) {
            const inputVal = rows[r][col] ?? "";
            const expected = expectedReadback(inputVal);
            const actual = sel.rows[r][col];
            if (actual !== expected) {
              throw new Error(
                `LOSSLESS violation at seed=0x${SEED.toString(16)} iter=${i} row=${r} ` +
                `col=${JSON.stringify(col)}: ` +
                `expected ${JSON.stringify(expected)} but got ${JSON.stringify(actual)}`
              );
            }
          }
        }
      } finally {
        db.close();
      }
    }
  });
});

// =========================================================================
// INVARIANT 2: TOTAL — replaceDB never returns false and selectDB never
// returns null on a table with >= 1 row.
// =========================================================================
describe("PRNG property: TOTAL — replaceDB succeeds and selectDB returns non-null (500 shapes)", () => {
  const ITERATIONS = 500;
  const SEED = 0xcafebabe;

  it(`${ITERATIONS} random shapes: replaceDB returns true and selectDB returns non-null`, () => {
    const rng = mulberry32(SEED);

    for (let i = 0; i < ITERATIONS; i++) {
      const { cols, rows } = randomTable(rng);

      const db = freshDB();
      try {
        const tables: DBTables = {
          [TABLE_NAME]: { uniques: [], cols, rows },
        };

        const ok = replaceDB(db, tables);
        if (ok !== true) {
          throw new Error(
            `TOTAL violation (replaceDB returned false) at seed=0xcafebabe iter=${i}, ` +
            `cols=${JSON.stringify(cols)}, rows=${rows.length}`
          );
        }

        const sel = selectDB(db, TABLE_NAME);
        if (sel === null) {
          throw new Error(
            `TOTAL violation (selectDB returned null) at seed=0xcafebabe iter=${i}, ` +
            `cols=${JSON.stringify(cols)}, rows=${rows.length}`
          );
        }
      } finally {
        db.close();
      }
    }
  });
});

// =========================================================================
// INVARIANT 3: CONSISTENT — the column count in the readback matches the
// expected liveCols count (uniq + falsy-filter).
// =========================================================================
describe("PRNG property: CONSISTENT — readback column count matches liveCols (500 shapes)", () => {
  const ITERATIONS = 500;
  const SEED = 0xfeedface;

  it(`${ITERATIONS} random shapes: selectDB column count equals liveCols count`, () => {
    const rng = mulberry32(SEED);

    for (let i = 0; i < ITERATIONS; i++) {
      const { cols, rows, liveCols } = randomTable(rng);

      const db = freshDB();
      try {
        const tables: DBTables = {
          [TABLE_NAME]: { uniques: [], cols, rows },
        };

        const ok = replaceDB(db, tables);
        if (!ok) {
          throw new Error(
            `CONSISTENT/replaceDB returned false at seed=0xfeedface iter=${i}, ` +
            `cols=${JSON.stringify(cols)}`
          );
        }

        const sel = selectDB(db, TABLE_NAME);
        if (!sel) {
          throw new Error(
            `CONSISTENT/selectDB returned null at seed=0xfeedface iter=${i}`
          );
        }

        if (sel.cols.length !== liveCols.length) {
          throw new Error(
            `CONSISTENT violation at seed=0xfeedface iter=${i}: ` +
            `expected ${liveCols.length} cols but got ${sel.cols.length}. ` +
            `inputCols=${JSON.stringify(cols)}, liveCols=${JSON.stringify(liveCols)}`
          );
        }
      } finally {
        db.close();
      }
    }
  });
});

// =========================================================================
// INVARIANT 4: STABLE — two consecutive replaceDB calls with the same input
// produce byte-identical readback (no nondeterminism).
// =========================================================================
describe("PRNG property: STABLE — consecutive replaceDB calls produce identical readback (500 shapes)", () => {
  const ITERATIONS = 500;
  const SEED = 0xba5eba11;

  it(`${ITERATIONS} random shapes: two replaceDB calls yield identical selectDB output`, () => {
    const rng = mulberry32(SEED);

    for (let i = 0; i < ITERATIONS; i++) {
      const { cols, rows } = randomTable(rng);

      const tables: DBTables = {
        [TABLE_NAME]: { uniques: [], cols, rows },
      };

      // First write
      const db1 = freshDB();
      let sel1: ReturnType<typeof selectDB>;
      try {
        expect(replaceDB(db1, tables)).toBe(true);
        sel1 = selectDB(db1, TABLE_NAME);
      } finally {
        db1.close();
      }

      // Second write (fresh DB, same input)
      const db2 = freshDB();
      let sel2: ReturnType<typeof selectDB>;
      try {
        expect(replaceDB(db2, tables)).toBe(true);
        sel2 = selectDB(db2, TABLE_NAME);
      } finally {
        db2.close();
      }

      expect(sel1).not.toBeNull();
      expect(sel2).not.toBeNull();

      if (
        JSON.stringify(sel1!.cols) !== JSON.stringify(sel2!.cols) ||
        JSON.stringify(sel1!.rows) !== JSON.stringify(sel2!.rows)
      ) {
        throw new Error(
          `STABLE violation at seed=0xba5eba11 iter=${i}: ` +
          `cols1=${JSON.stringify(sel1!.cols)} cols2=${JSON.stringify(sel2!.cols)} ` +
          `rows1Len=${sel1!.rows.length} rows2Len=${sel2!.rows.length}`
        );
      }
    }
  });
});

// =========================================================================
// ADVERSARIAL COLUMN NAMES — focused property test with maximally hostile
// identifiers (Unicode, quotes, SQL keywords, empty-after-dedup). No uniques
// to isolate column-name fidelity from the index-construction path.
// =========================================================================
describe("PRNG property: adversarial column names survive round-trip (200 shapes)", () => {
  const ITERATIONS = 200;
  const SEED = 0x12345678;

  const HOSTILE_COL_ATOMS: readonly string[] = [
    '"', '""', "SELECT", "DROP TABLE", "; --",
    "世界", "😀", "éü",
    "'", "''", "a'b", 'col"name',
    "$", "_", "__", "$_",
    "0", "123",
    'a"); DROP TABLE victim; --',
    "",
  ];

  const hostileColName = (rng: () => number): string => {
    const parts = randInt(rng, 1, 3);
    let name = "";
    for (let i = 0; i < parts; i++) {
      name += randChoice(rng, HOSTILE_COL_ATOMS);
    }
    return name;
  };

  it(`${ITERATIONS} hostile-column shapes round-trip correctly`, () => {
    const rng = mulberry32(SEED);
    let tested = 0;

    for (let i = 0; i < ITERATIONS; i++) {
      const colCount = randInt(rng, 1, 15);
      const rawCols: string[] = [];
      for (let c = 0; c < colCount; c++) {
        rawCols.push(hostileColName(rng));
      }

      if (expectedLiveCols(rawCols).length === 0) {
        rawCols.push("safe_col");
      }
      const liveCols = expectedLiveCols(rawCols);

      const rowCount = randInt(rng, 1, 10);
      const rows: Record<string, string>[] = [];
      for (let r = 0; r < rowCount; r++) {
        const row: Record<string, string> = {};
        for (const col of liveCols) {
          row[col] = randomValue(rng);
        }
        rows.push(row);
      }

      const db = freshDB();
      try {
        const tables: DBTables = {
          prng_hostile: { uniques: [], cols: rawCols, rows },
        };

        const ok = replaceDB(db, tables);
        if (!ok) {
          throw new Error(
            `Hostile-col replaceDB returned false at seed=0x12345678 iter=${i}, ` +
            `cols=${JSON.stringify(rawCols)}`
          );
        }

        const sel = selectDB(db, "prng_hostile");
        if (!sel) {
          throw new Error(
            `Hostile-col selectDB returned null at seed=0x12345678 iter=${i}`
          );
        }
        expect(sel.cols.length).toBe(liveCols.length);
        expect(sel.rows.length).toBe(rowCount);

        // Value fidelity (NUL-stripped)
        for (let r = 0; r < rows.length; r++) {
          for (const col of liveCols) {
            const expected = expectedReadback(rows[r][col] ?? "");
            const actual = sel.rows[r][col];
            if (actual !== expected) {
              throw new Error(
                `Hostile-col LOSSLESS violation at seed=0x12345678 iter=${i} row=${r} ` +
                `col=${JSON.stringify(col)}: expected ${JSON.stringify(expected)} ` +
                `got ${JSON.stringify(actual)}`
              );
            }
          }
        }
        tested++;
      } finally {
        db.close();
      }
    }

    expect(tested).toBeGreaterThanOrEqual(ITERATIONS - 5);
  });
});

// =========================================================================
// ADVERSARIAL VALUES — focused property test with maximally hostile cell
// values (injection payloads, multi-byte, NUL, extreme lengths).
// =========================================================================
describe("PRNG property: adversarial values survive round-trip (200 shapes)", () => {
  const ITERATIONS = 200;
  const SEED = 0xabcdef01;

  const HOSTILE_VALUE_ATOMS: readonly string[] = [
    "'", "''", "'''",
    "'); DROP TABLE t; --",
    '"; DROP TABLE t; --',
    "\x00", "\x00\x00\x00",
    "\x01\x02\x03\x1f",
    "a\x00b\x00c",
    "\n\r\n",
    "\\", "\\\\",
    "--", "/* */",
    "世界é😀",
    "​‌‍",  // zero-width chars
    "🏳️‍🌈", // rainbow flag emoji (multi-codepoint)
    ";", ";;", "; ;",
    "SELECT * FROM sqlite_master",
    "'OR'1'='1",
    "' UNION SELECT * FROM sqlite_master --",
  ];

  const hostileValue = (rng: () => number): string => {
    const parts = randInt(rng, 1, 6);
    let val = "";
    for (let i = 0; i < parts; i++) {
      val += randChoice(rng, HOSTILE_VALUE_ATOMS);
    }
    return val;
  };

  it(`${ITERATIONS} hostile-value shapes round-trip correctly`, () => {
    const rng = mulberry32(SEED);

    for (let i = 0; i < ITERATIONS; i++) {
      const colCount = randInt(rng, 1, 10);
      const cols: string[] = [];
      for (let c = 0; c < colCount; c++) {
        cols.push(`c${c}`); // simple column names; value hostility is the focus
      }

      const rowCount = randInt(rng, 1, 20);
      const rows: Record<string, string>[] = [];
      for (let r = 0; r < rowCount; r++) {
        const row: Record<string, string> = {};
        for (const col of cols) {
          row[col] = hostileValue(rng);
        }
        rows.push(row);
      }

      const db = freshDB();
      try {
        const tables: DBTables = {
          prng_hostile_val: { uniques: [], cols, rows },
        };

        const ok = replaceDB(db, tables);
        if (!ok) {
          throw new Error(
            `Hostile-val replaceDB returned false at seed=0xabcdef01 iter=${i}`
          );
        }

        const sel = selectDB(db, "prng_hostile_val");
        if (!sel) {
          throw new Error(
            `Hostile-val selectDB returned null at seed=0xabcdef01 iter=${i}`
          );
        }
        expect(sel.cols.length).toBe(colCount);
        expect(sel.rows.length).toBe(rowCount);

        for (let r = 0; r < rows.length; r++) {
          for (const col of cols) {
            const expected = expectedReadback(rows[r][col] ?? "");
            const actual = sel.rows[r][col];
            if (actual !== expected) {
              throw new Error(
                `Hostile-value LOSSLESS violation at seed=0xabcdef01 iter=${i} row=${r} ` +
                `col=${col}: expected ${JSON.stringify(expected)} ` +
                `got ${JSON.stringify(actual)}`
              );
            }
          }
        }
      } finally {
        db.close();
      }
    }
  });
});
