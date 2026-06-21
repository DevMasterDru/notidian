import { parseGradient, stringifyGradient, Gradient } from "./gradient";

// ---------------------------------------------------------------------------
// CHARACTERIZATION + FIX tests for src/core/utils/color/gradient.ts
// (Notidian-c2pa). This pure CSS-gradient parser/serializer powers the live
// colorPickerMenu gradient editor (select-option / status colors). It parses
// USER-AUTHORED CSS strings, so correctness is offline-verifiable with no
// DOM / vault / I/O.
//
// Two genuine defects were surfaced and FIXED; the assertions below pin the
// CORRECT post-fix behavior. Each formerly-defective assertion is tagged
// DEFECT (FIXED).
//
//   D1 (parseGradient: redistribute-evenly clobber). The old code ran a
//       "distribute evenly" heuristic whenever EVERY stop's position equalled
//       0 or 100 — but it could not tell a SYNTHESIZED default position from a
//       position the author actually typed. So a 3-stop gradient whose authored
//       positions happen to all be 0%/100% (e.g. a hard color stop:
//       `red 0%, green 100%, blue 100%`) had its intentional positions
//       overwritten to 0/50/100, corrupting the gradient. The fix tracks
//       whether each stop's position was synthesized vs parsed and only
//       redistributes when ALL positions were synthesized (none authored).
//
//   D2 (stringifyGradient: caller-array mutation). The old code sorted
//       `gradient.values` IN PLACE, reordering the caller's array as a side
//       effect (the live editor shares that array with React state via a
//       shallow `{...gradient}` spread, so the in-place sort mutated state).
//       The fix copies before sorting; stringifyGradient is now pure.
// ---------------------------------------------------------------------------

describe("parseGradient", () => {
  it("parses authored percentage stops verbatim (two distinct mid stops)", () => {
    const g = parseGradient("linear-gradient(90deg, red 0%, green 40%, blue 100%)")!;
    expect(g).not.toBeNull();
    expect(g.type).toBe("linear");
    expect(g.direction).toBe("90deg");
    expect(g.values.map((v) => ({ color: v.color, position: v.position }))).toEqual([
      { color: "red", position: 0 },
      { color: "green", position: 40 },
      { color: "blue", position: 100 },
    ]);
  });

  it("DEFECT (FIXED): does NOT clobber a 3-stop gradient whose authored positions are all 0%/100% (hard color stop)", () => {
    // `green 100%, blue 100%` is an intentional hard transition. The buggy
    // redistribute heuristic rewrote these to 0 / 50 / 100, destroying the
    // hard stop. The fix preserves the authored positions exactly.
    const g = parseGradient("linear-gradient(red 0%, green 100%, blue 100%)")!;
    expect(g.values.map((v) => v.position)).toEqual([0, 100, 100]);
    expect(g.values.map((v) => v.color)).toEqual(["red", "green", "blue"]);
  });

  it("DEFECT (FIXED): preserves a two-stop hard stop authored as 0% and 0%", () => {
    const g = parseGradient("linear-gradient(red 0%, blue 0%)")!;
    expect(g.values.map((v) => v.position)).toEqual([0, 0]);
    expect(g.values.map((v) => v.color)).toEqual(["red", "blue"]);
  });

  it("DEFECT (FIXED): preserves authored 0%/100% endpoints in a 2-stop gradient", () => {
    const g = parseGradient("linear-gradient(red 0%, blue 100%)")!;
    expect(g.values.map((v) => v.position)).toEqual([0, 100]);
  });

  it("still distributes evenly when NO positions are authored (all synthesized)", () => {
    // Three bare colors, zero authored positions -> spread 0 / 50 / 100.
    const g = parseGradient("linear-gradient(red, green, blue)")!;
    expect(g.values.map((v) => v.position)).toEqual([0, 50, 100]);
    expect(g.values.map((v) => v.color)).toEqual(["red", "green", "blue"]);
  });

  it("distributes four bare colors evenly when none are authored", () => {
    const g = parseGradient("linear-gradient(red, green, blue, yellow)")!;
    // Mirror the implementation's exact formula to avoid float-precision noise.
    expect(g.values.map((v) => v.position)).toEqual([
      (0 / 3) * 100,
      (1 / 3) * 100,
      (2 / 3) * 100,
      (3 / 3) * 100,
    ]);
  });

  it("does NOT redistribute a mix of authored and bare stops", () => {
    // First stop authored at 0%, others synthesized to 100. Because at least
    // one position was authored, the redistribute heuristic must NOT fire even
    // though every resulting position is 0 or 100.
    const g = parseGradient("linear-gradient(red 0%, green, blue)")!;
    expect(g.values.map((v) => v.position)).toEqual([0, 100, 100]);
  });

  it("sorts the returned stops by position", () => {
    const g = parseGradient("linear-gradient(blue 80%, red 10%, green 50%)")!;
    expect(g.values.map((v) => v.position)).toEqual([10, 50, 80]);
    expect(g.values.map((v) => v.color)).toEqual(["red", "green", "blue"]);
  });

  it("returns null for non-gradient input", () => {
    expect(parseGradient("")).toBeNull();
    expect(parseGradient("#ff0000")).toBeNull();
    expect(parseGradient(null as unknown as string)).toBeNull();
  });

  it("parses rgba() colors without splitting on their inner commas", () => {
    const g = parseGradient("linear-gradient(90deg, rgba(255, 0, 0, 0.5) 0%, blue 100%)")!;
    expect(g.values.map((v) => v.color)).toEqual(["rgba(255, 0, 0, 0.5)", "blue"]);
    expect(g.values.map((v) => v.position)).toEqual([0, 100]);
  });

  it("supplies two default stops when only one usable stop is present", () => {
    const g = parseGradient("linear-gradient(red 30%)")!;
    expect(g.values.length).toBe(2);
    expect(g.values[0]).toEqual({ color: "red", position: 30 });
    expect(g.values[1]).toEqual({ color: "#ffffff", position: 100 });
  });
});

describe("stringifyGradient", () => {
  it("DEFECT (FIXED): does NOT mutate the caller's values array (pure)", () => {
    const gradient: Gradient = {
      type: "linear",
      direction: "90deg",
      values: [
        { color: "blue", position: 80 },
        { color: "red", position: 10 },
        { color: "green", position: 50 },
      ],
    };
    const valuesRef = gradient.values;
    const snapshot = gradient.values.map((v) => ({ ...v }));

    stringifyGradient(gradient);

    // Same array reference, same order, same contents — no side effects.
    expect(gradient.values).toBe(valuesRef);
    expect(gradient.values).toEqual(snapshot);
  });

  it("serializes stops in ascending position order regardless of input order", () => {
    const out = stringifyGradient({
      type: "linear",
      direction: "90deg",
      values: [
        { color: "blue", position: 80 },
        { color: "red", position: 10 },
      ],
    });
    expect(out).toBe("linear-gradient(90deg, red 10%, blue 80%)");
  });

  it("round-trips an authored hard-stop gradient (no clobber, no mutation)", () => {
    const input = "linear-gradient(red 0%, green 100%, blue 100%)";
    const parsed = parseGradient(input)!;
    const valuesRef = parsed.values;
    const out = stringifyGradient(parsed);
    expect(out).toBe("linear-gradient(90deg, red 0%, green 100%, blue 100%)");
    // stringify did not reorder/mutate the parsed array.
    expect(parsed.values).toBe(valuesRef);
    expect(parsed.values.map((v) => v.position)).toEqual([0, 100, 100]);
  });

  it("duplicates a single stop so a one-stop gradient still serializes two stops", () => {
    const out = stringifyGradient({
      type: "linear",
      direction: "90deg",
      values: [{ color: "red", position: 50 }],
    });
    expect(out).toBe("linear-gradient(90deg, red 50%, red 50%)");
  });

  it("returns '' for an empty gradient", () => {
    expect(
      stringifyGradient({ type: "linear", direction: "90deg", values: [] })
    ).toBe("");
  });
});
