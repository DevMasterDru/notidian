/**
 * Characterization + edge-case net for the table footer / rollup summary math
 * (src/core/utils/contexts/predicate/aggregates.ts) — Notidian-0gy.
 *
 * `aggregates.ts` shipped with ZERO direct test coverage: no test imported
 * `calculateAggregate` or `aggregateFnTypes`, yet this is the exact arithmetic
 * that renders every table-footer rollup (count, sum, avg, min, max, range,
 * median, empty, notEmpty, the percentage* family, earliest, latest, dateRange,
 * complete, and friends). These
 * tests PIN the CURRENT shipped behavior — including the latent defects and the
 * surprising "blanked footer" results that fall out of the `parseProperty`
 * post-pass — so that any future change is a deliberate, reviewed decision
 * rather than a silent regression. They do NOT change src; real defects are
 * recorded as follow-up beads (see the end-of-file DEFECT LEDGER).
 *
 * Two layers are exercised:
 *   1. The pure per-function math in `aggregateFnTypes[fn].fn(values, colType)`
 *      — the deterministic core, called directly so we can pin NaN / Infinity /
 *      throw behavior that the wrapper masks.
 *   2. The full `calculateAggregate(settings, values, fn, col)` pipeline — which
 *      pre-maps values by `aggregateFn.type` (number -> parseFloat, date -> new
 *      Date), runs the fn, then runs a `parseProperty(..., valueType)` post-pass
 *      that can BLANK results whose `valueType` is not one parseProperty handles.
 *
 * Determinism notes:
 *   - Date cases use calendar dates pinned to an explicit local time-of-day
 *     (noon) and an explicit yyyy-MM-dd output format so they are
 *     timezone-stable. This matters because the Layer-2 pipeline pre-maps date
 *     values via `new Date(v)`, which treats a BARE "yyyy-MM-dd" string as UTC
 *     midnight; formatDate then renders in LOCAL time, which would shift the
 *     calendar day back one in any negative-UTC-offset zone. Anchoring inputs at
 *     noon-local (matching the Layer-1 `d` helper) avoids that off-by-one.
 *   - No test asserts wall-clock "today"; every expectation is derived from the
 *     inputs.
 */
import { calculateAggregate, aggregateFnTypes, msToDurationValue } from "./aggregates";
import { MakeMDSettings } from "shared/types/settings";
import { SpaceProperty } from "shared/types/mdb";

// ------------------------------------------------------------------------- //
// Fixtures                                                                    //
// ------------------------------------------------------------------------- //
const settings = {
  defaultDateFormat: "yyyy-MM-dd",
  defaultTimeFormat: "h:mm a",
} as MakeMDSettings;

const col = (type = "text", value?: string): SpaceProperty => ({
  name: "c",
  type,
  value,
});

// A date column whose JSON `value.format` pins the rendered output format so
// earliest/latest are timezone- and locale-stable.
const dateCol = (): SpaceProperty => col("date", JSON.stringify({ format: "yyyy-MM-dd" }));

// Pull the raw fn for a registered aggregate (asserts it exists first).
const fnOf = (name: string) => {
  const entry = aggregateFnTypes[name];
  expect(entry).toBeDefined();
  return entry.fn;
};

describe("aggregates.ts — registry shape & metadata", () => {
  it("exposes the full set of shipped aggregate functions", () => {
    // PIN the registry surface: if a function is added/removed/renamed this
    // breaks deliberately, prompting an update of the footer UI + these tests.
    expect(Object.keys(aggregateFnTypes).sort()).toEqual(
      [
        "avg",
        "complete",
        "count",
        "countUniques",
        "countValues",
        "dateRange",
        "earliest",
        "empty",
        "incomplete",
        "latest",
        "max",
        "median",
        "min",
        "notEmpty",
        "percentageComplete",
        "percentageEmpty",
        "percentageNotEmpty",
        "range",
        "sum",
        "values",
      ].sort()
    );
  });

  it("each entry pins a (type, valueType) contract", () => {
    // The `type` drives the pipeline pre-map (number->parseFloat, date->Date);
    // the `valueType` drives the parseProperty post-pass. Pin both.
    const meta = (k: string) => ({
      type: aggregateFnTypes[k].type,
      valueType: aggregateFnTypes[k].valueType,
    });
    expect(meta("values")).toEqual({ type: "any", valueType: "none" });
    expect(meta("sum")).toEqual({ type: "number", valueType: "number" });
    expect(meta("avg")).toEqual({ type: "number", valueType: "number" });
    expect(meta("median")).toEqual({ type: "number", valueType: "number" });
    expect(meta("count")).toEqual({ type: "any", valueType: "number" });
    expect(meta("countValues")).toEqual({ type: "any", valueType: "number" });
    expect(meta("countUniques")).toEqual({ type: "any", valueType: "number" });
    expect(meta("percentageEmpty")).toEqual({ type: "any", valueType: "string" });
    expect(meta("percentageNotEmpty")).toEqual({ type: "any", valueType: "string" });
    expect(meta("min")).toEqual({ type: "number", valueType: "number" });
    expect(meta("max")).toEqual({ type: "number", valueType: "number" });
    expect(meta("range")).toEqual({ type: "number", valueType: "number" });
    expect(meta("empty")).toEqual({ type: "any", valueType: "none" });
    expect(meta("notEmpty")).toEqual({ type: "any", valueType: "none" });
    expect(meta("earliest")).toEqual({ type: "date", valueType: "date" });
    expect(meta("latest")).toEqual({ type: "date", valueType: "date" });
    expect(meta("complete")).toEqual({ type: "boolean", valueType: "number" });
    expect(meta("incomplete")).toEqual({ type: "boolean", valueType: "number" });
    expect(meta("percentageComplete")).toEqual({ type: "boolean", valueType: "string" });
    expect(meta("dateRange")).toEqual({ type: "date", valueType: "duration" });
  });
});

// ========================================================================= //
// LAYER 1 — pure per-function math (called directly).                        //
// These pin NaN / Infinity / throw behavior that the wrapper masks.          //
// IMPORTANT: number-type fns are reached in the pipeline AFTER values are    //
// pre-mapped to numbers, but here we call them with raw inputs to expose the //
// internal parseFloat/isNaN handling and the divergent `range` value sets.   //
// ========================================================================= //
describe("aggregateFnTypes.fn — pure math (numeric)", () => {
  describe("sum", () => {
    const sum = fnOf("sum");
    it("adds numeric values", () => {
      expect(sum(["1", "2", "3"], "number")).toBe(6);
      expect(sum([1, 2, 3], "number")).toBe(6);
    });
    it("starts at 0 for an empty set", () => {
      expect(sum([], "number")).toBe(0);
    });
    it("drops parseFloat-NaN values (non-numeric strings)", () => {
      expect(sum([1, "a", 2], "number")).toBe(3);
      expect(sum(["a", "b"], "number")).toBe(0);
    });
    it("DEFECT-PIN: the `b ? a+b : a` reducer drops 0 (falsy) addends", () => {
      // reduce((a,b) => b ? a+b : a, 0): when b === 0 it contributes nothing.
      // 0 added to 0 is a no-op so [0,5] = 5; but it also means a literal 0 is
      // silently skipped rather than added (harmless for 0, but a code smell).
      expect(sum([0, 5], "number")).toBe(5);
      expect(sum([0, 0, 0], "number")).toBe(0);
    });
    it("parseFloat takes the leading numeric prefix of mixed strings", () => {
      // parseFloat('10px') === 10, so unit-suffixed strings are counted.
      expect(sum(["10px", "3"], "number")).toBe(13);
    });
  });

  describe("avg", () => {
    const avg = fnOf("avg");
    it("averages the numeric (non-NaN) subset", () => {
      expect(avg(["10", "20", "30"], "number")).toBe(20);
      expect(avg([2, 4], "number")).toBe(3);
    });
    it("ignores non-numeric strings in both sum and count", () => {
      // filtered = [10, 30]; (10+30)/2 = 20 — the 'x' affects neither side.
      expect(avg(["10", "x", "30"], "number")).toBe(20);
    });
    it("EDGE: empty input is 0/0 -> NaN (div-by-zero)", () => {
      expect(avg([], "number")).toBeNaN();
    });
    it("EDGE: all-non-numeric input filters to [] -> NaN", () => {
      expect(avg(["a", "b"], "number")).toBeNaN();
    });
  });

  describe("median", () => {
    const median = fnOf("median");
    it("returns the middle of an odd-length numeric set", () => {
      expect(median(["3", "1", "2"], "number")).toBe(2);
    });
    it("averages the two middle values of an even-length set", () => {
      expect(median(["1", "2", "3", "4"], "number")).toBe(2.5);
    });
    it("returns the single element of a singleton", () => {
      expect(median(["5"], "number")).toBe(5);
    });
    it("ignores non-numeric strings before computing", () => {
      expect(median(["1", "x", "3"], "number")).toBe(2);
    });
    it("EDGE: empty input THROWS (mathjs: 'median of an empty array')", () => {
      // The pure fn throws; the calculateAggregate wrapper catches it -> ''.
      expect(() => median([], "number")).toThrow();
    });
    it("EDGE: all-non-numeric input filters to [] then THROWS", () => {
      expect(() => median(["a", "b"], "number")).toThrow();
    });
  });

  describe("min / max", () => {
    const min = fnOf("min");
    const max = fnOf("max");
    it("returns the extreme of the numeric subset", () => {
      expect(min(["3", "1", "7"], "number")).toBe(1);
      expect(max(["3", "1", "7"], "number")).toBe(7);
    });
    it("returns the single element of a singleton", () => {
      expect(min(["42"], "number")).toBe(42);
      expect(max(["42"], "number")).toBe(42);
    });
    it("ignores non-numeric strings", () => {
      expect(min(["x", "5", "2"], "number")).toBe(2);
      expect(max(["x", "5", "2"], "number")).toBe(5);
    });
    it("EDGE: empty numeric subset -> Math.min()=Infinity, Math.max()=-Infinity", () => {
      // Math.min()/Math.max() with no args are the additive identities; this is
      // what the table footer would render via .toString().
      expect(min([], "number")).toBe(Infinity);
      expect(max([], "number")).toBe(-Infinity);
      expect(min(["a"], "number")).toBe(Infinity);
      expect(max(["a"], "number")).toBe(-Infinity);
    });
  });

  describe("range", () => {
    const range = fnOf("range");
    it("is max - min for an already-numeric set", () => {
      // pipeline pre-maps number cols to parseFloat, so the fn normally gets
      // real numbers; for those, range is correct.
      expect(range([3, 1, 7], "number")).toBe(6);
      expect(range([5], "number")).toBe(0);
    });
    it("DEFECT-PIN: min side filters RAW values without parseFloat-mapping", () => {
      // max side: Math.max(...v.map(parseFloat).filter(!isNaN))
      // min side: Math.min(...v.filter(f => !isNaN(f)))   <-- no parseFloat map.
      // For pure numeric strings the two value sets coincide (Math.min coerces),
      // so ['1','2','3'] => max 3, min 1 => 2 (looks correct):
      expect(range(["1", "2", "3"], "number")).toBe(2);
      // But a unit-suffixed string parseFloat's to a number on the MAX side yet
      // is DROPPED on the MIN side (isNaN('10px') === true), so the min set is
      // [3] only: max 10 - min 3 = 7, NOT max(10,3)-min(10,3)=7... it coincides
      // here, but diverges when the suffixed value is the minimum:
      expect(range(["10px", "3"], "number")).toBe(7);
      // Divergence made visible: '2x' parses to 2 (would be the min), but is
      // dropped from the min set, so min becomes 5 instead of 2:
      // max set = [parseFloat('2x')=2, 5, 9] -> 9; min set = ['5','9'] -> 5.
      expect(range(["2x", "5", "9"], "number")).toBe(4); // 9 - 5, NOT 9 - 2 (=7)
    });
    it("EDGE: empty subset -> (-Infinity) - (Infinity) = -Infinity", () => {
      expect(range([], "number")).toBe(-Infinity);
    });
  });
});

describe("aggregateFnTypes.fn — pure math (counting & presence)", () => {
  it("count is the raw length (includes empties & non-uniques)", () => {
    expect(fnOf("count")(["a", "", "b", "b"], "any")).toBe(4);
    expect(fnOf("count")([], "any")).toBe(0);
  });
  it("countValues flattens one level then counts", () => {
    expect(fnOf("countValues")([["a", "b"], ["c"]], "any")).toBe(3);
    expect(fnOf("countValues")(["a", "b"], "any")).toBe(2);
  });
  it("countUniques flattens then counts distinct (Set) members", () => {
    expect(fnOf("countUniques")([["a", "b"], ["a"]], "any")).toBe(2);
    expect(fnOf("countUniques")(["x", "x", "y"], "any")).toBe(2);
  });
  it("empty / notEmpty count blank vs non-blank rows", () => {
    expect(fnOf("empty")(["a", "", ""], "any")).toBe(2);
    expect(fnOf("notEmpty")(["a", "", ""], "any")).toBe(1);
  });
  it("empty treats null/undefined as blank (filter.empty uses value ?? '')", () => {
    expect(fnOf("empty")([null, undefined, "x"], "any")).toBe(2);
    expect(fnOf("notEmpty")([null, undefined, "x"], "any")).toBe(1);
  });
  it("values dedups (uniq) and joins with ', '", () => {
    expect(fnOf("values")(["a", "a", "b"], "any")).toBe("a, b");
    expect(fnOf("values")([], "any")).toBe("");
  });
});

describe("aggregateFnTypes.fn — pure math (percentages)", () => {
  it("percentageEmpty rounds (#empty / total * 100) + '%'", () => {
    expect(fnOf("percentageEmpty")(["a", "", ""], "any")).toBe("67%");
    expect(fnOf("percentageEmpty")(["", ""], "any")).toBe("100%");
    expect(fnOf("percentageEmpty")(["a", "b"], "any")).toBe("0%");
  });
  it("percentageNotEmpty is the complement", () => {
    expect(fnOf("percentageNotEmpty")(["a", "", ""], "any")).toBe("33%");
    expect(fnOf("percentageNotEmpty")(["a", "b"], "any")).toBe("100%");
  });
  it("EDGE: empty input -> divide-by-zero renders the literal 'NaN%'", () => {
    expect(fnOf("percentageEmpty")([], "any")).toBe("NaN%");
    expect(fnOf("percentageNotEmpty")([], "any")).toBe("NaN%");
  });
});

describe("aggregateFnTypes.fn — pure math (boolean / completion)", () => {
  it("complete counts rows loosely-equal to the string 'true'", () => {
    // f == 'true' — note JS: (true == 'true') === false, so a real boolean
    // true does NOT count; only the literal string 'true' does.
    expect(fnOf("complete")(["true", "false", "true"], "boolean")).toBe(2);
    expect(fnOf("complete")([true, "true", false], "boolean")).toBe(1);
  });
  it("incomplete counts everything NOT loosely-equal to 'true'", () => {
    expect(fnOf("incomplete")(["true", "false", ""], "boolean")).toBe(2);
    expect(fnOf("incomplete")([true, false], "boolean")).toBe(2); // neither == 'true'
  });
  it("percentageComplete rounds (#'true' / total * 100) + '%'", () => {
    expect(fnOf("percentageComplete")(["true", "false"], "boolean")).toBe("50%");
    expect(fnOf("percentageComplete")(["true", "true"], "boolean")).toBe("100%");
  });
  it("EDGE: percentageComplete of [] -> 'NaN%'", () => {
    expect(fnOf("percentageComplete")([], "boolean")).toBe("NaN%");
  });
});

describe("aggregateFnTypes.fn — pure math (dates)", () => {
  const d = (s: string) => new Date(s + "T12:00:00"); // noon-local, tz-stable
  it("earliest returns the min Date", () => {
    const r = fnOf("earliest")([d("2020-05-10"), d("2019-01-01")], "date") as Date;
    expect(r.getTime()).toBe(d("2019-01-01").getTime());
  });
  it("latest returns the max Date", () => {
    const r = fnOf("latest")([d("2020-05-10"), d("2019-01-01")], "date") as Date;
    expect(r.getTime()).toBe(d("2020-05-10").getTime());
  });
  it("dateRange returns the millisecond span between min and max", () => {
    const span = fnOf("dateRange")([d("2020-01-01"), d("2020-01-11")], "date");
    expect(span).toBe(10 * 24 * 60 * 60 * 1000);
  });
  it("EDGE: earliest/latest of [] collapse to Date(Infinity)/Date(-Infinity) -> Invalid Date", () => {
    const e = fnOf("earliest")([], "date") as Date;
    const l = fnOf("latest")([], "date") as Date;
    expect(Number.isNaN(e.getTime())).toBe(true);
    expect(Number.isNaN(l.getTime())).toBe(true);
  });
  it("EDGE: dateRange of [] is -Infinity (Math.max([])=-Infinity, Math.min([])=Infinity)", () => {
    // (-Infinity) - (Infinity) === -Infinity, mirroring the numeric `range` edge.
    // The pure fn is unchanged; calculateAggregate now floors this non-finite
    // span to a zero duration (see msToDurationValue tests + the dateRange L2 tests).
    expect(fnOf("dateRange")([], "date")).toBe(-Infinity);
  });
});

describe("msToDurationValue — ms span -> { values } duration object (Notidian-i9f)", () => {
  // Bridges dateRange's numeric (ms) fn result to its 'duration' valueType so
  // parseProperty's duration branch can render it. Pin the decomposition + the
  // non-finite/negative flooring that keeps empty-set spans from leaking
  // -Infinity into the footer.
  const ms = (d = 0, h = 0, m = 0, s = 0) =>
    ((d * 24 + h) * 60 + m) * 60 * 1000 + s * 1000;
  it("decomposes a span into days/hours/minutes/seconds (each unit modulo)", () => {
    expect(msToDurationValue(ms(10)).values).toEqual({ days: 10, hours: 0, minutes: 0, seconds: 0 });
    expect(msToDurationValue(ms(1, 2, 3, 4)).values).toEqual({ days: 1, hours: 2, minutes: 3, seconds: 4 });
    expect(msToDurationValue(ms(0, 25)).values).toEqual({ days: 1, hours: 1, minutes: 0, seconds: 0 });
  });
  it("floors sub-second remainder (only whole seconds surface)", () => {
    expect(msToDurationValue(1500).values).toEqual({ days: 0, hours: 0, minutes: 0, seconds: 1 });
  });
  it("floors non-finite / negative / zero spans to all-zero (no -Infinity/NaN leak)", () => {
    const zero = { days: 0, hours: 0, minutes: 0, seconds: 0 };
    expect(msToDurationValue(0).values).toEqual(zero);
    expect(msToDurationValue(-Infinity).values).toEqual(zero);
    expect(msToDurationValue(-5).values).toEqual(zero);
    expect(msToDurationValue(NaN).values).toEqual(zero);
    expect(msToDurationValue(Infinity).values).toEqual(zero);
  });
});

// ========================================================================= //
// LAYER 2 — full calculateAggregate pipeline.                               //
// Pins the pre-map (parseFloat / new Date), the fn, AND the parseProperty   //
// post-pass that BLANKS results whose valueType parseProperty cannot render. //
// ========================================================================= //
describe("calculateAggregate — numeric rollups (end to end)", () => {
  it("avg / sum / median / min / max / range render as numeric strings", () => {
    expect(calculateAggregate(settings, ["10", "20", "30"], "avg", col("number"))).toBe("20");
    expect(calculateAggregate(settings, ["1", "2", "3"], "sum", col("number"))).toBe("6");
    expect(calculateAggregate(settings, ["1", "2", "3", "4"], "median", col("number"))).toBe("2.5");
    expect(calculateAggregate(settings, ["3", "1", "7"], "min", col("number"))).toBe("1");
    expect(calculateAggregate(settings, ["3", "1", "7"], "max", col("number"))).toBe("7");
    expect(calculateAggregate(settings, ["3", "1", "7"], "range", col("number"))).toBe("6");
  });
  it("EDGE: avg of [] propagates NaN to the footer string 'NaN'", () => {
    expect(calculateAggregate(settings, [], "avg", col("number"))).toBe("NaN");
  });
  it("EDGE: avg of all-non-numeric propagates 'NaN'", () => {
    expect(calculateAggregate(settings, ["a", "b"], "avg", col("number"))).toBe("NaN");
  });
  it("EDGE: min/max/range of [] render the Infinity identities as strings", () => {
    expect(calculateAggregate(settings, [], "min", col("number"))).toBe("Infinity");
    expect(calculateAggregate(settings, [], "max", col("number"))).toBe("-Infinity");
    expect(calculateAggregate(settings, [], "range", col("number"))).toBe("-Infinity");
  });
  it("EDGE: median of [] is caught (mathjs throw) and rendered blank", () => {
    expect(calculateAggregate(settings, [], "median", col("number"))).toBe("");
  });
  it("sum of [] is the additive identity '0'", () => {
    expect(calculateAggregate(settings, [], "sum", col("number"))).toBe("0");
  });
});

describe("calculateAggregate — count family (end to end)", () => {
  it("count is the row length as a string", () => {
    expect(calculateAggregate(settings, ["a", "b", "c"], "count", col())).toBe("3");
    expect(calculateAggregate(settings, [], "count", col())).toBe("0");
  });
  it("countValues / countUniques flatten then count", () => {
    expect(calculateAggregate(settings, [["a", "b"], ["c"]], "countValues", col())).toBe("3");
    expect(calculateAggregate(settings, [["a", "b"], ["a"]], "countUniques", col())).toBe("2");
  });
});

describe("calculateAggregate — DEFECT-PIN: parseProperty post-pass blanks several footers", () => {
  // For these the fn produces a meaningful value (a percent string, a join, or
  // a count) but parseProperty("", value, valueType) returns '' because the
  // valueType ('none' / 'string') hits no handled switch case. The footer is
  // therefore rendered EMPTY despite a non-empty underlying computation.
  it("values -> '' (valueType 'none' not handled by parseProperty)", () => {
    expect(calculateAggregate(settings, ["a", "a", "b"], "values", col())).toBe("");
  });
  it("empty / notEmpty -> '' (valueType 'none')", () => {
    expect(calculateAggregate(settings, ["a", "", ""], "empty", col())).toBe("");
    expect(calculateAggregate(settings, ["a", "", ""], "notEmpty", col())).toBe("");
  });
  it("percentageEmpty / percentageNotEmpty -> '' (valueType 'string')", () => {
    expect(calculateAggregate(settings, ["a", "", ""], "percentageEmpty", col())).toBe("");
    expect(calculateAggregate(settings, ["a", "", ""], "percentageNotEmpty", col())).toBe("");
  });
  it("percentageComplete -> '' (valueType 'string')", () => {
    expect(calculateAggregate(settings, ["true", "false"], "percentageComplete", col("boolean"))).toBe("");
  });
});

describe("calculateAggregate — boolean completion (valueType number survives)", () => {
  it("complete / incomplete render numeric counts", () => {
    expect(calculateAggregate(settings, ["true", "false", "true"], "complete", col("boolean"))).toBe("2");
    expect(calculateAggregate(settings, ["true", "false", "true"], "incomplete", col("boolean"))).toBe("1");
  });
});

describe("calculateAggregate — date rollups (end to end)", () => {
  it("earliest / latest format the extreme date via the column format", () => {
    // TZ-STABLE INPUTS: the pipeline pre-map (aggregates.ts) does `new Date(v)`,
    // and JS parses a bare "yyyy-MM-dd" string as UTC midnight; formatDate then
    // renders via date-fns format() in LOCAL time, shifting the calendar day back
    // one in any negative-UTC-offset zone (the Americas). Anchoring each input at
    // explicit noon-local (the same mitigation as the Layer-1 `d` helper, line
    // ~314, and the sibling date.test.ts convention) keeps the day fixed in every
    // timezone, so this characterization test is a real regression net and not a
    // wall-clock-dependent flaky gate.
    const earliest = ["2020-05-10T12:00:00", "2019-01-01T12:00:00"];
    const latest = ["2020-05-10T12:00:00", "2019-01-01T12:00:00"];
    expect(
      calculateAggregate(settings, earliest, "earliest", dateCol())
    ).toBe("2019-01-01");
    expect(
      calculateAggregate(settings, latest, "latest", dateCol())
    ).toBe("2020-05-10");
  });
  it("dateRange renders a human duration string (Notidian-i9f / DEFECT D3 FIXED)", () => {
    // Previously: dateRange.fn returns a NUMBER (ms span) but valueType is
    // 'duration', so parseProperty's duration branch did `value.values` on a
    // raw number -> TypeError -> caught -> '' (footer always blank).
    // Now: calculateAggregate shapes the ms span into the { values: {...} }
    // object the duration branch consumes, so a 10-day span renders "10 days".
    expect(
      calculateAggregate(settings, ["2020-01-11", "2020-01-01"], "dateRange", col("date"))
    ).toBe("10 days");
  });
  it("dateRange renders multiple non-zero units, largest-first, comma-joined", () => {
    // A span of 1 day, 2 hours, 3 minutes, 4 seconds renders every non-zero unit.
    const start = new Date("2020-01-01T00:00:00.000Z").toISOString();
    const end = new Date("2020-01-02T02:03:04.000Z").toISOString();
    expect(calculateAggregate(settings, [start, end], "dateRange", col("date"))).toBe(
      "1 days, 2 hours, 3 minutes, 4 seconds"
    );
  });
  it("dateRange of identical/empty spans renders blank (no math-identity leak)", () => {
    // Identical dates -> 0ms span -> all-zero units -> '' (duration branch drops
    // count==0 units). Empty set -> dateRange fn -> -Infinity -> msToDurationValue
    // floors non-finite/negative to 0 -> '' rather than leaking '-Infinity'.
    expect(calculateAggregate(settings, ["2020-01-01", "2020-01-01"], "dateRange", col("date"))).toBe("");
    expect(calculateAggregate(settings, [], "dateRange", col("date"))).toBe("");
  });
});

describe("calculateAggregate — unknown function & guard rails", () => {
  it("returns null for an unregistered aggregate name (early-out)", () => {
    expect(calculateAggregate(settings, ["1", "2"], "nope", col("number"))).toBeNull();
    expect(calculateAggregate(settings, ["1", "2"], "", col("number"))).toBeNull();
  });
  it("never throws out of the wrapper even for hostile/empty input", () => {
    const names = Object.keys(aggregateFnTypes);
    for (const name of names) {
      expect(() => calculateAggregate(settings, [], name, col("number"))).not.toThrow();
      expect(() => calculateAggregate(settings, ["a", null, undefined], name, col())).not.toThrow();
    }
  });
});

describe("calculateAggregate — flex column unwrapping", () => {
  it("flex cols unwrap the JSON {value} envelope before aggregating", () => {
    // col.type === 'flex' -> values are parseFlexValue'd to their inner .value
    // BEFORE the number pre-map; so a flex-wrapped numeric string still avgs.
    const flexVals = [JSON.stringify({ value: "10" }), JSON.stringify({ value: "20" })];
    expect(calculateAggregate(settings, flexVals, "avg", col("flex"))).toBe("15");
  });
  it("flex unwrap of malformed JSON yields undefined inner -> NaN avg", () => {
    // safelyParseJSON('not json') -> undefined -> .value undefined -> parseFloat
    // -> NaN -> filtered out -> avg of [] -> NaN.
    expect(calculateAggregate(settings, ["not json", "also not"], "avg", col("flex"))).toBe("NaN");
  });
});

/**
 * ----------------------------------------------------------------------------
 * DEFECT LEDGER (pinned, NOT fixed here — Q1 characterization only)
 * ----------------------------------------------------------------------------
 * D1. `range` min-side bug: the min subexpression filters RAW values with
 *     `isNaN` WITHOUT a `parseFloat` map, while the max side maps with
 *     parseFloat. For numeric strings that lose their numeric-ness under raw
 *     isNaN (e.g. '2x', '10px'), the min and max operate on DIVERGENT value
 *     sets, so `range` can be wrong. Masked in the normal pipeline only because
 *     number cols are pre-mapped to real numbers. Pinned in the range
 *     DEFECT-PIN test.
 *
 * D2. parseProperty post-pass BLANKS footers whose `valueType` is 'none' or
 *     'string' (values, empty, notEmpty, percentageEmpty, percentageNotEmpty,
 *     percentageComplete). The arithmetic is computed correctly, then thrown
 *     away by `parseProperty("", value, valueType)` returning '' for unhandled
 *     types. These footers always render empty in the table UI.
 *
 * D3. [FIXED — Notidian-i9f] `dateRange` valueType 'duration' WAS incompatible
 *     with its numeric (ms) result: parseProperty's duration branch dereferenced
 *     `value.values` on a number, threw, was caught, and the footer rendered ''.
 *     calculateAggregate now shapes the ms span into the { values: {...} } object
 *     the duration branch consumes (msToDurationValue), so dateRange footers
 *     render a human duration ("10 days"). See the dateRange Layer-2 tests above.
 *
 *     NOTE for the D4 empty-set edge: dateRange of [] -> -Infinity is now floored
 *     to a zero span by msToDurationValue, so it renders '' (no -Infinity leak),
 *     independent of the duration-branch throw that previously swallowed it.
 *
 * D4. Empty-set edge values leak math identities into the rendered footer:
 *     avg -> 'NaN', min -> 'Infinity', max/range -> '-Infinity' instead of a
 *     blank/dash. (median is the only empty-safe numeric one, because its throw
 *     is caught -> ''. dateRange is now ALSO empty-safe: its -Infinity span is
 *     floored to a zero duration by msToDurationValue -> '' — see D3.)
 *
 * D5. `sum` reducer `(a,b) => b ? a+b : a` skips falsy (0) addends. Harmless
 *     for the value 0, but a latent foot-gun if the reducer is reused.
 *
 * Follow-up beads filed for the user-visible ones (D1, D2, D3, D4) — see
 * Notidian-0gy close notes. This file PINS current behavior so those fixes
 * become deliberate, test-gated changes.
 * ----------------------------------------------------------------------------
 */
