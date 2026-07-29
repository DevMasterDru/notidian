// H3 density mode (Notidian-pb7p.3 / Atlas ADR-0096 D1: hub tabs are DENSE,
// mission-focused pages). A per-view row density lives in the predicate beside
// the other view-shape knobs, so it persists through the existing savePredicate
// authority path with no new data ownership.
import {
  defaultTableRowDensity,
  tableRowDensityClass,
  tableRowDensityForValue,
} from "./tableRowDensity";

describe("tableRowDensityForValue", () => {
  it("accepts the declared densities", () => {
    expect(tableRowDensityForValue("normal")).toBe("normal");
    expect(tableRowDensityForValue("compact")).toBe("compact");
  });

  it("falls back to the default for missing or unknown values", () => {
    expect(tableRowDensityForValue()).toBe(defaultTableRowDensity);
    expect(tableRowDensityForValue(undefined)).toBe("normal");
    expect(tableRowDensityForValue(null)).toBe("normal");
    expect(tableRowDensityForValue("")).toBe("normal");
    expect(tableRowDensityForValue("dense")).toBe("normal");
    expect(tableRowDensityForValue(3)).toBe("normal");
    expect(tableRowDensityForValue({})).toBe("normal");
  });

  it("defaults to normal so an untouched view is byte-identical", () => {
    expect(defaultTableRowDensity).toBe("normal");
  });
});

describe("tableRowDensityClass", () => {
  it("emits no class for the default density (legacy DOM unchanged)", () => {
    expect(tableRowDensityClass("normal")).toBeNull();
    expect(tableRowDensityClass(undefined)).toBeNull();
  });

  it("emits the compact modifier only for compact", () => {
    expect(tableRowDensityClass("compact")).toBe("mk-table--compact");
  });
});
