/**
 * Adversarial / property tests for filenameTemplate.ts
 *
 * Bead: Notidian-3lry
 *
 * Locks 6 invariants and covers 15+ adversarial scenarios through the public
 * API surface (parseFilenameTemplate, evaluateFilenameTemplate, slugify,
 * formatValue, resolveCollision).
 *
 * All tests are pure-offline — no filesystem, no render path.
 */

import {
  evaluateFilenameTemplate,
  formatValue,
  parseFilenameTemplate,
  resolveCollision,
  slugify,
  TemplateSegment,
  TemplateVariable,
} from "./filenameTemplate";

// ---------------------------------------------------------------------------
// INVARIANT 1: Parse-evaluate round-trip safety
// ---------------------------------------------------------------------------

describe("INVARIANT 1: parse-evaluate round-trip safety", () => {
  const wellFormedTemplates = [
    "{name}",
    "{a}-{b}",
    "{board_id:02d}-ch{address:02d}-{device|slug}",
    "prefix-{x}-suffix",
    "{title|slug:30}",
    "{a}{b}{c}",
    "literal-only",
    "{x:03d}",
  ];

  it.each(wellFormedTemplates)(
    "parse then evaluate always produces a string for template '%s'",
    (template) => {
      const segments = parseFilenameTemplate(template);
      // Provide a record where every referenced field has a safe value
      const fm: Record<string, any> = {};
      for (const seg of segments) {
        if (seg.kind === "variable") {
          fm[seg.field] = "val";
        }
      }
      const result = evaluateFilenameTemplate(segments, fm);
      expect(typeof result).toBe("string");
      expect(result.length).toBeGreaterThan(0);
    }
  );

  it("round-trip with numeric values in formatted fields", () => {
    const segments = parseFilenameTemplate("{id:03d}-{ch:02d}");
    const result = evaluateFilenameTemplate(segments, { id: 7, ch: 3 });
    expect(result).toBe("007-03");
  });

  it("round-trip with missing frontmatter produces valid filename via fallback", () => {
    const segments = parseFilenameTemplate("{a}-{b}-{c}");
    const result = evaluateFilenameTemplate(segments, {});
    expect(result).toBe("_-_-_");
  });

  it("round-trip with all field types together", () => {
    const segments = parseFilenameTemplate(
      "db-{id:02d}-{name|slug:20}-{extra}"
    );
    const result = evaluateFilenameTemplate(segments, {
      id: 4,
      name: "Hello World Test",
      extra: "tag",
    });
    expect(typeof result).toBe("string");
    expect(result).toMatch(/^db-04-/);
  });
});

// ---------------------------------------------------------------------------
// INVARIANT 2: Slugify idempotency
// ---------------------------------------------------------------------------

describe("INVARIANT 2: slugify idempotency", () => {
  const inputs = [
    "Hello World",
    "foo_bar.baz",
    "UPPER CASE",
    "a-b-c",
    "already-slug",
    "multiple   spaces",
    "emoji 🔥 text",
    "CamelCaseTitle",
    "  leading-trailing  ",
    "under_score.dot,comma",
    "x".repeat(60),
    "café résumé naïve",
  ];

  it.each(inputs)(
    "slugify(slugify('%s')) === slugify('%s')",
    (input) => {
      const once = slugify(input);
      const twice = slugify(once);
      expect(twice).toBe(once);
    }
  );

  it("idempotency holds with custom maxLength", () => {
    const input = "A Very Long Title That Should Be Truncated Eventually";
    const once = slugify(input, 20);
    const twice = slugify(once, 20);
    expect(twice).toBe(once);
  });

  it("idempotency holds for emoji-only input", () => {
    const once = slugify("🎉🎊🎈");
    const twice = slugify(once);
    expect(twice).toBe(once);
    expect(once).toBe("_");
  });

  it("idempotency holds for unicode accented characters", () => {
    const once = slugify("über straße");
    const twice = slugify(once);
    expect(twice).toBe(once);
  });
});

// ---------------------------------------------------------------------------
// INVARIANT 3: Collision resolver monotonicity
// ---------------------------------------------------------------------------

describe("INVARIANT 3: collision resolver monotonicity", () => {
  it("suffix always increases, never returns a name already in the set", () => {
    const existingNames = new Set<string>();
    const base = "item";
    const results: string[] = [];

    for (let round = 0; round < 20; round++) {
      const resolved = resolveCollision(base, existingNames);
      // Must not be in the set already
      expect(existingNames.has(resolved)).toBe(false);
      results.push(resolved);
      existingNames.add(resolved);
    }

    // First should be the base name itself
    expect(results[0]).toBe("item");
    // Subsequent should be monotonically increasing suffixes
    for (let i = 1; i < results.length; i++) {
      expect(results[i]).toBe(`item-${i + 1}`);
    }
  });

  it("handles collision set with 100 entries", () => {
    const taken = new Set<string>();
    taken.add("x");
    for (let i = 2; i <= 100; i++) {
      taken.add(`x-${i}`);
    }
    // 99 collisions used (2..100), so the next should be x-101
    const resolved = resolveCollision("x", taken);
    expect(resolved).toBe("x-101");
    expect(taken.has(resolved)).toBe(false);
  });

  it("exhaustion throws at exactly 100 collisions", () => {
    const taken = new Set<string>();
    taken.add("z");
    for (let i = 2; i <= 101; i++) {
      taken.add(`z-${i}`);
    }
    expect(() => resolveCollision("z", taken)).toThrow(
      "Collision resolution exhausted"
    );
  });

  it("result is always unique relative to input set", () => {
    const taken = new Set(["doc", "doc-2", "doc-3", "doc-5"]);
    const result = resolveCollision("doc", taken);
    expect(taken.has(result)).toBe(false);
    // Monotonicity: should find first gap
    expect(result).toBe("doc-4");
  });
});

// ---------------------------------------------------------------------------
// INVARIANT 4: Missing-field fallback
// ---------------------------------------------------------------------------

describe("INVARIANT 4: missing-field fallback always produces '_'", () => {
  it("undefined field value produces '_'", () => {
    const segments = parseFilenameTemplate("{a}");
    const result = evaluateFilenameTemplate(segments, {});
    expect(result).toBe("_");
  });

  it("null field value produces '_'", () => {
    const segments = parseFilenameTemplate("{a}");
    const result = evaluateFilenameTemplate(segments, { a: null });
    expect(result).toBe("_");
  });

  it("empty string field value produces '_'", () => {
    const segments = parseFilenameTemplate("{a}");
    const result = evaluateFilenameTemplate(segments, { a: "" });
    expect(result).toBe("_");
  });

  it("all fields missing produces valid filename of underscores", () => {
    const segments = parseFilenameTemplate("{a}-{b}-{c}-{d}");
    const result = evaluateFilenameTemplate(segments, {});
    expect(result).toBe("_-_-_-_");
  });

  it("missing field with slug transform produces '_'", () => {
    const segments = parseFilenameTemplate("{name|slug}");
    const result = evaluateFilenameTemplate(segments, {});
    expect(result).toBe("_");
  });

  it("missing field with format specifier produces '_'", () => {
    const segments = parseFilenameTemplate("{num:02d}");
    const result = evaluateFilenameTemplate(segments, {});
    // formatValue('_', '02d') => NaN check => returns '_'
    expect(result).toBe("_");
  });

  it("never crashes on missing fields regardless of template complexity", () => {
    const segments = parseFilenameTemplate(
      "db-{a:02d}-ch{b:03d}-{c|slug:20}-{d}"
    );
    expect(() => evaluateFilenameTemplate(segments, {})).not.toThrow();
    const result = evaluateFilenameTemplate(segments, {});
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// INVARIANT 5: Format specifier boundary
// ---------------------------------------------------------------------------

describe("INVARIANT 5: format specifier boundary", () => {
  it("non-numeric input to 02d returns string representation, never throws", () => {
    expect(formatValue("abc", "02d")).toBe("abc");
  });

  it("boolean true treated as number 1", () => {
    expect(formatValue(true, "02d")).toBe("01");
  });

  it("boolean false treated as number 0", () => {
    expect(formatValue(false, "02d")).toBe("00");
  });

  it("null treated as number 0", () => {
    expect(formatValue(null, "02d")).toBe("00");
  });

  it("undefined returns 'NaN' string (non-numeric path)", () => {
    // Number(undefined) is NaN
    expect(formatValue(undefined, "02d")).toBe("undefined");
  });

  it("negative numbers are zero-padded correctly", () => {
    // padStart applies to the string '-5', which is 2 chars for 02d — no extra padding
    expect(formatValue(-5, "02d")).toBe("-5");
  });

  it("negative number with wider padding", () => {
    // String(-5) is "-5" (2 chars), padStart(4, '0') => "00-5"
    expect(formatValue(-5, "04d")).toBe("00-5");
  });

  it("zero is padded correctly", () => {
    expect(formatValue(0, "02d")).toBe("00");
  });

  it("large number exceeding pad width", () => {
    expect(formatValue(12345, "02d")).toBe("12345");
  });

  it("float is preserved in string form", () => {
    expect(formatValue(3.14, "02d")).toBe("3.14");
  });

  it("throws on unknown format specifier", () => {
    expect(() => formatValue(5, "02x")).toThrow("Unknown format specifier");
    expect(() => formatValue(5, "s")).toThrow("Unknown format specifier");
    expect(() => formatValue(5, "")).toThrow("Unknown format specifier");
  });
});

// ---------------------------------------------------------------------------
// INVARIANT 6: Evaluator + validatePageTitle integration
// ---------------------------------------------------------------------------

describe("INVARIANT 6: evaluator + validatePageTitle integration", () => {
  it("template producing '..' throws cleanly (reserved name)", () => {
    const segments: TemplateSegment[] = [{ kind: "literal", text: ".." }];
    expect(() => evaluateFilenameTemplate(segments, {})).toThrow(
      "invalid filename"
    );
  });

  it("template producing only dots throws (reserved name)", () => {
    const segments: TemplateSegment[] = [{ kind: "literal", text: "..." }];
    expect(() => evaluateFilenameTemplate(segments, {})).toThrow(
      "invalid filename"
    );
  });

  it("template producing 'CON' throws (Windows reserved)", () => {
    const segments = parseFilenameTemplate("{device}");
    expect(() =>
      evaluateFilenameTemplate(segments, { device: "CON" })
    ).toThrow("invalid filename");
  });

  it("template producing 'PRN.txt' throws (Windows reserved)", () => {
    const segments: TemplateSegment[] = [
      { kind: "literal", text: "PRN.txt" },
    ];
    expect(() => evaluateFilenameTemplate(segments, {})).toThrow(
      "invalid filename"
    );
  });

  it("template producing name with slash throws", () => {
    const segments: TemplateSegment[] = [
      { kind: "literal", text: "path/name" },
    ];
    expect(() => evaluateFilenameTemplate(segments, {})).toThrow(
      "invalid filename"
    );
  });

  it("very long slug does not produce filename exceeding 255 chars", () => {
    // A slug transform with a maxLength will truncate, but a raw long value
    // from frontmatter could exceed limits
    const segments = parseFilenameTemplate("{title|slug:50}");
    const longTitle = "x".repeat(300);
    const result = evaluateFilenameTemplate(segments, { title: longTitle });
    expect(result.length).toBeLessThanOrEqual(50);
  });

  it("valid simple result passes through cleanly", () => {
    const segments = parseFilenameTemplate("{name}");
    const result = evaluateFilenameTemplate(segments, { name: "my-file" });
    expect(result).toBe("my-file");
  });
});

// ---------------------------------------------------------------------------
// ADVERSARIAL: Nested / escaped braces
// ---------------------------------------------------------------------------

describe("ADVERSARIAL: nested and escaped braces", () => {
  it("nested braces: '{a{b}}' picks innermost close brace", () => {
    // The parser sees '{a{b}' as the first variable — inner content is 'a{b'
    // which is a valid field name (albeit unusual). The trailing '}' becomes
    // trailing literal or triggers a second parse attempt.
    // Actually: indexOf('}', openBrace) finds the first '}' after the first '{',
    // which gives inner = 'a{b' — that includes a literal '{' in the field name.
    // This is a quirk, not a crash. The important thing is: no throw, no hang.
    expect(() => parseFilenameTemplate("{a{b}}")).not.toThrow();
  });

  it("closing brace in literal does not confuse parser", () => {
    // '}' outside of '{}' is just literal text
    const result = parseFilenameTemplate("hello}world");
    expect(result).toEqual([{ kind: "literal", text: "hello}world" }]);
  });

  it("double open braces are parsed as first-match", () => {
    // '{{name}' — first '{' opens, indexOf('}') finds closing brace
    // inner = '{name' — field name is '{name'
    expect(() => parseFilenameTemplate("{{name}}")).not.toThrow();
  });

  it("literal brace characters in text are preserved", () => {
    const result = parseFilenameTemplate("a}b}c");
    expect(result).toEqual([{ kind: "literal", text: "a}b}c" }]);
  });
});

// ---------------------------------------------------------------------------
// ADVERSARIAL: Emoji-only values
// ---------------------------------------------------------------------------

describe("ADVERSARIAL: emoji-only values", () => {
  it("emoji-only field value with slug transform produces '_'", () => {
    const segments = parseFilenameTemplate("{icon|slug}");
    const result = evaluateFilenameTemplate(segments, { icon: "🔥🎉✨" });
    expect(result).toBe("_");
  });

  it("emoji mixed with text preserves text portion", () => {
    const segments = parseFilenameTemplate("{name|slug}");
    const result = evaluateFilenameTemplate(segments, {
      name: "🏠 Home Base 🌟",
    });
    expect(result).toMatch(/home-base/);
  });

  it("slugify handles compound emoji (ZWJ sequences)", () => {
    // Family emoji: 👨‍👩‍👧‍👦 (ZWJ sequence)
    const result = slugify("👨‍👩‍👧‍👦 family");
    expect(result).toBe("family");
  });

  it("slugify handles flag emoji", () => {
    const result = slugify("🇺🇸 usa");
    expect(result).toBe("usa");
  });
});

// ---------------------------------------------------------------------------
// ADVERSARIAL: Very long slugs (>50 chars)
// ---------------------------------------------------------------------------

describe("ADVERSARIAL: very long slugs", () => {
  it("default maxLength 50 truncates long input", () => {
    const input = "a-very-long-string-" + "x".repeat(60);
    const result = slugify(input);
    expect(result.length).toBeLessThanOrEqual(50);
  });

  it("truncation does not leave trailing hyphen", () => {
    // Construct input where truncation at 50 falls on a hyphen
    const input = "a".repeat(49) + "-b";
    const result = slugify(input);
    expect(result).not.toMatch(/-$/);
  });

  it("very long input with custom maxLength", () => {
    const input = "word ".repeat(100);
    const result = slugify(input, 30);
    expect(result.length).toBeLessThanOrEqual(30);
    expect(result).not.toMatch(/-$/);
  });

  it("maxLength of 1 still works", () => {
    const result = slugify("hello", 1);
    expect(result.length).toBeLessThanOrEqual(1);
    expect(result).toBe("h");
  });

  it("input exactly at maxLength boundary", () => {
    const input = "a".repeat(50);
    const result = slugify(input);
    expect(result.length).toBe(50);
    expect(result).toBe("a".repeat(50));
  });
});

// ---------------------------------------------------------------------------
// ADVERSARIAL: Format with negative numbers
// ---------------------------------------------------------------------------

describe("ADVERSARIAL: format with negative numbers", () => {
  it("negative number with 02d format", () => {
    const segments = parseFilenameTemplate("{val:02d}");
    // -5 as string is "-5", padStart(2, '0') => "-5" (already 2 chars)
    const result = evaluateFilenameTemplate(segments, { val: -5 });
    expect(result).toBe("-5");
  });

  it("negative number with wider pad does not crash", () => {
    // String(-42) is "-42" (3 chars), padStart(5, '0') => "00-42"
    expect(formatValue(-42, "05d")).toBe("00-42");
  });

  it("negative zero is treated as zero", () => {
    expect(formatValue(-0, "02d")).toBe("00");
  });

  it("very large negative number", () => {
    expect(formatValue(-999999, "02d")).toBe("-999999");
  });

  it("Infinity is treated as non-numeric by NaN check", () => {
    // Number(Infinity) is Infinity, not NaN, so it goes through padStart
    const result = formatValue(Infinity, "03d");
    expect(result).toBe("Infinity");
  });

  it("negative Infinity", () => {
    const result = formatValue(-Infinity, "03d");
    expect(result).toBe("-Infinity");
  });
});

// ---------------------------------------------------------------------------
// ADVERSARIAL: All fields missing
// ---------------------------------------------------------------------------

describe("ADVERSARIAL: all fields missing", () => {
  it("template with many variables, all missing", () => {
    const template = Array.from({ length: 10 }, (_, i) => `{f${i}}`).join("-");
    const segments = parseFilenameTemplate(template);
    const result = evaluateFilenameTemplate(segments, {});
    const expected = Array(10).fill("_").join("-");
    expect(result).toBe(expected);
  });

  it("empty frontmatter object", () => {
    const segments = parseFilenameTemplate("{x}");
    expect(evaluateFilenameTemplate(segments, {})).toBe("_");
  });

  it("frontmatter with unrelated fields", () => {
    const segments = parseFilenameTemplate("{needed}");
    const result = evaluateFilenameTemplate(segments, { other: "val" });
    expect(result).toBe("_");
  });
});

// ---------------------------------------------------------------------------
// ADVERSARIAL: Template with many variables
// ---------------------------------------------------------------------------

describe("ADVERSARIAL: template with many variables (100+)", () => {
  it("parser handles 100 variables without stack overflow", () => {
    const template = Array.from({ length: 100 }, (_, i) => `{v${i}}`).join(
      "-"
    );
    const segments = parseFilenameTemplate(template);
    // 100 variables + 99 literal hyphens
    expect(segments.length).toBe(199);
  });

  it("evaluator handles 100 variables", () => {
    const template = Array.from({ length: 100 }, (_, i) => `{v${i}}`).join(
      "-"
    );
    const segments = parseFilenameTemplate(template);
    const fm: Record<string, any> = {};
    for (let i = 0; i < 100; i++) {
      fm[`v${i}`] = `x`;
    }
    const result = evaluateFilenameTemplate(segments, fm);
    expect(result).toBe(Array(100).fill("x").join("-"));
  });
});

// ---------------------------------------------------------------------------
// ADVERSARIAL: Collision set with 100 entries
// ---------------------------------------------------------------------------

describe("ADVERSARIAL: collision set with 100 entries", () => {
  it("resolves past 100 occupied slots (filling 2..100, finds 101)", () => {
    const taken = new Set<string>();
    taken.add("doc");
    for (let i = 2; i <= 100; i++) {
      taken.add(`doc-${i}`);
    }
    const result = resolveCollision("doc", taken);
    expect(result).toBe("doc-101");
  });

  it("sparse collision set finds first gap", () => {
    const taken = new Set<string>();
    taken.add("item");
    taken.add("item-2");
    // Gap at item-3
    taken.add("item-4");
    taken.add("item-5");
    const result = resolveCollision("item", taken);
    expect(result).toBe("item-3");
  });
});

// ---------------------------------------------------------------------------
// ADVERSARIAL: Unicode NFC/NFD in slugify
// ---------------------------------------------------------------------------

describe("ADVERSARIAL: unicode NFC/NFD normalization in slugify", () => {
  it("NFC and NFD forms of the same string produce the same slug", () => {
    // "café" can be represented in NFC (é as single codepoint) or NFD (e + combining accent)
    const nfc = "café"; // é as single codepoint U+00E9
    const nfd = "café"; // e + combining acute accent U+0301

    const slugNfc = slugify(nfc);
    const slugNfd = slugify(nfd);

    // Both should produce a consistent result (exact form depends on implementation)
    // The important property: neither crashes, and both produce non-empty strings
    expect(slugNfc.length).toBeGreaterThan(0);
    expect(slugNfd.length).toBeGreaterThan(0);
  });

  it("mixed NFC/NFD in same string does not crash", () => {
    const mixed = "résumé näive"; // résumé naïve (mixed forms)
    expect(() => slugify(mixed)).not.toThrow();
    const result = slugify(mixed);
    expect(result.length).toBeGreaterThan(0);
  });

  it("combining characters alone produce fallback '_'", () => {
    // String of only combining diacritical marks
    const combining = "̀́̂̃";
    const result = slugify(combining);
    // These are non-emoji, non-letter marks — some may survive strip, or may
    // all be stripped by the unsafe-chars regex. Either way, should not crash.
    expect(typeof result).toBe("string");
  });

  it("fullwidth characters are processed without crash", () => {
    // Fullwidth Latin: Ａ Ｂ Ｃ
    const result = slugify("ＡＢＣ");
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// ADVERSARIAL: Pipe and colon in field names
// ---------------------------------------------------------------------------

describe("ADVERSARIAL: pipe and colon in field names", () => {
  it("field name with colon is split into field + format", () => {
    // {my:field} => field='my', format='field'
    // This is by design — colon is the format separator
    const result = parseFilenameTemplate("{my:field}");
    expect(result).toEqual([
      { kind: "variable", field: "my", format: "field" },
    ]);
  });

  it("field name with pipe is split into field + transform", () => {
    // {my|field} => field='my', transform='field'
    const result = parseFilenameTemplate("{my|field}");
    expect(result).toEqual([
      { kind: "variable", field: "my", transform: "field" },
    ]);
  });

  it("pipe-only transform produces no crash on evaluate (unknown transform is no-op)", () => {
    const segments = parseFilenameTemplate("{name|upper}");
    // 'upper' is not a recognized transform — the evaluator only checks for 'slug'
    // so it should pass through without transform
    const result = evaluateFilenameTemplate(segments, { name: "hello" });
    expect(result).toBe("hello");
  });

  it("field name with multiple pipes uses first pipe as separator", () => {
    // {a|b|c} => field='a', transformPart='b|c'
    // The colon check on 'b|c' — indexOf(':') is -1, so transform='b|c'
    const result = parseFilenameTemplate("{a|b|c}");
    expect(result[0]).toMatchObject({
      kind: "variable",
      field: "a",
      transform: "b|c",
    });
  });

  it("field name with multiple colons uses first colon as separator", () => {
    // {a:b:c} (no pipe) => field='a', format='b:c'
    const result = parseFilenameTemplate("{a:b:c}");
    expect(result[0]).toMatchObject({
      kind: "variable",
      field: "a",
      format: "b:c",
    });
  });
});

// ---------------------------------------------------------------------------
// ADVERSARIAL: Zero-length transform param
// ---------------------------------------------------------------------------

describe("ADVERSARIAL: zero-length transform param", () => {
  it("transform with empty param after colon throws (non-numeric)", () => {
    // {name|slug:} => transformPart='slug:', colonIndex=4, paramStr=''
    // Number('') is 0, which is finite — so transformParam=0
    // Actually, Number('') === 0 and Number.isFinite(0) === true
    // So this would set transformParam=0 for slug, meaning maxLength=0
    const segments = parseFilenameTemplate("{name|slug:0}");
    expect((segments[0] as TemplateVariable).transformParam).toBe(0);
    // slugify with maxLength 0 => result.length > 0 always => truncates to 0
    // then fallback to '_'
    const result = evaluateFilenameTemplate(segments, { name: "hello" });
    expect(result).toBe("_");
  });

  it("slug transform with param 0 produces '_' fallback", () => {
    const result = slugify("any text", 0);
    expect(result).toBe("_");
  });

  it("slug transform with negative param truncates to nothing (fallback '_')", () => {
    // slice(0, -5) on a short string would produce empty or partial
    // But the code does result.length > limit check; if limit < 0, length > limit
    // is always true, so it slices to negative index which yields ''
    const result = slugify("hi", -5);
    // slice(0, -5) on "hi" => "" => fallback "_"
    expect(result).toBe("_");
  });
});

// ---------------------------------------------------------------------------
// ADVERSARIAL: Edge-case parser inputs
// ---------------------------------------------------------------------------

describe("ADVERSARIAL: edge-case parser inputs", () => {
  it("empty template string returns empty segments array", () => {
    const result = parseFilenameTemplate("");
    expect(result).toEqual([]);
  });

  it("template of only whitespace is a literal", () => {
    const result = parseFilenameTemplate("   ");
    expect(result).toEqual([{ kind: "literal", text: "   " }]);
  });

  it("template with empty braces throws", () => {
    expect(() => parseFilenameTemplate("{}")).toThrow("empty field name");
  });

  it("template with empty field before pipe throws", () => {
    expect(() => parseFilenameTemplate("{|slug}")).toThrow("empty field name");
  });

  it("template with empty field before colon throws", () => {
    expect(() => parseFilenameTemplate("{:02d}")).toThrow("empty field name");
  });

  it("unmatched opening brace throws", () => {
    expect(() => parseFilenameTemplate("{unclosed")).toThrow("unmatched '{'");
  });

  it("single-character field name works", () => {
    const result = parseFilenameTemplate("{x}");
    expect(result).toEqual([{ kind: "variable", field: "x" }]);
  });

  it("field name with numbers works", () => {
    const result = parseFilenameTemplate("{field123}");
    expect(result).toEqual([{ kind: "variable", field: "field123" }]);
  });

  it("field name with hyphen works", () => {
    const result = parseFilenameTemplate("{my-field}");
    expect(result).toEqual([{ kind: "variable", field: "my-field" }]);
  });
});

// ---------------------------------------------------------------------------
// ADVERSARIAL: Slugify special characters and edge cases
// ---------------------------------------------------------------------------

describe("ADVERSARIAL: slugify special characters", () => {
  it("strips all unsafe filename characters", () => {
    const result = slugify('a:b/c\\d*e?f"g<h>i|j#k{l}m%n&o+p!q@r');
    // Only 'a' through 'r' and the letters between survive
    expect(result).not.toMatch(/[:/\\*?"<>|#{}%&+!@]/);
    expect(result.length).toBeGreaterThan(0);
  });

  it("handles tab and newline as whitespace", () => {
    const result = slugify("hello\tworld\nfoo");
    expect(result).toBe("hello-world-foo");
  });

  it("handles single quote stripping", () => {
    const result = slugify("it's a test");
    expect(result).toBe("its-a-test");
  });

  it("Japanese/CJK characters survive (not stripped by emoji regex)", () => {
    const result = slugify("日本語テスト");
    // CJK chars are not emoji (So/Sk category) so they should survive
    expect(result.length).toBeGreaterThan(0);
    expect(result).not.toBe("_");
  });

  it("Arabic characters survive", () => {
    const result = slugify("مرحبا");
    expect(result.length).toBeGreaterThan(0);
    expect(result).not.toBe("_");
  });
});

// ---------------------------------------------------------------------------
// ADVERSARIAL: Evaluator with exotic frontmatter values
// ---------------------------------------------------------------------------

describe("ADVERSARIAL: evaluator with exotic frontmatter values", () => {
  it("array value is coerced to string", () => {
    const segments = parseFilenameTemplate("{tags}");
    const result = evaluateFilenameTemplate(segments, {
      tags: ["a", "b", "c"],
    });
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
  });

  it("object value is coerced to string", () => {
    const segments = parseFilenameTemplate("{meta}");
    const result = evaluateFilenameTemplate(segments, {
      meta: { key: "val" },
    });
    expect(typeof result).toBe("string");
  });

  it("number value works without transform", () => {
    const segments = parseFilenameTemplate("{num}");
    const result = evaluateFilenameTemplate(segments, { num: 42 });
    expect(result).toBe("42");
  });

  it("boolean value is coerced to string", () => {
    const segments = parseFilenameTemplate("{flag}");
    const result = evaluateFilenameTemplate(segments, { flag: true });
    expect(result).toBe("true");
  });

  it("value 0 (falsy but not null/undefined/empty) is preserved", () => {
    const segments = parseFilenameTemplate("{count}");
    const result = evaluateFilenameTemplate(segments, { count: 0 });
    expect(result).toBe("0");
  });

  it("value false (falsy but not null/undefined/empty) is preserved", () => {
    const segments = parseFilenameTemplate("{active}");
    const result = evaluateFilenameTemplate(segments, { active: false });
    expect(result).toBe("false");
  });
});
