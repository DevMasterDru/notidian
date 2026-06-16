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
// This net originally CHARACTERIZED an adversarial heuristic hazard: the
// value-based fall-through checked dates BEFORE numbers, and `new Date(String(n))`
// accepts bare numeric strings AND even real JS numbers (e.g. new Date('2024'),
// new Date(String(1)) are valid Dates), so value-based inference returned
// 'temporal' for arrays of plain numbers / numeric strings, SHADOWING
// 'quantitative'. That hazard is now RESOLVED by ADR 0035 (Option C/A hybrid):
// a value is a date candidate only when Number(String(v)) is NaN OR v is a Date,
// so numeric tokens short-circuit out of date-candidacy and infer 'quantitative',
// while genuine date strings ("2024-01-01") and Date objects stay 'temporal'.
// The assertions that previously LOCKED the temporal-shadow were flipped to
// 'quantitative' in the same commit as the fix; the genuine-date pins and the
// boolean-quantitative pin remain green.
//
// Note: explicit property metadata always WINS over values, so the value path
// is only the metadata-less fallback. Everything here is pure / offline.
// Every expectation was empirically captured.
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

  it("UNKNOWN property type with values uses value-based inference (numbers -> 'quantitative')", () => {
    // Confirms fall-through reaches the value path AND that numeric data infers
    // 'quantitative' there too: [1,2,3] are finite numbers -> 'quantitative'.
    // (ADR 0035: numbers prefer their numeric identity; previously this returned
    // 'temporal' because new Date(String(n)) coerced numbers into dates.)
    expect(inferEncodingType(prop("totally-unknown-type"), [1, 2, 3])).toBe(
      "quantitative"
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

  describe("numeric data infers 'quantitative' (ADR 0035: numbers prefer their numeric identity)", () => {
    // RESOLVED by ADR 0035 (Option C/A hybrid): a value is a date candidate only
    // when Number(String(v)) is NaN OR v is a Date. Numeric tokens short-circuit
    // out of date-candidacy, so they now reach the areNumbers branch and infer
    // 'quantitative' instead of being swallowed by `new Date(String(n))`.
    it("bare numeric STRINGS like '2024' infer as 'quantitative'", () => {
      // Number(String('2024')) is 2024 (finite) -> NOT a date candidate ->
      // reaches areNumbers -> 'quantitative'. (The years-as-numbers ambiguity is
      // resolved toward quantitative for the metadata-less path; a user who means
      // years sets a 'date' property or an explicit encoding type — see ADR 0035.)
      expect(inferEncodingType(undefined, ["2024", "2025"])).toBe(
        "quantitative"
      );
    });

    it("real JS NUMBERS [1, 2.5, -3] infer as 'quantitative'", () => {
      // The headline fix: arrays of genuine numbers now reach the 'quantitative'
      // branch via value inference. Number(String(n)) is finite for each, so they
      // short-circuit out of date-candidacy.
      expect(inferEncodingType(undefined, [1, 2.5, -3])).toBe("quantitative");
    });

    it("numbers with null/empty gaps -> 'quantitative' (gaps filtered, remainder numeric)", () => {
      expect(inferEncodingType(undefined, [1, null, 3, ""])).toBe(
        "quantitative"
      );
    });

    it("booleans infer 'quantitative' via the areNumbers branch (Number(true)===1)", () => {
      // Number(String('true')) is NaN, so booleans are date candidates, but
      // new Date('true')/new Date('false') are Invalid Date -> areDates is false
      // -> areNumbers: Number(true)===1 / Number(false)===0 -> 'quantitative'.
      // Unchanged by ADR 0035 (the boolean quantitative pin stays green).
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
