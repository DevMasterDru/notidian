import { defaultPredicate } from "shared/schemas/predicate";
import { validatePredicate } from "./predicate";

describe("validatePredicate", () => {
  it("preserves valid per-column header display modes", () => {
    expect(
      validatePredicate(
        {
          ...defaultPredicate,
          colsHeaderDisplay: {
            status: "text",
            priority: "icon",
            assignee: "full",
            area: "adaptive",
          },
        },
        defaultPredicate
      ).colsHeaderDisplay
    ).toEqual({
      status: "text",
      priority: "icon",
      assignee: "full",
      area: "adaptive",
    });
  });

  it("drops invalid per-column header display modes", () => {
    expect(
      validatePredicate(
        {
          ...defaultPredicate,
          colsHeaderDisplay: {
            status: "wide",
            priority: "icon",
            area: 3,
          } as any,
        },
        defaultPredicate
      ).colsHeaderDisplay
    ).toEqual({
      priority: "icon",
    });
  });

  it("preserves valid per-column data anchors", () => {
    expect(
      validatePredicate(
        {
          ...defaultPredicate,
          colsDataAnchor: {
            status: "left",
            priority: "center",
            assignee: "right",
          },
        },
        defaultPredicate
      ).colsDataAnchor
    ).toEqual({
      status: "left",
      priority: "center",
      assignee: "right",
    });
  });

  it("drops invalid per-column data anchors", () => {
    expect(
      validatePredicate(
        {
          ...defaultPredicate,
          colsDataAnchor: {
            status: "wide",
            priority: "center",
            area: "auto",
          } as any,
        },
        defaultPredicate
      ).colsDataAnchor
    ).toEqual({
      priority: "center",
    });
  });

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

  it("preserves rtl table direction and defaults missing or invalid values to ltr", () => {
    expect(
      validatePredicate(
        {
          ...defaultPredicate,
          tableDirection: "rtl",
        },
        defaultPredicate
      ).tableDirection
    ).toBe("rtl");

    expect(
      validatePredicate(
        {
          ...defaultPredicate,
          tableDirection: "sideways",
        } as any,
        defaultPredicate
      ).tableDirection
    ).toBe("ltr");

    expect(
      validatePredicate(
        {
          ...defaultPredicate,
          tableDirection: undefined,
        } as any,
        defaultPredicate
      ).tableDirection
    ).toBe("ltr");
  });
});
