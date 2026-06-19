import { defaultPredicate } from "shared/schemas/predicate";
import { cleanPredicateType, validatePredicate } from "./predicate";
import { filterFnTypes } from "./filterFns/filterFnTypes";
import { sortFnTypes } from "./sort";
import { Filter } from "shared/types/predicate";

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

  it("strips a filter with an unknown fn (validate-loud primary guard, ADR 0034)", () => {
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const result = validatePredicate(
        {
          ...defaultPredicate,
          filters: [
            { fn: "is", field: "Title", value: "x" } as Filter,
            { fn: "noSuchFn", field: "Title", value: "x" } as Filter,
          ],
        },
        defaultPredicate
      );
      // The unknown fn never survives to become an active filter — so it never
      // reaches the fail-open dispatcher in normal operation.
      expect(result.filters.map((f) => f.fn)).toEqual(["is"]);
      expect(warn).toHaveBeenCalledTimes(1);
      // The warning names the operator that was dropped (validate-loud, C-lite).
      expect(warn.mock.calls[0][0]).toContain("noSuchFn");
    } finally {
      warn.mockRestore();
    }
  });
});

// ADR 0034 "C-lite": cleanPredicateType is the write/load-time primary guard
// that strips unknown operators before they reach the fail-open per-row
// dispatcher. It must do so LOUDLY (once, off the hot path) but WITHOUT changing
// which entries survive — the warning is observability only.
describe("cleanPredicateType (validate-loud, ADR 0034)", () => {
  let warn: jest.SpyInstance;
  beforeEach(() => {
    warn = jest.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    warn.mockRestore();
  });

  it("does NOT warn when every fn is known", () => {
    const filters = [
      { fn: "is", field: "Title", value: "x" } as Filter,
      { fn: "include", field: "Title", value: "y" } as Filter,
    ];
    const kept = cleanPredicateType(filters, filterFnTypes) as Filter[];
    expect(kept).toHaveLength(2);
    expect(warn).not.toHaveBeenCalled();
  });

  it("drops unknown fns and warns exactly once, naming each dropped operator", () => {
    const filters = [
      { fn: "is", field: "Title", value: "x" } as Filter,
      { fn: "bogusOne", field: "Title", value: "x" } as Filter,
      { fn: "bogusTwo", field: "Title", value: "x" } as Filter,
    ];
    const kept = cleanPredicateType(filters, filterFnTypes) as Filter[];
    expect(kept.map((f) => f.fn)).toEqual(["is"]);
    expect(warn).toHaveBeenCalledTimes(1);
    const msg = warn.mock.calls[0][0] as string;
    expect(msg).toContain("bogusOne");
    expect(msg).toContain("bogusTwo");
    expect(msg).toContain("ADR 0034");
  });

  it("de-duplicates repeated unknown fns in the warning (single message)", () => {
    const filters = [
      { fn: "dupBogus", field: "A", value: "x" } as Filter,
      { fn: "dupBogus", field: "B", value: "y" } as Filter,
    ];
    cleanPredicateType(filters, filterFnTypes);
    expect(warn).toHaveBeenCalledTimes(1);
    const msg = warn.mock.calls[0][0] as string;
    // "dupBogus" appears once in the de-duplicated list, plus prose; assert the
    // list portion does not repeat it.
    expect(msg.split("dupBogus").length - 1).toBe(1);
  });

  it("labels a missing fn as (missing) rather than 'undefined'", () => {
    const filters = [{ field: "Title", value: "x" } as Filter];
    cleanPredicateType(filters, filterFnTypes);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain("(missing)");
  });

  it("applies the same validate-loud guard to sorts", () => {
    const sorts = [
      { fn: "alphabetical", field: "Title" } as any,
      { fn: "noSuchSort", field: "Title" } as any,
    ];
    const kept = cleanPredicateType(sorts, sortFnTypes);
    expect(kept).toHaveLength(1);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain("noSuchSort");
  });
});
