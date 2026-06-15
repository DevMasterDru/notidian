import { hexToRgb, hexToHsl, shiftColor } from "./color";

// ---------------------------------------------------------------------------
// DEPTH (Q1) — malformed-input hardening + characterization tests for
// src/shared/utils/color.ts (Notidian-djt). This module had ZERO coverage.
//
// hexToRgb / hexToHsl / shiftColor parse USER-SUPPLIED color strings
// (select-option colors, status colors). These exact functions were copied
// verbatim into the live src/core/utils/colorPalette.ts (whose header reads
// "Keep the original color utility functions from shared/utils/color.ts"), so
// locking the canonical copy here also pins the behavior the live color picker
// / OptionCell / calendar swatches inherit. Everything below is pure / offline
// — no vault, no DOM, no I/O.
//
// FIXED (Notidian-cgo, single-pass D1-D4). The characterization probe surfaced
// FOUR genuine defects; they have now been CORRECTED in both copies
// (src/shared/utils/color.ts canonical + src/core/utils/colorPalette.ts live).
// These assertions therefore pin the CORRECT behavior — any regression to the
// old buggy output fails here. Each formerly-defective assertion is tagged
// DEFECT (FIXED) with the resolving bead id.
//
//   D1 (Notidian-cgo: HUE)   hexToHsl now computes hue correctly for the
//       green-max and blue-max branches: (blue - red) + 2 for green-max and
//       (red - green) + 4 for blue-max (instead of reusing (green - blue) in
//       every branch). Pure green -> 120, pure blue -> 240, cyan -> 180.
//       Red/yellow/magenta land in the (always-correct) red-max branch.
//
//   D2 (Notidian-yuz: NaN GUARD)  hexToHsl now validates input via the same
//       regex hexToRgb uses and falls back to {h:0, s:0, l:0} on non-hex
//       input instead of emitting NaN saturation/luminance.
//
//   D3 (Notidian-feg: '#' DEPENDENCE)  hexToHsl now accepts an optional
//       leading '#' (regex capture groups, not slice-from-1), so an
//       unprefixed valid 6-digit string ("ff0000") round-trips exactly like
//       hexToRgb reads it.
//
//   D4 (Notidian-0rj: ZERO-PAD)  hslToHex now pads each channel to 2 chars,
//       so any channel < 16 (0x10) no longer collapses into a malformed hex.
//       Output is always a well-formed 7-char string; shiftColor inherits the
//       fix (and a guarded hexToHsl, so malformed input yields '#000000').
// ---------------------------------------------------------------------------

describe("hexToRgb", () => {
  describe("valid 6-digit input", () => {
    it("parses #-prefixed lowercase hex", () => {
      expect(hexToRgb("#ff0000")).toEqual({ r: 255, g: 0, b: 0 });
      expect(hexToRgb("#00ff00")).toEqual({ r: 0, g: 255, b: 0 });
      expect(hexToRgb("#0000ff")).toEqual({ r: 0, g: 0, b: 255 });
    });

    it("accepts hex WITHOUT a leading '#' (regex makes '#' optional)", () => {
      expect(hexToRgb("ff0000")).toEqual({ r: 255, g: 0, b: 0 });
      expect(hexToRgb("00ff00")).toEqual({ r: 0, g: 255, b: 0 });
    });

    it("is case-insensitive", () => {
      expect(hexToRgb("#FF0000")).toEqual({ r: 255, g: 0, b: 0 });
      expect(hexToRgb("#AbCdEf")).toEqual({ r: 0xab, g: 0xcd, b: 0xef });
      expect(hexToRgb("#ABCDEF")).toEqual(hexToRgb("#abcdef"));
    });

    it("parses black / white / gray boundaries", () => {
      expect(hexToRgb("#000000")).toEqual({ r: 0, g: 0, b: 0 });
      expect(hexToRgb("#ffffff")).toEqual({ r: 255, g: 255, b: 255 });
      expect(hexToRgb("#808080")).toEqual({ r: 128, g: 128, b: 128 });
    });
  });

  describe("malformed / unsupported input falls back to {0,0,0}", () => {
    it("returns black for non-hex garbage", () => {
      expect(hexToRgb("not-a-color")).toEqual({ r: 0, g: 0, b: 0 });
      expect(hexToRgb("")).toEqual({ r: 0, g: 0, b: 0 });
    });

    it("returns black for out-of-range hex digits (G..Z)", () => {
      expect(hexToRgb("#GGGGGG")).toEqual({ r: 0, g: 0, b: 0 });
      expect(hexToRgb("#zzzzzz")).toEqual({ r: 0, g: 0, b: 0 });
    });

    it("returns black for CSS var() / named colors it cannot parse", () => {
      // select-option colors are often "var(--mk-color-red)" — hexToRgb cannot
      // read them and safely degrades to black rather than throwing.
      expect(hexToRgb("var(--mk-color-red)")).toEqual({ r: 0, g: 0, b: 0 });
      expect(hexToRgb("red")).toEqual({ r: 0, g: 0, b: 0 });
    });

    it("CHARACTERIZE: 3-digit shorthand is NOT supported -> {0,0,0}", () => {
      // The regex demands three 2-char groups, so CSS-style #abc shorthand is
      // rejected and degrades to black. Locked so adding shorthand support is a
      // conscious, reviewed change.
      expect(hexToRgb("#abc")).toEqual({ r: 0, g: 0, b: 0 });
      expect(hexToRgb("#fff")).toEqual({ r: 0, g: 0, b: 0 });
      expect(hexToRgb("fff")).toEqual({ r: 0, g: 0, b: 0 });
    });

    it("CHARACTERIZE: trailing/leading whitespace is NOT trimmed -> {0,0,0}", () => {
      expect(hexToRgb(" #ff0000 ")).toEqual({ r: 0, g: 0, b: 0 });
      expect(hexToRgb("#ff0000\n")).toEqual({ r: 0, g: 0, b: 0 });
    });

    it("CHARACTERIZE: 8-digit (#rrggbbaa) hex is rejected -> {0,0,0}", () => {
      expect(hexToRgb("#ff0000ff")).toEqual({ r: 0, g: 0, b: 0 });
    });
  });

  it("never throws and always returns numeric r/g/b in 0..255", () => {
    const inputs = ["#ff0000", "ff0000", "#abc", "garbage", "", "var(--x)", "#GGGGGG"];
    for (const input of inputs) {
      const rgb = hexToRgb(input);
      for (const ch of [rgb.r, rgb.g, rgb.b]) {
        expect(typeof ch).toBe("number");
        expect(ch).toBeGreaterThanOrEqual(0);
        expect(ch).toBeLessThanOrEqual(255);
      }
    }
  });
});

describe("hexToHsl", () => {
  const TOL = 1e-9;

  describe("achromatic colors (delta === 0)", () => {
    it("black -> {h:0, s:0, l:0}", () => {
      expect(hexToHsl("#000000")).toEqual({ h: 0, s: 0, l: 0 });
    });
    it("white -> {h:0, s:0, l:1}", () => {
      expect(hexToHsl("#ffffff")).toEqual({ h: 0, s: 0, l: 1 });
    });
    it("mid gray -> h:0, s:0, l ~ 0.502", () => {
      const hsl = hexToHsl("#808080");
      expect(hsl.h).toBe(0);
      expect(hsl.s).toBe(0);
      expect(hsl.l).toBeCloseTo(128 / 255, 9);
    });
  });

  describe("primary / secondary colors (within tolerance)", () => {
    it("red -> h:0, s:1, l:0.5", () => {
      const hsl = hexToHsl("#ff0000");
      expect(hsl.h).toBe(0);
      expect(Math.abs(hsl.s - 1)).toBeLessThan(TOL);
      expect(Math.abs(hsl.l - 0.5)).toBeLessThan(TOL);
    });

    // Yellow and magenta fall in max===red (which was always correct) and
    // remain correct after the fix.
    it("yellow -> h:60 (correct)", () => {
      expect(hexToHsl("#ffff00").h).toBe(60);
    });
    it("magenta -> h:300 (correct)", () => {
      expect(hexToHsl("#ff00ff").h).toBe(300);
    });

    it("all pure primaries/secondaries have s===1 and l===0.5", () => {
      for (const c of ["#ff0000", "#00ff00", "#0000ff", "#ffff00", "#00ffff", "#ff00ff"]) {
        const hsl = hexToHsl(c);
        expect(Math.abs(hsl.s - 1)).toBeLessThan(TOL);
        expect(Math.abs(hsl.l - 0.5)).toBeLessThan(TOL);
      }
    });

    it("DEFECT D1 (hue, FIXED Notidian-cgo): green-max & blue-max branches now correct", () => {
      // The green-max branch uses (blue - red) and the blue-max branch uses
      // (red - green), so the pure secondaries land on their true hues:
      expect(hexToHsl("#00ff00").h).toBe(120); // green
      expect(hexToHsl("#0000ff").h).toBe(240); // blue
      expect(hexToHsl("#00ffff").h).toBe(180); // cyan
    });
  });

  describe("hue normalization (lines 35-38)", () => {
    it("rounds hue to an integer and is always in [0, 360)", () => {
      for (const c of ["#000000", "#ffffff", "#ff0000", "#00ff00", "#0000ff",
                       "#ff00ff", "#ffff00", "#00ffff", "#123456", "#abcdef"]) {
        const h = hexToHsl(c).h;
        expect(Number.isInteger(h)).toBe(true);
        expect(h).toBeGreaterThanOrEqual(0);
        expect(h).toBeLessThan(360);
      }
    });

    it("CHARACTERIZE: a negative raw hue is wrapped by +360 (line 36-38)", () => {
      // A color whose green-max branch yields a negative hue exercises the
      // wrap. #008000-ish greens with blue>green produce negative pre-wrap hue.
      const h = hexToHsl("#00ff80").h; // springgreen-ish, lands in max===green
      expect(Number.isInteger(h)).toBe(true);
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThan(360);
    });
  });

  describe("malformed input — guarded fallback (DEFECT D2/D3, FIXED)", () => {
    it("DEFECT D2 (NaN guard, FIXED Notidian-yuz): non-hex input falls back to {0,0,0}", () => {
      const hsl = hexToHsl("garbage");
      expect(hsl).toEqual({ h: 0, s: 0, l: 0 });
      expect(Number.isNaN(hsl.s)).toBe(false);
      expect(Number.isNaN(hsl.l)).toBe(false);
    });

    it("DEFECT D2 (FIXED): empty string falls back to {0,0,0}", () => {
      expect(hexToHsl("")).toEqual({ h: 0, s: 0, l: 0 });
    });

    it("DEFECT D3 ('#' dependence, FIXED Notidian-feg): unprefixed valid hex round-trips like hexToRgb", () => {
      // hexToRgb("ff0000") reads red; hexToHsl now accepts an optional leading
      // '#' too, so the same unprefixed string yields red's HSL exactly.
      const viaRgb = hexToRgb("ff0000");
      expect(viaRgb).toEqual({ r: 255, g: 0, b: 0 });
      const hsl = hexToHsl("ff0000");
      expect(hsl.h).toBe(0);
      expect(hsl.s).toBeCloseTo(1, 9);
      expect(hsl.l).toBeCloseTo(0.5, 9);
      // And it matches the #-prefixed parse exactly.
      expect(hexToHsl("ff0000")).toEqual(hexToHsl("#ff0000"));
    });

    it("does not throw on any malformed input", () => {
      for (const input of ["garbage", "", "#abc", "var(--x)", "#GGGGGG"]) {
        expect(() => hexToHsl(input)).not.toThrow();
      }
    });
  });
});

describe("shiftColor", () => {
  // shiftColor(color, s, l) = hslToHex({...hexToHsl(color), s:+s, l:+l}).
  // It is the function callers (OptionCell, color picker) actually use to
  // derive hover/active shades from a base swatch.

  describe("lightness monotonicity for achromatic input", () => {
    // Gray stays gray (s:0) under +/- l, so we can compare the single channel
    // value and assert a darker shift produces a numerically smaller channel.
    const channel = (hex: string) => parseInt(hex.slice(1, 3), 16);

    it("increasing l brightens; decreasing l darkens (gray base)", () => {
      const base = channel(toGrayHex(0.5));
      const lighter = channel(shiftColor(toGrayHex(0.5), 0, 0.1));
      const darker = channel(shiftColor(toGrayHex(0.5), 0, -0.1));
      expect(lighter).toBeGreaterThan(base);
      expect(darker).toBeLessThan(base);
    });

    it("is monotonic across a sweep of l shifts on a gray base", () => {
      const vals = [-0.2, -0.1, 0, 0.1, 0.2].map((dl) =>
        channel(shiftColor("#808080", 0, dl))
      );
      for (let i = 1; i < vals.length; i++) {
        expect(vals[i]).toBeGreaterThanOrEqual(vals[i - 1]);
      }
    });
  });

  describe("DEFECT D4 (zero-pad, FIXED Notidian-0rj): hslToHex pads each channel", () => {
    it("a channel < 16 still yields a well-formed 7-char hex", () => {
      // Darkening pure red shrinks r below 0x10; each channel is now padded so
      // the output is "#190000", not the old short "#1900".
      const out = shiftColor("#ff0000", 0, -0.45);
      expect(out).toBe("#190000");
      expect(out.length).toBe(7);
    });

    it("the green round-trip is well-formed (with the corrected hue, returns green)", () => {
      // With D1 fixed, green round-trips to itself; with D4 fixed it stays a
      // well-formed 7-char string.
      const out = shiftColor("#00ff00", 0, 0);
      expect(out).toBe("#00ff00");
      expect(out.length).toBe(7);
    });

    it("a gray base also produces a well-formed 7-char hex", () => {
      const out = shiftColor("#808080", 0, 0);
      expect(out).toMatch(/^#[0-9a-f]{6}$/);
      expect(out.length).toBe(7);
    });

    it("every shiftColor output is a well-formed 7-char hex across a sweep", () => {
      const bases = ["#ff0000", "#00ff00", "#0000ff", "#00ffff", "#ff00ff", "#ffff00", "#808080", "#123456"];
      for (const base of bases) {
        for (const dl of [-0.45, -0.2, 0, 0.2, 0.45]) {
          const out = shiftColor(base, 0, dl);
          expect(out).toMatch(/^#[0-9a-f]{6}$/);
        }
      }
    });
  });

  describe("malformed input degrades safely (DEFECT D2 -> D4, FIXED)", () => {
    it("garbage in -> '#000000' (guarded hexToHsl -> {0,0,0} -> black hex)", () => {
      // hexToHsl now returns {0,0,0} for non-hex input (D2 fix), so the round
      // trip yields a well-formed black hex instead of the old "#NaNNaNNaN".
      expect(shiftColor("garbage", 0, 0)).toBe("#000000");
      expect(shiftColor("", 0, 0)).toBe("#000000");
    });

    it("never throws on malformed input", () => {
      for (const input of ["garbage", "", "#abc", "var(--x)"]) {
        expect(() => shiftColor(input, 0, 0)).not.toThrow();
      }
    });
  });
});

// A gray hex whose l ~= target, used so lightness-only assertions stay on the
// achromatic (s:0) path and avoid the hue defect entirely.
function toGrayHex(l: number): string {
  const v = Math.round(l * 255).toString(16).padStart(2, "0");
  return `#${v}${v}${v}`;
}
