import {
  detectPropertyType,
  parseMDBStringValue,
  parsePropertyValue,
  propertyIsObjectType,
  yamlTypeToMDBType,
} from "./properties";
import { SpaceProperty } from "shared/types/mdb";

// ---------------------------------------------------------------------------
// DEPTH (Q1) — dedicated characterization + adversarial net for
// src/utils/properties.ts (Notidian-d9j). This module is the PURE
// type-coercion authority that feeds the durable write path: parseParameters
// (api parameter coercion), parsePropertyValue / parseMDBStringValue (the
// MDB-string <-> typed-value converter used by saveFrontmatterValue and
// mergeTableData), detectPropertyType (the schema-inference oracle), and the
// yamlTypeToMDBType / propertyIsObjectType helpers. It previously had NO
// dedicated test despite being load-bearing.
//
// EVERYTHING below was verified against the LIVE functions (ts-jest probe)
// before being pinned. This is a CHARACTERIZATION net, not a correction:
// confirmed quirks are LOCKED so any future change is a deliberate, reviewable
// FLIP rather than a silent regression. DO NOT edit properties.ts to make a
// test pass — latent defects surfaced here get a follow-up bead, not a blind
// fix (per the bead's Q1 scope).
//
// Notable LOCKED quirks (see inline comments for the mechanism):
//   - number coercion is parseFloat → NaN (a number!) on non-numeric input,
//     0 on "0x10" (parseFloat stops at the first non-numeric char);
//   - boolean is the STRICT `value == 'true'` test — "True"/"1"/"yes" → false;
//   - date/datetime/date-end: empty → null, valid → Date, INVALID → the
//     ORIGINAL string (identity fall-through), not null/NaN;
//   - object / object-multi do a RAW JSON.parse that THROWS on malformed input
//     (NOT the safelyParseJSON safe-fallback used elsewhere);
//   - detectPropertyType's string branch is an outer `if (typeof === 'string')`
//     so a string NEVER reaches the array/csv/falsy `else if` branches:
//     a "a,b" CSV string → "text", and "" (empty string) → "text" (NOT
//     "unknown"), while a falsy 0 → "number" (number branch wins over `!value`).
//
// Pure / offline — no vault, no DOM, no I/O.
// ---------------------------------------------------------------------------

// =========================================================================
// parseMDBStringValue — the MDB-string -> typed-value coercion core
// =========================================================================
describe("parseMDBStringValue", () => {
  // --- empty type guard ----------------------------------------------------
  it("returns the value verbatim when type is falsy", () => {
    expect(parseMDBStringValue("", "anything")).toBe("anything");
    expect(parseMDBStringValue(undefined as unknown as string, "x")).toBe("x");
  });

  // --- number (parseFloat) -------------------------------------------------
  describe("number (parseFloat coercion)", () => {
    it("parses a numeric string to a number", () => {
      expect(parseMDBStringValue("number", "12.5")).toBe(12.5);
      expect(parseMDBStringValue("number", "-3")).toBe(-3);
      expect(parseMDBStringValue("number", "1e3")).toBe(1000);
    });
    it("CHARACTERIZE: leading-numeric prefix wins — '0x10' → 0 (parseFloat stops at 'x')", () => {
      expect(parseMDBStringValue("number", "0x10")).toBe(0);
      expect(parseMDBStringValue("number", "5px")).toBe(5);
      expect(parseMDBStringValue("number", " 5 ")).toBe(5); // leading ws tolerated
    });
    it("CHARACTERIZE: non-numeric input yields NaN — a NUMBER, not null/'' (LOCKED)", () => {
      const v = parseMDBStringValue("number", "abc");
      expect(typeof v).toBe("number");
      expect(Number.isNaN(v)).toBe(true);
      const e = parseMDBStringValue("number", "");
      expect(Number.isNaN(e)).toBe(true);
    });
  });

  // --- boolean (strict == 'true') -----------------------------------------
  describe("boolean (strict value == 'true')", () => {
    it("only the exact string 'true' is true; everything else is false", () => {
      expect(parseMDBStringValue("boolean", "true")).toBe(true);
      expect(parseMDBStringValue("boolean", "false")).toBe(false);
      expect(parseMDBStringValue("boolean", "True")).toBe(false); // case-sensitive
      expect(parseMDBStringValue("boolean", "1")).toBe(false);
      expect(parseMDBStringValue("boolean", "yes")).toBe(false);
      expect(parseMDBStringValue("boolean", "")).toBe(false);
    });
  });

  // --- date / datetime / date-end -----------------------------------------
  describe("date / datetime / date-end", () => {
    it("empty / nullish value → null (the short-circuit before new Date())", () => {
      expect(parseMDBStringValue("date", "")).toBeNull();
      expect(parseMDBStringValue("date", undefined as unknown as string)).toBeNull();
      expect(parseMDBStringValue("datetime", "")).toBeNull();
      expect(parseMDBStringValue("date-end", "")).toBeNull();
    });
    it("a valid date string parses to a Date instance", () => {
      const d = parseMDBStringValue("date", "2024-03-05");
      expect(d).toBeInstanceOf(Date);
      // "2024-03-05" is parsed as a UTC instant by the Date constructor.
      expect((d as Date).toISOString()).toBe("2024-03-05T00:00:00.000Z");
    });
    it("a valid datetime string parses to a Date instance (datetime/date-end share the branch)", () => {
      const dt = parseMDBStringValue("datetime", "2024-03-05T10:00:00Z");
      expect(dt).toBeInstanceOf(Date);
      expect((dt as Date).toISOString()).toBe("2024-03-05T10:00:00.000Z");
    });
    it("CHARACTERIZE: an INVALID date string falls through to the ORIGINAL string (not null/NaN)", () => {
      // isNaN(date.getTime()) → return the input string identity.
      expect(parseMDBStringValue("date", "not-a-date")).toBe("not-a-date");
      const orig = "definitely not a date";
      expect(parseMDBStringValue("datetime", orig)).toBe(orig);
    });
  });

  // --- object / object-multi (RAW JSON.parse — THROWS) --------------------
  describe("object / object-multi (raw JSON.parse)", () => {
    it("parses well-formed JSON for object and object-multi", () => {
      expect(parseMDBStringValue("object", '{"a":1}')).toEqual({ a: 1 });
      expect(parseMDBStringValue("object-multi", "[1,2]")).toEqual([1, 2]);
    });
    it("CHARACTERIZE: malformed JSON THROWS (raw JSON.parse, NOT the safe-fallback path) — LOCKED", () => {
      // This is intentionally distinct from parsers.ts/parseObject which uses
      // safelyParseJSON and returns {} / []. Here a malformed value escapes.
      expect(() => parseMDBStringValue("object", "{bad")).toThrow();
      expect(() => parseMDBStringValue("object-multi", "[bad")).toThrow();
      expect(() => parseMDBStringValue("object", "")).toThrow();
    });
  });

  // --- -multi recursion (parseMultiString) --------------------------------
  describe("-multi recursion (via parseMultiString)", () => {
    it("number-multi splits then coerces each element to a number", () => {
      expect(parseMDBStringValue("number-multi", "1, 2, 3")).toEqual([1, 2, 3]);
    });
    it("option-multi splits to a string array (display branch, trimmed)", () => {
      expect(parseMDBStringValue("option-multi", "a, b")).toEqual(["a", "b"]);
    });
    it("CHARACTERIZE: link-multi with frontmatter=true wraps EACH element in [[..]]", () => {
      expect(parseMDBStringValue("link-multi", "A, B", true)).toEqual([
        "[[A]]",
        "[[B]]",
      ]);
    });
    it("CHARACTERIZE: context-multi propagates the frontmatter flag into recursion", () => {
      expect(parseMDBStringValue("context-multi", "A, B", true)).toEqual([
        "[[A]]",
        "[[B]]",
      ]);
    });
    it("link-multi WITHOUT frontmatter leaves elements bare", () => {
      expect(parseMDBStringValue("link-multi", "A, B", false)).toEqual([
        "A",
        "B",
      ]);
    });
  });

  // --- link / context single (frontmatter wrapping) -----------------------
  describe("link / context (single, frontmatter wrapping)", () => {
    it("wraps in [[..]] ONLY when frontmatter=true", () => {
      expect(parseMDBStringValue("link", "Note", true)).toBe("[[Note]]");
      expect(parseMDBStringValue("context", "Note", true)).toBe("[[Note]]");
    });
    it("returns the bare value when frontmatter is false/omitted", () => {
      expect(parseMDBStringValue("link", "Note", false)).toBe("Note");
      expect(parseMDBStringValue("link", "Note")).toBe("Note");
      expect(parseMDBStringValue("context", "Note")).toBe("Note");
    });
    it("CHARACTERIZE: the substring test catches any type CONTAINING 'link'/'context'", () => {
      // type.includes('link') — a hypothetical 'backlink' would also wrap.
      expect(parseMDBStringValue("backlink", "Note", true)).toBe("[[Note]]");
    });
  });

  // --- flex recursion (parseFlexValue) ------------------------------------
  describe("flex (recursion via parseFlexValue)", () => {
    it("unwraps {value,type} and re-dispatches to the inner type", () => {
      const flex = JSON.stringify({ value: "12.5", type: "number" });
      expect(parseMDBStringValue("flex", flex)).toBe(12.5);
    });
    it("propagates the frontmatter flag through the flex unwrap (link → [[..]])", () => {
      const flex = JSON.stringify({ value: "Note", type: "link" });
      expect(parseMDBStringValue("flex", flex, true)).toBe("[[Note]]");
    });
    it("CHARACTERIZE: non-JSON flex input → {value:undefined,type:undefined} → returns undefined", () => {
      // parseFlexValue uses safelyParseJSON, so 'not json' yields undefined
      // value+type; the inner recursion hits the falsy-type guard and returns
      // the (undefined) value.
      expect(parseMDBStringValue("flex", "not json")).toBeUndefined();
    });
    it("a flex wrapping a text type returns the inner value as-is", () => {
      const flex = JSON.stringify({ value: "raw", type: "text" });
      expect(parseMDBStringValue("flex", flex)).toBe("raw");
    });
  });

  // --- unmatched types pass through ---------------------------------------
  it("passes through unmatched plain types verbatim (text/tag/option/image)", () => {
    expect(parseMDBStringValue("text", "hello")).toBe("hello");
    expect(parseMDBStringValue("tag", "v")).toBe("v");
    expect(parseMDBStringValue("option", "v")).toBe("v");
    expect(parseMDBStringValue("image", "https://x/y.png")).toBe(
      "https://x/y.png"
    );
  });
});

// =========================================================================
// detectPropertyType — the schema-inference oracle
// =========================================================================
describe("detectPropertyType", () => {
  // --- Date instance (highest precedence) ---------------------------------
  it("a Date instance → 'date' (checked before any string/typeof branch)", () => {
    expect(detectPropertyType(new Date(), "x")).toBe("date");
  });

  // --- string sub-branches (in declared precedence order) -----------------
  describe("string value sub-branches", () => {
    it("an image URL (jpg/png/gif/svg) or any 'unsplash' substring → 'image'", () => {
      expect(detectPropertyType("https://x/y.png", "x")).toBe("image");
      expect(detectPropertyType("http://a/b.jpeg", "x")).toBe("image");
      expect(detectPropertyType("anything-with-unsplash-in-it", "x")).toBe(
        "image"
      );
    });
    it("a yyyy-mm-dd string → 'date'", () => {
      expect(detectPropertyType("2024-03-05", "x")).toBe("date");
    });
    it("CHARACTERIZE: image check OUTRANKS the date check for an image-looking date", () => {
      // The image regex/unsplash test runs first; ordering is load-bearing.
      expect(detectPropertyType("unsplash-2024-03-05", "x")).toBe("image");
    });
    it("key 'tag' or 'tags' → 'tags-multi' (regardless of string content)", () => {
      expect(detectPropertyType("anything", "tag")).toBe("tags-multi");
      expect(detectPropertyType("anything", "tags")).toBe("tags-multi");
    });
    it("a [[wikilink]] string → 'link'", () => {
      expect(detectPropertyType("[[Note]]", "x")).toBe("link");
      expect(detectPropertyType("see [[Note|Alias]] here", "x")).toBe("link");
    });
    it("CHARACTERIZE: a plain non-matching string → 'text' (final return)", () => {
      expect(detectPropertyType("hello world", "x")).toBe("text");
    });
    it("CHARACTERIZE: an EMPTY string → 'text', NOT 'unknown' (string branch wins, !value never reached)", () => {
      // The outer `if (typeof === 'string')` matched, so the falsy `else if`
      // for "unknown" is never evaluated; control falls to the final 'text'.
      expect(detectPropertyType("", "x")).toBe("text");
    });
    it("CHARACTERIZE: a CSV string → 'text', NOT array — strings never reach the array else-if", () => {
      // The array/CSV branch is an `else if`, unreachable once the string
      // branch matched. A comma-bearing STRING is therefore 'text'.
      expect(detectPropertyType("a,b", "x")).toBe("text");
    });
  });

  // --- number / boolean ----------------------------------------------------
  it("a number → 'number' (incl. 0: number branch outranks the falsy branch)", () => {
    expect(detectPropertyType(42, "x")).toBe("number");
    expect(detectPropertyType(-1.5, "x")).toBe("number");
    expect(detectPropertyType(0, "x")).toBe("number"); // CHARACTERIZE: 0 is number, not unknown
  });
  it("a boolean → 'boolean' (incl. false: boolean branch outranks falsy)", () => {
    expect(detectPropertyType(true, "x")).toBe("boolean");
    expect(detectPropertyType(false, "x")).toBe("boolean");
  });

  // --- falsy → unknown -----------------------------------------------------
  it("falsy non-number/non-boolean values → 'unknown' (null / undefined / NaN)", () => {
    expect(detectPropertyType(null, "x")).toBe("unknown");
    expect(detectPropertyType(undefined, "x")).toBe("unknown");
    expect(detectPropertyType(NaN, "x")).toBe("number"); // NaN is typeof number → 'number'
  });

  // --- array branches ------------------------------------------------------
  describe("array value branches", () => {
    it("an array whose elements are all links → 'link-multi'", () => {
      expect(detectPropertyType(["[[A]]", "[[B]]"], "x")).toBe("link-multi");
    });
    it("an array of plain options → 'option-multi'", () => {
      expect(detectPropertyType(["a", "b"], "x")).toBe("option-multi");
    });
    it("an array containing an object → 'object-multi'", () => {
      expect(detectPropertyType([{ a: 1 }], "x")).toBe("object-multi");
    });
    it("an array under key 'tag'/'tags' → 'tags-multi'", () => {
      expect(detectPropertyType(["a", "b"], "tags")).toBe("tags-multi");
    });
    it("CHARACTERIZE: the YAML nested-single shape [['x']] → 'link'", () => {
      expect(detectPropertyType([["x"]], "k")).toBe("link");
    });
  });

  // --- object / luxon / file shapes ---------------------------------------
  describe("object & special-shape branches", () => {
    it("a plain object → 'object'", () => {
      expect(detectPropertyType({ a: 1 }, "x")).toBe("object");
    });
    it("a Luxon DateTime (isLuxonDateTime) → 'date'", () => {
      expect(detectPropertyType({ isLuxonDateTime: true }, "x")).toBe("date");
    });
    it("a Luxon Duration (isLuxonDuration) → 'duration'", () => {
      expect(detectPropertyType({ isLuxonDuration: true }, "x")).toBe(
        "duration"
      );
    });
    it("a {type:'file'} shape → 'link'", () => {
      expect(detectPropertyType({ type: "file" }, "x")).toBe("link");
    });
  });
});

// =========================================================================
// parsePropertyValue — the lighter coercion sibling (no frontmatter flag)
// =========================================================================
describe("parsePropertyValue", () => {
  it("returns the value verbatim when type is falsy", () => {
    expect(parsePropertyValue("x", "")).toBe("x");
    expect(parsePropertyValue("x", undefined as unknown as string)).toBe("x");
  });
  it("number → parseFloat (NaN on non-numeric, LOCKED)", () => {
    expect(parsePropertyValue("12.5", "number")).toBe(12.5);
    const v = parsePropertyValue("abc", "number");
    expect(typeof v).toBe("number");
    expect(Number.isNaN(v)).toBe(true);
  });
  it("boolean → strict == 'true'", () => {
    expect(parsePropertyValue("true", "boolean")).toBe(true);
    expect(parsePropertyValue("false", "boolean")).toBe(false);
    expect(parsePropertyValue("True", "boolean")).toBe(false);
  });
  it("-multi → split then recurse through parseMDBStringValue (frontmatter=false, so links stay bare)", () => {
    expect(parsePropertyValue("a, b", "option-multi")).toEqual(["a", "b"]);
    // parsePropertyValue always passes frontmatter=false to the inner call,
    // so a link-multi never wraps here (distinct from parseMDBStringValue).
    expect(parsePropertyValue("A, B", "link-multi")).toEqual(["A", "B"]);
    expect(parsePropertyValue("1, 2", "number-multi")).toEqual([1, 2]);
  });
  it("an unmatched plain type passes the value through unchanged", () => {
    expect(parsePropertyValue("hi", "text")).toBe("hi");
    expect(parsePropertyValue("Note", "link")).toBe("Note"); // no wrapping branch here
  });
});

// =========================================================================
// yamlTypeToMDBType — duration/unknown collapse to text
// =========================================================================
describe("yamlTypeToMDBType", () => {
  it("'duration' and 'unknown' collapse to 'text'", () => {
    expect(yamlTypeToMDBType("duration")).toBe("text");
    expect(yamlTypeToMDBType("unknown")).toBe("text");
  });
  it("any other YAML type passes through unchanged", () => {
    expect(yamlTypeToMDBType("number")).toBe("number");
    expect(yamlTypeToMDBType("text")).toBe("text");
    expect(yamlTypeToMDBType("link")).toBe("link");
    expect(yamlTypeToMDBType("some-future-type")).toBe("some-future-type");
  });
});

// =========================================================================
// propertyIsObjectType — object-family predicate
// =========================================================================
describe("propertyIsObjectType", () => {
  const prop = (type: string): SpaceProperty =>
    ({ type } as unknown as SpaceProperty);

  it("true for object / object-multi / super", () => {
    expect(propertyIsObjectType(prop("object"))).toBe(true);
    expect(propertyIsObjectType(prop("object-multi"))).toBe(true);
    expect(propertyIsObjectType(prop("super"))).toBe(true);
  });
  it("false for every other type", () => {
    expect(propertyIsObjectType(prop("text"))).toBe(false);
    expect(propertyIsObjectType(prop("link"))).toBe(false);
    expect(propertyIsObjectType(prop("number"))).toBe(false);
    expect(propertyIsObjectType(prop(""))).toBe(false);
  });
});
