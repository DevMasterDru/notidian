import {
  isValueInRollupPeriod,
  rollupDateValueMillis,
} from "core/utils/contexts/rollupPeriod";

describe("rollup period boundaries", () => {
  it("computes the delay to the next local-day boundary for an open view refresh", () => {
    const nextLocalDayDelay = require("./rollupPeriod")
      .millisecondsUntilNextLocalDay;
    expect(typeof nextLocalDayDelay).toBe("function");
    expect(nextLocalDayDelay(new Date(2026, 6, 14, 23, 59, 59, 500))).toBe(
      500
    );
    expect(nextLocalDayDelay(new Date(2026, 6, 14, 12, 0, 0, 0))).toBe(
      12 * 60 * 60 * 1000
    );
  });

  it("parses date-only values as validated local calendar dates", () => {
    const millis = rollupDateValueMillis("2026-07-14");
    const local = new Date(millis);
    expect([
      local.getFullYear(),
      local.getMonth() + 1,
      local.getDate(),
    ]).toEqual([2026, 7, 14]);
    expect(Number.isNaN(rollupDateValueMillis("2026-02-30"))).toBe(true);
  });

  it("matches today by local calendar date and fails closed on bad values", () => {
    const period = { field: "done", scope: "today" as const };
    const now = new Date(2026, 6, 14, 23, 30);
    expect(isValueInRollupPeriod("2026-07-14", period, now)).toBe(true);
    expect(isValueInRollupPeriod("2026-07-13", period, now)).toBe(false);
    expect(isValueInRollupPeriod("bad", period, now)).toBe(false);
    expect(isValueInRollupPeriod(null, period, now)).toBe(false);
  });

  it("uses Monday through Sunday for an ISO week", () => {
    const period = { field: "done", scope: "iso-week" as const };
    const sunday = new Date(2026, 0, 4, 12);
    expect(isValueInRollupPeriod("2025-12-29", period, sunday)).toBe(true);
    expect(isValueInRollupPeriod("2026-01-04", period, sunday)).toBe(true);
    expect(isValueInRollupPeriod("2026-01-05", period, sunday)).toBe(false);
  });
});
