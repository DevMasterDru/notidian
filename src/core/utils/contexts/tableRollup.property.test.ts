import {
  computeFrontmatterRollup,
  computeFrontmatterRollupDetailed,
  parseRelationLinks,
  RollupConfig,
} from "core/utils/contexts/tableRollup";

// ===========================================================================
// ADVERSARIAL + PROPERTY NET for the frontmatter-link RELATION/ROLLUP engine
// (Notidian-wl7). The engine (Notidian-8pl/9ln/e1u/ahk) already shipped; this
// file HARDENS it. tableRollup.ts aggregates OTHER notes' frontmatter into a
// row — an authority-adjacent READ surface that must never crash, mutate, or
// mis-aggregate. The existing tableRollup.test.ts is example-based; this file
// adds (a) adversarial coverage of every relation-value shape and rollup op,
// and (b) mulberry32-seeded property runs proving three invariants:
//
//   READ-ONLY  parseRelationLinks / computeFrontmatterRollup never mutate any
//              input (the value, the linkPaths array, the config, or the
//              resolved frontmatter objects).
//   TOTAL      they never throw on ANY input — GIVEN a total resolver (the
//              production resolver, `pathsIndex.get(p)?.metadata?.property ??
//              null`, is total; a resolver that itself throws is a separate,
//              caller-supplied fault — pinned explicitly below).
//   STABLE     same input -> same output, every time (pure / deterministic).
//
// CHARACTERIZATION, NOT CORRECTION. Every assertion below LOCKS the current
// observed behaviour (probed against the live implementation); no production
// code is changed. Surfaced caller-dependent quirks are pinned, not "fixed",
// and a follow-up bead is filed for the one genuinely caller-dependent edge
// (Notidian naming charset excludes commas, so the comma-in-wikilink split is a
// documented non-issue — pinned, no bead).
//
// CONVENTION: hand-rolled mulberry32 PRNG + PROPERTY_RUNS loop, NO fast-check
// dependency, matching src/core/utils/contexts/tableCsv.test.ts,
// src/shared/utils/array.test.ts and sanitizers.test.ts.
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
const pick = <T>(rng: () => number, pool: readonly T[]): T =>
  pool[randInt(rng, 0, pool.length - 1)];
const PROPERTY_RUNS = 600;

// Every relation-property frontmatter SHAPE the parser must survive: the canonical
// single [[link]] string, alias [[a|b]], heading/block [[a#h]] / [[a^id]], a bare
// path, a basename-only link, an array of links, a JSON-stringified array, a raw
// non-link string, null/undefined, numbers/booleans, plain objects, nested
// arrays, and deliberate garbage ([[]], [[ ]], lone fragments, stray brackets).
const RELATION_VALUE_ATOMS: readonly unknown[] = [
  "[[Tasks/A]]",
  "[[Tasks/A|A task]]",
  "[[Tasks/A#Section]]",
  "[[Tasks/A#^block]]",
  "[[Tasks/A#Section|Alias]]",
  "[[Alpha]]",
  "Tasks/A",
  "[[Tasks/A]], [[Tasks/B]]",
  "[[A]][[B]]", // two links, one segment (no separator)
  "[[A]]\n[[B]]", // newline-separated
  "[[]]", // empty wikilink
  "[[ ]]", // whitespace-only wikilink
  "[[#heading]]", // lone fragment -> target empties out
  "[[|x]]", // empty target, alias only
  "stray ]] [[ brackets",
  "A, B ,C", // comma-separated plain paths
  "",
  "   ",
  null,
  undefined,
  123,
  0,
  true,
  false,
  NaN,
  { foo: 1 },
  { toString: () => "[[Coerced]]" },
  ['["[[A]]","[[B]]"]'], // JSON-stringified array (links survive the regex)
  '["A","B"]', // JSON-stringified array WITHOUT links (comma-split garbage)
  [1, 2, 3],
  [{}, {}],
  [["[[A]]"], "[[B]]"], // nested array (one forEach level)
  [[["[[Deep]]"]]], // deeply nested array
  ["[[A]]", null, undefined, "[[B]]"], // array with holes
] as const;

describe("parseRelationLinks — adversarial relation-value shapes (characterization)", () => {
  // Each [input, expected] PINS the exact current output. These were probed
  // against the live implementation; they document, not redesign, behaviour.
  const cases: Array<[unknown, string[], string]> = [
    ["[[Tasks/A]]", ["Tasks/A"], "single canonical wikilink"],
    [
      "[[Tasks/A|A task]]",
      ["Tasks/A"],
      "alias stripped (|display removed)",
    ],
    ["[[Tasks/A#Section]]", ["Tasks/A"], "heading fragment stripped"],
    ["[[Tasks/A#^block]]", ["Tasks/A"], "block fragment stripped"],
    [
      "[[Tasks/A#Section|Alias]]",
      ["Tasks/A"],
      "alias + heading both stripped",
    ],
    ["[[Alpha]]", ["Alpha"], "basename-only link kept verbatim"],
    ["Tasks/A", ["Tasks/A"], "bare path (no wikilink) kept verbatim"],
    [
      "[[Tasks/A]], [[Tasks/B]]",
      ["Tasks/A", "Tasks/B"],
      "comma-separated wikilinks, both kept",
    ],
    ["[[A]][[B]]", ["A", "B"], "two links in one segment via global regex"],
    ["[[A]]\n[[B]]", ["A", "B"], "newline-separated links (regex finds both)"],
    [
      "[[]]",
      ["[[]]"],
      "EMPTY wikilink [[]] does NOT match the regex (needs >=1 non-] char) -> falls to the else branch and is kept as a RAW segment",
    ],
    [
      "[[ ]]",
      [],
      "whitespace-only wikilink DOES match the regex, then trims to empty -> dropped",
    ],
    [
      "[[#heading]]",
      [],
      "lone fragment: target empties after #-split -> dropped",
    ],
    ["[[|x]]", [], "empty target with alias -> dropped"],
    ["A, B ,C", ["A", "B", "C"], "comma-separated plain paths, trimmed"],
    ["", [], "empty string"],
    ["   ", [], "whitespace-only string"],
    [null, [], "null"],
    [undefined, [], "undefined"],
    [123, ["123"], "number stringified"],
    [0, ["0"], "zero stringified (not dropped — String(0) is '0')"],
    [true, ["true"], "boolean stringified"],
    [false, ["false"], "false stringified (String(false) is 'false')"],
    [NaN, ["NaN"], "NaN stringified"],
    [{ foo: 1 }, ["[object Object]"], "plain object -> default String() tag"],
    [
      { toString: () => "[[Coerced]]" },
      ["Coerced"],
      "object with custom toString is coerced then parsed",
    ],
    [
      '["[[A]]","[[B]]"]',
      ["A", "B"],
      "JSON-stringified array WITH links: regex matches inside the JSON text",
    ],
    [
      '["A","B"]',
      ['["A"', '"B"]'],
      "JSON-stringified array WITHOUT links: comma-split keeps JSON noise (caller-dependent; Notidian authors arrays, not JSON strings)",
    ],
    [[1, 2, 3], ["1", "2", "3"], "array of numbers, each stringified"],
    [[{}, {}], ["[object Object]"], "array of objects -> deduped tag"],
    [
      [["[[A]]"], "[[B]]"],
      ["A", "B"],
      "nested array: inner array String()-coerced, regex still finds the link",
    ],
    [[[["[[Deep]]"]]], ["Deep"], "deeply nested array still resolves"],
    [
      ["[[A]]", null, undefined, "[[B]]"],
      ["A", "B"],
      "array holes (null/undefined) contribute nothing",
    ],
    ["[[A]], [[A|alias]], [[A#h]]", ["A"], "duplicate links deduped to one"],
    [",[[A]]", ["A"], "leading comma ignored"],
    ["[[A]],", ["A"], "trailing comma ignored"],
    [[], [], "empty array"],
    [["", "  "], [], "array of blanks"],
  ];

  it.each(cases)(
    "%p -> %p (%s)",
    (input, expected) => {
      expect(parseRelationLinks(input)).toEqual(expected);
    }
  );

  it("PINS the Notidian-charset comma quirk: a comma INSIDE a wikilink splits it", () => {
    // Notidian's safe naming charset has no commas (see tableRollup.ts header),
    // so splitting on comma before matching wikilinks is intentional. A link with
    // a literal comma therefore fragments — pinned as a documented non-issue, not
    // a bug to fix blind (no real Notidian path can contain a comma).
    expect(parseRelationLinks("[[A,B]]")).toEqual(["[[A", "B]]"]);
  });

  it("always returns a deduplicated array of non-empty strings", () => {
    const rng = makeRng(0x5eed01);
    for (let run = 0; run < PROPERTY_RUNS; run++) {
      const value = pick(rng, RELATION_VALUE_ATOMS);
      const out = parseRelationLinks(value);
      expect(Array.isArray(out)).toBe(true);
      // Every element is a non-empty string.
      for (const el of out) {
        expect(typeof el).toBe("string");
        expect(el.length).toBeGreaterThan(0);
      }
      // No duplicates (uniq invariant).
      expect(out.length).toBe(new Set(out).size);
    }
  });

  it("TOTAL: never throws on any seeded relation value", () => {
    const rng = makeRng(0x5eed02);
    for (let run = 0; run < PROPERTY_RUNS; run++) {
      const value = pick(rng, RELATION_VALUE_ATOMS);
      expect(() => parseRelationLinks(value)).not.toThrow();
    }
  });

  it("STABLE: same value -> identical output across repeated calls", () => {
    const rng = makeRng(0x5eed03);
    for (let run = 0; run < PROPERTY_RUNS; run++) {
      const value = pick(rng, RELATION_VALUE_ATOMS);
      const a = parseRelationLinks(value);
      const b = parseRelationLinks(value);
      expect(a).toEqual(b);
    }
  });

  it("READ-ONLY: never mutates an array-valued input", () => {
    const rng = makeRng(0x5eed04);
    for (let run = 0; run < PROPERTY_RUNS; run++) {
      // Build a fresh array input (so a mutation would be observable) by sampling
      // a handful of atoms.
      const len = randInt(rng, 0, 5);
      const input: unknown[] = [];
      for (let i = 0; i < len; i++) input.push(pick(rng, RELATION_VALUE_ATOMS));
      const snapshot = JSON.stringify(input, (_k, v) =>
        typeof v === "number" && Number.isNaN(v) ? "__NaN__" : v
      );
      parseRelationLinks(input);
      const after = JSON.stringify(input, (_k, v) =>
        typeof v === "number" && Number.isNaN(v) ? "__NaN__" : v
      );
      expect(after).toBe(snapshot);
    }
  });

  it("returns a fresh array (caller can mutate the result freely)", () => {
    const a = parseRelationLinks("[[A]], [[B]]");
    const b = parseRelationLinks("[[A]], [[B]]");
    expect(a).not.toBe(b);
    a.push("MUTATED");
    expect(parseRelationLinks("[[A]], [[B]]")).toEqual(["A", "B"]);
  });
});

// ---------------------------------------------------------------------------
// computeFrontmatterRollup — every RollupConfig op over adversarial targets.
// ---------------------------------------------------------------------------

// Every op the engine actually defines (see tableRollup.ts) plus an unknown op
// to pin the default branch.
const ROLLUP_FNS: readonly string[] = [
  "count",
  "count_values",
  "values",
  "unique",
  "sum",
  "avg",
  "min",
  "max",
  "bogus_unknown_op", // exercises the unknown-fn -> "" default
];

// Frontmatter VALUE atoms for a single target property: numbers (incl. 0,
// negatives, Infinity), numeric strings (decimal/scientific/hex), non-numeric
// strings, blanks, booleans, Dates, null/undefined, arrays (flattened), and
// objects.
const FM_VALUE_ATOMS: readonly unknown[] = [
  0,
  3,
  5,
  -7,
  2.5,
  Infinity,
  "4",
  "3.5",
  "1e3",
  "0x10",
  "nope",
  "done",
  "open",
  "",
  "   ",
  true,
  false,
  new Date("2020-01-01"),
  null,
  undefined,
  ["x", "y"],
  [2, 3],
  [[1, 2], 3],
  { nested: 1 },
] as const;

describe("computeFrontmatterRollup — adversarial ops over mixed targets (characterization)", () => {
  const cfg = (over: Partial<RollupConfig>): RollupConfig => ({
    relationProperty: "rel",
    targetProperty: "v",
    fn: "count",
    ...over,
  });

  // Concrete adversarial examples pinning the exact numeric/string contracts.
  it("strict numeric coercion: numeric strings sum, booleans/dates/blanks excluded", () => {
    const fm: Record<string, Record<string, any>> = {
      A: { v: "3.5" }, // numeric string -> 3.5
      B: { v: "1e3" }, // scientific string -> 1000
      C: { v: "0x10" }, // hex string -> 16 (Number() accepts 0x)
      D: { v: true }, // boolean -> excluded
      E: { v: new Date("2020-01-01") }, // Date -> excluded
      F: { v: "   " }, // blank -> excluded
      G: { v: "nope" }, // NaN -> excluded
    };
    expect(
      computeFrontmatterRollup({
        linkPaths: ["A", "B", "C", "D", "E", "F", "G"],
        config: cfg({ fn: "sum" }),
        resolveFrontmatter: (p) => fm[p] ?? null,
      })
    ).toBe("1019.5"); // 3.5 + 1000 + 16
  });

  it("count counts LINKS not resolved rows, and never calls the resolver", () => {
    let calls = 0;
    expect(
      computeFrontmatterRollup({
        linkPaths: ["A", "B", "Dangling", "Dangling2"],
        config: cfg({ fn: "count" }),
        resolveFrontmatter: () => {
          calls++;
          return null;
        },
      })
    ).toBe("4");
    expect(calls).toBe(0);
  });

  it("0 and false ARE counted by count_values (String(0)/String(false) non-empty)", () => {
    expect(
      computeFrontmatterRollup({
        linkPaths: ["A", "B"],
        config: cfg({ fn: "count_values" }),
        resolveFrontmatter: (p) => (p === "A" ? { v: 0 } : { v: false }),
      })
    ).toBe("2");
  });

  it("values/unique stringify and dedupe; arrays are flattened", () => {
    const fm: Record<string, Record<string, any>> = {
      A: { v: ["x", "y"] },
      B: { v: ["y", "z"] },
      C: { v: "x" },
    };
    expect(
      computeFrontmatterRollup({
        linkPaths: ["A", "B", "C"],
        config: cfg({ fn: "values" }),
        resolveFrontmatter: (p) => fm[p] ?? null,
      })
    ).toBe("x, y, z");
    // "unique" shares the values branch.
    expect(
      computeFrontmatterRollup({
        linkPaths: ["A", "B", "C"],
        config: cfg({ fn: "unique" }),
        resolveFrontmatter: (p) => fm[p] ?? null,
      })
    ).toBe("x, y, z");
  });

  it("dangling links (resolver -> null) contribute nothing to value aggregates", () => {
    const fm: Record<string, Record<string, any>> = { A: { v: 10 } };
    // B/C are dangling: pathsIndex miss -> null.
    expect(
      computeFrontmatterRollup({
        linkPaths: ["A", "B", "C"],
        config: cfg({ fn: "sum" }),
        resolveFrontmatter: (p) => fm[p] ?? null,
      })
    ).toBe("10");
    expect(
      computeFrontmatterRollup({
        linkPaths: ["A", "B", "C"],
        config: cfg({ fn: "count_values" }),
        resolveFrontmatter: (p) => fm[p] ?? null,
      })
    ).toBe("1");
  });

  it("empty / all-non-numeric numeric aggregate: sum=0, avg/min/max empty", () => {
    const r = () => ({ v: "nope" });
    expect(
      computeFrontmatterRollup({
        linkPaths: ["A"],
        config: cfg({ fn: "sum" }),
        resolveFrontmatter: r,
      })
    ).toBe("0");
    for (const fn of ["avg", "min", "max"]) {
      expect(
        computeFrontmatterRollup({
          linkPaths: ["A"],
          config: cfg({ fn }),
          resolveFrontmatter: r,
        })
      ).toBe("");
    }
  });

  it("unknown fn returns empty string (default branch)", () => {
    expect(
      computeFrontmatterRollup({
        linkPaths: ["A", "B"],
        config: cfg({ fn: "totally_unknown" }),
        resolveFrontmatter: () => ({ v: 5 }),
      })
    ).toBe("");
  });

  it("min/max over negatives use reduce (no arg-count limit), and format ints plainly", () => {
    const fm: Record<string, Record<string, any>> = {
      A: { v: -5 },
      B: { v: -9 },
      C: { v: -1 },
    };
    expect(
      computeFrontmatterRollup({
        linkPaths: ["A", "B", "C"],
        config: cfg({ fn: "min" }),
        resolveFrontmatter: (p) => fm[p] ?? null,
      })
    ).toBe("-9");
    expect(
      computeFrontmatterRollup({
        linkPaths: ["A", "B", "C"],
        config: cfg({ fn: "max" }),
        resolveFrontmatter: (p) => fm[p] ?? null,
      })
    ).toBe("-1");
  });

  it("avg rounds to 2 decimals via toFixed(2) then trims trailing zeros", () => {
    // 1/3 -> 0.333... -> "0.33"
    expect(
      computeFrontmatterRollup({
        linkPaths: ["A", "B", "C"],
        config: cfg({ fn: "avg" }),
        resolveFrontmatter: (p) => (p === "A" ? { v: 1 } : { v: 0 }),
      })
    ).toBe("0.33");
    // exact integer average formats with no decimals.
    expect(
      computeFrontmatterRollup({
        linkPaths: ["A", "B"],
        config: cfg({ fn: "avg" }),
        resolveFrontmatter: () => ({ v: 4 }),
      })
    ).toBe("4");
  });

  it("min/max over a HUGE link set do not overflow the call stack (reduce, not spread)", () => {
    // The header comment claims reduce avoids the Math.min(...spread) arg-count
    // limit. Prove it on a set far past the ~65k spread limit.
    const N = 200_000;
    const linkPaths = Array.from({ length: N }, (_v, i) => `P${i}`);
    expect(
      computeFrontmatterRollup({
        linkPaths,
        config: cfg({ fn: "max" }),
        resolveFrontmatter: (p) => ({ v: Number(p.slice(1)) }),
      })
    ).toBe(String(N - 1));
    expect(
      computeFrontmatterRollup({
        linkPaths,
        config: cfg({ fn: "min" }),
        resolveFrontmatter: (p) => ({ v: Number(p.slice(1)) }),
      })
    ).toBe("0");
  });

  // --- property runs over a TOTAL (production-shaped) resolver --------------
  // The production resolver is `pathsIndex.get(p)?.metadata?.property ?? null`,
  // which is total (returns a record or null, never throws). We model that here
  // and prove the three invariants across every (op, target-mix) combination.

  // Build a random frontmatter map + link set: some links resolve to a record
  // carrying the target property (possibly array/garbage), some resolve to a
  // record WITHOUT it, some are dangling (null).
  const buildScenario = (rng: () => number) => {
    const targetProperty = pick(rng, ["v", "missing", ""]);
    const map = new Map<string, Record<string, unknown> | null>();
    const linkPaths: string[] = [];
    const count = randInt(rng, 0, 8);
    for (let i = 0; i < count; i++) {
      const key = `P${i}`;
      linkPaths.push(key);
      const roll = rng();
      if (roll < 0.25) {
        map.set(key, null); // dangling
      } else if (roll < 0.45) {
        map.set(key, { other: "x" }); // resolves but no target property
      } else {
        map.set(key, { v: pick(rng, FM_VALUE_ATOMS) });
      }
    }
    // Occasionally inject a duplicate / dangling-only link.
    if (rng() < 0.3) linkPaths.push("DANGLING_ONLY");
    const resolveFrontmatter = (p: string) =>
      // total: undefined entries collapse to null via ?? — mirrors pathsIndex.
      (map.has(p) ? map.get(p) : null) ?? null;
    const config: RollupConfig = {
      relationProperty: "rel",
      targetProperty,
      fn: pick(rng, ROLLUP_FNS),
    };
    return { linkPaths, config, resolveFrontmatter };
  };

  it("TOTAL: never throws for any op over any target mix (total resolver)", () => {
    const rng = makeRng(0x1abe11);
    for (let run = 0; run < PROPERTY_RUNS; run++) {
      const { linkPaths, config, resolveFrontmatter } = buildScenario(rng);
      expect(() =>
        computeFrontmatterRollup({ linkPaths, config, resolveFrontmatter })
      ).not.toThrow();
    }
  });

  it("always returns a string (every op, every target mix)", () => {
    const rng = makeRng(0x1abe12);
    for (let run = 0; run < PROPERTY_RUNS; run++) {
      const { linkPaths, config, resolveFrontmatter } = buildScenario(rng);
      const out = computeFrontmatterRollup({
        linkPaths,
        config,
        resolveFrontmatter,
      });
      expect(typeof out).toBe("string");
    }
  });

  it("STABLE: identical output across repeated calls (deterministic/pure)", () => {
    const rng = makeRng(0x1abe13);
    for (let run = 0; run < PROPERTY_RUNS; run++) {
      const { linkPaths, config, resolveFrontmatter } = buildScenario(rng);
      const a = computeFrontmatterRollup({
        linkPaths,
        config,
        resolveFrontmatter,
      });
      const b = computeFrontmatterRollup({
        linkPaths,
        config,
        resolveFrontmatter,
      });
      expect(a).toBe(b);
    }
  });

  it("READ-ONLY: never mutates linkPaths, config, or resolved frontmatter", () => {
    const rng = makeRng(0x1abe14);
    for (let run = 0; run < PROPERTY_RUNS; run++) {
      const { linkPaths, config } = buildScenario(rng);
      // Resolver returns a STABLE shared object per path so a mutation would
      // be observable after the call.
      const fmStore = new Map<string, Record<string, unknown>>();
      const resolveFrontmatter = (p: string) => {
        if (!fmStore.has(p)) fmStore.set(p, { v: pick(rng, FM_VALUE_ATOMS) });
        return fmStore.get(p) ?? null;
      };
      const linksBefore = JSON.stringify(linkPaths);
      const configBefore = JSON.stringify(config);
      computeFrontmatterRollup({ linkPaths, config, resolveFrontmatter });
      // Snapshot the frontmatter store with NaN-safe stringify.
      const fmSnapshot = (m: Map<string, Record<string, unknown>>) =>
        JSON.stringify(
          [...m.entries()],
          (_k, v) =>
            typeof v === "number" && Number.isNaN(v) ? "__NaN__" : v
        );
      const fmBefore = fmSnapshot(fmStore);
      // Re-run to fully exercise reads (store already populated).
      computeFrontmatterRollup({ linkPaths, config, resolveFrontmatter });
      expect(JSON.stringify(linkPaths)).toBe(linksBefore);
      expect(JSON.stringify(config)).toBe(configBefore);
      expect(fmSnapshot(fmStore)).toBe(fmBefore);
    }
  });

  it("EQUIVALENCE: count_values == flattened non-empty target count; values == its dedupe", () => {
    // Cross-check the engine against an independent reference over random data,
    // so a regression in either op is caught structurally (not just by example).
    const rng = makeRng(0x1abe15);
    for (let run = 0; run < PROPERTY_RUNS; run++) {
      const links = Array.from({ length: randInt(rng, 0, 6) }, (_v, i) => `P${i}`);
      const fm = new Map<string, Record<string, unknown>>();
      for (const p of links) fm.set(p, { v: pick(rng, FM_VALUE_ATOMS) });
      const resolve = (p: string) => fm.get(p) ?? null;
      const cfgv = (fn: string): RollupConfig => ({
        relationProperty: "rel",
        targetProperty: "v",
        fn,
      });

      // Reference: flatten every resolved target, drop null/blank.
      const flat: unknown[] = [];
      for (const p of links) {
        const v = fm.get(p)?.v;
        const push = (x: unknown) => {
          if (x == null || String(x).trim().length === 0) return;
          flat.push(x);
        };
        if (Array.isArray(v)) v.forEach(push);
        else push(v);
      }
      const expectedCountValues = String(flat.length);
      const expectedValues = [...new Set(flat.map((x) => String(x)))].join(", ");

      expect(
        computeFrontmatterRollup({
          linkPaths: links,
          config: cfgv("count_values"),
          resolveFrontmatter: resolve,
        })
      ).toBe(expectedCountValues);
      expect(
        computeFrontmatterRollup({
          linkPaths: links,
          config: cfgv("values"),
          resolveFrontmatter: resolve,
        })
      ).toBe(expectedValues);
    }
  });

  it("EQUIVALENCE: sum/avg/min/max match an independent numeric reduction", () => {
    const rng = makeRng(0x1abe16);
    const toNum = (v: unknown): number => {
      if (typeof v === "number") return v;
      if (typeof v === "boolean" || v instanceof Date) return NaN;
      const s = String(v).trim();
      return s.length === 0 ? NaN : Number(s);
    };
    for (let run = 0; run < PROPERTY_RUNS; run++) {
      const links = Array.from({ length: randInt(rng, 0, 6) }, (_v, i) => `P${i}`);
      const fm = new Map<string, Record<string, unknown>>();
      for (const p of links) fm.set(p, { v: pick(rng, FM_VALUE_ATOMS) });
      const resolve = (p: string) => fm.get(p) ?? null;
      const cfgv = (fn: string): RollupConfig => ({
        relationProperty: "rel",
        targetProperty: "v",
        fn,
      });

      const nums: number[] = [];
      for (const p of links) {
        const v = fm.get(p)?.v;
        const push = (x: unknown) => {
          if (x == null || String(x).trim().length === 0) return;
          const n = toNum(x);
          if (!Number.isNaN(n)) nums.push(n);
        };
        if (Array.isArray(v)) v.forEach(push);
        else push(v);
      }
      const fmt = (n: number) =>
        Number.isInteger(n) ? String(n) : String(Number(n.toFixed(2)));

      const sum =
        nums.length === 0 ? "0" : fmt(nums.reduce((a, b) => a + b, 0));
      const avg =
        nums.length === 0
          ? ""
          : fmt(nums.reduce((a, b) => a + b, 0) / nums.length);
      const min =
        nums.length === 0 ? "" : fmt(nums.reduce((a, b) => Math.min(a, b)));
      const max =
        nums.length === 0 ? "" : fmt(nums.reduce((a, b) => Math.max(a, b)));

      expect(
        computeFrontmatterRollup({
          linkPaths: links,
          config: cfgv("sum"),
          resolveFrontmatter: resolve,
        })
      ).toBe(sum);
      expect(
        computeFrontmatterRollup({
          linkPaths: links,
          config: cfgv("avg"),
          resolveFrontmatter: resolve,
        })
      ).toBe(avg);
      expect(
        computeFrontmatterRollup({
          linkPaths: links,
          config: cfgv("min"),
          resolveFrontmatter: resolve,
        })
      ).toBe(min);
      expect(
        computeFrontmatterRollup({
          linkPaths: links,
          config: cfgv("max"),
          resolveFrontmatter: resolve,
        })
      ).toBe(max);
    }
  });

  it("VALUE-PRESERVING (ADR 0029 D2): computeFrontmatterRollup(x) === computeFrontmatterRollupDetailed(x).value", () => {
    // The string API now delegates to the detailed fn. This locks that contract
    // structurally over every (op, target-mix): if anyone ever un-delegates or
    // diverges the value path, this fails. Also pins the count invariants.
    const rng = makeRng(0x0029d2);
    for (let run = 0; run < PROPERTY_RUNS; run++) {
      const { linkPaths, config, resolveFrontmatter } = buildScenario(rng);
      const detailed = computeFrontmatterRollupDetailed({
        linkPaths,
        config,
        resolveFrontmatter,
      });
      const str = computeFrontmatterRollup({
        linkPaths,
        config,
        resolveFrontmatter,
      });
      expect(str).toBe(detailed.value);
      // relationCount is exactly the link count; resolvedCount is bounded by it.
      expect(detailed.relationCount).toBe(linkPaths.length);
      expect(detailed.resolvedCount).toBeGreaterThanOrEqual(0);
      expect(detailed.resolvedCount).toBeLessThanOrEqual(detailed.relationCount);
      // count is never partial; it also never calls the resolver (totality).
      if (config.fn === "count") {
        expect(detailed.resolvedCount).toBe(detailed.relationCount);
      }
    }
  });

  it("PINS the conditional-totality boundary: a resolver that THROWS propagates for value ops, but count never calls it", () => {
    // Honest characterization: computeFrontmatterRollup is total GIVEN a total
    // resolver. The production resolver is total; a resolver that itself throws
    // is a caller fault. count short-circuits before any resolver call.
    const boom = () => {
      throw new Error("resolver boom");
    };
    expect(() =>
      computeFrontmatterRollup({
        linkPaths: ["A"],
        config: cfg({ fn: "sum" }),
        resolveFrontmatter: boom,
      })
    ).toThrow("resolver boom");
    // count does not touch the resolver, so it stays total even here.
    expect(
      computeFrontmatterRollup({
        linkPaths: ["A", "B"],
        config: cfg({ fn: "count" }),
        resolveFrontmatter: boom,
      })
    ).toBe("2");
  });
});
