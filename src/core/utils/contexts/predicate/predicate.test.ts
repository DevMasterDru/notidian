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

  it("keeps valid sub-item display/filterScope/collapsed keys (ADR 0050)", () => {
    const subItems = {
      field: "Parent",
      display: "flattened",
      filterScope: "subItems",
      collapsed: ["A.md", "B.md"],
    };
    expect(
      validatePredicate({ ...defaultPredicate, subItems } as any, defaultPredicate)
        .subItems
    ).toEqual(subItems);
  });

  it("drops default sub-item keys so a legacy { field } stays byte-identical (ADR 0050)", () => {
    // display 'nested' + filterScope 'parentsAndSubItems' + empty collapsed are
    // the defaults — none should persist, so the output equals a bare { field }.
    expect(
      validatePredicate(
        {
          ...defaultPredicate,
          subItems: {
            field: "Parent",
            display: "nested",
            filterScope: "parentsAndSubItems",
            collapsed: [],
          },
        } as any,
        defaultPredicate
      ).subItems
    ).toEqual({ field: "Parent" });
  });

  it("rejects out-of-set sub-item enum values + non-string collapsed entries (ADR 0050)", () => {
    expect(
      validatePredicate(
        {
          ...defaultPredicate,
          subItems: {
            field: "Parent",
            display: "bogus",
            filterScope: "nope",
            collapsed: ["A.md", 3, "", null],
          },
        } as any,
        defaultPredicate
      ).subItems
    ).toEqual({ field: "Parent", collapsed: ["A.md"] });
  });

  it("leaves chart/sub-items undefined when absent", () => {
    const result = validatePredicate(defaultPredicate, defaultPredicate);
    expect(result.chart).toBeUndefined();
    expect(result.subItems).toBeUndefined();
  });

  // --- Notidian-w1bf: harden the passthrough fields against non-object /
  // non-array corrupt or forward-version values that previously flowed straight
  // into consumers (`...predicate.colsSize`, `Object.entries(...)`).
  describe("Record<string,*> fields coerce non-object containers to {} (Notidian-w1bf)", () => {
    it("preserves a valid colsSize and drops non-number entries", () => {
      expect(
        validatePredicate(
          {
            ...defaultPredicate,
            colsSize: {
              "Title.": 240,
              "Status.": "wide" as any,
              "Tags.": null as any,
              "Bad.": NaN as any,
            } as any,
          },
          defaultPredicate
        ).colsSize
      ).toEqual({ "Title.": 240 });
    });

    it("coerces a colsSize parsed as an array to {}", () => {
      expect(
        validatePredicate(
          { ...defaultPredicate, colsSize: [240, 300] as any },
          defaultPredicate
        ).colsSize
      ).toEqual({});
    });

    it("coerces a colsSize parsed as a string/number to {}", () => {
      expect(
        validatePredicate(
          { ...defaultPredicate, colsSize: "240" as any },
          defaultPredicate
        ).colsSize
      ).toEqual({});
      expect(
        validatePredicate(
          { ...defaultPredicate, colsSize: 240 as any },
          defaultPredicate
        ).colsSize
      ).toEqual({});
    });

    it("preserves a valid colsCalc and drops non-string entries", () => {
      expect(
        validatePredicate(
          {
            ...defaultPredicate,
            colsCalc: { "Amount.": "sum", "Count.": 3 as any } as any,
          },
          defaultPredicate
        ).colsCalc
      ).toEqual({ "Amount.": "sum" });
    });

    it("coerces a colsCalc parsed as an array to {}", () => {
      expect(
        validatePredicate(
          { ...defaultPredicate, colsCalc: ["sum"] as any },
          defaultPredicate
        ).colsCalc
      ).toEqual({});
    });

    it("coerces a non-object listViewProps to the default {} (array/string/number)", () => {
      expect(
        validatePredicate(
          { ...defaultPredicate, listViewProps: ["start"] as any },
          defaultPredicate
        ).listViewProps
      ).toEqual({});
      expect(
        validatePredicate(
          { ...defaultPredicate, listViewProps: "displayProperty" as any },
          defaultPredicate
        ).listViewProps
      ).toEqual({});
    });

    it("preserves a valid listViewProps/listItemProps/listGroupProps object", () => {
      const result = validatePredicate(
        {
          ...defaultPredicate,
          listViewProps: { displayProperty: "Name" },
          listItemProps: { a: 1 },
          listGroupProps: { b: 2 },
        },
        defaultPredicate
      );
      expect(result.listViewProps).toEqual({ displayProperty: "Name" });
      expect(result.listItemProps).toEqual({ a: 1 });
      expect(result.listGroupProps).toEqual({ b: 2 });
    });

    it("coerces a non-object listItemProps/listGroupProps to the default {}", () => {
      const result = validatePredicate(
        {
          ...defaultPredicate,
          listItemProps: null as any,
          listGroupProps: 5 as any,
        },
        defaultPredicate
      );
      expect(result.listItemProps).toEqual({});
      expect(result.listGroupProps).toEqual({});
    });
  });

  describe("string-scalar fields fall back to default for non-strings (Notidian-w1bf)", () => {
    it("falls back to the default view for a non-string view", () => {
      expect(
        validatePredicate(
          { ...defaultPredicate, view: 3 as any },
          defaultPredicate
        ).view
      ).toBe(defaultPredicate.view);
      expect(
        validatePredicate(
          { ...defaultPredicate, view: { kind: "table" } as any },
          defaultPredicate
        ).view
      ).toBe(defaultPredicate.view);
    });

    it("falls back to the default for non-string listView/listItem/listGroup", () => {
      const result = validatePredicate(
        {
          ...defaultPredicate,
          listView: ["frame"] as any,
          listItem: 42 as any,
          listGroup: null as any,
        },
        defaultPredicate
      );
      expect(result.listView).toBe(defaultPredicate.listView);
      expect(result.listItem).toBe(defaultPredicate.listItem);
      expect(result.listGroup).toBe(defaultPredicate.listGroup);
    });

    it("preserves a valid string view (no behavior change for valid predicates)", () => {
      expect(
        validatePredicate(
          { ...defaultPredicate, view: "table" },
          defaultPredicate
        ).view
      ).toBe("table");
    });
  });

  describe("string-array fields keep only string elements (Notidian-w1bf)", () => {
    it("filters non-string elements out of colsOrder/colsHidden/groupBy", () => {
      const result = validatePredicate(
        {
          ...defaultPredicate,
          colsOrder: ["Title.", 3, null, "Status."] as any,
          colsHidden: ["Tags.", { x: 1 }] as any,
          groupBy: ["Status.", 7] as any,
        },
        defaultPredicate
      );
      expect(result.colsOrder).toEqual(["Title.", "Status."]);
      expect(result.colsHidden).toEqual(["Tags."]);
      expect(result.groupBy).toEqual(["Status."]);
    });

    it("coerces a non-array colsOrder/colsHidden/groupBy to []", () => {
      const result = validatePredicate(
        {
          ...defaultPredicate,
          colsOrder: "Title." as any,
          colsHidden: 0 as any,
          groupBy: { Status: true } as any,
        },
        defaultPredicate
      );
      expect(result.colsOrder).toEqual([]);
      expect(result.colsHidden).toEqual([]);
      expect(result.groupBy).toEqual([]);
    });

    it("preserves a valid all-string colsOrder unchanged", () => {
      expect(
        validatePredicate(
          { ...defaultPredicate, colsOrder: ["Title.", "Status."] },
          defaultPredicate
        ).colsOrder
      ).toEqual(["Title.", "Status."]);
    });
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
