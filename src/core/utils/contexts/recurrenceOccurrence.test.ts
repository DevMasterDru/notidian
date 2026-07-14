const loadOccurrenceApi = (): any => {
  try {
    return require("./recurrenceOccurrence");
  } catch {
    return {};
  }
};

describe("recurrence occurrence scopes", () => {
  it("matches daily cadence today and in the current ISO week", () => {
    const { recurrenceOccursInScope } = loadOccurrenceApi();
    expect(typeof recurrenceOccursInScope).toBe("function");
    const row = { cadence: "daily" };
    const now = new Date(2026, 6, 14, 12);
    expect(recurrenceOccursInScope(row, "today", now)).toBe(true);
    expect(recurrenceOccursInScope(row, "iso-week", now)).toBe(true);
  });

  it("matches weekdays by the local calendar day", () => {
    const { recurrenceOccursInScope } = loadOccurrenceApi();
    expect(
      recurrenceOccursInScope(
        { recurrence: "weekdays" },
        "today",
        new Date(2026, 6, 13, 12),
        { cadenceField: "recurrence" }
      )
    ).toBe(true);
    expect(
      recurrenceOccursInScope(
        { recurrence: "weekdays" },
        "today",
        new Date(2026, 6, 12, 12),
        { cadenceField: "recurrence" }
      )
    ).toBe(false);
  });

  it("matches weekly and custom schedules against normalized day tokens", () => {
    const { recurrenceOccursInScope } = loadOccurrenceApi();
    const tuesday = new Date(2026, 6, 14, 12);
    expect(
      recurrenceOccursInScope(
        { cadence: "weekly", days: ["mon", "tue"] },
        "today",
        tuesday
      )
    ).toBe(true);
    expect(
      recurrenceOccursInScope(
        { cadence: "custom", days: '["MO","FR"]' },
        "today",
        tuesday
      )
    ).toBe(false);
    expect(
      recurrenceOccursInScope(
        { cadence: "custom", days: "MO, TU" },
        "iso-week",
        tuesday
      )
    ).toBe(true);
  });

  it("keeps frequency-only schedules out of today while including their ISO week", () => {
    const { recurrenceOccursInScope } = loadOccurrenceApi();
    const now = new Date(2026, 6, 14, 12);
    for (const row of [
      { cadence: "weekly" },
      { cadence: "custom", times_per_week: 3 },
    ]) {
      expect(recurrenceOccursInScope(row, "today", now)).toBe(false);
      expect(recurrenceOccursInScope(row, "iso-week", now)).toBe(true);
    }
  });

  it("fails closed for monthly and malformed schedules", () => {
    const { recurrenceOccursInScope } = loadOccurrenceApi();
    const now = new Date(2026, 6, 14, 12);
    expect(
      recurrenceOccursInScope(
        { cadence: "monthly", days: ["tue"] },
        "today",
        now
      )
    ).toBe(false);
    expect(recurrenceOccursInScope({ cadence: "unknown" }, "iso-week", now)).toBe(
      false
    );
    expect(recurrenceOccursInScope({}, "today", now)).toBe(false);
  });

  it("exposes the occurrence operators only for cadence field names", () => {
    const { recurrenceFilterFnsForFieldName, isRecurrenceFilterFn } =
      loadOccurrenceApi();
    expect(recurrenceFilterFnsForFieldName("cadence")).toEqual([
      "occursToday",
      "occursThisWeek",
    ]);
    expect(recurrenceFilterFnsForFieldName("Events.recurrence")).toEqual([
      "occursToday",
      "occursThisWeek",
    ]);
    expect(recurrenceFilterFnsForFieldName("status")).toEqual([]);
    expect(isRecurrenceFilterFn("occursToday")).toBe(true);
    expect(isRecurrenceFilterFn("is")).toBe(false);
  });
});
