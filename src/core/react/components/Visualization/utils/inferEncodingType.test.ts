import {
  inferEncodingType,
  isContinuousScale,
  ensureCorrectEncodingType,
} from "./inferEncodingType";
import { SpaceProperty } from "shared/types/mdb";

// ---------------------------------------------------------------------------
// DEPTH (Q1) — adversarial characterization net for the Visualization
// encoding-type inference core (Notidian-5hs). All three exported functions
// are PURE and DETERMINISTIC; the entire Visualization subtree previously had
// ZERO test coverage. inferEncodingType drives whether a field is treated as
// quantitative / temporal / nominal, which decides scale type, axis behaviour,
// and aggregation defaults — so its switch exhaustiveness and value-based
// fall-through heuristics are load-bearing.
//
// CHARACTERIZATION net, not a correction. The most important pinned fact is an
// adversarial HEURISTIC HAZARD, not a crash: the value-based fall-through checks
// dates BEFORE numbers, and `new Date(String(n))` accepts bare numeric strings
// AND even real JS numbers (e.g. new Date('2024'), new Date(String(1)) are
// valid Dates). Consequently, value-based inference returns 'temporal' for
// arrays of plain numbers / numeric strings, SHADOWING 'quantitative'. The only
// value path that actually reaches 'quantitative' is numbers that are NOT
// date-parseable (in practice: booleans, since Number(true)===1 but
// new Date('true') is Invalid Date). This is deterministic and crash-free, so
// it is LOCKED here and a follow-up bead tracks the ordering as a design issue;
// it is NOT silently "fixed" in production code under this Q1 test bead.
//
// Note: explicit property metadata always WINS over values, so this hazard only
// bites the no-property-metadata path. Everything here is pure / offline.
// Every expectation was empirically captured before pinning.
// ---------------------------------------------------------------------------

const prop = (type: string): SpaceProperty => ({ name: "f", type });

describe("inferEncodingType — property-metadata switch (property wins over values)", () => {
  it("'number' -> 'quantitative'", () => {
    expect(inferEncodingType(prop("number"))).toBe("quantitative");
  });

  it("'date' -> 'temporal'", () => {
    expect(inferEncodingType(prop("date"))).toBe("temporal");
  });

  it("'date-multi' -> 'temporal'", () => {
    expect(inferEncodingType(prop("date-multi"))).toBe("temporal");
  });

  it.each([
    "boolean",
    "option",
    "option-multi",
    "tags",
    "tags-multi",
    "link",
    "link-multi",
    "file",
    "text",
    "tag",
    "image",
  ])("'%s' -> 'nominal'", (t) => {
    expect(inferEncodingType(prop(t))).toBe("nominal");
  });

  it("property metadata OVERRIDES contradictory values ('number' prop + word values stays quantitative)", () => {
    expect(inferEncodingType(prop("number"), ["apple", "banana"])).toBe(
      "quantitative"
    );
  });

  it("property metadata OVERRIDES values ('text' prop + numeric values stays nominal)", () => {
    expect(inferEncodingType(prop("text"), [1, 2, 3])).toBe("nominal");
  });

  it("UNKNOWN property type falls THROUGH to value-based inference (no values -> 'nominal')", () => {
    expect(inferEncodingType(prop("totally-unknown-type"))).toBe("nominal");
  });

  it("UNKNOWN property type with values uses value-based inference (numbers are date-parseable -> 'temporal')", () => {
    // Confirms fall-through reaches the value path AND that the temporal-shadow
    // hazard applies there too: [1,2,3] are date-parseable -> 'temporal'.
    expect(inferEncodingType(prop("totally-unknown-type"), [1, 2, 3])).toBe(
      "temporal"
    );
  });
});

describe("inferEncodingType — value-based fall-through (no property metadata)", () => {
  it("undefined property + undefined values -> 'nominal'", () => {
    expect(inferEncodingType(undefined, undefined)).toBe("nominal");
  });

  it("undefined property + empty array -> 'nominal'", () => {
    expect(inferEncodingType(undefined, [])).toBe("nominal");
  });

  it("all-null / all-empty values -> 'nominal' (nonNullValues.length === 0)", () => {
    expect(inferEncodingType(undefined, [null, undefined, ""])).toBe("nominal");
  });

  it("Date object values -> 'temporal'", () => {
    expect(
      inferEncodingType(undefined, [new Date("2024-01-01"), new Date("2024-02-01")])
    ).toBe("temporal");
  });

  it("ISO date strings -> 'temporal'", () => {
    expect(inferEncodingType(undefined, ["2024-01-01", "2024-02-01"])).toBe(
      "temporal"
    );
  });

  it("plain word values -> 'nominal'", () => {
    expect(inferEncodingType(undefined, ["apple", "banana"])).toBe("nominal");
  });

  it("mixed number + word -> 'nominal' (every() fails both date and number checks)", () => {
    expect(inferEncodingType(undefined, [1, "apple"])).toBe("nominal");
  });

  describe("ADVERSARIAL: temporal SHADOWS quantitative for numeric data (LOCKED hazard)", () => {
    it("bare numeric STRINGS like '2024' infer as 'temporal', not 'quantitative'", () => {
      // new Date('2024') is a valid Date -> the areDates check (which runs first)
      // returns true -> 'temporal'. The number that '2024' clearly is never wins.
      expect(inferEncodingType(undefined, ["2024", "2025"])).toBe("temporal");
    });

    it("real JS NUMBERS [1, 2.5, -3] also infer as 'temporal' (new Date(String(n)) is valid)", () => {
      // The single most surprising pinned fact: arrays of genuine numbers do NOT
      // reach the 'quantitative' branch via value inference, because each number
      // stringifies to a date-parseable token. To get quantitative for numeric
      // data, the caller MUST supply property metadata of type 'number'.
      expect(inferEncodingType(undefined, [1, 2.5, -3])).toBe("temporal");
    });

    it("numbers with null/empty gaps still -> 'temporal' (gaps filtered, remainder date-parseable)", () => {
      expect(inferEncodingType(undefined, [1, null, 3, ""])).toBe("temporal");
    });

    it("the ONLY value-based path to 'quantitative': numbers that are NOT date-parseable (booleans)", () => {
      // Number(true)===1, Number(false)===0, but new Date('true')/new Date('false')
      // are Invalid Date -> areDates is false -> areNumbers is true -> 'quantitative'.
      // This pins the narrow surviving quantitative value-path.
      expect(inferEncodingType(undefined, [true, false])).toBe("quantitative");
    });
  });
});

describe("isContinuousScale", () => {
  it("'quantitative' is continuous", () => {
    expect(isContinuousScale("quantitative")).toBe(true);
  });
  it("'temporal' is continuous", () => {
    expect(isContinuousScale("temporal")).toBe(true);
  });
  it("'nominal' is NOT continuous", () => {
    expect(isContinuousScale("nominal")).toBe(false);
  });
  it("'ordinal' is NOT continuous", () => {
    expect(isContinuousScale("ordinal")).toBe(false);
  });
});

describe("ensureCorrectEncodingType", () => {
  it("fills in a missing type from inference (number prop -> quantitative)", () => {
    const out = ensureCorrectEncodingType({ field: "x" }, prop("number"));
    expect(out).toEqual({ field: "x", type: "quantitative" });
  });

  it("fills in a missing type using value-based inference when no property given", () => {
    const out = ensureCorrectEncodingType(
      { field: "x" },
      undefined,
      ["apple", "banana"]
    );
    expect(out).toEqual({ field: "x", type: "nominal" });
  });

  it("CORRECTS a numeric field mis-typed as nominal -> the inferred quantitative", () => {
    // number/date props with a nominal/ordinal explicit type get re-inferred so
    // scatter axes are not treated categorically.
    const out = ensureCorrectEncodingType(
      { field: "x", type: "nominal" },
      prop("number")
    );
    expect(out).toEqual({ field: "x", type: "quantitative" });
  });

  it("CORRECTS a date field mis-typed as ordinal -> temporal", () => {
    const out = ensureCorrectEncodingType(
      { field: "d", type: "ordinal" },
      prop("date")
    );
    expect(out).toEqual({ field: "d", type: "temporal" });
  });

  it("CORRECTS a date-multi field mis-typed as nominal -> temporal", () => {
    const out = ensureCorrectEncodingType(
      { field: "d", type: "nominal" },
      prop("date-multi")
    );
    expect(out).toEqual({ field: "d", type: "temporal" });
  });

  it("PRESERVES an existing quantitative type on a number field (no needless rewrite)", () => {
    const out = ensureCorrectEncodingType(
      { field: "x", type: "quantitative" },
      prop("number")
    );
    expect(out).toEqual({ field: "x", type: "quantitative" });
  });

  it("PRESERVES a nominal type on a text field (text is not in the correction guard)", () => {
    // The correction guard only fires for number/date/date-multi props; a text
    // prop with an explicit nominal type is left untouched.
    const out = ensureCorrectEncodingType(
      { field: "name", type: "nominal" },
      prop("text")
    );
    expect(out).toEqual({ field: "name", type: "nominal" });
  });

  it("PRESERVES a temporal type explicitly set on a number field (guard only fires for nominal/ordinal)", () => {
    // A number prop whose encoding.type is already temporal is NOT in the
    // nominal/ordinal correction set, so it is kept as-is. Pins guard scope.
    const out = ensureCorrectEncodingType(
      { field: "x", type: "temporal" },
      prop("number")
    );
    expect(out).toEqual({ field: "x", type: "temporal" });
  });

  it("does not mutate the input encoding object (returns a fresh object)", () => {
    const input = { field: "x" };
    const out = ensureCorrectEncodingType(input, prop("number"));
    expect(out).not.toBe(input);
    expect(input).toEqual({ field: "x" });
  });
});
