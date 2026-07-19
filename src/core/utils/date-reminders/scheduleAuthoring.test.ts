import * as scheduleCore from "./schedule";
import {
  LegacyRepeatTemplate,
  RepeatTemplate,
} from "../contexts/fields/presets";

const core = scheduleCore as any;
const DAY = 24 * 60 * 60 * 1000;
const due = "2026-07-19T09:00:00Z";

describe("strict date schedule authoring", () => {
  it("keeps unsupported legacy choices only in the kill-switch OFF template", () => {
    const strict = JSON.parse(RepeatTemplate.value as string);
    const legacy = JSON.parse(LegacyRepeatTemplate.value as string);
    const values = (template: any) =>
      template.type.freq.value.options.map((option: any) => option.value);

    expect(values(strict)).toEqual([
      "YEARLY",
      "MONTHLY",
      "WEEKLY",
      "DAILY",
      "HOURLY",
    ]);
    expect(values(legacy)).toEqual([
      "YEARLY",
      "MONTHLY",
      "WEEKLY",
      "DAILY",
      "HOURLY",
      "MINUTELY",
      "SECONDLY",
    ]);
  });

  it("reads a canonical YAML mapping and a legacy JSON string identically", () => {
    const mapping = { freq: "WEEKLY", interval: 2, byweekday: ["MO", "FR"] };

    expect(core.parseRepeatRule(mapping, due)).toMatchObject({
      value: expect.objectContaining(mapping),
      error: null,
      legacy: false,
    });
    expect(core.parseRepeatRule(JSON.stringify(mapping), due)).toMatchObject({
      value: expect.objectContaining(mapping),
      error: null,
      legacy: true,
    });
  });

  it("serializes legacy-compatible rules as canonical mappings, never JSON strings", () => {
    const parsed = core.parseRepeatRule(
      '{"freq":"DAILY","interval":1,"count":3}',
      due,
    );

    const serialized = core.serializeRepeatRule(parsed.value);
    expect(serialized).toEqual({ freq: "DAILY", interval: 1, count: 3 });
    expect(typeof serialized).toBe("object");
  });

  it.each(["DAILY", "WEEKLY", "MONTHLY", "YEARLY", "HOURLY"])(
    "accepts the supported %s frequency",
    (freq) => {
      expect(core.parseRepeatRule({ freq, interval: 1 }, due).error).toBeNull();
    },
  );

  it.each([
    [{ freq: "MINUTELY", interval: 1 }, "frequency"],
    [{ freq: "SECONDLY", interval: 1 }, "frequency"],
    [{ freq: "daily", interval: 1 }, "frequency"],
    [{ freq: "DAILY", interval: 0 }, "interval"],
    [{ freq: "DAILY", interval: 1.5 }, "interval"],
    [{ freq: "DAILY", interval: 1, count: 0 }, "count"],
    [{ freq: "DAILY", interval: 1, count: 1.5 }, "count"],
    [{ freq: "DAILY", interval: 1, count: 101 }, "count"],
    [{ freq: "DAILY", interval: 1, byweekday: ["XX"] }, "weekday"],
    [{ freq: "DAILY", interval: 1, wkst: "xx" }, "week"],
    [{ freq: "DAILY", interval: 1, surprise: true }, "unknown"],
    [{ freq: "DAILY", interval: 1, until: "2026-07-18" }, "before"],
    [[], "mapping"],
    ["not json", "mapping"],
  ])("rejects malformed recurrence %p with a visible error", (value, message) => {
    const result = core.parseRepeatRule(value, due);
    expect(result.value).toBeNull();
    expect(result.error.toLowerCase()).toContain(message);
  });

  it.each([
    [{ freq: "constructor", interval: 1 }, "frequency"],
    [{ freq: "DAILY", interval: 1, byweekday: ["toString"] }, "weekday"],
    [{ freq: "DAILY", interval: 1, wkst: "constructor" }, "week start"],
  ])(
    "rejects prototype-name recurrence tokens without reaching RRule: %p",
    (repeat, message) => {
      const expand = () =>
        core.expandCalendarRecurrence({
          due,
          repeat,
          windowStart: new Date("2026-07-19T00:00:00Z"),
          windowEnd: new Date("2026-07-19T23:59:59.999Z"),
        });

      expect(expand).not.toThrow();
      const result = expand();
      expect(result.error).toMatch(new RegExp(message, "i"));
      expect(result.occurrences).toHaveLength(1);
    },
  );

  it("reads legacy reminder JSON and writes a canonical reminder mapping", () => {
    const parsed = core.parseReminderRule('{"before":"PT30M"}');
    expect(parsed).toMatchObject({
      value: { before: "PT30M" },
      error: null,
      legacy: true,
    });
    expect(core.serializeReminderRule(parsed.value)).toEqual({ before: "PT30M" });
  });
});

describe("shared calendar recurrence expansion", () => {
  const windowStart = new Date("2026-07-19T00:00:00Z");
  const windowEnd = new Date("2026-07-20T00:00:00Z");

  it.each(["DAILY", "WEEKLY", "MONTHLY", "YEARLY", "HOURLY"])(
    "expands the supported %s frequency",
    (freq) => {
      const result = core.expandCalendarRecurrence({
        due: "2026-01-01T09:00:00Z",
        repeat: { freq, interval: 1, count: 2 },
        windowStart: new Date("2026-01-01T00:00:00Z"),
        windowEnd: new Date("2028-01-02T00:00:00Z"),
      });
      expect(result.error).toBeNull();
      expect(result.occurrences).toHaveLength(2);
    },
  );

  it("treats authored until as an inclusive series ceiling", () => {
    const result = core.expandCalendarRecurrence({
      due: "2026-07-18T09:00:00Z",
      repeat: { freq: "DAILY", interval: 1, until: "2026-07-19T09:00:00Z" },
      windowStart,
      windowEnd,
    });

    expect(result.error).toBeNull();
    expect(result.occurrences.map((date: Date) => date.toISOString())).toEqual([
      "2026-07-19T09:00:00.000Z",
    ]);
  });

  it("returns identical occurrence starts for Day and Month when given the same window", () => {
    const input = {
      due: "2026-07-18T09:00:00Z",
      repeat: { freq: "HOURLY", interval: 6 },
      windowStart,
      windowEnd,
    };

    const day = core.expandCalendarRecurrence(input);
    const month = core.expandCalendarRecurrence(input);
    expect(day.occurrences).toEqual(month.occurrences);
    expect(day.error).toBeNull();
  });

  it("caps visible occurrences at 100 and reports truncation", () => {
    const result = core.expandCalendarRecurrence({
      due: new Date(windowStart.getTime() - 6 * DAY),
      repeat: { freq: "HOURLY", interval: 1 },
      windowStart: new Date(windowStart.getTime() - 6 * DAY),
      windowEnd,
    });

    expect(result.occurrences).toHaveLength(100);
    expect(result.truncated).toBe(true);
  });

  it("renders an invalid recurrence's base row once when it intersects the window", () => {
    const result = core.expandCalendarRecurrence({
      due: "2026-07-19T09:00:00Z",
      repeat: { freq: "MINUTELY", interval: 1 },
      windowStart,
      windowEnd,
    });

    expect(result.occurrences.map((date: Date) => date.toISOString())).toEqual([
      "2026-07-19T09:00:00.000Z",
    ]);
    expect(result.error).toMatch(/frequency/i);
    expect(result.truncated).toBe(false);
  });
});

describe("dateScheduleAuthoring kill switch routing", () => {
  it("uses strict authoring by default and only disables it for explicit false", () => {
    expect(core.usesStrictDateSchedule(undefined)).toBe(true);
    expect(core.usesStrictDateSchedule({})).toBe(true);
    expect(core.usesStrictDateSchedule({ dateScheduleAuthoring: true })).toBe(true);
    expect(core.usesStrictDateSchedule({ dateScheduleAuthoring: false })).toBe(false);
  });

  it("uses canonical repeat first when ON and the legacy selector exclusively when OFF", () => {
    const row = {
      repeat: { freq: "DAILY", interval: 1 },
      legacyRepeat: '{"freq":"MINUTELY","interval":1}',
    };
    expect(core.calendarRepeatValue(row, "legacyRepeat", true)).toBe(row.repeat);
    expect(core.calendarRepeatValue(row, "legacyRepeat", false)).toBe(row.legacyRepeat);
    expect(
      core.calendarRepeatValue({ legacyRepeat: row.legacyRepeat }, "legacyRepeat", true),
    ).toBe(row.legacyRepeat);
    expect(
      core.calendarRepeatValue(
        { repeat: null, legacyRepeat: row.legacyRepeat },
        "legacyRepeat",
        true,
      ),
    ).toBeNull();
  });

  it("ignores an own-empty projected repeat column when a canonical snapshot lacks repeat", () => {
    const legacyRepeat = '{"freq":"DAILY","interval":1}';

    expect(
      core.calendarRepeatValue(
        { repeat: "", legacyRepeat },
        "legacyRepeat",
        true,
        {},
        true,
      ),
    ).toBe(legacyRepeat);
  });
});

describe("frontmatter-only schedule transaction", () => {
  const base = {
    due,
    repeat: '{"freq":"DAILY","interval":1}',
    reminder: '{"before":"PT30M"}',
  };
  const next = {
    due: "2026-07-20T09:00:00Z",
    repeat: { freq: "WEEKLY", interval: 1, byweekday: ["MO"] },
    reminder: { before: "PT1H" },
  };

  it("writes only due/repeat/reminder as canonical frontmatter mappings", async () => {
    const write = jest.fn(async () => ({ ok: true }));
    const result = await core.executeDateScheduleTransaction({
      path: "Events/A.md",
      base,
      next,
      readCurrent: () => base,
      write,
    });

    expect(result).toEqual({ ok: true });
    expect(write).toHaveBeenCalledWith("Events/A.md", {
      due: next.due,
      repeat: next.repeat,
      reminder: next.reminder,
    });
    expect(Object.keys((write.mock.calls as any)[0][1]).sort()).toEqual([
      "due",
      "reminder",
      "repeat",
    ]);
  });

  it("rejects a stale edit before any frontmatter write", async () => {
    const write = jest.fn(async () => ({ ok: true }));
    const current = { ...base, repeat: { freq: "MONTHLY", interval: 1 } };

    const result = await core.executeDateScheduleTransaction({
      path: "Events/A.md",
      base,
      next,
      readCurrent: () => current,
      write,
    });

    expect(result.ok).toBe(false);
    expect(result.conflict).toBe(true);
    expect(write).not.toHaveBeenCalled();
  });

  it.each([
    [
      "date-only",
      "2026-07-19",
      new Date(2026, 6, 19),
      "2026-07-19",
    ],
    [
      "zone-less local datetime",
      "2026-07-19T09:30:00",
      new Date(2026, 6, 19, 9, 30),
      "2026-07-19T09:30:00",
    ],
    [
      "absolute datetime",
      "2026-07-19T09:30:00+03:00",
      new Date("2026-07-19T09:30:00+03:00"),
      "2026-07-19T09:30:00+03:00",
    ],
  ])("preserves an unchanged %s due representation", async (_label, source, edited, expected) => {
    const write = jest.fn(async () => true);
    const sourceValues: scheduleCore.DateScheduleValues = {
      due: source,
      repeat: null,
      reminder: null,
    };

    await core.executeDateScheduleTransaction({
      path: "Events/A.md",
      base: sourceValues,
      next: { ...sourceValues, due: edited },
      readCurrent: () => sourceValues,
      write,
    });

    expect(write).toHaveBeenCalledWith(
      "Events/A.md",
      expect.objectContaining({ due: expected }),
    );
  });

  it("preserves local wall-clock mode when an edit crosses the DST boundary", async () => {
    const write = jest.fn(async () => true);
    const sourceValues: scheduleCore.DateScheduleValues = {
      due: "2026-03-26T09:30:00",
      repeat: null,
      reminder: null,
    };

    await core.executeDateScheduleTransaction({
      path: "Events/A.md",
      base: sourceValues,
      next: { ...sourceValues, due: new Date(2026, 2, 27, 9, 30) },
      readCurrent: () => sourceValues,
      write,
    });

    expect(write).toHaveBeenCalledWith(
      "Events/A.md",
      expect.objectContaining({ due: "2026-03-27T09:30:00" }),
    );
  });

  it("keeps an edited date-only source date-only", async () => {
    const write = jest.fn(async () => true);
    const sourceValues: scheduleCore.DateScheduleValues = {
      due: "2026-07-19",
      repeat: null,
      reminder: null,
    };

    await core.executeDateScheduleTransaction({
      path: "Events/A.md",
      base: sourceValues,
      next: { ...sourceValues, due: new Date(2026, 6, 20) },
      readCurrent: () => sourceValues,
      write,
    });

    expect(write).toHaveBeenCalledWith(
      "Events/A.md",
      expect.objectContaining({ due: "2026-07-20" }),
    );
  });

  it("serializes a date-only due changed to a time as a local datetime", async () => {
    const write = jest.fn(async () => true);
    const sourceValues: scheduleCore.DateScheduleValues = {
      due: "2026-07-19",
      repeat: null,
      reminder: null,
    };

    await core.executeDateScheduleTransaction({
      path: "Events/A.md",
      base: sourceValues,
      next: { ...sourceValues, due: new Date(2026, 6, 20, 9, 30) },
      readCurrent: () => sourceValues,
      write,
    });

    expect(write).toHaveBeenCalledWith(
      "Events/A.md",
      expect.objectContaining({ due: "2026-07-20T09:30" }),
    );
  });

  it.each([
    "2026-07-19T09:30:00",
    "2026-07-19T09:30:00+03:00",
  ])("serializes a timed due changed to all-day as date-only from %s", async (source) => {
    const write = jest.fn(async () => true);
    const sourceValues: scheduleCore.DateScheduleValues = {
      due: source,
      repeat: null,
      reminder: null,
    };

    await core.executeDateScheduleTransaction({
      path: "Events/A.md",
      base: sourceValues,
      next: { ...sourceValues, due: new Date(2026, 6, 20) },
      readCurrent: () => sourceValues,
      write,
    });

    expect(write).toHaveBeenCalledWith(
      "Events/A.md",
      expect.objectContaining({ due: "2026-07-20" }),
    );
  });
});
