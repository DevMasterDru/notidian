import { parseGradient } from "./gradient";

// ---------------------------------------------------------------------------
// DEPTH characterization tests for src/core/utils/color/gradient.ts
// parseGradient — the PARSER-ROBUSTNESS edge surfaces (Notidian-8my9).
//
// This is a deliberate COMPANION to gradient.test.ts (Notidian-c2pa). That
// sibling file pins two FIXED defects (the redistribute-evenly clobber and the
// stringifyGradient in-place mutation) and a few smoke cases; keeping its
// regression locks readable was the reason this characterization lives in a
// separate file rather than being folded in.
//
// Scope here = the OTHER parse-path edges, none of which the sibling pins:
//   1. nested-paren-aware comma split  (parenDepth tracking keeps rgba()/
//      hsl()/hsla()/rgb()/color-mix()/var() color args intact even though they
//      contain their own commas — including paren colors carrying a percent,
//      and arbitrarily NESTED parens like color-mix(in srgb, red, blue)).
//   2. gradient-type detection ORDERING (repeating-linear / repeating-radial
//      are listed BEFORE linear / radial so a "repeating-*-gradient" string is
//      never mis-typed as the plain variant); conic is also recognized.
//   3. direction detection via isDirectionPart (deg / "to " / "at " / the
//      ^-?\d+deg$ regex / named to-directions) — and crucially the cases where
//      a leading token is a COLOR, not a direction.
//   4. malformed input -> null (non-string, no gradient type, unbalanced /
//      empty parens with start>=end, empty / whitespace-only content).
//   5. single-stop fallback appends #ffffff@100.
//   6. zero-usable-stop fallback appends black@0 + white@100.
//   7. NaN-percent guard (documented as currently unreachable via the regex).
//   8. final, STABLE position sort.
//
// parseGradient is pure string-in / object-out with no DOM / vault / I/O, so
// every assertion below is offline-verifiable. The assertions pin the parser's
// ACTUAL behavior as observed today (characterization), including a couple of
// genuine quirks that are called out inline.
// ---------------------------------------------------------------------------

const positions = (input: string) =>
  parseGradient(input)!.values.map((v) => v.position);
const colors = (input: string) =>
  parseGradient(input)!.values.map((v) => v.color);

describe("parseGradient — nested-paren-aware comma split (parenDepth)", () => {
  it("keeps an rgba() color's inner commas intact (single nested paren)", () => {
    const g = parseGradient("linear-gradient(90deg, rgba(0, 0, 0, .5) 0%, blue 100%)")!;
    expect(g.values.map((v) => v.color)).toEqual(["rgba(0, 0, 0, .5)", "blue"]);
    expect(g.values.map((v) => v.position)).toEqual([0, 100]);
  });

  it("keeps an hsl() color intact", () => {
    const g = parseGradient("linear-gradient(90deg, hsl(120, 50%, 50%) 0%, blue 100%)")!;
    expect(g.values.map((v) => v.color)).toEqual(["hsl(120, 50%, 50%)", "blue"]);
    expect(g.values.map((v) => v.position)).toEqual([0, 100]);
  });

  it("keeps TWO hsla() colors intact across the split", () => {
    const g = parseGradient(
      "linear-gradient(hsla(120, 50%, 50%, 0.3) 0%, hsla(0, 0%, 0%, 0.5) 100%)"
    )!;
    expect(g.values.map((v) => v.color)).toEqual([
      "hsla(120, 50%, 50%, 0.3)",
      "hsla(0, 0%, 0%, 0.5)",
    ]);
    expect(g.values.map((v) => v.position)).toEqual([0, 100]);
  });

  it("keeps several rgb() colors intact when none carry a percent (then distributes)", () => {
    const g = parseGradient(
      "linear-gradient(rgb(1, 1, 1), rgb(2, 2, 2), rgb(3, 3, 3))"
    )!;
    expect(g.values.map((v) => v.color)).toEqual([
      "rgb(1, 1, 1)",
      "rgb(2, 2, 2)",
      "rgb(3, 3, 3)",
    ]);
    // all positions synthesized -> even distribution.
    expect(g.values.map((v) => v.position)).toEqual([0, 50, 100]);
  });

  it("keeps a paren color intact even when it carries its own percent", () => {
    const g = parseGradient("linear-gradient(rgba(0,0,0,.5) 25%, blue 75%)")!;
    expect(g.values.map((v) => v.color)).toEqual(["rgba(0,0,0,.5)", "blue"]);
    expect(g.values.map((v) => v.position)).toEqual([25, 75]);
  });

  it("handles ARBITRARILY-NESTED parens (color-mix has an inner comma list)", () => {
    // parenDepth must climb to 1 at color-mix(, return to 0 only at its close,
    // so the inner ", " separators do not split the stop.
    const g = parseGradient(
      "linear-gradient(color-mix(in srgb, red, blue) 0%, green 100%)"
    )!;
    expect(g.values.map((v) => v.color)).toEqual([
      "color-mix(in srgb, red, blue)",
      "green",
    ]);
    expect(g.values.map((v) => v.position)).toEqual([0, 100]);
  });

  it("keeps a var() color token intact", () => {
    const g = parseGradient("linear-gradient(var(--c) 0%, blue 100%)")!;
    expect(g.values.map((v) => v.color)).toEqual(["var(--c)", "blue"]);
  });
});

describe("parseGradient — gradient-type detection ordering", () => {
  it("types repeating-linear-gradient as 'repeating-linear', NOT 'linear'", () => {
    // The defining invariant: 'repeating-linear' precedes 'linear' in the
    // detection list, so the longer match wins and the type is not truncated.
    expect(parseGradient("repeating-linear-gradient(90deg, red, blue)")!.type).toBe(
      "repeating-linear"
    );
  });

  it("types repeating-radial-gradient as 'repeating-radial', NOT 'radial'", () => {
    expect(
      parseGradient("repeating-radial-gradient(red 0%, blue 100%)")!.type
    ).toBe("repeating-radial");
  });

  it("types plain linear/radial/conic correctly", () => {
    expect(parseGradient("linear-gradient(red, blue)")!.type).toBe("linear");
    expect(parseGradient("radial-gradient(red, blue)")!.type).toBe("radial");
    expect(parseGradient("conic-gradient(red, blue)")!.type).toBe("conic");
  });

  it("ignores any prefix before the recognized gradient token", () => {
    // includes()-based detection: a leading 'background: ' is harmless.
    expect(parseGradient("background: linear-gradient(red, blue)")!.type).toBe(
      "linear"
    );
  });

  it("is case-sensitive: an uppercased type is not recognized -> null", () => {
    expect(parseGradient("LINEAR-GRADIENT(red, blue)")).toBeNull();
  });
});

describe("parseGradient — direction detection (isDirectionPart)", () => {
  it("detects a bare angle 'Ndeg' as the direction", () => {
    const g = parseGradient("linear-gradient(45deg, red, blue)")!;
    expect(g.direction).toBe("45deg");
    expect(g.values.map((v) => v.color)).toEqual(["red", "blue"]);
  });

  it("detects a named 'to ' direction (to top right)", () => {
    const g = parseGradient("linear-gradient(to top right, red, blue)")!;
    expect(g.direction).toBe("to top right");
    expect(g.values.map((v) => v.color)).toEqual(["red", "blue"]);
  });

  it("detects an 'at ' radial direction (circle at center)", () => {
    const g = parseGradient("radial-gradient(circle at center, red, blue)")!;
    expect(g.direction).toBe("circle at center");
    expect(g.values.map((v) => v.color)).toEqual(["red", "blue"]);
  });

  it("detects a conic 'from ... at ...' direction", () => {
    const g = parseGradient("conic-gradient(from 45deg at center, red, blue)")!;
    expect(g.direction).toBe("from 45deg at center");
    expect(g.values.map((v) => v.color)).toEqual(["red", "blue"]);
  });

  it("defaults direction to '90deg' when the first part is a COLOR, not a direction", () => {
    const g = parseGradient("linear-gradient(red, green, blue)")!;
    expect(g.direction).toBe("90deg");
    expect(g.values.map((v) => v.color)).toEqual(["red", "green", "blue"]);
  });

  it("does NOT mistake a leading authored color stop ('red 0%') for a direction", () => {
    const g = parseGradient("linear-gradient(red 0%, blue 100%)")!;
    expect(g.direction).toBe("90deg");
    expect(g.values.map((v) => v.color)).toEqual(["red", "blue"]);
  });

  it("does NOT mistake a color whose NAME lacks the 'to ' space ('tomato') for a direction", () => {
    // 'to ' requires a trailing space; 'tomato' has none, so it stays a color.
    const g = parseGradient("linear-gradient(tomato, blue)")!;
    expect(g.direction).toBe("90deg");
    expect(g.values.map((v) => v.color)).toEqual(["tomato", "blue"]);
  });

  it("QUIRK: a leading shape keyword without 'at ' (circle/ellipse) is treated as a COLOR stop, not a direction", () => {
    // 'circle' contains none of deg / 'to ' / 'at ', so isDirectionPart is
    // false and it becomes the first color stop. This is a documented parser
    // limitation, pinned here so a future change to it is a conscious choice.
    const circle = parseGradient("radial-gradient(circle, red, blue)")!;
    expect(circle.direction).toBe("90deg");
    expect(circle.values.map((v) => v.color)).toEqual(["circle", "red", "blue"]);

    const ellipse = parseGradient("radial-gradient(ellipse, red, blue)")!;
    expect(ellipse.values.map((v) => v.color)).toEqual([
      "ellipse",
      "red",
      "blue",
    ]);
  });
});

describe("parseGradient — malformed input returns null", () => {
  it("returns null for non-string inputs (number / object / undefined / null)", () => {
    expect(parseGradient(42 as unknown as string)).toBeNull();
    expect(parseGradient({} as unknown as string)).toBeNull();
    expect(parseGradient(undefined as unknown as string)).toBeNull();
    expect(parseGradient(null as unknown as string)).toBeNull();
  });

  it("returns null for the empty string and whitespace-only strings", () => {
    expect(parseGradient("")).toBeNull();
    expect(parseGradient("   ")).toBeNull();
  });

  it("returns null when no recognized gradient type is present", () => {
    expect(parseGradient("#ff0000")).toBeNull();
    expect(parseGradient("foo(red, blue)")).toBeNull();
    expect(parseGradient("rgb(1,2,3)")).toBeNull();
  });

  it("returns null when the gradient token has no opening paren (no '(')", () => {
    // 'linear-gradient(' substring is required; bare 'linear-gradient' fails.
    expect(parseGradient("linear-gradient")).toBeNull();
  });

  it("returns null for empty parens () — content is empty", () => {
    expect(parseGradient("linear-gradient()")).toBeNull();
  });

  it("returns null for whitespace-only parens (   ) — content trims to empty", () => {
    expect(parseGradient("linear-gradient(   )")).toBeNull();
  });

  it("returns null for an unbalanced gradient missing its closing paren", () => {
    // lastIndexOf(')') === -1 -> end === -1 -> null.
    expect(parseGradient("linear-gradient(red, blue")).toBeNull();
  });
});

describe("parseGradient — fallback stop synthesis", () => {
  it("single-stop fallback: appends #ffffff@100 when only one usable stop exists", () => {
    const g = parseGradient("linear-gradient(red 30%)")!;
    expect(g.values).toEqual([
      { color: "red", position: 30 },
      { color: "#ffffff", position: 100 },
    ]);
  });

  it("single bare-color fallback also appends #ffffff@100", () => {
    const g = parseGradient("linear-gradient(red)")!;
    expect(g.values).toEqual([
      { color: "red", position: 0 },
      { color: "#ffffff", position: 100 },
    ]);
  });

  it("zero-stop fallback: a direction-only gradient yields black@0 + white@100", () => {
    // The single part is consumed as the direction, leaving zero color stops,
    // so the parser supplies the default black->white pair.
    const g = parseGradient("linear-gradient(90deg)")!;
    expect(g.values).toEqual([
      { color: "#000000", position: 0 },
      { color: "#ffffff", position: 100 },
    ]);
  });

  it("zero-stop fallback also fires for a named/radial direction-only gradient", () => {
    expect(parseGradient("linear-gradient(to right)")!.values).toEqual([
      { color: "#000000", position: 0 },
      { color: "#ffffff", position: 100 },
    ]);
    expect(parseGradient("radial-gradient(at center)")!.values).toEqual([
      { color: "#000000", position: 0 },
      { color: "#ffffff", position: 100 },
    ]);
  });
});

describe("parseGradient — empty / trailing parts are skipped", () => {
  it("ignores a trailing empty part after a trailing comma", () => {
    const g = parseGradient("linear-gradient(red 0%, blue 100%,)")!;
    expect(g.values.map((v) => v.color)).toEqual(["red", "blue"]);
    expect(g.values.map((v) => v.position)).toEqual([0, 100]);
  });

  it("ignores an empty part from a double comma", () => {
    const g = parseGradient("linear-gradient(red 0%,, blue 100%)")!;
    expect(g.values.map((v) => v.color)).toEqual(["red", "blue"]);
  });

  it("trims surrounding whitespace on each stop", () => {
    const g = parseGradient("linear-gradient(   red 0%  ,   blue 100%   )")!;
    expect(g.values.map((v) => v.color)).toEqual(["red", "blue"]);
    expect(g.values.map((v) => v.position)).toEqual([0, 100]);
  });
});

describe("parseGradient — percentage parsing", () => {
  it("parses fractional percentages", () => {
    expect(positions("linear-gradient(red 12.5%, blue 87.5%)")).toEqual([12.5, 87.5]);
  });

  it("accepts out-of-range percentages verbatim (no clamping)", () => {
    // The parser does not clamp; >100 / arbitrary values pass through.
    expect(positions("linear-gradient(red 150%, blue 200%)")).toEqual([150, 200]);
  });

  it("NaN-percent guard is unreachable via the regex (percent group is always numeric)", () => {
    // The stop regex captures the percent as \d+(?:\.\d+)? , so parseFloat can
    // never yield NaN from a regex MATCH; the `!isNaN(position)` guard is
    // purely defensive. A token with a non-numeric 'percent' (e.g. 'red x%')
    // simply fails the regex and falls through to the bare-color branch, where
    // it is treated as a (synthesized-position) color rather than rejected.
    const g = parseGradient("linear-gradient(red x%, blue 100%)")!;
    // 'red x%' does not match the "<color> <num>%" pattern, so the whole token
    // 'red x%' becomes a bare color at a synthesized position.
    expect(g.values.map((v) => v.color)).toEqual(["red x%", "blue"]);
    expect(g.values.every((v) => !Number.isNaN(v.position))).toBe(true);
  });
});

describe("parseGradient — final position sort is stable", () => {
  it("sorts stops ascending by position", () => {
    const g = parseGradient("linear-gradient(blue 80%, red 10%, green 50%)")!;
    expect(g.values.map((v) => v.position)).toEqual([10, 50, 80]);
    expect(g.values.map((v) => v.color)).toEqual(["red", "green", "blue"]);
  });

  it("preserves insertion order among stops that share a position (stable sort)", () => {
    // All three at 50% — a stable sort must keep authored order c1,c2,c3.
    const g = parseGradient("linear-gradient(c1 50%, c2 50%, c3 50%)")!;
    expect(g.values.map((v) => v.position)).toEqual([50, 50, 50]);
    expect(g.values.map((v) => v.color)).toEqual(["c1", "c2", "c3"]);
  });

  it("interleaves a synthesized fallback stop into the correct sorted slot", () => {
    // single authored stop at 30% + synthesized #ffffff@100 -> sorted 30,100.
    const out = parseGradient("linear-gradient(red 30%)")!;
    expect(out.values.map((v) => v.position)).toEqual([30, 100]);
    expect(colors("linear-gradient(red 30%)")).toEqual(["red", "#ffffff"]);
  });
});
