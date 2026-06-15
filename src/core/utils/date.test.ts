import { RRule } from "rrule";
import { MakeMDSettings } from "shared/types/settings";
import {
  formatDate,
  getFreqValue,
  getWeekdayValue,
  isoDateFormat,
  isValidDate,
  parseDate,
} from "./date";

// ---------------------------------------------------------------------------
// These are pure functions that underpin the date / recurrence (rrule) roadmap.
// The suite LOCKS existing behavior — it deliberately does not change semantics.
// node-env Jest, no DOM. The regression-prone case is parseDate's date-only
// (yyyy-MM-dd) branch, which must yield LOCAL midnight (not UTC midnight as
// parseISO would) to avoid an off-by-one calendar day in negative-UTC zones.
// ---------------------------------------------------------------------------

const settingsStub = (
  overrides: Partial<MakeMDSettings> = {},
): MakeMDSettings =>
  ({
    defaultDateFormat: "yyyy-MM-dd",
    defaultTimeFormat: "HH:mm",
    ...overrides,
  } as MakeMDSettings);

describe("isValidDate", () => {
  it("accepts a real Date", () => {
    expect(isValidDate(new Date(2024, 0, 1))).toBe(true);
    expect(isValidDate(new Date(0))).toBe(true);
  });

  it("rejects an invalid Date (NaN time)", () => {
    expect(isValidDate(new Date("not-a-date"))).toBe(false);
    expect(isValidDate(new Date(NaN))).toBe(false);
  });

  it("rejects non-Date values", () => {
    // The contract is `d instanceof Date && !isNaN(d)` — anything not a Date
    // instance is false even when it looks date-like or numeric.
    expect(isValidDate("2024-01-01" as unknown as Date)).toBe(false);
    expect(isValidDate(1700000000000 as unknown as Date)).toBe(false);
    expect(isValidDate(null as unknown as Date)).toBe(false);
    expect(isValidDate(undefined as unknown as Date)).toBe(false);
    expect(isValidDate({} as unknown as Date)).toBe(false);
  });

  it("isValidDate <=> parseDate result is usable (property)", () => {
    // A parsed value, when non-null, is always a valid Date.
    // NB: 0 is intentionally excluded — it is falsy, so parseDate(0) returns
    // null via the `if (!str)` guard before reaching the numeric branch (a
    // documented edge covered explicitly in the falsy-input tests).
    const inputs = [
      "2024-03-09",
      "2024-03-09T10:11:12",
      1700000000000,
      new Date(2020, 5, 15),
    ];
    for (const input of inputs) {
      const parsed = parseDate(input);
      expect(parsed).not.toBeNull();
      expect(isValidDate(parsed as Date)).toBe(true);
    }
  });
});

describe("parseDate", () => {
  describe("falsy / garbage input", () => {
    it("returns null for null, undefined, empty string, 0-as-string falsy guards", () => {
      // The guard is `if (!str) return null` — note 0 is falsy and short-circuits
      // here BEFORE the numeric branch, so numeric-epoch 0 returns null.
      expect(parseDate(null)).toBeNull();
      expect(parseDate(undefined)).toBeNull();
      expect(parseDate("")).toBeNull();
      expect(parseDate(0)).toBeNull();
      expect(parseDate(false)).toBeNull();
      expect(parseDate(NaN)).toBeNull();
    });

    it("returns null for unsupported object types", () => {
      expect(parseDate({})).toBeNull();
      expect(parseDate([])).toBeNull(); // [] is truthy but not finite/string/date
    });
  });

  describe("numeric epoch branch", () => {
    it("parses a millisecond epoch number", () => {
      const ms = Date.UTC(2023, 10, 14, 22, 13, 20); // 1700000000000
      const d = parseDate(ms);
      expect(d).toBeInstanceOf(Date);
      expect((d as Date).getTime()).toBe(ms);
    });

    it("parses a numeric string as a finite epoch (isFinite is checked first)", () => {
      // lodash isFinite returns false for strings, so a numeric string does NOT
      // take the numeric branch — it falls through to the string branch and
      // parseISO. parseISO("1700000000000") is NOT a valid ISO date.
      const d = parseDate("1700000000000");
      expect(d).toBeInstanceOf(Date);
      expect(isValidDate(d as Date)).toBe(false);
    });
  });

  describe("date-only string branch (LOCAL date, the off-by-one fix)", () => {
    it("yyyy-MM-dd yields LOCAL midnight, not UTC midnight", () => {
      const d = parseDate("2024-01-05") as Date;
      expect(d).toBeInstanceOf(Date);
      // Local calendar fields must match exactly the input — this is the whole
      // point of the fix. parseISO would set UTC midnight, which in negative-UTC
      // zones rolls the LOCAL day back to the 4th (off-by-one).
      expect(d.getFullYear()).toBe(2024);
      expect(d.getMonth()).toBe(0); // January (0-indexed)
      expect(d.getDate()).toBe(5);
      expect(d.getHours()).toBe(0);
      expect(d.getMinutes()).toBe(0);
      expect(d.getSeconds()).toBe(0);
      expect(d.getMilliseconds()).toBe(0);
    });

    it("equals a hand-built local Date (TZ-independent assertion)", () => {
      const d = parseDate("2024-01-05") as Date;
      expect(d.getTime()).toBe(new Date(2024, 0, 1 + 4).getTime());
    });

    it("does NOT regress to parseISO's UTC interpretation", () => {
      // Adversarial guard against a future refactor that swaps the local
      // constructor back to parseISO. parseISO('2024-01-05') is UTC midnight;
      // our value must be local midnight. They differ by exactly the timezone
      // offset (and are only equal in UTC itself).
      const local = parseDate("2024-01-05") as Date;
      const offsetMs = local.getTimezoneOffset() * 60 * 1000;
      const utcMidnight = Date.UTC(2024, 0, 5);
      expect(local.getTime()).toBe(utcMidnight + offsetMs);
    });

    it("handles month/day boundaries as local dates", () => {
      const d1 = parseDate("2024-12-31") as Date;
      expect([d1.getFullYear(), d1.getMonth(), d1.getDate()]).toEqual([
        2024, 11, 31,
      ]);
      const d2 = parseDate("2024-02-29") as Date; // leap day
      expect([d2.getFullYear(), d2.getMonth(), d2.getDate()]).toEqual([
        2024, 1, 29,
      ]);
    });

    it("round-trips through formatDate at the default date format (property)", () => {
      // For a date-only parse, formatting back at yyyy-MM-dd must reproduce the
      // input — proves no day drift in either direction.
      for (const input of ["2024-01-05", "2024-12-31", "2023-07-04"]) {
        const parsed = parseDate(input) as Date;
        expect(formatDate(settingsStub(), parsed, "yyyy-MM-dd")).toBe(input);
      }
    });
  });

  describe("ISO datetime string branch (parseISO)", () => {
    it("parses a full ISO datetime preserving wall-clock fields", () => {
      const d = parseDate("2024-03-09T13:45:30") as Date;
      expect(d).toBeInstanceOf(Date);
      // A datetime string (with 'T') skips the date-only regex and goes through
      // parseISO, which interprets a zoneless datetime in LOCAL time.
      expect(d.getFullYear()).toBe(2024);
      expect(d.getMonth()).toBe(2);
      expect(d.getDate()).toBe(9);
      expect(d.getHours()).toBe(13);
      expect(d.getMinutes()).toBe(45);
      expect(d.getSeconds()).toBe(30);
    });

    it("parses an ISO datetime with explicit Z (UTC) offset", () => {
      const d = parseDate("2024-03-09T00:00:00Z") as Date;
      expect(d).toBeInstanceOf(Date);
      expect(d.getTime()).toBe(Date.UTC(2024, 2, 9, 0, 0, 0));
    });

    it("returns an invalid Date for an unparseable non-date-only string", () => {
      const d = parseDate("not a date") as Date;
      expect(d).toBeInstanceOf(Date);
      expect(isValidDate(d)).toBe(false);
    });
  });

  describe("Date passthrough branch", () => {
    it("returns the same Date instance untouched", () => {
      const original = new Date(2020, 5, 15, 9, 0, 0);
      const result = parseDate(original);
      expect(result).toBe(original); // identity, not a copy
    });

    it("passes through even an invalid Date instance", () => {
      // isDate (lodash) checks instanceof Date regardless of validity, so an
      // invalid Date is returned as-is rather than nulled.
      const invalid = new Date(NaN);
      const result = parseDate(invalid);
      expect(result).toBe(invalid);
      expect(isValidDate(result as Date)).toBe(false);
    });
  });
});

describe("formatDate", () => {
  it("uses an explicit dateFormat when provided (overrides settings + hasTime)", () => {
    const date = new Date(2024, 0, 5, 13, 30, 0);
    expect(formatDate(settingsStub(), date, "yyyy/MM/dd")).toBe("2024/01/05");
  });

  it("at midnight (no time) uses the default date format only", () => {
    const date = new Date(2024, 0, 5, 0, 0, 0);
    expect(formatDate(settingsStub(), date)).toBe("2024-01-05");
  });

  it("with a time component appends the default time format", () => {
    const date = new Date(2024, 0, 5, 13, 30, 0);
    expect(formatDate(settingsStub(), date)).toBe("2024-01-05 13:30");
  });

  it("treats any nonzero h/m/s as hasTime (boundary: 1 second)", () => {
    const date = new Date(2024, 0, 5, 0, 0, 1);
    expect(formatDate(settingsStub(), date)).toBe("2024-01-05 00:00");
  });

  it("treats a nonzero minute (but zero hour) as hasTime", () => {
    const date = new Date(2024, 0, 5, 0, 30, 0);
    expect(formatDate(settingsStub(), date)).toBe("2024-01-05 00:30");
  });

  it("ignores sub-second milliseconds for the hasTime toggle", () => {
    // hasTime only inspects hours/minutes/seconds, never milliseconds.
    const date = new Date(2024, 0, 5, 0, 0, 0, 500);
    expect(formatDate(settingsStub(), date)).toBe("2024-01-05");
  });

  it("treats an empty-string dateFormat as not-provided (falls back to settings)", () => {
    // The guard is `dateFormat?.length > 0`, so '' must NOT be used as a format.
    const date = new Date(2024, 0, 5, 0, 0, 0);
    expect(formatDate(settingsStub(), date, "")).toBe("2024-01-05");
  });

  it("honors custom settings formats", () => {
    const date = new Date(2024, 0, 5, 13, 30, 0);
    expect(
      formatDate(
        settingsStub({
          defaultDateFormat: "dd/MM/yyyy",
          defaultTimeFormat: "hh:mm a",
        }),
        date,
      ),
    ).toBe("05/01/2024 01:30 PM");
  });

  it("catch path returns '' for an invalid Date (RangeError swallowed)", () => {
    // date-fns format() throws RangeError on an invalid date; formatDate must
    // swallow it and return an empty string rather than propagating.
    expect(formatDate(settingsStub(), new Date(NaN))).toBe("");
  });

  it("catch path returns '' for an invalid format token", () => {
    // A disallowed format token also throws inside date-fns (it rejects the
    // protected `D`/`YYYY` tokens) -> formatDate swallows it and returns ''.
    expect(formatDate(settingsStub(), new Date(2024, 0, 5), "D")).toBe("");
  });

  it("isoDateFormat constant is the expected stable token string", () => {
    expect(isoDateFormat).toBe("yyyy-MM-dd'T'HH:mm:ss");
  });
});

describe("getFreqValue", () => {
  it("maps each known frequency token to its RRule constant", () => {
    expect(getFreqValue("DAILY")).toBe(RRule.DAILY);
    expect(getFreqValue("WEEKLY")).toBe(RRule.WEEKLY);
    expect(getFreqValue("MONTHLY")).toBe(RRule.MONTHLY);
    expect(getFreqValue("YEARLY")).toBe(RRule.YEARLY);
    expect(getFreqValue("HOURLY")).toBe(RRule.HOURLY);
  });

  it("returns undefined for unknown / wrong-case / empty input (rrule footgun)", () => {
    // The contract is undefined-on-unknown — callers building an RRule options
    // object must defend against this (an undefined freq is invalid to rrule).
    expect(getFreqValue("daily")).toBeUndefined(); // case-sensitive
    expect(getFreqValue("MINUTELY")).toBeUndefined(); // unsupported by this map
    expect(getFreqValue("SECONDLY")).toBeUndefined();
    expect(getFreqValue("")).toBeUndefined();
    expect(getFreqValue("GARBAGE")).toBeUndefined();
    expect(getFreqValue(undefined as unknown as string)).toBeUndefined();
  });
});

describe("getWeekdayValue", () => {
  // The mapping is rrule's weekday integer convention: MO=0 .. SU=6.
  const cases: Array<[string, number]> = [
    ["MO", 0],
    ["TU", 1],
    ["WE", 2],
    ["TH", 3],
    ["FR", 4],
    ["SA", 5],
    ["SU", 6],
  ];

  it.each(cases)("maps %s -> %i (rrule weekday index)", (token, expected) => {
    expect(getWeekdayValue(token)).toBe(expected);
  });

  it("covers the full 0..6 range exactly once (no gaps, no dupes)", () => {
    const values = cases.map(([token]) => getWeekdayValue(token));
    expect([...values].sort((a, b) => (a as number) - (b as number))).toEqual([
      0, 1, 2, 3, 4, 5, 6,
    ]);
  });

  it("returns undefined for unknown / wrong-case / empty input", () => {
    expect(getWeekdayValue("mo")).toBeUndefined(); // case-sensitive
    expect(getWeekdayValue("MON")).toBeUndefined(); // not the 2-letter token
    expect(getWeekdayValue("")).toBeUndefined();
    expect(getWeekdayValue("XX")).toBeUndefined();
    expect(getWeekdayValue(undefined as unknown as string)).toBeUndefined();
  });
});
