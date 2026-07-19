import {
  expandCalendarEventSchedule,
  expandDueReminderOccurrences,
  parseReminderSchedule,
} from "./schedule";

const NOW = new Date("2026-07-19T12:00:00.000Z");
const DAY = 24 * 60 * 60 * 1000;

const withTimeZone = <T>(timeZone: string, run: () => T): T => {
  const previous = process.env.TZ;
  process.env.TZ = timeZone;
  try {
    return run();
  } finally {
    if (previous === undefined) delete process.env.TZ;
    else process.env.TZ = previous;
  }
};

describe("date reminder schedule core", () => {
  it("parses a strict one-time schedule and normalizes its fingerprint", () => {
    const schedule = parseReminderSchedule({
      due: "2026-07-19T12:30:00Z",
      reminder: { before: "PT30M" },
    });

    expect(schedule).toEqual({
      due: new Date("2026-07-19T12:30:00.000Z"),
      beforeMs: 30 * 60 * 1000,
      repeat: null,
      recurrenceMode: "ABSOLUTE",
      fingerprint:
        '{"due":"2026-07-19T12:30:00.000Z","recurrenceMode":"ABSOLUTE","reminder":{"before":"PT1800S"},"repeat":null}',
    });
  });

  it.each([
    [{ due: "not-a-date", reminder: { before: "PT30M" } }],
    [{ due: "2026-02-30", reminder: { before: "PT30M" } }],
    [{ due: "2026-07-19T12:00:00+24:00", reminder: { before: "PT30M" } }],
    [{ due: "2026-07-19T12:30:00Z", reminder: { before: "P1DT" } }],
    [{ due: "2026-07-19T12:30:00Z", reminder: { before: "P1M" } }],
    [{ due: "2026-07-19T12:30:00Z", reminder: { before: "P1W2D" } }],
    [{ due: "2026-07-19T12:30:00Z", reminder: { before: "P1WT1H" } }],
    [{ due: "2026-07-19T12:30:00Z", reminder: { before: "PT1.5H" } }],
    [{ due: "2026-07-19T12:30:00Z", reminder: { before: "P366D" } }],
    [{ due: "2026-07-19T12:30:00Z", reminder: { before: "PT30M", extra: true } }],
    [{
      due: "2026-07-19T12:30:00Z",
      reminder: { before: "PT30M" },
      repeat: null,
    }],
    [{
      due: "2026-07-19T12:30:00Z",
      reminder: { before: "PT30M" },
      repeat: { freq: "DAILY" },
    }],
    [{
      due: "2026-07-19T12:30:00Z",
      reminder: { before: "PT30M" },
      repeat: { freq: "daily", interval: 1 },
    }],
    [{
      due: "2026-07-19T12:30:00Z",
      reminder: { before: "PT30M" },
      repeat: { freq: "DAILY", interval: 0 },
    }],
    [{
      due: "2026-07-19T12:30:00Z",
      reminder: { before: "PT30M" },
      repeat: { freq: "DAILY", interval: Number.MAX_SAFE_INTEGER + 1 },
    }],
    [{
      due: "2026-07-19T12:30:00Z",
      reminder: { before: "PT30M" },
      repeat: { freq: "DAILY", interval: 1, count: 101 },
    }],
  ])("rejects malformed schedule metadata: %p", (metadata) => {
    expect(parseReminderSchedule(metadata)).toBeNull();
  });

  it("interprets a date-only due value at local midnight", () => {
    const schedule = parseReminderSchedule({
      due: "2026-07-19",
      reminder: { before: "PT0S" },
    })!;

    expect(schedule.due.getTime()).toBe(new Date(2026, 6, 19).getTime());
  });

  it("includes the exact seven-day catch-up boundary and excludes older reminders", () => {
    const atBoundary = parseReminderSchedule({
      due: new Date(NOW.getTime() - 7 * DAY).toISOString(),
      reminder: { before: "PT0S" },
    })!;
    const older = parseReminderSchedule({
      due: new Date(NOW.getTime() - 7 * DAY - 1).toISOString(),
      reminder: { before: "PT0S" },
    })!;

    expect(expandDueReminderOccurrences(atBoundary, NOW)).toHaveLength(1);
    expect(expandDueReminderOccurrences(older, NOW)).toEqual([]);
  });

  it("does not return a future reminder", () => {
    const schedule = parseReminderSchedule({
      due: "2026-07-19T12:30:00Z",
      reminder: { before: "PT0S" },
    })!;

    expect(expandDueReminderOccurrences(schedule, NOW)).toEqual([]);
  });

  it("expands recurring due occurrences within the catch-up window", () => {
    const schedule = parseReminderSchedule({
      due: "2026-07-16T12:30:00Z",
      reminder: { before: "PT30M" },
      repeat: { freq: "DAILY", interval: 1, count: 10 },
    })!;

    expect(
      expandDueReminderOccurrences(schedule, NOW).map(
        (occurrence) => occurrence.occurrenceStartMs,
      ),
    ).toEqual([
      Date.parse("2026-07-16T12:30:00Z"),
      Date.parse("2026-07-17T12:30:00Z"),
      Date.parse("2026-07-18T12:30:00Z"),
      Date.parse("2026-07-19T12:30:00Z"),
    ]);
  });

  it("treats a date-only repeat.until as the inclusive end of its local day", () => {
    const now = new Date(2026, 6, 19, 16, 0, 0);
    const schedule = parseReminderSchedule({
      due: "2026-07-18T15:00:00",
      reminder: { before: "PT0S" },
      repeat: { freq: "DAILY", interval: 1, until: "2026-07-19" },
    })!;

    expect(schedule.repeat?.until?.getTime()).toBe(
      new Date(2026, 6, 19, 23, 59, 59, 999).getTime(),
    );
    expect(
      expandDueReminderOccurrences(schedule, now).map(
        (occurrence) => occurrence.occurrenceStartMs,
      ),
    ).toEqual([
      new Date(2026, 6, 18, 15, 0, 0).getTime(),
      new Date(2026, 6, 19, 15, 0, 0).getTime(),
    ]);
  });

  it("caps expansion at 100 occurrences per row and reports truncation", () => {
    const schedule = parseReminderSchedule({
      due: "2026-07-12T13:00:00Z",
      reminder: { before: "PT0S" },
      repeat: { freq: "HOURLY", interval: 1 },
    })!;

    const result = expandDueReminderOccurrences(schedule, NOW);
    expect(result).toHaveLength(100);
    expect(result.truncated).toBe(true);
  });

  it("continues recurring expansion strictly after a prior occurrence", () => {
    const now = new Date("2026-07-19T12:00:00Z");
    const schedule = parseReminderSchedule({
      due: "2026-07-12T12:00:00Z",
      reminder: { before: "PT0S" },
      repeat: { freq: "HOURLY", interval: 1 },
    })!;
    const first = expandDueReminderOccurrences(schedule, now);

    const second = expandDueReminderOccurrences(schedule, now, {
      afterOccurrenceStartMs: first[first.length - 1].occurrenceStartMs,
    });

    expect(first).toHaveLength(100);
    expect(second).toHaveLength(69);
    expect(second[0].occurrenceStartMs).toBe(
      first[first.length - 1].occurrenceStartMs + 60 * 60 * 1000,
    );
    expect(second.truncated).toBe(false);
  });

  it("bounds pure recurring expansion below the per-row cap", () => {
    const schedule = parseReminderSchedule({
      due: "2026-07-12T12:00:00Z",
      reminder: { before: "PT0S" },
      repeat: { freq: "HOURLY", interval: 1 },
    })!;

    const result = expandDueReminderOccurrences(schedule, NOW, {
      maxOccurrences: 3,
    });

    expect(result).toHaveLength(3);
    expect(result.truncated).toBe(true);
  });

  it("keeps zone-less daily recurrences at the same local wall-clock time across DST", () => {
    withTimeZone("Asia/Jerusalem", () => {
      const schedule = parseReminderSchedule({
        due: "2026-03-26T09:00:00",
        reminder: { before: "PT0S" },
        repeat: { freq: "DAILY", interval: 1, count: 3 },
      })!;

      const occurrences = expandDueReminderOccurrences(
        schedule,
        new Date("2026-03-28T12:00:00+03:00"),
      );

      expect(
        occurrences.map(({ occurrenceStartMs }) => occurrenceStartMs),
      ).toEqual([
        new Date(2026, 2, 26, 9, 0, 0).getTime(),
        new Date(2026, 2, 27, 9, 0, 0).getTime(),
        new Date(2026, 2, 28, 9, 0, 0).getTime(),
      ]);
    });
  });

  it("keeps explicit-Z daily recurrences on their absolute UTC clock across DST", () => {
    withTimeZone("Asia/Jerusalem", () => {
      const schedule = parseReminderSchedule({
        due: "2026-03-26T07:00:00Z",
        reminder: { before: "PT0S" },
        repeat: { freq: "DAILY", interval: 1, count: 3 },
      })!;

      expect(
        expandDueReminderOccurrences(
          schedule,
          new Date("2026-03-28T12:00:00+03:00"),
        ).map(({ occurrenceStartMs }) => new Date(occurrenceStartMs).toISOString()),
      ).toEqual([
        "2026-03-26T07:00:00.000Z",
        "2026-03-27T07:00:00.000Z",
        "2026-03-28T07:00:00.000Z",
      ]);
    });
  });

  it("keeps numeric-offset daily recurrences on their absolute UTC clock across DST", () => {
    withTimeZone("Asia/Jerusalem", () => {
      const schedule = parseReminderSchedule({
        due: "2026-03-26T09:00:00+02:00",
        reminder: { before: "PT0S" },
        repeat: { freq: "DAILY", interval: 1, count: 3 },
      })!;

      expect(
        expandDueReminderOccurrences(
          schedule,
          new Date("2026-03-28T12:00:00+03:00"),
        ).map(({ occurrenceStartMs }) => new Date(occurrenceStartMs).toISOString()),
      ).toEqual([
        "2026-03-26T07:00:00.000Z",
        "2026-03-27T07:00:00.000Z",
        "2026-03-28T07:00:00.000Z",
      ]);
    });
  });

  it("fingerprints local and absolute recurrence semantics separately", () => {
    withTimeZone("Asia/Jerusalem", () => {
      const local = parseReminderSchedule({
        due: "2026-03-26T09:00:00",
        reminder: { before: "PT0S" },
        repeat: { freq: "DAILY", interval: 1 },
      })!;
      const absolute = parseReminderSchedule({
        due: "2026-03-26T07:00:00Z",
        reminder: { before: "PT0S" },
        repeat: { freq: "DAILY", interval: 1 },
      })!;

      expect(local.due.getTime()).toBe(absolute.due.getTime());
      expect(local.fingerprint).not.toBe(absolute.fingerprint);
    });
  });
});

describe("calendar event duration semantics", () => {
  it("includes a base event that starts before and overlaps the window", () => {
    const result = expandCalendarEventSchedule({
      due: "2026-07-18T23:00:00",
      repeat: null,
      selectedStart: new Date(2026, 6, 18, 23),
      selectedEnd: new Date(2026, 6, 19, 1),
      windowStart: new Date(2026, 6, 19),
      windowEnd: new Date(2026, 6, 19, 23, 59, 59, 999),
    });

    expect(result.instances).toEqual([
      {
        start: new Date(2026, 6, 18, 23),
        end: new Date(2026, 6, 19, 1),
      },
    ]);
  });

  it("includes the prior recurring occurrence when its duration overlaps the window", () => {
    const result = expandCalendarEventSchedule({
      due: "2026-07-17T23:00:00",
      repeat: { freq: "DAILY", interval: 1 },
      selectedStart: new Date(2026, 6, 17, 23),
      selectedEnd: new Date(2026, 6, 18, 1),
      windowStart: new Date(2026, 6, 19),
      windowEnd: new Date(2026, 6, 19, 23, 59, 59, 999),
    });

    expect(result.instances.map(({ start, end }) => [start, end])).toEqual([
      [new Date(2026, 6, 18, 23), new Date(2026, 6, 19, 1)],
      [new Date(2026, 6, 19, 23), new Date(2026, 6, 20, 1)],
    ]);
  });

  it("preserves an all-day calendar-day span across Asia/Jerusalem DST", () => {
    withTimeZone("Asia/Jerusalem", () => {
      const result = expandCalendarEventSchedule({
        due: "2026-04-01",
        repeat: null,
        selectedStart: new Date(2026, 2, 26),
        selectedEnd: new Date(2026, 2, 28),
        windowStart: new Date(2026, 3, 1),
        windowEnd: new Date(2026, 3, 2),
      });

      expect(result.instances).toEqual([
        {
          start: new Date(2026, 3, 1),
          end: new Date(2026, 3, 3),
        },
      ]);
    });
  });

  it("retains the exact millisecond duration for a timed event across DST", () => {
    withTimeZone("Asia/Jerusalem", () => {
      const selectedStart = new Date(2026, 2, 26, 9);
      const selectedEnd = new Date(2026, 2, 28, 9);
      const duration = selectedEnd.getTime() - selectedStart.getTime();
      const result = expandCalendarEventSchedule({
        due: "2026-04-01T09:00:00",
        repeat: null,
        selectedStart,
        selectedEnd,
        windowStart: new Date(2026, 3, 1),
        windowEnd: new Date(2026, 3, 2),
      });

      expect(result.instances[0].end.getTime()).toBe(
        result.instances[0].start.getTime() + duration,
      );
      expect(result.instances[0].end).toEqual(new Date(2026, 3, 3, 8));
    });
  });
});
