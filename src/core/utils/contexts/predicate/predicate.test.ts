import { defaultPredicate } from "shared/schemas/predicate";
import { validatePredicate } from "./predicate";

describe("validatePredicate", () => {
  it("preserves a valid frozen column count", () => {
    expect(
      validatePredicate(
        {
          ...defaultPredicate,
          frozenColumnCount: 2.8,
        },
        defaultPredicate
      ).frozenColumnCount
    ).toBe(2);
  });

  it("defaults invalid frozen column counts", () => {
    expect(
      validatePredicate(
        {
          ...defaultPredicate,
          frozenColumnCount: -1,
        },
        defaultPredicate
      ).frozenColumnCount
    ).toBe(0);
  });

  it("preserves the chart config through validation (Notidian-4j7 persistence)", () => {
    const chart = {
      visible: true,
      groupKey: "Status",
      aggregate: "count" as const,
    };
    expect(
      validatePredicate({ ...defaultPredicate, chart }, defaultPredicate).chart
    ).toEqual(chart);
  });

  it("preserves a valid sub-items config (Notidian-pv4)", () => {
    const subItems = { field: "Parent" };
    expect(
      validatePredicate({ ...defaultPredicate, subItems }, defaultPredicate)
        .subItems
    ).toEqual(subItems);
  });

  it("drops a malformed sub-items config", () => {
    expect(
      validatePredicate(
        { ...defaultPredicate, subItems: { notField: true } as any },
        defaultPredicate
      ).subItems
    ).toBeUndefined();
  });

  it("leaves chart/sub-items undefined when absent", () => {
    const result = validatePredicate(defaultPredicate, defaultPredicate);
    expect(result.chart).toBeUndefined();
    expect(result.subItems).toBeUndefined();
  });
});
