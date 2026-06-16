import { savePropertyToDBTables, deletePropertyToDBTables } from "./property";
import { fieldSchema } from "shared/schemas/fields";
import { SpaceProperty } from "shared/types/mdb";

// ===========================================================================
// DEPTH characterization + adversarial net for the property DBTable builders
// (src/adapters/mdb/utils/property.ts) — Notidian-gm6q.
//
// WHY THIS EXISTS. property.ts had ZERO test references (grep across every
// *.test.ts) yet it builds the persisted `m_fields` DBTable — the
// SCHEMA-OF-RECORD for every Notidian database column. mdbAdapter wires it on
// the THREE column-mutation entry points:
//   - newContent('field')   -> savePropertyToDBTables(content, oldFields)        (ADD)
//   - saveContent('field')  -> savePropertyToDBTables(content, oldFields, oldField) (RENAME/EDIT)
//   - deleteContent('field') -> deletePropertyToDBTables(field, fields)          (DELETE)
// A bug here silently corrupts a database's column definitions on EVERY
// property add / rename / delete, persisted into the context MDB. There is no
// downstream guard: whatever rows these builders emit are what `saveDBToPath`
// writes. So the seam is pinned directly here.
//
// METHOD. Both builders are PURE: input arrays + the static `fieldSchema`
// constant, no I/O, no clock, no randomness. Every assertion below is fully
// offline-verifiable and deterministic. This is a CHARACTERIZATION net first
// (it pins what the code does TODAY, including a footgun on an unreachable
// path) and an ADVERSARIAL net second (sanitizer coupling, duplicate-name
// collisions, cross-schema delete isolation, non-mutation).
//
// PRODUCTION-CHANGE LEDGER (per the implement route's "no production change
// unless a CLEAR-CORRECT bug surfaces"). Two gaps were characterized here:
//
//   GAP 1 — duplicate (name,schemaId) m_fields rows — FIXED in Notidian-ub72.
//     The persisted m_fields table declares the unique key "name,schemaId"
//     (fieldSchema.uniques) yet the builder could emit two rows with the same
//     name+schemaId when the sanitized new name collided with an existing field.
//     This was a CLEAR-CORRECT authority/consistency violation (the table broke
//     its own contract), so the builder now routes the sanitized name through
//     uniqueNameFromString — scoped to the same schemaId, excluding the renamed
//     slot — exactly as the CSV-import sibling (tableCsv.ts) already did. See the
//     "name collision dedup" block below.
//
//   GAP 2 — `oldColumn given but NOT found` edge (see the dedicated block) —
//     still CHARACTERIZED, deliberately NOT changed. Today it APPENDS the new
//     column instead of being a no-op. We leave it because:
//       (a) it is UNREACHABLE from the current callers — saveContent only ever
//           passes an `oldField` it just resolved out of the SAME `oldFields`
//           array via `.find(...)`, so a passed oldColumn is always present;
//       (b) "append-as-add" vs "no-op" vs "throw" is a behavioral product choice
//           with no obviously-right answer — flipping it silently could regress a
//           hypothetical future caller that relies on the add-fallback.
//     That test LOCKS today's append behavior so a future intentional flip trips
//     a red test (the tripwire).
// ===========================================================================

const prop = (over: Partial<SpaceProperty> & { name: string }): SpaceProperty => ({
  schemaId: "s1",
  type: "text",
  ...over,
});

describe("savePropertyToDBTables", () => {
  describe("shape stability (fieldSchema echoed verbatim)", () => {
    it("emits exactly the m_fields key with fieldSchema.uniques/cols by reference and rows = newFields", () => {
      const fields = [prop({ name: "a" })];
      const out = savePropertyToDBTables(prop({ name: "b" }), fields);

      // Only m_fields is produced (no stray tables).
      expect(Object.keys(out)).toEqual(["m_fields"]);
      // uniques/cols are the canonical fieldSchema constants, echoed verbatim.
      expect(out.m_fields.uniques).toBe(fieldSchema.uniques);
      expect(out.m_fields.cols).toBe(fieldSchema.cols);
      expect(out.m_fields.uniques).toEqual(["name,schemaId"]);
      expect(out.m_fields.cols).toEqual([
        "name",
        "schemaId",
        "type",
        "value",
        "source",
        "attrs",
        "hidden",
        "unique",
        "primary",
      ]);
    });
  });

  describe("ADD path (no oldColumn)", () => {
    it("appends the new column, preserving the existing fields and their order", () => {
      const a = prop({ name: "a" });
      const b = prop({ name: "b" });
      const out = savePropertyToDBTables(prop({ name: "c", type: "number" }), [a, b]);

      expect(out.m_fields.rows.map((r) => (r as SpaceProperty).name)).toEqual(["a", "b", "c"]);
      expect((out.m_fields.rows[2] as SpaceProperty).type).toBe("number");
    });

    it("appends onto an empty field set", () => {
      const out = savePropertyToDBTables(prop({ name: "only" }), []);
      expect(out.m_fields.rows).toHaveLength(1);
      expect((out.m_fields.rows[0] as SpaceProperty).name).toBe("only");
    });

    it("passes schemaId/type/value/source/attrs/hidden/unique/primary through UNTOUCHED — only `name` is sanitized", () => {
      const incoming = prop({
        name: "plainname",
        schemaId: "schemaX",
        type: "date",
        value: "v",
        source: "src",
        attrs: "{json}",
        hidden: "true",
        unique: "true",
        primary: "true",
      });
      const out = savePropertyToDBTables(incoming, []);
      const row = out.m_fields.rows[0] as SpaceProperty;

      expect(row).toEqual({
        name: "plainname", // unchanged by sanitize (no quotes / leading sigils)
        schemaId: "schemaX",
        type: "date",
        value: "v",
        source: "src",
        attrs: "{json}",
        hidden: "true",
        unique: "true",
        primary: "true",
      });
    });

    // --- sanitizeColumnName INTERACTION (the persisted identity transform) ---
    // sanitizeColumnName strips ALL double-quotes, then peels a LEADING run of
    // `_`/`$`. Order matters: quotes are stripped FIRST and can EXPOSE a
    // masked leading sigil. These cases pin that the BUILDER applies that exact
    // transform to the stored `name`.
    it('sanitizes a leading double-quote off the name (\'"x\' -> "x")', () => {
      const out = savePropertyToDBTables(prop({ name: '"x' }), []);
      expect((out.m_fields.rows[0] as SpaceProperty).name).toBe("x");
    });

    it('strips a leading sigil run ("__y" -> "y", "$$z" -> "z")', () => {
      expect(
        (savePropertyToDBTables(prop({ name: "__y" }), []).m_fields.rows[0] as SpaceProperty).name,
      ).toBe("y");
      expect(
        (savePropertyToDBTables(prop({ name: "$$z" }), []).m_fields.rows[0] as SpaceProperty).name,
      ).toBe("z");
    });

    it('quote-strip EXPOSES a masked leading sigil in one pass (\'"$x\' -> "x")', () => {
      // quotes removed first ('"$x' -> '$x'), then the now-leading '$' is peeled.
      const out = savePropertyToDBTables(prop({ name: '"$x' }), []);
      expect((out.m_fields.rows[0] as SpaceProperty).name).toBe("x");
    });

    it("strips embedded (non-leading) double-quotes but KEEPS interior sigils", () => {
      // quotes anywhere are removed; sigils are only peeled from the LEADING run.
      const out = savePropertyToDBTables(prop({ name: 'a"b_c$d' }), []);
      expect((out.m_fields.rows[0] as SpaceProperty).name).toBe("ab_c$d");
    });
  });

  describe("RENAME path (oldColumn given AND found by RAW old name)", () => {
    it("replaces in place: preserves position and total count", () => {
      const a = prop({ name: "a" });
      const b = prop({ name: "b" });
      const c = prop({ name: "c" });
      const out = savePropertyToDBTables(
        prop({ name: "b2", type: "number" }),
        [a, b, c],
        b, // oldColumn matched by its RAW name "b"
      );

      expect(out.m_fields.rows).toHaveLength(3); // no growth
      expect(out.m_fields.rows.map((r) => (r as SpaceProperty).name)).toEqual(["a", "b2", "c"]);
      // the replaced slot carries the NEW column wholesale, not a merge.
      expect((out.m_fields.rows[1] as SpaceProperty).type).toBe("number");
    });

    it("matches oldColumn by its RAW name while the NEW name is sanitized", () => {
      // The MATCH key is the raw old name; the STORED new name is sanitized.
      const old = prop({ name: "old" });
      const out = savePropertyToDBTables(prop({ name: '"_new' }), [old], old);

      expect(out.m_fields.rows).toHaveLength(1);
      // '"_new' -> strip quote -> '_new' -> peel leading '_' -> 'new'
      expect((out.m_fields.rows[0] as SpaceProperty).name).toBe("new");
    });

    it("finds the FIRST raw-name match when duplicates exist (findIndex semantics)", () => {
      const a1 = prop({ name: "dup", value: "first" });
      const a2 = prop({ name: "dup", value: "second" });
      const out = savePropertyToDBTables(prop({ name: "renamed" }), [a1, a2], prop({ name: "dup" }));

      // only index 0 (first match) is replaced; the second "dup" survives.
      expect(out.m_fields.rows.map((r) => (r as SpaceProperty).name)).toEqual(["renamed", "dup"]);
      expect((out.m_fields.rows[1] as SpaceProperty).value).toBe("second");
    });

    it("matches oldColumn by (name AND schemaId) — the table's own identity key (Notidian-ub72)", () => {
      // ADVERSARIAL: the slot being replaced is resolved by the SAME identity key
      // the callers use (mdbAdapter.saveContent: `name AND schemaId`) and that
      // deletePropertyToDBTables filters on — NOT name alone. An oldColumn that
      // matches a stored field by name AND schemaId replaces it in place.
      const stored = prop({ name: "x", schemaId: "sA" });
      const out = savePropertyToDBTables(
        prop({ name: "y", schemaId: "sA" }),
        [stored],
        prop({ name: "x", schemaId: "sA" }),
      );
      expect(out.m_fields.rows).toHaveLength(1);
      expect((out.m_fields.rows[0] as SpaceProperty).name).toBe("y");
    });

    it("does NOT match an oldColumn whose schemaId differs from the stored field (Notidian-ub72)", () => {
      // ADVERSARIAL: a name-only match would resolve to the wrong-schema row.
      // Since the oldColumn's (name,schemaId) is absent, the rename falls through
      // to the ADD fallback (oldFieldIndex == -1) rather than clobbering x@sA.
      const stored = prop({ name: "x", schemaId: "sA" });
      const out = savePropertyToDBTables(
        prop({ name: "y", schemaId: "sB" }),
        [stored],
        prop({ name: "x", schemaId: "sZZZ" }), // same name, different schemaId
      );
      expect(out.m_fields.rows.map((r) => (r as SpaceProperty).name)).toEqual(["x", "y"]);
      expect((out.m_fields.rows[0] as SpaceProperty).schemaId).toBe("sA"); // stored row untouched
    });
  });

  describe("EDGE: oldColumn given but NOT found (oldFieldIndex == -1)", () => {
    // CHARACTERIZATION OF A FOOTGUN. A caller that passes oldColumn signals
    // intent to RENAME an existing field. When that field is absent, the code
    // falls into the SAME `oldFieldIndex == -1` branch as the ADD path and
    // APPENDS the new column — turning a rename-of-a-missing-column into a
    // silent ADD (and, if the new name duplicates a different stored field, a
    // duplicate-name row, see below).
    //
    // CANDIDATE CLEAR-CORRECT FIX (intentionally NOT applied here): make this a
    // no-op (return the unchanged fields) or guard the rename. We DO NOT change
    // it because the path is UNREACHABLE from current callers (saveContent only
    // passes an oldField it just `.find`-resolved out of the same array) and
    // the chosen fallback is a product decision, not a mechanical one. This
    // test LOCKS today's append behavior so a future intentional flip is caught.
    it("APPENDS the new column (does NOT no-op) when oldColumn is absent", () => {
      const a = prop({ name: "a" });
      const out = savePropertyToDBTables(
        prop({ name: "ghost-rename" }),
        [a],
        prop({ name: "not-present" }),
      );

      // Today: append. (If this ever becomes a no-op, update this test AND the
      // comment above — that is the intended tripwire.)
      expect(out.m_fields.rows).toHaveLength(2);
      expect(out.m_fields.rows.map((r) => (r as SpaceProperty).name)).toEqual(["a", "ghost-rename"]);
    });
  });

  describe("name collision dedup (uniqueNameFromString guard — Notidian-ub72)", () => {
    // FIXED in Notidian-ub72 (was a characterized GAP under Notidian-gm6q).
    // m_fields declares the unique key "name,schemaId" (fieldSchema.uniques), yet
    // the builder could emit TWO rows with the same (name,schemaId) when the
    // sanitized new name collided with an existing field. The builder now routes
    // the sanitized name through uniqueNameFromString (the same canonical helper
    // CSV import uses in tableCsv.ts), scoped to the SAME schemaId and — on the
    // rename path — excluding the slot being replaced. So `title` onto an existing
    // `title` becomes `title1`, preserving the table's own uniqueness contract.
    it("ADD dedups a colliding new name against the existing same-schemaId field", () => {
      const existing = prop({ name: "title", schemaId: "s1" });
      const out = savePropertyToDBTables(prop({ name: "title", schemaId: "s1" }), [existing]);

      const names = out.m_fields.rows.map((r) => (r as SpaceProperty).name);
      expect(names).toEqual(["title", "title1"]); // collision resolved
      expect(out.m_fields.rows).toHaveLength(2);
    });

    it("ADD dedups AFTER sanitization too ('\"title' sanitizes to 'title', then dedups to 'title1')", () => {
      const existing = prop({ name: "title" });
      const out = savePropertyToDBTables(prop({ name: '"title' }), [existing]);
      const names = out.m_fields.rows.map((r) => (r as SpaceProperty).name);
      expect(names).toEqual(["title", "title1"]); // sanitized name collides, then deduped
    });

    it("ADD walks the suffix counter when several same-schemaId names already collide", () => {
      const out = savePropertyToDBTables(prop({ name: "title", schemaId: "s1" }), [
        prop({ name: "title", schemaId: "s1" }),
        prop({ name: "title1", schemaId: "s1" }),
      ]);
      const names = out.m_fields.rows.map((r) => (r as SpaceProperty).name);
      expect(names).toEqual(["title", "title1", "title2"]); // next free suffix
    });

    it("does NOT dedup a same-name field that lives in a DIFFERENT schemaId", () => {
      // ADVERSARIAL cross-schema isolation: the unique key is (name,schemaId), so
      // `title@s2` is legitimately distinct from `title@s1`. Adding `title@s1`
      // must NOT be suffixed just because `title@s2` exists.
      const otherSchema = prop({ name: "title", schemaId: "s2" });
      const out = savePropertyToDBTables(prop({ name: "title", schemaId: "s1" }), [otherSchema]);
      const rows = out.m_fields.rows as SpaceProperty[];
      expect(rows.map((r) => r.name)).toEqual(["title", "title"]); // both keep their name
      expect(rows.map((r) => r.schemaId)).toEqual(["s2", "s1"]); // distinct by schemaId
    });

    it("RENAME that keeps its own name is a NO-OP, not a self-collision", () => {
      // The slot being replaced (oldFieldIndex) is excluded from the collision
      // set, so renaming `title` to itself does not get suffixed to `title1`.
      const old = prop({ name: "title", schemaId: "s1" });
      const out = savePropertyToDBTables(prop({ name: "title", schemaId: "s1" }), [old], old);
      expect(out.m_fields.rows).toHaveLength(1);
      expect((out.m_fields.rows[0] as SpaceProperty).name).toBe("title"); // unchanged, no '1'
    });

    it("RENAME-self is a NO-OP even when a same-name field exists in an EARLIER other schemaId (Notidian-ub72)", () => {
      // REGRESSION. `fields` is the WHOLE m_fields table across schemaIds, where
      // same-name fields in different schemas (e.g. per-schema `Name`/`File`) are
      // the norm. A name-ONLY oldFieldIndex would resolve to the earlier a@s2 row,
      // clobber it, AND leave the genuine a@s1 sibling in the collision set — so a
      // no-op type/format edit of a@s1 would persist a@s1 -> a1@s1 (silent name
      // mutation of a column's SQL/authority identity). With (name,schemaId)
      // identity the edited slot is correctly excluded and the name is preserved.
      const aS2 = prop({ name: "a", schemaId: "s2" });
      const aS1 = prop({ name: "a", schemaId: "s1", type: "text" });
      const out = savePropertyToDBTables(
        prop({ name: "a", schemaId: "s1", type: "number" }), // same name, only type changes
        [aS2, aS1],
        aS1,
      );
      const rows = out.m_fields.rows as SpaceProperty[];
      // Both rows keep name "a"; the s1 row is replaced in place with the new type.
      expect(rows.map((r) => r.name)).toEqual(["a", "a"]);
      expect(rows.map((r) => r.schemaId)).toEqual(["s2", "s1"]);
      expect(rows[0].type).toBe("text"); // other-schema row UNTOUCHED
      expect(rows[1].type).toBe("number"); // edited slot carries the new type
    });

    it("RENAME onto an EXISTING OTHER field's name dedups against that other field", () => {
      // ADVERSARIAL. Renaming `b` -> `a` while a different `a` already exists must
      // suffix the new name (`a1`) — the excluded slot is the one being renamed
      // (`b`), not the colliding sibling (`a`), so the sibling still guards.
      const a = prop({ name: "a", schemaId: "s1" });
      const b = prop({ name: "b", schemaId: "s1" });
      const out = savePropertyToDBTables(prop({ name: "a", schemaId: "s1" }), [a, b], b);
      expect(out.m_fields.rows.map((r) => (r as SpaceProperty).name)).toEqual(["a", "a1"]);
      expect(out.m_fields.rows).toHaveLength(2); // in-place replace, no growth
    });
  });

  describe("input non-mutation (save)", () => {
    it("does not mutate the incoming fields array (ADD spreads a new array)", () => {
      const fields = [prop({ name: "a" })];
      const snapshot = JSON.parse(JSON.stringify(fields));
      const out = savePropertyToDBTables(prop({ name: "b" }), fields);

      expect(fields).toEqual(snapshot); // unchanged
      expect(out.m_fields.rows).not.toBe(fields); // fresh array
    });

    it("does not mutate the incoming fields array (RENAME maps to a new array)", () => {
      const a = prop({ name: "a" });
      const fields = [a];
      const snapshot = JSON.parse(JSON.stringify(fields));
      savePropertyToDBTables(prop({ name: "a2" }), fields, a);
      expect(fields).toEqual(snapshot);
    });

    it("does not mutate the incoming newColumn object (spreads into a fresh column)", () => {
      const incoming = prop({ name: '"_raw' });
      const snapshot = JSON.parse(JSON.stringify(incoming));
      savePropertyToDBTables(incoming, []);
      expect(incoming).toEqual(snapshot); // newColumn.name still the raw '"_raw'
      expect(incoming.name).toBe('"_raw');
    });
  });
});

describe("deletePropertyToDBTables", () => {
  describe("shape stability", () => {
    it("emits exactly the m_fields key with fieldSchema.uniques/cols echoed verbatim", () => {
      const out = deletePropertyToDBTables(prop({ name: "a" }), [prop({ name: "a" })]);
      expect(Object.keys(out)).toEqual(["m_fields"]);
      expect(out.m_fields.uniques).toBe(fieldSchema.uniques);
      expect(out.m_fields.cols).toBe(fieldSchema.cols);
    });
  });

  it("removes the matching (name AND schemaId) column, preserving order of the rest", () => {
    const a = prop({ name: "a", schemaId: "s1" });
    const b = prop({ name: "b", schemaId: "s1" });
    const c = prop({ name: "c", schemaId: "s1" });
    const out = deletePropertyToDBTables(b, [a, b, c]);
    expect(out.m_fields.rows.map((r) => (r as SpaceProperty).name)).toEqual(["a", "c"]);
  });

  describe("filter key is (name AND schemaId)", () => {
    it("does NOT delete a same-name column in a DIFFERENT schemaId", () => {
      // ADVERSARIAL cross-schema isolation: column "x" exists in two schemas;
      // deleting x@s1 must leave x@s2 intact.
      const xs1 = prop({ name: "x", schemaId: "s1" });
      const xs2 = prop({ name: "x", schemaId: "s2" });
      const out = deletePropertyToDBTables(xs1, [xs1, xs2]);

      expect(out.m_fields.rows).toHaveLength(1);
      expect((out.m_fields.rows[0] as SpaceProperty).schemaId).toBe("s2");
    });

    it("does NOT delete a same-schemaId column with a DIFFERENT name", () => {
      const a = prop({ name: "a", schemaId: "s1" });
      const b = prop({ name: "b", schemaId: "s1" });
      const out = deletePropertyToDBTables(prop({ name: "zzz", schemaId: "s1" }), [a, b]);
      expect(out.m_fields.rows.map((r) => (r as SpaceProperty).name)).toEqual(["a", "b"]);
    });

    it("deletes EVERY row matching (name AND schemaId) when duplicates exist", () => {
      // filter removes all matches, not just the first.
      const dup1 = prop({ name: "d", schemaId: "s1", value: "1" });
      const dup2 = prop({ name: "d", schemaId: "s1", value: "2" });
      const keep = prop({ name: "k", schemaId: "s1" });
      const out = deletePropertyToDBTables(prop({ name: "d", schemaId: "s1" }), [dup1, dup2, keep]);
      expect(out.m_fields.rows.map((r) => (r as SpaceProperty).name)).toEqual(["k"]);
    });
  });

  describe("no-op cases", () => {
    it("is a no-op (returns all rows) when the column does not exist", () => {
      const a = prop({ name: "a", schemaId: "s1" });
      const out = deletePropertyToDBTables(prop({ name: "nope", schemaId: "s1" }), [a]);
      expect(out.m_fields.rows.map((r) => (r as SpaceProperty).name)).toEqual(["a"]);
    });

    it("returns an empty rows array when deleting from an empty field set", () => {
      const out = deletePropertyToDBTables(prop({ name: "x" }), []);
      expect(out.m_fields.rows).toEqual([]);
    });
  });

  describe("input non-mutation (delete)", () => {
    it("returns a FRESH array (spread) and does not mutate the input fields", () => {
      const a = prop({ name: "a", schemaId: "s1" });
      const b = prop({ name: "b", schemaId: "s1" });
      const fields = [a, b];
      const snapshot = JSON.parse(JSON.stringify(fields));
      const out = deletePropertyToDBTables(a, fields);

      expect(fields).toEqual(snapshot); // input array unchanged
      expect(out.m_fields.rows).not.toBe(fields); // fresh array, not aliased
      // the surviving row object is the SAME reference (rows are not cloned).
      expect(out.m_fields.rows[0]).toBe(b);
    });
  });
});
