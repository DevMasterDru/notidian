import {
  selectDB,
  insertIntoDB,
  updateDB,
  deleteFromDB,
  dropTable,
  replaceDB,
  mdbTablesToDBTables,
  dbResultsToDBTables,
} from "./db";
import { DBTables } from "shared/types/mdb";
import type { SpaceTables } from "shared/types/mdb";
import type { Database, QueryExecResult } from "sql.js";

// ===========================================================================
// Q1 DEPTH — direct characterization of the SQL statement-builder COMPOSITION
// layer in src/adapters/mdb/db/db.ts (Notidian-xwc6).
//
// WHY THIS EXISTS. The leaf sanitizers (src/shared/utils/sanitizers.ts —
// quoteIdent / sanitizeSQLStatement, 83 tests + adversarial/property nets) and
// the join serializers (src/utils/serializers.ts SQL section — serializeSQLValues
// / serializeSQLStatements / serializeSQLFieldNames) are SATURATED. But the
// COMPOSITION that wires them into real statements —
//   `SELECT ... FROM ${quoteIdent(table)}`,
//   `INSERT INTO ${quoteIdent(t)} VALUES (${serializeSQLValues(
//        cols.map(c => `'${sanitizeSQLStatement(...)}'`))})`,
//   UPDATE / DELETE / DROP / CREATE / REPLACE —
// is the ACTUAL SQL-construction sink. Until now it was exercised only
// TRANSITIVELY, through two round-trip __audit__ tests
// (w1-storage-hardening.audit.test.ts, d-corrupt-mdb.audit.test.ts) that decode
// the resulting DB state — never by asserting the emitted statement string
// itself. This net pins the seam directly.
//
// METHOD. We do NOT open a real sql.js Database. Every builder's only impure
// step is `db.exec(sql)`; everything before it is pure string construction. So a
// CapturingDB records each `exec(sql)` call into a `statements` array and returns
// `[]` (an empty QueryExecResult[]). The pure builder path runs to completion and
// we assert the captured SQL. selectDB returns null on `[]` (it needs exactly one
// result table) — that is fine: we assert the captured SELECT string, not the
// returned rows. dbResultsToDBTables is tested separately with hand-built
// QueryExecResult fixtures.
//
// This is CHARACTERIZATION + breakout-NEUTRALIZATION hardening, not correction.
// If a real defect surfaces it is DEFECT-PINNED here (locked expectation /
// toThrow) with a follow-up bead, never blind-fixed. No src/ change.
// ===========================================================================

// --- A fake Database that captures every exec(sql) and returns no rows. ------
// Only `exec` is used by the pure builders under test; the rest of the sql.js
// Database surface is irrelevant here, so we cast through `unknown` to Database.
class CapturingDB {
  public statements: string[] = [];
  // Optionally make exec throw to characterize the try/catch swallow paths.
  constructor(private throwOnExec = false) {}
  exec(sql: string): QueryExecResult[] {
    this.statements.push(sql);
    if (this.throwOnExec) throw new Error("forced exec failure");
    return [];
  }
}

const makeDB = (throwOnExec = false) =>
  new CapturingDB(throwOnExec) as unknown as Database & {
    statements: string[];
  };

// A single canonical hostile identifier used across the breakout pins: it
// attempts to close a double-quoted identifier (`"`), then inject a second
// statement (`; DROP TABLE m_fields; --`). quoteIdent must neutralize it by
// DOUBLING the inner `"` so the whole payload stays inside ONE quoted ident.
const HOSTILE_IDENT = `x"; DROP TABLE m_fields; --`;
// The neutralized form quoteIdent produces: outer quotes + the inner `"`
// doubled to `""`. NOTE the `;`/`--` survive verbatim but are now INSIDE the
// quoted identifier (inert), not bare statement separators.
const HOSTILE_IDENT_QUOTED = `"x""; DROP TABLE m_fields; --"`;

// =========================================================================
// (1) IDENTIFIER BREAKOUT NEUTRALIZATION
// A hostile table/column name cannot break out of the quoted identifier: the
// inner `"` is doubled by quoteIdent, so the emitted statement contains the
// doubled-quote form and NEVER a bare (single, unescaped) closing quote that
// would terminate the identifier early and expose `; DROP TABLE ...` as SQL.
// =========================================================================
describe("identifier breakout neutralization (quoteIdent in the statement seam)", () => {
  // A helper: the dangerous shape is a SINGLE `"` immediately followed by `;`
  // (identifier closed, then a statement separator). The safe shape is `"";`
  // (a doubled, i.e. escaped, quote). We assert the safe shape is present and
  // the dangerous breakout shape is absent.
  const assertNoBareBreakout = (sql: string) => {
    expect(sql).toContain(HOSTILE_IDENT_QUOTED);
    // The neutralized form contains the doubled quote run...
    expect(sql).toContain(`""`);
    // ...and there is no point where a single quote closes the ident and is
    // immediately followed by the injected `; DROP`. Match a `"` that is NOT
    // part of a `""` pair, immediately followed by `; DROP`.
    expect(sql).not.toMatch(/[^"]"; DROP TABLE m_fields/);
  };

  it("selectDB: hostile table name is wrapped + doubled (no breakout)", () => {
    const db = makeDB();
    selectDB(db, HOSTILE_IDENT);
    expect(db.statements).toHaveLength(1);
    expect(db.statements[0]).toBe(`SELECT * FROM ${HOSTILE_IDENT_QUOTED};`);
    assertNoBareBreakout(db.statements[0]);
  });

  it("dropTable: hostile table name cannot inject a second statement", () => {
    const db = makeDB();
    dropTable(db, HOSTILE_IDENT);
    expect(db.statements[0]).toBe(
      `DROP TABLE IF EXISTS ${HOSTILE_IDENT_QUOTED};`
    );
    assertNoBareBreakout(db.statements[0]);
  });

  it("deleteFromDB: hostile table name is neutralized (condition is separate, see trust-boundary)", () => {
    const db = makeDB();
    deleteFromDB(db, HOSTILE_IDENT, "1=1");
    expect(db.statements[0]).toBe(
      `DELETE FROM ${HOSTILE_IDENT_QUOTED} WHERE 1=1;`
    );
    assertNoBareBreakout(db.statements[0]);
  });

  it("insertIntoDB: hostile TABLE name and hostile COLUMN name are both neutralized", () => {
    const db = makeDB();
    const tables: DBTables = {
      [HOSTILE_IDENT]: {
        uniques: [],
        cols: [HOSTILE_IDENT],
        rows: [{ [HOSTILE_IDENT]: "v" }],
      },
    };
    insertIntoDB(db, tables);
    const sql = db.statements[0];
    // Table name is quoted+doubled. (Column names are NOT emitted by INSERT ...
    // VALUES — see the alignment section — so only the table ident appears.)
    expect(sql).toContain(`INSERT INTO ${HOSTILE_IDENT_QUOTED} VALUES`);
    assertNoBareBreakout(sql);
  });

  it("updateDB: hostile table name AND hostile SET/WHERE column names are all quoted+doubled", () => {
    const db = makeDB();
    const tables: DBTables = {
      [HOSTILE_IDENT]: {
        uniques: [],
        cols: [HOSTILE_IDENT, "id"],
        rows: [{ [HOSTILE_IDENT]: "v", id: "1" }],
      },
    };
    updateDB(db, tables, "id", "id");
    const sql = db.statements[0];
    expect(sql).toContain(`UPDATE ${HOSTILE_IDENT_QUOTED} SET`);
    // The hostile column appears in the SET clause, quoted+doubled.
    expect(sql).toContain(`${HOSTILE_IDENT_QUOTED}=`);
    assertNoBareBreakout(sql);
  });

  it("replaceDB: hostile table name is neutralized in DROP / CREATE / REPLACE statements", () => {
    const db = makeDB();
    const tables: DBTables = {
      [HOSTILE_IDENT]: {
        uniques: [],
        cols: [HOSTILE_IDENT],
        rows: [{ [HOSTILE_IDENT]: "v" }],
      },
    };
    replaceDB(db, tables);
    // replaceDB exec()s statements one at a time; check every captured one.
    const all = db.statements.join("\n");
    expect(all).toContain(HOSTILE_IDENT_QUOTED);
    expect(all).not.toMatch(/[^"]"; DROP TABLE m_fields/);
    // The CREATE column definition uses the quoted+doubled hostile ident + char.
    expect(all).toContain(`${HOSTILE_IDENT_QUOTED} char`);
  });

  it("a benign identifier with an embedded double-quote is doubled too (general rule)", () => {
    const db = makeDB();
    selectDB(db, `a"b`);
    expect(db.statements[0]).toBe(`SELECT * FROM "a""b";`);
  });
});

// =========================================================================
// (2) VALUE QUOTING + the documented insertIntoDB single-quote-doubling contract
// Every value is wrapped in '...' around sanitizeSQLStatement, which doubles a
// lone `'` so it cannot terminate the string literal early. A value of `x'y`
// must serialize to `'x''y'`, not `'x'y'`.
// =========================================================================
describe("value quoting + single-quote-doubling contract", () => {
  it("insertIntoDB: a lone single quote in a value is doubled inside the literal", () => {
    const db = makeDB();
    const tables: DBTables = {
      t: { uniques: [], cols: ["c"], rows: [{ c: "x'y" }] },
    };
    insertIntoDB(db, tables);
    // ADR 0046: the array+join builder emits a clean statement — no leading space
    // (the old reduce seed "" is gone) and the join owns the separator, so a
    // single statement carries no trailing ';'.
    expect(db.statements[0]).toBe(`INSERT INTO "t" VALUES ('x''y')`);
    // The dangerous shape `'x'y'` (lone quote closing the literal) is absent.
    expect(db.statements[0]).not.toContain(`'x'y'`);
  });

  it("insertIntoDB: an attempted literal-breakout value stays inside the literal", () => {
    const db = makeDB();
    // Attempts: close the literal, inject a DROP, comment out the trailing quote.
    const evil = `'); DROP TABLE m_fields; --`;
    const tables: DBTables = {
      t: { uniques: [], cols: ["c"], rows: [{ c: evil }] },
    };
    insertIntoDB(db, tables);
    const sql = db.statements[0];
    // Every single quote from the payload is doubled, so the only structural
    // single quotes are the wrapping pair; the injected `;` is inert text.
    expect(sql).toBe(`INSERT INTO "t" VALUES ('''); DROP TABLE m_fields; --')`);
    // There is no bare lone `'` that closes the literal before its end.
    // (Doubled `''` are escapes; the structural close is the final `'` before `)`.)
    expect(sql.endsWith(`--')`)).toBe(true);
  });

  it("updateDB: SET values AND the WHERE ref value are single-quote-doubled", () => {
    const db = makeDB();
    const tables: DBTables = {
      t: {
        uniques: [],
        cols: ["name", "id"],
        rows: [{ name: "O'Brien", id: "a'b" }],
      },
    };
    updateDB(db, tables, "id", "id");
    // updateRef ('id') is filtered OUT of the SET list; it appears only in WHERE.
    // ADR 0046: array+join builder — no leading space, no trailing ';'.
    expect(db.statements[0]).toBe(
      `UPDATE "t" SET "name"='O''Brien' WHERE "id"='a''b'`
    );
  });

  it("replaceDB: REPLACE row values are single-quote-doubled, with an explicit column list (parallel contract; ADR 0045)", () => {
    const db = makeDB();
    const tables: DBTables = {
      t: { uniques: [], cols: ["c"], rows: [{ c: "it's" }] },
    };
    replaceDB(db, tables);
    const replaceStmt = db.statements.find((s) => s.startsWith("REPLACE INTO"));
    // ADR 0045 (Option A): the REPLACE carries an explicit column list derived
    // from the SAME uniq+filtered liveCols as the CREATE; single quotes are still
    // doubled in the value literal.
    expect(replaceStmt).toBe(`REPLACE INTO "t" ("c") VALUES ('it''s');`);
  });

  it("CHARACTERIZE: insertIntoDB wraps EVERY value, including empty/missing, in a quoted literal", () => {
    const db = makeDB();
    const tables: DBTables = {
      // `b` is absent from the row -> sanitizeSQLStatement(undefined) -> '' ->
      // emitted as an empty quoted literal ''. No bare/NULL value escapes.
      t: { uniques: [], cols: ["a", "b"], rows: [{ a: "" }] },
    };
    insertIntoDB(db, tables);
    // ADR 0046: array+join builder — no leading space, no trailing ';'.
    expect(db.statements[0]).toBe(`INSERT INTO "t" VALUES ('', '')`);
  });
});

// =========================================================================
// (3) COLUMN / ROW ALIGNMENT + multi-row / multi-table statement batching
// The VALUES list length matches cols.length (positional, by `cols` order, NOT
// by the row object's own key order); a multi-row INSERT emits one statement
// per row; multiple tables are batched with serializeSQLStatements ('; ').
// =========================================================================
describe("column/row alignment + statement batching", () => {
  it("VALUES list length equals cols.length and follows cols order, not row key order", () => {
    const db = makeDB();
    const tables: DBTables = {
      t: {
        uniques: [],
        cols: ["a", "b", "c"],
        // Row keys deliberately out of order; the builder reads by cols order.
        rows: [{ c: "3", a: "1", b: "2" }],
      },
    };
    insertIntoDB(db, tables);
    // ADR 0046: array+join builder — no leading space, no trailing ';'.
    expect(db.statements[0]).toBe(`INSERT INTO "t" VALUES ('1', '2', '3')`);
  });

  it("multi-row INSERT emits one INSERT statement per row, batched by '; '", () => {
    const db = makeDB();
    const tables: DBTables = {
      t: {
        uniques: [],
        cols: ["a", "b"],
        rows: [
          { a: "1", b: "2" },
          { a: "3", b: "4" },
        ],
      },
    };
    insertIntoDB(db, tables);
    // All rows for a table are batched into a single exec() call; ADR 0046:
    // per-row statements are .map()'d and joined by serializeSQLStatements
    // ('; '), so rows are separated by a single '; ', with no leading space and
    // no trailing ';' on the final statement.
    expect(db.statements).toHaveLength(1);
    expect(db.statements[0]).toBe(
      `INSERT INTO "t" VALUES ('1', '2'); INSERT INTO "t" VALUES ('3', '4')`
    );
  });

  it("multiple tables are batched into ONE exec() string joined by '; '", () => {
    const db = makeDB();
    const tables: DBTables = {
      t1: { uniques: [], cols: ["a"], rows: [{ a: "1" }] },
      t2: { uniques: [], cols: ["b"], rows: [{ b: "2" }] },
    };
    insertIntoDB(db, tables);
    expect(db.statements).toHaveLength(1);
    // ADR 0046 / Notidian-p5qt: every statement is now a separate element and
    // serializeSQLStatements ('; ') owns ALL separators, so the seam between two
    // tables is a single clean '; ' — the old ';;  ' (double semicolon + two
    // spaces) benign-no-op quirk is gone, and there is no leading space.
    expect(db.statements[0]).toBe(
      `INSERT INTO "t1" VALUES ('1'); INSERT INTO "t2" VALUES ('2')`
    );
  });

  it("REPLACE mode swaps the INSERT keyword for REPLACE, same alignment", () => {
    const db = makeDB();
    const tables: DBTables = {
      t: { uniques: [], cols: ["a", "b"], rows: [{ a: "1", b: "2" }] },
    };
    insertIntoDB(db, tables, true);
    // ADR 0046: array+join builder — no leading space, no trailing ';'.
    expect(db.statements[0]).toBe(`REPLACE INTO "t" VALUES ('1', '2')`);
  });

  it("updateDB: every non-ref col is in SET; ref col is the WHERE key only", () => {
    const db = makeDB();
    const tables: DBTables = {
      t: {
        uniques: [],
        cols: ["name", "age", "id"],
        rows: [{ name: "Ann", age: "30", id: "k1" }],
      },
    };
    updateDB(db, tables, "id", "id");
    // ADR 0046: array+join builder — no leading space, no trailing ';'.
    expect(db.statements[0]).toBe(
      `UPDATE "t" SET "name"='Ann', "age"='30' WHERE "id"='k1'`
    );
  });

  it("CHARACTERIZE updateDB: updateCol and updateRef are independent params", () => {
    // updateCol = the WHERE column identifier; updateRef = the col whose VALUE
    // is the WHERE match AND which is filtered out of SET. Here they differ.
    const db = makeDB();
    const tables: DBTables = {
      t: {
        uniques: [],
        cols: ["name", "rowKey"],
        rows: [{ name: "Bo", rowKey: "rk" }],
      },
    };
    updateDB(db, tables, "pk", "rowKey");
    // SET excludes "rowKey" (== updateRef); WHERE uses "pk" (updateCol) = the
    // value of the "rowKey" col. ADR 0046: no leading space, no trailing ';'.
    expect(db.statements[0]).toBe(
      `UPDATE "t" SET "name"='Bo' WHERE "pk"='rk'`
    );
  });

  it("replaceDB: CREATE and REPLACE share ONE de-duped/falsy-filtered column list, emitted as an explicit column list (ADR 0045 / Notidian-k778)", () => {
    const db = makeDB();
    const tables: DBTables = {
      t: {
        uniques: ["a"],
        // duplicate "a" and an empty "" name: uniq() collapses the dup, the
        // .filter(f=>f) drops the empty. Per ADR 0045 (Option A) this SAME
        // liveCols list now drives BOTH the CREATE field list AND the REPLACE
        // VALUES, so the statement is count- and position-matched.
        cols: ["a", "a", "", "b"],
        rows: [{ a: "1", b: "2" }],
      },
    };
    replaceDB(db, tables);
    const create = db.statements.find((s) => s.startsWith("CREATE TABLE"));
    // De-duped + empty-dropped: only "a" and "b" remain as char columns.
    expect(create).toBe(`CREATE TABLE IF NOT EXISTS "t" ("a" char,"b" char); `);
    // The unique index for "a" is created.
    const idx = db.statements.find((s) => s.includes("CREATE UNIQUE INDEX"));
    expect(idx).toContain(`ON "t"("a")`);
    // ADR 0045 (Option A) — RE-BLESSED: the REPLACE now carries an EXPLICIT
    // column list derived from the SAME uniq+filtered liveCols as the CREATE, and
    // the VALUES are mapped over that SAME list. The old asymmetric 4-value form
    // (`REPLACE INTO "t" VALUES ('1','1','','2')`) is deliberately retired — the
    // statement is now correct by construction: 2 columns, 2 values, named.
    const replaceStmt = db.statements.find((s) => s.startsWith("REPLACE INTO"));
    expect(replaceStmt).toBe(`REPLACE INTO "t" ("a","b") VALUES ('1', '2');`);
  });

  it("replaceDB: the whole DROP/CREATE/rows sequence rides inside ONE transaction (Notidian-jn8p)", () => {
    const db = makeDB();
    const tables: DBTables = {
      t: { uniques: [], cols: ["a"], rows: [{ a: "1" }] },
    };
    replaceDB(db, tables);
    // Each statement is exec()'d separately; assert the ordered skeleton.
    // Notidian-jn8p: BEGIN comes FIRST so a mid-sequence failure can never
    // leave the table dropped but not recreated — the catch rolls back.
    expect(db.statements[0]).toBe(`BEGIN TRANSACTION;`);
    expect(db.statements[1]).toBe(
      `DROP INDEX IF EXISTS "idx_t__id"; DROP TABLE IF EXISTS "t";`
    );
    expect(db.statements).toContain(`COMMIT;`);
    expect(db.statements[db.statements.length - 1]).toBe(`COMMIT;`);
  });

  it("replaceDB dedupes column names case-INSENSITIVELY, first-seen casing wins (Notidian-1q8y)", () => {
    const db = makeDB();
    const tables: DBTables = {
      // SQLite folds identifier case, so "Status"/"status" in one CREATE TABLE
      // throws `duplicate column name`. liveCols collapses them to the
      // first-seen casing and BOTH the CREATE and the REPLACE use that list.
      t: {
        uniques: [],
        cols: ["Status", "status", "b"],
        rows: [{ Status: "Open", b: "2" }],
      },
    };
    const ok = replaceDB(db, tables);
    expect(ok).toBe(true);
    const create = db.statements.find((s) => s.startsWith("CREATE TABLE"));
    expect(create).toBe(
      `CREATE TABLE IF NOT EXISTS "t" ("Status" char,"b" char); `
    );
    const replaceStmt = db.statements.find((s) => s.startsWith("REPLACE INTO"));
    expect(replaceStmt).toBe(
      `REPLACE INTO "t" ("Status","b") VALUES ('Open', '2');`
    );
  });

  it("replaceDB REFUSES an empty-column write that carries rows: returns false, emits NOTHING (Notidian-jn8p — retires the DROP-only wipe)", () => {
    const db = makeDB();
    const tables: DBTables = {
      // All cols falsy -> liveCols is empty -> there is no CREATE to pair with
      // a DROP. The old behavior emitted ONLY the DROP preamble and returned
      // true — silently destroying the on-disk table AND leaving m_schema
      // referencing a missing table (poisoning every later getMDB parse).
      // With rows present the write is now REFUSED outright.
      t: { uniques: [], cols: ["", ""], rows: [{ "": "x" }] },
    };
    const ok = replaceDB(db, tables);
    expect(ok).toBe(false);
    expect(db.statements).toEqual([]);
  });

  it("replaceDB skips an empty-column, empty-row table as a NO-OP: returns true, emits NOTHING (Notidian-jn8p)", () => {
    const db = makeDB();
    const tables: DBTables = {
      // No storable columns and no rows to lose: skipping the table entirely
      // (instead of DROPping it) preserves whatever exists on disk.
      t: { uniques: [], cols: ["", ""], rows: [] },
    };
    const ok = replaceDB(db, tables);
    expect(ok).toBe(true);
    expect(db.statements).toEqual([]);
  });

  it("replaceDB returns true on success and false if exec throws (mid-batch abort)", () => {
    expect(
      replaceDB(makeDB(), {
        t: { uniques: [], cols: ["a"], rows: [{ a: "1" }] },
      })
    ).toBe(true);
    expect(
      replaceDB(makeDB(true), {
        t: { uniques: [], cols: ["a"], rows: [{ a: "1" }] },
      })
    ).toBe(false);
  });
});

// =========================================================================
// (4) TRUST BOUNDARY — selectDB / deleteFromDB take a RAW `condition` string
// that is NOT sanitized. This is DELIBERATE: callers own the condition. We pin
// it as a KNOWN, documented boundary so a future reader does not mistake the
// absence of sanitization here for a defect. The identifier (table) IS quoted;
// only the WHERE condition is passed through verbatim.
// =========================================================================
describe("TRUST BOUNDARY: raw (unsanitized) WHERE condition (callers own it)", () => {
  it("KNOWN BOUNDARY — selectDB interpolates the condition verbatim (no escaping)", () => {
    const db = makeDB();
    // A condition that, if this were a value, would be an injection. selectDB
    // does NOT escape it — by contract the condition is caller-trusted SQL.
    selectDB(db, "tbl", `id = '1' OR 1=1; --`);
    expect(db.statements[0]).toBe(
      `SELECT * FROM "tbl" WHERE id = '1' OR 1=1; --;`
    );
    // The condition text appears verbatim — confirming the boundary, NOT a bug.
    expect(db.statements[0]).toContain(`OR 1=1; --`);
  });

  it("KNOWN BOUNDARY — deleteFromDB interpolates the condition verbatim (no escaping)", () => {
    const db = makeDB();
    deleteFromDB(db, "tbl", `id = '1' OR 1=1`);
    expect(db.statements[0]).toBe(`DELETE FROM "tbl" WHERE id = '1' OR 1=1;`);
    expect(db.statements[0]).toContain(`OR 1=1`);
  });

  it("KNOWN BOUNDARY — selectDB `fields` is also raw (defaults to '*')", () => {
    const db = makeDB();
    selectDB(db, "tbl", undefined, "a, b, COUNT(*)");
    expect(db.statements[0]).toBe(`SELECT a, b, COUNT(*) FROM "tbl";`);
  });

  it("selectDB without a condition emits the unconditional form (table still quoted)", () => {
    const db = makeDB();
    selectDB(db, "tbl");
    expect(db.statements[0]).toBe(`SELECT * FROM "tbl";`);
  });

  it("selectDB returns null when exec yields not-exactly-one result table", () => {
    // CapturingDB returns [] (zero tables) -> tables.length != 1 -> null.
    expect(selectDB(makeDB(), "tbl")).toBeNull();
    // exec throw -> caught -> null.
    expect(selectDB(makeDB(true), "tbl")).toBeNull();
  });

  it("selectDB returns the single result table when exec yields exactly one", () => {
    // Use a fake whose exec returns one QueryExecResult so the happy path runs.
    const oneRow = {
      exec: (): QueryExecResult[] => [
        { columns: ["a"], values: [["1"], ["2"]] },
      ],
    } as unknown as Database;
    const out = selectDB(oneRow, "tbl");
    expect(out).toEqual({
      cols: ["a"],
      rows: [{ a: "1" }, { a: "2" }],
    });
  });
});

// =========================================================================
// (5) PURE TRANSFORMS — mdbTablesToDBTables / dbResultsToDBTables
// =========================================================================
describe("mdbTablesToDBTables (cols = field.name projection; uniques default [])", () => {
  it("projects cols to field.name and passes rows through", () => {
    const tables: SpaceTables = {
      m_fields: {
        schema: { id: "s", name: "Fields", type: "db" },
        cols: [
          { name: "name", type: "text" },
          { name: "type", type: "text" },
        ],
        rows: [{ name: "Title", type: "text" }],
      },
    };
    expect(mdbTablesToDBTables(tables)).toEqual({
      m_fields: {
        uniques: [],
        cols: ["name", "type"],
        rows: [{ name: "Title", type: "text" }],
      },
    });
  });

  it("uniques default to [] per table when not provided", () => {
    const tables: SpaceTables = {
      t: {
        schema: { id: "s", name: "T", type: "db" },
        cols: [{ name: "a", type: "text" }],
        rows: [],
      },
    };
    expect(mdbTablesToDBTables(tables).t.uniques).toEqual([]);
  });

  it("uniques are taken per-table from the uniques map when provided", () => {
    const tables: SpaceTables = {
      t: {
        schema: { id: "s", name: "T", type: "db" },
        cols: [{ name: "a", type: "text" }],
        rows: [],
      },
      u: {
        schema: { id: "s2", name: "U", type: "db" },
        cols: [{ name: "b", type: "text" }],
        rows: [],
      },
    };
    const out = mdbTablesToDBTables(tables, { t: ["a"] });
    expect(out.t.uniques).toEqual(["a"]);
    // A table absent from the uniques map falls back to [].
    expect(out.u.uniques).toEqual([]);
  });

  it("empty SpaceTables -> empty DBTables", () => {
    expect(mdbTablesToDBTables({})).toEqual({});
  });
});

describe("dbResultsToDBTables (column/value zip into row records)", () => {
  it("zips columns and values into row records keyed by column name", () => {
    const res: QueryExecResult[] = [
      { columns: ["a", "b"], values: [["1", "2"], ["3", "4"]] },
    ];
    expect(dbResultsToDBTables(res)).toEqual([
      { cols: ["a", "b"], rows: [{ a: "1", b: "2" }, { a: "3", b: "4" }] },
    ]);
  });

  it("multiple result sets become multiple DBTables, order preserved", () => {
    const res: QueryExecResult[] = [
      { columns: ["a"], values: [["1"]] },
      { columns: ["b"], values: [["2"]] },
    ];
    expect(dbResultsToDBTables(res)).toEqual([
      { cols: ["a"], rows: [{ a: "1" }] },
      { cols: ["b"], rows: [{ b: "2" }] },
    ]);
  });

  it("a result set with no value rows -> empty rows array (cols preserved)", () => {
    const res: QueryExecResult[] = [{ columns: ["a", "b"], values: [] }];
    expect(dbResultsToDBTables(res)).toEqual([
      { cols: ["a", "b"], rows: [] },
    ]);
  });

  it("empty result array -> empty DBTable list", () => {
    expect(dbResultsToDBTables([])).toEqual([]);
  });

  it("CHARACTERIZE: extra value columns beyond `columns` are dropped (zip stops at columns.length)", () => {
    // The reduce iterates over `columns` only, so positional values past the
    // column count are ignored (not surfaced as a numeric key).
    const res: QueryExecResult[] = [
      { columns: ["a"], values: [["1", "extra"]] },
    ];
    expect(dbResultsToDBTables(res)).toEqual([
      { cols: ["a"], rows: [{ a: "1" }] },
    ]);
  });

  it("CHARACTERIZE: a missing value cell maps to undefined for that column key", () => {
    // Fewer values than columns -> the trailing column keys map to undefined.
    const res: QueryExecResult[] = [
      { columns: ["a", "b"], values: [["1"] as unknown as string[]] },
    ];
    const out = dbResultsToDBTables(res);
    expect(out[0].rows[0]).toEqual({ a: "1", b: undefined });
    expect(Object.keys(out[0].rows[0])).toEqual(["a", "b"]);
  });
});
