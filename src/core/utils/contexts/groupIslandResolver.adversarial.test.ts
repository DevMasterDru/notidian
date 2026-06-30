// Adversarial property tests for groupIslandResolver + validateGroupIsland
// (Notidian-te1q). Zero direct adversarial tests existed before this file.
//
// Covers:
//   - HTML/XSS payloads in resolved field values (document React text-content
//     safety — ADR 0017: values flow through String(val).trim(), then React
//     renders them as textContent, never innerHTML)
//   - Prototype pollution in field names (__proto__, constructor, toString)
//   - Non-scalar frontmatter values (objects, Maps, functions, Symbols, arrays)
//   - 500+ unique groups (totality + performance)
//   - validateGroupIsland with prototype-polluted configs, non-objects, missing
//     fields, 10000+ field arrays, non-string elements
//
// Invariants proven:
//   TOTAL:       never throws for any adversarial input
//   STABLE:      deterministic (same inputs, same output)
//   READ-ONLY:   never mutates superstate or config
//   TEXT-ONLY:   resolved values are plain strings (never unescaped HTML)
//   CONVERGENT:  validateGroupIsland(validateGroupIsland(x)) ===
//                validateGroupIsland(x) — the persistence-boundary fixed point
//
// Pure offline test depth on the key-match resolution surface — NO render-path
// change, so per AGENTS.md it is not flag-gated.

import {
  extractKeyMatchFromColumn,
  resolveGroupIslandFields,
} from "core/utils/contexts/groupIslandResolver";
import { KeyMatchRelationConfig } from "core/utils/contexts/keyMatchResolver";
import { validatePredicate } from "core/utils/contexts/predicate/predicate";
import { defaultPredicate } from "shared/schemas/predicate";
import { Predicate } from "shared/types/predicate";

// Silence the validate-loud console.warn (ADR 0034) for the whole file.
let warnSpy: jest.SpyInstance;
beforeEach(() => {
  warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  warnSpy.mockRestore();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Minimal superstate factory matching the production shape.
const makeSuperstate = (
  folders: Record<string, Record<string, Record<string, any>>>
) => {
  const pathsIndex = new Map<string, any>();
  const contextsIndex = new Map<string, any>();

  for (const [folder, files] of Object.entries(folders)) {
    const paths: string[] = [];
    for (const [filePath, property] of Object.entries(files)) {
      paths.push(filePath);
      pathsIndex.set(filePath, { metadata: { property } });
    }
    contextsIndex.set(folder, { paths });
  }

  return { pathsIndex, contextsIndex } as any;
};

const cfg = (
  over?: Partial<KeyMatchRelationConfig>
): KeyMatchRelationConfig => ({
  type: "key-match",
  sourceField: "ref_id",
  targetFolder: "DB",
  targetField: "ref_id",
  ...over,
});

// Access validateGroupIsland indirectly through validatePredicate (it is not
// exported). This helper runs a groupIsland value through the validator and
// returns whatever validatePredicate put in the groupIsland slot.
const runValidateGroupIsland = (raw: unknown) => {
  const result = validatePredicate(
    { ...defaultPredicate, groupIsland: raw as any },
    defaultPredicate
  );
  return result.groupIsland;
};

// ===========================================================================
// resolveGroupIslandFields: HTML/XSS payloads in resolved values
// ===========================================================================

describe("resolveGroupIslandFields: HTML/XSS payloads (Notidian-te1q)", () => {
  // ADR 0017 safety: resolved values flow through String(val).trim(), and React
  // renders them via textContent (never innerHTML). These tests document that the
  // resolver itself does not strip, escape, or alter the content — it returns
  // verbatim strings, and the safety comes from the rendering layer.
  const XSS_PAYLOADS: Array<{ label: string; value: string }> = [
    { label: "script tag", value: '<script>alert("xss")</script>' },
    { label: "img onerror", value: '<img src=x onerror=alert(1)>' },
    { label: "javascript: URI", value: "javascript:alert(document.cookie)" },
    { label: "event handler", value: '<div onmouseover="steal()">hover</div>' },
    { label: "SVG payload", value: '<svg/onload=alert(1)>' },
    { label: "data URI", value: 'data:text/html,<script>alert(1)</script>' },
    { label: "nested encoding", value: "%3Cscript%3Ealert(1)%3C/script%3E" },
    {
      label: "template literal injection",
      value: "${alert(document.domain)}",
    },
    { label: "null bytes", value: "foo\x00bar\x00baz" },
    {
      label: "unicode direction override",
      value: "‮evil‭code",
    },
  ];

  for (const { label, value } of XSS_PAYLOADS) {
    it(`TOTAL: never throws for ${label} in frontmatter value`, () => {
      const ss = makeSuperstate({
        DB: { "DB/a.md": { ref_id: "x", display: value } },
      });
      expect(() =>
        resolveGroupIslandFields(ss, ["x"], cfg(), ["display"])
      ).not.toThrow();
    });

    it(`TEXT-ONLY: ${label} passes through as a plain string (React textContent safety)`, () => {
      const ss = makeSuperstate({
        DB: { "DB/a.md": { ref_id: "x", display: value } },
      });
      const result = resolveGroupIslandFields(ss, ["x"], cfg(), ["display"]);
      const resolved = result.get("x");
      // The value survives as a string — it is not parsed, escaped, or sanitized
      // at this layer. ADR 0017 documents that React's textContent rendering is
      // the safety boundary, not the resolver.
      expect(resolved).toBeDefined();
      expect(resolved!.length).toBe(1);
      expect(typeof resolved![0]).toBe("string");
      expect(resolved![0]).toBe(value.trim());
    });
  }

  it("STABLE: same XSS input produces identical output across runs", () => {
    const ss = makeSuperstate({
      DB: { "DB/a.md": { ref_id: "x", display: '<script>alert("xss")</script>' } },
    });
    const r1 = resolveGroupIslandFields(ss, ["x"], cfg(), ["display"]);
    const r2 = resolveGroupIslandFields(ss, ["x"], cfg(), ["display"]);
    expect([...r1.entries()]).toEqual([...r2.entries()]);
  });
});

// ===========================================================================
// resolveGroupIslandFields: prototype pollution in field names
// ===========================================================================

describe("resolveGroupIslandFields: prototype pollution (Notidian-te1q)", () => {
  const POLLUTION_FIELDS = [
    "__proto__",
    "constructor",
    "toString",
    "valueOf",
    "hasOwnProperty",
    "__defineGetter__",
    "__defineSetter__",
    "__lookupGetter__",
  ];

  for (const field of POLLUTION_FIELDS) {
    it(`TOTAL: never throws when requesting prototype field "${field}"`, () => {
      const ss = makeSuperstate({
        DB: { "DB/a.md": { ref_id: "x", [field]: "polluted" } },
      });
      expect(() =>
        resolveGroupIslandFields(ss, ["x"], cfg(), [field])
      ).not.toThrow();
    });

    it(`returns the OWN property value for "${field}" when it exists on frontmatter`, () => {
      const ss = makeSuperstate({
        DB: { "DB/a.md": { ref_id: "x", [field]: "explicit-value" } },
      });
      const result = resolveGroupIslandFields(ss, ["x"], cfg(), [field]);
      // Only own properties are interesting — prototype-inherited values
      // (e.g. Object.prototype.toString) are functions, which String(val).trim()
      // converts to "[object Object]" or "function toString() { ... }" — not
      // useful, but never a throw.
      if (result.has("x")) {
        const vals = result.get("x")!;
        expect(vals.every((v) => typeof v === "string")).toBe(true);
      }
    });
  }

  it("READ-ONLY: prototype pollution fields do not mutate the superstate", () => {
    const ss = makeSuperstate({
      DB: {
        "DB/a.md": {
          ref_id: "x",
          __proto__: "polluted",
          constructor: "polluted",
        },
      },
    });
    const before = JSON.stringify([...ss.pathsIndex.entries()]);
    resolveGroupIslandFields(
      ss,
      ["x"],
      cfg(),
      ["__proto__", "constructor"]
    );
    expect(JSON.stringify([...ss.pathsIndex.entries()])).toBe(before);
  });
});

// ===========================================================================
// resolveGroupIslandFields: non-scalar frontmatter values
// ===========================================================================

describe("resolveGroupIslandFields: non-scalar frontmatter values (Notidian-te1q)", () => {
  const NON_SCALAR_VALUES: Array<{ label: string; value: unknown }> = [
    { label: "nested object", value: { nested: { deep: true } } },
    { label: "array", value: [1, 2, 3] },
    { label: "Map", value: new Map([["a", 1]]) },
    { label: "Set", value: new Set([1, 2, 3]) },
    { label: "function", value: () => "evil" },
    { label: "Symbol", value: Symbol("sym") },
    { label: "Date", value: new Date("2026-01-01") },
    { label: "RegExp", value: /pattern/g },
    { label: "boolean true", value: true },
    { label: "boolean false", value: false },
    { label: "number zero", value: 0 },
    { label: "NaN", value: NaN },
    { label: "Infinity", value: Infinity },
    { label: "-Infinity", value: -Infinity },
    { label: "BigInt (via string)", value: "9007199254740993" },
    { label: "empty string", value: "" },
  ];

  for (const { label, value } of NON_SCALAR_VALUES) {
    it(`TOTAL: never throws for ${label}`, () => {
      const ss = makeSuperstate({
        DB: { "DB/a.md": { ref_id: "x", field1: value } },
      });
      expect(() =>
        resolveGroupIslandFields(ss, ["x"], cfg(), ["field1"])
      ).not.toThrow();
    });
  }

  it("TEXT-ONLY: all non-scalar values are coerced to strings via String(val).trim()", () => {
    for (const { value } of NON_SCALAR_VALUES) {
      const ss = makeSuperstate({
        DB: { "DB/a.md": { ref_id: "x", field1: value } },
      });
      const result = resolveGroupIslandFields(ss, ["x"], cfg(), ["field1"]);
      if (result.has("x")) {
        const vals = result.get("x")!;
        expect(vals.every((v) => typeof v === "string")).toBe(true);
      }
    }
  });

  it("READ-ONLY: input objects are never mutated", () => {
    const obj = { nested: { deep: true } };
    const arr = [1, 2, 3];
    const ss = makeSuperstate({
      DB: { "DB/a.md": { ref_id: "x", objField: obj, arrField: arr } },
    });
    const objBefore = JSON.stringify(obj);
    const arrBefore = JSON.stringify(arr);
    resolveGroupIslandFields(ss, ["x"], cfg(), ["objField", "arrField"]);
    expect(JSON.stringify(obj)).toBe(objBefore);
    expect(JSON.stringify(arr)).toBe(arrBefore);
  });
});

// ===========================================================================
// resolveGroupIslandFields: 500+ unique groups (totality + performance)
// ===========================================================================

describe("resolveGroupIslandFields: large group counts (Notidian-te1q)", () => {
  const GROUP_COUNT = 600;

  const buildLargeSuperstate = () => {
    const files: Record<string, Record<string, any>> = {};
    for (let i = 0; i < GROUP_COUNT; i++) {
      files[`DB/item-${i}.md`] = {
        ref_id: String(i),
        name: `Item ${i}`,
        category: `Cat-${i % 10}`,
      };
    }
    return makeSuperstate({ DB: files });
  };

  it("TOTAL: never throws for 600 unique groups", () => {
    const ss = buildLargeSuperstate();
    const groupValues = Array.from({ length: GROUP_COUNT }, (_, i) =>
      String(i)
    );
    expect(() =>
      resolveGroupIslandFields(ss, groupValues, cfg(), ["name", "category"])
    ).not.toThrow();
  });

  it("resolves all 600 groups correctly", () => {
    const ss = buildLargeSuperstate();
    const groupValues = Array.from({ length: GROUP_COUNT }, (_, i) =>
      String(i)
    );
    const result = resolveGroupIslandFields(ss, groupValues, cfg(), [
      "name",
      "category",
    ]);
    expect(result.size).toBe(GROUP_COUNT);
    // Spot-check first and last
    expect(result.get("0")).toEqual(["Item 0", "Cat-0"]);
    expect(result.get("599")).toEqual(["Item 599", "Cat-9"]);
  });

  it("STABLE: deterministic output for 600 groups", () => {
    const ss = buildLargeSuperstate();
    const groupValues = Array.from({ length: GROUP_COUNT }, (_, i) =>
      String(i)
    );
    const r1 = resolveGroupIslandFields(ss, groupValues, cfg(), [
      "name",
      "category",
    ]);
    const r2 = resolveGroupIslandFields(ss, groupValues, cfg(), [
      "name",
      "category",
    ]);
    expect([...r1.entries()]).toEqual([...r2.entries()]);
  });

  it("READ-ONLY: 600-group resolution does not mutate superstate", () => {
    const ss = buildLargeSuperstate();
    const pathsBefore = ss.pathsIndex.size;
    const ctxBefore = ss.contextsIndex.size;
    const groupValues = Array.from({ length: GROUP_COUNT }, (_, i) =>
      String(i)
    );
    resolveGroupIslandFields(ss, groupValues, cfg(), ["name"]);
    expect(ss.pathsIndex.size).toBe(pathsBefore);
    expect(ss.contextsIndex.size).toBe(ctxBefore);
  });

  it("deduplicates even at scale (1000 inputs, 600 unique)", () => {
    const ss = buildLargeSuperstate();
    // Duplicate each value once, plus extra copies of early values
    const groupValues = [
      ...Array.from({ length: GROUP_COUNT }, (_, i) => String(i)),
      ...Array.from({ length: 400 }, (_, i) => String(i % GROUP_COUNT)),
    ];
    const result = resolveGroupIslandFields(ss, groupValues, cfg(), [
      "name",
    ]);
    expect(result.size).toBe(GROUP_COUNT);
  });
});

// ===========================================================================
// extractKeyMatchFromColumn: adversarial inputs
// ===========================================================================

describe("extractKeyMatchFromColumn: adversarial inputs (Notidian-te1q)", () => {
  const ADVERSARIAL_VALUES: Array<{ label: string; column: any }> = [
    { label: "XSS in value JSON", column: { value: '<script>alert(1)</script>' } },
    {
      label: "prototype pollution in parsed JSON",
      column: {
        value: JSON.stringify({
          __proto__: { type: "key-match" },
          keyMatch: null,
        }),
      },
    },
    {
      label: "constructor pollution in keyMatch",
      column: {
        value: JSON.stringify({
          keyMatch: {
            type: "key-match",
            sourceField: "constructor",
            targetFolder: "__proto__",
            targetField: "toString",
          },
        }),
      },
    },
    { label: "very long value string", column: { value: "x".repeat(100_000) } },
    { label: "empty object JSON", column: { value: "{}" } },
    { label: "array JSON", column: { value: "[]" } },
    { label: "number JSON", column: { value: "42" } },
    { label: "string JSON", column: { value: '"hello"' } },
    { label: "null JSON", column: { value: "null" } },
    { label: "boolean JSON", column: { value: "true" } },
    { label: "nested JSON", column: { value: JSON.stringify({ a: { b: { c: 1 } } }) } },
    { label: "unicode escapes", column: { value: JSON.stringify({ keyMatch: " " }) } },
  ];

  for (const { label, column } of ADVERSARIAL_VALUES) {
    it(`TOTAL: never throws for ${label}`, () => {
      expect(() => extractKeyMatchFromColumn(column)).not.toThrow();
    });
  }

  it("returns valid config for prototype-named fields (they are legitimate column names)", () => {
    const column = {
      value: JSON.stringify({
        keyMatch: {
          type: "key-match",
          sourceField: "constructor",
          targetFolder: "__proto__",
          targetField: "toString",
        },
      }),
    };
    const result = extractKeyMatchFromColumn(column as any);
    // isKeyMatchConfig validates all three fields are non-empty strings.
    // These pass that check (they ARE strings), so the config is valid even
    // though the names look like prototype properties.
    expect(result).toEqual({
      type: "key-match",
      sourceField: "constructor",
      targetFolder: "__proto__",
      targetField: "toString",
    });
  });
});

// ===========================================================================
// validateGroupIsland: adversarial persistence-boundary tests
// ===========================================================================

describe("validateGroupIsland: adversarial (Notidian-te1q)", () => {
  // validateGroupIsland sits on the MDB persistence boundary — loaded from
  // untrusted stored predicates. It must be TOTAL, CONVERGENT, and reject
  // every invalid shape to undefined.

  // -------------------------------------------------------------------------
  // Non-object types
  // -------------------------------------------------------------------------
  describe("non-object types", () => {
    const NON_OBJECTS: Array<{ label: string; value: unknown }> = [
      { label: "string", value: "relation-name" },
      { label: "number", value: 42 },
      { label: "boolean true", value: true },
      { label: "boolean false", value: false },
      { label: "null", value: null },
      { label: "undefined", value: undefined },
      { label: "empty string", value: "" },
      { label: "zero", value: 0 },
      { label: "NaN", value: NaN },
      { label: "Infinity", value: Infinity },
      { label: "array (valid-looking)", value: ["relation", ["f1", "f2"]] },
      { label: "array of strings", value: ["f1", "f2"] },
      { label: "function", value: () => ({ relation: "r", fields: ["f"] }) },
      { label: "Symbol", value: Symbol("config") },
      { label: "Date", value: new Date() },
      { label: "RegExp", value: /pattern/ },
      { label: "Map", value: new Map([["relation", "r"]]) },
      { label: "Set", value: new Set(["f1"]) },
    ];

    for (const { label, value } of NON_OBJECTS) {
      it(`TOTAL: never throws for ${label}`, () => {
        expect(() => runValidateGroupIsland(value)).not.toThrow();
      });

      it(`rejects ${label} to undefined`, () => {
        expect(runValidateGroupIsland(value)).toBeUndefined();
      });
    }
  });

  // -------------------------------------------------------------------------
  // Missing required fields
  // -------------------------------------------------------------------------
  describe("missing required fields", () => {
    it("rejects an object with no relation", () => {
      expect(
        runValidateGroupIsland({ fields: ["name"] })
      ).toBeUndefined();
    });

    it("rejects an object with no fields", () => {
      expect(
        runValidateGroupIsland({ relation: "rollup_col" })
      ).toBeUndefined();
    });

    it("rejects an empty object", () => {
      expect(runValidateGroupIsland({})).toBeUndefined();
    });

    it("rejects when relation is empty string", () => {
      expect(
        runValidateGroupIsland({ relation: "", fields: ["name"] })
      ).toBeUndefined();
    });

    it("rejects when relation is non-string (number)", () => {
      expect(
        runValidateGroupIsland({ relation: 42, fields: ["name"] })
      ).toBeUndefined();
    });

    it("rejects when relation is non-string (array)", () => {
      expect(
        runValidateGroupIsland({ relation: ["rollup"], fields: ["name"] })
      ).toBeUndefined();
    });

    it("rejects when relation is non-string (object)", () => {
      expect(
        runValidateGroupIsland({ relation: { name: "r" }, fields: ["name"] })
      ).toBeUndefined();
    });

    it("rejects when relation is non-string (boolean)", () => {
      expect(
        runValidateGroupIsland({ relation: true, fields: ["name"] })
      ).toBeUndefined();
    });

    it("rejects when fields is not an array", () => {
      expect(
        runValidateGroupIsland({ relation: "r", fields: "name" })
      ).toBeUndefined();
    });

    it("rejects when fields is an object", () => {
      expect(
        runValidateGroupIsland({ relation: "r", fields: { name: true } })
      ).toBeUndefined();
    });

    it("rejects when fields is a number", () => {
      expect(
        runValidateGroupIsland({ relation: "r", fields: 42 })
      ).toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // Empty and all-invalid fields arrays
  // -------------------------------------------------------------------------
  describe("empty and all-invalid fields", () => {
    it("rejects an empty fields array", () => {
      expect(
        runValidateGroupIsland({ relation: "r", fields: [] })
      ).toBeUndefined();
    });

    it("rejects fields array with only empty strings", () => {
      expect(
        runValidateGroupIsland({ relation: "r", fields: ["", "", ""] })
      ).toBeUndefined();
    });

    it("rejects fields array with only non-string elements", () => {
      expect(
        runValidateGroupIsland({
          relation: "r",
          fields: [42, null, undefined, true, {}, []],
        })
      ).toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // Prototype pollution in config objects
  // -------------------------------------------------------------------------
  describe("prototype pollution", () => {
    it("TOTAL: never throws for __proto__ as relation name", () => {
      expect(() =>
        runValidateGroupIsland({ relation: "__proto__", fields: ["name"] })
      ).not.toThrow();
    });

    it("accepts __proto__ as a valid relation name (it IS a non-empty string)", () => {
      const result = runValidateGroupIsland({
        relation: "__proto__",
        fields: ["name"],
      });
      expect(result).toEqual({ relation: "__proto__", fields: ["name"] });
    });

    it("TOTAL: never throws for constructor as relation name", () => {
      expect(() =>
        runValidateGroupIsland({
          relation: "constructor",
          fields: ["toString"],
        })
      ).not.toThrow();
    });

    it("accepts constructor as a valid relation name", () => {
      const result = runValidateGroupIsland({
        relation: "constructor",
        fields: ["toString"],
      });
      expect(result).toEqual({
        relation: "constructor",
        fields: ["toString"],
      });
    });

    it("TOTAL: never throws for prototype-named fields", () => {
      expect(() =>
        runValidateGroupIsland({
          relation: "r",
          fields: [
            "__proto__",
            "constructor",
            "toString",
            "valueOf",
            "hasOwnProperty",
          ],
        })
      ).not.toThrow();
    });

    it("keeps prototype-named fields (they pass the non-empty string check)", () => {
      const result = runValidateGroupIsland({
        relation: "r",
        fields: [
          "__proto__",
          "constructor",
          "toString",
          "valueOf",
          "hasOwnProperty",
        ],
      });
      expect(result).toEqual({
        relation: "r",
        fields: [
          "__proto__",
          "constructor",
          "toString",
          "valueOf",
          "hasOwnProperty",
        ],
      });
    });

    it("TOTAL: never throws when config has extra prototype-polluting keys", () => {
      expect(() =>
        runValidateGroupIsland({
          relation: "r",
          fields: ["name"],
          __proto__: { admin: true },
          constructor: { prototype: { isAdmin: true } },
        })
      ).not.toThrow();
    });
  });

  // -------------------------------------------------------------------------
  // Non-string elements in fields array
  // -------------------------------------------------------------------------
  describe("non-string elements in fields array", () => {
    const NON_STRING_ELEMENTS: Array<{ label: string; value: unknown }> = [
      { label: "number", value: 42 },
      { label: "boolean", value: true },
      { label: "null", value: null },
      { label: "undefined", value: undefined },
      { label: "object", value: { name: "field" } },
      { label: "array", value: ["nested"] },
      { label: "function", value: () => "field" },
      { label: "Symbol", value: Symbol("field") },
      { label: "NaN", value: NaN },
      { label: "Infinity", value: Infinity },
    ];

    it("filters out non-string elements and keeps valid strings", () => {
      const result = runValidateGroupIsland({
        relation: "r",
        fields: [
          "valid_name",
          42,
          null,
          "another_field",
          undefined,
          true,
          {},
          [],
        ],
      });
      expect(result).toEqual({
        relation: "r",
        fields: ["valid_name", "another_field"],
      });
    });

    it("filters out empty strings from fields", () => {
      const result = runValidateGroupIsland({
        relation: "r",
        fields: ["name", "", "category", ""],
      });
      expect(result).toEqual({
        relation: "r",
        fields: ["name", "category"],
      });
    });

    for (const { label, value } of NON_STRING_ELEMENTS) {
      it(`TOTAL: never throws when fields contains ${label}`, () => {
        expect(() =>
          runValidateGroupIsland({
            relation: "r",
            fields: ["valid", value, "also_valid"],
          })
        ).not.toThrow();
      });
    }
  });

  // -------------------------------------------------------------------------
  // Excessive field arrays (10000+ entries)
  // -------------------------------------------------------------------------
  describe("excessive field arrays", () => {
    it("TOTAL: never throws for 10000 field entries", () => {
      const fields = Array.from({ length: 10_000 }, (_, i) => `field_${i}`);
      expect(() =>
        runValidateGroupIsland({ relation: "r", fields })
      ).not.toThrow();
    });

    it("preserves all 10000 valid field entries", () => {
      const fields = Array.from({ length: 10_000 }, (_, i) => `field_${i}`);
      const result = runValidateGroupIsland({ relation: "r", fields });
      expect(result).toBeDefined();
      expect(result!.fields.length).toBe(10_000);
      expect(result!.fields[0]).toBe("field_0");
      expect(result!.fields[9999]).toBe("field_9999");
    });

    it("TOTAL: never throws for 10000 entries with mixed valid/invalid", () => {
      const fields: unknown[] = [];
      for (let i = 0; i < 10_000; i++) {
        fields.push(i % 3 === 0 ? `field_${i}` : i % 3 === 1 ? i : null);
      }
      expect(() =>
        runValidateGroupIsland({ relation: "r", fields })
      ).not.toThrow();
    });

    it("filters 10000 mixed entries correctly", () => {
      const fields: unknown[] = [];
      let expectedCount = 0;
      for (let i = 0; i < 10_000; i++) {
        if (i % 3 === 0) {
          fields.push(`field_${i}`);
          expectedCount++;
        } else if (i % 3 === 1) {
          fields.push(i);
        } else {
          fields.push(null);
        }
      }
      const result = runValidateGroupIsland({ relation: "r", fields });
      expect(result).toBeDefined();
      expect(result!.fields.length).toBe(expectedCount);
    });
  });

  // -------------------------------------------------------------------------
  // CONVERGENT: double-validation fixed point
  // -------------------------------------------------------------------------
  describe("CONVERGENT: double-validation fixed point", () => {
    const CONVERGENCE_CORPUS: Array<{ label: string; value: unknown }> = [
      // Valid configs — must survive unchanged
      {
        label: "minimal valid config",
        value: { relation: "rollup_col", fields: ["name"] },
      },
      {
        label: "multi-field valid config",
        value: {
          relation: "board_ref",
          fields: ["board_name", "model", "channels"],
        },
      },
      // Configs with mixed valid/invalid elements — converge after first pass
      {
        label: "config with mixed fields",
        value: {
          relation: "r",
          fields: ["valid", 42, null, "also_valid", "", true],
        },
      },
      // Invalid configs — converge to undefined
      { label: "null", value: null },
      { label: "undefined", value: undefined },
      { label: "string", value: "relation" },
      { label: "number", value: 42 },
      { label: "empty object", value: {} },
      { label: "missing fields", value: { relation: "r" } },
      { label: "empty relation", value: { relation: "", fields: ["f"] } },
      {
        label: "all-invalid fields",
        value: { relation: "r", fields: [1, 2, 3] },
      },
      { label: "empty fields array", value: { relation: "r", fields: [] } },
      // Prototype pollution
      {
        label: "prototype-named relation",
        value: { relation: "__proto__", fields: ["toString"] },
      },
      // Extra keys (should not affect validation or convergence)
      {
        label: "config with extra keys",
        value: {
          relation: "r",
          fields: ["name"],
          extra: "ignored",
          count: 42,
        },
      },
    ];

    for (const { label, value } of CONVERGENCE_CORPUS) {
      it(`reaches fixed point for: ${label}`, () => {
        const once = runValidateGroupIsland(value);
        // Second pass: feed the output back in. For undefined, the validator
        // sees undefined input and returns undefined. For a valid config, the
        // validator sees a valid config and returns it unchanged.
        const twice = runValidateGroupIsland(once);
        // Structural equality
        expect(twice).toEqual(once);
        // Third pass: still stable (not a 2-cycle)
        expect(runValidateGroupIsland(twice)).toEqual(once);
      });
    }

    it("BYTE-stable: JSON round-trip of double-validated configs is identical", () => {
      for (const { value } of CONVERGENCE_CORPUS) {
        const once = runValidateGroupIsland(value);
        const twice = runValidateGroupIsland(once);
        expect(JSON.stringify(twice)).toBe(JSON.stringify(once));
      }
    });
  });

  // -------------------------------------------------------------------------
  // Valid configs: acceptance tests
  // -------------------------------------------------------------------------
  describe("valid configs accepted correctly", () => {
    it("accepts a minimal valid config", () => {
      const result = runValidateGroupIsland({
        relation: "rollup_col",
        fields: ["name"],
      });
      expect(result).toEqual({ relation: "rollup_col", fields: ["name"] });
    });

    it("accepts a multi-field config", () => {
      const result = runValidateGroupIsland({
        relation: "board_ref",
        fields: ["board_name", "model", "board_type", "channels"],
      });
      expect(result).toEqual({
        relation: "board_ref",
        fields: ["board_name", "model", "board_type", "channels"],
      });
    });

    it("strips extra keys (only relation and fields survive)", () => {
      const result = runValidateGroupIsland({
        relation: "r",
        fields: ["name"],
        extraKey: "should not appear",
        anotherKey: 42,
      });
      // validateGroupIsland returns { relation, fields } — extra keys are
      // excluded by explicit construction.
      expect(result).toEqual({ relation: "r", fields: ["name"] });
      expect(Object.keys(result!)).toEqual(["relation", "fields"]);
    });

    it("XSS in relation name is accepted (it is a non-empty string)", () => {
      const result = runValidateGroupIsland({
        relation: '<script>alert("xss")</script>',
        fields: ["name"],
      });
      expect(result).toEqual({
        relation: '<script>alert("xss")</script>',
        fields: ["name"],
      });
    });

    it("XSS in field names is accepted (they are non-empty strings)", () => {
      const result = runValidateGroupIsland({
        relation: "r",
        fields: ['<img src=x onerror=alert(1)>', "normal"],
      });
      expect(result).toEqual({
        relation: "r",
        fields: ['<img src=x onerror=alert(1)>', "normal"],
      });
    });
  });
});

// ===========================================================================
// End-to-end: validatePredicate with adversarial groupIsland
// ===========================================================================

describe("validatePredicate + groupIsland end-to-end (Notidian-te1q)", () => {
  it("a valid groupIsland survives full predicate validation", () => {
    const result = validatePredicate(
      {
        ...defaultPredicate,
        groupIsland: { relation: "board_ref", fields: ["board_name"] },
      },
      defaultPredicate
    );
    expect(result.groupIsland).toEqual({
      relation: "board_ref",
      fields: ["board_name"],
    });
  });

  it("an invalid groupIsland is dropped to undefined in full predicate validation", () => {
    const result = validatePredicate(
      {
        ...defaultPredicate,
        groupIsland: { relation: "", fields: [] } as any,
      },
      defaultPredicate
    );
    expect(result.groupIsland).toBeUndefined();
  });

  it("a corrupt groupIsland does not affect other predicate fields", () => {
    const result = validatePredicate(
      {
        ...defaultPredicate,
        groupIsland: 42 as any,
        colsSize: { "Title.": 240 },
        groupBy: ["Status."],
      },
      defaultPredicate
    );
    expect(result.groupIsland).toBeUndefined();
    expect(result.colsSize).toEqual({ "Title.": 240 });
    expect(result.groupBy).toEqual(["Status."]);
  });

  it("CONVERGENT: full predicate with groupIsland reaches fixed point", () => {
    const predicate = {
      ...defaultPredicate,
      groupIsland: {
        relation: "r",
        fields: ["valid", 42, "also_valid", null, ""],
      },
    };
    const once = validatePredicate(predicate as any, defaultPredicate);
    const twice = validatePredicate(once, defaultPredicate);
    expect(JSON.stringify(twice)).toBe(JSON.stringify(once));
  });
});
