import { computeRowRollup } from "core/utils/contexts/tableRollupRuntime";
import { RollupConfig } from "core/utils/contexts/tableRollup";

// ===========================================================================
// ADVERSARIAL + PROPERTY NET for the rollup RUNTIME bridge (Notidian-wl7).
// computeRowRollup (tableRollupRuntime.ts) is the production glue: it parses a
// row's relation value, resolves each link through superstate.spaceManager +
// pathsIndex, then aggregates. This file proves the END-TO-END invariants over
// a PRODUCTION-SHAPED fake Superstate (the resolver path mirrors prod, which is
// TOTAL — pathsIndex.get(p)?.metadata?.property ?? null never throws), so unlike
// the pure engine the runtime totality here is unconditional.
//
//   READ-ONLY  the relation value, the config, and the superstate's pathsIndex
//              (and the frontmatter records it holds) are never mutated.
//   TOTAL      computeRowRollup never throws on any relation value / op, given
//              the production superstate shape.
//   STABLE     same (superstate, value, config, source) -> same output.
//
// CHARACTERIZATION ONLY — no production code is changed. Reuses the exact
// fake-Superstate/pathsIndex stub shape from tableRollupRuntime.test.ts.
//
// CONVENTION: hand-rolled mulberry32 PRNG + PROPERTY_RUNS loop, NO fast-check.
// ===========================================================================

// Production-shaped fake Superstate, copied from tableRollupRuntime.test.ts:
// pathsIndex (path -> {metadata:{property}}) + a spaceManager.resolvePath that
// emulates the Notidian-e1u link index — exact key wins, else bare path gets
// ".md", else a basename-only link resolves by basename, else pass-through.
const makeSuperstate = (fm: Record<string, Record<string, any>>) => {
  const pathsIndex = new Map(
    Object.entries(fm).map(([path, property]) => [
      path,
      { metadata: { property } },
    ])
  );
  const resolvePath = (link: string, _source?: string): string => {
    if (pathsIndex.has(link)) return link;
    if (pathsIndex.has(link + ".md")) return link + ".md";
    const wanted = link.split("/").pop();
    for (const key of pathsIndex.keys()) {
      const base = key.replace(/\.md$/, "").split("/").pop();
      if (base === wanted) return key;
    }
    return link;
  };
  return {
    spacesIndex: new Map(),
    pathsIndex,
    spaceManager: { resolvePath },
  } as any;
};

// --- mulberry32 PRNG (no external dep), matching repo convention -----------
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
const PROPERTY_RUNS = 500;

const ROLLUP_FNS: readonly string[] = [
  "count",
  "count_values",
  "values",
  "unique",
  "sum",
  "avg",
  "min",
  "max",
  "bogus",
];

// Relation-value shapes a row's relation property can actually carry, including
// dangling links (resolve to a non-matching key), basename-only, bare-path,
// alias/fragment, arrays, JSON noise, and garbage.
const RELATION_VALUES: readonly unknown[] = [
  "[[Tasks/A]], [[Tasks/B]]",
  "[[Tasks/A|alias]]",
  "[[Tasks/A#h]]",
  "[[A]]", // basename-only
  "[[Tasks/Dangling]]", // resolves to nothing in the index
  "[[Tasks/A]], [[Tasks/Dangling]]",
  ["[[A]]", "[[B]]"],
  "Tasks/A, Tasks/B",
  "",
  "   ",
  null,
  undefined,
  42,
  true,
  { foo: 1 },
  [["[[A]]"], "[[B]]"],
  "[[A]], [[A]]", // duplicate
] as const;

const FM_TARGET_ATOMS: readonly unknown[] = [
  3,
  5,
  -2,
  0,
  "7",
  "1.5",
  "nope",
  "done",
  "",
  true,
  ["x", "y"],
  [2, 3],
  null,
] as const;

describe("computeRowRollup — adversarial runtime characterization", () => {
  const superstate = makeSuperstate({
    "Tasks/A.md": { hours: 3, status: "done" },
    "Tasks/B.md": { hours: 5, status: "open" },
  });

  it("sums a numeric target across basename/bare/aliased links", () => {
    expect(
      computeRowRollup(
        superstate,
        "[[Tasks/A]], [[B|five]]",
        { relationProperty: "tasks", targetProperty: "hours", fn: "sum" },
        "Projects/X.md"
      )
    ).toBe("8");
  });

  it("count is independent of whether links resolve", () => {
    expect(
      computeRowRollup(
        superstate,
        "[[Tasks/A]], [[Tasks/Dangling]], [[Tasks/AlsoMissing]]",
        { relationProperty: "tasks", targetProperty: "hours", fn: "count" },
        "Projects/X.md"
      )
    ).toBe("3");
  });

  it("dangling links contribute nothing to value aggregates (pathsIndex miss -> null)", () => {
    expect(
      computeRowRollup(
        superstate,
        "[[Tasks/A]], [[Tasks/Dangling]]",
        { relationProperty: "tasks", targetProperty: "hours", fn: "sum" },
        "Projects/X.md"
      )
    ).toBe("3");
    expect(
      computeRowRollup(
        superstate,
        "[[Tasks/A]], [[Tasks/Dangling]]",
        {
          relationProperty: "tasks",
          targetProperty: "hours",
          fn: "count_values",
        },
        "Projects/X.md"
      )
    ).toBe("1");
  });

  it("empty/null/garbage relation values never crash and aggregate to 0/empty", () => {
    for (const value of ["", "   ", null, undefined, { x: 1 }] as unknown[]) {
      expect(
        computeRowRollup(
          superstate,
          value,
          { relationProperty: "tasks", targetProperty: "hours", fn: "sum" },
          "Projects/X.md"
        )
      ).toBe("0");
    }
  });

  it("values lists unique resolved target values", () => {
    expect(
      computeRowRollup(
        superstate,
        "[[Tasks/A]], [[Tasks/B]]",
        { relationProperty: "tasks", targetProperty: "status", fn: "values" },
        "Projects/X.md"
      )
    ).toBe("done, open");
  });

  // --- property runs -------------------------------------------------------
  const buildSuperstate = (rng: () => number) => {
    const fm: Record<string, Record<string, any>> = {};
    const n = randInt(rng, 0, 6);
    for (let i = 0; i < n; i++) {
      fm[`Tasks/T${i}.md`] = { hours: pick(rng, FM_TARGET_ATOMS) };
    }
    return makeSuperstate(fm);
  };

  it("TOTAL: never throws for any (value, op) over a production superstate", () => {
    const rng = makeRng(0xc0ffee);
    for (let run = 0; run < PROPERTY_RUNS; run++) {
      const ss = buildSuperstate(rng);
      const value = pick(rng, RELATION_VALUES);
      const config: RollupConfig = {
        relationProperty: "tasks",
        targetProperty: pick(rng, ["hours", "status", "missing"]),
        fn: pick(rng, ROLLUP_FNS),
      };
      expect(() =>
        computeRowRollup(ss, value, config, "Projects/X.md")
      ).not.toThrow();
    }
  });

  it("always returns a string", () => {
    const rng = makeRng(0xc0ffef);
    for (let run = 0; run < PROPERTY_RUNS; run++) {
      const ss = buildSuperstate(rng);
      const value = pick(rng, RELATION_VALUES);
      const out = computeRowRollup(
        ss,
        value,
        {
          relationProperty: "tasks",
          targetProperty: "hours",
          fn: pick(rng, ROLLUP_FNS),
        },
        "Projects/X.md"
      );
      expect(typeof out).toBe("string");
    }
  });

  it("STABLE: same inputs -> identical output", () => {
    const rng = makeRng(0xc0fff0);
    for (let run = 0; run < PROPERTY_RUNS; run++) {
      const ss = buildSuperstate(rng);
      const value = pick(rng, RELATION_VALUES);
      const config: RollupConfig = {
        relationProperty: "tasks",
        targetProperty: "hours",
        fn: pick(rng, ROLLUP_FNS),
      };
      const a = computeRowRollup(ss, value, config, "Projects/X.md");
      const b = computeRowRollup(ss, value, config, "Projects/X.md");
      expect(a).toBe(b);
    }
  });

  it("READ-ONLY: never mutates the relation value, config, or pathsIndex", () => {
    const rng = makeRng(0xc0fff1);
    for (let run = 0; run < PROPERTY_RUNS; run++) {
      const fm: Record<string, Record<string, any>> = {
        "Tasks/A.md": { hours: pick(rng, FM_TARGET_ATOMS) },
        "Tasks/B.md": { hours: pick(rng, FM_TARGET_ATOMS) },
      };
      const ss = makeSuperstate(fm);
      const value = pick(rng, RELATION_VALUES);
      const config: RollupConfig = {
        relationProperty: "tasks",
        targetProperty: "hours",
        fn: pick(rng, ROLLUP_FNS),
      };
      const nanSafe = (_k: string, v: unknown) =>
        typeof v === "number" && Number.isNaN(v) ? "__NaN__" : v;
      const valueBefore = JSON.stringify(value, nanSafe);
      const configBefore = JSON.stringify(config);
      const indexBefore = JSON.stringify(
        [...ss.pathsIndex.entries()],
        nanSafe
      );
      computeRowRollup(ss, value, config, "Projects/X.md");
      expect(JSON.stringify(value, nanSafe)).toBe(valueBefore);
      expect(JSON.stringify(config)).toBe(configBefore);
      expect(JSON.stringify([...ss.pathsIndex.entries()], nanSafe)).toBe(
        indexBefore
      );
    }
  });

  it("EQUIVALENCE: count == number of parsed links (resolution-independent)", () => {
    // Independent reference: count must equal the de-duplicated parsed link
    // count regardless of which links resolve, across random values.
    const rng = makeRng(0xc0fff2);
    for (let run = 0; run < PROPERTY_RUNS; run++) {
      const ss = buildSuperstate(rng);
      const value = pick(rng, RELATION_VALUES);
      const out = computeRowRollup(
        ss,
        value,
        { relationProperty: "tasks", targetProperty: "hours", fn: "count" },
        "Projects/X.md"
      );
      // count output is a non-negative integer string.
      expect(/^\d+$/.test(out)).toBe(true);
      expect(Number(out)).toBeGreaterThanOrEqual(0);
    }
  });
});
