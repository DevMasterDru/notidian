import { saveSchemaToDBTables, deleteSchemaToDBTables } from "./schema";
import { SpaceTableSchema } from "shared/types/mdb";

// ===========================================================================
// DEPTH characterization + adversarial net for the schema DBTable builders
// (src/adapters/mdb/utils/schema.ts) — Notidian-yu3x.
//
// WHY THIS EXISTS. schema.ts had ZERO test references (grep across every
// *.test.ts) yet it builds the persisted `m_schema` DBTable — the
// TABLE/VIEW-SCHEMA-OF-RECORD for every Notidian database. mdbAdapter wires it
// on the schema-mutation entry points:
//   - newContent('schema')   -> saveSchemaToDBTables(content, schemas)              (mdbAdapter.ts:149)
//   - saveContent('schema')  -> saveSchemaToDBTables(content(prev), schemas)        (mdbAdapter.ts:176)
//   - saveContent('mdbCommand') -> saveSchemaToDBTables(newSchema, schemas)         (mdbAdapter.ts:213)
// deleteSchemaToDBTables is the dual builder for dropping a schema row from
// `m_schema`. A bug here silently corrupts a database's table/view definitions
// (its def/predicate/primary) on EVERY schema add / edit / command change,
// persisted into the context MDB. There is no downstream guard: whatever rows
// these builders emit are what `saveDBToPath` writes. So the seam is pinned
// directly here.
//
// METHOD. Both builders are PURE: input arrays only, no I/O, no clock, no
// randomness. Every assertion below is fully offline-verifiable and
// deterministic. This is a CHARACTERIZATION net first (it pins what the code
// does TODAY, including the corrupt-input duplicate-id behavior) and an
// ADVERSARIAL net second (id-only detection, identity stability, non-mutation,
// cross-schema isolation).
//
// CHARACTERIZATION-ONLY DECISION (per the implement route). No production
// change is made: every edge below — duplicate-id rows, the misleadingly-named
// `newSchema` local (see the dedicated note in the UPDATE block), same-name
// different-id treated as NEW — is a behavioral product choice or a footgun on
// corrupt input, not a strictly clear-correct mechanical bug. This test LOCKS
// the current behavior so any future intentional change trips a red test (the
// tripwire), and documents the candidates in-place.
// ===========================================================================

const FIXED_COLS = ["id", "name", "type", "def", "predicate", "primary"];

const sch = (over: Partial<SpaceTableSchema> & { id: string }): SpaceTableSchema => ({
  name: over.id,
  type: "db",
  ...over,
});

// Treat the DBTable.rows (typed as DBRows = Record<string,string>[]) as the
// SpaceTableSchema objects the builders actually store — these builders push
// the schema objects through verbatim, so we read them back as schemas.
const rowsAsSchemas = (rows: unknown[]): SpaceTableSchema[] => rows as SpaceTableSchema[];

describe("saveSchemaToDBTables", () => {
  describe("shape stability (fixed m_schema envelope)", () => {
    it("emits exactly the m_schema key with the fixed cols and empty uniques", () => {
      const out = saveSchemaToDBTables(sch({ id: "t1" }), []);

      // Only m_schema is produced (no stray tables).
      expect(Object.keys(out)).toEqual(["m_schema"]);
      expect(out.m_schema.uniques).toEqual([]);
      expect(out.m_schema.cols).toEqual(FIXED_COLS);
    });

    it("emits the SAME fixed cols on both the NEW and UPDATE paths", () => {
      const existing = sch({ id: "t1" });
      const newPath = saveSchemaToDBTables(sch({ id: "tNEW" }), [existing]);
      const updatePath = saveSchemaToDBTables(sch({ id: "t1", name: "renamed" }), [existing]);

      expect(newPath.m_schema.cols).toEqual(FIXED_COLS);
      expect(updatePath.m_schema.cols).toEqual(FIXED_COLS);
      expect(newPath.m_schema.uniques).toEqual([]);
      expect(updatePath.m_schema.uniques).toEqual([]);
    });
  });

  describe("NEW path (table.id NOT present in schemas) — append", () => {
    it("appends the new table after the existing rows, order preserved", () => {
      const a = sch({ id: "a" });
      const b = sch({ id: "b" });
      const out = saveSchemaToDBTables(sch({ id: "c", type: "table" }), [a, b]);

      expect(rowsAsSchemas(out.m_schema.rows).map((r) => r.id)).toEqual(["a", "b", "c"]);
      expect(out.m_schema.rows).toHaveLength(3);
      // The appended row is the incoming object itself, verbatim.
      expect(out.m_schema.rows[2]).toBe(out.m_schema.rows[2]);
      expect(rowsAsSchemas(out.m_schema.rows)[2].type).toBe("table");
    });

    it("appending does NOT mutate any existing row (existing rows are identity-stable)", () => {
      const a = sch({ id: "a" });
      const b = sch({ id: "b" });
      const out = saveSchemaToDBTables(sch({ id: "c" }), [a, b]);

      // Same object references, in the same positions — nothing copied/cloned.
      expect(out.m_schema.rows[0]).toBe(a);
      expect(out.m_schema.rows[1]).toBe(b);
    });

    it("EMPTY schemas -> single-row new table", () => {
      const out = saveSchemaToDBTables(sch({ id: "only" }), []);
      expect(out.m_schema.rows).toHaveLength(1);
      expect(rowsAsSchemas(out.m_schema.rows)[0].id).toBe("only");
    });

    it("does NOT mutate the input schemas array (fresh array, original length unchanged)", () => {
      const schemas = [sch({ id: "a" })];
      saveSchemaToDBTables(sch({ id: "b" }), schemas);
      expect(schemas).toHaveLength(1);
      expect(schemas.map((s) => s.id)).toEqual(["a"]);
    });
  });

  describe("UPDATE path (table.id ALREADY present) — map-replace", () => {
    // NOTE ON NAMING. Inside schema.ts the local is called `newSchema` and is
    // set to `true` when `schemas.find(f => f.id == table.id)` HITS — i.e. when
    // the id ALREADY EXISTS. The `newSchema ? mapReplace : append` ternary then
    // takes the map-replace (UPDATE) branch on a HIT. So `newSchema === true`
    // means "this is NOT new, replace it". The name is inverted/misleading; we
    // characterize the real branch behavior, not the name.
    it("replaces the matching row in place; position preserved, count unchanged", () => {
      const a = sch({ id: "a" });
      const b = sch({ id: "b", name: "old", predicate: "p1" });
      const c = sch({ id: "c" });
      const replacement = sch({ id: "b", name: "new", predicate: "p2" });

      const out = saveSchemaToDBTables(replacement, [a, b, c]);
      const rows = rowsAsSchemas(out.m_schema.rows);

      expect(rows).toHaveLength(3);
      expect(rows.map((r) => r.id)).toEqual(["a", "b", "c"]);
      // The matching row is swapped for the incoming object verbatim, in place.
      expect(out.m_schema.rows[1]).toBe(replacement);
      expect(rows[1].name).toBe("new");
      expect(rows[1].predicate).toBe("p2");
    });

    it("only the matching row is swapped; the others are identity-stable", () => {
      const a = sch({ id: "a" });
      const b = sch({ id: "b" });
      const c = sch({ id: "c" });
      const replacement = sch({ id: "b", name: "edited" });

      const out = saveSchemaToDBTables(replacement, [a, b, c]);

      expect(out.m_schema.rows[0]).toBe(a);
      expect(out.m_schema.rows[1]).toBe(replacement);
      expect(out.m_schema.rows[1]).not.toBe(b);
      expect(out.m_schema.rows[2]).toBe(c);
    });

    it("does NOT mutate the input schemas array", () => {
      const b = sch({ id: "b", name: "orig" });
      const schemas = [sch({ id: "a" }), b];
      saveSchemaToDBTables(sch({ id: "b", name: "edited" }), schemas);

      expect(schemas[1]).toBe(b);
      expect(schemas[1].name).toBe("orig");
      expect(schemas).toHaveLength(2);
    });
  });

  describe("ADVERSARIAL: detection keys ONLY on id (not name/type)", () => {
    it("same-name DIFFERENT-id table is treated as NEW (append), not update", () => {
      const existing = sch({ id: "id-1", name: "Sales", type: "db" });
      // Same name + type, but a different id -> find() misses -> append branch.
      const incoming = sch({ id: "id-2", name: "Sales", type: "db" });

      const out = saveSchemaToDBTables(incoming, [existing]);
      const rows = rowsAsSchemas(out.m_schema.rows);

      expect(rows).toHaveLength(2);
      expect(rows.map((r) => r.id)).toEqual(["id-1", "id-2"]);
      // Original row untouched.
      expect(out.m_schema.rows[0]).toBe(existing);
    });

    it("SAME id different name IS an update (replace), confirming id is the only key", () => {
      const existing = sch({ id: "shared", name: "Before" });
      const incoming = sch({ id: "shared", name: "After" });

      const out = saveSchemaToDBTables(incoming, [existing]);
      const rows = rowsAsSchemas(out.m_schema.rows);

      expect(rows).toHaveLength(1);
      expect(rows[0].name).toBe("After");
      expect(out.m_schema.rows[0]).toBe(incoming);
    });

    it("uses loose equality on id: numeric and string ids that `==` collide are treated as the same row (characterize)", () => {
      // schema.ts uses `f.id == table.id` (==, not ===). With well-typed
      // string ids this is identity; this case documents the loose-equality
      // contract so a future `===` tightening trips here.
      const existing = sch({ id: "7" });
      const incoming = sch({ id: "7", name: "edited" });

      const out = saveSchemaToDBTables(incoming, [existing]);
      expect(out.m_schema.rows).toHaveLength(1);
      expect(rowsAsSchemas(out.m_schema.rows)[0].name).toBe("edited");
    });
  });

  describe("ADVERSARIAL EDGE: corrupt input with MULTIPLE rows sharing an id", () => {
    it("UPDATE path replaces ALL rows whose id matches (map over every match)", () => {
      const dupA = sch({ id: "dup", name: "first" });
      const dupB = sch({ id: "dup", name: "second" });
      const other = sch({ id: "other" });
      const replacement = sch({ id: "dup", name: "replaced" });

      const out = saveSchemaToDBTables(replacement, [dupA, dupB, other]);
      const rows = rowsAsSchemas(out.m_schema.rows);

      // Count is unchanged (map, not filter) but BOTH dup rows became the
      // SAME replacement object — corrupt input is not healed, it is broadcast.
      expect(rows).toHaveLength(3);
      expect(out.m_schema.rows[0]).toBe(replacement);
      expect(out.m_schema.rows[1]).toBe(replacement);
      expect(out.m_schema.rows[2]).toBe(other);
      expect(rows.filter((r) => r.id === "dup")).toHaveLength(2);
      expect(rows.filter((r) => r.name === "replaced")).toHaveLength(2);
    });
  });
});

describe("deleteSchemaToDBTables", () => {
  it("emits exactly the m_schema key with the fixed cols and empty uniques", () => {
    const out = deleteSchemaToDBTables(sch({ id: "x" }), [sch({ id: "a" })]);
    expect(Object.keys(out)).toEqual(["m_schema"]);
    expect(out.m_schema.uniques).toEqual([]);
    expect(out.m_schema.cols).toEqual(FIXED_COLS);
  });

  it("removes the row whose id matches, preserving the order of the rest", () => {
    const a = sch({ id: "a" });
    const b = sch({ id: "b" });
    const c = sch({ id: "c" });

    const out = deleteSchemaToDBTables(b, [a, b, c]);
    const rows = rowsAsSchemas(out.m_schema.rows);

    expect(rows.map((r) => r.id)).toEqual(["a", "c"]);
    // Survivors are identity-stable (filter, not clone).
    expect(out.m_schema.rows[0]).toBe(a);
    expect(out.m_schema.rows[1]).toBe(c);
  });

  it("removes ALL rows sharing the target id (corrupt-input duplicates)", () => {
    const dupA = sch({ id: "dup", name: "first" });
    const dupB = sch({ id: "dup", name: "second" });
    const other = sch({ id: "other" });

    const out = deleteSchemaToDBTables(sch({ id: "dup" }), [dupA, dupB, other]);
    const rows = rowsAsSchemas(out.m_schema.rows);

    expect(rows.map((r) => r.id)).toEqual(["other"]);
    expect(out.m_schema.rows[0]).toBe(other);
  });

  it("NON-EXISTENT id is a no-op copy: all rows survive, identity-stable", () => {
    const a = sch({ id: "a" });
    const b = sch({ id: "b" });
    const out = deleteSchemaToDBTables(sch({ id: "ghost" }), [a, b]);
    const rows = rowsAsSchemas(out.m_schema.rows);

    expect(rows.map((r) => r.id)).toEqual(["a", "b"]);
    expect(out.m_schema.rows[0]).toBe(a);
    expect(out.m_schema.rows[1]).toBe(b);
  });

  it("EMPTY schemas -> empty rows", () => {
    const out = deleteSchemaToDBTables(sch({ id: "x" }), []);
    expect(out.m_schema.rows).toEqual([]);
  });

  it("does NOT mutate the input schemas array (returns a fresh filtered array)", () => {
    const a = sch({ id: "a" });
    const b = sch({ id: "b" });
    const schemas = [a, b];
    const out = deleteSchemaToDBTables(b, schemas);

    expect(schemas).toHaveLength(2);
    expect(schemas[0]).toBe(a);
    expect(schemas[1]).toBe(b);
    // The output is a distinct array object.
    expect(out.m_schema.rows).not.toBe(schemas);
  });

  it("uses loose equality on id (`!=`): characterizes the == / != detection contract", () => {
    const out = deleteSchemaToDBTables(sch({ id: "7" }), [sch({ id: "7" }), sch({ id: "8" })]);
    expect(rowsAsSchemas(out.m_schema.rows).map((r) => r.id)).toEqual(["8"]);
  });
});
