import {
  evaluateFilenameTemplate,
  formatValue,
  parseFilenameTemplate,
  resolveCollision,
  slugify,
  TemplateSegment,
} from "./filenameTemplate";

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

describe("parseFilenameTemplate", () => {
  it("parses a simple field", () => {
    expect(parseFilenameTemplate("{name}")).toEqual([
      { kind: "variable", field: "name" },
    ]);
  });

  it("parses a field with numeric format", () => {
    expect(parseFilenameTemplate("{id:02d}")).toEqual([
      { kind: "variable", field: "id", format: "02d" },
    ]);
  });

  it("parses a field with transform", () => {
    expect(parseFilenameTemplate("{name|slug}")).toEqual([
      { kind: "variable", field: "name", transform: "slug" },
    ]);
  });

  it("parses a field with transform and param", () => {
    expect(parseFilenameTemplate("{name|slug:30}")).toEqual([
      { kind: "variable", field: "name", transform: "slug", transformParam: 30 },
    ]);
  });

  it("parses mixed literal and variable", () => {
    expect(parseFilenameTemplate("slave-{board_id}")).toEqual([
      { kind: "literal", text: "slave-" },
      { kind: "variable", field: "board_id" },
    ]);
  });

  it("parses a complex template with 5 segments", () => {
    const result = parseFilenameTemplate(
      "{board_id:02d}-ch{address:02d}-{device|slug}"
    );
    expect(result).toEqual([
      { kind: "variable", field: "board_id", format: "02d" },
      { kind: "literal", text: "-ch" },
      { kind: "variable", field: "address", format: "02d" },
      { kind: "literal", text: "-" },
      { kind: "variable", field: "device", transform: "slug" },
    ]);
    expect(result).toHaveLength(5);
  });

  it("parses pure literal text (no variables)", () => {
    expect(parseFilenameTemplate("hello-world")).toEqual([
      { kind: "literal", text: "hello-world" },
    ]);
  });

  it("parses consecutive variables", () => {
    expect(parseFilenameTemplate("{a}{b}")).toEqual([
      { kind: "variable", field: "a" },
      { kind: "variable", field: "b" },
    ]);
  });

  it("throws on empty field name", () => {
    expect(() => parseFilenameTemplate("{}")).toThrow("empty field name");
  });

  it("throws on unmatched opening brace", () => {
    expect(() => parseFilenameTemplate("{name")).toThrow("unmatched '{'");
  });

  it("throws on empty field name with pipe", () => {
    expect(() => parseFilenameTemplate("{|slug}")).toThrow("empty field name");
  });

  it("throws on non-numeric transform param", () => {
    expect(() => parseFilenameTemplate("{name|slug:abc}")).toThrow(
      "non-numeric transform param"
    );
  });

  it("parses trailing literal after variable", () => {
    expect(parseFilenameTemplate("{id}-suffix")).toEqual([
      { kind: "variable", field: "id" },
      { kind: "literal", text: "-suffix" },
    ]);
  });
});

// ---------------------------------------------------------------------------
// Slugify
// ---------------------------------------------------------------------------

describe("slugify", () => {
  it("strips emoji and lowercases", () => {
    expect(slugify("Joker Fill RO Sol 1")).toBe("joker-fill-ro-sol-1");
  });

  it("strips leading emoji", () => {
    const result = slugify("PH Up Peri");
    expect(result).toBe("ph-up-peri");
  });

  it("strips ampersand and comma", () => {
    expect(slugify("Fill, Tap & Other Sols")).toBe("fill-tap-other-sols");
  });

  it("truncates to specified maxLength", () => {
    const result = slugify("a very long name here that exceeds limit", 10);
    expect(result.length).toBeLessThanOrEqual(10);
    expect(result).not.toMatch(/-$/);
  });

  it("returns placeholder for empty-after-strip", () => {
    // All emoji, nothing left after stripping
    expect(slugify("⭐✨")).toBe("_");
  });

  it("passes through already-clean names", () => {
    expect(slugify("simple-name")).toBe("simple-name");
  });

  it("collapses consecutive hyphens", () => {
    expect(slugify("foo - - bar")).toBe("foo-bar");
  });

  it("replaces underscores and dots with hyphens", () => {
    expect(slugify("foo_bar.baz")).toBe("foo-bar-baz");
  });

  it("uses default max of 50 chars", () => {
    const long = "a".repeat(60);
    expect(slugify(long).length).toBeLessThanOrEqual(50);
  });

  it("trims leading and trailing hyphens", () => {
    expect(slugify(" -hello- ")).toBe("hello");
  });
});

// ---------------------------------------------------------------------------
// Format
// ---------------------------------------------------------------------------

describe("formatValue", () => {
  it("zero-pads a number with 02d", () => {
    expect(formatValue(2, "02d")).toBe("02");
  });

  it("zero-pads a single digit with 02d", () => {
    expect(formatValue(5, "02d")).toBe("05");
  });

  it("does not pad a number wider than the format", () => {
    expect(formatValue(17, "02d")).toBe("17");
  });

  it("pads with 03d", () => {
    expect(formatValue(7, "03d")).toBe("007");
  });

  it("returns string representation for NaN input", () => {
    expect(formatValue("abc", "02d")).toBe("abc");
  });

  it("throws on unknown format", () => {
    expect(() => formatValue(5, "x")).toThrow("Unknown format specifier");
  });
});

// ---------------------------------------------------------------------------
// Evaluator
// ---------------------------------------------------------------------------

describe("evaluateFilenameTemplate", () => {
  it("evaluates a full Device Registry template", () => {
    const segments = parseFilenameTemplate(
      "{board_id:02d}-ch{address:02d}-{device|slug}"
    );
    const result = evaluateFilenameTemplate(segments, {
      board_id: 2,
      address: 5,
      device: "Joker Fill RO Sol 1",
    });
    expect(result).toBe("02-ch05-joker-fill-ro-sol-1");
  });

  it("uses placeholder for missing fields", () => {
    const segments = parseFilenameTemplate("{board_id}-{missing}");
    const result = evaluateFilenameTemplate(segments, { board_id: 2 });
    expect(result).toBe("2-_");
  });

  it("uses placeholder for null fields", () => {
    const segments = parseFilenameTemplate("{a}");
    expect(evaluateFilenameTemplate(segments, { a: null })).toBe("_");
  });

  it("uses placeholder for empty string fields", () => {
    const segments = parseFilenameTemplate("{a}");
    expect(evaluateFilenameTemplate(segments, { a: "" })).toBe("_");
  });

  it("evaluates a simple key template", () => {
    const segments = parseFilenameTemplate("slave-{board_id}");
    expect(evaluateFilenameTemplate(segments, { board_id: 2 })).toBe(
      "slave-2"
    );
  });

  it("applies slug transform with param", () => {
    const segments = parseFilenameTemplate("{title|slug:10}");
    const result = evaluateFilenameTemplate(segments, {
      title: "A Very Long Title That Should Be Truncated",
    });
    expect(result.length).toBeLessThanOrEqual(10);
  });

  it("throws on template producing invalid filename", () => {
    // A template that produces only dots should fail validation
    const segments: TemplateSegment[] = [
      { kind: "literal", text: ".." },
    ];
    expect(() =>
      evaluateFilenameTemplate(segments, {})
    ).toThrow("invalid filename");
  });
});

// ---------------------------------------------------------------------------
// Collision resolver
// ---------------------------------------------------------------------------

describe("resolveCollision", () => {
  it("returns baseName when no collision", () => {
    expect(resolveCollision("foo", new Set(["bar"]))).toBe("foo");
  });

  it("returns baseName when set is empty", () => {
    expect(resolveCollision("foo", new Set())).toBe("foo");
  });

  it("appends -2 on first collision", () => {
    expect(resolveCollision("foo", new Set(["foo"]))).toBe("foo-2");
  });

  it("appends -3 when -2 is also taken", () => {
    expect(resolveCollision("foo", new Set(["foo", "foo-2"]))).toBe("foo-3");
  });

  it("handles deep collision chain", () => {
    const taken = new Set(["x", "x-2", "x-3", "x-4", "x-5"]);
    expect(resolveCollision("x", taken)).toBe("x-6");
  });

  it("throws after 100 attempts", () => {
    const taken = new Set<string>();
    taken.add("z");
    for (let i = 2; i <= 101; i++) taken.add(`z-${i}`);
    expect(() => resolveCollision("z", taken)).toThrow(
      "Collision resolution exhausted"
    );
  });
});
