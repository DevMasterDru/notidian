import { computeRowBackRelation } from "core/utils/contexts/tableBackRelationRuntime";

// ===========================================================================
// ADVERSARIAL + PROPERTY NET for the back-relation RUNTIME (Notidian-wl7).
// computeRowBackRelation (tableBackRelationRuntime.ts) is the reverse side of a
// frontmatter-link relation: for a target row, find the inlinking rows whose
// `relationProperty` actually resolves BACK to the target, then either list
// their titles (fn "list", default) or aggregate a field over them (reusing the
// forward rollup engine). It reads pathsIndex.inlinks + each candidate's
// frontmatter — an authority-adjacent READ surface that must never crash,
// mutate, or mis-aggregate.
//
//   READ-ONLY  targetPath, config, and the superstate's pathsIndex (inlinks +
//              frontmatter records) are never mutated.
//   TOTAL      never throws on any (targetPath, config) over the production
//              superstate shape (inlinks may be absent/garbage; config.fn may
//              be unknown; the resolver is total).
//   STABLE     same inputs -> same output.
//
// CHARACTERIZATION ONLY — no production code is changed. Reuses the exact fake
// Superstate stub shape from tableBackRelationRuntime.test.ts.
//
// CONVENTION: hand-rolled mulberry32 PRNG + PROPERTY_RUNS loop, NO fast-check.
// ===========================================================================

// Production-shaped fake Superstate, copied from tableBackRelationRuntime.test.ts:
// pathsIndex carries each row's inlinks (reverse-link index) + metadata.property,
// and spaceManager.resolvePath emulates the Notidian-e1u link index.
const makeSuperstate = (
  rows: Record<string, { inlinks?: string[]; property?: Record<string, any> }>
) => {
  const pathsIndex = new Map(
    Object.entries(rows).map(([path, { inlinks, property }]) => [
      path,
      { inlinks: inlinks ?? [], metadata: { property: property ?? {} } },
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

const BACK_FNS: readonly (string | undefined)[] = [
  undefined, // default -> "list"
  "list",
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

describe("computeRowBackRelation — adversarial runtime characterization", () => {
  const superstate = makeSuperstate({
    "Projects/Alpha.md": {
      inlinks: ["Tasks/A.md", "Tasks/B.md", "Notes/Mention.md"],
      property: {},
    },
    "Tasks/A.md": { property: { project: "[[Alpha]]", hours: 3 } },
    "Tasks/B.md": { property: { project: "[[Projects/Alpha]]", hours: 5 } },
    "Notes/Mention.md": { property: { body: "see [[Projects/Alpha]]" } },
  });

  it("lists back-linking rows by basename and bare-path wikilink", () => {
    expect(
      computeRowBackRelation(superstate, "Projects/Alpha.md", {
        relationProperty: "project",
        fn: "list",
      })
    ).toBe("A, B");
  });

  it("default fn is list (omitted fn)", () => {
    expect(
      computeRowBackRelation(superstate, "Projects/Alpha.md", {
        relationProperty: "project",
      })
    ).toBe("A, B");
  });

  it("excludes inlinks whose relation property does not resolve back", () => {
    expect(
      computeRowBackRelation(superstate, "Projects/Alpha.md", {
        relationProperty: "project",
        fn: "count",
      })
    ).toBe("2");
  });

  it("aggregates a field over the back-relation set", () => {
    expect(
      computeRowBackRelation(superstate, "Projects/Alpha.md", {
        relationProperty: "project",
        fn: "sum",
        field: "hours",
      })
    ).toBe("8");
  });

  it("missing config / empty targetPath -> empty string (guard)", () => {
    expect(
      computeRowBackRelation(superstate, "Projects/Alpha.md", {
        relationProperty: "",
      })
    ).toBe("");
    expect(
      computeRowBackRelation(superstate, "", {
        relationProperty: "project",
      })
    ).toBe("");
    // null/undefined config -> guarded by optional chaining (?.relationProperty)
    expect(
      computeRowBackRelation(superstate, "Projects/Alpha.md", null as any)
    ).toBe("");
    expect(
      computeRowBackRelation(
        superstate,
        "Projects/Alpha.md",
        undefined as any
      )
    ).toBe("");
  });

  it("target with no inlinks entry -> empty (missing pathsIndex row)", () => {
    expect(
      computeRowBackRelation(superstate, "Projects/DoesNotExist.md", {
        relationProperty: "project",
        fn: "list",
      })
    ).toBe("");
  });

  it("dangling inlink (path in inlinks but not in pathsIndex) does not crash", () => {
    const ss = makeSuperstate({
      "T.md": { inlinks: ["Ghost.md", "Real.md"], property: {} },
      "Real.md": { property: { rel: "[[T]]", n: 4 } },
      // Ghost.md intentionally absent from pathsIndex.
    });
    expect(
      computeRowBackRelation(ss, "T.md", { relationProperty: "rel", fn: "sum", field: "n" })
    ).toBe("4");
    expect(
      computeRowBackRelation(ss, "T.md", { relationProperty: "rel", fn: "list" })
    ).toBe("Real");
  });

  it("self-inlink is ignored (a row that links to itself is not its own back-relation)", () => {
    const ss = makeSuperstate({
      "Self.md": { inlinks: ["Self.md", "Other.md"], property: { rel: "[[Self]]" } },
      "Other.md": { property: { rel: "[[Self]]" } },
    });
    // Only Other counts back; Self is excluded by the filterBackRelations self-guard.
    expect(
      computeRowBackRelation(ss, "Self.md", { relationProperty: "rel", fn: "list" })
    ).toBe("Other");
  });

  // --- property runs -------------------------------------------------------
  // Build a random vault: a target with a random inlink set, where each inlink
  // may (a) resolve back via the relation property, (b) carry a different/garbage
  // relation value, (c) be a dangling inlink (absent from pathsIndex), or
  // (d) link to itself.
  const RELATION_ATOMS = (target: string): readonly unknown[] => [
    `[[${target.replace(/\.md$/, "")}]]`, // resolves back (bare path)
    `[[${target.replace(/\.md$/, "").split("/").pop()}]]`, // basename-only back-link
    "[[Somewhere/Else]]", // does not resolve back
    "[[Ghost]]",
    "",
    null,
    undefined,
    42,
    { x: 1 },
    ["[[Else]]"],
  ];
  const FIELD_ATOMS: readonly unknown[] = [1, 5, -3, "2", "nope", "", true, null];

  const buildVault = (rng: () => number) => {
    const target = "Targets/T.md";
    const inlinkCount = randInt(rng, 0, 6);
    const rows: Record<
      string,
      { inlinks?: string[]; property?: Record<string, any> }
    > = {};
    const inlinks: string[] = [];
    for (let i = 0; i < inlinkCount; i++) {
      const path = `In/I${i}.md`;
      inlinks.push(path);
      // 20% chance the inlink is dangling (not added to pathsIndex).
      if (rng() < 0.2) continue;
      rows[path] = {
        property: {
          rel: pick(rng, RELATION_ATOMS(target)),
          n: pick(rng, FIELD_ATOMS),
        },
      };
    }
    // Occasionally add a self-inlink.
    if (rng() < 0.3) inlinks.push(target);
    rows[target] = { inlinks, property: { rel: `[[${target}]]` } };
    return { ss: makeSuperstate(rows), target };
  };

  it("TOTAL: never throws for any (target, fn, field) over a random vault", () => {
    const rng = makeRng(0xbac001);
    for (let run = 0; run < PROPERTY_RUNS; run++) {
      const { ss, target } = buildVault(rng);
      expect(() =>
        computeRowBackRelation(ss, target, {
          relationProperty: pick(rng, ["rel", "missing", ""]),
          fn: pick(rng, BACK_FNS),
          field: pick(rng, ["n", "missing", undefined]),
        })
      ).not.toThrow();
    }
  });

  it("always returns a string", () => {
    const rng = makeRng(0xbac002);
    for (let run = 0; run < PROPERTY_RUNS; run++) {
      const { ss, target } = buildVault(rng);
      const out = computeRowBackRelation(ss, target, {
        relationProperty: "rel",
        fn: pick(rng, BACK_FNS),
        field: "n",
      });
      expect(typeof out).toBe("string");
    }
  });

  it("STABLE: same inputs -> identical output", () => {
    const rng = makeRng(0xbac003);
    for (let run = 0; run < PROPERTY_RUNS; run++) {
      const { ss, target } = buildVault(rng);
      const config = {
        relationProperty: "rel",
        fn: pick(rng, BACK_FNS),
        field: "n",
      };
      const a = computeRowBackRelation(ss, target, config);
      const b = computeRowBackRelation(ss, target, config);
      expect(a).toBe(b);
    }
  });

  it("READ-ONLY: never mutates targetPath, config, or pathsIndex", () => {
    const rng = makeRng(0xbac004);
    for (let run = 0; run < PROPERTY_RUNS; run++) {
      const { ss, target } = buildVault(rng);
      const config = {
        relationProperty: "rel",
        fn: pick(rng, BACK_FNS),
        field: "n",
      };
      const nanSafe = (_k: string, v: unknown) =>
        typeof v === "number" && Number.isNaN(v) ? "__NaN__" : v;
      const configBefore = JSON.stringify(config, nanSafe);
      const indexBefore = JSON.stringify(
        [...ss.pathsIndex.entries()],
        nanSafe
      );
      computeRowBackRelation(ss, target, config);
      expect(JSON.stringify(config, nanSafe)).toBe(configBefore);
      expect(JSON.stringify([...ss.pathsIndex.entries()], nanSafe)).toBe(
        indexBefore
      );
    }
  });

  it("count of the back-relation set is a non-negative integer string", () => {
    const rng = makeRng(0xbac005);
    for (let run = 0; run < PROPERTY_RUNS; run++) {
      const { ss, target } = buildVault(rng);
      const out = computeRowBackRelation(ss, target, {
        relationProperty: "rel",
        fn: "count",
      });
      expect(/^\d+$/.test(out)).toBe(true);
    }
  });

  it("EQUIVALENCE: the list fn never emits a self-title and stays within the resolved inlink set", () => {
    // Structural cross-check: every title in the list corresponds to an inlink
    // that is NOT the target itself.
    const rng = makeRng(0xbac006);
    for (let run = 0; run < PROPERTY_RUNS; run++) {
      const { ss, target } = buildVault(rng);
      const out = computeRowBackRelation(ss, target, {
        relationProperty: "rel",
        fn: "list",
      });
      const titles = out === "" ? [] : out.split(", ");
      const targetTitle = target.replace(/\.md$/, "").split("/").pop();
      expect(titles).not.toContain(targetTitle);
      // No duplicate titles (filterBackRelations dedupes paths).
      expect(titles.length).toBe(new Set(titles).size);
    }
  });
});
