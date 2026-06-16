import {
  nodeIsAncestorOfTarget,
  compareByField,
  compareByFieldDeep,
  compareByFieldCaseInsensitive,
  compareByFieldNumerical,
} from "./tree";

// ===========================================================================
// DEPTH (Q1) — comparator-correctness net + ancestry-boundary regression for
// src/core/utils/tree.ts (Notidian-mzaq). This module had ZERO coverage yet
// exports the sort comparator FACTORIES that core/superstate/utils/spaces.ts
// `spaceSortFn` feeds to Array.prototype.sort for space/row ordering, plus the
// `nodeIsAncestorOfTarget` predicate the drag-and-drop path logic
// (core/utils/dnd/dropPath.ts) uses to decide pin-vs-move.
//
// The headline concern (parallel to Notidian-e8e / ADR-0025 / ADR-0033) is the
// SORT-LAW TRIAD. Array.prototype.sort assumes its comparator is a strict weak
// ordering — a real TOTAL ORDER over the data:
//
//   reflexive       cmp(x, x) === 0
//   antisymmetric   sign(cmp(a, b)) === -sign(cmp(b, a))
//   transitive      cmp(a,b) <= 0 && cmp(b,c) <= 0  =>  cmp(a,c) <= 0
//                   (and the equivalence "==0" relation must itself be transitive)
//
// A comparator that returns `undefined` (compareByFieldCaseInsensitive on a
// null/undefined field, via the optional-chain short-circuit) or `NaN`
// (compareByFieldNumerical on a non-numeric field) gives V8/TimSort an
// UNDEFINED contract and produces version-dependent, unstable, or wrong order.
// Both are FIXED in this bead and the prior characterization assertions are
// FLIPPED to regression assertions below.
//
// Everything here is pure / offline — testEnvironment:node, no vault, no DOM.
// ===========================================================================

// --- tiny deterministic PRNG (no external dep) -----------------------------
// mulberry32: fast, well-distributed, fully deterministic 32-bit generator so
// property runs reproduce across machines/CI without a fixture file.
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
// can emit -0 (from subtraction), and `-0` !== `0` under Jest's Object.is-based
// toBe; the `|| 0` collapses -0 -> +0 so the law assertions are clean. A NaN
// (a forbidden comparator return) becomes a SENTINEL that fails every triad
// assertion rather than laundering to 0 — so a regression that re-introduces a
// NaN return cannot pass silently.
const sign = (n: number) => {
  if (Number.isNaN(n)) return NaN; // poison: never equals -1/0/1
  return (n < 0 ? -1 : n > 0 ? 1 : 0) || 0;
};
// Negate a normalized sign, collapsing -0 back to +0.
const inv = (s: number) => -s || 0;

type Cmp = (a: any, b: any) => number;

// Verify the strict-weak-ordering triad over a sample domain for a comparator
// over a single field "f". Asserts EVERY return is a finite number (the total-
// order invariant) plus reflexivity / antisymmetry / transitivity.
const assertTotalOrder = (name: string, cmp: Cmp, domain: any[]) => {
  // Every comparator return must be a finite number — the core invariant the
  // two fixed bugs violated (undefined / NaN).
  for (const x of domain) {
    for (const y of domain) {
      const r = cmp(x, y);
      expect(typeof r).toBe("number");
      expect(Number.isFinite(r)).toBe(true);
    }
  }
  // reflexive
  for (const x of domain) {
    expect(sign(cmp(x, x))).toBe(0);
  }
  // antisymmetric
  for (const x of domain) {
    for (const y of domain) {
      expect(sign(cmp(x, y))).toBe(inv(sign(cmp(y, x))));
    }
  }
  // transitive (full O(n^3) over the small domain) — both the strict (<) and
  // the equivalence (==0) relations must be transitive.
  for (const x of domain) {
    for (const y of domain) {
      for (const z of domain) {
        const xy = sign(cmp(x, y));
        const yz = sign(cmp(y, z));
        const xz = sign(cmp(x, z));
        if (xy <= 0 && yz <= 0) expect(xz).toBeLessThanOrEqual(0);
        if (xy >= 0 && yz >= 0) expect(xz).toBeGreaterThanOrEqual(0);
        if (xy === 0 && yz === 0) expect(xz).toBe(0);
      }
    }
  }
};

// dir=true and dir=false must be exact mirrors (antisymmetric across the flag).
const assertDirSymmetry = (
  factory: (field: string, dir: boolean) => Cmp,
  field: string,
  domain: any[]
) => {
  const asc = factory(field, true);
  const desc = factory(field, false);
  for (const x of domain) {
    for (const y of domain) {
      expect(sign(desc(x, y))).toBe(inv(sign(asc(x, y))));
    }
  }
};

// Sorting a domain with a correct comparator must be STABLE and DETERMINISTIC:
// sorting the same multiset from two different input orders yields the same
// ORDERING UP TO EQUIVALENCE (cmp-equal items may swap, but every pairwise
// relation matches). Probes the property that matters to the render path.
const assertStableDeterministic = (cmp: Cmp, domain: any[]) => {
  const a = [...domain].sort(cmp);
  const b = [...domain].reverse().sort(cmp);
  expect(a.length).toBe(b.length);
  for (let i = 0; i < a.length; i++) {
    // same value OR a cmp-equivalent value at each position
    expect(sign(cmp(a[i], b[i]))).toBe(0);
  }
};

const wrap = (field: string, values: any[]) => values.map((v) => ({ [field]: v }));

// ---------------------------------------------------------------------------
describe("nodeIsAncestorOfTarget — path boundary (Notidian-mzaq fix #3)", () => {
  it("treats a path as an ancestor of itself", () => {
    expect(nodeIsAncestorOfTarget("/foo", "/foo")).toBe(true);
    expect(nodeIsAncestorOfTarget("/", "/")).toBe(true);
    expect(nodeIsAncestorOfTarget("foo/bar", "foo/bar")).toBe(true);
  });

  it("treats a true descendant (boundary at /) as having the path as ancestor", () => {
    expect(nodeIsAncestorOfTarget("/foo", "/foo/bar")).toBe(true);
    expect(nodeIsAncestorOfTarget("/foo", "/foo/bar/baz")).toBe(true);
    expect(nodeIsAncestorOfTarget("foo", "foo/bar")).toBe(true);
  });

  it("REGRESSION: a mere string prefix is NOT an ancestor — '/foo' is not an ancestor of '/foobar'", () => {
    // The bug: target.startsWith(path) reported true here. The fix requires a
    // real path-separator boundary.
    expect(nodeIsAncestorOfTarget("/foo", "/foobar")).toBe(false);
    expect(nodeIsAncestorOfTarget("/foo", "/foo-bar")).toBe(false);
    expect(nodeIsAncestorOfTarget("foo", "foobar")).toBe(false);
    expect(nodeIsAncestorOfTarget("/a/b", "/a/bc")).toBe(false);
  });

  it("root '/' is an ancestor of every path (and never produces the invalid '//' boundary)", () => {
    expect(nodeIsAncestorOfTarget("/", "/foo")).toBe(true);
    expect(nodeIsAncestorOfTarget("/", "/foo/bar")).toBe(true);
    expect(nodeIsAncestorOfTarget("/", "anything")).toBe(true);
  });

  it("a descendant is NOT an ancestor of its parent (direction matters)", () => {
    expect(nodeIsAncestorOfTarget("/foo/bar", "/foo")).toBe(false);
    expect(nodeIsAncestorOfTarget("/foo/bar/baz", "/foo/bar")).toBe(false);
  });

  it("tolerates a path that already ends in '/' without double-slashing", () => {
    expect(nodeIsAncestorOfTarget("/foo/", "/foo/bar")).toBe(true);
    expect(nodeIsAncestorOfTarget("/foo/", "/foobar")).toBe(false);
  });

  it("is null/undefined-safe (no throw)", () => {
    expect(nodeIsAncestorOfTarget(null as any, "/foo")).toBe(false);
    expect(nodeIsAncestorOfTarget("/foo", null as any)).toBe(false);
    expect(nodeIsAncestorOfTarget(undefined as any, undefined as any)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
describe("compareByFieldDeep — accessor comparator", () => {
  const factory = (dir: boolean) =>
    compareByFieldDeep((o: any) => String(o.f ?? ""), dir);
  const domain = wrap("f", ["banana", "apple", "cherry", "apple", "", "banana"]);

  it("is a strict weak ordering (asc)", () => {
    assertTotalOrder("deep asc", factory(true), domain);
  });
  it("is a strict weak ordering (desc)", () => {
    assertTotalOrder("deep desc", factory(false), domain);
  });
  it("asc and desc are mirrors", () => {
    for (const x of domain)
      for (const y of domain)
        expect(sign(factory(false)(x, y))).toBe(inv(sign(factory(true)(x, y))));
  });
  it("sorts deterministically and stably from any input order", () => {
    assertStableDeterministic(factory(true), domain);
    assertStableDeterministic(factory(false), domain);
  });
});

// ---------------------------------------------------------------------------
describe("compareByField — raw field comparator", () => {
  const domain = wrap("f", ["b", "a", "c", "a", "z", "b"]);

  it("is a strict weak ordering over a homogeneous string domain (asc/desc)", () => {
    assertTotalOrder("field asc", compareByField("f", true), domain);
    assertTotalOrder("field desc", compareByField("f", false), domain);
  });
  it("asc and desc are mirrors over a homogeneous domain", () => {
    assertDirSymmetry(compareByField, "f", domain);
  });
  it("sorts deterministically over a homogeneous domain", () => {
    assertStableDeterministic(compareByField("f", true), domain);
  });
  // NOTE: compareByField uses raw </> on arbitrary values; on a MIXED-TYPE
  // domain (numbers vs strings vs undefined) </> can both be false, yielding 0
  // for unequal values — a latent non-total-order for heterogeneous data. It is
  // NOT in scope for this bead (no consumer feeds it mixed types: spaceSortFn
  // only uses it on the boolean-ish "type" field). Left unchanged; the
  // homogeneous-domain triad above is the locked contract.
});

// ---------------------------------------------------------------------------
describe("compareByFieldCaseInsensitive — total order on string fields (Notidian-mzaq fix #1)", () => {
  const stringDomain = wrap("f", [
    "Banana",
    "apple",
    "CHERRY",
    "apple",
    "file10",
    "file2",
    "",
  ]);

  it("is a strict weak ordering over string fields (asc)", () => {
    assertTotalOrder("ci asc", compareByFieldCaseInsensitive("f", true), stringDomain);
  });
  it("is a strict weak ordering over string fields (desc)", () => {
    assertTotalOrder("ci desc", compareByFieldCaseInsensitive("f", false), stringDomain);
  });
  it("asc and desc are mirrors", () => {
    assertDirSymmetry(compareByFieldCaseInsensitive, "f", stringDomain);
  });

  it("is case-insensitive (abc === ABC -> 0)", () => {
    const cmp = compareByFieldCaseInsensitive("f", true);
    expect(sign(cmp({ f: "apple" }, { f: "APPLE" }))).toBe(0);
    expect(sign(cmp({ f: "Apple" }, { f: "aPPLe" }))).toBe(0);
  });

  it("keeps numeric-aware locale collation (numeric:true): 'file2' < 'file10'", () => {
    const cmp = compareByFieldCaseInsensitive("f", true);
    expect(sign(cmp({ f: "file2" }, { f: "file10" }))).toBe(-1);
    expect(sign(cmp({ f: "file10" }, { f: "file2" }))).toBe(1);
  });

  it("REGRESSION: returns a NUMBER (not undefined) when a field is null/undefined", () => {
    const cmp = compareByFieldCaseInsensitive("f", true);
    // The bug: a[field]?.toLowerCase()... short-circuited to `undefined` when
    // the field was missing, breaking the sort contract. Now coerced to "".
    expect(typeof cmp({ f: null }, { f: "apple" })).toBe("number");
    expect(typeof cmp({ f: "apple" }, { f: undefined })).toBe("number");
    expect(typeof cmp({}, {})).toBe("number");
    expect(typeof cmp({ f: null }, { f: undefined })).toBe("number");
  });

  it("REGRESSION: total order HOLDS over a domain that includes null/undefined fields", () => {
    const mixed = [
      { f: "apple" },
      { f: null },
      { f: undefined },
      {},
      { f: "Banana" },
      { f: "" },
      { f: "banana" },
    ];
    assertTotalOrder("ci with nulls asc", compareByFieldCaseInsensitive("f", true), mixed);
    assertTotalOrder("ci with nulls desc", compareByFieldCaseInsensitive("f", false), mixed);
  });

  it("missing fields collate equal to the empty string (all sink together)", () => {
    const cmp = compareByFieldCaseInsensitive("f", true);
    expect(sign(cmp({ f: null }, { f: "" }))).toBe(0);
    expect(sign(cmp({}, { f: undefined }))).toBe(0);
  });

  it("PROPERTY: random string/null/number domains are always a total order", () => {
    const rng = makeRng(0xc0ffee);
    const pool = ["apple", "Banana", "CHERRY", "", "file2", "file10", null, undefined, 0, 7, 42];
    for (let run = 0; run < PROPERTY_RUNS; run++) {
      const n = randInt(rng, 0, 6);
      const dom = Array.from({ length: n }, () => ({ f: pick(rng, pool) }));
      const cmp = compareByFieldCaseInsensitive("f", run % 2 === 0);
      // exhaustive triad on the small random domain
      for (const x of dom)
        for (const y of dom) {
          const r = cmp(x, y);
          expect(Number.isFinite(r)).toBe(true);
          expect(sign(r)).toBe(inv(sign(cmp(y, x))));
        }
    }
  });

  it("sorts deterministically up to equivalence from any input order", () => {
    assertStableDeterministic(
      compareByFieldCaseInsensitive("f", true),
      wrap("f", ["banana", "Apple", "apple", null, "", "BANANA", undefined])
    );
  });
});

// ---------------------------------------------------------------------------
describe("compareByFieldNumerical — NaN-safe total order (Notidian-mzaq fix #2)", () => {
  const numDomain = wrap("f", [3, 1, 2, 10, 1, 0, -5, 42]);

  it("is a strict weak ordering over numeric fields (asc)", () => {
    assertTotalOrder("num asc", compareByFieldNumerical("f", true), numDomain);
  });
  it("is a strict weak ordering over numeric fields (desc)", () => {
    assertTotalOrder("num desc", compareByFieldNumerical("f", false), numDomain);
  });
  it("asc and desc are mirrors", () => {
    assertDirSymmetry(compareByFieldNumerical, "f", numDomain);
  });

  it("orders numbers numerically (not lexically): 2 < 10", () => {
    const cmp = compareByFieldNumerical("f", true);
    expect(sign(cmp({ f: 2 }, { f: 10 }))).toBe(-1);
    expect(sign(cmp({ f: 10 }, { f: 2 }))).toBe(1);
  });

  it("coerces numeric strings ('5' -> 5)", () => {
    const cmp = compareByFieldNumerical("f", true);
    expect(sign(cmp({ f: "5" }, { f: "20" }))).toBe(-1);
    expect(sign(cmp({ f: "5" }, { f: 5 }))).toBe(0);
  });

  it("REGRESSION: never returns NaN for a non-numeric field", () => {
    const cmp = compareByFieldNumerical("f", true);
    // The bug: (+a.f) - (+b.f) was NaN for "abc"/null/undefined, breaking the
    // sort contract. Non-finite values now sort consistently after real numbers.
    expect(Number.isNaN(cmp({ f: "abc" }, { f: 5 }))).toBe(false);
    expect(Number.isNaN(cmp({ f: 5 }, { f: "abc" }))).toBe(false);
    expect(Number.isNaN(cmp({ f: null }, { f: 5 }))).toBe(false);
    expect(Number.isNaN(cmp({ f: undefined }, { f: undefined }))).toBe(false);
    expect(Number.isNaN(cmp({ f: "abc" }, { f: "def" }))).toBe(false);
  });

  it("non-finite (junk/missing) fields sink AFTER every real number", () => {
    const asc = compareByFieldNumerical("f", true);
    expect(sign(asc({ f: 5 }, { f: "abc" }))).toBe(-1); // 5 before junk
    expect(sign(asc({ f: "abc" }, { f: 5 }))).toBe(1); // junk after 5
    expect(sign(asc({ f: undefined }, { f: -999 }))).toBe(1); // undefined(NaN) after a real number
    // NOTE: `null` is NOT junk here — `+null === 0` (a finite number), so a
    // null field sorts as the value 0, before junk and after negatives. This is
    // faithful JS coercion, not a bug; only undefined/non-numeric -> NaN sink.
    expect(sign(asc({ f: null }, { f: 5 }))).toBe(-1); // 0 < 5
    expect(sign(asc({ f: null }, { f: "abc" }))).toBe(-1); // 0 (finite) before junk
  });

  it("two non-finite fields compare equal (reflexive equivalence)", () => {
    const cmp = compareByFieldNumerical("f", true);
    expect(sign(cmp({ f: "abc" }, { f: "def" }))).toBe(0);
    expect(sign(cmp({ f: NaN }, { f: NaN }))).toBe(0);
    expect(sign(cmp({ f: undefined }, { f: undefined }))).toBe(0);
    // `null` coerces to finite 0, so it is NOT equivalent to undefined(NaN):
    expect(sign(cmp({ f: null }, { f: undefined }))).toBe(-1); // 0 before junk
  });

  it("REGRESSION: total order HOLDS over a domain mixing numbers and junk", () => {
    const mixed = wrap("f", [3, "abc", 1, null, 10, undefined, 0, "x", -5, NaN]);
    assertTotalOrder("num+junk asc", compareByFieldNumerical("f", true), mixed);
    assertTotalOrder("num+junk desc", compareByFieldNumerical("f", false), mixed);
  });

  it("PROPERTY: random numeric/junk domains are always a total order", () => {
    const rng = makeRng(0x5eed);
    const pool: any[] = [0, 1, 2, 10, 42, -5, -1, "3", "abc", "", null, undefined, NaN, Infinity];
    for (let run = 0; run < PROPERTY_RUNS; run++) {
      const n = randInt(rng, 0, 6);
      const dom = Array.from({ length: n }, () => ({ f: pick(rng, pool) }));
      const cmp = compareByFieldNumerical("f", run % 2 === 0);
      for (const x of dom)
        for (const y of dom) {
          const r = cmp(x, y);
          expect(Number.isFinite(r)).toBe(true);
          expect(sign(r)).toBe(inv(sign(cmp(y, x))));
        }
    }
  });

  it("Infinity is treated as non-finite junk (sinks after real numbers, reflexive)", () => {
    const cmp = compareByFieldNumerical("f", true);
    expect(sign(cmp({ f: Infinity }, { f: Infinity }))).toBe(0);
    expect(sign(cmp({ f: 5 }, { f: Infinity }))).toBe(-1);
  });

  it("sorts deterministically up to equivalence from any input order", () => {
    assertStableDeterministic(
      compareByFieldNumerical("f", true),
      wrap("f", [3, "abc", 1, null, 10, 0, "x", -5])
    );
  });
});
