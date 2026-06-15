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
// IMPORTANT — CHARACTERIZATION, NOT CORRECTION. Probing the real runtime
// surfaced FOUR genuine defects. We do NOT blind-fix them (per AGENTS.md
// autonomous-mode quality bar): we LOCK current behavior so any future fix is
// a conscious, reviewed change, and file FIX follow-up beads. Each defective
// assertion is tagged DEFECT with the follow-up bead id.
//
//   D1 (Notidian-djt follow-up: HUE)   hexToHsl mis-computes hue for the
//       green-max and blue-max branches: lines 28-32 reuse (green - blue) in
//       all three branches instead of (blue - red) for green-max and
//       (red - green) for blue-max. Consequence: pure green -> h=180 (should
//       be 120), pure blue -> h=180 (should be 240), cyan -> h=120 (should be
//       180). Red/yellow/magenta land in the red-max branch and stay correct.
//
//   D2 (follow-up: NaN GUARD)  hexToHsl does NOT validate input the way
//       hexToRgb's regex does — it slice+parseInt's blindly, so non-hex input
//       yields NaN for s and l (h falls back to 0 because delta===0).
//
//   D3 (follow-up: '#' DEPENDENCE)  hexToHsl slices from index 1 assuming a
//       leading '#'. A valid-but-unprefixed 6-digit string ("ff0000") is
//       mis-parsed (drops the first nibble) instead of being read like
//       hexToRgb reads it (which accepts an optional '#').
//
//   D4 (follow-up: ZERO-PAD)  hslToHex (line 75) builds
//       '#' + r.toString(16) + g.toString(16) + b.toString(16) WITHOUT
//       zero-padding each channel to 2 chars, so any channel < 16 (0x10)
//       produces a malformed hex shorter than 7 chars (e.g. '#1900', '#0ffff').
//       shiftColor round-trips hexToHsl -> hslToHex and inherits D2/D4.
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

    // The red-max branch is the only hue path that is computed correctly, so
    // yellow and magenta (which also fall in max===red) match real HSL.
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

    it("DEFECT D1 (hue): green-max & blue-max branches use the wrong channel diff", () => {
      // CORRECT HSL would give green->120, blue->240, cyan->180. The
      // implementation reuses (green - blue) in every branch, so:
      expect(hexToHsl("#00ff00").h).toBe(180); // WRONG (correct: 120)
      expect(hexToHsl("#0000ff").h).toBe(180); // WRONG (correct: 240)
      expect(hexToHsl("#00ffff").h).toBe(120); // WRONG (correct: 180)
      // Documented so the fix (Notidian-djt follow-up FIX bead) is deliberate.
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

  describe("malformed input — NO validation (DEFECT D2/D3)", () => {
    it("DEFECT D2 (NaN guard): non-hex input yields NaN saturation/luminance", () => {
      const hsl = hexToHsl("garbage");
      expect(hsl.h).toBe(0); // delta===0 path -> hue stays 0
      expect(Number.isNaN(hsl.s)).toBe(true);
      expect(Number.isNaN(hsl.l)).toBe(true);
    });

    it("DEFECT D2: empty string yields NaN s/l", () => {
      const hsl = hexToHsl("");
      expect(Number.isNaN(hsl.s)).toBe(true);
      expect(Number.isNaN(hsl.l)).toBe(true);
    });

    it("DEFECT D3 ('#' dependence): unprefixed valid hex is MIS-parsed", () => {
      // hexToRgb("ff0000") reads red, but hexToHsl slices from index 1 (assumes
      // a leading '#'), so it reads "f00000"-ish nibbles and produces a
      // different, wrong color than the same string through hexToRgb.
      const viaRgb = hexToRgb("ff0000"); // {255,0,0} -> would be h:0,s:1,l:0.5
      expect(viaRgb).toEqual({ r: 255, g: 0, b: 0 });
      const hsl = hexToHsl("ff0000");
      // It does NOT round-trip to red's HSL; l is ~0.47 (parsed "f0","00","00").
      expect(hsl.l).not.toBeCloseTo(0.5, 5);
      expect(hsl.l).toBeCloseTo(0xf0 / 255 / 2, 9);
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

  describe("DEFECT D4 (zero-pad): hslToHex omits per-channel zero padding", () => {
    it("a channel < 16 yields a malformed hex shorter than 7 chars", () => {
      // Darkening pure red drops g/b channels (already 0) and shrinks r below
      // 0x10, so toString(16) emits single nibbles -> "#1900" not "#190000".
      const out = shiftColor("#ff0000", 0, -0.45);
      expect(out).toBe("#1900");
      expect(out.length).toBeLessThan(7);
    });

    it("the green round-trip is also malformed (5 chars)", () => {
      // hexToHsl's hue bug routes green oddly, but the OUTPUT length defect is
      // what we lock here: round-tripping green yields a 5-char string.
      const out = shiftColor("#00ff00", 0, 0);
      expect(out).toBe("#0ffff");
      expect(out.length).toBe(6); // '#' + 5 nibbles
    });

    it("when all channels happen to be >= 16 the output IS well-formed (7 chars)", () => {
      // Gray near 0.5 keeps every channel two-nibble, so the bug is INVISIBLE
      // here — which is exactly why it survived: it only bites near the edges.
      const out = shiftColor("#808080", 0, 0);
      expect(out).toMatch(/^#[0-9a-f]{6}$/);
      expect(out.length).toBe(7);
    });
  });

  describe("malformed input round-trips to a NaN hex (DEFECT D2 -> D4)", () => {
    it("garbage in -> '#NaNNaNNaN' (NaN.toString(16))", () => {
      // hexToHsl emits NaN s/l (D2); hslToHex's Math.round(NaN) -> NaN, and
      // NaN.toString(16) -> "NaN", so the whole pipeline degrades to a literal
      // "#NaNNaNNaN" rather than throwing. Locked as the current contract.
      expect(shiftColor("garbage", 0, 0)).toBe("#NaNNaNNaN");
      expect(shiftColor("", 0, 0)).toBe("#NaNNaNNaN");
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
