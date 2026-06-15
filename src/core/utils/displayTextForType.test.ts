/**
 * Characterization + property net for displayTextForType.ts.
 *
 * displayTextForType is the pure type -> display-string coercion used to render
 * a property value as text. It is dependency-light (json/parsers/date helpers)
 * and contains no I/O, so we can pin its full behavior offline.
 *
 * These tests are CHARACTERIZATION: they lock in the current (pre-existing)
 * behavior of the switch, including its quirks, so that future refactors are
 * forced to be deliberate. Where behavior is a known sharp edge it is called
 * out in the test name rather than "corrected".
 *
 * No superstate is passed in these tests, so link/file resolution falls back to
 * the filename-extraction path (getLinkDisplayName's superstate-less branch).
 */
import { SpaceProperty } from "shared/types/mdb";
import { displayTextForType } from "./displayTextForType";

/** Build a SpaceProperty of the given type with an optional config object. */
const prop = (type: string, config?: Record<string, unknown>): SpaceProperty => ({
  name: "field",
  type,
  value: config === undefined ? undefined : JSON.stringify(config),
});

describe("displayTextForType — nullish / empty short-circuit", () => {
  // The very first guard: `if (!value || value === '') return ''`.
  // This runs BEFORE the type switch, so EVERY falsy value collapses to "".
  it.each([
    ["null", null],
    ["undefined", undefined],
    ["empty string", ""],
    // 0 is falsy in JS, so even a numeric zero short-circuits to "" here.
    ["number zero", 0],
    // false is falsy, so a boolean false also short-circuits to "".
    ["boolean false", false],
  ])("returns '' for %s regardless of type", (_label, value) => {
    expect(displayTextForType(prop("number"), value as never)).toBe("");
    expect(displayTextForType(prop("boolean"), value as never)).toBe("");
    expect(displayTextForType(prop("text"), value as never)).toBe("");
  });

  it("treats a missing property (undefined) as the default branch", () => {
    // property?.type is undefined -> default branch -> value.toString().
    expect(displayTextForType(undefined as never, "hello")).toBe("hello");
  });
});

describe("displayTextForType — number", () => {
  it("renders a plain number with no format as its toString", () => {
    expect(displayTextForType(prop("number"), "42")).toBe("42");
    expect(displayTextForType(prop("number"), 42)).toBe("42");
  });

  it("trims via parseFloat then re-stringifies (drops trailing garbage)", () => {
    // parseFloat("42.50px") === 42.5 -> (42.5).toString() === "42.5".
    expect(displayTextForType(prop("number"), "42.50px")).toBe("42.5");
  });

  it("falls back to String(value) when value is non-numeric (NaN guard)", () => {
    expect(displayTextForType(prop("number"), "abc")).toBe("abc");
  });

  it("formats currency as USD via Intl.NumberFormat", () => {
    // Locale-independent assertions: amount + currency symbol presence.
    const out = displayTextForType(prop("number", { format: "currency" }), "1000");
    expect(out).toContain("1,000");
    expect(out).toContain("$");
  });

  it("formats percent by multiplying by 100 and fixing 2 decimals", () => {
    expect(displayTextForType(prop("number", { format: "percent" }), "0.5")).toBe(
      "50.00%"
    );
    expect(displayTextForType(prop("number", { format: "percent" }), "1")).toBe(
      "100.00%"
    );
    expect(displayTextForType(prop("number", { format: "percent" }), "0.123")).toBe(
      "12.30%"
    );
  });

  it("ignores an unknown format and renders the bare number", () => {
    expect(displayTextForType(prop("number", { format: "0.00€" }), "12.5")).toBe(
      "12.5"
    );
  });

  it("handles negative numbers", () => {
    expect(displayTextForType(prop("number"), "-7.25")).toBe("-7.25");
    expect(displayTextForType(prop("number", { format: "percent" }), "-0.5")).toBe(
      "-50.00%"
    );
  });
});

describe("displayTextForType — boolean", () => {
  it("renders ✓ for truthy boolean representations", () => {
    expect(displayTextForType(prop("boolean"), "true")).toBe("✓");
    expect(displayTextForType(prop("boolean"), true)).toBe("✓");
  });

  it("renders '' for the string 'false'", () => {
    expect(displayTextForType(prop("boolean"), "false")).toBe("");
  });

  it("KNOWN EDGE: any non-'true' truthy string still renders '' (not ✓)", () => {
    // Only String(value) === 'true' OR value === true qualify; "yes" does not.
    expect(displayTextForType(prop("boolean"), "yes")).toBe("");
    expect(displayTextForType(prop("boolean"), "1")).toBe("");
  });
});

describe("displayTextForType — tags / tags-multi", () => {
  it("prefixes each tag with # and space-joins", () => {
    expect(displayTextForType(prop("tags"), "a,b")).toBe("#a #b");
    expect(displayTextForType(prop("tags-multi"), "x, y, z")).toBe("#x #y #z");
  });

  it("handles a single tag", () => {
    expect(displayTextForType(prop("tags"), "solo")).toBe("#solo");
  });
});

describe("displayTextForType — option / option-multi", () => {
  it("returns the raw string for a single option", () => {
    expect(displayTextForType(prop("option"), "Choice")).toBe("Choice");
  });

  it("comma-joins parsed multi options", () => {
    expect(displayTextForType(prop("option-multi"), "a,b,c")).toBe("a, b, c");
  });

  it("parses a JSON-array multi string", () => {
    expect(displayTextForType(prop("option-multi"), '["a","b"]')).toBe("a, b");
  });
});

describe("displayTextForType — link / link-multi / file (no superstate)", () => {
  it("extracts the basename (sans extension) from a path", () => {
    expect(displayTextForType(prop("link"), "folder/My File.md")).toBe("My File");
  });

  it("keeps the name when there is no extension", () => {
    expect(displayTextForType(prop("link"), "folder/My File")).toBe("My File");
  });

  it("file type resolves like a single link", () => {
    expect(displayTextForType(prop("file"), "a/b/Image.png")).toBe("Image");
  });

  it("link-multi comma-joins each resolved display name", () => {
    expect(displayTextForType(prop("link-multi"), "a/One.md,b/Two.md")).toBe(
      "One, Two"
    );
  });

  it("KNOWN EDGE: a leading-dot filename keeps its dot (extensionIndex must be > 0)", () => {
    // lastIndexOf('.') === 0 is NOT > 0, so the dotfile is returned whole.
    expect(displayTextForType(prop("file"), ".gitignore")).toBe(".gitignore");
  });
});

describe("displayTextForType — object / object-multi", () => {
  it("re-serializes valid JSON object input", () => {
    expect(displayTextForType(prop("object"), JSON.stringify({ a: 1 }))).toBe(
      '{"a":1}'
    );
  });

  it("falls back to String(value) for non-JSON-object input", () => {
    expect(displayTextForType(prop("object"), "not json")).toBe("not json");
  });
});

describe("displayTextForType — date", () => {
  it("renders a yyyy-MM-dd date via toLocaleDateString fallback (no settings)", () => {
    // parseDate treats yyyy-MM-dd as a local date; with no superstate the code
    // path is the `format ? ... : dateValue.toLocaleDateString()` branch.
    const out = displayTextForType(prop("date"), "2020-04-21");
    // Locale-agnostic: the displayed date must reference the 2020 year & April.
    expect(out).toMatch(/2020/);
  });

  it("returns String(value) for an unparseable date", () => {
    expect(displayTextForType(prop("date"), "definitely-not-a-date")).toBe(
      "definitely-not-a-date"
    );
  });
});

describe("displayTextForType — unknown / default fallback", () => {
  it("returns value.toString() for an unrecognized type", () => {
    expect(displayTextForType(prop("totally-made-up"), "passthrough")).toBe(
      "passthrough"
    );
    expect(displayTextForType(prop("totally-made-up"), 99)).toBe("99");
  });
});

describe("displayTextForType — totality property net", () => {
  // The function must NEVER throw, for ANY type x ANY scalar value, and must
  // ALWAYS return a string. This is the contract every call site relies on.
  const types = [
    "date",
    "date-multi",
    "link",
    "link-multi",
    "file",
    "option",
    "option-multi",
    "tags",
    "tags-multi",
    "boolean",
    "number",
    "object",
    "object-multi",
    "unknown-type",
    "",
  ];
  const values: unknown[] = [
    null,
    undefined,
    "",
    "x",
    "0",
    "-1",
    "1e308",
    "NaN",
    "[]",
    "[1,2,3]",
    "{}",
    '{"k":"v"}',
    "a,b,c",
    "[[\"nested\"]]",
    "2020-01-01",
    "🙂",
    "  spaced  ",
    "true",
    "false",
    "1.5",
    "Infinity",
    String(Number.MAX_SAFE_INTEGER),
  ];

  it("never throws and always returns a string across the type x value matrix", () => {
    for (const type of types) {
      for (const value of values) {
        let out: string | undefined;
        expect(() => {
          out = displayTextForType(prop(type), value as never);
        }).not.toThrow();
        expect(typeof out).toBe("string");
      }
    }
  });

  it("never throws when the property config (value) is malformed JSON", () => {
    const bad: SpaceProperty = { name: "f", type: "number", value: "{not json" };
    expect(() => displayTextForType(bad, "12")).not.toThrow();
    expect(displayTextForType(bad, "12")).toBe("12");
  });
});
