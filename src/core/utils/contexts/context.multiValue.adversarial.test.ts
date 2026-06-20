// ---------------------------------------------------------------------------
// Notidian-lujd — ADVERSARIAL + property lock for the two PURE, authority-critical
// multi-value MDB mutators exported by context.ts (ADR 0001/0014/0017 — the
// context MDB is the persisted store these write into):
//
//   insertPropertyMultiValue(folder, lookupField, lookupValue, field, value)
//   deletePropertyMultiValue(folder, lookupField, lookupValue, field, value)
//
// Both are reached from updateContextValue's default updateFunction path on real
// property edits, so a serialization slip or a mis-matched row SILENTLY CORRUPTS
// the persisted multi-value. context.ts ('handles db ops', 639 LOC) had ZERO
// co-located coverage of the helper *seam* until contextMultiValue.test.ts
// (Notidian-x9uf) pinned the characterization. This sibling — named to sit beside
// executable.adversarial.test.ts — adds the HARD-EDGE net that file leaves open:
//
//   - DEEP-FROZEN-input immutability (any in-place write THROWS, not just a diff).
//   - A general insert->delete ROUND-TRIP contract (modulo the parser's
//     first-seen/order, JSON-convergent write form).
//   - Multi-comma + escaped-comma ADR 0030 survival, both stored forms.
//   - Loose `==` lookup hazards: numeric-vs-string lookupValue coercion, an
//     undefined lookup field, and empty/absent rows — NONE may throw.
//   - A property loop over random value sets: round-trip + non-matched-row
//     byte-identity hold for arbitrary inputs.
//
// THE CONTRACT (pinned from src, do not assume):
//   parseMultiString(str): str.startsWith('[')  -> JSON.parse via ensureArray
//                          else parseMultiDisplayString: regex (\\.|[^,])+ , per
//                          element trim() then un-escape /\\,/g -> ','  (ADR 0030).
//   serializeMultiString(arr): ALWAYS JSON.stringify(arr).
//   lookup match: f[lookupField] == lookupValue  (LOOSE ==).
//   insert: serializeMultiString([...parseMultiString(old), value])  (NO dedup).
//   delete: serializeMultiString(parseMultiString(old).filter(g => g != value)).
//
// Pure / offline: plain-object SpaceTable fixtures built DIRECTLY — no
// SpaceManager, Superstate, vault, Obsidian, or mocks. testEnvironment: node.
// ---------------------------------------------------------------------------
import { PathPropertyName } from "shared/types/context";
import { DBRow, SpaceTable } from "shared/types/mdb";
import { parseMultiString } from "utils/parsers";
import { serializeMultiString } from "utils/serializers";
import {
  deletePropertyMultiValue,
  insertPropertyMultiValue,
} from "./context";

// --- builders ---------------------------------------------------------------

const SCHEMA = { id: "files", name: "Files", type: "db" };

/** A SpaceTable around a row list. cols/schema are inert for these row-mapping
 *  mutators but we carry a realistic shape so the fixture is faithful. */
const table = (rows: DBRow[]): SpaceTable => ({
  schema: SCHEMA,
  cols: [
    { name: PathPropertyName, type: "file" },
    { name: "tags", type: "option-multi" },
  ],
  rows,
});

/** The JSON multi form exactly as serializeMultiString writes it. */
const json = (...entries: string[]) => serializeMultiString(entries);

/** Recursively Object.freeze a value so ANY attempted in-place mutation throws
 *  under ts-jest's strict-mode modules. This turns "purity" from a post-hoc diff
 *  into a hard runtime guarantee: if a helper ever writes into the input folder
 *  or a row, the test throws at the write site. */
const deepFreeze = <T>(obj: T): T => {
  if (obj && typeof obj === "object" && !Object.isFrozen(obj)) {
    Object.values(obj as Record<string, unknown>).forEach(deepFreeze);
    Object.freeze(obj);
  }
  return obj;
};

// ===========================================================================
// (1) IMMUTABILITY — deep-frozen input: helpers never write in place
// ===========================================================================

describe("(1) immutability: the input folder/rows are never mutated in place", () => {
  it("insert into a DEEP-FROZEN folder does not throw and returns a fresh table", () => {
    const t = deepFreeze(
      table([
        { [PathPropertyName]: "A.md", tags: json("a") },
        { [PathPropertyName]: "B.md", tags: json("b") },
      ])
    );
    const out = insertPropertyMultiValue(t, PathPropertyName, "A.md", "tags", "x");
    // new top-level table object; rows array is a new array (map())
    expect(out).not.toBe(t);
    expect(out.rows).not.toBe(t.rows);
    // inert carriers are reference-preserved (no needless churn)
    expect(out.schema).toBe(t.schema);
    expect(out.cols).toBe(t.cols);
    // matched row is a NEW object; non-matched row keeps its frozen identity
    expect(out.rows[0]).not.toBe(t.rows[0]);
    expect(out.rows[1]).toBe(t.rows[1]);
    expect(out.rows[0].tags).toBe('["a","x"]');
  });

  it("delete from a DEEP-FROZEN folder does not throw and leaves non-matched rows ===", () => {
    const t = deepFreeze(
      table([
        { [PathPropertyName]: "A.md", tags: json("a", "b") },
        { [PathPropertyName]: "B.md", tags: json("c") },
      ])
    );
    const out = deletePropertyMultiValue(t, PathPropertyName, "A.md", "tags", "a");
    expect(out.rows[0].tags).toBe('["b"]');
    expect(out.rows[1]).toBe(t.rows[1]); // untouched ref
    expect(out.schema).toBe(t.schema);
    expect(out.cols).toBe(t.cols);
  });

  it("a ZERO-MATCH lookup keeps every row's object identity (strict no-op rows)", () => {
    const t = deepFreeze(
      table([
        { [PathPropertyName]: "A.md", tags: json("a") },
        { [PathPropertyName]: "B.md", tags: "c, d" }, // display form, deliberately
      ])
    );
    const ins = insertPropertyMultiValue(t, PathPropertyName, "ABSENT.md", "tags", "x");
    const del = deletePropertyMultiValue(t, PathPropertyName, "ABSENT.md", "tags", "x");
    for (let i = 0; i < t.rows.length; i++) {
      expect(ins.rows[i]).toBe(t.rows[i]);
      expect(del.rows[i]).toBe(t.rows[i]);
    }
    // the display-form row is NOT reserialized to JSON on a no-op (raw bytes kept)
    expect(ins.rows[1].tags).toBe("c, d");
  });
});

// ===========================================================================
// (2) ROUND-TRIP — insert(v) then delete(v) returns the original multi-string
//     modulo the parser's first-seen/order + JSON-convergent write form
// ===========================================================================

describe("(2) round-trip: insert(v) then delete(v) restores the pre-insert value set", () => {
  it("insert then delete of the same value yields the JSON-normalized original (JSON store)", () => {
    const t = table([{ [PathPropertyName]: "A.md", tags: json("a", "b") }]);
    const ins = insertPropertyMultiValue(t, PathPropertyName, "A.md", "tags", "c");
    expect(ins.rows[0].tags).toBe('["a","b","c"]');
    const back = deletePropertyMultiValue(ins, PathPropertyName, "A.md", "tags", "c");
    // value set identical to the pre-insert set, in first-seen order
    expect(parseMultiString(back.rows[0].tags)).toEqual(["a", "b"]);
    expect(back.rows[0].tags).toBe('["a","b"]');
  });

  it("display-form store: insert then delete converges to the JSON form of the original set", () => {
    // The input is the human comma form; the write form is always JSON, so the
    // round-trip 'modulo order' returns the JSON normalization of the parsed set.
    const t = table([{ [PathPropertyName]: "A.md", tags: "a, b" }]);
    const ins = insertPropertyMultiValue(t, PathPropertyName, "A.md", "tags", "z");
    const back = deletePropertyMultiValue(ins, PathPropertyName, "A.md", "tags", "z");
    expect(parseMultiString(back.rows[0].tags)).toEqual(["a", "b"]);
    expect(back.rows[0].tags).toBe('["a","b"]');
  });

  it("round-trip preserves first-seen order even for an inserted-in-the-middle delete", () => {
    const t = table([{ [PathPropertyName]: "A.md", tags: json("a", "b", "c") }]);
    const ins = insertPropertyMultiValue(t, PathPropertyName, "A.md", "tags", "m");
    expect(ins.rows[0].tags).toBe('["a","b","c","m"]');
    const back = deletePropertyMultiValue(ins, PathPropertyName, "A.md", "tags", "m");
    expect(parseMultiString(back.rows[0].tags)).toEqual(["a", "b", "c"]);
  });
});

// ===========================================================================
// (3) COMMA-BEARING values survive via the ADR 0030 escape/un-escape contract
// ===========================================================================

describe("(3) comma-bearing values survive (ADR 0030 escape/un-escape)", () => {
  it("MULTI-comma value stored as JSON is one element; insert+delete keeps it whole", () => {
    // ADR 0030 named the first-comma-only bug; Option A made escape/un-escape
    // global. A JSON element with two commas must stay a single element.
    const t = table([{ [PathPropertyName]: "A.md", tags: json("a,b,c") }]);
    const ins = insertPropertyMultiValue(t, PathPropertyName, "A.md", "tags", "d");
    expect(ins.rows[0].tags).toBe('["a,b,c","d"]');
    expect(parseMultiString(ins.rows[0].tags)).toEqual(["a,b,c", "d"]);
    const del = deletePropertyMultiValue(ins, PathPropertyName, "A.md", "tags", "a,b,c");
    expect(del.rows[0].tags).toBe('["d"]');
  });

  it("DISPLAY-form escaped multi-comma element un-escapes to one literal value", () => {
    // 'a\,b\,c, d' is ['a,b,c','d'] per ADR 0030 Option A (global, per-element).
    const t = table([{ [PathPropertyName]: "A.md", tags: "a\\,b\\,c, d" }]);
    expect(parseMultiString(t.rows[0].tags)).toEqual(["a,b,c", "d"]); // contract anchor
    const del = deletePropertyMultiValue(t, PathPropertyName, "A.md", "tags", "a,b,c");
    expect(del.rows[0].tags).toBe('["d"]');
  });

  it("inserting a multi-comma value keeps it as one JSON element (no fracture)", () => {
    const t = table([{ [PathPropertyName]: "A.md", tags: "x" }]);
    const out = insertPropertyMultiValue(t, PathPropertyName, "A.md", "tags", "p,q,r");
    expect(out.rows[0].tags).toBe('["x","p,q,r"]');
    expect(parseMultiString(out.rows[0].tags)).toEqual(["x", "p,q,r"]);
  });

  it("a comma-bearing value round-trips insert->delete through the display store", () => {
    const t = table([{ [PathPropertyName]: "A.md", tags: "keep" }]);
    const ins = insertPropertyMultiValue(t, PathPropertyName, "A.md", "tags", "left,right");
    const back = deletePropertyMultiValue(ins, PathPropertyName, "A.md", "tags", "left,right");
    expect(parseMultiString(back.rows[0].tags)).toEqual(["keep"]);
    expect(back.rows[0].tags).toBe('["keep"]');
  });
});

// ===========================================================================
// (4) DUPLICATE insert / DELETE-of-absent — exact filter/concat semantics
// ===========================================================================

describe("(4) duplicate-insert and delete-of-absent follow concat/filter exactly", () => {
  it("insert does NOT dedup: an already-present value is appended again", () => {
    const t = table([{ [PathPropertyName]: "A.md", tags: json("a", "b") }]);
    const out = insertPropertyMultiValue(t, PathPropertyName, "A.md", "tags", "a");
    expect(out.rows[0].tags).toBe('["a","b","a"]');
  });

  it("delete removes EVERY occurrence (filter g != value), not just the first", () => {
    const t = table([{ [PathPropertyName]: "A.md", tags: json("a", "a", "b", "a") }]);
    const out = deletePropertyMultiValue(t, PathPropertyName, "A.md", "tags", "a");
    expect(out.rows[0].tags).toBe('["b"]');
  });

  it("delete-of-absent value is a pure reserialize: set unchanged, written as JSON", () => {
    const t = table([{ [PathPropertyName]: "A.md", tags: "a, b" }]);
    const out = deletePropertyMultiValue(t, PathPropertyName, "A.md", "tags", "ABSENT");
    expect(out.rows[0].tags).toBe('["a","b"]'); // display set intact, now JSON
  });

  it("double duplicate-insert then a single delete leaves the remaining duplicates", () => {
    // insert 'a' twice -> ['a','b','a','a'] modulo store; delete 'a' removes ALL.
    const t = table([{ [PathPropertyName]: "A.md", tags: json("a", "b") }]);
    const i1 = insertPropertyMultiValue(t, PathPropertyName, "A.md", "tags", "a");
    const i2 = insertPropertyMultiValue(i1, PathPropertyName, "A.md", "tags", "a");
    expect(i2.rows[0].tags).toBe('["a","b","a","a"]');
    const del = deletePropertyMultiValue(i2, PathPropertyName, "A.md", "tags", "a");
    expect(del.rows[0].tags).toBe('["b"]');
  });
});

// ===========================================================================
// (5) LOOSE `==` lookup edge cases — NONE may throw
// ===========================================================================

describe("(5) loose `==` lookup hazards never throw", () => {
  it("numeric row value matches a string lookupValue via `==` coercion (and vice versa)", () => {
    // DBRow is typed Record<string,string>, but degenerate/legacy data can carry a
    // number; loose `==` coerces. Cast through unknown to model the runtime hazard.
    const t = table([
      { [PathPropertyName]: "A.md", rank: 5 as unknown as string, tags: json("a") },
      { [PathPropertyName]: "B.md", rank: 6 as unknown as string, tags: json("b") },
    ]);
    // lookupValue is the STRING "5"; 5 == "5" is true under loose ==.
    const out = insertPropertyMultiValue(t, "rank", "5", "tags", "x");
    expect(out.rows[0].tags).toBe('["a","x"]'); // numeric 5 matched string "5"
    expect(out.rows[1]).toBe(t.rows[1]); // 6 != "5" -> untouched ref
  });

  it("string row value matches a numeric lookupValue via `==` coercion", () => {
    const t = table([{ [PathPropertyName]: "A.md", rank: "7", tags: json("a") }]);
    const out = deletePropertyMultiValue(
      t,
      "rank",
      7 as unknown as string,
      "tags",
      "a"
    );
    expect(out.rows[0].tags).toBe("[]"); // "7" == 7 -> matched, 'a' removed
  });

  it("an UNDEFINED lookup field on rows never throws and matches nothing", () => {
    // f['nope'] is undefined; undefined == 'anything' is false -> strict no-op,
    // and undefined == undefined would match but we never pass undefined as a
    // string lookupValue here. The point: no TypeError dereferencing a missing field.
    const t = table([{ [PathPropertyName]: "A.md", tags: json("a") }]);
    expect(() =>
      insertPropertyMultiValue(t, "nope", "x", "tags", "y")
    ).not.toThrow();
    const out = insertPropertyMultiValue(t, "nope", "x", "tags", "y");
    expect(out.rows[0]).toBe(t.rows[0]); // nothing matched
  });

  it("EMPTY rows array: both helpers return a fresh empty-rows table, no throw", () => {
    const t = table([]);
    expect(() =>
      insertPropertyMultiValue(t, PathPropertyName, "A.md", "tags", "x")
    ).not.toThrow();
    const ins = insertPropertyMultiValue(t, PathPropertyName, "A.md", "tags", "x");
    const del = deletePropertyMultiValue(t, PathPropertyName, "A.md", "tags", "x");
    expect(ins.rows).toEqual([]);
    expect(del.rows).toEqual([]);
    expect(ins.rows).not.toBe(t.rows); // map() always yields a new array
  });

  it("matching a row whose target FIELD is undefined inserts [value] (ensureString('') -> [])", () => {
    const t = table([{ [PathPropertyName]: "A.md" } as DBRow]);
    const out = insertPropertyMultiValue(t, PathPropertyName, "A.md", "tags", "x");
    expect(out.rows[0].tags).toBe('["x"]');
    // delete from an undefined field -> []
    const del = deletePropertyMultiValue(t, PathPropertyName, "A.md", "tags", "x");
    expect(del.rows[0].tags).toBe("[]");
  });
});

// ===========================================================================
// (6) PROPERTY LOOP — round-trip + non-matched-row identity over random sets
// ===========================================================================

describe("(6) property: random value sets satisfy round-trip + row-scoping", () => {
  // A small deterministic PRNG (mulberry32) so failures are reproducible.
  const rng = (seed: number) => () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let x = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };

  // Comma-free tokens keep the display<->JSON convergence simple while still
  // exercising arbitrary arity/order; a dedicated alphabet avoids regex-meta noise.
  const ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789-_ ".split("");
  const randToken = (r: () => number) => {
    const len = 1 + Math.floor(r() * 8);
    let s = "";
    for (let i = 0; i < len; i++) s += ALPHABET[Math.floor(r() * ALPHABET.length)];
    return s.trim() || "x"; // never empty (empty parses away — separate cased above)
  };

  it("insert(v) then delete(v) restores the JSON-normalized original set, other rows ===", () => {
    const r = rng(0x1234abcd);
    for (let iter = 0; iter < 200; iter++) {
      const n = Math.floor(r() * 5); // 0..4 existing values
      const existing: string[] = [];
      for (let i = 0; i < n; i++) existing.push(randToken(r));
      const v = randToken(r);

      // two extra rows that must NEVER be touched (distinct path lookups)
      const other1: DBRow = { [PathPropertyName]: "OTHER1.md", tags: json("p", "q") };
      const other2: DBRow = { [PathPropertyName]: "OTHER2.md", tags: "m, n" };
      const target: DBRow = { [PathPropertyName]: "T.md", tags: json(...existing) };
      const t = deepFreeze(table([other1, target, other2]));

      const ins = insertPropertyMultiValue(t, PathPropertyName, "T.md", "tags", v);
      const back = deletePropertyMultiValue(ins, PathPropertyName, "T.md", "tags", v);

      // ROUND-TRIP: the value set after insert+delete equals the original set with
      // EVERY occurrence of v removed (delete filters all). If v wasn't already in
      // the set, that's exactly the original set; the write form is always JSON.
      const expectedSet = existing.filter((g) => g != v);
      expect(parseMultiString(back.rows[1].tags)).toEqual(expectedSet);

      // ROW-SCOPING: the two sibling rows are byte-identical references throughout.
      expect(ins.rows[0]).toBe(t.rows[0]);
      expect(ins.rows[2]).toBe(t.rows[2]);
      expect(back.rows[0].tags).toBe(json("p", "q"));
      expect(back.rows[2].tags).toBe("m, n"); // untouched display bytes
    }
  });

  it("delete is idempotent at the set level: deleting v twice == deleting once", () => {
    const r = rng(0x0badf00d);
    for (let iter = 0; iter < 100; iter++) {
      const n = Math.floor(r() * 6);
      const existing: string[] = [];
      for (let i = 0; i < n; i++) existing.push(randToken(r));
      const v = existing.length ? existing[Math.floor(r() * existing.length)] : randToken(r);
      const t = table([{ [PathPropertyName]: "A.md", tags: json(...existing) }]);

      const once = deletePropertyMultiValue(t, PathPropertyName, "A.md", "tags", v);
      const twice = deletePropertyMultiValue(once, PathPropertyName, "A.md", "tags", v);
      expect(twice.rows[0].tags).toBe(once.rows[0].tags);
      expect(parseMultiString(once.rows[0].tags)).toEqual(existing.filter((g) => g != v));
    }
  });
});
