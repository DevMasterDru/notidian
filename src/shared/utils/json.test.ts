import { safelyParseJSON } from "./json";

// ---------------------------------------------------------------------------
// DEPTH (Q1) — adversarial characterization net for src/shared/utils/json.ts
// (Notidian-1s2). This 13-line primitive had ZERO direct coverage yet its
// "undefined-on-failure, never-throw" contract is LOAD-BEARING for the whole
// multi-value parse pipeline:
//
//   parsers.ts:8  parseMultiString(str) =
//     ensureString(str).startsWith("[")
//       ? ensureArray(safelyParseJSON(str)).map(...)   // <-- here
//       : parseMultiDisplayString(str)
//
//   strings.ts:2  imports safelyParseJSON; ensureArray(undefined) -> [].
//
// If safelyParseJSON ever THREW instead of returning undefined on malformed
// input, every "[..."-prefixed-but-broken cell (a single stray "[", a
// truncated JSON array mid-write, hand-edited frontmatter) would crash the
// reduce in optionValuesForColumn / parseMultiString rather than degrade to an
// empty list. So this test pins, exhaustively:
//
//   (1) valid JSON  -> the parsed value (objects, arrays, primitives, nesting);
//   (2) malformed / empty / nullish input -> `undefined`, NEVER a throw;
//   (3) the JSON.stringify -> safelyParseJSON round-trip is identity for
//       JSON-clean values.
//
// Pure, offline, no DOM / vault / Superstate.
// ---------------------------------------------------------------------------

describe("safelyParseJSON — valid JSON returns the parsed value", () => {
  test("parses a JSON object", () => {
    expect(safelyParseJSON('{"a":1,"b":"two"}')).toEqual({ a: 1, b: "two" });
  });

  test("parses a JSON array of strings", () => {
    expect(safelyParseJSON('["a","b","c"]')).toEqual(["a", "b", "c"]);
  });

  test("parses an empty array", () => {
    expect(safelyParseJSON("[]")).toEqual([]);
  });

  test("parses an empty object", () => {
    expect(safelyParseJSON("{}")).toEqual({});
  });

  test("parses a nested structure", () => {
    expect(safelyParseJSON('{"list":[1,2,{"x":true}],"n":null}')).toEqual({
      list: [1, 2, { x: true }],
      n: null,
    });
  });

  test.each([
    ["number", "42", 42],
    ["negative number", "-7", -7],
    ["float", "3.14", 3.14],
    ["zero", "0", 0],
    ["true", "true", true],
    ["false", "false", false],
    ["null literal", "null", null],
    ["string literal", '"hello"', "hello"],
    ["empty-string literal", '""', ""],
  ])("parses the JSON primitive %s", (_label, input, expected) => {
    expect(safelyParseJSON(input as string)).toEqual(expected);
  });

  test("tolerates surrounding whitespace (JSON.parse semantics)", () => {
    expect(safelyParseJSON('  \n\t{"a":1}  ')).toEqual({ a: 1 });
  });
});

describe("safelyParseJSON — malformed / empty input returns undefined, never throws", () => {
  test.each([
    ["empty string", ""],
    ["lone open bracket", "["],
    ["lone open brace", "{"],
    ["truncated array (mid-write)", '["a","b'],
    ["trailing comma", '["a",]'],
    ["unquoted key", "{a:1}"],
    ["single quotes", "{'a':1}"],
    ["bare word", "hello"],
    ["JS-style undefined", "undefined"],
    ["NaN", "NaN"],
    ["double object", "{}{}"],
    ["whitespace only", "   "],
    ["unterminated string", '"abc'],
  ])("returns undefined for %s", (_label, input) => {
    let result: unknown;
    expect(() => {
      result = safelyParseJSON(input as string);
    }).not.toThrow();
    expect(result).toBeUndefined();
  });

  test("undefined input returns undefined and never throws", () => {
    // JSON.parse(undefined) coerces undefined -> the string "undefined" which
    // is not valid JSON -> throws -> caught -> undefined.
    let result: unknown;
    expect(() => {
      result = safelyParseJSON(undefined as unknown as string);
    }).not.toThrow();
    expect(result).toBeUndefined();
  });
});

describe("safelyParseJSON — ADVERSARIAL: non-string args are stringified by JSON.parse first, so some 'parse' instead of failing", () => {
  // safelyParseJSON's parameter is typed `string`, but at the boundary callers
  // sometimes pass through whatever they have. JSON.parse coerces its argument
  // to a string BEFORE parsing, so the failure surface is subtler than
  // "non-string -> undefined". Pin the actual coercion behavior so a refactor
  // (e.g. adding `typeof json !== 'string'` early-return) is a deliberate,
  // visible change rather than a silent contract shift.
  test("null is coerced to the string 'null' and parses to null (NOT undefined)", () => {
    expect(safelyParseJSON(null as unknown as string)).toBeNull();
  });

  test.each([
    ["number 5 -> 5", 5, 5],
    ["true -> true", true, true],
    ["false -> false", false, false],
  ])("%s (coerced to its String() form, which is valid JSON)", (_l, input, expected) => {
    expect(safelyParseJSON(input as unknown as string)).toEqual(expected);
  });

  test.each([
    ["plain object ('[object Object]' is not JSON)", {}],
    ["array ('' is not JSON)", []],
  ])("%s -> undefined", (_label, input) => {
    let result: unknown;
    expect(() => {
      result = safelyParseJSON(input as unknown as string);
    }).not.toThrow();
    expect(result).toBeUndefined();
  });
});

describe("safelyParseJSON — round-trips JSON.stringify output (identity for JSON-clean values)", () => {
  test.each([
    ["object", { a: 1, b: "two", c: [3, 4] }],
    ["array of strings", ["x", "y", "z"]],
    ["empty array", []],
    ["empty object", {}],
    ["nested", { list: [1, 2, { x: true }], n: null }],
    ["number", 42],
    ["boolean", true],
    ["null", null],
    ["string", "hello, world"],
    ["string with brackets", "[not actually json]"],
    ["string with quotes", 'he said "hi"'],
  ])("stringify -> safelyParseJSON is identity for %s", (_label, value) => {
    expect(safelyParseJSON(JSON.stringify(value))).toEqual(value);
  });

  test("ADVERSARIAL: JSON.stringify(undefined) is the string 'undefined', which fails to parse -> undefined", () => {
    // JSON.stringify(undefined) === undefined (the value), and passing the
    // *string* "undefined" through is a parse failure. This documents why a
    // would-be round-trip of `undefined` collapses to undefined either way.
    expect(JSON.stringify(undefined)).toBeUndefined();
    expect(safelyParseJSON("undefined")).toBeUndefined();
  });
});
