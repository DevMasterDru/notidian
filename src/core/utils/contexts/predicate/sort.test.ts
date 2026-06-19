import {
  sortFnTypes,
  normalizedSortForType,
  sortReturnForCol,
  flexSortKey,
  SortFunction,
} from "./sort";
import { SpaceProperty, SpaceTableColumn } from "shared/types/mdb";

// ---------------------------------------------------------------------------
// DEPTH (Q1) — property + characterization tests for the table ordering engine
// src/core/utils/contexts/predicate/sort.ts (Notidian-3wa). This module had ZERO
// direct coverage yet is load-bearing: sortReturnForCol is the comparator the
// table view feeds to Array.prototype.sort for EVERY column type.
//
// The headline concern (parallel to Notidian-e8e / ADR-0025) is the SORT-LAW
// TRIAD. Array.prototype.sort assumes its comparator is a strict weak ordering:
//
//   reflexive       cmp(x, x) === 0
//   antisymmetric   sign(cmp(a, b)) === -sign(cmp(b, a))
//   transitive      cmp(a,b) <= 0 && cmp(b,c) <= 0  =>  cmp(a,c) <= 0
//                   (and the equivalence "==0" relation must itself be transitive)
//
// A comparator that violates these produces V8-version-dependent, unstable, or
// outright wrong orderings (the e8e bug class). Most sort.ts comparators delegate
// to `simpleSort` (which IS reflexive: returns 0 when a===b) — a structural
// improvement over array.ts — so we PIN that they satisfy the triad. But two
// genuine violations surfaced empirically and are LOCKED here as characterization
// (NOT fixed in this bead — see the follow-up filed by Notidian-3wa):
//
//   (1) numSort + NaN: parseFloat of a non-numeric cell yields NaN, and
//       simpleSort(NaN, anything) === 0 (NaN is neither < nor >). So NaN is
//       "equal" to every number while distinct numbers are not equal to each
//       other — the equivalence relation is NON-TRANSITIVE. A number column
//       containing junk text gets V8-dependent ordering.
//   (2) option-multi SHADOWING in normalizedSortForType: the type "option-multi"
//       is claimed by FOUR sortFnTypes keys; the resolver returns the FIRST by
//       insertion order, so optionMultiCount / reverseOptionMultiCount are
//       UNREACHABLE through normalizedSortForType.
//
// Everything here is pure / offline — no vault, no DOM, no I/O.
// ---------------------------------------------------------------------------

// --- tiny deterministic PRNG (no external dep) -----------------------------
// mulberry32: fast, well-distributed, fully deterministic 32-bit generator so
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

// Normalize any comparator result to exactly {-1, 0, 1}. Reverse comparators
// emit -0 (from `result * -1`), and `-0` !== `0` under Jest's Object.is-based
// toBe; the `|| 0` collapses -0 -> +0 so the law assertions are clean.
const sign = (n: number) => (n < 0 ? -1 : n > 0 ? 1 : 0) || 0;
// Negate a normalized sign, collapsing -0 back to +0.
const inv = (s: number) => -s || 0;

// Verify the strict-weak-ordering triad over a sample domain. `fieldDef` is
// threaded through so option comparators see their option order.
const assertSortLawTriad = (
  name: string,
  fn: SortFunction,
  domain: any[],
  fieldDef?: SpaceProperty,
  seed = 0xc0ffee
) => {
  // reflexive: cmp(x, x) === 0 for every value in the domain
  for (const x of domain) {
    expect(sign(fn(x, x, fieldDef))).toBe(0);
  }
  // antisymmetric: sign(cmp(a,b)) === -sign(cmp(b,a))
  for (const a of domain) {
    for (const b of domain) {
      expect(sign(fn(a, b, fieldDef))).toBe(inv(sign(fn(b, a, fieldDef))));
    }
  }
  // transitive (ordering) + transitive equivalence, brute-forced over triples
  for (const a of domain) {
    for (const b of domain) {
      for (const c of domain) {
        const ab = sign(fn(a, b, fieldDef));
        const bc = sign(fn(b, c, fieldDef));
        const ac = sign(fn(a, c, fieldDef));
        if (ab <= 0 && bc <= 0) {
          expect(ac).toBeLessThanOrEqual(0);
        }
        if (ab >= 0 && bc >= 0) {
          expect(ac).toBeGreaterThanOrEqual(0);
        }
      }
    }
  }
  // randomized stress over the same domain (catches order-dependent surprises)
  const rng = makeRng(seed);
  for (let i = 0; i < PROPERTY_RUNS; i++) {
    const a = pick(rng, domain);
    const b = pick(rng, domain);
    const c = pick(rng, domain);
    expect(sign(fn(a, b, fieldDef))).toBe(inv(sign(fn(b, a, fieldDef))));
    const ab = sign(fn(a, b, fieldDef));
    const bc = sign(fn(b, c, fieldDef));
    const ac = sign(fn(a, c, fieldDef));
    if (ab <= 0 && bc <= 0) expect(ac).toBeLessThanOrEqual(0);
    if (ab >= 0 && bc >= 0) expect(ac).toBeGreaterThanOrEqual(0);
  }
  // `name` kept for failure-message readability when expect throws.
  void name;
};

// A reusable option fieldDef: high > med > low ordering.
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

// =========================================================================
// SORT-LAW TRIAD — the headline check (per-type, asc + desc)
// =========================================================================
describe("sort-law triad (reflexive · antisymmetric · transitive)", () => {
  it("alphabetical (text, asc) is a strict weak ordering", () => {
    assertSortLawTriad("alphabetical", sortFnTypes.alphabetical.fn, [
      "apple",
      "Apple",
      "banana",
      "a10",
      "a9",
      "a2",
      "",
      null,
      undefined,
      "zebra",
    ]);
  });

  it("reverseAlphabetical (text, desc) is a strict weak ordering (inversion preserves the law)", () => {
    assertSortLawTriad("reverseAlphabetical", sortFnTypes.reverseAlphabetical.fn, [
      "apple",
      "banana",
      "a10",
      "a9",
      "",
      null,
      "zebra",
    ]);
  });

  it("earliest/latest (date — delegates to stringSort) is a strict weak ordering", () => {
    const dates = [
      "2024-01-01",
      "2024-12-31",
      "2023-06-15",
      "2024-01-02",
      "",
      null,
    ];
    assertSortLawTriad("earliest", sortFnTypes.earliest.fn, dates);
    assertSortLawTriad("latest", sortFnTypes.latest.fn, dates);
  });

  it("boolean (asc + desc) is a strict weak ordering", () => {
    const bools = ["true", "false", "yes", "", null, undefined, "TRUE"];
    assertSortLawTriad("boolean", sortFnTypes.boolean.fn, bools);
    assertSortLawTriad("booleanReverse", sortFnTypes.booleanReverse.fn, bools);
  });

  it("linkAlphabetical (asc + desc) is a strict weak ordering", () => {
    const links = [
      "space/folder/note",
      "other/note",
      "note",
      "space/folder/aaa",
      "",
      null,
    ];
    assertSortLawTriad("linkAlphabetical", sortFnTypes.linkAlphabetical.fn, links);
    assertSortLawTriad(
      "linkReverseAlphabetical",
      sortFnTypes.linkReverseAlphabetical.fn,
      links
    );
  });

  it("count / reverseCount (multi cardinality) is a strict weak ordering", () => {
    const multis = ['["a","b","c"]', '["a"]', "x,y", "x", "", null, "a,b,c,d"];
    assertSortLawTriad("count", sortFnTypes.count.fn, multis);
    assertSortLawTriad("reverseCount", sortFnTypes.reverseCount.fn, multis);
  });

  it("optionOrder / reverseOptionOrder (with fieldDef) is a strict weak ordering", () => {
    const opts = ["high", "med", "low", "unknown", "another", "", null];
    assertSortLawTriad(
      "optionOrder",
      sortFnTypes.optionOrder.fn,
      opts,
      optionFieldDef
    );
    assertSortLawTriad(
      "reverseOptionOrder",
      sortFnTypes.reverseOptionOrder.fn,
      opts,
      optionFieldDef
    );
  });

  it("optionOrder WITHOUT fieldDef (string fallback) is a strict weak ordering", () => {
    assertSortLawTriad("optionOrder-fallback", sortFnTypes.optionOrder.fn, [
      "high",
      "med",
      "low",
      "",
      null,
    ]);
  });

  it("optionMultiOrder / reverse (first-value option order) is a strict weak ordering", () => {
    const opts = ["high,low", "med", "low,high", "unknown", "", null, "high"];
    assertSortLawTriad(
      "optionMultiOrder",
      sortFnTypes.optionMultiOrder.fn,
      opts,
      optionMultiFieldDef
    );
    assertSortLawTriad(
      "reverseOptionMultiOrder",
      sortFnTypes.reverseOptionMultiOrder.fn,
      opts,
      optionMultiFieldDef
    );
  });

  it("number (asc + desc) is a strict weak ordering over WELL-FORMED numerics", () => {
    const nums = ["1", "2", "10", "-5", "0", "3.14", "100"];
    assertSortLawTriad("number", sortFnTypes.number.fn, nums);
    assertSortLawTriad("reverseNumber", sortFnTypes.reverseNumber.fn, nums);
  });

  it("number (asc + desc) is a strict weak ordering over MIXED numeric + junk (NaN fixed — Notidian-5ym)", () => {
    // The previous numSort treated NaN as equal to every number, breaking
    // transitivity (the e8e/ADR-0025 bug class). After the fix NaN is pushed to
    // one end (NaN sorts AFTER every real number, NaN===NaN), so the full
    // strict-weak-ordering triad now holds even with junk/empty cells mixed in.
    const mixed = [
      "1",
      "2",
      "10",
      "-5",
      "0",
      "3.14",
      "100",
      "abc", // NaN
      "", // NaN
      "  ", // NaN
      null, // NaN
      undefined, // NaN
      "3px", // parseFloat -> 3 (real)
      "NaN", // literally NaN
    ];
    assertSortLawTriad("number+junk", sortFnTypes.number.fn, mixed);
    assertSortLawTriad("reverseNumber+junk", sortFnTypes.reverseNumber.fn, mixed);
  });
});

// =========================================================================
// FIXED law violations (Notidian-5ym — the e8e bug class, now corrected)
// =========================================================================
// These two were LOCKED as characterization by Notidian-3wa and FLIPPED here to
// the corrected behavior. The strict-weak-ordering property runs above (the
// "number + junk" triad) are the real regression guard; these spot-checks pin
// the exact intended ordering decisions.
describe("FIXED: numSort NaN ordering is a strict weak ordering (Notidian-5ym)", () => {
  const fn = sortFnTypes.number.fn;

  it("NaN (non-numeric / empty cell) compares equal to itself, not to real numbers", () => {
    expect(fn("abc", "def")).toBe(0); // NaN == NaN  (reflexive equivalence)
    expect(fn("", "  ")).toBe(0); // both parse to NaN
    expect(fn(null as any, undefined as any)).toBe(0); // both NaN
  });

  it("pushes NaN to the END: a real number sorts BEFORE any NaN (mirrors stringSort null discipline)", () => {
    expect(fn("5", "abc")).toBe(-1); // 5 before NaN
    expect(fn("abc", "5")).toBe(1); // NaN after 5
    expect(fn("0", "")).toBe(-1); // 0 before NaN(empty)
    expect(fn("-9999", "xyz")).toBe(-1); // even very small reals beat NaN
  });

  it("is TRANSITIVE across the boundary that previously broke it (1 < 2, NaN to the end)", () => {
    // Previously: cmp(1,NaN)==0 && cmp(NaN,2)==0 but cmp(1,2)==-1 (non-transitive).
    // Now NaN is strictly after both, so the relation is consistent.
    const a = "1",
      b = "abc" /* NaN */,
      c = "2";
    expect(fn(a, c)).toBe(-1); // 1 < 2
    expect(fn(a, b)).toBe(-1); // 1 < NaN
    expect(fn(c, b)).toBe(-1); // 2 < NaN
    // sign(cmp(a,b)) <= 0 && sign(cmp(c,b)) <= 0 with cmp(a,c) <= 0 — consistent.
  });

  it("reverseNumber inverts cleanly and remains a strict weak ordering", () => {
    const rev = sortFnTypes.reverseNumber.fn;
    expect(rev("abc", "1")).toBe(-1); // NaN-after under asc becomes NaN-first under desc: -(1) = -1
    expect(rev("1", "abc")).toBe(1); // mirror
    expect(rev("1", "2")).toBe(1); // 2 before 1 under desc
    expect(rev("abc", "def")).toBe(-0); // NaN==NaN -> -(0) artifact
    expect(rev("abc", "def") === 0).toBe(true);
  });
});

describe("FIXED: normalizedSortForType disambiguates option-multi order vs count (Notidian-5ym)", () => {
  it("defaults (no subKey) to the ORDER variant — preserves every existing caller", () => {
    expect(normalizedSortForType("option-multi", false)).toBe("optionMultiOrder");
    expect(normalizedSortForType("option-multi", true)).toBe(
      "reverseOptionMultiOrder"
    );
  });

  it("subKey 'count' now REACHES the previously-shadowed count variants", () => {
    expect(normalizedSortForType("option-multi", true, "count")).toBe(
      "optionMultiCount"
    );
    expect(normalizedSortForType("option-multi", false, "count")).toBe(
      "reverseOptionMultiCount"
    );
  });

  it("subKey 'order' explicitly selects the order variants too", () => {
    expect(normalizedSortForType("option-multi", false, "order")).toBe(
      "optionMultiOrder"
    );
    expect(normalizedSortForType("option-multi", true, "order")).toBe(
      "reverseOptionMultiOrder"
    );
  });

  it("an unknown subKey falls back to the default (no-subKey) entry rather than returning nothing", () => {
    expect(normalizedSortForType("option-multi", false, "bogus")).toBe(
      "optionMultiOrder"
    );
    expect(normalizedSortForType("option-multi", true, "bogus")).toBe(
      "reverseOptionMultiOrder"
    );
  });

  it("subKey is ignored for types whose entries never set one (e.g. number)", () => {
    expect(normalizedSortForType("number", false, "count")).toBe("number");
    expect(normalizedSortForType("number", true, "anything")).toBe("reverseNumber");
  });

  it("no user-facing sort option was deleted — all four option-multi entries still claim the type", () => {
    expect(sortFnTypes.optionMultiOrder.type).toContain("option-multi");
    expect(sortFnTypes.reverseOptionMultiOrder.type).toContain("option-multi");
    expect(sortFnTypes.optionMultiCount.type).toContain("option-multi");
    expect(sortFnTypes.reverseOptionMultiCount.type).toContain("option-multi");
  });

  it("the count variants remain directly dispatchable by key through sortReturnForCol (FilterBar path)", () => {
    // FilterBar surfaces all four via predicateFnsForType and stores the chosen
    // key in Sort.fn; sortReturnForCol dispatches by key. Confirm a count key
    // actually measures cardinality on an option-multi column.
    const optMultiCol: SpaceTableColumn = {
      name: "tags",
      type: "option-multi",
      value: optionMultiFieldDef.value,
    };
    expect(
      sortReturnForCol(
        optMultiCol,
        { field: "tags", fn: "optionMultiCount" },
        { tags: "high,med,low" },
        { tags: "high" }
      )
    ).toBe(1); // 3 items > 1 item
  });
});

// =========================================================================
// stringSort — null/empty ordering + localeCompare semantics
// =========================================================================
describe("stringSort (via alphabetical.fn) null / empty / numeric-collation", () => {
  const fn = sortFnTypes.alphabetical.fn;

  it("treats both-null as equal", () => {
    expect(fn(null as any, null as any)).toBe(0);
    expect(fn(undefined as any, undefined as any)).toBe(0);
    expect(fn(null as any, undefined as any)).toBe(0); // == null catches both
  });

  it("sorts null/undefined AFTER any real string (null returns +1)", () => {
    expect(fn(null as any, "a")).toBe(1);
    expect(fn("a", null as any)).toBe(-1);
    expect(fn(undefined as any, "")).toBe(1);
  });

  it("uses numeric collation: 'a9' before 'a10'", () => {
    expect(fn("a9", "a10")).toBe(-1);
    expect(fn("a10", "a9")).toBe(1);
  });

  it("uses base sensitivity: 'A' and 'a' collate equal", () => {
    expect(fn("A", "a")).toBe(0);
    expect(fn("café", "cafe")).toBe(0); // base sensitivity ignores accents
  });

  it("treats empty string as a real (non-null) value distinct from null", () => {
    // '' is not null, so it participates in localeCompare and sorts before 'a'…
    expect(fn("", "a")).toBe(-1);
    // …but a real null still sorts after the empty string.
    expect(fn("", null as any)).toBe(-1);
    expect(fn(null as any, "")).toBe(1);
  });
});

// =========================================================================
// numSort — NaN / numeric parsing edges
// =========================================================================
describe("numSort (via number.fn) parsing edges", () => {
  const fn = sortFnTypes.number.fn;
  it("orders by numeric value, not lexical", () => {
    expect(fn("10", "9")).toBe(1); // 10 > 9 numerically
    expect(fn("2", "10")).toBe(-1);
  });
  it("parses leading numeric prefix (parseFloat semantics)", () => {
    expect(fn("3px", "5px")).toBe(-1); // parseFloat -> 3 < 5
    expect(fn("12abc", "12xyz")).toBe(0); // both parse to 12
  });
  it("handles negatives and decimals", () => {
    expect(fn("-5", "0")).toBe(-1);
    expect(fn("3.14", "3.2")).toBe(-1);
  });
  it("treats null/empty as NaN and pushes it to the END (Notidian-5ym fix)", () => {
    expect(fn(null as any, null as any)).toBe(0); // both NaN -> equal
    expect(fn("", "5")).toBe(1); // '' is NaN -> sorts AFTER the real 5
    expect(fn("5", "")).toBe(-1); // mirror: real 5 before NaN
  });
});

// =========================================================================
// boolSort — equivalence classes (truthy "true" vs everything else)
// =========================================================================
describe("boolSort (via boolean.fn) equivalence semantics", () => {
  const fn = sortFnTypes.boolean.fn;
  it("'true' sorts after non-'true' (1 vs 0)", () => {
    expect(fn("true", "false")).toBe(1);
    expect(fn("false", "true")).toBe(-1);
  });
  it("ONLY the literal string 'true' counts as truthy", () => {
    expect(fn("yes", "true")).toBe(-1); // 'yes' -> 0, 'true' -> 1
    expect(fn("1", "true")).toBe(-1);
    expect(fn("TRUE", "true")).toBe(-1); // case-sensitive
  });
  it("collapses all non-'true' values into one equal class", () => {
    expect(fn("false", "")).toBe(0);
    expect(fn(null as any, "anything")).toBe(0);
    expect(fn("no", "0")).toBe(0);
  });
  it("booleanReverse inverts and yields -0 for equal inputs (still == 0)", () => {
    const rev = sortFnTypes.booleanReverse.fn;
    // The `result * -1` inversion turns 0 into -0. Under Object.is (Jest toBe)
    // -0 !== 0, so we pin BOTH facts: it is the artifact -0, yet == 0 in the
    // SameValueZero sense Array.prototype.sort actually uses.
    expect(Object.is(rev("true", "true"), -0)).toBe(true); // the inversion artifact, pinned
    expect(rev("true", "true") === 0).toBe(true); // -0 === 0 is true
    expect(rev("true", "false")).toBe(-1);
    expect(rev("false", "true")).toBe(1);
  });
});

// =========================================================================
// countSort — multi cardinality (JSON array vs comma display string)
// =========================================================================
describe("countSort (via count.fn) cardinality", () => {
  const fn = sortFnTypes.count.fn;
  it("counts JSON-array form", () => {
    expect(fn('["a","b","c"]', '["a"]')).toBe(1);
    expect(fn('["a"]', '["a","b"]')).toBe(-1);
  });
  it("counts comma-display form", () => {
    expect(fn("a,b,c", "a")).toBe(1);
    expect(fn("a", "a,b")).toBe(-1);
  });
  it("treats null/empty as zero count", () => {
    expect(fn(null as any, null as any)).toBe(0);
    expect(fn("", "")).toBe(0);
    expect(fn("a", "")).toBe(1);
  });
});

// =========================================================================
// linkSort — basename extraction
// =========================================================================
describe("linkSort (via linkAlphabetical.fn) basename comparison", () => {
  const fn = sortFnTypes.linkAlphabetical.fn;
  it("compares by trailing path segment, not full path", () => {
    // 'space/folder/aaa' -> 'aaa', 'z/zzz' -> 'zzz' : aaa < zzz
    expect(fn("space/folder/aaa", "z/zzz")).toBe(-1);
    // deep path with small basename beats shallow path with large basename
    expect(fn("z/y/x/apple", "banana")).toBe(-1);
  });
  it("null sorts after real links", () => {
    expect(fn(null as any, "a")).toBe(1);
    expect(fn("a", null as any)).toBe(-1);
    expect(fn(null as any, null as any)).toBe(0);
  });
});

// =========================================================================
// optionSort / optionMultiSort — defined-order resolution
// =========================================================================
describe("optionSort (via optionOrder.fn) defined-order resolution", () => {
  const fn = sortFnTypes.optionOrder.fn;
  it("orders by the options[] index when both values are known", () => {
    expect(fn("high", "low", optionFieldDef)).toBe(-1); // high before low
    expect(fn("low", "high", optionFieldDef)).toBe(1);
    expect(fn("med", "med", optionFieldDef)).toBe(0); // reflexive
  });
  it("known option sorts before an unknown one", () => {
    expect(fn("high", "ZZZ", optionFieldDef)).toBe(-1);
    expect(fn("ZZZ", "high", optionFieldDef)).toBe(1);
  });
  it("falls back to stringSort for two unknown values", () => {
    expect(fn("aaa", "bbb", optionFieldDef)).toBe(-1);
    expect(fn("bbb", "aaa", optionFieldDef)).toBe(1);
  });
  it("falls back to stringSort when fieldDef is absent", () => {
    expect(fn("b", "a")).toBe(1); // pure alphabetical
  });
  it("falls back to stringSort when fieldDef.type is not an option type", () => {
    const wrongType: SpaceProperty = {
      name: "x",
      type: "text",
      value: JSON.stringify({ options: [{ value: "high" }, { value: "low" }] }),
    };
    // option order ignored -> alphabetical: 'high' < 'low'
    expect(fn("low", "high", wrongType)).toBe(1);
  });
  it("falls back to stringSort on malformed / empty options JSON", () => {
    const badJson: SpaceProperty = { name: "x", type: "option", value: "{not json" };
    const emptyOpts: SpaceProperty = {
      name: "x",
      type: "option",
      value: JSON.stringify({ options: [] }),
    };
    expect(fn("b", "a", badJson)).toBe(1);
    expect(fn("b", "a", emptyOpts)).toBe(1);
  });
});

describe("optionMultiSort (via optionMultiOrder.fn) first-value ordering", () => {
  const fn = sortFnTypes.optionMultiOrder.fn;
  it("orders by the FIRST option value of each multi cell", () => {
    expect(fn("high,low", "low,high", optionMultiFieldDef)).toBe(-1); // high vs low
    expect(fn("low,high", "high,low", optionMultiFieldDef)).toBe(1);
  });
  it("treats empty multi cells via empty-string first value", () => {
    expect(fn("", "", optionMultiFieldDef)).toBe(0);
    expect(fn(null as any, null as any, optionMultiFieldDef)).toBe(0);
  });
});

// =========================================================================
// normalizedSortForType — type -> (fn key) + desc mapping
// =========================================================================
describe("normalizedSortForType type+desc resolution", () => {
  it("maps text asc/desc to alphabetical / reverseAlphabetical", () => {
    expect(normalizedSortForType("text", false)).toBe("alphabetical");
    expect(normalizedSortForType("text", true)).toBe("reverseAlphabetical");
  });
  it("maps number asc/desc", () => {
    expect(normalizedSortForType("number", false)).toBe("number");
    expect(normalizedSortForType("number", true)).toBe("reverseNumber");
  });
  it("maps date asc/desc to earliest / latest", () => {
    expect(normalizedSortForType("date", false)).toBe("earliest");
    expect(normalizedSortForType("date", true)).toBe("latest");
  });
  it("maps boolean asc/desc", () => {
    expect(normalizedSortForType("boolean", false)).toBe("boolean");
    expect(normalizedSortForType("boolean", true)).toBe("booleanReverse");
  });
  it("maps option asc/desc", () => {
    expect(normalizedSortForType("option", false)).toBe("optionOrder");
    expect(normalizedSortForType("option", true)).toBe("reverseOptionOrder");
  });
  it("maps multi-claimed link family (link/context/file/image) to the link fns", () => {
    for (const t of ["link", "context", "file", "image"]) {
      expect(normalizedSortForType(t, false)).toBe("linkAlphabetical");
      expect(normalizedSortForType(t, true)).toBe("linkReverseAlphabetical");
    }
  });
  it("maps count family — note the INVERTED desc flags (count.desc===true)", () => {
    // count's desc=true / reverseCount's desc=false (the labels are swapped vs
    // the asc/desc convention) — locked as-is.
    for (const t of ["context-multi", "link-multi", "tags-multi"]) {
      expect(normalizedSortForType(t, true)).toBe("count");
      expect(normalizedSortForType(t, false)).toBe("reverseCount");
    }
  });
  it("returns undefined for an unknown type", () => {
    expect(normalizedSortForType("bogus", false)).toBeUndefined();
    expect(normalizedSortForType("", true)).toBeUndefined();
  });
});

// =========================================================================
// sortReturnForCol — field / fieldDef resolution + flex handling
// =========================================================================
describe("sortReturnForCol field & column resolution", () => {
  const numCol: SpaceTableColumn = { name: "age", type: "number" };
  const textCol: SpaceTableColumn = { name: "title", type: "text" };
  const optCol: SpaceTableColumn = {
    name: "priority",
    type: "option",
    value: optionFieldDef.value,
  };
  const flexCol: SpaceTableColumn = { name: "tags", type: "flex" };

  it("returns 0 when the column is missing/falsy", () => {
    expect(
      sortReturnForCol(
        null as any,
        { field: "age", fn: "number" },
        { age: "1" },
        { age: "2" }
      )
    ).toBe(0);
  });

  it("returns 0 when the sort fn key is unknown", () => {
    expect(
      sortReturnForCol(
        numCol,
        { field: "age", fn: "no-such-fn" },
        { age: "1" },
        { age: "2" }
      )
    ).toBe(0);
  });

  it("reads the configured field from each row and delegates to the fn", () => {
    expect(
      sortReturnForCol(
        numCol,
        { field: "age", fn: "number" },
        { age: "1" },
        { age: "2" }
      )
    ).toBe(-1);
    expect(
      sortReturnForCol(
        textCol,
        { field: "title", fn: "alphabetical" },
        { title: "b" },
        { title: "a" }
      )
    ).toBe(1);
  });

  it("treats a missing field as null on both sides (=> equal for text)", () => {
    // row[sort.field] is undefined -> stringSort sees null both sides -> 0
    expect(
      sortReturnForCol(
        textCol,
        { field: "ghost", fn: "alphabetical" },
        { title: "x" },
        { title: "y" }
      )
    ).toBe(0);
  });

  it("passes the column itself as the fieldDef for option resolution", () => {
    expect(
      sortReturnForCol(
        optCol,
        { field: "priority", fn: "optionOrder" },
        { priority: "high" },
        { priority: "low" }
      )
    ).toBe(-1);
  });

  it("parses flex columns via the raw multi-string for the COUNT family before comparing", () => {
    // count is multi:true -> the flex cell is fed RAW so countSort measures
    // parseMultiString(...).length. 'a,b' (2) vs 'a' (1) -> 2 > 1 -> 1.
    expect(
      sortReturnForCol(
        flexCol,
        { field: "tags", fn: "count" },
        { tags: "a,b" },
        { tags: "a" }
      )
    ).toBe(1);
  });

  // ---- av6s: flex string/number families compare a SCALAR key, not the array --
  it("compares a flex JSON-wrapped string cell by its scalar .value (alphabetical)", () => {
    // {value:'a'} vs {value:'b'} -> stringSort('a','b') -> -1 (no array throw).
    expect(
      sortReturnForCol(
        flexCol,
        { field: "tags", fn: "alphabetical" },
        { tags: JSON.stringify({ value: "a", type: "text" }) },
        { tags: JSON.stringify({ value: "b", type: "text" }) }
      )
    ).toBe(-1);
    // Reverse direction flips the sign.
    expect(
      sortReturnForCol(
        flexCol,
        { field: "tags", fn: "reverseAlphabetical" },
        { tags: JSON.stringify({ value: "a", type: "text" }) },
        { tags: JSON.stringify({ value: "b", type: "text" }) }
      )
    ).toBe(1);
  });

  it("compares a flex JSON-wrapped number cell by its scalar .value (number)", () => {
    // numeric scalar: 2 vs 10 -> numSort(2,10) -> -1 (NOT lexical, NOT array).
    expect(
      sortReturnForCol(
        flexCol,
        { field: "tags", fn: "number" },
        { tags: JSON.stringify({ value: "2", type: "number" }) },
        { tags: JSON.stringify({ value: "10", type: "number" }) }
      )
    ).toBe(-1);
  });

  it("falls back to the first multi-string element for a bare (non-JSON) flex string cell", () => {
    // sort.test feeds the count path a bare 'a,b'; the string family must also
    // tolerate it -> flexSortKey('a,b') -> 'a'. 'a' vs 'b' -> -1.
    expect(
      sortReturnForCol(
        flexCol,
        { field: "tags", fn: "alphabetical" },
        { tags: "a" },
        { tags: "b" }
      )
    ).toBe(-1);
  });

  it("treats a missing flex field as empty (no throw, equal for alphabetical)", () => {
    // row[field] undefined -> parseFlexValue(undefined).value == null ->
    // parseMultiString(undefined)[0] ?? '' -> '' on both sides -> stringSort
    // sees '' == '' -> 0. Critically: it does NOT throw.
    let result: any = NaN;
    expect(() => {
      result = sortReturnForCol(
        flexCol,
        { field: "ghost", fn: "alphabetical" },
        { tags: "x" },
        { tags: "y" }
      );
    }).not.toThrow();
    expect(result).toBe(0);
  });

  it("is antisymmetric end-to-end (swapping rows flips the sign)", () => {
    const r1 = { age: "5" };
    const r2 = { age: "8" };
    const sortDef = { field: "age", fn: "number" };
    const ab = sortReturnForCol(numCol, sortDef, r1, r2);
    const ba = sortReturnForCol(numCol, sortDef, r2, r1);
    expect(sign(ab as number)).toBe(inv(sign(ba as number)));
  });
});

// =========================================================================
// sortFnTypes table integrity — every entry is well-formed
// =========================================================================
describe("sortFnTypes table integrity", () => {
  it("every entry has a non-empty type[], a fn, a label, and a boolean desc", () => {
    for (const [key, entry] of Object.entries(sortFnTypes)) {
      expect(Array.isArray(entry.type)).toBe(true);
      expect(entry.type.length).toBeGreaterThan(0);
      expect(typeof entry.fn).toBe("function");
      expect(typeof entry.label).toBe("string");
      expect(typeof entry.desc).toBe("boolean");
      void key;
    }
  });

  it("every fn returns a value in {-1, 0, 1} for arbitrary inputs", () => {
    const rng = makeRng(0x5eed);
    const samples = [
      "a",
      "b",
      "10",
      "2",
      "true",
      "false",
      "x,y,z",
      "",
      null,
      undefined,
      "high",
      "space/note",
    ];
    for (const entry of Object.values(sortFnTypes)) {
      for (let i = 0; i < 60; i++) {
        const a = pick(rng, samples);
        const b = pick(rng, samples);
        const r = entry.fn(a, b, optionFieldDef);
        expect([-1, 0, 1]).toContain(r === 0 ? 0 : r); // normalize -0 -> 0
      }
    }
  });
});

// =========================================================================
// flexSortKey — scalar flex-cell key for string/number sort families (av6s)
// Exported so the TanStack adapter path (Notidian-xy0s) can reuse it.
// =========================================================================
describe("flexSortKey", () => {
  it("unwraps a JSON-wrapped flex cell to its scalar .value", () => {
    expect(flexSortKey(JSON.stringify({ value: "hello", type: "text" }))).toBe(
      "hello"
    );
    expect(flexSortKey(JSON.stringify({ value: "42", type: "number" }))).toBe(
      "42"
    );
  });

  it("falls back to the first element of a bare multi-string", () => {
    expect(flexSortKey("a,b,c")).toBe("a");
    expect(flexSortKey("solo")).toBe("solo");
  });

  it("returns '' for empty / missing / value-less input (never throws)", () => {
    expect(flexSortKey("")).toBe("");
    expect(flexSortKey(undefined as unknown as string)).toBe("");
    // A JSON object with no `.value` -> parseFlexValue.value is undefined ->
    // multi-string fallback on the raw '{}' -> first element of parseMultiString.
    expect(typeof flexSortKey("{}")).toBe("string");
  });

  it("never returns a non-string (so stringSort/numSort never see an array)", () => {
    const inputs = [
      JSON.stringify({ value: "x" }),
      "a,b",
      "",
      "plain",
      JSON.stringify({ value: "5", type: "number" }),
    ];
    for (const i of inputs) {
      expect(typeof flexSortKey(i)).toBe("string");
    }
  });
});
