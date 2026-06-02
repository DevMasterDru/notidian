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
});
