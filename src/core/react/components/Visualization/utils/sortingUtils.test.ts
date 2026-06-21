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
// CORRECTNESS — `intelligentCompare` is now a real STRICT WEAK ORDERING (ADR
// 0033 Option B, accepted 2026-06-15; Notidian-0id). It was the SAME bug class as
// Notidian-e8e / ADR-0025 (array.ts comparators): the date/number/string branch
// was chosen per-PAIR via `isDateLike(aStr) || isDateLike(bStr)`, so the same
// value was classified differently depending on its partner. That produced TWO
// strict-weak-ordering defects, BOTH now fixed:
//   (1) NON-TRANSITIVITY for cross-branch mixes (the headline defect) — e.g.
//         cmp("2024-01-01", "")  = -1   // "" was an invalid Date -> date path
//         cmp("",          "10") = -1   // neither date-like -> string path
//         cmp("2024-01-01","10") = +1   // "10" parsed as Date(year 2001) < 2024
//         => a<b, b<c, but a>c  (a strict-weak-ordering violation)
//   (2) NON-REFLEXIVITY on "Infinity" — parseFloat("Infinity") === Infinity, so
//       the numeric branch returned Infinity - Infinity === NaN (not 0), giving
//       Array.prototype.sort an UNDEFINED contract.
//
// THE FIX: classify each value ONCE into a stable bucket — dates(0) < numbers(1)
// < strings(2) — and compare within-bucket; a value's bucket no longer depends on
// its partner, so the relation is transitive by construction. The number bucket
// admits only WHOLE-STRING FINITE-numeric tokens, so "Infinity"/"-Infinity"/
// "1e999" fall to the string bucket and self-compare to 0 (reflexivity restored).
// Single-type axes (all dates, all numbers, all text) render IDENTICALLY to
// before; only genuinely mixed-type axes — where the old comparator was
// incoherent — change order (the ADR 0033 worked example is the review picture).
//
// The former `KNOWN DEFECT` blocks below now ASSERT THE LAWS HOLD (reflexivity,
// antisymmetry, transitivity over the FULL domain incl. "Infinity"). The pure
// robustness gaps (falsy-value/0 data loss) remain pinned below and tracked by
// Notidian-dox (out of ADR 0033 scope).
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
  "Infinity", // post-ADR-0033: not whole-string finite -> string bucket -> cmp(x,x) = 0
  "Dec 2024",
];

// The domain over which the comparator laws hold. After ADR 0033 Option B the
// laws hold over the ENTIRE MIXED_DOMAIN, INCLUDING "Infinity": it now falls to
// the string bucket (the number bucket admits only whole-string FINITE tokens),
// so intelligentCompare("Infinity","Infinity") === 0 (localeCompare of equal
// strings) — reflexive, no more NaN return. ("-Infinity" / "1e999" likewise.)
// LAW_DOMAIN === MIXED_DOMAIN; the alias is kept so the law-test bodies read
// unchanged and the intent ("the domain the laws are asserted over") stays clear.
const LAW_DOMAIN = MIXED_DOMAIN;

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

  // ---- date-shaped-but-invalid ordering, with symmetry -----------------
  // Post-ADR-0033: a date-SHAPED-but-INVALID value (Date() -> NaN) does NOT enter
  // the date bucket — it falls to the STRING bucket (dates < numbers < strings),
  // so it sorts AFTER every valid date. Same observable outcome as the legacy
  // "invalid date pushed to the end", now via a STABLE per-value bucket instead of
  // the per-pair NaN-Date branch (use `sign`, since cross-bucket deltas are not
  // normalized to ±1).
  it("date-shaped-but-invalid value sorts AFTER a valid date (string bucket)", () => {
    // "1234-56-78" is date-like (regex) but Date() -> NaN -> string bucket (2);
    // "2024-01-01" is a valid date -> date bucket (0); 0 < 2 so valid wins.
    expect(sign(intelligentCompare("1234-56-78", "2024-01-01"))).toBe(1); // a after
    expect(sign(intelligentCompare("2024-01-01", "1234-56-78"))).toBe(-1); // a before
  });

  it("date-shaped-but-invalid ordering is SYMMETRIC; two invalids compare as strings", () => {
    const validDate = "2024-06-15";
    const nanDate = "99/99/9999"; // date-like, Date() -> NaN -> string bucket
    expect(sign(intelligentCompare(nanDate, validDate))).toBe(
      inv(sign(intelligentCompare(validDate, nanDate)))
    );
    // both invalid -> both string bucket -> ordered by NUMERIC-AWARE localeCompare,
    // NOT collapsed to 0 (the legacy both-NaN === 0 conflated two distinct values).
    // numeric:true compares the leading runs 1234 vs 99 NUMERICALLY -> 1234 > 99.
    // Reflexive + antisymmetric, which is what a strict weak ordering requires.
    expect(sign(intelligentCompare("1234-56-78", "99/99/9999"))).toBe(1); // 1234 > 99
    expect(sign(intelligentCompare("99/99/9999", "1234-56-78"))).toBe(-1);
    expect(intelligentCompare("1234-56-78", "1234-56-78")).toBe(0); // reflexive
  });

  it("nullish / NaN inputs are String()-coerced (no throw); cmp(x,x)===0", () => {
    expect(intelligentCompare(null, null)).toBe(0); // "null" vs "null" -> 0
    expect(intelligentCompare(undefined, undefined)).toBe(0);
    expect(intelligentCompare(NaN, NaN)).toBe(0); // "NaN" string path -> 0
    // mixed nullish: deterministic, no throw
    expect(typeof intelligentCompare(null, "x")).toBe("number");
  });

  // ---- LAW: reflexivity (HOLDS over the FULL domain post-ADR-0033) ------
  // LAW_DOMAIN === MIXED_DOMAIN now: every value (including "Infinity", which falls
  // to the string bucket) self-compares to 0. `sign` still THROWS on NaN, so if a
  // regression reintroduced a NaN return anywhere this would fail loud, not pass.
  it("LAW reflexivity: cmp(x, x) === 0 for every value in LAW_DOMAIN", () => {
    for (const x of LAW_DOMAIN) {
      expect(sign(intelligentCompare(x, x))).toBe(0);
    }
  });

  // ---- LAW: antisymmetry (HOLDS over the FULL domain) ------------------
  // Exhaustive double loop over LAW_DOMAIN (=== MIXED_DOMAIN); no pair returns NaN
  // post-ADR-0033, so `sign` (NaN-throwing) is safe and the law holds everywhere.
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

  // ---- LAW: reflexivity on ±Infinity / overflow literals (FIXED) -------
  // Was a KNOWN DEFECT: parseFloat("Infinity") === Infinity passed the legacy
  // numeric guard, so cmp returned Infinity - Infinity === NaN. ADR 0033 Option B
  // admits only WHOLE-STRING FINITE tokens to the number bucket, so "Infinity" /
  // "-Infinity" / "1e999" fall to the STRING bucket and self-compare to 0. No more
  // NaN return; `sign` (NaN-throwing) no longer trips on them.
  it("FIXED: ±Infinity / overflow literals self-compare to 0 (string bucket, no NaN)", () => {
    expect(intelligentCompare("Infinity", "Infinity")).toBe(0);
    expect(intelligentCompare("-Infinity", "-Infinity")).toBe(0);
    expect(intelligentCompare("1e999", "1e999")).toBe(0); // overflow -> string bucket
    expect(Number.isNaN(intelligentCompare("Infinity", "Infinity"))).toBe(false);
    // `sign` no longer throws (the comparator never returns NaN here anymore)
    expect(() => sign(intelligentCompare("Infinity", "Infinity"))).not.toThrow();
    // ordered as plain strings against finite numbers (numbers < strings)
    expect(sign(intelligentCompare("5", "Infinity"))).toBe(-1); // number bucket < string
  });

  // ---- LAW: transitivity (FIXED — per-value classification) ------------
  // Was the e8e / ADR-0025 bug class on this surface. ADR 0033 Option B classifies
  // each value ONCE (dates < numbers < strings), so the relation is transitive by
  // construction. These flip from "a violation EXISTS" to "the law HOLDS".
  it("FIXED: the formerly non-transitive triple now obeys transitivity", () => {
    const a = "2024-01-01"; // date bucket (0)
    const b = ""; // string bucket (2)
    const c = "10"; // number bucket (1)
    // buckets: a(0) < c(1) < b(2)
    expect(sign(intelligentCompare(a, b))).toBe(-1); // a(0) < b(2)
    expect(sign(intelligentCompare(b, c))).toBe(1); // b(2) > c(1)
    expect(sign(intelligentCompare(a, c))).toBe(-1); // a(0) < c(1)
    // transitivity now holds: a < c and a < b and c < b are mutually consistent.
    expect(sign(intelligentCompare(c, b))).toBe(-1); // c(1) < b(2)
  });

  it("LAW transitivity: ZERO violations across the full mixed domain", () => {
    // Exhaustive triple scan over the FULL MIXED_DOMAIN (incl. "Infinity"). Post
    // ADR-0033 no pair returns NaN, so `sortSign` and `sign` agree; we keep
    // `sortSign` (the same counter the lock used) and assert the count is exactly 0.
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
    expect(violations).toBe(0);
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

  it("FIXED: a mixed-type array sort is now WELL-DEFINED and idempotent", () => {
    // Post ADR-0033 the comparator is a real strict weak ordering, so the FULL
    // mixed domain has a DEFINED sorted order (no longer a V8/TimSort artifact).
    // NOTE: sensitivity:'base' makes case/accent variants (e.g. "abc"/"ABC") an
    // EQUIVALENCE CLASS (cmp === 0) — a legitimate strict-weak-ordering feature —
    // so a STABLE sort preserves their relative INPUT order. We therefore assert
    // determinism on a SORTED-KEY basis (each input permutation produces the same
    // SEQUENCE OF COMPARISON KEYS), plus idempotence and cross-bucket grouping —
    // never a single byte-exact order across reversed inputs, which would falsely
    // claim equivalent-but-distinct strings have a defined relative order.
    const input = [...MIXED_DOMAIN];
    let out: string[] = [];
    expect(() => {
      out = [...input].sort(intelligentCompare);
    }).not.toThrow();
    expect(out).toHaveLength(input.length);
    expect([...out].sort()).toEqual([...input].sort()); // same multiset
    // idempotence: sorting the sorted output is a no-op (stable + total order)
    expect([...out].sort(intelligentCompare)).toEqual(out);
    // determinism up to equivalence: any starting permutation yields a result that
    // is pairwise non-decreasing AND identical to `out` after collapsing each value
    // to its comparison position (so equivalence-class members may swap but nothing
    // crosses a real boundary).
    const reversed = [...MIXED_DOMAIN].reverse().sort(intelligentCompare);
    for (let i = 1; i < out.length; i++) {
      expect(sign(intelligentCompare(out[i - 1], out[i]))).toBeLessThanOrEqual(0);
      expect(sign(intelligentCompare(reversed[i - 1], reversed[i]))).toBeLessThanOrEqual(0);
      // same value at each rank up to equivalence (cmp === 0)
      expect(intelligentCompare(out[i], reversed[i])).toBe(0);
    }
    // cross-bucket grouping holds: every valid date precedes every finite number
    // which precedes every string (dates < numbers < strings).
    const idx = (v: string) => out.indexOf(v);
    expect(idx("2024-01-01")).toBeLessThan(idx("10")); // date < number
    expect(idx("10")).toBeLessThan(idx("abc")); // number < string
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

  it("FIXED (Notidian-dox item 1): a truthy non-array `options` degrades to [] (Array.isArray guard)", () => {
    // Was a KNOWN GAP characterization (crash); now hardened. A malformed /
    // legacy / hand-edited definition with `options` as a truthy non-array
    // (number/string/true) no longer throws on the unguarded .filter — it
    // degrades to []. Crash -> safe, with NO observable change for valid
    // (array) data. Items (2) (falsy opt.value dropped) and (3) (real 0 ->
    // '' in getUniqueSortedValues) remain LOCKED characterization below: both
    // change observable output for edge data, so they ride the ADR-0025 /
    // ADR-0033 comparator-correctness decision posture, not this Q1 fix.
    expect(getOptionsOrder({ value: JSON.stringify({ options: 5 }) })).toEqual([]);
    expect(getOptionsOrder({ value: JSON.stringify({ options: "abc" }) })).toEqual([]);
    expect(getOptionsOrder({ value: JSON.stringify({ options: true }) })).toEqual([]);
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

  // ---- temporal: junk dates obey the SWO laws (NaN-last) ------------------
  // FIXED (Notidian-zj8b / ADR 0033): the legacy branch returned a bare
  // `getTime() - getTime()`, so an unparseable date gave NaN — `compare(x,x)` could
  // be NaN (non-reflexive) and `valid - NaN === NaN`, handing Array.prototype.sort
  // (LineChartUtility.ts:173,600) a V8/TimSort-order-dependent contract. The branch
  // now applies the same NaN-to-one-end discipline as classifyForSort: an
  // unparseable date sorts AFTER every valid one and self-compares to 0.
  it("temporal: unparseable date sorts AFTER a valid date, symmetrically (no NaN)", () => {
    expect(
      sign(sortByEncodingType(row("not-a-date"), row("2024-01-01"), "temporal", "k"))
    ).toBe(1); // junk after valid
    expect(
      sign(sortByEncodingType(row("2024-01-01"), row("not-a-date"), "temporal", "k"))
    ).toBe(-1); // valid before junk (symmetric)
    expect(
      Number.isNaN(sortByEncodingType(row("not-a-date"), row("2024-01-01"), "temporal", "k"))
    ).toBe(false);
  });

  it("temporal: a junk-bearing axis obeys the SWO laws (reflexive/antisymmetric/transitive)", () => {
    // Mirrors the intelligentCompare SWO block: valid dates, a Date instance, and
    // unparseable cells (the exact uncontrolled user data fed to the chart sort).
    const TEMPORAL_DOMAIN = [
      "2024-01-01",
      "2024-12-31",
      "2023-06-15",
      new Date("2024-06-15"),
      "not-a-date",
      "", // String("") -> Invalid Date -> NaN time
      "garbage",
    ];
    const cmp = (a: any, b: any) =>
      sortByEncodingType(row(a), row(b), "temporal", "k");
    // reflexive: compare(x,x) === 0 (sign throws on NaN, so a regression fails loud)
    for (const x of TEMPORAL_DOMAIN) expect(sign(cmp(x, x))).toBe(0);
    // antisymmetric
    for (const a of TEMPORAL_DOMAIN)
      for (const b of TEMPORAL_DOMAIN)
        expect(sign(cmp(a, b))).toBe(inv(sign(cmp(b, a))));
    // transitive
    for (const a of TEMPORAL_DOMAIN)
      for (const b of TEMPORAL_DOMAIN)
        for (const c of TEMPORAL_DOMAIN) {
          const ab = sign(cmp(a, b));
          const bc = sign(cmp(b, c));
          const ac = sign(cmp(a, c));
          if (ab <= 0 && bc <= 0) expect(ac).toBeLessThanOrEqual(0);
          if (ab >= 0 && bc >= 0) expect(ac).toBeGreaterThanOrEqual(0);
        }
  });

  it("quantitative: numeric subtraction via Number(); valid axis byte-identical", () => {
    expect(sign(sortByEncodingType(row("2"), row("10"), "quantitative", "k"))).toBe(-1);
    expect(sortByEncodingType(row(5), row(5), "quantitative", "k")).toBe(0);
    // all-finite pairs return the EXACT legacy `na - nb` (single-type axis unchanged)
    expect(sortByEncodingType(row("10"), row("2"), "quantitative", "k")).toBe(8);
  });

  // ---- quantitative: non-numeric junk obeys the SWO laws (NaN-last) -------
  // FIXED (Notidian-zj8b / ADR 0033): the legacy branch returned a bare
  // `Number(aVal) - Number(bVal)`, so non-numeric junk gave NaN with the same
  // non-reflexive / undefined-contract defect as the temporal branch.
  it("quantitative: non-numeric junk sorts AFTER a number, symmetrically (no NaN)", () => {
    expect(
      sign(sortByEncodingType(row("x"), row(5), "quantitative", "k"))
    ).toBe(1); // junk after number
    expect(
      sign(sortByEncodingType(row(5), row("x"), "quantitative", "k"))
    ).toBe(-1); // number before junk (symmetric)
    // two junk cells are order-equivalent (reflexive-style equality), not NaN
    expect(sortByEncodingType(row("x"), row("y"), "quantitative", "k")).toBe(0);
    expect(
      Number.isNaN(sortByEncodingType(row("x"), row("y"), "quantitative", "k"))
    ).toBe(false);
  });

  it("quantitative: a junk-bearing axis obeys the SWO laws (reflexive/antisymmetric/transitive)", () => {
    const QUANT_DOMAIN = [10, 2, -5, 0, "9", "100", "x", "", null, undefined, NaN];
    const cmp = (a: any, b: any) =>
      sortByEncodingType(row(a), row(b), "quantitative", "k");
    // NOTE: Number("") === 0 and Number(null) === 0 (finite), so these participate
    // as the numeric value 0; only genuinely non-numeric cells ("x", undefined, NaN)
    // become NaN and sort last. The laws must hold across the whole mixed axis.
    for (const x of QUANT_DOMAIN) expect(sign(cmp(x, x))).toBe(0); // reflexive
    for (const a of QUANT_DOMAIN)
      for (const b of QUANT_DOMAIN)
        expect(sign(cmp(a, b))).toBe(inv(sign(cmp(b, a)))); // antisymmetric
    for (const a of QUANT_DOMAIN)
      for (const b of QUANT_DOMAIN)
        for (const c of QUANT_DOMAIN) {
          const ab = sign(cmp(a, b));
          const bc = sign(cmp(b, c));
          const ac = sign(cmp(a, c));
          if (ab <= 0 && bc <= 0) expect(ac).toBeLessThanOrEqual(0);
          if (ab >= 0 && bc >= 0) expect(ac).toBeGreaterThanOrEqual(0);
        }
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
