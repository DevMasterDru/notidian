import {
  convertFileProp,
  parseFieldValue,
  parseFlexValue,
} from "./parseFieldValue";

// ---------------------------------------------------------------------------
// CHARACTERIZATION (Q1) — pinning net for src/core/schemas/parseFieldValue.ts
// (Notidian-k9g). This module had NO test yet drives two load-bearing paths:
//
//   1. field-config parsing (parseFieldValue): how a SpaceProperty's serialized
//      `value` string is decoded into a config Record per its field type. It
//      feeds fieldTypeForField / stickerForField (schemas/mdb.ts), the fileprop
//      formula resolution (core/utils/contexts/linkContextRow.ts — see bd
//      memory `linkcontextrow-fileprop-value-shape`), and column-config UI.
//
//   2. the FLEX authority branch (parseFlexValue): decodes a flex cell's stored
//      {value,type,config} triple used by parseMDBStringValue's flex case.
//
// Everything here is pure / offline — no vault, no DOM, no I/O sinks, so no
// sanitize routing is required (ADR 0017 applies only to vault-content HTML
// sinks; this is a value-parser).
//
// IMPORTANT — this is a CHARACTERIZATION net, not a correction. Confirmed
// quirks are LOCKED as present behaviour so any future change is a deliberate,
// reviewed contract change. Notable locked quirks:
//   - safelyParseJSON returns the PARSED value, so JSON-falsy literals ("null",
//     "false", "0", '""') are DEFINED-but-falsy and therefore take the
//     `if (valueProp)` FALSE path (the "could not parse" branch), exactly like
//     genuinely malformed JSON. Only JSON-truthy values take the config branch.
//   - convertFileProp ignores `field` entirely and switches only on `value`.
//   - the fileprop non-JSON branch splits on the FIRST "." into [field, val] and
//     a dot-less string (e.g. "ctime") yields val === undefined.
// ---------------------------------------------------------------------------

describe("convertFileProp", () => {
  it("maps value=='ctime' to the parseDate ctime metadata expression (date type)", () => {
    expect(convertFileProp({ field: "File", value: "ctime" })).toEqual({
      value: `parseDate(prop('File')['metadata']['ctime'])`,
      type: "date",
    });
  });

  it("switches ONLY on value — `field` is ignored for the ctime branch", () => {
    // Any field name still yields the same ctime expression (the expr hardcodes
    // prop('File')); field is structurally accepted but unused.
    expect(convertFileProp({ field: "Anything", value: "ctime" }).type).toBe(
      "date"
    );
    expect(convertFileProp({ field: "", value: "ctime" }).value).toBe(
      `parseDate(prop('File')['metadata']['ctime'])`
    );
  });

  it("returns the empty string/string-type fallback for any non-ctime value", () => {
    expect(convertFileProp({ field: "File", value: "mtime" })).toEqual({
      value: "",
      type: "string",
    });
    expect(convertFileProp({ field: "File", value: "" })).toEqual({
      value: "",
      type: "string",
    });
    expect(
      convertFileProp({ field: "File", value: undefined as unknown as string })
    ).toEqual({ value: "", type: "string" });
  });
});

describe("parseFlexValue", () => {
  it("decodes a valid JSON object into the {value,type,config} triple", () => {
    const config = { format: "yyyy" };
    const json = JSON.stringify({ value: "v", type: "date", config });
    expect(parseFlexValue(json)).toEqual({
      value: "v",
      type: "date",
      config,
    });
  });

  it("ignores extra keys, picking only value/type/config", () => {
    const json = JSON.stringify({
      value: 1,
      type: "number",
      config: { a: 1 },
      extra: "ignored",
      another: true,
    });
    expect(parseFlexValue(json)).toEqual({
      value: 1,
      type: "number",
      config: { a: 1 },
    });
  });

  it("preserves falsy-but-present members (false/0/null/empty string)", () => {
    const json = JSON.stringify({ value: false, type: 0, config: null });
    expect(parseFlexValue(json)).toEqual({
      value: false,
      type: 0,
      config: null,
    });
  });

  it("returns an all-undefined triple for malformed JSON (safelyParseJSON fallback)", () => {
    expect(parseFlexValue("not json")).toEqual({
      value: undefined,
      type: undefined,
      config: undefined,
    });
  });

  it("returns an all-undefined triple for empty / nullish input", () => {
    expect(parseFlexValue("")).toEqual({
      value: undefined,
      type: undefined,
      config: undefined,
    });
    expect(parseFlexValue(undefined as unknown as string)).toEqual({
      value: undefined,
      type: undefined,
      config: undefined,
    });
  });

  it("returns an all-undefined triple when valid JSON is not an object (no .value/.type/.config)", () => {
    // JSON.parse("5") === 5; reading .value/.type/.config off a number yields
    // undefined for each (optional chaining short-circuits only on null/undef).
    expect(parseFlexValue("5")).toEqual({
      value: undefined,
      type: undefined,
      config: undefined,
    });
    // JSON null -> optional chaining short-circuits to undefined for all three.
    expect(parseFlexValue("null")).toEqual({
      value: undefined,
      type: undefined,
      config: undefined,
    });
  });
});

describe("parseFieldValue — JSON-parse SUCCESS branch (truthy parsed value)", () => {
  it("fileprop + truthy .field routes through convertFileProp", () => {
    const json = JSON.stringify({ field: "File", value: "ctime" });
    expect(parseFieldValue(json, "fileprop")).toEqual({
      value: `parseDate(prop('File')['metadata']['ctime'])`,
      type: "date",
    });
  });

  it("fileprop + non-ctime value still routes through convertFileProp (string fallback)", () => {
    const json = JSON.stringify({ field: "File", value: "size" });
    expect(parseFieldValue(json, "fileprop")).toEqual({
      value: "",
      type: "string",
    });
  });

  it("fileprop WITHOUT .field falls through to the configKeys reduce (does NOT call convertFileProp)", () => {
    // No `field` key => the inner `if (valueProp.field)` is false, so control
    // falls to the generic reduce over fileprop's configKeys
    // (['field','value','type','format'] + alias/default/required).
    const json = JSON.stringify({ value: "ctime", format: "X" });
    expect(parseFieldValue(json, "fileprop")).toEqual({
      field: undefined,
      value: "ctime",
      type: undefined,
      format: "X",
      alias: undefined,
      default: undefined,
      required: undefined,
    });
  });

  it("reduces over configKeys + alias/default/required for a known type, picking present keys", () => {
    // 'date' fieldType has configKeys ['format'].
    const json = JSON.stringify({
      format: "yyyy-MM-dd",
      alias: "Created",
      default: "today",
      required: true,
      strayKey: "dropped",
    });
    expect(parseFieldValue(json, "date")).toEqual({
      format: "yyyy-MM-dd",
      alias: "Created",
      default: "today",
      required: true,
    });
  });

  it("sets missing config keys to undefined (reduce always writes every key)", () => {
    // 'option' fieldType configKeys ['options','source','sourceProps','colorScheme'].
    const json = JSON.stringify({ options: "[]" });
    expect(parseFieldValue(json, "option")).toEqual({
      options: "[]",
      source: undefined,
      sourceProps: undefined,
      colorScheme: undefined,
      alias: undefined,
      default: undefined,
      required: undefined,
    });
  });

  it("uses only alias/default/required when the type has no configKeys", () => {
    // 'text' fieldType has no configKeys, so the spread `?? []` yields just the
    // three trailing keys.
    const json = JSON.stringify({ alias: "A", required: false, junk: 1 });
    expect(parseFieldValue(json, "text")).toEqual({
      alias: "A",
      default: undefined,
      required: false,
    });
  });

  it("uses only alias/default/required when the type is UNKNOWN (fieldTypeForType -> undefined)", () => {
    const json = JSON.stringify({ alias: "A", default: "D", required: true });
    expect(parseFieldValue(json, "no-such-type-xyz")).toEqual({
      alias: "A",
      default: "D",
      required: true,
    });
  });
});

describe("parseFieldValue — JSON-falsy literals take the NON-JSON path", () => {
  // safelyParseJSON succeeds but returns a falsy value, so `if (valueProp)` is
  // false and control falls into the !valueProp branch keyed off `type`.
  const falsyJson: Array<[string, string]> = [
    ["null", "null"],
    ["false", "false"],
    ["zero", "0"],
    ["empty-string-literal", '""'],
  ];

  it.each(falsyJson)(
    "%s with empty type -> {} (early `if (!type) return {}`)",
    (_label, value) => {
      expect(parseFieldValue(value, "")).toEqual({});
    }
  );

  it.each(falsyJson)(
    "%s with type 'context' -> {} (context branch)",
    (_label, value) => {
      expect(parseFieldValue(value, "context")).toEqual({});
    }
  );
});

describe("parseFieldValue — JSON-parse FAILURE branch (malformed / non-JSON value)", () => {
  it("empty type returns {} regardless of value (early return)", () => {
    expect(parseFieldValue("anything", "")).toEqual({});
    expect(parseFieldValue("yyyy", undefined as unknown as string)).toEqual({});
  });

  it("type 'context' returns {}", () => {
    expect(parseFieldValue("some.field", "context")).toEqual({});
  });

  it("date* with a non-empty value -> {format: value}", () => {
    expect(parseFieldValue("yyyy-MM-dd", "date")).toEqual({
      format: "yyyy-MM-dd",
    });
    // type.startsWith('date') also matches multi/variant date types.
    expect(parseFieldValue("HH:mm", "date-multi")).toEqual({ format: "HH:mm" });
  });

  it("date* with an empty value -> {}", () => {
    expect(parseFieldValue("", "date")).toEqual({});
  });

  it("fileprop* with a value splits on first '.' -> convertFileProp({field, val})", () => {
    // "File.ctime" -> field "File", val "ctime" -> ctime date expression.
    expect(parseFieldValue("File.ctime", "fileprop")).toEqual({
      value: `parseDate(prop('File')['metadata']['ctime'])`,
      type: "date",
    });
  });

  it("fileprop* dot-less value -> val is undefined -> string fallback", () => {
    // "ctime".split(".") === ["ctime"]; val undefined; not the ctime branch
    // (convertFileProp keys off `value`, here undefined).
    expect(parseFieldValue("ctime", "fileprop")).toEqual({
      value: "",
      type: "string",
    });
  });

  it("fileprop* with an empty value -> {}", () => {
    expect(parseFieldValue("", "fileprop")).toEqual({});
  });

  it("option* with a value -> {options:[{name,value}]} via parseMultiString (display split)", () => {
    expect(parseFieldValue("a,b,c", "option")).toEqual({
      options: [
        { name: "a", value: "a" },
        { name: "b", value: "b" },
        { name: "c", value: "c" },
      ],
    });
  });

  it("option* with a single value -> single option entry", () => {
    expect(parseFieldValue("solo", "option-multi")).toEqual({
      options: [{ name: "solo", value: "solo" }],
    });
  });

  it("option* with an empty value -> {}", () => {
    expect(parseFieldValue("", "option")).toEqual({});
  });

  it("a non-empty type with no matching branch returns {} (valueProp stays undefined -> `?? {}`)", () => {
    // 'text' is not context/date*/fileprop*/option*, malformed JSON, non-empty
    // type => none of the !valueProp sub-branches fire; final `valueProp ?? {}`.
    expect(parseFieldValue("plain text not json", "text")).toEqual({});
  });
});
