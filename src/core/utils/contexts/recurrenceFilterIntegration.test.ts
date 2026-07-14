import { filterReturnForCol } from "core/utils/contexts/predicate/filter";
import { filterFnLabels } from "core/utils/contexts/predicate/filterFns/filterFnLabels";
import { filterFnTypes } from "core/utils/contexts/predicate/filterFns/filterFnTypes";
import {
  allPredicateFns,
  defaultPredicateFnForType,
  predicateFnsForType,
} from "core/utils/contexts/predicate/predicate";
import { makeRowMatchesFilters } from "core/utils/contexts/predicate/rowMatchesFilters";
import { SpaceTableColumn } from "shared/types/mdb";
import fs from "fs";
import path from "path";

const cadence: SpaceTableColumn = {
  name: "cadence",
  type: "option",
  table: "",
};

describe("recurrence filters in the native predicate engine", () => {
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date(2026, 6, 14, 12));
  });

  afterEach(() => jest.useRealTimers());

  it("registers value-free row predicates without exposing them to every option", () => {
    expect(filterFnTypes.occursToday).toEqual(
      expect.objectContaining({
        type: ["option"],
        scopedFields: ["cadence", "recurrence"],
        valueType: "none",
      })
    );
    expect(filterFnTypes.occursThisWeek).toEqual(
      expect.objectContaining({
        type: ["option"],
        scopedFields: ["cadence", "recurrence"],
        valueType: "none",
      })
    );
    expect(filterFnLabels.occursToday).toBe("Occurs today");
    expect(filterFnLabels.occursThisWeek).toBe("Occurs this ISO week");
    expect(predicateFnsForType("option", filterFnTypes)).not.toEqual(
      expect.arrayContaining(["occursToday", "occursThisWeek"])
    );
    expect(allPredicateFns(filterFnTypes)).not.toEqual(
      expect.arrayContaining(["occursToday", "occursThisWeek"])
    );
    expect(defaultPredicateFnForType("option", filterFnTypes)).not.toMatch(
      /^occurs/
    );
  });

  it("passes the complete row to occurrence predicates", () => {
    const filter = {
      field: "cadence",
      fn: "occursToday",
      fType: "none",
      value: "",
    } as any;
    expect(
      filterReturnForCol(cadence, filter, {
        cadence: "weekly",
        days: '["tue"]',
      }, {})
    ).toBe(true);
    expect(
      filterReturnForCol(cadence, filter, {
        cadence: "weekly",
        days: '["fri"]',
      }, {})
    ).toBe(false);
    expect(
      filterReturnForCol(
        { ...cadence, name: "recurrence" },
        { ...filter, field: "recurrence" },
        { recurrence: "weekdays" },
        {}
      )
    ).toBe(true);
  });

  it("filters rows through makeRowMatchesFilters", () => {
    const matches = makeRowMatchesFilters({
      filters: [
        {
          field: "cadence",
          fn: "occursThisWeek",
          fType: "none",
          value: "",
        } as any,
      ],
      cols: [cadence],
      spaceManager: { getPathState: () => null },
      properties: null,
    });
    expect(matches({ cadence: "custom", times_per_week: "3" })).toBe(true);
    expect(matches({ cadence: "monthly" })).toBe(false);
  });

  it("fails open behind the recurrence-aware filter kill switch", () => {
    const matches = makeRowMatchesFilters({
      filters: [
        {
          field: "cadence",
          fn: "occursToday",
          fType: "none",
          value: "",
        } as any,
      ],
      cols: [cadence],
      spaceManager: { getPathState: () => null },
      properties: null,
      enableRecurrenceFilters: false,
    });
    expect(matches({ cadence: "monthly" })).toBe(true);
  });

  it("wires scoped operators into both filter UIs and the midnight refresh seam", () => {
    const read = (relative: string) =>
      fs.readFileSync(path.join(process.cwd(), relative), "utf8");
    expect(
      read("src/core/react/components/SpaceView/Contexts/FilterBar/FilterBar.tsx")
    ).toContain("recurrenceFilterFnsForFieldName");
    expect(read("src/core/react/components/SpaceEditor/SpaceQuery.tsx")).toContain(
      "recurrenceFilterFnsForFieldName"
    );
    const provider = read("src/core/react/context/ContextEditorContext.tsx");
    expect(provider).toContain("hasRecurrenceFilters");
    expect(provider).toContain("millisecondsUntilNextLocalDay()");
  });
});
