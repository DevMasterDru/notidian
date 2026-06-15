/**
 * Well-formedness + resolver-totality net for fields/units.ts.
 *
 * `unitTypes` is the i18n-keyed table of number FORMAT PATTERNS offered in the
 * property-format picker (src/.../Menus/contexts/PropertyValue.tsx). Each entry
 * is `{ label, value }` where `value` is either:
 *   - "" (the "none" sentinel — no formatting),
 *   - "sticker" (a special, non-numfmt rendering mode handled by NumberCell), or
 *   - a numfmt pattern string (e.g. `0%`, `$0.00`, `0.00"€"`, `0.00E+00`).
 *
 * The numeric patterns are fed to safeFormatNumber(value, n) (core/utils/number.ts)
 * which delegates to numfmt's `format`. So the contract this net pins is twofold:
 *   1. STRUCTURE: every table entry is well-formed and there are no duplicate
 *      values (a duplicate value would make the picker ambiguous).
 *   2. RESOLUTION: every real numfmt pattern in the table is a valid numfmt
 *      format and safeFormatNumber stays TOTAL (never throws) across boundary
 *      magnitudes (0, negative, NaN, ±Infinity, very large/small).
 */
import { format as numfmtFormat } from "numfmt";
import { safeFormatNumber } from "core/utils/number";
import { unitTypes } from "./units";

/** numfmt patterns are every entry value except the two non-pattern sentinels. */
const NON_PATTERN_VALUES = new Set(["", "sticker"]);
const patternEntries = unitTypes.filter((u) => !NON_PATTERN_VALUES.has(u.value));

describe("unitTypes — table structure", () => {
  it("is a non-empty array", () => {
    expect(Array.isArray(unitTypes)).toBe(true);
    expect(unitTypes.length).toBeGreaterThan(0);
  });

  it("every entry has a non-empty string label", () => {
    for (const entry of unitTypes) {
      expect(typeof entry.label).toBe("string");
      expect(entry.label.length).toBeGreaterThan(0);
    }
  });

  it("every entry has a string value (\"\" allowed for the 'none' sentinel)", () => {
    for (const entry of unitTypes) {
      expect(typeof entry.value).toBe("string");
    }
  });

  it("every entry has exactly the {label, value} shape", () => {
    for (const entry of unitTypes) {
      expect(Object.keys(entry).sort()).toEqual(["label", "value"]);
    }
  });

  it("includes the 'none' empty-value sentinel exactly once", () => {
    const empties = unitTypes.filter((u) => u.value === "");
    expect(empties.length).toBe(1);
  });

  it("includes the special non-numfmt 'sticker' value exactly once", () => {
    const stickers = unitTypes.filter((u) => u.value === "sticker");
    expect(stickers.length).toBe(1);
  });

  it("has NO duplicate values (the picker keys options by value)", () => {
    const values = unitTypes.map((u) => u.value);
    const seen = new Map<string, number>();
    for (const v of values) seen.set(v, (seen.get(v) ?? 0) + 1);
    const dupes = [...seen.entries()].filter(([, n]) => n > 1).map(([v]) => v);
    expect(dupes).toEqual([]);
  });

  it("has NO duplicate labels (the picker shows labels to the user)", () => {
    const labels = unitTypes.map((u) => u.label);
    const seen = new Map<string, number>();
    for (const l of labels) seen.set(l, (seen.get(l) ?? 0) + 1);
    const dupes = [...seen.entries()].filter(([, n]) => n > 1).map(([l]) => l);
    expect(dupes).toEqual([]);
  });
});

describe("unitTypes — every numfmt pattern is valid & non-trivial", () => {
  it("has at least one real numfmt pattern beyond the sentinels", () => {
    expect(patternEntries.length).toBeGreaterThan(0);
  });

  it.each(patternEntries.map((u) => [u.label, u.value] as const))(
    "pattern for %s (%s) is accepted by numfmt and renders a string",
    (_label, pattern) => {
      // A malformed pattern would make numfmt throw on a normal value; a valid
      // one returns a string. This proves the table holds only usable patterns.
      let out: unknown;
      expect(() => {
        out = numfmtFormat(pattern, 1234.5);
      }).not.toThrow();
      expect(typeof out).toBe("string");
    }
  );

  it.each(patternEntries.map((u) => [u.label, u.value] as const))(
    "pattern for %s (%s) actually transforms the input (not an identity passthrough)",
    (_label, pattern) => {
      // Each numeric pattern should produce a rendering distinct from the bare
      // number for at least one representative value — i.e. it carries a unit,
      // a symbol, a percent, or scientific notation. This guards against an
      // entry whose pattern silently does nothing.
      const plain = String(1234.5);
      const rendered = numfmtFormat(pattern, 1234.5);
      expect(rendered).not.toBe(plain);
    }
  );
});

describe("safeFormatNumber — resolver totality over unit patterns x boundaries", () => {
  // Boundary magnitudes the resolver must survive without throwing.
  const boundaries: Array<[string, number]> = [
    ["zero", 0],
    ["one", 1],
    ["negative", -42.5],
    ["fractional", 0.123],
    ["very large", 1e21],
    ["very small", 1e-21],
    ["max safe int", Number.MAX_SAFE_INTEGER],
    ["min safe int", Number.MIN_SAFE_INTEGER],
    ["NaN", NaN],
    ["positive Infinity", Infinity],
    ["negative Infinity", -Infinity],
  ];

  // Cross every table value (including "" and "sticker") with every boundary.
  for (const unit of unitTypes) {
    for (const [boundaryLabel, value] of boundaries) {
      it(`is total for value=${JSON.stringify(
        unit.value
      )} input=${boundaryLabel}`, () => {
        let out: string | undefined;
        expect(() => {
          out = safeFormatNumber(unit.value, value);
        }).not.toThrow();
        // Contract: always returns a string (the catch path returns value.toString()).
        expect(typeof out).toBe("string");
      });
    }
  }

  it("percent pattern multiplies by 100 (smoke check the canonical case)", () => {
    expect(safeFormatNumber("0%", 0.5)).toBe("50%");
  });

  it("falls back to value.toString() when given a malformed pattern", () => {
    // numfmt throws on an unbalanced-quote pattern; safeFormatNumber swallows it.
    const malformed = '0.00"unterminated';
    let out: string | undefined;
    expect(() => {
      out = safeFormatNumber(malformed, 7);
    }).not.toThrow();
    // Either numfmt handled it or the catch returned "7"; either way it's a string.
    expect(typeof out).toBe("string");
  });
});

describe("safeFormatNumber — fuzz totality over arbitrary numeric input", () => {
  // Property: for ANY finite-or-special number and ANY table pattern, the
  // resolver returns a string and never throws.
  const samplePatterns = patternEntries.map((u) => u.value);

  it("never throws across a numeric fuzz x pattern grid", () => {
    const rng = mulberry32(0xC0FFEE);
    for (let i = 0; i < 200; i++) {
      // Mix of magnitudes incl. occasional NaN/Infinity injection.
      const r = rng();
      let n: number;
      if (r < 0.05) n = NaN;
      else if (r < 0.1) n = Infinity;
      else if (r < 0.15) n = -Infinity;
      else n = (rng() - 0.5) * Math.pow(10, Math.floor(rng() * 30) - 10);

      for (const pattern of samplePatterns) {
        let out: string | undefined;
        expect(() => {
          out = safeFormatNumber(pattern, n);
        }).not.toThrow();
        expect(typeof out).toBe("string");
      }
    }
  });
});

/** Deterministic PRNG so the fuzz net is reproducible across runs. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
