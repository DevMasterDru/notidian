import {
  lifecycleValuesFromColumnValue,
  stepLifecycleValue,
} from "core/utils/contexts/optionLifecycle";

const LIFECYCLE = JSON.stringify({
  options: [
    { value: "wishlist", name: "Wishlist" },
    { value: "evaluating", name: "Evaluating" },
    { value: "to-install", name: "To install" },
    { value: "using", name: "Using" },
    { value: "retired", name: "Retired" },
  ],
});
const STATES = [
  "wishlist",
  "evaluating",
  "to-install",
  "using",
  "retired",
];

describe("lifecycleValuesFromColumnValue", () => {
  it("parses option values in declared order", () => {
    expect(lifecycleValuesFromColumnValue(LIFECYCLE)).toEqual(STATES);
  });

  it("drops blanks/null and dedupes while preserving order", () => {
    const value = JSON.stringify({
      options: [
        { value: "a" },
        { value: "" },
        { value: null },
        { value: "b" },
        { value: "a" },
      ],
    });
    expect(lifecycleValuesFromColumnValue(value)).toEqual(["a", "b"]);
  });

  it("returns [] for missing/invalid config or no options", () => {
    expect(lifecycleValuesFromColumnValue("")).toEqual([]);
    expect(lifecycleValuesFromColumnValue(null)).toEqual([]);
    expect(lifecycleValuesFromColumnValue("not json")).toEqual([]);
    expect(lifecycleValuesFromColumnValue(JSON.stringify({}))).toEqual([]);
    expect(
      lifecycleValuesFromColumnValue(JSON.stringify({ options: "x" }))
    ).toEqual([]);
  });

  it("coerces non-string option values to strings", () => {
    const value = JSON.stringify({ options: [{ value: 1 }, { value: 2 }] });
    expect(lifecycleValuesFromColumnValue(value)).toEqual(["1", "2"]);
  });
});

describe("stepLifecycleValue", () => {
  it("advances one state forward", () => {
    expect(
      stepLifecycleValue({
        values: STATES,
        current: "evaluating",
        direction: "next",
      })
    ).toBe("to-install");
  });

  it("steps one state backward", () => {
    expect(
      stepLifecycleValue({
        values: STATES,
        current: "to-install",
        direction: "previous",
      })
    ).toBe("evaluating");
  });

  it("enters at the first state from empty when advancing", () => {
    expect(
      stepLifecycleValue({ values: STATES, current: "", direction: "next" })
    ).toBe("wishlist");
  });

  it("enters at the last state from empty when stepping back", () => {
    expect(
      stepLifecycleValue({ values: STATES, current: "", direction: "previous" })
    ).toBe("retired");
  });

  it("enters the lifecycle from a value not in the option set", () => {
    expect(
      stepLifecycleValue({
        values: STATES,
        current: "archived",
        direction: "next",
      })
    ).toBe("wishlist");
  });

  it("clamps at the last state when advancing (no wrap by default)", () => {
    expect(
      stepLifecycleValue({
        values: STATES,
        current: "retired",
        direction: "next",
      })
    ).toBeNull();
  });

  it("clamps at the first state when stepping back (no wrap by default)", () => {
    expect(
      stepLifecycleValue({
        values: STATES,
        current: "wishlist",
        direction: "previous",
      })
    ).toBeNull();
  });

  it("wraps around the ends when wrap is true", () => {
    expect(
      stepLifecycleValue({
        values: STATES,
        current: "retired",
        direction: "next",
        wrap: true,
      })
    ).toBe("wishlist");
    expect(
      stepLifecycleValue({
        values: STATES,
        current: "wishlist",
        direction: "previous",
        wrap: true,
      })
    ).toBe("retired");
  });

  it("is a no-op with no options", () => {
    expect(
      stepLifecycleValue({ values: [], current: "x", direction: "next" })
    ).toBeNull();
  });

  it("is a no-op for a single-option column already on that option", () => {
    expect(
      stepLifecycleValue({ values: ["only"], current: "only", direction: "next" })
    ).toBeNull();
    expect(
      stepLifecycleValue({
        values: ["only"],
        current: "only",
        direction: "previous",
      })
    ).toBeNull();
  });
});
