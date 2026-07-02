import fs from "fs";
import path from "path";
import initSqlJs from "sql.js";
import {
  replaceDB,
  selectDB,
  insertIntoDB,
  updateDB,
  deleteFromDB,
  dropTable,
} from "./db";
import type { DBTables } from "shared/types/mdb";
import type { Database, SqlJsStatic } from "sql.js";

// ===========================================================================
// Q1 DEPTH (Notidian-0jtp) — REAL sql.js ENGINE round-trip + injection-breakout
// + data-fidelity characterization of the db.ts SQL-construction sink.
//
// WHY THIS EXISTS. The SQL statement-builder COMPOSITION in
// src/adapters/mdb/db/db.ts is the actual SQL-construction sink (it wires
// quoteIdent / sanitizeSQLStatement / serializeSQL* into real statements). It is
// already characterized as a STRING by db.sql-builders.test.ts (Notidian-xwc6),
// but that net deliberately "does NOT open a real sql.js Database" (its lines
// 32-40) — every builder is exercised against a CapturingDB that only records
// `exec(sql)`. The two __audit__ round-trip tests
// (w1-storage-hardening.audit.test.ts, d-corrupt-mdb.audit.test.ts) DO decode DB
// state, but through a hand-written `fakeSqlJS` (StatefulFakeDB) injected via
// `sqlJS: async () => fakeSqlJS` — a re-implementation of SQLite parsing, NOT
// the engine. So across the whole suite the constructed SQL was asserted as a
// string and decoded by a fake, but NEVER PROVEN to (a) execute safely against a
// real engine, (b) round-trip data byte-for-byte through real SQLite, or (c)
// resist injection-breakout at real execution time.
//
// METHOD. This net opens the REAL sql.js (initSqlJs over the pinned 1.8.0 WASM
// binary already shipped at node_modules/sql.js/dist/sql-wasm.wasm — the same
// engine the plugin loads at runtime via src/.../db/sqljs.js) as an in-memory
// Database and drives the public builders end to end. It asserts on the engine's
// OBSERVED behavior, never on a re-implementation. Where the real engine reveals
// a defect or hard limitation, it is DEFECT-PINNED here (locked expectation /
// toThrow-equivalent) with a cross-link, never blind-fixed. No src/ change.
//
// This is characterization + breakout-neutralization hardening on the prioritized
// SQL-construction surface (AGENTS.md), the complement that proves what the
// string nets could only assert.
// ===========================================================================

// The plugin runtime loads sql.js via a wasm-binary import (db/sqljs.js). In the
// jest/node env there is no bundler to inline the .wasm, so we read the SAME
// pinned binary from disk and feed it to initSqlJs — this is the real engine, not
// a fake. require.resolve("sql.js") -> .../dist/sql-wasm.js; its sibling is the
// .wasm. (If a future env cannot load the WASM offline, this init throws loudly
// in beforeAll rather than silently degrading to a fake — see the bead's note.)
const loadRealSqlJS = async (): Promise<SqlJsStatic> => {
  const buf = fs.readFileSync(
    path.join(path.dirname(require.resolve("sql.js")), "sql-wasm.wasm")
  );
  // fs.readFileSync returns a Node Buffer (a Uint8Array view); initSqlJs's type
  // wants an ArrayBuffer, so hand it the exact backing slice. (sql.js accepts a
  // Buffer at runtime — the probe confirmed it — this just satisfies the type.)
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

// Names of all user tables currently in the engine (proves table survival /
// non-creation directly against sqlite_master, not against a captured string).
const liveTables = (db: Database): string[] =>
  db
    .exec("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name;")[0]
    ?.values.map((r) => r[0] as string) ?? [];

const liveIndexes = (db: Database): string[] =>
  db
    .exec(
      "SELECT name FROM sqlite_master WHERE type='index' AND name NOT LIKE 'sqlite_%' ORDER BY name;"
    )[0]
    ?.values.map((r) => r[0] as string) ?? [];

// =========================================================================
// (1) DATA FIDELITY — replaceDB -> selectDB byte-for-byte round-trip.
// Whatever quoteIdent/sanitizeSQLStatement emit, the REAL engine must store and
// read back the value IDENTICAL to the input. This proves the end-to-end
// escaping contract, not just the emitted string shape.
// =========================================================================
describe("real engine: replaceDB -> selectDB value round-trip is byte-for-byte identical", () => {
  // One row whose single value is `v`; assert it reads back identical.
  const roundTripValue = (v: string) => {
    const db = freshDB();
    try {
      const ok = replaceDB(db, {
        t: { uniques: [], cols: ["v"], rows: [{ v }] },
      });
      expect(ok).toBe(true);
      const sel = selectDB(db, "t");
      expect(sel).not.toBeNull();
      expect(sel!.rows).toHaveLength(1);
      expect(sel!.rows[0].v).toBe(v);
    } finally {
      db.close();
    }
  };

  it("a lone single quote: a'b", () => roundTripValue(`a'b`));
  it("a run of single quotes: '''", () => roundTripValue(`'''`));
  it("a double quote in a VALUE: a\"b", () => roundTripValue(`a"b`));
  it("a full literal-breakout payload stored as inert text", () =>
    roundTripValue(`'); DROP TABLE m_fields; --`));
  it("an identifier-breakout-shaped value stored as inert text", () =>
    roundTripValue(`x"; DROP TABLE m_fields; --`));
  it("bare semicolons in a value", () => roundTripValue(`a;b;c;`));
  it("a SQL comment marker in a value", () => roundTripValue(`-- not a comment`));
  it("unicode (accents, CJK, astral plane, emoji, zero-width space)", () =>
    roundTripValue(`café ✓ 日本語 𝕏 😀​`));
  it("a mix: quotes + semicolons + unicode + comment", () =>
    roundTripValue(`O'Brien; SELECT 1; -- 日本 "x" ✓`));

  it("CONTROL BYTES 0x01..0x1f (excluding NUL) round-trip byte-for-byte", () => {
    // The full C0 control range MINUS NUL (0x00). 0x01..0x1f survive intact
    // through quoteIdent/sanitizeSQLStatement and the real engine. NUL is the
    // singular byte that breaks the C-string transport (db.exec is C-string-
    // bound); per ADR 0047 Option B it is now STRIPPED at the sanitizer chokepoint
    // (sanitizeSQLStatement) BEFORE it can reach the transport, rather than
    // truncating the statement — pinned separately in section (6) below. So this
    // 0x01..0x1f net deliberately EXCLUDES NUL: those bytes are round-tripped,
    // NUL is stripped.
    let ctrl = "";
    for (let code = 0x01; code <= 0x1f; code += 1) {
      ctrl += String.fromCharCode(code);
    }
    const v = `pre${ctrl}post`;
    roundTripValue(v);
    // And explicitly assert the length is preserved (no truncation at a control
    // byte): 3 + 31 + 4 = 38 code units.
    const db = freshDB();
    try {
      replaceDB(db, { t: { uniques: [], cols: ["v"], rows: [{ v }] } });
      const back = selectDB(db, "t")!.rows[0].v as string;
      expect(back.length).toBe(38);
      expect(back).toBe(v);
    } finally {
      db.close();
    }
  });

  it("multi-column / multi-row fidelity (cols-order positional, not row-key order)", () => {
    const db = freshDB();
    try {
      const tables: DBTables = {
        t: {
          uniques: [],
          cols: ["a", "b", "c"],
          rows: [
            // keys deliberately scrambled; replaceDB reads by cols order.
            { c: "C1'x", a: "A1", b: `B1"y` },
            { b: "B2", c: "C2", a: "A2; DROP" },
          ],
        },
      };
      expect(replaceDB(db, tables)).toBe(true);
      const sel = selectDB(db, "t");
      expect(sel!.cols).toEqual(["a", "b", "c"]);
      expect(sel!.rows).toEqual([
        { a: "A1", b: `B1"y`, c: "C1'x" },
        { a: "A2; DROP", b: "B2", c: "C2" },
      ]);
    } finally {
      db.close();
    }
  });
});

// =========================================================================
// (2) IDENTIFIER FIDELITY — a hostile / quote-bearing TABLE and COLUMN name
// survives replaceDB -> selectDB as a LITERAL identifier (the doubled inner
// quote is the SQLite escape, not stored text). This proves quoteIdent's
// contract against the real catalog, not a string.
// =========================================================================
describe("real engine: hostile table/column identifiers survive as literal identifiers", () => {
  it("a table name and column name each containing a double quote round-trip", () => {
    const db = freshDB();
    try {
      const tName = `sch"ema`;
      const cName = `col"name`;
      expect(
        replaceDB(db, {
          [tName]: {
            uniques: [],
            cols: ["id", cName],
            rows: [{ id: "r1", [cName]: "v1" }],
          },
        })
      ).toBe(true);
      // The catalog stores the UNESCAPED identifier text (the `""` was the SQL
      // escape, not part of the name).
      expect(liveTables(db)).toEqual([tName]);
      const sel = selectDB(db, tName);
      expect(sel!.cols).toEqual(["id", cName]);
      expect(sel!.rows).toEqual([{ id: "r1", [cName]: "v1" }]);
    } finally {
      db.close();
    }
  });
});

// =========================================================================
// (3) INJECTION-BREAKOUT NEUTRALIZATION — proven at EXECUTION time.
// A sibling table that the payload tries to DROP must SURVIVE every builder. The
// payload text must be stored as inert literal data / identifier, never executed
// as a second statement.
// =========================================================================
describe("real engine: injection payloads cannot break out (sibling table survives)", () => {
  // The canonical breakout payloads, used as a table name, a column name, and a
  // value. If any of them broke out of its quoting, the `victim` table would be
  // dropped — so victim survival across each builder is the breakout test.
  const TABLE_BREAKOUT = `t"; DROP TABLE victim; --`;
  const COL_BREAKOUT = `c"; DROP TABLE victim; --`;
  const VALUE_BREAKOUT = `'); DROP TABLE victim; --`;

  const seedVictim = (db: Database) => {
    expect(
      replaceDB(db, {
        victim: { uniques: [], cols: ["k"], rows: [{ k: "alive" }] },
      })
    ).toBe(true);
    expect(liveTables(db)).toContain("victim");
  };

  it("replaceDB: hostile table + column + value do NOT drop the sibling, payload stored literally", () => {
    const db = freshDB();
    try {
      seedVictim(db);
      const ok = replaceDB(db, {
        [TABLE_BREAKOUT]: {
          uniques: [],
          cols: ["id", COL_BREAKOUT],
          rows: [{ id: "r1", [COL_BREAKOUT]: VALUE_BREAKOUT }],
        },
      });
      expect(ok).toBe(true);
      // victim still alive -> no breakout executed.
      const victim = selectDB(db, "victim");
      expect(victim!.rows).toEqual([{ k: "alive" }]);
      // The payloads are stored as literal identifier + value.
      const sel = selectDB(db, TABLE_BREAKOUT);
      expect(sel!.cols).toEqual(["id", COL_BREAKOUT]);
      expect(sel!.rows[0][COL_BREAKOUT]).toBe(VALUE_BREAKOUT);
    } finally {
      db.close();
    }
  });

  it("insertIntoDB(replace): hostile table + value do NOT drop the sibling", () => {
    const db = freshDB();
    try {
      seedVictim(db);
      // Create the target table first (insert needs an existing table).
      expect(
        replaceDB(db, {
          [TABLE_BREAKOUT]: { uniques: [], cols: ["id", "v"], rows: [] },
        })
      ).toBe(true);
      insertIntoDB(
        db,
        {
          [TABLE_BREAKOUT]: {
            uniques: [],
            cols: ["id", "v"],
            rows: [{ id: "r1", v: VALUE_BREAKOUT }],
          },
        },
        true
      );
      expect(selectDB(db, "victim")!.rows).toEqual([{ k: "alive" }]);
      const sel = selectDB(db, TABLE_BREAKOUT);
      expect(sel!.rows[0].v).toBe(VALUE_BREAKOUT);
    } finally {
      db.close();
    }
  });

  it("updateDB: hostile SET value + WHERE-ref value do NOT drop the sibling", () => {
    const db = freshDB();
    try {
      seedVictim(db);
      expect(
        replaceDB(db, {
          t: { uniques: ["id"], cols: ["id", "v"], rows: [{ id: "k1", v: "old" }] },
        })
      ).toBe(true);
      updateDB(
        db,
        { t: { uniques: [], cols: ["id", "v"], rows: [{ id: "k1", v: VALUE_BREAKOUT }] } },
        "id",
        "id"
      );
      expect(selectDB(db, "victim")!.rows).toEqual([{ k: "alive" }]);
      // The hostile value was written as inert text (no breakout).
      expect(selectDB(db, "t")!.rows).toEqual([{ id: "k1", v: VALUE_BREAKOUT }]);
    } finally {
      db.close();
    }
  });

  it("dropTable: a hostile table name only drops THAT (literal) name, not a sibling", () => {
    const db = freshDB();
    try {
      seedVictim(db);
      // dropTable with the literal hostile name: it has no such table, so it is a
      // no-op (DROP TABLE IF EXISTS), and crucially victim is untouched because
      // the `; DROP TABLE victim; --` is inside the quoted identifier, inert.
      dropTable(db, TABLE_BREAKOUT);
      expect(liveTables(db)).toContain("victim");
      expect(selectDB(db, "victim")!.rows).toEqual([{ k: "alive" }]);
    } finally {
      db.close();
    }
  });

  it("selectDB: a hostile table name is quoted (no breakout); unknown table -> null, victim survives", () => {
    const db = freshDB();
    try {
      seedVictim(db);
      // selectDB on the hostile name: no such table -> exec throws -> caught ->
      // null. The point is victim is NOT dropped: the payload stayed quoted.
      const out = selectDB(db, TABLE_BREAKOUT);
      expect(out).toBeNull();
      expect(liveTables(db)).toContain("victim");
    } finally {
      db.close();
    }
  });
});

// =========================================================================
// (4) UNIQUE-INDEX round-trip — the `uniques` path of replaceDB creates a real
// UNIQUE INDEX, and REPLACE semantics collapse rows that collide on it. Proven
// against the real engine (a fake cannot model REPLACE/UNIQUE conflict
// resolution).
// =========================================================================
describe("real engine: UNIQUE-index round-trip + REPLACE conflict resolution", () => {
  it("creates the unique index and REPLACE collapses colliding rows (last write wins)", () => {
    const db = freshDB();
    try {
      const ok = replaceDB(db, {
        t: {
          uniques: ["a"],
          cols: ["a", "b"],
          rows: [
            { a: "1", b: "x" },
            { a: "1", b: "y" }, // collides on unique "a" -> REPLACE keeps the last
          ],
        },
      });
      expect(ok).toBe(true);
      expect(liveIndexes(db)).toContain("idx_t_a");
      const sel = selectDB(db, "t");
      // REPLACE INTO on a unique conflict deletes the prior row and inserts the
      // new one: only the last write for a=1 remains.
      expect(sel!.rows).toEqual([{ a: "1", b: "y" }]);
    } finally {
      db.close();
    }
  });

  it("a composite unique index over two columns is created and enforced", () => {
    const db = freshDB();
    try {
      const ok = replaceDB(db, {
        t: {
          uniques: ["a,b"],
          cols: ["a", "b", "c"],
          rows: [
            { a: "1", b: "1", c: "first" },
            { a: "1", b: "2", c: "kept-different-pair" },
            { a: "1", b: "1", c: "replaces-first" }, // collides on (a,b)
          ],
        },
      });
      expect(ok).toBe(true);
      expect(liveIndexes(db)).toContain("idx_t_a_b");
      const sel = selectDB(db, "t");
      const rows = sel!.rows.slice().sort((p, q) => `${p.a}${p.b}`.localeCompare(`${q.a}${q.b}`));
      expect(rows).toEqual([
        { a: "1", b: "1", c: "replaces-first" },
        { a: "1", b: "2", c: "kept-different-pair" },
      ]);
    } finally {
      db.close();
    }
  });

  it("a hostile column name in `uniques` is quoted in the CREATE UNIQUE INDEX (no breakout)", () => {
    const db = freshDB();
    try {
      expect(
        replaceDB(db, {
          victim: { uniques: [], cols: ["k"], rows: [{ k: "alive" }] },
        })
      ).toBe(true);
      const hostileCol = `a"); DROP TABLE victim; --`;
      const ok = replaceDB(db, {
        t: {
          uniques: [hostileCol],
          cols: [hostileCol, "b"],
          rows: [{ [hostileCol]: "1", b: "x" }],
        },
      });
      expect(ok).toBe(true);
      // victim untouched -> the index-column identifier stayed quoted.
      expect(liveTables(db)).toContain("victim");
      expect(selectDB(db, "victim")!.rows).toEqual([{ k: "alive" }]);
    } finally {
      db.close();
    }
  });
});

// =========================================================================
// (5) FULL CRUD round-trip through the real engine: replace -> insert ->
// update -> delete -> drop, with adversarial content at each step.
// =========================================================================
describe("real engine: full CRUD round-trip with adversarial content", () => {
  it("replace seeds, insert(replace) adds, update mutates, delete removes, drop clears", () => {
    const db = freshDB();
    try {
      // seed
      expect(
        replaceDB(db, {
          t: {
            uniques: ["id"],
            cols: ["id", "v"],
            rows: [{ id: "k1", v: "O'Brien" }],
          },
        })
      ).toBe(true);
      expect(selectDB(db, "t")!.rows).toEqual([{ id: "k1", v: "O'Brien" }]);

      // insert (REPLACE mode) a second row with adversarial value
      insertIntoDB(
        db,
        {
          t: {
            uniques: [],
            cols: ["id", "v"],
            rows: [{ id: "k2", v: `x'); DROP TABLE t; -- "quoted"` }],
          },
        },
        true
      );
      const afterInsert = selectDB(db, "t")!;
      expect(afterInsert.rows).toHaveLength(2);
      expect(afterInsert.rows.find((r) => r.id === "k2")!.v).toBe(
        `x'); DROP TABLE t; -- "quoted"`
      );

      // update k1's value to another adversarial string
      updateDB(
        db,
        {
          t: { uniques: [], cols: ["id", "v"], rows: [{ id: "k1", v: `it's a "test"; --` }] },
        },
        "id",
        "id"
      );
      expect(selectDB(db, "t")!.rows.find((r) => r.id === "k1")!.v).toBe(
        `it's a "test"; --`
      );

      // delete k2 via a caller-owned (trusted) condition referencing the quoted id
      deleteFromDB(db, "t", `"id"='k2'`);
      const afterDelete = selectDB(db, "t")!;
      expect(afterDelete.rows.map((r) => r.id)).toEqual(["k1"]);

      // drop
      dropTable(db, "t");
      expect(liveTables(db)).not.toContain("t");
    } finally {
      db.close();
    }
  });
});

// =========================================================================
// (6) NUL-BYTE TRANSPORT — engine limitation pinned at the RAW boundary,
// DEFENDED at the value chokepoint (ADR 0047 Option B, bd Notidian-dgo6).
//
// sql.js `db.exec(sql: string)` is C-string-bound: an embedded NUL (0x00)
// terminates the SQL string at the engine boundary, so a NUL spliced into the
// SQL TEXT truncates the statement and it fails to parse. That is an
// engine/transport limitation, NOT a quoteIdent/sanitizeSQLStatement escaping
// defect — there is no NUL-safe representation in a `db.exec(string)` API.
//
// Before ADR 0047(B), a NUL-bearing VALUE reached the transport: replaceDB's
// try/catch swallowed the parse throw and returned FALSE, silently losing the
// WHOLE table's save for that one anomalous byte. ADR 0047(B) strips NUL at the
// single value chokepoint sanitizeSQLStatement (the only byte that breaks the
// C-string transport — 0x01..0x1f round-trip intact, pinned at :126-147), so a
// NUL-bearing value now SUCCEEDS, storing the value with the NUL(s) removed
// (lossy-but-explicit interim; the eventual byte-faithful fix is the
// parameter-bound API, Option A — see the ADR / bd remember).
//
// Two pins below: the FIRST characterizes the RAW ENGINE (db.exec of a literal
// NUL still truncates+throws — B does not, and cannot, change the engine); the
// SECOND pins the post-B builder behavior (NUL stripped, row stored, the rest of
// the table's save preserved).
// =========================================================================
describe("real engine: NUL byte transport — engine limit at the raw boundary, stripped at the value chokepoint (ADR 0047 B)", () => {
  it("DIRECT exec truncates at the NUL and throws a parse error (engine limit, unchanged by B)", () => {
    const db = freshDB();
    try {
      db.exec(`CREATE TABLE "t" ("v" char);`);
      // The literal `'a\x00b'` is cut to `'a` at the NUL -> unterminated literal.
      // B strips NUL at the BUILDER chokepoint, not in a raw caller's own exec,
      // so this raw-engine characterization stays as the record of WHY B exists.
      expect(() => db.exec(`INSERT INTO "t" VALUES ('a\x00b');`)).toThrow();
    } finally {
      db.close();
    }
  });

  it("replaceDB NUL-strips the value, returns true, and stores the NUL-stripped value (ADR 0047 B — flips the former swallow-and-false pin)", () => {
    const db = freshDB();
    try {
      const ok = replaceDB(db, {
        t: { uniques: [], cols: ["v"], rows: [{ v: "a\x00b" }] },
      });
      // ADR 0047(B): sanitizeSQLStatement strips the NUL before the value reaches
      // the C-string transport, so the REPLACE parses, succeeds, and replaceDB
      // returns TRUE — the row (and the rest of the table's save) is preserved.
      expect(ok).toBe(true);
      const sel = selectDB(db, "t");
      expect(sel).not.toBeNull();
      expect(sel!.rows).toHaveLength(1);
      // The stored value is the input with the NUL removed: 'a\x00b' -> 'ab'.
      expect(sel!.rows[0].v).toBe("ab");
    } finally {
      db.close();
    }
  });

  it("a NUL-bearing value no longer rolls back a SIBLING row's save in the same replaceDB (whole-table silent-loss footgun removed)", () => {
    // The pre-B harm: one NUL value made replaceDB return false, rolling back the
    // ENTIRE table's save. Post-B the NUL is stripped and BOTH rows persist.
    const db = freshDB();
    try {
      const ok = replaceDB(db, {
        t: {
          uniques: [],
          cols: ["v"],
          rows: [{ v: "clean" }, { v: "x\x00y" }],
        },
      });
      expect(ok).toBe(true);
      const sel = selectDB(db, "t");
      expect(sel!.rows).toEqual([{ v: "clean" }, { v: "xy" }]);
    } finally {
      db.close();
    }
  });
});

// =========================================================================
// (7) Notidian-k778 / ADR 0045 (Option A) — CORRECT BY CONSTRUCTION, pinned
// against the real engine.
// replaceDB now derives ONE de-duped, falsy-filtered `liveCols` list and uses
// it for BOTH the CREATE field list AND an EXPLICIT-column REPLACE
// (`REPLACE INTO "t" ("a","b") VALUES (...)`), mapping the VALUES over that same
// list. So cols=['a','a','','b'] yields a 2-column CREATE ("a","b") AND a
// 2-value, named REPLACE — count- and position-matched. The previously pinned
// asymmetry (a 4-value REPLACE against a 2-column table) is DELIBERATELY RETIRED
// per ADR 0045; below we pin the REAL ENGINE'S OBSERVED REACTION to the
// corrected statement so the fix is grounded in engine truth, never a blind edit:
//
//   GROUND TRUTH (sql.js 1.8.0, captured live):
//     - DIRECT (legacy asymmetric shape): a bare 4-value REPLACE against a
//       2-column table STILL THROWS "table t has 2 columns but 4 values were
//       supplied" — retained to document WHY the explicit-column fix matters.
//     - DIRECT (corrected shape): `REPLACE INTO "t" ("a","b") VALUES ('1','2')`
//       SUCCEEDS — the explicit column list binds 2 values to 2 named columns.
//     - VIA replaceDB: cols=['a','a','','b'] now returns TRUE; selectDB returns
//       the stored row; the table is the 2-column ("a","b") table. The row is
//       STORED, not silently dropped.
//
// Cross-link: Notidian-k778, ADR 0045 (Option A, accepted). These expectations
// were the locked characterization of the old asymmetry; ADR 0045 re-blessed
// them as the corrected, count-matched behavior.
// =========================================================================
describe("Notidian-k778 / ADR 0045: explicit-column REPLACE is correct by construction, REAL-engine ground truth", () => {
  it("DIRECT (legacy shape): a bare 4-value REPLACE against a 2-column table still throws — documents why the explicit-column fix matters", () => {
    const db = freshDB();
    try {
      db.exec(`CREATE TABLE "t" ("a" char,"b" char);`);
      // The OLD asymmetric shape replaceDB used to emit (CREATE uniq+filtered to
      // 2 cols; bare REPLACE VALUES mapping all 4). Retained to pin WHY ADR 0045
      // moved to an explicit column list.
      let thrown: Error | null = null;
      try {
        db.exec(`REPLACE INTO "t" VALUES ('1', '1', '', '2');`);
      } catch (e) {
        thrown = e as Error;
      }
      expect(thrown).not.toBeNull();
      // The real engine's diagnostic: a column-count mismatch, NOT a silent drop.
      expect(thrown!.message).toContain("2 columns but 4 values");
    } finally {
      db.close();
    }
  });

  it("DIRECT (corrected shape): an explicit-column REPLACE binds 2 values to 2 named columns and succeeds", () => {
    const db = freshDB();
    try {
      db.exec(`CREATE TABLE "t" ("a" char,"b" char);`);
      // The shape replaceDB now emits for cols=['a','a','','b']: explicit column
      // list derived from the SAME uniq+filtered liveCols as the CREATE.
      let thrown: Error | null = null;
      try {
        db.exec(`REPLACE INTO "t" ("a","b") VALUES ('1', '2');`);
      } catch (e) {
        thrown = e as Error;
      }
      expect(thrown).toBeNull();
      const sel = selectDB(db, "t");
      expect(sel!.rows).toEqual([{ a: "1", b: "2" }]);
    } finally {
      db.close();
    }
  });

  it("VIA replaceDB (ADR 0045 re-bless): cols=['a','a','','b'] -> returns true, row STORED, table is ('a','b')", () => {
    const db = freshDB();
    try {
      const ok = replaceDB(db, {
        t: {
          uniques: ["a"],
          cols: ["a", "a", "", "b"],
          rows: [{ a: "1", b: "2" }],
        },
      });
      // ADR 0045 (Option A): the dup/empty-name case is now correct by
      // construction — it STORES the row instead of silently dropping the save.
      expect(ok).toBe(true);
      // selectDB returns the stored row mapped over the de-duped columns.
      expect(selectDB(db, "t")!.rows).toEqual([{ a: "1", b: "2" }]);
      // The table is the de-duped 2-column ("a","b") table.
      expect(liveTables(db)).toContain("t");
      const cols =
        db.exec(`SELECT name FROM pragma_table_info('t') ORDER BY cid;`)[0]
          ?.values.map((r) => r[0] as string) ?? [];
      expect(cols).toEqual(["a", "b"]);
    } finally {
      db.close();
    }
  });

  it("CONTRAST: when cols carry no dup/empty names, the full round-trip succeeds", () => {
    // This isolates the asymmetry to the dup/empty-name case: a normal cols array
    // (the mdbTablesToDBTables field.name projection is normally unique/non-empty)
    // round-trips cleanly. So k778 is a LATENT edge, pinned, not an everyday break.
    const db = freshDB();
    try {
      const ok = replaceDB(db, {
        t: { uniques: ["a"], cols: ["a", "b"], rows: [{ a: "1", b: "2" }] },
      });
      expect(ok).toBe(true);
      expect(selectDB(db, "t")!.rows).toEqual([{ a: "1", b: "2" }]);
    } finally {
      db.close();
    }
  });
});

// =========================================================================
// (8) Notidian-1q8y — context MDB integrity against the REAL engine.
// SQLite folds identifier case, so cols carrying "Status" AND "status" used
// to make CREATE TABLE throw `duplicate column name`, replaceDB return false,
// and EVERY save of that folder silently fail. liveCols now dedupes
// case-insensitively (first-seen casing wins) and the save SUCCEEDS.
// =========================================================================
describe("Notidian-1q8y: replaceDB integrity, REAL-engine ground truth", () => {
  it("Notidian-1q8y: case-variant column names save CLEANLY as one column, first-seen casing wins", () => {
    const db = freshDB();
    try {
      const ok = replaceDB(db, {
        t: {
          uniques: [],
          cols: ["File", "Status", "status"],
          rows: [
            { File: "a.md", Status: "Open" },
            { File: "b.md", status: "Done" },
          ],
        },
      });
      // The OLD behavior: CREATE TABLE ("Status" char,"status" char) threw
      // `duplicate column name: status` and the whole save returned false.
      expect(ok).toBe(true);
      const cols =
        db.exec(`SELECT name FROM pragma_table_info('t') ORDER BY cid;`)[0]
          ?.values.map((r) => r[0] as string) ?? [];
      expect(cols).toEqual(["File", "Status"]);
      // Rows persist mapped over the deduped list (row b's "status"-cased cell
      // has no exact-key match, so its cell is empty — frontmatter-backed
      // values are re-derived from the files on read, never from this table).
      expect(selectDB(db, "t")!.rows).toEqual([
        { File: "a.md", Status: "Open" },
        { File: "b.md", Status: "" },
      ]);
    } finally {
      db.close();
    }
  });
});
