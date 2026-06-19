import { compareSortValues, formulas } from "./formulas";

// ---------------------------------------------------------------------------
// DEPTH net (Notidian-398r): adversarial + characterization coverage for the
// VALUE-computation helpers in formulas.ts — the computed-column values the
// table owner actually reads. The sibling formulas.test.ts covers the rawArgs
// GUARD branches; parser.test.ts covers the mathjs end-to-end engine path.
// Neither exercises these pure helpers directly. This file:
//
//   1. pins the format() coercion net that slice/substring/startsWith/contains/
//      lower/upper/replace funnel through (degrade-gracefully-to-"" contract);
//   2. LOCKS the fail-soft regex behavior — a malformed user pattern must not
//      crash the computed cell (test->false, match->null, replace->no-op);
//   3. LOCKS the sort fix — non-mutating + a correct total-order comparator
//      (the legacy `(a,b)=>b-a` mutated the input and NaN-poisoned non-numbers);
//   4. characterizes the date helpers' unknown-unit/format fall-through to days
//      and their startsWith-prefix unit matching;
//   5. exercises the array/number helpers on empty + off-type inputs.
//
// All offline + deterministic (no real mathjs runtime, no vault, fixed dates).
// ---------------------------------------------------------------------------

// `formulas` is typed for the mathjs import; cast to a loose record so we can
// call the value-helpers with adversarial off-type inputs the way the engine
// can in practice (a computed cell can hold a number, Date, string, or object).
const fx = formulas as unknown as Record<string, (...args: any[]) => any>;

describe("format() coercion net (the degrade-gracefully funnel)", () => {
  it("returns a primitive string unchanged", () => {
    expect(fx.format("hello")).toBe("hello");
    expect(fx.format("")).toBe("");
  });

  it("returns a boxed String's value (instanceof String branch)", () => {
    // eslint-disable-next-line no-new-wrappers
    const boxed = new String("boxed");
    expect(fx.format(boxed)).toBe(boxed);
  });

  it("formats a Date as yyyy-MM-dd", () => {
    expect(fx.format(new Date(2024, 0, 2))).toBe("2024-01-02");
    expect(fx.format(new Date(2023, 11, 31))).toBe("2023-12-31");
  });

  it("formats a number via toFixed(0) — truncating/rounding to an integer string", () => {
    expect(fx.format(3)).toBe("3");
    expect(fx.format(3.4)).toBe("3");
    expect(fx.format(3.6)).toBe("4");
    expect(fx.format(0)).toBe("0");
    expect(fx.format(-2.4)).toBe("-2");
    expect(fx.format(-2.5)).toBe("-3"); // toFixed rounds half away from zero
  });

  it("returns an object's .path when present", () => {
    expect(fx.format({ path: "notes/a.md" })).toBe("notes/a.md");
    expect(fx.format({ path: "x", other: 1 })).toBe("x");
  });

  it("degrades everything else to '' (null/undefined/boolean/path-less object)", () => {
    expect(fx.format(null)).toBe("");
    expect(fx.format(undefined)).toBe("");
    expect(fx.format(true)).toBe("");
    expect(fx.format(false)).toBe("");
    expect(fx.format({})).toBe("");
    expect(fx.format({ notPath: 1 })).toBe("");
    expect(fx.format([])).toBe(""); // array has no .path, not string/Date/number
  });
});

describe("string helpers funnel non-string input through format()", () => {
  it("slice / substring coerce non-strings first (Date -> yyyy-MM-dd)", () => {
    expect(fx.slice(new Date(2024, 0, 2), 0, 4)).toBe("2024");
    expect(fx.substring(new Date(2024, 0, 2), 5)).toBe("01-02");
    expect(fx.substring(new Date(2024, 0, 2), 0, 4)).toBe("2024");
  });

  it("slice on a null value coerces to '' and returns ''", () => {
    expect(fx.slice(null, 0, 3)).toBe("");
  });

  it("startsWith / contains coerce BOTH operands via format()", () => {
    expect(fx.startsWith("hello world", "hello")).toBe(true);
    expect(fx.startsWith(new Date(2024, 0, 2), "2024")).toBe(true);
    expect(fx.contains("abcdef", "cde")).toBe(true);
    expect(fx.contains(12345, 234)).toBe(true); // both formatted: "12345".includes("234")
    expect(fx.contains(null, "x")).toBe(false); // "".includes("x")
  });

  it("lower / upper coerce then case-fold", () => {
    expect(fx.lower("ABC")).toBe("abc");
    expect(fx.upper("abc")).toBe("ABC");
    expect(fx.lower(new Date(2024, 0, 2))).toBe("2024-01-02");
    expect(fx.upper(null)).toBe(""); // format(null) -> ""
  });
});

describe("repeat: format() coercion + RangeError guard (Notidian-y0wm, LOCKED FIX)", () => {
  it("happy path is unchanged", () => {
    expect(fx.repeat("ab", 3)).toBe("ababab");
    expect(fx.repeat("x", 0)).toBe(""); // zero count -> empty string (native behavior)
    expect(fx.repeat("ab", 1)).toBe("ab");
  });

  it("coerces a non-string str via format() before repeating (no TypeError)", () => {
    // A computed cell can hold a number; the legacy code did number.repeat -> TypeError.
    expect(() => fx.repeat(5, 3)).not.toThrow();
    expect(fx.repeat(5, 3)).toBe("555"); // format(5) -> "5", repeated 3x
    expect(fx.repeat(new Date(2024, 0, 2), 2)).toBe("2024-01-022024-01-02");
    expect(fx.repeat(null, 3)).toBe(""); // format(null) -> "", repeated -> ""
  });

  it("fails SOFT to '' on a NEGATIVE count (legacy threw RangeError)", () => {
    // Runtime-confirmed: ('ab').repeat(-1) throws RangeError "Invalid count value".
    expect(() => fx.repeat("ab", -1)).not.toThrow();
    expect(fx.repeat("ab", -1)).toBe("");
    expect(fx.repeat("ab", -100)).toBe("");
  });

  it("fails SOFT to '' on a NON-FINITE count (Infinity / -Infinity / NaN)", () => {
    // ('ab').repeat(Infinity) throws RangeError; NaN coerces to 0 natively but we
    // normalize all non-sane counts to the same defined '' no-op.
    expect(() => fx.repeat("ab", Infinity)).not.toThrow();
    expect(fx.repeat("ab", Infinity)).toBe("");
    expect(fx.repeat("ab", -Infinity)).toBe("");
    expect(fx.repeat("ab", NaN)).toBe("");
  });

  it("fails SOFT to '' on an OVER-CAP count (legacy threw RangeError near 2^28+)", () => {
    // ('ab').repeat(2**30) throws RangeError "Invalid count value" — and even a
    // "valid" enormous count would OOM the render, so the cap returns '' instead.
    expect(() => fx.repeat("ab", 2 ** 30)).not.toThrow();
    expect(fx.repeat("ab", 2 ** 30)).toBe("");
    expect(fx.repeat("a", 10001)).toBe(""); // just over the defensive cap
  });

  it("floors a fractional count the way native ToInteger does (no throw)", () => {
    expect(fx.repeat("ab", 2.9)).toBe("abab"); // floor(2.9) = 2
    expect(fx.repeat("ab", 0.5)).toBe(""); // floor(0.5) = 0
  });
});

describe("pad: format() coercion so a numeric value stops crashing (Notidian-y0wm, LOCKED FIX)", () => {
  it("happy path is unchanged", () => {
    expect(fx.pad("7", 3, "0")).toBe("007");
    expect(fx.pad("abc", 5, "-")).toBe("--abc");
    expect(fx.pad("already long", 3, "0")).toBe("already long"); // length <= str: unchanged
  });

  it("coerces a numeric str via format() before padStart (legacy threw TypeError)", () => {
    // Runtime-confirmed: (5).padStart is undefined -> pad(5, 3, '0') threw TypeError.
    expect(() => fx.pad(5, 3, "0")).not.toThrow();
    expect(fx.pad(5, 3, "0")).toBe("005"); // format(5) -> "5", padStart(3,"0")
    expect(fx.pad(42, 5, "0")).toBe("00042");
  });

  it("coerces a Date / null str via format() (no crash)", () => {
    expect(() => fx.pad(new Date(2024, 0, 2), 12, "*")).not.toThrow();
    expect(fx.pad(new Date(2024, 0, 2), 12, "*")).toBe("**2024-01-02"); // "2024-01-02" -> 12
    expect(fx.pad(null, 3, "0")).toBe("000"); // format(null) -> "", padded to 3
  });

  it("fails SOFT on a NON-FINITE length (Infinity / -Infinity / NaN) — padStart THROWS on Infinity", () => {
    // Runtime-confirmed: ('ab').padStart(Infinity,'0') throws RangeError
    // "Invalid string length". A formula like pad(x, otherProp/0, '0') passes
    // Infinity (5/0 === Infinity in JS) straight into padStart. NaN already
    // no-ops natively; we normalize all non-finite lengths to the same defined
    // no-op (return the coerced string unchanged).
    expect(() => fx.pad("7", Infinity, "0")).not.toThrow();
    expect(fx.pad("7", Infinity, "0")).toBe("7");
    expect(() => fx.pad("7", -Infinity, "0")).not.toThrow();
    expect(fx.pad("7", -Infinity, "0")).toBe("7");
    expect(() => fx.pad("7", NaN, "0")).not.toThrow();
    expect(fx.pad("7", NaN, "0")).toBe("7");
  });

  it("fails SOFT on an OVER-CAP length (padStart THROWS near 2^30; even a valid 1e8 OOMs)", () => {
    // ('ab').padStart(2**30,'0') throws RangeError; a "valid" enormous length
    // like 1e8 allocates a ~100MB string that freezes the render. The defensive
    // cap (mirrors repeat()'s n > 10000) returns the coerced string unchanged.
    expect(() => fx.pad("7", 2 ** 30, "0")).not.toThrow();
    expect(fx.pad("7", 2 ** 30, "0")).toBe("7");
    expect(() => fx.pad("x", 1e9, "0")).not.toThrow();
    expect(fx.pad("x", 1e9, "0")).toBe("x");
    expect(() => fx.pad("x", 1e8, "0")).not.toThrow();
    expect(fx.pad("x", 1e8, "0")).toBe("x");
    expect(fx.pad("abc", 10001, "0")).toBe("abc"); // just over the defensive cap
  });

  it("a negative or zero length is a no-op (returns the coerced string unchanged)", () => {
    expect(fx.pad("ab", -5, "0")).toBe("ab");
    expect(fx.pad("ab", 0, "0")).toBe("ab");
    expect(fx.pad("ab", 2, "0")).toBe("ab"); // length === str.length: unchanged
  });

  it("floors a fractional length ToLength-style before padding (no throw)", () => {
    expect(() => fx.pad("7", 3.9, "0")).not.toThrow();
    expect(fx.pad("7", 3.9, "0")).toBe("007"); // floor(3.9) = 3
    expect(fx.pad("7", 1.9, "0")).toBe("7"); // floor(1.9) = 1 <= str.length -> unchanged
  });

  it("pads up to the defensive cap (a large-but-in-range length still works)", () => {
    const out = fx.pad("ab", 100, "0");
    expect(out).toHaveLength(100);
    expect(out.endsWith("ab")).toBe(true);
    expect(out.startsWith("0")).toBe(true);
  });
});

describe("regex helpers fail SOFT on a malformed pattern (no computed-cell crash)", () => {
  const bad = "("; // unterminated group -> new RegExp("(") throws SyntaxError

  it("test() does not throw and returns false on a bad pattern", () => {
    expect(() => fx.test("abc", bad)).not.toThrow();
    expect(fx.test("abc", bad)).toBe(false);
  });

  it("match() does not throw and returns null on a bad pattern", () => {
    expect(() => fx.match("abc", bad)).not.toThrow();
    expect(fx.match("abc", bad)).toBeNull();
  });

  it("replace() does not throw and is a no-op (returns input) on a bad pattern", () => {
    expect(() => fx.replace("abc", bad, "X")).not.toThrow();
    expect(fx.replace("abc", bad, "X")).toBe("abc");
  });

  it("replaceAll() does not throw and is a no-op (returns input) on a bad pattern", () => {
    expect(() => fx.replaceAll("abc", bad, "X")).not.toThrow();
    expect(fx.replaceAll("abc", bad, "X")).toBe("abc");
  });

  it("still works correctly on a VALID pattern", () => {
    expect(fx.test("abc123", "\\d+")).toBe(true);
    expect(fx.match("abc123", "\\d+")?.[0]).toBe("123");
    expect(fx.replace("a-b-c", "-", "_")).toBe("a_b-c"); // first match only
    expect(fx.replaceAll("a-b-c", "-", "_")).toBe("a_b_c"); // global
  });
});

describe("sort: non-mutating + a correct total-order comparator (LOCKED FIX)", () => {
  it("does NOT mutate the caller's array", () => {
    const input = [3, 1, 2];
    const out = fx.sort(input);
    expect(input).toEqual([3, 1, 2]); // untouched
    expect(out).not.toBe(input); // a fresh array
  });

  it("sorts numbers ASCENDING (legacy was descending b-a)", () => {
    expect(fx.sort([3, 1, 2])).toEqual([1, 2, 3]);
    expect(fx.sort([10, -5, 0, 7])).toEqual([-5, 0, 7, 10]);
  });

  it("sorts lexical string data instead of NaN-poisoning it", () => {
    // Legacy `(a,b)=>b-a` returned NaN for strings -> engine-defined / unsorted.
    expect(fx.sort(["banana", "apple", "cherry"])).toEqual([
      "apple",
      "banana",
      "cherry",
    ]);
  });

  it("sorts Dates chronologically", () => {
    const a = new Date(2024, 0, 3);
    const b = new Date(2024, 0, 1);
    const c = new Date(2024, 0, 2);
    expect(fx.sort([a, b, c])).toEqual([b, c, a]);
  });

  it("is stable for equal values (returns 0, preserving input order)", () => {
    expect(fx.sort([2, 2, 2])).toEqual([2, 2, 2]);
    const xs = ["a", "a", "a"];
    expect(fx.sort(xs)).toEqual(["a", "a", "a"]);
  });

  it("handles an empty array", () => {
    expect(fx.sort([])).toEqual([]);
  });
});

describe("sort: TOTAL ORDER on MIXED-type arrays (strict-weak-ordering, LOCKED FIX)", () => {
  // Regression lock for the reviewer must-fix: the previous comparator switched
  // scheme per-PAIR (numeric iff BOTH operands were number/Date, else a string
  // compare of their format() forms), which is NOT transitive on mixed input.
  // Minimal proof the OLD comparator failed (numbers 5, 10 and string "2"):
  //   cmp(5,10) = -1   cmp(10,"2") = -1   but cmp(5,"2") = +1
  // so 5<10 and 10<"2" yet 5>"2". V8 then emitted an arbitrary, input-position-
  // dependent permutation — the SAME multiset sorted differently per initial
  // order. The fix classifies each value ONCE into a bucket (number/Date vs
  // string) so the relation is transitive by construction.

  // The pure comparator itself (a 2-element sort can short-circuit in V8 without
  // calling the comparator, so the laws are checked directly against it).
  const cmp = compareSortValues;

  it("is DETERMINISTIC: the same multiset sorts identically regardless of input order", () => {
    const a = fx.sort([5, 10, "2"]);
    const b = fx.sort(["2", 5, 10]);
    const c = fx.sort([10, "2", 5]);
    expect(a).toEqual(b);
    expect(b).toEqual(c);
  });

  it("orders the numeric bucket before the string bucket, numbers/Dates numerically within", () => {
    // numbers/Dates (numeric bucket) come first in numeric order; bare strings
    // (string bucket) follow in localeCompare order.
    expect(fx.sort([10, 2, "5", 1])).toEqual([1, 2, 10, "5"]);
    expect(fx.sort([3, "1", 2, "10"])).toEqual([2, 3, "1", "10"]);
  });

  it("places a Date in the numeric bucket alongside numbers, then strings", () => {
    const d = new Date(2024, 0, 1); // epoch millis are large -> sort after small numbers
    const out = fx.sort([d, 5, "z", 1]);
    expect(out).toEqual([1, 5, d, "z"]);
  });

  it("treats an Invalid Date as a string-bucket value (no NaN poisoning)", () => {
    const invalid = new Date(NaN);
    // Must not throw and must terminate with a permutation containing every element.
    const out = fx.sort([invalid, 2, "a"]);
    expect(out).toHaveLength(3);
    expect(out).toContain(invalid);
    expect(out).toContain(2);
    expect(out).toContain("a");
  });

  it("satisfies the strict-weak-ordering laws over a mixed domain (reflexive, antisymmetric, TRANSITIVE)", () => {
    const domain: any[] = [
      5,
      10,
      1,
      0,
      -3,
      "2",
      "5",
      "10",
      "apple",
      "",
      new Date(2024, 0, 1),
      new Date(2020, 5, 15),
    ];
    const sign = (n: number) => (n < 0 ? -1 : n > 0 ? 1 : 0);
    // negate without producing -0 (Object.is(-0, 0) is false, which toBe uses)
    const neg = (n: number) => (n === 0 ? 0 : -n);

    // reflexive: cmp(x, x) === 0
    for (const x of domain) {
      expect(cmp(x, x)).toBe(0);
    }
    // antisymmetric: sign(cmp(a,b)) === -sign(cmp(b,a))
    for (const a of domain) {
      for (const b of domain) {
        expect(sign(cmp(a, b))).toBe(neg(sign(cmp(b, a))));
      }
    }
    // transitive: cmp(a,b) <= 0 && cmp(b,c) <= 0 => cmp(a,c) <= 0
    let violations = 0;
    for (const a of domain) {
      for (const b of domain) {
        for (const c of domain) {
          if (cmp(a, b) <= 0 && cmp(b, c) <= 0 && cmp(a, c) > 0) {
            violations++;
          }
        }
      }
    }
    expect(violations).toBe(0);
  });
});

describe("reverse: non-mutating (LOCKED FIX)", () => {
  it("does NOT mutate the caller's array and returns a fresh reversed copy", () => {
    const input = [1, 2, 3];
    const out = fx.reverse(input);
    expect(input).toEqual([1, 2, 3]); // untouched
    expect(out).toEqual([3, 2, 1]);
    expect(out).not.toBe(input);
  });

  it("handles an empty array", () => {
    expect(fx.reverse([])).toEqual([]);
  });
});

describe("dateBetween: format switch + default fall-through to days", () => {
  const jan1 = new Date(2024, 0, 1, 0, 0, 0, 0);
  const jan11 = new Date(2024, 0, 11, 0, 0, 0, 0); // exactly 10 days later

  it("computes each known unit", () => {
    expect(fx.dateBetween(jan1, jan11, "days")).toBe(10);
    expect(fx.dateBetween(jan1, jan11, "hours")).toBe(240);
    expect(fx.dateBetween(jan1, jan11, "weeks")).toBe(1); // round(10/7)
    expect(fx.dateBetween(jan1, jan11, "minutes")).toBe(14400);
    expect(fx.dateBetween(jan1, jan11, "seconds")).toBe(864000);
  });

  it("is symmetric (uses abs of the diff)", () => {
    expect(fx.dateBetween(jan11, jan1, "days")).toBe(10);
  });

  it("falls through to DAYS on an unknown/empty format (default branch)", () => {
    expect(fx.dateBetween(jan1, jan11, "fortnights")).toBe(10);
    expect(fx.dateBetween(jan1, jan11, "")).toBe(10);
    expect(fx.dateBetween(jan1, jan11, undefined)).toBe(10);
  });
});

describe("dateRange: startsWith-prefix unit matching + default to days", () => {
  const arr = [new Date(2024, 0, 1, 0, 0, 0, 0), new Date(2024, 0, 11, 0, 0, 0, 0)];

  it("matches a unit by PREFIX ('day' matches the documented 'days')", () => {
    expect(fx.dateRange(arr, "day")).toBe(10);
    expect(fx.dateRange(arr, "days")).toBe(10);
    expect(fx.dateRange(arr, "dayXYZ")).toBe(10); // startsWith, not equality
  });

  it("computes other prefixed units", () => {
    expect(fx.dateRange(arr, "hour")).toBe(240);
    expect(fx.dateRange(arr, "week")).toBeCloseTo(10 / 7, 5);
  });

  it("falls through to DAYS for an unknown unit (default branch)", () => {
    expect(fx.dateRange(arr, "fortnight")).toBe(10);
    expect(fx.dateRange(arr, "")).toBe(10);
  });
});

describe("dateAdd / dateSubtract: prefix unit matching + default branch", () => {
  it("dateAdd adds days by prefix", () => {
    const out = fx.dateAdd(new Date(2024, 0, 1), 5, "day");
    expect(out.getDate()).toBe(6);
  });

  it("dateAdd with an unknown unit leaves the date unchanged (no branch fires)", () => {
    // Unlike dateBetween/dateRange there is no default add — an unknown unit is a no-op.
    const out = fx.dateAdd(new Date(2024, 0, 1), 5, "fortnights");
    expect(out.getDate()).toBe(1);
    expect(out.getMonth()).toBe(0);
  });

  it("dateSubtract subtracts months by prefix", () => {
    const out = fx.dateSubtract(new Date(2024, 5, 15), 2, "months");
    expect(out.getMonth()).toBe(3); // June(5) - 2 = April(3)
  });

  it("dateAdd matches 'week'/'quarter' prefixes", () => {
    const wk = fx.dateAdd(new Date(2024, 0, 1), 1, "weeks");
    expect(wk.getDate()).toBe(8);
    const qt = fx.dateAdd(new Date(2024, 0, 1), 1, "quarter");
    expect(qt.getMonth()).toBe(3); // +3 months
  });
});

describe("array helpers on empty / off-type input", () => {
  it("at() out of range and on empty array is undefined", () => {
    expect(fx.at([10, 20], 5)).toBeUndefined();
    expect(fx.at([], 0)).toBeUndefined();
    expect(fx.at([10, 20], -1)).toBeUndefined(); // plain index access, not Array.at semantics
  });

  it("first() / last() on an empty array are undefined", () => {
    expect(fx.first([])).toBeUndefined();
    expect(fx.last([])).toBeUndefined();
  });

  it("first() / last() on a single-element array return that element", () => {
    expect(fx.first([42])).toBe(42);
    expect(fx.last([42])).toBe(42);
  });
});

describe("toNumber coercion", () => {
  it("a Date becomes its epoch millis", () => {
    const d = new Date(2024, 0, 1);
    expect(fx.toNumber(d)).toBe(d.getTime());
  });

  it("a numeric string is parsed via parseFloat", () => {
    expect(fx.toNumber("3.14")).toBeCloseTo(3.14, 5);
    expect(fx.toNumber("42px")).toBe(42); // parseFloat stops at non-numeric
  });

  it("a non-numeric string is NaN (parseFloat result)", () => {
    expect(Number.isNaN(fx.toNumber("abc"))).toBe(true);
  });

  it("any other type is returned unchanged (number / boolean / object passthrough)", () => {
    expect(fx.toNumber(7)).toBe(7);
    expect(fx.toNumber(true)).toBe(true); // not a Date/string -> returned as-is
    const obj = { a: 1 };
    expect(fx.toNumber(obj)).toBe(obj);
  });
});

// ===========================================================================
// EMPTY/TYPED aggregate contract (Notidian-l6ha) — range/latest/earliest/
// dateRange over the rollup/aggregate sets they actually feed (ADR 0029). The
// legacy bodies spread the array straight into Math.max/Math.min, so:
//   range([])      === Math.max(...[]) - Math.min(...[]) === -Infinity   (garbage)
//   latest([]) / earliest([]) === Invalid Date                           (garbage)
//   latest/earliest THREW a TypeError on ANY non-Date element (f.getTime())
//   dateRange([])  === abs(Infinity - Infinity) -> Infinity span         (garbage)
// all runtime-confirmed. These cells are read by the owner as if they were
// data, so the fix ships the RECOMMENDED empty/typed contract and LOCKS it:
//   - range / dateRange  -> 0 on empty (additive identity; returnType "number")
//   - latest / earliest  -> '' on empty (the defined date-sentinel; returnType
//                           "date") — NOT an Invalid Date
//   - all four SKIP elements that don't resolve to a finite number / valid Date
//     (a date-string, null, junk, an Invalid Date) instead of throwing/poisoning
//
// RATIONALE / alternatives noted in place (no decision-ADR-that-waits): an empty
// numeric range could instead be '' to read "no data", but 0 is type-correct for
// the declared returnType "number" and is what a downstream numeric formula can
// safely consume; an empty latest/earliest could be null, but '' matches how the
// engine already degrades absent dates (format(null/undefined) -> '') and the
// returnType "date" sentinel. Skip-rather-than-throw for off-type elements is
// the bead-recommended contract; the alternative (coerce-everything-or-throw)
// would re-introduce the crash this bug is about.
// ===========================================================================
describe("range: EMPTY/TYPED contract (Notidian-l6ha, LOCKED FIX)", () => {
  it("EMPTY array -> 0 (legacy yielded -Infinity)", () => {
    expect(fx.range([])).toBe(0);
  });

  it("SINGLE element -> 0 (max === min, span is zero)", () => {
    expect(fx.range([7])).toBe(0);
    expect(fx.range([-3])).toBe(0);
  });

  it("computes the finite numeric span on a normal set", () => {
    expect(fx.range([1, 5, 3])).toBe(4);
    expect(fx.range([-10, 10])).toBe(20);
    expect(fx.range([2.5, 0.5])).toBe(2);
  });

  it("coerces numeric STRINGS and ignores non-numeric ones (no NaN poisoning)", () => {
    expect(fx.range(["1", "5", "3"])).toBe(4); // all coerce to finite numbers
    expect(fx.range([1, "abc", 5])).toBe(4); // "abc" -> NaN, dropped; span of {1,5}
    expect(fx.range(["10"])).toBe(0); // single coerced value
  });

  it("drops NON-FINITE / off-type elements rather than returning Infinity/NaN", () => {
    expect(fx.range([1, Infinity, 5])).toBe(4); // Infinity dropped
    expect(fx.range([1, NaN, 5])).toBe(4); // NaN dropped
    expect(fx.range([1, null, 5])).toBe(4); // null -> NaN, dropped
    expect(fx.range([1, {}, 5])).toBe(4); // object -> NaN, dropped
  });

  it("ALL-unusable input -> 0 (not -Infinity / NaN)", () => {
    expect(fx.range([NaN, "abc", null, {}])).toBe(0);
    expect(fx.range([Infinity, -Infinity])).toBe(0);
  });

  it("a non-array argument degrades to 0 (does not throw)", () => {
    expect(() => fx.range(undefined)).not.toThrow();
    expect(fx.range(undefined)).toBe(0);
    expect(fx.range(null)).toBe(0);
  });
});

describe("latest / earliest: EMPTY/TYPED contract (Notidian-l6ha, LOCKED FIX)", () => {
  const d1 = new Date(2024, 0, 1);
  const d2 = new Date(2024, 0, 11);
  const d3 = new Date(2023, 5, 15);

  it("EMPTY array -> '' (legacy yielded an Invalid Date)", () => {
    expect(fx.latest([])).toBe("");
    expect(fx.earliest([])).toBe("");
  });

  it("SINGLE Date -> that Date", () => {
    expect(fx.latest([d1])).toEqual(d1);
    expect(fx.earliest([d1])).toEqual(d1);
  });

  it("picks the max / min over a normal set of Dates", () => {
    expect(fx.latest([d1, d2, d3])).toEqual(d2); // newest
    expect(fx.earliest([d1, d2, d3])).toEqual(d3); // oldest
  });

  it("does NOT THROW on a NON-DATE element — it skips it (legacy threw TypeError)", () => {
    // Runtime-confirmed: legacy `arr.map(f => f.getTime())` threw on any non-Date.
    expect(() => fx.latest([d1, "not a date", d2])).not.toThrow();
    expect(() => fx.earliest([d1, null, d2])).not.toThrow();
    // junk dropped, the real Dates still decide the result
    expect(fx.latest([d1, "not a date", d2])).toEqual(d2);
    expect(fx.earliest([d1, null, d2])).toEqual(d1);
  });

  it("coerces PARSEABLE date-strings/numbers and skips Invalid Dates", () => {
    // an ISO date-string resolves to a valid Date and participates
    expect(fx.latest([d1, "2025-06-01"])).toEqual(new Date("2025-06-01"));
    expect(fx.earliest(["2025-06-01", d1])).toEqual(d1);
    // an Invalid Date in the set is skipped, not allowed to poison the result
    expect(fx.latest([d1, new Date(NaN), d2])).toEqual(d2);
    expect(fx.earliest([new Date(NaN), d1, d2])).toEqual(d1);
  });

  it("MIXED with NO usable date -> '' (every element drops out)", () => {
    expect(fx.latest(["nope", null, {}, new Date(NaN)])).toBe("");
    expect(fx.earliest([undefined, "xyz", new Date(NaN)])).toBe("");
  });

  it("a non-array argument degrades to '' (does not throw)", () => {
    expect(() => fx.latest(undefined)).not.toThrow();
    expect(fx.latest(undefined)).toBe("");
    expect(fx.earliest(null)).toBe("");
  });
});

describe("dateRange: EMPTY/TYPED contract (Notidian-l6ha, LOCKED FIX)", () => {
  const d1 = new Date(2024, 0, 1, 0, 0, 0, 0);
  const d11 = new Date(2024, 0, 11, 0, 0, 0, 0); // exactly 10 days later

  it("EMPTY array -> 0 (legacy yielded an Infinity span)", () => {
    expect(fx.dateRange([], "days")).toBe(0);
    expect(fx.dateRange([], "")).toBe(0); // default branch too
  });

  it("SINGLE Date -> 0 span (max === min)", () => {
    expect(fx.dateRange([d1], "days")).toBe(0);
    expect(fx.dateRange([d1], "hours")).toBe(0);
  });

  it("computes the finite span on a normal set (unchanged happy path)", () => {
    expect(fx.dateRange([d1, d11], "days")).toBe(10);
    expect(fx.dateRange([d1, d11], "hours")).toBe(240);
  });

  it("does NOT THROW on a NON-DATE element — it skips it (legacy threw TypeError)", () => {
    expect(() => fx.dateRange([d1, "nope", d11], "days")).not.toThrow();
    expect(fx.dateRange([d1, "nope", d11], "days")).toBe(10); // junk dropped
    expect(fx.dateRange([d1, null, d11], "days")).toBe(10);
  });

  it("skips an Invalid Date rather than poisoning the diff", () => {
    expect(fx.dateRange([d1, new Date(NaN), d11], "days")).toBe(10);
  });

  it("ALL-unusable input -> 0 (not Infinity / NaN)", () => {
    expect(fx.dateRange(["nope", null, new Date(NaN)], "days")).toBe(0);
  });

  it("a non-array argument degrades to 0 (does not throw)", () => {
    expect(() => fx.dateRange(undefined, "days")).not.toThrow();
    expect(fx.dateRange(undefined, "days")).toBe(0);
  });
});
