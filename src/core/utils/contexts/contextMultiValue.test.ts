import { PathPropertyName } from "shared/types/context";
import { DBRow, SpaceTable } from "shared/types/mdb";
import { parseMultiString } from "utils/parsers";
import { serializeMultiString } from "utils/serializers";
import {
  deletePropertyMultiValue,
  insertPropertyMultiValue,
} from "./context";

// ---------------------------------------------------------------------------
// DEPTH (Notidian-x9uf) — CHARACTERIZATION + adversarial net for the two PURE
// multi-value mutators exported by context.ts:
//
//   insertPropertyMultiValue(folder, lookupField, lookupValue, field, value)
//   deletePropertyMultiValue(folder, lookupField, lookupValue, field, value)
//
// Both had ZERO direct coverage despite being exactly the multi-value-corruption
// class behind the closed P0s Notidian-5tl/97l (replaceLinkInValue corrupting
// unrelated multi-link values) and Notidian-oec ([object Object] YAML on grouped
// drag). Each maps over folder.rows, matches a row by `lookupField == lookupValue`
// (loose `==`), and re-serializes folder[field] via:
//
//   insert:  serializeMultiString([...parseMultiString(old), value])
//   delete:  serializeMultiString(parseMultiString(old).filter(g => g != value))
//
// The HAZARD is the parse/serialize asymmetry (ADR 0030):
//   - parseMultiString reads BOTH the JSON-array form ('["a","b"]') AND the
//     human comma-display form ('a, b') — trimming each element and un-escaping
//     '\,' -> ',' per element.
//   - serializeMultiString ALWAYS JSON.stringifies.
// So whatever the input form, the WRITTEN form is always JSON; and delete's
// strict-ish `!=` is measured against the TRIMMED/UN-ESCAPED parse output.
//
// This file PINS the shipped behavior first (src unchanged on first run, the
// 3fs/3wa pattern), then adds adversarial cases that lock the CORRUPTION
// INVARIANT: any row not matched by lookup is byte-identical (===) in the output.
//
// Pure / offline: plain object fixtures, no SpaceManager, vault, or mocks.
// ---------------------------------------------------------------------------

// --- fixtures ---------------------------------------------------------------

const SCHEMA = { id: "files", name: "Files", type: "db" };

/** Build a SpaceTable around a list of rows (cols/schema are inert for these
 *  pure mutators — they map over rows only — but we carry a real shape). */
const table = (rows: DBRow[]): SpaceTable => ({
  schema: SCHEMA,
  cols: [
    { name: PathPropertyName, type: "file" },
    { name: "tags", type: "option-multi" },
  ],
  rows,
});

/** Convenience: the JSON multi form exactly as serializeMultiString writes it. */
const json = (...entries: string[]) => serializeMultiString(entries);

// ===========================================================================
// (1) CHARACTERIZATION — insertPropertyMultiValue: always writes JSON
// ===========================================================================

describe("insertPropertyMultiValue — characterization (always serializes to JSON)", () => {
  it("appends to a JSON-form field and writes JSON", () => {
    const t = table([{ [PathPropertyName]: "A.md", tags: json("a") }]);
    const out = insertPropertyMultiValue(t, PathPropertyName, "A.md", "tags", "b");
    expect(out.rows[0].tags).toBe('["a","b"]');
    expect(parseMultiString(out.rows[0].tags)).toEqual(["a", "b"]);
  });

  it("appends to a DISPLAY-form (comma) field and writes JSON (form converges)", () => {
    // Input is the human comma form; parseMultiString reads it, serialize writes
    // JSON. This is the parse/serialize asymmetry made concrete: write form != read form.
    const t = table([{ [PathPropertyName]: "A.md", tags: "a, b" }]);
    const out = insertPropertyMultiValue(t, PathPropertyName, "A.md", "tags", "c");
    expect(out.rows[0].tags).toBe('["a","b","c"]');
    expect(parseMultiString(out.rows[0].tags)).toEqual(["a", "b", "c"]);
  });

  it("empty-string field insert yields [value] (NOT [''] — empty parses to [])", () => {
    // parseMultiDisplayString('') -> [] (the match regex yields no tokens), so the
    // empty string does NOT survive as a phantom '' element.
    const t = table([{ [PathPropertyName]: "A.md", tags: "" }]);
    const out = insertPropertyMultiValue(t, PathPropertyName, "A.md", "tags", "x");
    expect(out.rows[0].tags).toBe('["x"]');
  });

  it("undefined/missing field insert yields [value] (ensureString('') -> [])", () => {
    const t = table([{ [PathPropertyName]: "A.md" } as DBRow]);
    const out = insertPropertyMultiValue(t, PathPropertyName, "A.md", "tags", "x");
    expect(out.rows[0].tags).toBe('["x"]');
  });

  it("NO DEDUP: inserting an already-present value duplicates it", () => {
    const t = table([{ [PathPropertyName]: "A.md", tags: json("a") }]);
    const out = insertPropertyMultiValue(t, PathPropertyName, "A.md", "tags", "a");
    expect(out.rows[0].tags).toBe('["a","a"]');
  });
});

// ===========================================================================
// (2) CHARACTERIZATION — deletePropertyMultiValue: filters by `!=`, writes JSON
// ===========================================================================

describe("deletePropertyMultiValue — characterization (filter on parsed values, write JSON)", () => {
  it("removes the matching value from a JSON-form field", () => {
    const t = table([{ [PathPropertyName]: "A.md", tags: json("a", "b", "c") }]);
    const out = deletePropertyMultiValue(t, PathPropertyName, "A.md", "tags", "b");
    expect(out.rows[0].tags).toBe('["a","c"]');
  });

  it("DELETE-REMOVES-ALL: every occurrence of a duplicated value is filtered", () => {
    const t = table([{ [PathPropertyName]: "A.md", tags: json("a", "b", "b") }]);
    const out = deletePropertyMultiValue(t, PathPropertyName, "A.md", "tags", "b");
    expect(out.rows[0].tags).toBe('["a"]');
  });

  it("ZERO-MATCH value within a row is a value-level reserialize to JSON, no element dropped", () => {
    // The value isn't present, so nothing is filtered; the field still gets
    // re-serialized from its parsed form (display -> JSON convergence).
    const t = table([{ [PathPropertyName]: "A.md", tags: "a, b" }]);
    const out = deletePropertyMultiValue(t, PathPropertyName, "A.md", "tags", "zzz");
    expect(out.rows[0].tags).toBe('["a","b"]');
  });

  it("deleting from an empty/undefined field yields [] serialized", () => {
    const t = table([{ [PathPropertyName]: "A.md", tags: "" }]);
    expect(
      deletePropertyMultiValue(t, PathPropertyName, "A.md", "tags", "x").rows[0]
        .tags
    ).toBe("[]");
    const t2 = table([{ [PathPropertyName]: "A.md" } as DBRow]);
    expect(
      deletePropertyMultiValue(t2, PathPropertyName, "A.md", "tags", "x").rows[0]
        .tags
    ).toBe("[]");
  });
});

// ===========================================================================
// (3) ADVERSARIAL — the `!=` vs trim() asymmetry (delete's sharpest edge)
// ===========================================================================

describe("ADVERSARIAL: delete strict `!=` measured against the TRIMMED parse output", () => {
  it("a TRIMMED value deletes from a padded display-form field", () => {
    // 'a, b' parses (with trim) to ['a','b']; the trimmed 'b' matches and is removed.
    const t = table([{ [PathPropertyName]: "A.md", tags: "a, b" }]);
    const out = deletePropertyMultiValue(t, PathPropertyName, "A.md", "tags", "b");
    expect(out.rows[0].tags).toBe('["a"]');
  });

  it("a PADDED value does NOT match the trimmed parse output (corruption-class edge)", () => {
    // parseMultiString already trimmed each element to 'a'/'b'; the caller passing
    // a whitespace-padded ' b' therefore fails the `!=` filter and NOTHING is
    // removed. This is the exact asymmetry the bead flags. PINNED as shipped.
    const t = table([{ [PathPropertyName]: "A.md", tags: "a, b" }]);
    const out = deletePropertyMultiValue(t, PathPropertyName, "A.md", "tags", " b");
    expect(out.rows[0].tags).toBe('["a","b"]'); // ' b' did not match 'b' -> no-op delete
  });
});

// ===========================================================================
// (4) ADVERSARIAL — escaped / literal comma round-trip (ADR 0030)
// ===========================================================================

describe("ADVERSARIAL: escaped/literal-comma values survive insert -> delete", () => {
  it("JSON-stored element containing a literal comma round-trips insert then delete", () => {
    // Stored as JSON, 'a,b' is a single element. Insert 'c', then delete 'a,b'.
    const t = table([{ [PathPropertyName]: "A.md", tags: json("a,b") }]);
    const inserted = insertPropertyMultiValue(t, PathPropertyName, "A.md", "tags", "c");
    expect(inserted.rows[0].tags).toBe('["a,b","c"]');
    const deleted = deletePropertyMultiValue(
      inserted,
      PathPropertyName,
      "A.md",
      "tags",
      "a,b"
    );
    expect(deleted.rows[0].tags).toBe('["c"]');
  });

  it("DISPLAY-stored escaped comma ('a\\,b, c') parses to ['a,b','c'] then writes JSON", () => {
    // The escaped-comma display form (ADR 0030 Option A) un-escapes per element;
    // 'a\,b' becomes the single literal 'a,b'. Deleting 'a,b' removes it.
    const t = table([{ [PathPropertyName]: "A.md", tags: "a\\,b, c" }]);
    const out = deletePropertyMultiValue(t, PathPropertyName, "A.md", "tags", "a,b");
    expect(out.rows[0].tags).toBe('["c"]');
  });

  it("inserting a comma-bearing value via display form keeps it intact as one element", () => {
    const t = table([{ [PathPropertyName]: "A.md", tags: "x" }]);
    const out = insertPropertyMultiValue(t, PathPropertyName, "A.md", "tags", "a,b");
    // serializeMultiString JSON-quotes the literal comma -> a single element.
    expect(out.rows[0].tags).toBe('["x","a,b"]');
    expect(parseMultiString(out.rows[0].tags)).toEqual(["x", "a,b"]);
  });
});

// ===========================================================================
// (5) THE CORRUPTION INVARIANT — non-matched rows are byte-identical (===)
// ===========================================================================

describe("CORRUPTION INVARIANT: lookup scopes the mutation; untouched rows are ===", () => {
  const buildTable = () =>
    table([
      { [PathPropertyName]: "A.md", tags: json("a", "b") },
      { [PathPropertyName]: "B.md", tags: json("c", "d") },
      { [PathPropertyName]: "C.md", tags: "e, f" }, // display form, deliberately
    ]);

  it("insert: ONLY the matched row changes; the rest keep object identity", () => {
    const t = buildTable();
    const out = insertPropertyMultiValue(t, PathPropertyName, "B.md", "tags", "x");
    // Matched row mutated.
    expect(out.rows[1].tags).toBe('["c","d","x"]');
    // Untouched rows are the SAME object references (no spread, no reserialize).
    expect(out.rows[0]).toBe(t.rows[0]);
    expect(out.rows[2]).toBe(t.rows[2]);
    // And the display-form row C.md keeps its raw display bytes (NOT converted to JSON).
    expect(out.rows[2].tags).toBe("e, f");
  });

  it("delete: ONLY the matched row changes; the rest keep object identity", () => {
    const t = buildTable();
    const out = deletePropertyMultiValue(t, PathPropertyName, "A.md", "tags", "a");
    expect(out.rows[0].tags).toBe('["b"]');
    expect(out.rows[1]).toBe(t.rows[1]);
    expect(out.rows[2]).toBe(t.rows[2]);
    expect(out.rows[2].tags).toBe("e, f");
  });

  it("ZERO-MATCH lookup is a strict no-op: every row keeps object identity", () => {
    const t = buildTable();
    const ins = insertPropertyMultiValue(t, PathPropertyName, "Absent.md", "tags", "x");
    const del = deletePropertyMultiValue(t, PathPropertyName, "Absent.md", "tags", "x");
    for (let i = 0; i < t.rows.length; i++) {
      expect(ins.rows[i]).toBe(t.rows[i]);
      expect(del.rows[i]).toBe(t.rows[i]);
    }
    // The returned table is a fresh object (spread) but rows are untouched refs.
    expect(ins.rows).not.toBe(t.rows);
    expect(ins.schema).toBe(t.schema);
    expect(ins.cols).toBe(t.cols);
  });

  it("MULTI-MATCH: a loose `==` lookup mutates EVERY matching row", () => {
    // Two rows share the lookup value on a non-path field; both are mutated, the
    // distinct third row is preserved by reference.
    const t = table([
      { [PathPropertyName]: "A.md", grp: "G1", tags: json("a") },
      { [PathPropertyName]: "B.md", grp: "G1", tags: json("b") },
      { [PathPropertyName]: "C.md", grp: "G2", tags: json("c") },
    ]);
    const out = insertPropertyMultiValue(t, "grp", "G1", "tags", "z");
    expect(out.rows[0].tags).toBe('["a","z"]');
    expect(out.rows[1].tags).toBe('["b","z"]');
    expect(out.rows[2]).toBe(t.rows[2]); // G2 row untouched ref
  });
});

// ===========================================================================
// (6) PURITY — the input table and its rows are never mutated in place
// ===========================================================================

describe("PURITY: mutators never mutate the input table or its rows", () => {
  it("insert leaves the source row's field byte-identical", () => {
    const t = table([{ [PathPropertyName]: "A.md", tags: json("a") }]);
    const snapshot = JSON.stringify(t);
    insertPropertyMultiValue(t, PathPropertyName, "A.md", "tags", "b");
    expect(JSON.stringify(t)).toBe(snapshot);
  });

  it("delete leaves the source row's field byte-identical", () => {
    const t = table([{ [PathPropertyName]: "A.md", tags: json("a", "b") }]);
    const snapshot = JSON.stringify(t);
    deletePropertyMultiValue(t, PathPropertyName, "A.md", "tags", "a");
    expect(JSON.stringify(t)).toBe(snapshot);
  });

  it("the matched row is a NEW object (spread), not the same reference", () => {
    const t = table([{ [PathPropertyName]: "A.md", tags: json("a") }]);
    const out = insertPropertyMultiValue(t, PathPropertyName, "A.md", "tags", "b");
    expect(out.rows[0]).not.toBe(t.rows[0]);
  });
});
