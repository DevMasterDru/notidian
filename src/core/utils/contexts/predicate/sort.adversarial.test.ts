import {
  sortFnTypes,
  normalizedSortForType,
  sortReturnForCol,
  SortFunction,
} from "./sort";
import { SpaceProperty, SpaceTableColumn } from "shared/types/mdb";

// ===========================================================================
// COMPARATOR-AXIOM PROPERTY SUITE for the live table-sort comparator family
// src/core/utils/contexts/predicate/sort.ts (Notidian-yzvh).
//
// sort.ts is the LIVE table-sort comparator family: every property type's
// SortFunction returns -1|0|1 and is handed to Array.prototype.sort. ADR 0025
// (array-comparator-correctness) and ADR 0033 (intelligentCompare viz comparator
// non-transitivity) document comparator NON-TRANSITIVITY as a recurring, costly
// fragility on this codebase — a comparator that violates the strict-weak-ordering
// axioms makes Array.sort produce engine-dependent, silently-wrong row order (and
// historically could throw 'comparison function must be consistent' under V8
// strict-consistency). The sibling example file sort.test.ts already pins a triad
// per type by HAND-PICKED case lists; this file is the SAFE INFINITE-QUOTA SINK on
// the same surface — it goes WIDER and proves the axioms over randomized +
// adversarial value sets, EACH resolver-reachable SortFunction, AND sortReturnForCol
// end-to-end, with a real randomized Array.prototype.sort run.
//
// It asserts, for every comparator reached through the (type, desc, subKey)
// resolver and for sortReturnForCol on a column, over the canonical adversarial
// corpus (null/undefined, NaN, mixed types, empty/whitespace, dups, equal keys,
// very long multi-strings, out-of-options values, unicode/locale edge strings):
//
//   (A1) RESULT RANGE     fn(a,b) ∈ {-1, 0, 1}  (never NaN / 2 / -2 / undefined).
//                         The SortResultType cast is otherwise unverified — a
//                         localeCompare that returned ±2 on some ICU build, or a
//                         NaN return, would be a silent SWO violation.
//   (A2) REFLEXIVITY      cmp(a, a) === 0.
//   (A3) ANTISYMMETRY     sign(cmp(a, b)) === -sign(cmp(b, a)).
//   (A4) TRANSITIVITY     cmp(a,b) <= 0 && cmp(b,c) <= 0  =>  cmp(a,c) <= 0,
//                         and the dual (>= 0), and the STRICT variant
//                         (cmp(a,b) < 0 && cmp(b,c) < 0 => cmp(a,c) < 0).
//   (A5) EQUAL-CLASS      cmp(a,b) === 0  =>  sign(cmp(a,c)) === sign(cmp(b,c))
//        CONSISTENCY      (the "==0" equivalence is itself transitive — the exact
//                         property a per-value bucket comparator must have and a
//                         per-PAIR branch comparator like the ADR-0033 defect
//                         violates).
//   (A6) DESC = -ASC      for every asc/desc sibling pair the resolver exposes,
//                         sign(desc(a,b)) === -sign(asc(a,b)).
//   (A7) STABLE SORT      a real Array.prototype.sort over a randomized array with
//                         the comparator NEVER throws, returns a PERMUTATION of the
//                         input (no element lost/duplicated/invented), and is
//                         IDEMPOTENT (re-sorting the sorted array yields the same
//                         order) — the consistency a correct comparator guarantees
//                         and a non-transitive one cannot.
//
// A failing axiom on a live comparator would be a clear-correct BUG to fix with the
// smallest correct total-order tiebreak / null-class normalization (consistent with
// filter.ts asText + parseFlexValue(...).value and aggregates.ts flex unwrap), then
// pin. The Notidian-5ym fix already closed the two known violations (numSort NaN
// non-transitivity; option-multi resolver shadowing), so under the current code this
// suite is pure REGRESSION INSURANCE that catches any future reintroduction.
//
// Pure / offline — no vault, no DOM, no I/O. No render-path change, so per AGENTS.md
// it is NOT flag-gated.
//
// CONVENTION: hand-rolled mulberry32 PRNG + a property-run loop, NO fast-check
// dependency — matching sort.test.ts, predicate.adversarial.test.ts,
// tableRollup.property.test.ts, and src/shared/utils/array.test.ts in-repo.
// ===========================================================================

// --- tiny deterministic PRNG (no external dep) -----------------------------
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
const pick = <T>(rng: () => number, arr: readonly T[]): T =>
  arr[randInt(rng, 0, arr.length - 1)];

const PROPERTY_RUNS = 500;
const SORT_RUNS = 200;

// Normalize a comparator result to exactly {-1, 0, 1}. Reverse comparators emit
// -0 (from `result * -1`), and `-0 !== 0` under Jest's Object.is-based toBe; the
// `|| 0` collapses -0 -> +0 so the law assertions are clean.
const sign = (n: number) => (n < 0 ? -1 : n > 0 ? 1 : 0) || 0;
const inv = (s: number) => -s || 0;

// (A1) the RAW return value must be exactly one of the three legal codes — not a
// magnitude-2 localeCompare, not NaN, not undefined. This is the property the
// `as SortResultType` cast asserts but never checks. Number.isNaN catches the
// ADR-0033 Infinity-style NaN return; the membership check catches an out-of-range
// localeCompare. -0 is accepted (=== 0 in the SameValueZero sense Array.sort uses).
const assertLegalCode = (r: unknown) => {
  expect(typeof r).toBe("number");
  expect(Number.isNaN(r as number)).toBe(false);
  expect([-1, 0, 1]).toContain((r as number) === 0 ? 0 : (r as number));
};

// ---------------------------------------------------------------------------
// Core axiom checker for a single comparator over a fixed domain. Runs the full
// O(n^3) brute force over the (deliberately small) adversarial domain for exact
// transitivity coverage, then a randomized stress pass for breadth.
// ---------------------------------------------------------------------------
const assertComparatorAxioms = (
  fn: SortFunction,
  domain: readonly any[],
  fieldDef: SpaceProperty | undefined,
  seed: number
) => {
  // (A1) RESULT RANGE over every ordered pair in the domain.
  for (const a of domain) {
    for (const b of domain) {
      assertLegalCode(fn(a, b, fieldDef));
    }
  }

  // (A2) REFLEXIVITY.
  for (const x of domain) {
    expect(sign(fn(x, x, fieldDef))).toBe(0);
  }

  // (A3) ANTISYMMETRY.
  for (const a of domain) {
    for (const b of domain) {
      expect(sign(fn(a, b, fieldDef))).toBe(inv(sign(fn(b, a, fieldDef))));
    }
  }

  // (A4) TRANSITIVITY (ordering + strict) and (A5) EQUAL-CLASS CONSISTENCY,
  // brute-forced over every triple.
  for (const a of domain) {
    for (const b of domain) {
      const ab = sign(fn(a, b, fieldDef));
      for (const c of domain) {
        const bc = sign(fn(b, c, fieldDef));
        const ac = sign(fn(a, c, fieldDef));
        // ordering transitivity (both directions)
        if (ab <= 0 && bc <= 0) expect(ac).toBeLessThanOrEqual(0);
        if (ab >= 0 && bc >= 0) expect(ac).toBeGreaterThanOrEqual(0);
        // STRICT transitivity: a<b<c => a<c
        if (ab < 0 && bc < 0) expect(ac).toBeLessThan(0);
        if (ab > 0 && bc > 0) expect(ac).toBeGreaterThan(0);
        // (A5) equal-class consistency: a==b => a and b compare identically to c.
        if (ab === 0) {
          expect(sign(fn(a, c, fieldDef))).toBe(sign(fn(b, c, fieldDef)));
        }
      }
    }
  }

  // randomized stress pass (catches order-dependent surprises beyond the small
  // brute-forced domain — the domain is sampled with replacement).
  const rng = makeRng(seed);
  for (let i = 0; i < PROPERTY_RUNS; i++) {
    const a = pick(rng, domain);
    const b = pick(rng, domain);
    const c = pick(rng, domain);
    assertLegalCode(fn(a, b, fieldDef));
    expect(sign(fn(a, b, fieldDef))).toBe(inv(sign(fn(b, a, fieldDef))));
    const ab = sign(fn(a, b, fieldDef));
    const bc = sign(fn(b, c, fieldDef));
    const ac = sign(fn(a, c, fieldDef));
    if (ab <= 0 && bc <= 0) expect(ac).toBeLessThanOrEqual(0);
    if (ab >= 0 && bc >= 0) expect(ac).toBeGreaterThanOrEqual(0);
    if (ab === 0) expect(sign(fn(a, c, fieldDef))).toBe(sign(fn(b, c, fieldDef)));
  }
};

// (A7) A real Array.prototype.sort run: never throws, output is a PERMUTATION of
// the input, and the sort is IDEMPOTENT (re-sorting the result yields the same
// order — the consistency a correct SWO guarantees). A non-transitive comparator
// would still terminate on modern V8 but could fail the idempotence check.
const assertArraySortConsistent = (
  comparator: (a: any, b: any) => number,
  pool: readonly any[],
  seed: number
) => {
  const rng = makeRng(seed);
  for (let run = 0; run < SORT_RUNS; run++) {
    const len = randInt(rng, 0, 24);
    const arr: any[] = [];
    for (let i = 0; i < len; i++) arr.push(pick(rng, pool));

    let sorted!: any[];
    expect(() => {
      sorted = [...arr].sort(comparator);
    }).not.toThrow();

    // PERMUTATION: same length and same multiset of elements (NaN-safe tally).
    expect(sorted.length).toBe(arr.length);
    const tally = (xs: any[]) => {
      const m = new Map<string, number>();
      for (const x of xs) {
        const k =
          x === undefined
            ? "__undef__"
            : x === null
            ? "__null__"
            : typeof x === "number" && Number.isNaN(x)
            ? "__nan__"
            : `${typeof x}:${String(x)}`;
        m.set(k, (m.get(k) ?? 0) + 1);
      }
      return m;
    };
    const before = tally(arr);
    const after = tally(sorted);
    expect(after.size).toBe(before.size);
    for (const [k, v] of before) expect(after.get(k)).toBe(v);

    // IDEMPOTENT / consistent: re-sorting the sorted array does not reorder it.
    const resorted = [...sorted].sort(comparator);
    expect(resorted).toEqual(sorted);
  }
};

// ---------------------------------------------------------------------------
// fieldDefs the option comparators read.
// ---------------------------------------------------------------------------
const optionFieldDef: SpaceProperty = {
  name: "priority",
  type: "option",
  value: JSON.stringify({
    options: [{ value: "high" }, { value: "med" }, { value: "low" }],
  }),
};
const optionMultiFieldDef: SpaceProperty = {
  ...optionFieldDef,
  type: "option-multi",
};
// An option fieldDef whose options include a falsy value ("") that getOptionsOrder
// drops via `opt?.value`, plus a unicode option — to exercise out-of-options + the
// falsy-option-drop edge inside the comparator.
const optionFieldDefEdge: SpaceProperty = {
  name: "edge",
  type: "option",
  value: JSON.stringify({
    options: [
      { value: "Z" },
      { value: "café" },
      { value: "" }, // dropped by getOptionsOrder's truthy filter
      { value: "10" },
    ],
  }),
};

// ---------------------------------------------------------------------------
// ADVERSARIAL VALUE CORPORA — one per value family, each crossing the canonical
// hostile inputs the bead enumerates: null/undefined, NaN, mixed types,
// empty/whitespace, duplicates, equal keys, very long multi-strings,
// out-of-options values, unicode/locale edge strings.
// ---------------------------------------------------------------------------

// A long multi-string (cardinality stress for countSort / option-multi parsing).
const LONG_MULTI = Array.from({ length: 64 }, (_v, i) => `t${i}`).join(",");
const LONG_JSON_MULTI = JSON.stringify(
  Array.from({ length: 50 }, (_v, i) => `j${i}`)
);

// Strings: unicode/locale edges, numeric-collation, case folds, blanks, nulls,
// duplicates (equal keys appear twice), long strings.
const STRING_DOMAIN: readonly any[] = [
  "apple",
  "Apple", // case fold (base sensitivity -> equal to "apple")
  "apple", // duplicate / equal key
  "banana",
  "a9",
  "a10", // numeric collation: a9 < a10
  "a2",
  "café",
  "cafe", // accent fold
  "Z",
  "z",
  "",
  "   ", // whitespace
  "\t\n",
  "ß", // sharp-s
  "ﬁle", // ligature
  "Ⅻ", // roman numeral twelve
  "𝕏", // astral plane
  "ＡＢＣ", // fullwidth
  "x".repeat(300), // very long
  null,
  undefined,
];

// Numbers: well-formed, junk (-> NaN), parseFloat-prefix, blanks, nulls, dups,
// scientific/Infinity literals, equal keys.
const NUMBER_DOMAIN: readonly any[] = [
  "1",
  "2",
  "10",
  "10", // duplicate / equal key
  "-5",
  "0",
  "3.14",
  "100",
  "1e3",
  "Infinity",
  "-Infinity",
  "NaN",
  "abc", // -> NaN
  "3px", // parseFloat -> 3
  "  ", // -> NaN
  "",
  "7,000", // parseFloat -> 7
  "x".repeat(200), // -> NaN (very long junk)
  null,
  undefined,
];

// Dates (delegate to stringSort): ISO, partials, garbage, blanks, nulls, dups.
const DATE_DOMAIN: readonly any[] = [
  "2024-01-01",
  "2024-12-31",
  "2023-06-15",
  "2024-01-02",
  "2024-01-01", // duplicate / equal key
  "2024-1-1", // numeric collation vs zero-padded
  "not-a-date",
  "1e999",
  "",
  "   ",
  null,
  undefined,
];

// Booleans: only literal "true" is the high class; everything else collapses to
// the low equivalence class — a deliberately LARGE equal class (the A5 stressor).
const BOOL_DOMAIN: readonly any[] = [
  "true",
  "false",
  "TRUE", // case-sensitive -> low class
  "yes",
  "1",
  "0",
  "",
  "   ",
  "true", // duplicate / equal key in the high class
  "false", // duplicate / equal key in the low class
  null,
  undefined,
];

// Links: path strings compared by trailing segment, plus unicode basenames,
// blanks, nulls, dups, equal-basename-different-path (equal keys).
const LINK_DOMAIN: readonly any[] = [
  "space/folder/note",
  "other/note", // SAME basename "note", different path -> equal key
  "note",
  "space/folder/aaa",
  "z/y/x/apple",
  "banana",
  "space/folder/café", // unicode basename
  "deep/path/café", // equal unicode basename
  "Z/zzz",
  "",
  "   ",
  "a/", // trailing slash -> pop() === ""
  null,
  undefined,
];

// option (single): in-options + out-of-options + unicode + falsy + blanks + nulls.
const OPTION_DOMAIN: readonly any[] = [
  "high",
  "med",
  "low",
  "high", // duplicate / equal key (in-options)
  "unknown", // out-of-options
  "another", // out-of-options
  "ZZZ",
  "café", // out-of-options unicode
  "",
  "   ",
  null,
  undefined,
];

// option-multi (ORDER family): first-value drives optionSort; mixed cardinality,
// long multi, blanks, nulls, dups.
const OPTION_MULTI_DOMAIN: readonly any[] = [
  "high,low",
  "med",
  "low,high",
  "high,med,low",
  "high,low", // duplicate / equal key
  "unknown,high", // first value out-of-options
  LONG_MULTI,
  LONG_JSON_MULTI,
  "",
  "   ",
  null,
  undefined,
];

// count family (cardinality): JSON arrays, comma display, long multi, blanks,
// nulls, equal-cardinality-different-content (equal keys).
const COUNT_DOMAIN: readonly any[] = [
  '["a","b","c"]',
  '["a"]',
  "x,y",
  "x",
  "p,q", // same cardinality (2) as "x,y" -> equal key
  "a,b,c,d",
  LONG_MULTI,
  LONG_JSON_MULTI,
  "",
  "   ",
  null,
  undefined,
];

// ===========================================================================
// (R) RESOLVER REACHABILITY — every sortFnTypes entry must be reachable through
// normalizedSortForType for SOME (type, desc, subKey). A SortFunction the resolver
// cannot reach is dead in the table-view path; the bead requires the axiom suite to
// cover EACH resolver-reachable SortFunction, so first we PROVE the set we iterate
// IS the full table (no entry silently shadowed — the Notidian-5ym option-multi
// shadowing class).
// ===========================================================================
describe("resolver reachability (every SortFunction is reachable — Notidian-yzvh)", () => {
  // Enumerate every (type, desc, subKey) the table declares.
  const allTypes = Array.from(
    new Set(Object.values(sortFnTypes).flatMap((e) => e.type))
  );
  const allSubKeys = Array.from(
    new Set(
      Object.values(sortFnTypes)
        .map((e) => e.subKey)
        .filter((s): s is string => s != null)
    )
  );

  it("reaches EVERY sortFnTypes key via some (type, desc, subKey) — none are orphaned", () => {
    const reached = new Set<string>();
    for (const type of allTypes) {
      for (const desc of [true, false]) {
        // default resolution (no subKey)
        const def = normalizedSortForType(type, desc);
        if (def) reached.add(def);
        // every declared subKey
        for (const sk of allSubKeys) {
          const r = normalizedSortForType(type, desc, sk);
          if (r) reached.add(r);
        }
      }
    }
    const all = new Set(Object.keys(sortFnTypes));
    const orphans = [...all].filter((k) => !reached.has(k));
    expect(orphans).toEqual([]);
    expect(reached.size).toBe(all.size);
  });

  it("an unknown type resolves to undefined (no spurious comparator)", () => {
    expect(normalizedSortForType("definitely-not-a-type", false)).toBeUndefined();
    expect(normalizedSortForType("", true)).toBeUndefined();
  });
});

// ===========================================================================
// (P) PER-COMPARATOR AXIOM SUITE — every resolver-reachable SortFunction, asc +
// desc, over its adversarial domain. Driven through normalizedSortForType so the
// suite tests exactly the comparators the table-view path reaches.
// ===========================================================================

// Map each comparator key to (domain, fieldDef). Reverse/asc share the domain.
const DOMAIN_FOR: Record<
  string,
  { domain: readonly any[]; fieldDef?: SpaceProperty }
> = {
  alphabetical: { domain: STRING_DOMAIN },
  reverseAlphabetical: { domain: STRING_DOMAIN },
  earliest: { domain: DATE_DOMAIN },
  latest: { domain: DATE_DOMAIN },
  number: { domain: NUMBER_DOMAIN },
  reverseNumber: { domain: NUMBER_DOMAIN },
  boolean: { domain: BOOL_DOMAIN },
  booleanReverse: { domain: BOOL_DOMAIN },
  linkAlphabetical: { domain: LINK_DOMAIN },
  linkReverseAlphabetical: { domain: LINK_DOMAIN },
  optionOrder: { domain: OPTION_DOMAIN, fieldDef: optionFieldDef },
  reverseOptionOrder: { domain: OPTION_DOMAIN, fieldDef: optionFieldDef },
  optionMultiOrder: {
    domain: OPTION_MULTI_DOMAIN,
    fieldDef: optionMultiFieldDef,
  },
  reverseOptionMultiOrder: {
    domain: OPTION_MULTI_DOMAIN,
    fieldDef: optionMultiFieldDef,
  },
  count: { domain: COUNT_DOMAIN },
  reverseCount: { domain: COUNT_DOMAIN },
  optionMultiCount: { domain: COUNT_DOMAIN, fieldDef: optionMultiFieldDef },
  reverseOptionMultiCount: {
    domain: COUNT_DOMAIN,
    fieldDef: optionMultiFieldDef,
  },
};

describe("per-comparator axioms over adversarial domains (Notidian-yzvh)", () => {
  // Every key in the live table gets the full axiom suite — table-driven so a new
  // SortFunction added to sortFnTypes without a domain entry fails loudly here.
  const keys = Object.keys(sortFnTypes);

  it("DOMAIN_FOR covers every sortFnTypes key (a new comparator cannot skip the suite)", () => {
    const missing = keys.filter((k) => !(k in DOMAIN_FOR));
    expect(missing).toEqual([]);
  });

  let seed = 0xa11ce0;
  for (const key of keys) {
    it(`${key}: reflexive · antisymmetric · transitive · equal-class · in-range`, () => {
      const { domain, fieldDef } = DOMAIN_FOR[key];
      assertComparatorAxioms(sortFnTypes[key].fn, domain, fieldDef, seed++);
    });
  }

  // Also exercise the option comparators with the EDGE fieldDef (falsy option
  // dropped + unicode + numeric option), and the option-order comparators with NO
  // fieldDef (the pure stringSort fallback path) — both reachable configurations.
  it("optionOrder over the edge fieldDef (falsy/unicode/numeric options) holds the axioms", () => {
    assertComparatorAxioms(
      sortFnTypes.optionOrder.fn,
      OPTION_DOMAIN,
      optionFieldDefEdge,
      0xed6e01
    );
    assertComparatorAxioms(
      sortFnTypes.reverseOptionOrder.fn,
      OPTION_DOMAIN,
      optionFieldDefEdge,
      0xed6e02
    );
  });

  it("optionOrder with NO fieldDef (stringSort fallback) holds the axioms", () => {
    assertComparatorAxioms(
      sortFnTypes.optionOrder.fn,
      OPTION_DOMAIN,
      undefined,
      0xed6e03
    );
  });

  it("optionOrder with a malformed-JSON fieldDef (stringSort fallback) holds the axioms", () => {
    const badJson: SpaceProperty = {
      name: "x",
      type: "option",
      value: "{not valid json",
    };
    assertComparatorAxioms(
      sortFnTypes.optionOrder.fn,
      OPTION_DOMAIN,
      badJson,
      0xed6e04
    );
  });
});

// ===========================================================================
// (D) DESC === NEGATED ASC — for every asc/desc sibling pair the resolver exposes,
// sign(desc(a,b)) === -sign(asc(a,b)). A desc comparator built any other way than
// a clean negation could silently drift from being a valid (inverted) SWO.
// ===========================================================================
describe("desc comparator === negated asc sign (Notidian-yzvh)", () => {
  // (ascKey, descKey, domain, fieldDef). The count family's labels are inverted
  // (count.desc===true) but the FN relationship still holds: reverseCount === -count.
  const PAIRS: Array<{
    asc: string;
    desc: string;
    domain: readonly any[];
    fieldDef?: SpaceProperty;
  }> = [
    { asc: "alphabetical", desc: "reverseAlphabetical", domain: STRING_DOMAIN },
    { asc: "earliest", desc: "latest", domain: DATE_DOMAIN },
    { asc: "number", desc: "reverseNumber", domain: NUMBER_DOMAIN },
    { asc: "boolean", desc: "booleanReverse", domain: BOOL_DOMAIN },
    {
      asc: "linkAlphabetical",
      desc: "linkReverseAlphabetical",
      domain: LINK_DOMAIN,
    },
    {
      asc: "optionOrder",
      desc: "reverseOptionOrder",
      domain: OPTION_DOMAIN,
      fieldDef: optionFieldDef,
    },
    {
      asc: "optionMultiOrder",
      desc: "reverseOptionMultiOrder",
      domain: OPTION_MULTI_DOMAIN,
      fieldDef: optionMultiFieldDef,
    },
    // countSort family: reverseCount is the negation of count.
    { asc: "count", desc: "reverseCount", domain: COUNT_DOMAIN },
    {
      asc: "optionMultiCount",
      desc: "reverseOptionMultiCount",
      domain: COUNT_DOMAIN,
      fieldDef: optionMultiFieldDef,
    },
  ];

  for (const { asc, desc, domain, fieldDef } of PAIRS) {
    it(`${desc}(a,b) === -${asc}(a,b) over the full domain + a randomized pass`, () => {
      const ascFn = sortFnTypes[asc].fn;
      const descFn = sortFnTypes[desc].fn;
      for (const a of domain) {
        for (const b of domain) {
          expect(sign(descFn(a, b, fieldDef))).toBe(
            inv(sign(ascFn(a, b, fieldDef)))
          );
        }
      }
      const rng = makeRng(0xdec0de ^ asc.length);
      for (let i = 0; i < PROPERTY_RUNS; i++) {
        const a = pick(rng, domain);
        const b = pick(rng, domain);
        expect(sign(descFn(a, b, fieldDef))).toBe(
          inv(sign(ascFn(a, b, fieldDef)))
        );
      }
    });
  }
});

// ===========================================================================
// (S) REAL Array.prototype.sort RUN — for every resolver-reachable comparator, a
// randomized array sorted with it never throws, is a permutation of the input, and
// re-sorting is idempotent. This is the property the bead names: "a real randomized
// Array.sort run that is consistent and never throws".
// ===========================================================================
describe("real Array.prototype.sort is consistent + never throws (Notidian-yzvh)", () => {
  const keys = Object.keys(sortFnTypes);
  let seed = 0x50f70;
  for (const key of keys) {
    it(`${key}: Array.sort over a randomized pool is permutation-preserving + idempotent`, () => {
      const { domain, fieldDef } = DOMAIN_FOR[key];
      const fn = sortFnTypes[key].fn;
      assertArraySortConsistent(
        (a, b) => fn(a, b, fieldDef),
        domain,
        seed++
      );
    });
  }
});

// ===========================================================================
// (E) sortReturnForCol END-TO-END — the comparator the table view actually hands
// to Array.prototype.sort is `(r1, r2) => sortReturnForCol(col, sort, r1, r2)`. We
// drive THAT, per column type, over adversarial ROWS (including the flex unwrap
// path), asserting the same axioms on rows + a real Array.sort over rows.
// ===========================================================================
describe("sortReturnForCol end-to-end axioms over adversarial rows (Notidian-yzvh)", () => {
  // A column per type, with the option columns carrying their option order in
  // `.value` (sortReturnForCol passes the column itself as the fieldDef).
  const FIELD = "cell";
  const numCol: SpaceTableColumn = { name: FIELD, type: "number" };
  const textCol: SpaceTableColumn = { name: FIELD, type: "text" };
  const dateCol: SpaceTableColumn = { name: FIELD, type: "date" };
  const boolCol: SpaceTableColumn = { name: FIELD, type: "boolean" };
  const linkCol: SpaceTableColumn = { name: FIELD, type: "link" };
  const optCol: SpaceTableColumn = {
    name: FIELD,
    type: "option",
    value: optionFieldDef.value,
  };
  const optMultiCol: SpaceTableColumn = {
    name: FIELD,
    type: "option-multi",
    value: optionMultiFieldDef.value,
  };
  const flexCol: SpaceTableColumn = { name: FIELD, type: "flex" };

  // Wrap a raw cell value into a single-field row. A missing-field row is also
  // injected (undefined cell) to exercise the absent-key branch.
  const rowOf = (v: any) => ({ [FIELD]: v });

  // Flex on-disk cell shapes: JSON wrappers (string/number/boolean/falsy values),
  // bare multi-strings, blanks, garbage, nulls — the full unwrap corpus from av6s.
  const FLEX_DOMAIN: readonly any[] = [
    JSON.stringify({ value: "apple", type: "text" }),
    JSON.stringify({ value: "banana", type: "text" }),
    JSON.stringify({ value: "apple", type: "text" }), // equal key
    JSON.stringify({ value: 5, type: "number" }), // NON-STRING primitive
    JSON.stringify({ value: 0, type: "number" }), // falsy non-string
    JSON.stringify({ value: false, type: "boolean" }), // falsy boolean
    JSON.stringify({ value: true, type: "boolean" }),
    JSON.stringify({ value: "café", type: "text" }), // unicode
    "a,b,c", // bare multi-string -> first element 'a'
    "solo",
    "{}", // JSON object with no .value -> multi-string fallback
    "{not json",
    "",
    "   ",
    null,
    undefined,
  ];

  // Each scenario: (label, column, sort.fn, domain). `fieldDef` is the column
  // itself inside sortReturnForCol, so no separate fieldDef is threaded.
  const SCENARIOS: Array<{
    label: string;
    col: SpaceTableColumn;
    fn: string;
    domain: readonly any[];
  }> = [
    { label: "text/alphabetical", col: textCol, fn: "alphabetical", domain: STRING_DOMAIN },
    { label: "text/reverseAlphabetical", col: textCol, fn: "reverseAlphabetical", domain: STRING_DOMAIN },
    { label: "number/number", col: numCol, fn: "number", domain: NUMBER_DOMAIN },
    { label: "number/reverseNumber", col: numCol, fn: "reverseNumber", domain: NUMBER_DOMAIN },
    { label: "date/earliest", col: dateCol, fn: "earliest", domain: DATE_DOMAIN },
    { label: "date/latest", col: dateCol, fn: "latest", domain: DATE_DOMAIN },
    { label: "boolean/boolean", col: boolCol, fn: "boolean", domain: BOOL_DOMAIN },
    { label: "boolean/booleanReverse", col: boolCol, fn: "booleanReverse", domain: BOOL_DOMAIN },
    { label: "link/linkAlphabetical", col: linkCol, fn: "linkAlphabetical", domain: LINK_DOMAIN },
    { label: "link/linkReverseAlphabetical", col: linkCol, fn: "linkReverseAlphabetical", domain: LINK_DOMAIN },
    { label: "option/optionOrder", col: optCol, fn: "optionOrder", domain: OPTION_DOMAIN },
    { label: "option/reverseOptionOrder", col: optCol, fn: "reverseOptionOrder", domain: OPTION_DOMAIN },
    { label: "option-multi/optionMultiOrder", col: optMultiCol, fn: "optionMultiOrder", domain: OPTION_MULTI_DOMAIN },
    { label: "option-multi/reverseOptionMultiOrder", col: optMultiCol, fn: "reverseOptionMultiOrder", domain: OPTION_MULTI_DOMAIN },
    { label: "option-multi/optionMultiCount", col: optMultiCol, fn: "optionMultiCount", domain: COUNT_DOMAIN },
    { label: "option-multi/reverseOptionMultiCount", col: optMultiCol, fn: "reverseOptionMultiCount", domain: COUNT_DOMAIN },
    // flex column under both the count family (raw multi-string) and the string/
    // number families (scalar flexSortKey) — the av6s crash-class surface.
    { label: "flex/count", col: flexCol, fn: "count", domain: FLEX_DOMAIN },
    { label: "flex/alphabetical", col: flexCol, fn: "alphabetical", domain: FLEX_DOMAIN },
    { label: "flex/number", col: flexCol, fn: "number", domain: FLEX_DOMAIN },
    { label: "flex/linkAlphabetical", col: flexCol, fn: "linkAlphabetical", domain: FLEX_DOMAIN },
  ];

  let seed = 0xe2e000;
  for (const { label, col, fn, domain } of SCENARIOS) {
    it(`${label}: reflexive · antisymmetric · transitive · in-range · sort-consistent`, () => {
      const sortDef = { field: FIELD, fn } as any;
      // Adapt sortReturnForCol(col, sort, row, row2) to the (v, f) comparator shape
      // by wrapping each raw value in its single-field row.
      const cmp: SortFunction = (v: any, f: any) =>
        sortReturnForCol(col, sortDef, rowOf(v), rowOf(f)) as any;

      // Axioms over the raw value domain (rows built inside cmp).
      assertComparatorAxioms(cmp, domain, undefined, seed++);

      // A real Array.sort over ROWS (the production shape: sort an array of rows).
      const rows = domain.map(rowOf);
      const rowCmp = (r1: any, r2: any) => sortReturnForCol(col, sortDef, r1, r2);
      const rng = makeRng(seed++);
      for (let run = 0; run < SORT_RUNS; run++) {
        const len = randInt(rng, 0, 20);
        const arr: any[] = [];
        for (let i = 0; i < len; i++) arr.push(pick(rng, rows));
        let sorted!: any[];
        expect(() => {
          sorted = [...arr].sort(rowCmp);
        }).not.toThrow();
        expect(sorted.length).toBe(arr.length);
        // idempotent re-sort
        expect([...sorted].sort(rowCmp)).toEqual(sorted);
      }
    });
  }

  it("a degenerate / unknown sort.fn yields 0 for every pair and a no-op stable sort", () => {
    // sortReturnForCol returns 0 for a missing column or unknown fn — that is a
    // CONSTANT comparator, trivially a valid SWO (everything equal). Pin that a
    // real Array.sort with it never throws and preserves input order (stable).
    const sortDef = { field: FIELD, fn: "no-such-fn" } as any;
    const rows = STRING_DOMAIN.map(rowOf);
    const cmp = (r1: any, r2: any) =>
      sortReturnForCol(textCol, sortDef, r1, r2);
    for (const a of rows)
      for (const b of rows) expect(cmp(a, b)).toBe(0);
    const sorted = [...rows].sort(cmp);
    expect(sorted).toEqual(rows); // stable: order preserved (all-equal)
  });

  it("a missing/falsy column yields 0 and never throws (guard at sortReturnForCol head)", () => {
    const sortDef = { field: FIELD, fn: "alphabetical" } as any;
    expect(
      sortReturnForCol(null as any, sortDef, rowOf("a"), rowOf("b"))
    ).toBe(0);
    expect(
      sortReturnForCol(undefined as any, sortDef, rowOf("a"), rowOf("b"))
    ).toBe(0);
  });
});
