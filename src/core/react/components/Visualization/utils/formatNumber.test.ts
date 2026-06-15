import { formatNumber, formatNumberCompact } from "./formatNumber";

// ---------------------------------------------------------------------------
// DEPTH (Q1) — adversarial + property characterization net for the
// Visualization number-formatting core (Notidian-5hs). Both functions are
// PURE and DETERMINISTIC; the entire Visualization subtree previously had ZERO
// test coverage. formatNumber feeds axis ticks, data labels, and tooltips, and
// formatNumberCompact feeds compacted axis/legend text — so a silent change to
// the magnitude bands or the compact-suffix boundaries is a visible regression.
//
// This is a CHARACTERIZATION net, not a correction. Several outputs are
// arguably-surprising display quirks (a value just under 100 rounding up to a
// suffix-less "100"; a value in [999.5, 1000) rounding to a suffix-less "1000";
// a value in [999500, 1000000) compacting to "1000k" instead of rolling to
// "1M"). They are deterministic, crash-free, and well-typed — NOT indefensible
// bugs — so they are LOCKED here as present behaviour and flagged in comments,
// not "fixed". A follow-up bead tracks the compact-boundary roll-over polish.
//
// Everything here is pure / offline — no vault, no DOM, no I/O. Every expected
// value below was empirically captured from the implementation before pinning.
// ---------------------------------------------------------------------------

describe("formatNumber", () => {
  describe("non-finite values short-circuit to String(value)", () => {
    it("NaN -> 'NaN'", () => {
      expect(formatNumber(NaN)).toBe("NaN");
    });
    it("Infinity -> 'Infinity'", () => {
      expect(formatNumber(Infinity)).toBe("Infinity");
    });
    it("-Infinity -> '-Infinity'", () => {
      expect(formatNumber(-Infinity)).toBe("-Infinity");
    });
    it("non-finite short-circuit runs BEFORE forceDecimals (NaN.toFixed never reached)", () => {
      // Guards the ordering: the isFinite gate precedes the forceDecimals branch,
      // so forceDecimals cannot turn 'NaN' into e.g. 'NaN' via toFixed (which
      // would also be 'NaN', but the contract is the String(value) path).
      expect(formatNumber(NaN, 2)).toBe("NaN");
      expect(formatNumber(Infinity, 0)).toBe("Infinity");
    });
  });

  describe("integers short-circuit via Number.isInteger -> toString (no decimals)", () => {
    it("0 -> '0'", () => {
      expect(formatNumber(0)).toBe("0");
    });
    it("negative zero collapses to '0' (Number.isInteger(-0) is true)", () => {
      // -0 is an integer; (-0).toString() === '0'. Pins that the sign of zero is
      // intentionally NOT preserved.
      expect(formatNumber(-0)).toBe("0");
      expect(Object.is(formatNumber(-0), "0")).toBe(true);
    });
    it("1 -> '1'", () => {
      expect(formatNumber(1)).toBe("1");
    });
    it("large integer stays exact (no rounding, no decimals)", () => {
      expect(formatNumber(1234567)).toBe("1234567");
    });
    it("negative integer keeps sign", () => {
      expect(formatNumber(-42)).toBe("-42");
    });
  });

  describe("forceDecimals override (when provided, takes precedence over magnitude bands)", () => {
    it("forceDecimals=2 on a value that would otherwise integer-short-circuit", () => {
      expect(formatNumber(5, 3)).toBe("5.000");
    });
    it("forceDecimals=2 rounds like toFixed", () => {
      expect(formatNumber(3.14159, 2)).toBe("3.14");
    });
    it("forceDecimals=0 rounds to integer with sign (banker's-rounding NOT used; half-up away from zero per toFixed)", () => {
      expect(formatNumber(-1.5, 0)).toBe("-2");
    });
    it("forceDecimals=0 keeps it as a fixed string, distinct from the integer toString path", () => {
      // 100 is an integer, but forceDecimals wins and produces a toFixed string.
      expect(formatNumber(100, 0)).toBe("100");
      expect(formatNumber(100, 2)).toBe("100.00");
    });
    it("forceDecimals is honoured even for negative fractional input", () => {
      expect(formatNumber(-0.00012345, 4)).toBe("-0.0001");
    });
  });

  describe("magnitude band: absValue < 0.01 (up to 4 dp, trailing zeros stripped)", () => {
    it("0.005 keeps 3 significant decimals", () => {
      expect(formatNumber(0.005)).toBe("0.005");
    });
    it("0.001 retained", () => {
      expect(formatNumber(0.001)).toBe("0.001");
    });
    it("0.00001 underflows the 4dp cap and collapses to '0'", () => {
      // (0.00001).toFixed(4) === '0.0000'; parseFloat -> 0; toString -> '0'.
      // Pins the underflow edge: ultra-small magnitudes display as 0.
      expect(formatNumber(0.00001)).toBe("0");
    });
    it("trailing zeros are stripped via parseFloat round-trip", () => {
      // 0.0010 -> toFixed(4) '0.0010' -> parseFloat 0.001 -> '0.001'
      expect(formatNumber(0.001)).toBe("0.001");
    });
  });

  describe("magnitude band: 0.01 <= absValue < 0.1 (up to 3 dp)", () => {
    it("0.01 boundary is INCLUSIVE of the 3dp band (not the 4dp band)", () => {
      // absValue < 0.01 is strict, so 0.01 itself falls to the < 0.1 branch.
      expect(formatNumber(0.01)).toBe("0.01");
    });
    it("0.05 -> '0.05'", () => {
      expect(formatNumber(0.05)).toBe("0.05");
    });
    it("0.099 rounds within 3dp", () => {
      expect(formatNumber(0.099)).toBe("0.099");
    });
  });

  describe("magnitude band: 0.1 <= absValue < 1 (up to 2 dp)", () => {
    it("0.1 boundary falls to the 2dp band", () => {
      expect(formatNumber(0.1)).toBe("0.1");
    });
    it("0.55 -> '0.55'", () => {
      expect(formatNumber(0.55)).toBe("0.55");
    });
    it("0.999 rounds up to '1' at 2dp (parseFloat strips the .00)", () => {
      // (0.999).toFixed(2) === '1.00' -> parseFloat 1 -> '1'
      expect(formatNumber(0.999)).toBe("1");
    });
  });

  describe("magnitude band: 1 <= absValue < 100 (up to 1 dp)", () => {
    it("1.25 rounds to 1dp -> '1.3' (half-up via toFixed)", () => {
      expect(formatNumber(1.25)).toBe("1.3");
    });
    it("negative fractional keeps sign -> '-2.5'", () => {
      expect(formatNumber(-2.5)).toBe("-2.5");
    });
    it("99.96 rounds UP across the band into a suffix-less '100' (LOCKED quirk)", () => {
      // 99.96 < 100 so it takes the 1dp branch; (99.96).toFixed(1) === '100.0';
      // parseFloat -> 100 -> '100'. A value below the 100 threshold thus emits
      // the same string as the >=100 branch would. Deterministic; pinned.
      expect(formatNumber(99.96)).toBe("100");
    });
    it("99.94 stays under via 1dp rounding -> '99.9'", () => {
      expect(formatNumber(99.94)).toBe("99.9");
    });
  });

  describe("magnitude band: absValue >= 100 (Math.round, no decimals)", () => {
    it("100 is an integer -> '100' (integer short-circuit, not the >=100 branch)", () => {
      expect(formatNumber(100)).toBe("100");
    });
    it("100.4 rounds down to '100'", () => {
      expect(formatNumber(100.4)).toBe("100");
    });
    it("100.5 rounds up to '101' (Math.round is half-up toward +Inf)", () => {
      expect(formatNumber(100.5)).toBe("101");
    });
    it("-100.5 rounds toward +Inf -> '-100' (Math.round semantics, NOT away-from-zero)", () => {
      // Math.round(-100.5) === -100 (ties go to +Infinity), distinct from toFixed.
      expect(formatNumber(-100.5)).toBe("-100");
    });
    it("123.456 -> '123'", () => {
      expect(formatNumber(123.456)).toBe("123");
    });
    it("12345.6 -> '12346'", () => {
      expect(formatNumber(12345.6)).toBe("12346");
    });
  });

  // ---- PROPERTY INVARIANTS (deterministic, seeded; no fast-check dep) ----
  describe("property invariants", () => {
    // A small deterministic LCG so the suite is reproducible and offline.
    function makeRng(seed: number): () => number {
      let s = seed >>> 0;
      return () => {
        s = (s * 1664525 + 1013904223) >>> 0;
        return s / 0xffffffff;
      };
    }
    function sampleFinite(rng: () => number): number {
      // Spread across many magnitudes incl. sub-0.01 and >=100 bands, both signs.
      const exp = Math.floor(rng() * 14) - 6; // 10^-6 .. 10^7
      const mantissa = rng() * 9 + 1;
      const sign = rng() < 0.5 ? -1 : 1;
      return sign * mantissa * Math.pow(10, exp);
    }

    it("finite input always yields a finite-parseable string", () => {
      const rng = makeRng(12345);
      for (let i = 0; i < 2000; i++) {
        const x = sampleFinite(rng);
        const out = formatNumber(x);
        const parsed = parseFloat(out);
        expect(Number.isFinite(parsed)).toBe(true);
      }
    });

    it("output is idempotent under re-format of its own parsed value", () => {
      // Re-formatting the value the displayed string represents must be stable:
      // formatNumber(parseFloat(formatNumber(x))) === formatNumber(x).
      const rng = makeRng(67890);
      for (let i = 0; i < 2000; i++) {
        const x = sampleFinite(rng);
        const once = formatNumber(x);
        const twice = formatNumber(parseFloat(once));
        expect(twice).toBe(once);
      }
    });

    it("output never contains exponential notation for in-range magnitudes", () => {
      // The bands cap magnitudes well within toFixed/Math.round/toString's
      // non-exponential range; pin that no 'e' leaks into displayed ticks.
      const rng = makeRng(24680);
      for (let i = 0; i < 2000; i++) {
        const x = sampleFinite(rng);
        const out = formatNumber(x);
        expect(out.toLowerCase()).not.toContain("e");
      }
    });

    it("sign is preserved for non-zero-rounding magnitudes >= 1", () => {
      const rng = makeRng(13579);
      for (let i = 0; i < 1000; i++) {
        const mantissa = rng() * 9 + 1;
        const exp = Math.floor(rng() * 4); // 1 .. ~9999
        const mag = mantissa * Math.pow(10, exp);
        const neg = formatNumber(-mag);
        const pos = formatNumber(mag);
        // For magnitudes >= 1 the rounded result is non-zero, so the negative
        // must carry a leading '-' and the positive must not.
        expect(neg.startsWith("-")).toBe(true);
        expect(pos.startsWith("-")).toBe(false);
      }
    });

    it("forceDecimals output always has exactly that many decimal places (finite, n>=1)", () => {
      const rng = makeRng(97531);
      for (let i = 0; i < 1000; i++) {
        const x = sampleFinite(rng);
        const n = 1 + Math.floor(rng() * 6);
        const out = formatNumber(x, n);
        const dot = out.indexOf(".");
        expect(dot).toBeGreaterThan(-1);
        expect(out.length - dot - 1).toBe(n);
      }
    });
  });
});

describe("formatNumberCompact", () => {
  describe("non-finite short-circuit", () => {
    it("NaN -> 'NaN'", () => {
      expect(formatNumberCompact(NaN)).toBe("NaN");
    });
    it("Infinity -> 'Infinity'", () => {
      expect(formatNumberCompact(Infinity)).toBe("Infinity");
    });
    it("-Infinity -> '-Infinity'", () => {
      expect(formatNumberCompact(-Infinity)).toBe("-Infinity");
    });
  });

  describe("below the 1e3 band: delegates to formatNumber with no suffix", () => {
    it("0 -> '0'", () => {
      expect(formatNumberCompact(0)).toBe("0");
    });
    it("-0 collapses to '0' (sign computed from value < 0, which is false for -0)", () => {
      expect(formatNumberCompact(-0)).toBe("0");
    });
    it("999 -> '999'", () => {
      expect(formatNumberCompact(999)).toBe("999");
    });
    it("999.4 -> '999' (formatNumber >=100 Math.round)", () => {
      expect(formatNumberCompact(999.4)).toBe("999");
    });
    it("999.5 rounds to a SUFFIX-LESS '1000' (LOCKED quirk: still < 1e3, no 'k')", () => {
      // absValue 999.5 < 1e3 so the 'k' band is never entered; formatNumber
      // Math.rounds 999.5 -> 1000 -> '1000'. The reader sees '1000', not '1k'.
      expect(formatNumberCompact(999.5)).toBe("1000");
    });
    it("999.95 -> suffix-less '1000' (the suspected k-band boundary; pinned as no-suffix)", () => {
      expect(formatNumberCompact(999.95)).toBe("1000");
    });
    it("-999.95 -> '-1000' (sign prefix + suffix-less)", () => {
      expect(formatNumberCompact(-999.95)).toBe("-1000");
    });
  });

  describe("'k' band: 1e3 <= absValue < 1e6", () => {
    it("exact 1e3 boundary enters the 'k' band -> '1k'", () => {
      expect(formatNumberCompact(1e3)).toBe("1k");
    });
    it("1000 -> '1k'", () => {
      expect(formatNumberCompact(1000)).toBe("1k");
    });
    it("1200 -> '1.2k'", () => {
      expect(formatNumberCompact(1200)).toBe("1.2k");
    });
    it("1234 -> '1.2k' (formatNumber 1dp band)", () => {
      expect(formatNumberCompact(1234)).toBe("1.2k");
    });
    it("12345 -> '12.3k'", () => {
      expect(formatNumberCompact(12345)).toBe("12.3k");
    });
    it("999999 compacts to '1000k' instead of rolling to '1M' (LOCKED roll-over quirk)", () => {
      // 999999 < 1e6 so the 'k' band is chosen; 999999/1e3 = 999.999 ->
      // formatNumber Math.round -> 1000 -> '1000k'. A true compact formatter
      // would emit '1M'; this is a known display rough edge, pinned + tracked.
      expect(formatNumberCompact(999999)).toBe("1000k");
    });
    it("999500 -> '1000k' (same roll-over edge)", () => {
      expect(formatNumberCompact(999500)).toBe("1000k");
    });
  });

  describe("'M' band: 1e6 <= absValue < 1e9", () => {
    it("exact 1e6 boundary -> '1M'", () => {
      expect(formatNumberCompact(1e6)).toBe("1M");
    });
    it("1500000 -> '1.5M'", () => {
      expect(formatNumberCompact(1500000)).toBe("1.5M");
    });
  });

  describe("'B' band: absValue >= 1e9", () => {
    it("exact 1e9 boundary -> '1B'", () => {
      expect(formatNumberCompact(1e9)).toBe("1B");
    });
    it("-1e9 -> '-1B' (sign handling for the largest band)", () => {
      expect(formatNumberCompact(-1e9)).toBe("-1B");
    });
    it("1234567890 -> '1.2B'", () => {
      expect(formatNumberCompact(1234567890)).toBe("1.2B");
    });
  });

  describe("sign handling across bands", () => {
    it("-1200 -> '-1.2k'", () => {
      expect(formatNumberCompact(-1200)).toBe("-1.2k");
    });
    it("negative mirrors positive magnitude with a single leading '-'", () => {
      for (const mag of [1500, 25000, 3_400_000, 7_800_000_000]) {
        const pos = formatNumberCompact(mag);
        const neg = formatNumberCompact(-mag);
        expect(neg).toBe("-" + pos);
      }
    });
  });

  describe("property invariants", () => {
    function makeRng(seed: number): () => number {
      let s = seed >>> 0;
      return () => {
        s = (s * 1664525 + 1013904223) >>> 0;
        return s / 0xffffffff;
      };
    }

    it("compact output always ends in a valid suffix-or-digit and stays parseable up to the suffix", () => {
      const rng = makeRng(11111);
      for (let i = 0; i < 3000; i++) {
        const sign = rng() < 0.5 ? -1 : 1;
        const mag = rng() * 5e9;
        const x = sign * mag;
        const out = formatNumberCompact(x);
        const last = out[out.length - 1];
        const isSuffixed = last === "k" || last === "M" || last === "B";
        const numericPart = isSuffixed ? out.slice(0, -1) : out;
        expect(Number.isFinite(parseFloat(numericPart))).toBe(true);
      }
    });

    it("at most one leading sign and never a doubled sign", () => {
      const rng = makeRng(22222);
      for (let i = 0; i < 3000; i++) {
        const x = (rng() < 0.5 ? -1 : 1) * rng() * 5e9;
        const out = formatNumberCompact(x);
        expect(out.startsWith("--")).toBe(false);
        // sign only ever at index 0
        expect(out.indexOf("-")).toBeLessThanOrEqual(0);
      }
    });
  });
});
