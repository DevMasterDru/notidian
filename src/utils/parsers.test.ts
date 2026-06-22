import {
  parseLinkString,
  parseMultiDisplayString,
  parseMultiString,
  parseObject,
  parseProperty,
  parsePropString,
} from "./parsers";
import {
  serializeMultiDisplayString,
  serializeMultiString,
} from "./serializers";
import { parseMDBStringValue } from "./properties";
import { PathPropertyName } from "shared/types/context";

// ---------------------------------------------------------------------------
// DEPTH (Q1) — property + adversarial characterization net for
// src/utils/parsers.ts (Notidian-e7d). parsers.ts is the multi-string /
// property PARSE core feeding optionValuesForColumn, lookup.ts in/outlinks,
// relations (links.ts), schema fileprop defaults (schemas/mdb.ts) and the
// serializer round-trips. It previously had only a 14-line parseProperty test.
//
// Co-located concerns split so this file does not duplicate
// serializers.test.ts (Notidian-a3s), which already pins the
// serialize<->parse multi-string ROUND-TRIPS and the element-level comma
// escape (now global per ADR 0030). Here we pin, with empirically-verified
// expectations:
//   - the JSON-vs-display BRANCH of parseMultiString, incl. malformed-JSON
//     fall-through and non-string JSON element coercion (ensureString);
//   - the per-element, after-split global `.replace(/\\,/g, ',')` un-escape of
//     parseMultiDisplayString as fixed by ADR 0030 (Option A, Notidian-od7):
//     escaped commas are restored to literal commas WITHIN their element and the
//     element stays atomic (was a whole-string first-occurrence-only un-escape
//     applied BEFORE the split, which fractured escaped values — that defect is
//     now closed and the assertions below are the deliberate FLIP);
//   - the full parseProperty type-coercion switch (every branch);
//   - parsePropString / parseLinkString / parseObject edge behaviour;
//   - parse/serialize inverse cross-checks where an inverse is actually claimed.
//
// Everything here is pure / offline — no vault, no DOM, no I/O.
//
// HISTORY — this was a CHARACTERIZATION net. The escape-quirk assertions
// (whole-string first-escape-only un-escape) pinned a confirmed defect so its
// fix would be a deliberate FLIP. ADR 0030 (Option A, Notidian-od7) has landed
// that fix; those assertions are flipped below to assert the corrected
// per-element global un-escape. The other locked quirks (the indexOfCharElseEOS
// `> 0` edge, boolean/date narrowing) remain pinned as present behaviour so any
// future change stays a deliberate, reviewable FLIP. Each empirical assertion
// was verified against the live functions.
// ---------------------------------------------------------------------------

// =========================================================================
// parseMultiString — JSON-vs-display BRANCH selection
// =========================================================================
describe("parseMultiString (branch selection)", () => {
  it("takes the JSON path ONLY for strings whose first char is '['", () => {
    expect(parseMultiString('["a","b"]')).toEqual(["a", "b"]);
    expect(parseMultiString("[]")).toEqual([]);
  });

  it("a leading space defeats the '[' prefix test → falls to the display parser", () => {
    // startsWith('[') is char-0 exact; ' [\"a\"]' is NOT a JSON branch, so the
    // whole thing is treated as a single display token.
    expect(parseMultiString('  ["a"]')).toEqual(['["a"]']);
  });

  it("a JSON object ('{') is NOT the JSON-array branch → single display token", () => {
    expect(parseMultiString('{"a":1}')).toEqual(['{"a":1}']);
  });

  it("the display branch comma-splits non-bracket strings", () => {
    expect(parseMultiString("a, b")).toEqual(["a", "b"]);
    expect(parseMultiString("solo")).toEqual(["solo"]);
  });

  it("returns [] for the empty string (display branch, empty regex match)", () => {
    expect(parseMultiString("")).toEqual([]);
  });

  // --- malformed-JSON fall-through (the bead's headline safety property) -----
  it("CHARACTERIZE: malformed JSON behind '[' fails SAFELY to [] without throwing", () => {
    // safelyParseJSON returns undefined → ensureArray(undefined) → [].
    expect(() => parseMultiString("[bad")).not.toThrow();
    expect(parseMultiString("[bad")).toEqual([]);
    expect(parseMultiString("[")).toEqual([]);
    expect(parseMultiString("[1, 2")).toEqual([]);
    expect(parseMultiString('["unterminated')).toEqual([]);
  });

  // --- non-string JSON elements are coerced through ensureString ------------
  // ensureString: falsy (incl. null & false) → "", otherwise String(value).
  it("CHARACTERIZE: numeric JSON elements come back stringified", () => {
    expect(parseMultiString("[1,2,3]")).toEqual(["1", "2", "3"]);
  });
  it("CHARACTERIZE: JSON null/false elements collapse to '' (ensureString falsy guard)", () => {
    expect(parseMultiString("[null,1]")).toEqual(["", "1"]);
    expect(parseMultiString("[true,false]")).toEqual(["true", ""]);
    expect(parseMultiString("[0,1]")).toEqual(["", "1"]);
  });
  it("CHARACTERIZE: a nested JSON array element stringifies via Array.toString (comma-joined, no brackets)", () => {
    // [["a"]] → element ["a"] → ensureString(["a"]) → "a".
    expect(parseMultiString('[["a"]]')).toEqual(["a"]);
    // [["a","b"]] → element ["a","b"] → "a,b".
    expect(parseMultiString('[["a","b"]]')).toEqual(["a,b"]);
  });
});

// =========================================================================
// parseMultiDisplayString — direct escape/comma/regex characterization
// =========================================================================
describe("parseMultiDisplayString (direct)", () => {
  it("returns [] for empty / null / undefined (ensureString guard)", () => {
    expect(parseMultiDisplayString("")).toEqual([]);
    expect(parseMultiDisplayString(null as unknown as string)).toEqual([]);
    expect(parseMultiDisplayString(undefined as unknown as string)).toEqual([]);
  });

  it("comma-splits and trims each token", () => {
    expect(parseMultiDisplayString("a, b ,c")).toEqual(["a", "b", "c"]);
    expect(parseMultiDisplayString("  a  ,  b  ")).toEqual(["a", "b"]);
  });

  it("drops empty tokens from consecutive / trailing / leading commas", () => {
    expect(parseMultiDisplayString("a,,b")).toEqual(["a", "b"]);
    expect(parseMultiDisplayString(",a,")).toEqual(["a"]);
    expect(parseMultiDisplayString(",,")).toEqual([]);
  });

  it("FIXED (ADR 0030): an escaped comma '\\,' stays INSIDE its element (no longer fractures)", () => {
    // 'a\,b' — the regex split keeps '\,' inside one match (the (\\.|[^,])+ atom),
    // then the per-element global un-escape restores it to a literal ',' → ["a,b"].
    // Was ["a","b"] pre-fix (whole-string un-escape ran BEFORE the split).
    expect(parseMultiDisplayString("a\\,b")).toEqual(["a,b"]);
  });

  it("a non-comma backslash escape (e.g. '\\n') is preserved verbatim as one token", () => {
    // No '\,' present, so .replace is a no-op; the regex still consumes '\n' as
    // an escape atom, keeping the backslash.
    expect(parseMultiDisplayString("a\\nb")).toEqual(["a\\nb"]);
  });

  // --- FIXED (ADR 0030 Option A, Notidian-od7) ------------------------------
  // The un-escape is now `.replace(/\\,/g, ',')` applied PER ELEMENT, AFTER the
  // regex split. EVERY escaped comma in an element is restored to a literal comma
  // and the element stays atomic — was a whole-string, first-occurrence-only
  // un-escape run BEFORE the split, which fractured later escaped commas.
  it("FIXED: EVERY '\\,' in an element is un-escaped, element stays atomic", () => {
    // 'a\,b\,c' → split keeps it one atom → un-escape both → ["a,b,c"].
    // Was ["a","b\\,c"] pre-fix.
    expect(parseMultiDisplayString("a\\,b\\,c")).toEqual(["a,b,c"]);
  });
  it("FIXED: escaped commas no longer leak across elements (per-element un-escape)", () => {
    // 'x\,y, p\,q' → split on the bare ', ' separator into 'x\,y' | 'p\,q', then
    // un-escape each → ["x,y","p,q"]. Was ["x","y","p\\,q"] pre-fix (whole-string
    // un-escape fractured element one before the split). This is the round-trip
    // image of serializeMultiDisplayString(["x,y","p,q"]) → 'x\,y, p\,q'.
    expect(parseMultiDisplayString("x\\,y, p\\,q")).toEqual(["x,y", "p,q"]);
  });
});

// =========================================================================
// parse/serialize INVERSE cross-checks (only where an inverse is claimed)
// =========================================================================
describe("parse <-> serialize inverse (parsers side)", () => {
  it("serializeMultiString → parseMultiString is the identity for string arrays (comma-SAFE)", () => {
    const rt = (v: string[]) => parseMultiString(serializeMultiString(v));
    expect(rt(["a", "b", "c"])).toEqual(["a", "b", "c"]);
    expect(rt(["a,b", "c"])).toEqual(["a,b", "c"]); // embedded commas survive
    expect(rt([""])).toEqual([""]); // empty element preserved
    expect(rt(["  pad  "])).toEqual(["  pad  "]); // no trim on the JSON path
  });

  it("serializeMultiDisplayString → parseMultiDisplayString is the identity in the trimmed regime, INCLUDING embedded commas (ADR 0030)", () => {
    const rt = (v: string[]) =>
      parseMultiDisplayString(serializeMultiDisplayString(v));
    expect(rt(["a", "b", "c"])).toEqual(["a", "b", "c"]);
    expect(rt(["alpha"])).toEqual(["alpha"]);
    // ADR 0030 (Option A): comma-bearing values now round-trip too — the display
    // form is lossless across the comma regime (was a data-loss hole pre-fix).
    expect(rt(["a,b", "c"])).toEqual(["a,b", "c"]);
    expect(rt(["x,y,z"])).toEqual(["x,y,z"]);
    // The remaining non-identity cases are whitespace-trim/empty-drop, not the
    // comma defect — pinned in serializers.test.ts.
  });
});

// =========================================================================
// parseProperty — full type-coercion switch
// =========================================================================
describe("parseProperty (type coercion)", () => {
  // --- pre-existing regressions (kept) -------------------------------------
  it("preserves falsy frontmatter values for typed properties", () => {
    expect(parseProperty("done", false, "boolean")).toBe("false");
    expect(parseProperty("rating", 0, "number")).toBe("0");
  });
  it("does not coerce arbitrary strings into checked booleans", () => {
    expect(parseProperty("done", "active", "boolean")).toBe("");
    expect(parseProperty("done", "false", "boolean")).toBe("false");
    expect(parseProperty("done", "true", "boolean")).toBe("true");
  });

  // --- the null/undefined short-circuit (before the switch) ----------------
  it("returns '' for null/undefined value regardless of declared type", () => {
    expect(parseProperty("x", null, "text")).toBe("");
    expect(parseProperty("x", undefined, "number")).toBe("");
    expect(parseProperty("x", null, "boolean")).toBe("");
  });

  // --- tags-multi ----------------------------------------------------------
  describe("tags-multi", () => {
    it("serializes an array as a JSON string (serializeMultiString)", () => {
      expect(parseProperty("tags", ["a", "b"], "tags-multi")).toBe('["a","b"]');
      expect(parseProperty("tags", [], "tags-multi")).toBe("[]");
    });
    it("stringifies non-array values element-wise", () => {
      expect(parseProperty("tags", "x", "tags-multi")).toBe("x");
      expect(parseProperty("tags", [1, 2], "tags-multi")).toBe('["1","2"]');
    });
  });

  // --- number --------------------------------------------------------------
  describe("number", () => {
    it("stringifies numbers, including 0 and negatives", () => {
      expect(parseProperty("n", 42, "number")).toBe("42");
      expect(parseProperty("n", 0, "number")).toBe("0");
      expect(parseProperty("n", -3.5, "number")).toBe("-3.5");
    });
  });

  // --- boolean (narrowing) -------------------------------------------------
  describe("boolean", () => {
    it("maps only true/'true'/false/'false'; everything else → ''", () => {
      expect(parseProperty("b", true, "boolean")).toBe("true");
      expect(parseProperty("b", false, "boolean")).toBe("false");
      expect(parseProperty("b", "true", "boolean")).toBe("true");
      expect(parseProperty("b", "false", "boolean")).toBe("false");
      expect(parseProperty("b", "yes", "boolean")).toBe("");
      expect(parseProperty("b", 1, "boolean")).toBe("");
    });
  });

  // --- date ----------------------------------------------------------------
  describe("date", () => {
    it("formats a Date instance to yyyy-MM-dd", () => {
      // NOTE: parseProperty -> date-fns format() renders in the runner's LOCAL
      // timezone. Construct the Date as LOCAL midnight (new Date(year, monthIndex,
      // day); monthIndex is 0-based, so 2 = March) so the expected calendar day
      // cannot drift across timezones. A UTC instant like
      // new Date("2024-03-05T12:00:00Z") would roll to 2024-03-06 under UTC+12
      // and east (e.g. Pacific/Auckland), making this assertion TZ-fragile.
      expect(parseProperty("d", new Date(2024, 2, 5), "date")).toBe(
        "2024-03-05"
      );
    });
    it("passes a string value through verbatim", () => {
      expect(parseProperty("d", "2024-03-05", "date")).toBe("2024-03-05");
      expect(parseProperty("d", "anything", "date")).toBe("anything");
    });
    it("CHARACTERIZE: a non-Date, non-string value (e.g. number) → ''", () => {
      expect(parseProperty("d", 5, "date")).toBe("");
    });
  });

  // --- object / object-multi ----------------------------------------------
  describe("object / object-multi", () => {
    it("a single object with .path returns the path", () => {
      expect(parseProperty("o", { path: "x/y" }, "object")).toBe("x/y");
    });
    it("a single object WITHOUT .path is JSON-stringified", () => {
      expect(parseProperty("o", { a: 1 }, "object")).toBe('{"a":1}');
    });
    it("an array of objects with .path serializes the path list as JSON", () => {
      expect(
        parseProperty("o", [{ path: "a" }, { path: "b" }], "object-multi")
      ).toBe('["a","b"]');
    });
    it("an array whose first element has NO .path is JSON-stringified whole", () => {
      expect(parseProperty("o", [{ a: 1 }], "object-multi")).toBe('[{"a":1}]');
    });
    // Regression (Notidian-94ay): an emptied relation/object list [] used to read
    // value[0].path (value[0] === undefined) and throw a TypeError on a hot,
    // often-untry/catch'd serialization path. It must fall through to "[]",
    // matching the tags-multi empty case above.
    it("an empty array serializes to '[]' without throwing (object)", () => {
      expect(() => parseProperty("o", [], "object")).not.toThrow();
      expect(parseProperty("o", [], "object")).toBe("[]");
    });
    it("an empty array serializes to '[]' without throwing (object-multi)", () => {
      expect(() => parseProperty("o", [], "object-multi")).not.toThrow();
      expect(parseProperty("o", [], "object-multi")).toBe("[]");
    });
  });

  // --- link / context (single) --------------------------------------------
  describe("link / context (single)", () => {
    it("extracts the target from a wikilink string", () => {
      expect(parseProperty("l", "[[Note|Alias]]", "link")).toBe("Note");
      expect(parseProperty("l", "[[Note]]", "context")).toBe("Note");
    });
    it("unwraps the YAML nested-single-array shape [['x']] → 'x'", () => {
      expect(parseProperty("l", [["x"]], "link")).toBe("x");
    });
    it("returns .path for an object value", () => {
      expect(parseProperty("l", { path: "p/q" }, "link")).toBe("p/q");
    });
  });

  // --- link-multi / option-multi / context-multi --------------------------
  describe("option-multi / link-multi / context-multi", () => {
    it("a string value goes through parseLinkString (single link extraction)", () => {
      expect(parseProperty("l", "[[N|x]]", "link-multi")).toBe("N");
    });
    it("an array maps each entry (links, .path objects) into a JSON string list", () => {
      expect(
        parseProperty("l", ["[[A|x]]", { path: "b" }], "link-multi")
      ).toBe('["A","b"]');
    });
    it("falsy entries in the array collapse to '' before serialization", () => {
      expect(parseProperty("l", ["[[A]]", null], "link-multi")).toBe('["A",""]');
    });
  });

  // --- duration ------------------------------------------------------------
  describe("duration", () => {
    it("emits only the non-zero units as a comma-display string", () => {
      expect(
        parseProperty(
          "dur",
          { values: { hours: 2, minutes: 0, days: 1 } },
          "duration"
        )
      ).toBe("2 hours, 1 days");
    });
    it("an all-zero duration serializes to '' (empty display list)", () => {
      expect(
        parseProperty("dur", { values: { hours: 0, minutes: 0 } }, "duration")
      ).toBe("");
    });
  });

  // --- plain string types --------------------------------------------------
  describe("text / tag / option / image / password", () => {
    it("stringify the value directly", () => {
      expect(parseProperty("t", "hello", "text")).toBe("hello");
      expect(parseProperty("t", "v", "tag")).toBe("v");
      expect(parseProperty("t", "v", "option")).toBe("v");
      expect(parseProperty("t", "https://x/y.png", "image")).toBe(
        "https://x/y.png"
      );
      expect(parseProperty("t", "secret", "password")).toBe("secret");
    });
  });

  // --- unknown / unmatched type → '' --------------------------------------
  it("returns '' for an unrecognized declared type", () => {
    expect(parseProperty("x", "value", "some-future-type")).toBe("");
  });

  // --- type inference path (no explicit type) ------------------------------
  describe("inferred type (detectPropertyType fallback)", () => {
    it("infers number from a numeric value", () => {
      expect(parseProperty("n", 7)).toBe("7");
    });
    it("infers boolean from a boolean value", () => {
      expect(parseProperty("b", true)).toBe("true");
    });
    it("infers text and passes a plain string through", () => {
      expect(parseProperty("t", "plain words")).toBe("plain words");
    });
  });
});

// =========================================================================
// parsePropString — 'field.property' lookup parse
// =========================================================================
describe("parsePropString", () => {
  it("splits 'field.property' on the first dot", () => {
    expect(parsePropString("field.prop")).toEqual({
      field: "field",
      property: "prop",
    });
  });
  it("a bare token becomes the property under the File path field", () => {
    expect(parsePropString("justfield")).toEqual({
      field: PathPropertyName,
      property: "justfield",
    });
  });
  it("CHARACTERIZE: a third dotted segment is ignored (only first two atoms used)", () => {
    expect(parsePropString("a.b.c")).toEqual({ field: "a", property: "b" });
  });
  it("treats a backslash-escaped dot as part of the field atom", () => {
    expect(parsePropString("esc\\.aped.prop")).toEqual({
      field: "esc\\.aped",
      property: "prop",
    });
  });
  it("CHARACTERIZE: empty / null input → File field, undefined property", () => {
    expect(parsePropString("")).toEqual({
      field: PathPropertyName,
      property: undefined,
    });
    expect(parsePropString(null as unknown as string)).toEqual({
      field: PathPropertyName,
      property: undefined,
    });
  });
});

// =========================================================================
// parseLinkString — wikilink target extraction
// =========================================================================
describe("parseLinkString", () => {
  it("returns '' for empty / null input", () => {
    expect(parseLinkString("")).toBe("");
    expect(parseLinkString(null as unknown as string)).toBe("");
  });
  it("returns a plain (non-wikilink) string unchanged", () => {
    expect(parseLinkString("plain")).toBe("plain");
  });
  it("extracts the target from [[Note]]", () => {
    expect(parseLinkString("[[Note]]")).toBe("Note");
  });
  it("strips the alias after the first pipe: [[Note|Alias]] → 'Note'", () => {
    expect(parseLinkString("[[Note|Alias]]")).toBe("Note");
  });
  it("keeps only up to the FIRST pipe when several are present", () => {
    expect(parseLinkString("[[a|b|c]]")).toBe("a");
  });
  it("an empty alias still yields the target: [[Note|]] → 'Note'", () => {
    expect(parseLinkString("[[Note|]]")).toBe("Note");
  });
  it("CHARACTERIZE: indexOfCharElseEOS '> 0' edge — a leading pipe is NOT a cut point", () => {
    // indexOf('|') === 0, and indexOfCharElseEOS only cuts when index > 0, so
    // it falls back to end-of-string and the pipe is retained.
    expect(parseLinkString("[[|leadingpipe]]")).toBe("|leadingpipe");
  });

  it("round-trips a bare link target through serializeMultiString of [[..]]", () => {
    // links.ts relies on parseLinkString(serializedEntry) == storedTarget.
    const stored = ["Note A", "Note B"];
    const serialized = serializeMultiString(stored.map((s) => `[[${s}]]`));
    const parsed = parseMultiString(serialized).map((f) => parseLinkString(f));
    expect(parsed).toEqual(["Note A", "Note B"]);
  });
});

// =========================================================================
// parseObject — JSON object/array parse with safe fallback
// =========================================================================
describe("parseObject", () => {
  it("single mode: parses an object, defaults to {} on malformed input", () => {
    expect(parseObject('{"a":1}', false)).toEqual({ a: 1 });
    expect(parseObject("not json", false)).toEqual({});
  });
  it("multi mode: parses an array, defaults to [] on malformed input", () => {
    expect(parseObject("[1,2]", true)).toEqual([1, 2]);
    expect(parseObject("not json", true)).toEqual([]);
  });
  it("CHARACTERIZE: multi mode wraps a bare JSON string in an array (ensureArray)", () => {
    expect(parseObject('"str"', true)).toEqual(["str"]);
  });
  it("CHARACTERIZE: multi mode of a JSON object yields [] (ensureArray of non-array, non-string)", () => {
    expect(parseObject('{"a":1}', true)).toEqual([]);
  });
});

// =========================================================================
// Paste round-trip fidelity (bd Notidian-2kf7) — copying a cell and pasting
// it back into the same column type must be IDEMPOTENT. Regression for the
// option-multi "inserts a space that wasn't there" symptom: an option-multi
// stored as a bare comma scalar must normalize to the JSON multi form on read
// so the value the user copies survives the parseMDBStringValue write path.
// =========================================================================
describe("parseProperty option-multi paste round-trip (no inserted space)", () => {
  it("normalizes a bare comma-string option-multi to the canonical JSON form", () => {
    // The value the COPY path reads (rowData[col]) must already be JSON, not the
    // raw `apple,banana` scalar — that scalar is what got re-split + re-spaced.
    expect(parseProperty("field", "apple,banana", "option-multi")).toBe(
      serializeMultiString(["apple", "banana"])
    );
    // A comma-space scalar trims to the same canonical form (no doubled space).
    expect(parseProperty("field", "apple, banana", "option-multi")).toBe(
      serializeMultiString(["apple", "banana"])
    );
  });

  it("is idempotent across copy -> paste-write -> re-read for option-multi", () => {
    const copyText = parseProperty("field", "apple,banana", "option-multi");
    const written = parseMDBStringValue("option-multi", copyText, true);
    const displayedAfter = parseProperty("field", written, "option-multi");
    expect(displayedAfter).toBe(copyText);
    // And crucially, no space was injected anywhere in the cycle.
    expect(displayedAfter).not.toContain(", ");
  });

  it("leaves an already-JSON option-multi value untouched", () => {
    const json = serializeMultiString(["apple", "banana"]);
    expect(parseProperty("field", json, "option-multi")).toBe(json);
  });

  it("keeps an empty option-multi string empty (no '[]' hallucination)", () => {
    expect(parseProperty("field", "", "option-multi")).toBe("");
  });
});
