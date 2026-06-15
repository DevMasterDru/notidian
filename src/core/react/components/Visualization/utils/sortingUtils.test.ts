import {
  getOptionsOrder,
  getUniqueSortedValues,
  intelligentCompare,
  isDateLike,
  sortByEncodingType,
  sortUniqueValues,
} from "./sortingUtils";

// ===========================================================================
// DEPTH (Q1) — characterization + adversarial property net for
// src/core/react/components/Visualization/utils/sortingUtils.ts (Notidian-dx5).
//
// This module had ZERO coverage yet is load-bearing for the D3 visualization
// layer: `intelligentCompare` / `sortUniqueValues` / `sortByEncodingType` are
// fed DIRECTLY to Array.prototype.sort to order chart axes and categories
//   - D3VisualizationEngine.tsx:205,388  (scaleBand domain ordering)
//   - LineChartUtility.ts:173,600        (line/area point ordering)
//   - Bar/Line/Area/RadarChartTransformer (series + category ordering)
// so a malformed comparator silently corrupts the rendered order of a chart.
//
// Everything here is pure / offline — no vault, no DOM, no I/O.
//
// IMPORTANT — characterization, NOT correction. `intelligentCompare` is the
// SAME bug class as Notidian-e8e / ADR-0025 (array.ts comparators) on an
// untested surface. It is reflexive and antisymmetric over MOST of the domain,
// but has TWO locked strict-weak-ordering defects:
//   (1) **NON-TRANSITIVE** for cross-branch mixes (the headline defect, below);
//   (2) **NON-REFLEXIVE on "Infinity"** — parseFloat("Infinity") === Infinity, so
//       the numeric branch returns Infinity - Infinity === NaN (not 0). A NaN
//       comparator return is its own SWO violation, strictly worse than (1)
//       because it gives Array.prototype.sort an undefined contract. It is pinned
//       by a dedicated KNOWN DEFECT test; the reflexivity/antisymmetry "law HOLDS"
//       tests iterate LAW_DOMAIN (MIXED_DOMAIN minus "Infinity") so they assert
//       only what is actually true. ("-Infinity" / "1e999" share defect (2).)
// A value's branch (date vs number vs string) is chosen per-PAIR via
// `isDateLike(aStr) || isDateLike(bStr)`, not per-value, so the same value is
// classified differently depending on its partner — which breaks transitivity:
//
//   cmp("2024-01-01", "")   === -1   // "" is an invalid Date -> date sorts first
//   cmp("",           "10") === -1   // neither date-like -> string path
//   cmp("2024-01-01", "10") ===  1   // "10" parses as Date(year 2001) < 2024
//   => a<b, b<c, but a>c  (a strict-weak-ordering violation)
//
// Array.prototype.sort assumes a strict weak ordering; a non-transitive
// comparator yields V8-version-dependent / unstable / outright-wrong orderings.
// FIXING it changes observable, owner-visible chart ordering (which deterministic
// order is "correct" is a product call) AND would require deciding per-value
// classification — exactly the situation ADR-0025 handled as a DECISION, not a
// blind fix. So we LOCK the non-transitivity here as a known defect (the law
// tests below ASSERT the violation exists) and route the fix to a follow-up
// decision bead + ADR (Notidian-0id / docs/adr/0033). When that lands, the
// `KNOWN DEFECT` blocks flip from "expect a violation" to "expect the law holds".
// The pure robustness gaps (getOptionsOrder throw, falsy-value/0 data loss) are
// pinned below and tracked by Notidian-dox.
// ===========================================================================

// --- tiny deterministic PRNG (no external dep) -----------------------------
// mulberry32: a fast, well-distributed, fully deterministic 32-bit generator so
// property runs are reproducible across machines/CI without a fixture file.
const makeRng = (seed: number) => {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};
const randInt = (rng: () => number, min: number, max: number) =>
  min + Math.floor(rng() * (max - min + 1));
const pick = <T>(rng: () => number, arr: T[]): T =>
  arr[randInt(rng, 0, arr.length - 1)];
const PROPERTY_RUNS = 400;

// Normalize any comparator result to exactly {-1, 0, 1}, FAILING LOUD on NaN.
// `|| 0` collapses any -0 to +0 so the law assertions are clean under Jest's
// Object.is-based toBe. The explicit NaN throw is load-bearing: a NaN comparator
// return is itself a strict-weak-ordering violation (worse than non-transitivity —
// it gives Array.prototype.sort an undefined contract), and the naive
// `(n < 0 ? -1 : n > 0 ? 1 : 0)` would silently map NaN -> 0 and let a broken
// comparator masquerade as reflexive/antisymmetric. So `sign` REFUSES to launder
// NaN; the one known NaN-returning case (intelligentCompare("Infinity","Infinity"),
// numeric branch -> Infinity - Infinity === NaN) is characterized explicitly as a
// KNOWN DEFECT below, and the reflexivity/antisymmetry law domains exclude it on
// purpose (see LAW_DOMAIN). If `sign` ever throws from a new call site, the
// comparator started returning NaN somewhere new — investigate, do not silence.
const sign = (n: number) => {
  if (Number.isNaN(n)) {
    throw new Error(
      "sign() received NaN — the comparator returned NaN, a strict-weak-ordering " +
        "violation. NaN must be characterized explicitly (see the KNOWN DEFECT " +
        "NaN-return test), never laundered to 0."
    );
  }
  return (n < 0 ? -1 : n > 0 ? 1 : 0) || 0;
};
// Negate a normalized sign, collapsing -0 back to +0.
const inv = (s: number) => -s || 0;

// A NaN-TOLERANT normalizer used ONLY by the broken-comparator characterization
// loops (transitivity violation counting + the malformed-sort safety floor),
// where the comparator is KNOWN non-conforming and a NaN return is a SEPARATE,
// already-characterized defect (the Infinity self-compare). Here NaN deliberately
// maps to 0 so a NaN-bearing triple is simply not counted as a transitivity
// violation rather than crashing the loop — the NaN return is locked by its own
// dedicated KNOWN DEFECT test, not by these triads. Distinct from `sign` so the
// laundering is explicit and confined to where the comparator is already broken.
const sortSign = (n: number) => (n < 0 ? -1 : n > 0 ? 1 : 0) || 0;

// A representative mixed domain: real dates, regex false-positive "dates",
// NaN-dates, bare numbers (which Date.parse misreads as years), numeric-aware
// strings, case variants, blanks, and special tokens. This is the exact kind of
// uncontrolled user-supplied category data that flows into the chart comparators.
const MIXED_DOMAIN = [
  "2024-01-01",
  "2024-12-31",
  "2023-06-15",
  "Jan 5, 2024",
  "5 Mar 2020",
  "1234-56-78", // regex-matches a date but Date() -> NaN
  "99/99/9999", // ditto
  "abc",
  "ABC",
  "10",
  "9",
  "2",
  "",
  "0x10",
  "  5  ",
  "NaN",
  "Infinity", // KNOWN DEFECT: parseFloat -> Infinity, so cmp(x,x) = Infinity-Infinity = NaN
  "Dec 2024",
];

// The subset of MIXED_DOMAIN over which reflexivity and antisymmetry ACTUALLY
// hold. "Infinity" is excluded ON PURPOSE: it takes the numeric branch
// (parseFloat("Infinity") === Infinity passes the !isNaN guard) so
// intelligentCompare("Infinity","Infinity") === Infinity - Infinity === NaN — a
// genuine strict-weak-ordering violation that is NOT reflexive. That NaN return
// is characterized as its own KNOWN DEFECT below; the "law HOLDS" tests must not
// claim it. ("-Infinity" and overflow literals like "1e999" parseFloat to
// +/-Infinity too and share the defect; they are not in the domain but the
// dedicated NaN test pins representative cases.) Everything else in MIXED_DOMAIN
// IS reflexive and antisymmetric (verified exhaustively), so this is the honest
// domain for the green law locks.
const LAW_DOMAIN = MIXED_DOMAIN.filter((v) => v !== "Infinity");

// =========================================================================
// isDateLike — regex shape detector (NOT a validity check)
// =========================================================================
describe("isDateLike", () => {
  it("non-string guard: rejects null / undefined / numbers / objects", () => {
    expect(isDateLike(null as any)).toBe(false);
    expect(isDateLike(undefined as any)).toBe(false);
    expect(isDateLike(123 as any)).toBe(false);
    expect(isDateLike({} as any)).toBe(false);
    expect(isDateLike([] as any)).toBe(false);
  });

  it("empty string is falsy -> false (the `!val` short-circuit)", () => {
    expect(isDateLike("")).toBe(false);
  });

  it("matches ISO / slash / dashed numeric date shapes", () => {
    expect(isDateLike("2024-01-01")).toBe(true); // YYYY-MM-DD
    expect(isDateLike("01/02/2024")).toBe(true); // MM/DD/YYYY
    expect(isDateLike("01-02-2024")).toBe(true); // MM-DD-YYYY
    expect(isDateLike("2024/01/02")).toBe(true); // YYYY/MM/DD
  });

  it("matches the \\w{3} month-name branch (3 word-chars + day + year)", () => {
    expect(isDateLike("Jan 5, 2024")).toBe(true);
    expect(isDateLike("Dec 31 2024")).toBe(true);
    expect(isDateLike("5 Mar 2020")).toBe(true); // "<day> <mon> <year>" branch
    // CHARACTERIZED false positive: \w{3} is ANY 3 word-chars, not a real month.
    expect(isDateLike("xyz 1 9999")).toBe(true);
    expect(isDateLike("NaN 5 2024")).toBe(true);
    // CHARACTERIZED: \w includes digits, so "123 4 5678" matches the branch too.
    expect(isDateLike("123 4 5678")).toBe(true);
  });

  it("CHARACTERIZED false positives: shape-only, never validates the date", () => {
    // These are syntactically date-shaped but semantically nonsense; isDateLike
    // is a regex shape gate, so it (intentionally, per current code) says true.
    expect(isDateLike("1234-56-78")).toBe(true); // month 56, day 78
    expect(isDateLike("99/99/9999")).toBe(true); // month/day 99
    expect(isDateLike("00-00-0000")).toBe(true);
    expect(isDateLike("9999/99/99")).toBe(true);
    expect(isDateLike("2024-13-45")).toBe(true); // month 13, day 45
  });

  it("substring match: a date shape ANYWHERE in the string returns true", () => {
    // No anchors in the regex, so an embedded date shape matches.
    expect(isDateLike("order 2024-01-01 shipped")).toBe(true);
    expect(isDateLike("v2024-01-01")).toBe(true);
  });

  it("rejects shapes that match no pattern", () => {
    expect(isDateLike("hello")).toBe(false);
    expect(isDateLike("2024")).toBe(false); // year alone
    expect(isDateLike("1-2-3")).toBe(false); // too few digits per group
    expect(isDateLike("Jan 2024")).toBe(false); // missing the day number
  });
});

// =========================================================================
// intelligentCompare — the headline comparator (date / number / string)
// =========================================================================
describe("intelligentCompare", () => {
  // ---- branch characterization -----------------------------------------
  it("date path: orders two valid dates chronologically", () => {
    expect(sign(intelligentCompare("2024-01-01", "2024-12-31"))).toBe(-1);
    expect(sign(intelligentCompare("2024-12-31", "2023-06-15"))).toBe(1);
  });

  it("numeric path: orders numerically, not lexically", () => {
    expect(sign(intelligentCompare("9", "10"))).toBe(-1); // 9 < 10 numerically
    expect(sign(intelligentCompare("2", "10"))).toBe(-1);
    expect(intelligentCompare(1, 2)).toBe(-1); // raw numbers coerced via String()
  });

  it("string path: numeric-aware, base-sensitivity locale compare", () => {
    // numeric:true makes "a9" < "a10"; sensitivity:'base' folds case + accents.
    expect(sign(intelligentCompare("a9", "a10"))).toBe(-1);
    expect(intelligentCompare("apple", "Apple")).toBe(0); // base sensitivity
    expect(intelligentCompare("café", "cafe")).toBe(0); // accent-insensitive
  });

  // ---- NaN-Date ordering (isNaN -> push to end), with symmetry ----------
  it("NaN-Date ordering: a date-shaped-but-invalid value sorts AFTER a valid date", () => {
    // "1234-56-78" is date-like (regex) but Date() -> NaN; valid date wins.
    expect(intelligentCompare("1234-56-78", "2024-01-01")).toBe(1); // a invalid -> after
    expect(intelligentCompare("2024-01-01", "1234-56-78")).toBe(-1); // b invalid -> a before
  });

  it("NaN-Date ordering is SYMMETRIC (one-NaN flips sign; both-NaN === 0)", () => {
    const validDate = "2024-06-15";
    const nanDate = "99/99/9999"; // date-like, Date() -> NaN
    expect(sign(intelligentCompare(nanDate, validDate))).toBe(
      inv(sign(intelligentCompare(validDate, nanDate)))
    );
    // both-NaN -> 0 (the `isNaN(a) && isNaN(b)` early return)
    expect(intelligentCompare("1234-56-78", "99/99/9999")).toBe(0);
    expect(intelligentCompare("99/99/9999", "1234-56-78")).toBe(0);
  });

  it("nullish / NaN inputs are String()-coerced (no throw); cmp(x,x)===0", () => {
    expect(intelligentCompare(null, null)).toBe(0); // "null" vs "null" -> 0
    expect(intelligentCompare(undefined, undefined)).toBe(0);
    expect(intelligentCompare(NaN, NaN)).toBe(0); // "NaN" string path -> 0
    // mixed nullish: deterministic, no throw
    expect(typeof intelligentCompare(null, "x")).toBe("number");
  });

  // ---- LAW: reflexivity (HOLDS over LAW_DOMAIN; "Infinity" is a KNOWN DEFECT) --
  // Iterates LAW_DOMAIN (MIXED_DOMAIN minus "Infinity"), NOT the full domain:
  // cmp("Infinity","Infinity") === NaN (numeric branch, Infinity - Infinity), a
  // genuine non-reflexive case characterized by its own KNOWN DEFECT test below.
  // `sign` throws on NaN, so this would FAIL (not silently pass) if "Infinity"
  // were included — which is the point: the green lock asserts only what holds.
  it("LAW reflexivity: cmp(x, x) === 0 for every value in LAW_DOMAIN", () => {
    for (const x of LAW_DOMAIN) {
      expect(sign(intelligentCompare(x, x))).toBe(0);
    }
  });

  // ---- LAW: antisymmetry (HOLDS over LAW_DOMAIN) -----------------------
  // Also over LAW_DOMAIN: the only NaN-returning pair in the exhaustive double
  // loop is ("Infinity","Infinity") (verified), and `sign` refuses to launder it.
  it("LAW antisymmetry: sign(cmp(a,b)) === -sign(cmp(b,a)) over LAW_DOMAIN", () => {
    for (const a of LAW_DOMAIN) {
      for (const b of LAW_DOMAIN) {
        expect(sign(intelligentCompare(a, b))).toBe(
          inv(sign(intelligentCompare(b, a)))
        );
      }
    }
  });

  it("LAW antisymmetry (randomized stress, seeded)", () => {
    const rng = makeRng(0x5eed1);
    for (let i = 0; i < PROPERTY_RUNS; i++) {
      const a = pick(rng, LAW_DOMAIN);
      const b = pick(rng, LAW_DOMAIN);
      expect(sign(intelligentCompare(a, b))).toBe(
        inv(sign(intelligentCompare(b, a)))
      );
    }
  });

  // ---- LAW: reflexivity (KNOWN DEFECT — NaN return on "Infinity") -------
  // The comparator is NOT reflexive for "Infinity": parseFloat("Infinity") ===
  // Infinity passes the numeric guard, so it returns Infinity - Infinity === NaN,
  // not 0. A NaN comparator return is a strict-weak-ordering violation (and gives
  // Array.prototype.sort an UNDEFINED contract — strictly worse than the
  // non-transitivity locked below). We assert the RAW comparator output (not
  // through `sign`, which now throws on NaN) so the defect is pinned honestly.
  // When ADR 0033's per-value-classification fix lands (so "Infinity" buckets as a
  // finite-failing number/string and cmp("Infinity","Infinity") === 0), flip these
  // to assert reflexivity holds and fold "Infinity" back into LAW_DOMAIN.
  it("KNOWN DEFECT: cmp returns NaN (not 0) for an Infinity self-compare", () => {
    expect(Number.isNaN(intelligentCompare("Infinity", "Infinity"))).toBe(true);
    // shared root cause: anything parseFloat maps to +/-Infinity self-compares to NaN
    expect(Number.isNaN(intelligentCompare("-Infinity", "-Infinity"))).toBe(true);
    expect(Number.isNaN(intelligentCompare("1e999", "1e999"))).toBe(true); // overflow -> Infinity
    // and `sign` REFUSES to launder it (the masking that previously hid this defect)
    expect(() => sign(intelligentCompare("Infinity", "Infinity"))).toThrow(/NaN/);
  });

  // ---- LAW: transitivity (KNOWN DEFECT — LOCKED) -----------------------
  // The e8e / ADR-0025 bug class on this surface. We assert that a transitivity
  // violation EXISTS so it is pinned and visible; a conscious fix (decision bead
  // + ADR) flips this to "no violations found". DO NOT silently relax this — if
  // it starts passing, the comparator was changed and the locked assertions must
  // be updated as part of that reviewed decision.
  it("KNOWN DEFECT: a concrete non-transitive triple (date vs blank vs number)", () => {
    const a = "2024-01-01";
    const b = "";
    const c = "10";
    expect(sign(intelligentCompare(a, b))).toBe(-1); // a < b
    expect(sign(intelligentCompare(b, c))).toBe(-1); // b < c
    // transitivity would demand a < c, but:
    expect(sign(intelligentCompare(a, c))).toBe(1); // a > c  (VIOLATION)
  });

  it("KNOWN DEFECT: transitivity violations are detectable across the mixed domain", () => {
    // Uses `sortSign` (NaN-tolerant), NOT `sign` (which throws on NaN): this loop
    // runs over the FULL MIXED_DOMAIN, which includes "Infinity" whose self-compare
    // returns NaN (its own KNOWN DEFECT). Here a NaN-bearing triple is simply not
    // counted as a transitivity violation rather than crashing — the NaN return is
    // characterized by its dedicated test, not conflated with non-transitivity.
    let violations = 0;
    for (const a of MIXED_DOMAIN) {
      for (const b of MIXED_DOMAIN) {
        for (const c of MIXED_DOMAIN) {
          const ab = sortSign(intelligentCompare(a, b));
          const bc = sortSign(intelligentCompare(b, c));
          const ac = sortSign(intelligentCompare(a, c));
          if (ab <= 0 && bc <= 0 && ac > 0) violations++;
          if (ab >= 0 && bc >= 0 && ac < 0) violations++;
        }
      }
    }
    // LOCKED: the comparator is currently non-transitive. When the fix lands,
    // change this to `toBe(0)` as part of the reviewed decision (see follow-up).
    expect(violations).toBeGreaterThan(0);
  });

  // ---- A self-consistent sub-domain DOES obey the laws ------------------
  // Proof that the breakage is the cross-branch mixing, not the per-branch logic:
  // restrict to values that all take the SAME branch and the triad holds.
  const assertTriadHolds = (domain: any[], seed: number) => {
    for (const x of domain) expect(sign(intelligentCompare(x, x))).toBe(0);
    for (const a of domain)
      for (const b of domain)
        expect(sign(intelligentCompare(a, b))).toBe(
          inv(sign(intelligentCompare(b, a)))
        );
    for (const a of domain)
      for (const b of domain)
        for (const c of domain) {
          const ab = sign(intelligentCompare(a, b));
          const bc = sign(intelligentCompare(b, c));
          const ac = sign(intelligentCompare(a, c));
          if (ab <= 0 && bc <= 0) expect(ac).toBeLessThanOrEqual(0);
          if (ab >= 0 && bc >= 0) expect(ac).toBeGreaterThanOrEqual(0);
        }
    const rng = makeRng(seed);
    for (let i = 0; i < PROPERTY_RUNS; i++) {
      const a = pick(rng, domain);
      const b = pick(rng, domain);
      const c = pick(rng, domain);
      const ab = sign(intelligentCompare(a, b));
      const bc = sign(intelligentCompare(b, c));
      const ac = sign(intelligentCompare(a, c));
      if (ab <= 0 && bc <= 0) expect(ac).toBeLessThanOrEqual(0);
      if (ab >= 0 && bc >= 0) expect(ac).toBeGreaterThanOrEqual(0);
    }
  };

  it("all-valid-dates sub-domain IS a strict weak ordering", () => {
    assertTriadHolds(
      ["2024-01-01", "2024-12-31", "2023-06-15", "2024-01-02", "2020-02-29"],
      0xda7e
    );
  });

  it("all-numeric sub-domain IS a strict weak ordering", () => {
    assertTriadHolds(["1", "2", "10", "9", "100", "-5", "3.14"], 0x4b2c);
  });

  it("all-plain-string sub-domain IS a strict weak ordering", () => {
    assertTriadHolds(["apple", "banana", "cherry", "zebra", "mango"], 0x57217);
  });

  // ---- Array.prototype.sort consistency / stability --------------------
  it("a self-consistent array sorts deterministically and idempotently", () => {
    const arr = ["2024-12-31", "2023-06-15", "2024-01-01"];
    const once = [...arr].sort(intelligentCompare);
    const twice = [...once].sort(intelligentCompare);
    expect(once).toEqual(["2023-06-15", "2024-01-01", "2024-12-31"]);
    expect(twice).toEqual(once); // sorting an already-sorted array is a no-op
  });

  it("numeric values sort numerically through Array.prototype.sort", () => {
    expect(["10", "2", "1", "9"].sort(intelligentCompare)).toEqual([
      "1",
      "2",
      "9",
      "10",
    ]);
  });

  it("KNOWN DEFECT: a malformed-comparator array sort is engine-defined, not contract", () => {
    // With a non-transitive comparator the SORTED ORDER is undefined-contract
    // (V8 TimSort artifact). We assert only that sort() (a) terminates without
    // throwing and (b) returns a permutation of the input — never that the order
    // is "correct", because for this mixed domain there is no defined correct
    // order until the comparator is fixed. This pins the safety floor.
    const input = [...MIXED_DOMAIN];
    let out: string[] = [];
    expect(() => {
      out = [...input].sort(intelligentCompare);
    }).not.toThrow();
    expect(out).toHaveLength(input.length);
    expect([...out].sort()).toEqual([...input].sort()); // same multiset
  });
});

// =========================================================================
// getOptionsOrder — extract option value order from a field definition
// =========================================================================
describe("getOptionsOrder", () => {
  it("nullish / missing fieldDefinition.value -> []", () => {
    expect(getOptionsOrder(undefined)).toEqual([]);
    expect(getOptionsOrder(null)).toEqual([]);
    expect(getOptionsOrder({})).toEqual([]);
    expect(getOptionsOrder({ value: undefined })).toEqual([]);
    expect(getOptionsOrder({ value: "" })).toEqual([]); // falsy value short-circuits
  });

  it("safelyParseJSON failure -> [] (never throws on malformed JSON)", () => {
    expect(getOptionsOrder({ value: "{not json" })).toEqual([]);
    expect(getOptionsOrder({ value: "undefined" })).toEqual([]);
    expect(getOptionsOrder({ value: "[1,2,3" })).toEqual([]);
  });

  it("parsed without an `options` key -> []", () => {
    expect(getOptionsOrder({ value: JSON.stringify({ foo: 1 }) })).toEqual([]);
    expect(getOptionsOrder({ value: JSON.stringify({}) })).toEqual([]);
    expect(getOptionsOrder({ value: JSON.stringify({ options: null }) })).toEqual(
      []
    );
  });

  it("preserves option order as authored", () => {
    expect(
      getOptionsOrder({
        value: JSON.stringify({
          options: [{ value: "z" }, { value: "a" }, { value: "m" }],
        }),
      })
    ).toEqual(["z", "a", "m"]);
  });

  it("filters options whose `.value` is missing or falsy", () => {
    // CHARACTERIZED: the filter is `opt?.value` (truthy), so options with no
    // value, null options, AND options whose value is falsy (0, '', false) are
    // ALL dropped. This is a latent gap for a legit 0/'' option value.
    expect(
      getOptionsOrder({
        value: JSON.stringify({
          options: [
            { value: "a" },
            { label: "no-value" },
            { value: "b" },
            null,
            { value: 0 }, // falsy -> dropped
            { value: "" }, // falsy -> dropped
            { value: false }, // falsy -> dropped
            { value: "keep" },
          ],
        }),
      })
    ).toEqual(["a", "b", "keep"]);
  });

  it("String()-coerces non-string option values", () => {
    expect(
      getOptionsOrder({
        value: JSON.stringify({
          options: [{ value: 1 }, { value: true }, { value: "c" }],
        }),
      })
    ).toEqual(["1", "true", "c"]);
  });

  it("empty options array -> []", () => {
    expect(getOptionsOrder({ value: JSON.stringify({ options: [] }) })).toEqual(
      []
    );
  });

  it("KNOWN GAP: a truthy non-array `options` THROWS (no Array.isArray guard)", () => {
    // CHARACTERIZED defect — see follow-up bead. A malformed/legacy/hand-edited
    // definition with options as a non-array crashes instead of degrading to [].
    expect(() =>
      getOptionsOrder({ value: JSON.stringify({ options: 5 }) })
    ).toThrow();
    expect(() =>
      getOptionsOrder({ value: JSON.stringify({ options: "abc" }) })
    ).toThrow();
    expect(() =>
      getOptionsOrder({ value: JSON.stringify({ options: true }) })
    ).toThrow();
  });

  it("a non-string `value` (object) round-trips to [] (parse of '[object Object]' fails)", () => {
    // JSON.parse(String({...})) -> parse '[object Object]' -> throw -> undefined -> [].
    expect(
      getOptionsOrder({ value: { options: [{ value: "a" }] } as any })
    ).toEqual([]);
  });
});

// =========================================================================
// sortByEncodingType — encoding-aware dispatcher over a[field] / b[field]
// =========================================================================
describe("sortByEncodingType", () => {
  const row = (v: any) => ({ k: v });

  it("temporal: compares parsed dates by time, handling Date instances", () => {
    const r = sortByEncodingType(
      { k: new Date("2024-01-01") },
      { k: new Date("2024-12-31") },
      "temporal",
      "k"
    );
    expect(sign(r)).toBe(-1);
    // string values are coerced via new Date(String(...))
    expect(
      sign(sortByEncodingType(row("2024-12-31"), row("2024-01-01"), "temporal", "k"))
    ).toBe(1);
  });

  it("temporal: invalid date -> NaN time -> NaN difference (characterized)", () => {
    const r = sortByEncodingType(row("not-a-date"), row("2024-01-01"), "temporal", "k");
    expect(Number.isNaN(r)).toBe(true);
  });

  it("quantitative: numeric subtraction via Number()", () => {
    expect(sign(sortByEncodingType(row("2"), row("10"), "quantitative", "k"))).toBe(-1);
    expect(sortByEncodingType(row(5), row(5), "quantitative", "k")).toBe(0);
    // non-numeric -> NaN difference (characterized)
    expect(
      Number.isNaN(sortByEncodingType(row("x"), row("y"), "quantitative", "k"))
    ).toBe(true);
  });

  it("nominal with option fieldDefinition: orders by options index", () => {
    const fieldDefinition = {
      type: "option",
      value: JSON.stringify({
        options: [{ value: "high" }, { value: "med" }, { value: "low" }],
      }),
    };
    expect(
      sign(
        sortByEncodingType(row("low"), row("high"), "nominal", "k", undefined, fieldDefinition)
      )
    ).toBe(1); // low(idx2) after high(idx0)
    expect(
      sign(
        sortByEncodingType(row("high"), row("med"), "nominal", "k", undefined, fieldDefinition)
      )
    ).toBe(-1);
  });

  it("nominal option fieldDefinition: a value IN options sorts before one NOT in options", () => {
    const fieldDefinition = {
      type: "option-multi",
      value: JSON.stringify({ options: [{ value: "a" }, { value: "b" }] }),
    };
    expect(
      sign(sortByEncodingType(row("a"), row("zzz"), "nominal", "k", undefined, fieldDefinition))
    ).toBe(-1); // present a before absent zzz
    expect(
      sign(sortByEncodingType(row("zzz"), row("b"), "nominal", "k", undefined, fieldDefinition))
    ).toBe(1); // absent zzz after present b
  });

  it("nominal: falls back to scale.domain() order when no option ordering applies", () => {
    const scale = { domain: () => ["beta", "alpha", "gamma"] };
    expect(
      sign(sortByEncodingType(row("alpha"), row("beta"), "nominal", "k", scale))
    ).toBe(1); // alpha(idx1) after beta(idx0)
  });

  it("nominal: falls back to intelligentCompare when no option/scale ordering", () => {
    expect(sign(sortByEncodingType(row("9"), row("10"), "nominal", "k"))).toBe(-1);
    expect(sign(sortByEncodingType(row("banana"), row("apple"), "nominal", "k"))).toBe(1);
  });
});

// =========================================================================
// sortUniqueValues — option-aware stable ordering of a unique value list
// =========================================================================
describe("sortUniqueValues", () => {
  it("is non-mutating (returns a new array, leaves input untouched)", () => {
    const input = ["10", "2", "1"];
    const out = sortUniqueValues(input);
    expect(out).not.toBe(input);
    expect(input).toEqual(["10", "2", "1"]);
  });

  it("with option fieldDefinition: orders by options, unknowns appended", () => {
    const fieldDefinition = {
      type: "option",
      value: JSON.stringify({
        options: [{ value: "high" }, { value: "med" }, { value: "low" }],
      }),
    };
    expect(
      sortUniqueValues(["low", "extra", "high", "med"], fieldDefinition)
    ).toEqual(["high", "med", "low", "extra"]);
  });

  it("two unknown values (both absent from options) fall back to intelligentCompare", () => {
    const fieldDefinition = {
      type: "option",
      value: JSON.stringify({ options: [{ value: "high" }] }),
    };
    // "9" and "10" both absent -> intelligentCompare numeric ordering.
    expect(sortUniqueValues(["10", "9", "high"], fieldDefinition)).toEqual([
      "high",
      "9",
      "10",
    ]);
  });

  it("without option fieldDefinition: sorts via intelligentCompare", () => {
    expect(sortUniqueValues(["10", "2", "1", "9"])).toEqual([
      "1",
      "2",
      "9",
      "10",
    ]);
  });

  it("non-option fieldDefinition type is ignored (uses intelligentCompare)", () => {
    const fieldDefinition = { type: "text", value: "irrelevant" };
    expect(sortUniqueValues(["b", "a", "c"], fieldDefinition)).toEqual([
      "a",
      "b",
      "c",
    ]);
  });

  it("option fieldDefinition with empty options falls through to intelligentCompare", () => {
    const fieldDefinition = {
      type: "option",
      value: JSON.stringify({ options: [] }),
    };
    expect(sortUniqueValues(["b", "a"], fieldDefinition)).toEqual(["a", "b"]);
  });
});

// =========================================================================
// getUniqueSortedValues — dedup + String-coerce + sort over raw rows
// =========================================================================
describe("getUniqueSortedValues", () => {
  it("extracts, String()-coerces, dedups, and sorts the field", () => {
    const data = [{ k: 10 }, { k: 2 }, { k: 10 }, { k: 1 }];
    expect(getUniqueSortedValues(data, "k")).toEqual(["1", "2", "10"]);
  });

  it("missing / nullish field values coerce to '' (the `|| ''` fallback)", () => {
    const data = [{ k: "x" }, {}, { k: null }, { k: undefined }];
    // {}, null, undefined all -> '' -> deduped to a single empty string.
    const out = getUniqueSortedValues(data, "k");
    expect(out).toContain("");
    expect(out).toContain("x");
    expect(out.filter((v) => v === "")).toHaveLength(1); // deduped
  });

  it("CHARACTERIZED: a falsy-but-meaningful 0 collapses to '' via `|| ''`", () => {
    // d[field] || '' means a real 0 becomes '' — a latent data-loss gap shared
    // with the option filter. Pinned so a future fix is a conscious decision.
    const data = [{ k: 0 }, { k: "real" }];
    const out = getUniqueSortedValues(data, "k");
    expect(out).toContain(""); // the 0 became ''
    expect(out).not.toContain("0");
  });

  it("threads the option fieldDefinition through to sortUniqueValues", () => {
    const fieldDefinition = {
      type: "option",
      value: JSON.stringify({
        options: [{ value: "high" }, { value: "med" }, { value: "low" }],
      }),
    };
    const data = [{ k: "low" }, { k: "high" }, { k: "med" }, { k: "high" }];
    expect(getUniqueSortedValues(data, "k", fieldDefinition)).toEqual([
      "high",
      "med",
      "low",
    ]);
  });

  it("empty data -> []", () => {
    expect(getUniqueSortedValues([], "k")).toEqual([]);
  });
});
