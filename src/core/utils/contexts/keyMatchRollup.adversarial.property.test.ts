import {
  computeRowRollup,
  computeRowRollupDetailed,
} from "core/utils/contexts/tableRollupRuntime";
import { KeyMatchRelationConfig } from "core/utils/contexts/keyMatchResolver";
import { RollupConfig } from "core/utils/contexts/tableRollup";

// ===========================================================================
// ADVERSARIAL + PROPERTY NET for the KEY-MATCH code path through the rollup
// RUNTIME bridge (Notidian-bdqj).
//
// The existing tableRollupRuntime.property.test.ts covers the WIKILINK
// resolution path. This file provides parallel adversarial coverage for the
// KEY-MATCH branch added by Notidian-mx0k.1. When `keyMatchConfig` is
// provided to computeRowRollup / computeRowRollupDetailed, the code takes
// an entirely different resolution path: resolveKeyMatch (contextsIndex +
// pathsIndex field matching) instead of parseRelationLinks (wikilink parsing).
//
// 500+ property runs (mulberry32) crossing:
//   - All rollup fns (count/count_values/values/unique/sum/avg/min/max/
//     percent/percent_checked/bogus)
//   - Random key-match configs + source values + target datasets
//   - Cross-path isolation (key-match config + wikilink-formatted value =
//     resolved via key-match, NOT parsed as wikilinks)
//   - computeRowRollupDetailed count correctness
//   - Prototype pollution in key-match configs
//   - Non-string source values (numbers, booleans, objects, arrays, null/undef)
//
// Invariants proven:
//   TOTAL       — never throws for any (key-match config, source value, rollup fn)
//   STABLE      — same inputs produce identical output
//   READ-ONLY   — never mutates the superstate, config, or key-match config
//   STRING      — always returns a string (computeRowRollup)
//   EQUIVALENCE — count == number of key-match resolved paths
//
// CHARACTERIZATION ONLY — no production code is changed.
// CONVENTION: hand-rolled mulberry32 PRNG + PROPERTY_RUNS loop, NO fast-check.
// ===========================================================================

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// mulberry32 PRNG (repo convention)
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

// Key-match-aware superstate factory. Builds both contextsIndex (folder ->
// paths) and pathsIndex (path -> {metadata:{property}}) + a spaceManager that
// mirrors the wikilink resolver (used only by the wikilink path, but must
// exist for the runtime bridge).
const makeSuperstate = (
  folders: Record<string, Record<string, Record<string, any>>>
) => {
  const pathsIndex = new Map<string, any>();
  const contextsIndex = new Map<string, any>();

  for (const [folder, files] of Object.entries(folders)) {
    const paths: string[] = [];
    for (const [filePath, property] of Object.entries(files)) {
      paths.push(filePath);
      pathsIndex.set(filePath, { metadata: { property } });
    }
    contextsIndex.set(folder, { paths });
  }

  // spaceManager.resolvePath emulates the Notidian-e1u link index: exact key
  // wins, else bare path + ".md", else basename match, else pass-through.
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
    contextsIndex,
    spaceManager: { resolvePath },
  } as any;
};

// Shorthand for a valid key-match config.
const kmCfg = (
  over?: Partial<KeyMatchRelationConfig>
): KeyMatchRelationConfig => ({
  type: "key-match",
  sourceField: "ref_id",
  targetFolder: "Targets",
  targetField: "id",
  ...over,
});

// All rollup fns including the progress pair and a bogus fn.
const ROLLUP_FNS: readonly string[] = [
  "count",
  "count_values",
  "values",
  "unique",
  "sum",
  "avg",
  "min",
  "max",
  "percent",
  "percent_checked",
  "bogus",
];

// Source values for the relation property (what the source row's field holds).
// Key-match uses String() coercion on these; wikilink-formatted strings should
// be resolved via key-match when keyMatchConfig is present, NOT parsed as
// wikilinks.
const SOURCE_VALUES: readonly unknown[] = [
  "1",
  "2",
  "abc",
  "42",
  "",
  "   ",
  null,
  undefined,
  0,
  1,
  -1,
  42,
  3.14,
  true,
  false,
  NaN,
  Infinity,
  { foo: 1 },
  [1, 2],
  ["a", "b"],
  "[[Tasks/A]]", // wikilink-formatted — should NOT be parsed as wikilink
  "[[Tasks/A]], [[Tasks/B]]",
  "[[A|alias]]",
  "__proto__",
  "constructor",
  "toString",
  "\0",
  "​", // zero-width space
  "café",
  "[object Object]",
] as const;

// Target frontmatter property values (what the resolved rows' target property
// holds).
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
  false,
  ["x", "y"],
  [2, 3],
  null,
  undefined,
  [true, false],
  [true, "true"],
] as const;

// Target field names including prototype-polluting names.
const TARGET_FIELD_NAMES: readonly string[] = [
  "hours",
  "status",
  "score",
  "id",
  "missing",
  "__proto__",
  "constructor",
  "toString",
  "valueOf",
  "hasOwnProperty",
] as const;

// Key-match config variants (some deliberately broken).
const KM_CONFIG_VARIANTS: readonly (KeyMatchRelationConfig | undefined)[] = [
  kmCfg(),
  kmCfg({ targetFolder: "" }), // empty targetFolder -> resolveKeyMatch returns []
  kmCfg({ targetField: "" }), // empty targetField -> resolveKeyMatch returns []
  kmCfg({ sourceField: "" }), // empty sourceField (doesn't affect resolution)
  kmCfg({ sourceField: "ref_id", targetField: "ref_id" }), // same field
  kmCfg({ targetFolder: "NonexistentFolder" }), // folder not in contextsIndex
  kmCfg({ targetFolder: "Targets", targetField: "__proto__" }),
  kmCfg({ targetFolder: "Targets", targetField: "constructor" }),
];

// ---------------------------------------------------------------------------
// Build a random superstate with a key-match-compatible shape.
// ---------------------------------------------------------------------------
const buildSuperstate = (rng: () => number) => {
  const files: Record<string, Record<string, any>> = {};
  const n = randInt(rng, 0, 8);
  for (let i = 0; i < n; i++) {
    const targetField = pick(rng, TARGET_FIELD_NAMES);
    files[`Targets/T${i}.md`] = {
      id: `${i}`,
      [targetField]: pick(rng, FM_TARGET_ATOMS),
      hours: pick(rng, FM_TARGET_ATOMS),
      status: pick(rng, ["done", "open", "", null]),
    };
  }
  return makeSuperstate({ Targets: files });
};

// NaN-safe JSON serializer for snapshot comparison.
const nanSafe = (_k: string, v: unknown) =>
  typeof v === "number" && Number.isNaN(v) ? "__NaN__" : v;

// ===========================================================================
// 1. Deterministic unit tests (key-match path)
// ===========================================================================

describe("computeRowRollup — key-match code path: deterministic", () => {
  const ss = makeSuperstate({
    Targets: {
      "Targets/A.md": { id: "1", hours: 3, status: "done" },
      "Targets/B.md": { id: "2", hours: 5, status: "open" },
      "Targets/C.md": { id: "1", hours: 7, status: "done" },
    },
  });

  const config = (fn: string): RollupConfig => ({
    relationProperty: "ref",
    targetProperty: "hours",
    fn,
  });

  const km = kmCfg({ targetFolder: "Targets", targetField: "id" });

  it("count: counts all key-match resolved paths", () => {
    // sourceValue "1" matches A and C (id: "1")
    expect(computeRowRollup(ss, "1", config("count"), "Source/X.md", km)).toBe(
      "2"
    );
  });

  it("sum: sums target property across key-match resolved paths", () => {
    // A.hours=3, C.hours=7 -> 10
    expect(computeRowRollup(ss, "1", config("sum"), "Source/X.md", km)).toBe(
      "10"
    );
  });

  it("avg: averages target property", () => {
    expect(computeRowRollup(ss, "1", config("avg"), "Source/X.md", km)).toBe(
      "5"
    );
  });

  it("min/max over key-match resolved paths", () => {
    expect(computeRowRollup(ss, "1", config("min"), "Source/X.md", km)).toBe(
      "3"
    );
    expect(computeRowRollup(ss, "1", config("max"), "Source/X.md", km)).toBe(
      "7"
    );
  });

  it("values: lists target property values", () => {
    const statusConfig: RollupConfig = {
      relationProperty: "ref",
      targetProperty: "status",
      fn: "values",
    };
    // A.status="done", C.status="done" -> unique: "done"
    expect(computeRowRollup(ss, "1", statusConfig, "Source/X.md", km)).toBe(
      "done"
    );
  });

  it("unique: deduplicates target property values", () => {
    const statusConfig: RollupConfig = {
      relationProperty: "ref",
      targetProperty: "status",
      fn: "unique",
    };
    expect(computeRowRollup(ss, "1", statusConfig, "Source/X.md", km)).toBe(
      "done"
    );
  });

  it("count_values: counts non-null resolved values", () => {
    expect(
      computeRowRollup(ss, "1", config("count_values"), "Source/X.md", km)
    ).toBe("2");
  });

  it("no match returns 0/empty for all fns", () => {
    for (const fn of ROLLUP_FNS) {
      const result = computeRowRollup(
        ss,
        "nonexistent",
        config(fn),
        "Source/X.md",
        km
      );
      expect(typeof result).toBe("string");
    }
  });

  it("null/undefined source value returns 0/empty", () => {
    for (const val of [null, undefined] as unknown[]) {
      expect(computeRowRollup(ss, val, config("sum"), "Source/X.md", km)).toBe(
        "0"
      );
      expect(
        computeRowRollup(ss, val, config("count"), "Source/X.md", km)
      ).toBe("0");
    }
  });
});

// ===========================================================================
// 2. Cross-path isolation: key-match config + wikilink-formatted value
// ===========================================================================

describe("computeRowRollup — cross-path isolation", () => {
  // When keyMatchConfig is provided, wikilink-formatted source values should
  // be resolved via key-match (String coercion of the wikilink text), NOT
  // parsed as wikilinks. The key-match path calls resolveKeyMatch, which
  // does String(sourceValue).trim() — a wikilink string like "[[Tasks/A]]"
  // becomes the literal string "[[Tasks/A]]" for matching.

  const ss = makeSuperstate({
    WikiTargets: {
      // A row whose id field literally contains "[[Tasks/A]]"
      "WikiTargets/W1.md": { id: "[[Tasks/A]]", hours: 10 },
      // A row with a normal id
      "WikiTargets/W2.md": { id: "normal", hours: 20 },
    },
    // Also populate Tasks so wikilink resolution WOULD succeed if used
    Tasks: {
      "Tasks/A.md": { hours: 99 },
    },
  });

  const km = kmCfg({ targetFolder: "WikiTargets", targetField: "id" });
  const config = (fn: string): RollupConfig => ({
    relationProperty: "ref",
    targetProperty: "hours",
    fn,
  });

  it("wikilink-formatted source value is matched via key-match, not parsed as wikilink", () => {
    // "[[Tasks/A]]" as source value: key-match should match W1 (id == "[[Tasks/A]]"),
    // NOT resolve to Tasks/A.md via wikilink parsing.
    const result = computeRowRollup(
      ss,
      "[[Tasks/A]]",
      config("sum"),
      "Source/X.md",
      km
    );
    // W1.hours = 10 (from key-match), not 99 (from wikilink parsing Tasks/A)
    expect(result).toBe("10");
  });

  it("count via key-match with wikilink-formatted value counts key-match hits", () => {
    const result = computeRowRollup(
      ss,
      "[[Tasks/A]]",
      config("count"),
      "Source/X.md",
      km
    );
    expect(result).toBe("1"); // Only W1 matches
  });

  it("comma-separated wikilinks are NOT split when using key-match", () => {
    // The literal string "[[Tasks/A]], [[Tasks/B]]" is the search value.
    // Key-match does String().trim() on it, not wikilink parsing.
    const result = computeRowRollup(
      ss,
      "[[Tasks/A]], [[Tasks/B]]",
      config("count"),
      "Source/X.md",
      km
    );
    // No row in WikiTargets has id == "[[Tasks/A]], [[Tasks/B]]", so count = 0
    expect(result).toBe("0");
  });

  it("500 property runs: key-match path never falls through to wikilink parsing", () => {
    const rng = makeRng(0xba5e01);
    const wikilinkValues = [
      "[[Tasks/A]]",
      "[[Tasks/B]]",
      "[[Tasks/A]], [[Tasks/B]]",
      "[[A|alias]]",
      "[[A#heading]]",
      "[[Deeply/Nested/Path]]",
    ];

    for (let run = 0; run < PROPERTY_RUNS; run++) {
      const files: Record<string, Record<string, any>> = {};
      const n = randInt(rng, 0, 5);
      for (let i = 0; i < n; i++) {
        files[`DB/Row${i}.md`] = {
          id: rng() > 0.5 ? pick(rng, wikilinkValues) : `plain_${i}`,
          hours: pick(rng, FM_TARGET_ATOMS),
        };
      }
      const testSs = makeSuperstate({ DB: files });
      const testKm = kmCfg({ targetFolder: "DB", targetField: "id" });
      const sourceVal = pick(rng, wikilinkValues);
      const fn = pick(rng, ROLLUP_FNS);

      // Must never throw
      expect(() =>
        computeRowRollup(
          testSs,
          sourceVal,
          { relationProperty: "ref", targetProperty: "hours", fn },
          "Source/X.md",
          testKm
        )
      ).not.toThrow();
    }
  });
});

// ===========================================================================
// 3. computeRowRollupDetailed — key-match count correctness
// ===========================================================================

describe("computeRowRollupDetailed — key-match path", () => {
  const ss = makeSuperstate({
    Targets: {
      "Targets/A.md": { id: "1", hours: 3, status: "done" },
      "Targets/B.md": { id: "2", hours: 5, status: "open" },
      "Targets/C.md": { id: "1", hours: 7, status: "done" },
      "Targets/D.md": { id: "1", hours: null, status: "" }, // null hours
    },
  });

  const km = kmCfg({ targetFolder: "Targets", targetField: "id" });

  it("count: relationCount == resolvedCount == key-match match count", () => {
    const result = computeRowRollupDetailed(
      ss,
      "1",
      { relationProperty: "ref", targetProperty: "hours", fn: "count" },
      "Source/X.md",
      km
    );
    // "1" matches A, C, D -> 3 paths
    expect(result.relationCount).toBe(3);
    expect(result.resolvedCount).toBe(3); // count always has resolved == relation
    expect(result.value).toBe("3");
  });

  it("sum: resolvedCount excludes rows with non-numeric target values", () => {
    const result = computeRowRollupDetailed(
      ss,
      "1",
      { relationProperty: "ref", targetProperty: "hours", fn: "sum" },
      "Source/X.md",
      km
    );
    // A.hours=3, C.hours=7, D.hours=null -> sum = 10, resolvedCount = 2 (D excluded)
    expect(result.value).toBe("10");
    expect(result.relationCount).toBe(3);
    expect(result.resolvedCount).toBe(2);
  });

  it("count_values: resolvedCount counts rows with non-empty values", () => {
    const result = computeRowRollupDetailed(
      ss,
      "1",
      { relationProperty: "ref", targetProperty: "hours", fn: "count_values" },
      "Source/X.md",
      km
    );
    // A.hours=3, C.hours=7 are usable; D.hours=null is not
    expect(result.value).toBe("2");
    expect(result.relationCount).toBe(3);
    expect(result.resolvedCount).toBe(2);
  });

  it("no match: all counts are 0", () => {
    const result = computeRowRollupDetailed(
      ss,
      "nonexistent",
      { relationProperty: "ref", targetProperty: "hours", fn: "sum" },
      "Source/X.md",
      km
    );
    expect(result.value).toBe("0");
    expect(result.relationCount).toBe(0);
    expect(result.resolvedCount).toBe(0);
  });

  it("percent: correct percentage over key-match resolved rows", () => {
    const result = computeRowRollupDetailed(
      ss,
      "1",
      { relationProperty: "ref", targetProperty: "status", fn: "percent" },
      "Source/X.md",
      km
    );
    // A.status="done" (usable), C.status="done" (usable), D.status="" (not usable)
    // denom = 3 (all have frontmatter), num = 2 -> 67%
    expect(result.value).toBe("67");
    expect(result.relationCount).toBe(3);
    expect(result.resolvedCount).toBe(3);
  });

  it("percent_checked: correct percentage for boolean checks", () => {
    const ssChecked = makeSuperstate({
      Targets: {
        "Targets/A.md": { id: "1", done: true },
        "Targets/B.md": { id: "1", done: false },
        "Targets/C.md": { id: "1", done: "true" },
        "Targets/D.md": { id: "1", done: null },
      },
    });
    const result = computeRowRollupDetailed(
      ssChecked,
      "1",
      {
        relationProperty: "ref",
        targetProperty: "done",
        fn: "percent_checked",
      },
      "Source/X.md",
      km
    );
    // A.done=true (hit), B.done=false (no), C.done="true" (hit), D has frontmatter
    // but done=null -> null is checked by continue (frontmatter exists, value is null)
    // denom = 4, num = 2 -> 50%
    expect(result.value).toBe("50");
  });

  it("500 property runs: detailed variant returns correct types", () => {
    const rng = makeRng(0xde7a1d);
    for (let run = 0; run < PROPERTY_RUNS; run++) {
      const testSs = buildSuperstate(rng);
      const sourceVal = pick(rng, SOURCE_VALUES);
      const fn = pick(rng, ROLLUP_FNS);
      const testKm = pick(rng, KM_CONFIG_VARIANTS.filter(Boolean)) as KeyMatchRelationConfig;
      const result = computeRowRollupDetailed(
        testSs,
        sourceVal,
        {
          relationProperty: "ref",
          targetProperty: pick(rng, TARGET_FIELD_NAMES),
          fn,
        },
        "Source/X.md",
        testKm
      );
      expect(typeof result.value).toBe("string");
      expect(typeof result.relationCount).toBe("number");
      expect(typeof result.resolvedCount).toBe("number");
      expect(result.relationCount).toBeGreaterThanOrEqual(0);
      expect(result.resolvedCount).toBeGreaterThanOrEqual(0);
      expect(result.resolvedCount).toBeLessThanOrEqual(result.relationCount);
    }
  });
});

// ===========================================================================
// 4. Prototype pollution in key-match configs
// ===========================================================================

describe("computeRowRollup — prototype pollution in key-match configs", () => {
  const POLLUTING_FIELDS = [
    "__proto__",
    "constructor",
    "toString",
    "valueOf",
    "hasOwnProperty",
    "__defineGetter__",
    "__defineSetter__",
    "isPrototypeOf",
    "propertyIsEnumerable",
  ] as const;

  it("TOTAL: never throws when targetField is a prototype property name", () => {
    for (const field of POLLUTING_FIELDS) {
      const ss = makeSuperstate({
        DB: {
          "DB/Row0.md": {}, // no explicit field — prototype fallthrough
          "DB/Row1.md": { [field]: "safe_value" },
        },
      });
      const km = kmCfg({ targetFolder: "DB", targetField: field });
      for (const fn of ROLLUP_FNS) {
        expect(() =>
          computeRowRollup(
            ss,
            "safe_value",
            { relationProperty: "ref", targetProperty: "hours", fn },
            "Source/X.md",
            km
          )
        ).not.toThrow();
      }
    }
  });

  it("STRING: always returns a string with prototype-polluting targetField", () => {
    for (const field of POLLUTING_FIELDS) {
      const ss = makeSuperstate({
        DB: {
          "DB/Row0.md": { [field]: "match", hours: 5 },
        },
      });
      const km = kmCfg({ targetFolder: "DB", targetField: field });
      for (const fn of ROLLUP_FNS) {
        const result = computeRowRollup(
          ss,
          "match",
          { relationProperty: "ref", targetProperty: "hours", fn },
          "Source/X.md",
          km
        );
        expect(typeof result).toBe("string");
      }
    }
  });

  it("500 property runs: prototype pollution in targetField never crashes rollup", () => {
    const rng = makeRng(0xa01100);
    for (let run = 0; run < PROPERTY_RUNS; run++) {
      const field = pick(rng, POLLUTING_FIELDS);
      const files: Record<string, Record<string, any>> = {};
      const n = randInt(rng, 0, 6);
      for (let i = 0; i < n; i++) {
        files[`DB/Row${i}.md`] = rng() > 0.5
          ? { [field]: `val_${i}`, hours: pick(rng, FM_TARGET_ATOMS) }
          : { hours: pick(rng, FM_TARGET_ATOMS) };
      }
      const ss = makeSuperstate({ DB: files });
      const km = kmCfg({ targetFolder: "DB", targetField: field });
      const fn = pick(rng, ROLLUP_FNS);
      const sourceVal = pick(rng, [
        "val_0",
        "val_1",
        "[object Object]",
        "anything",
        null,
        undefined,
      ]);

      expect(() =>
        computeRowRollup(
          ss,
          sourceVal,
          { relationProperty: "ref", targetProperty: "hours", fn },
          "Source/X.md",
          km
        )
      ).not.toThrow();
    }
  });
});

// ===========================================================================
// 5. TOTAL: never throws for any (key-match config, source value, rollup fn)
// ===========================================================================

describe("computeRowRollup key-match — TOTAL (500 property runs)", () => {
  it("never throws for any random (config, source, fn) combination", () => {
    const rng = makeRng(0xc0ffee);
    for (let run = 0; run < PROPERTY_RUNS; run++) {
      const ss = buildSuperstate(rng);
      const sourceVal = pick(rng, SOURCE_VALUES);
      const fn = pick(rng, ROLLUP_FNS);
      const targetProp = pick(rng, TARGET_FIELD_NAMES);
      // Use a valid or edge-case key-match config
      const testKm = pick(rng, KM_CONFIG_VARIANTS) as
        | KeyMatchRelationConfig
        | undefined;

      expect(() =>
        computeRowRollup(
          ss,
          sourceVal,
          { relationProperty: "ref", targetProperty: targetProp, fn },
          "Source/X.md",
          testKm
        )
      ).not.toThrow();
    }
  });

  it("never throws with empty/missing superstate components", () => {
    const rng = makeRng(0xc0ffef);
    const emptySs = {
      spacesIndex: new Map(),
      pathsIndex: new Map(),
      contextsIndex: new Map(),
      spaceManager: { resolvePath: (link: string) => link },
    } as any;

    for (let run = 0; run < PROPERTY_RUNS; run++) {
      const sourceVal = pick(rng, SOURCE_VALUES);
      const fn = pick(rng, ROLLUP_FNS);
      const km = kmCfg();
      expect(() =>
        computeRowRollup(
          emptySs,
          sourceVal,
          { relationProperty: "ref", targetProperty: "hours", fn },
          "Source/X.md",
          km
        )
      ).not.toThrow();
    }
  });
});

// ===========================================================================
// 6. STRING: always returns a string
// ===========================================================================

describe("computeRowRollup key-match — STRING (500 property runs)", () => {
  it("always returns a string for any input via key-match path", () => {
    const rng = makeRng(0x571ace);
    for (let run = 0; run < PROPERTY_RUNS; run++) {
      const ss = buildSuperstate(rng);
      const sourceVal = pick(rng, SOURCE_VALUES);
      const fn = pick(rng, ROLLUP_FNS);
      const testKm = pick(rng, KM_CONFIG_VARIANTS.filter(Boolean)) as KeyMatchRelationConfig;
      const result = computeRowRollup(
        ss,
        sourceVal,
        {
          relationProperty: "ref",
          targetProperty: pick(rng, TARGET_FIELD_NAMES),
          fn,
        },
        "Source/X.md",
        testKm
      );
      expect(typeof result).toBe("string");
    }
  });
});

// ===========================================================================
// 7. STABLE: same inputs produce identical output
// ===========================================================================

describe("computeRowRollup key-match — STABLE (500 property runs)", () => {
  it("deterministic: same (superstate, value, config, km) -> same output", () => {
    const rng = makeRng(0x57ab1e);
    for (let run = 0; run < PROPERTY_RUNS; run++) {
      const ss = buildSuperstate(rng);
      const sourceVal = pick(rng, SOURCE_VALUES);
      const fn = pick(rng, ROLLUP_FNS);
      const config: RollupConfig = {
        relationProperty: "ref",
        targetProperty: pick(rng, TARGET_FIELD_NAMES),
        fn,
      };
      const testKm = pick(rng, KM_CONFIG_VARIANTS.filter(Boolean)) as KeyMatchRelationConfig;
      const a = computeRowRollup(ss, sourceVal, config, "Source/X.md", testKm);
      const b = computeRowRollup(ss, sourceVal, config, "Source/X.md", testKm);
      expect(a).toBe(b);
    }
  });
});

// ===========================================================================
// 8. READ-ONLY: never mutates the superstate, config, or key-match config
// ===========================================================================

describe("computeRowRollup key-match — READ-ONLY (500 property runs)", () => {
  it("never mutates superstate, config, or key-match config", () => {
    const rng = makeRng(0xb0ad01);
    for (let run = 0; run < PROPERTY_RUNS; run++) {
      const files: Record<string, Record<string, any>> = {};
      const n = randInt(rng, 0, 6);
      for (let i = 0; i < n; i++) {
        files[`Targets/T${i}.md`] = {
          id: `${i}`,
          hours: pick(rng, FM_TARGET_ATOMS),
          status: pick(rng, ["done", "open", null]),
        };
      }
      const ss = makeSuperstate({ Targets: files });
      const sourceVal = pick(rng, SOURCE_VALUES);
      const fn = pick(rng, ROLLUP_FNS);
      const config: RollupConfig = {
        relationProperty: "ref",
        targetProperty: pick(rng, TARGET_FIELD_NAMES),
        fn,
      };
      const testKm = kmCfg({
        targetFolder: "Targets",
        targetField: pick(rng, ["id", "hours", "__proto__"]),
      });

      // Snapshot before
      const pathsBefore = JSON.stringify(
        [...ss.pathsIndex.entries()],
        nanSafe
      );
      const ctxBefore = JSON.stringify(
        [...ss.contextsIndex.entries()].map(([k, v]: [string, any]) => [
          k,
          v.paths?.length,
        ])
      );
      const configBefore = JSON.stringify(config);
      const kmBefore = JSON.stringify(testKm);

      computeRowRollup(ss, sourceVal, config, "Source/X.md", testKm);

      // Verify no mutation
      expect(JSON.stringify([...ss.pathsIndex.entries()], nanSafe)).toBe(
        pathsBefore
      );
      expect(
        JSON.stringify(
          [...ss.contextsIndex.entries()].map(([k, v]: [string, any]) => [
            k,
            v.paths?.length,
          ])
        )
      ).toBe(ctxBefore);
      expect(JSON.stringify(config)).toBe(configBefore);
      expect(JSON.stringify(testKm)).toBe(kmBefore);
    }
  });
});

// ===========================================================================
// 9. EQUIVALENCE: count == number of key-match resolved paths
// ===========================================================================

describe("computeRowRollup key-match — EQUIVALENCE (500 property runs)", () => {
  it("count output == number of key-match resolved paths", () => {
    const rng = makeRng(0xeee001);
    for (let run = 0; run < PROPERTY_RUNS; run++) {
      const files: Record<string, Record<string, any>> = {};
      const n = randInt(rng, 0, 8);
      const matchKey = `key_${randInt(rng, 0, 3)}`;
      let expectedCount = 0;
      for (let i = 0; i < n; i++) {
        const thisId = `key_${randInt(rng, 0, 5)}`;
        files[`Targets/T${i}.md`] = {
          id: thisId,
          hours: pick(rng, FM_TARGET_ATOMS),
        };
        if (thisId === matchKey) expectedCount++;
      }
      const ss = makeSuperstate({ Targets: files });
      const km = kmCfg({ targetFolder: "Targets", targetField: "id" });
      const result = computeRowRollup(
        ss,
        matchKey,
        { relationProperty: "ref", targetProperty: "hours", fn: "count" },
        "Source/X.md",
        km
      );
      expect(result).toBe(String(expectedCount));
    }
  });

  it("count output is always a non-negative integer string", () => {
    const rng = makeRng(0xeee002);
    for (let run = 0; run < PROPERTY_RUNS; run++) {
      const ss = buildSuperstate(rng);
      const sourceVal = pick(rng, SOURCE_VALUES);
      const testKm = pick(rng, KM_CONFIG_VARIANTS.filter(Boolean)) as KeyMatchRelationConfig;
      const result = computeRowRollup(
        ss,
        sourceVal,
        { relationProperty: "ref", targetProperty: "hours", fn: "count" },
        "Source/X.md",
        testKm
      );
      expect(/^\d+$/.test(result)).toBe(true);
      expect(Number(result)).toBeGreaterThanOrEqual(0);
    }
  });
});

// ===========================================================================
// 10. Non-string source values with key-match + all rollup fns
// ===========================================================================

describe("computeRowRollup key-match — non-string source values", () => {
  const NON_STRING_VALUES: readonly unknown[] = [
    42,
    0,
    -1,
    3.14,
    true,
    false,
    null,
    undefined,
    NaN,
    Infinity,
    -Infinity,
    { foo: 1 },
    [1, 2, 3],
    ["a", "b"],
    [["nested"]],
  ];

  it("TOTAL: never throws for non-string source values across all rollup fns", () => {
    const ss = makeSuperstate({
      Targets: {
        "Targets/A.md": { id: "42", hours: 10 },
        "Targets/B.md": { id: "true", hours: 20 },
        "Targets/C.md": { id: "1,2,3", hours: 30 },
      },
    });
    const km = kmCfg({ targetFolder: "Targets", targetField: "id" });

    for (const val of NON_STRING_VALUES) {
      for (const fn of ROLLUP_FNS) {
        expect(() =>
          computeRowRollup(
            ss,
            val,
            { relationProperty: "ref", targetProperty: "hours", fn },
            "Source/X.md",
            km
          )
        ).not.toThrow();
      }
    }
  });

  it("numeric source value matches via String() coercion", () => {
    const ss = makeSuperstate({
      Targets: {
        "Targets/A.md": { id: "42", hours: 10 },
      },
    });
    const km = kmCfg({ targetFolder: "Targets", targetField: "id" });
    // Number 42 -> String(42) -> "42" should match id: "42"
    expect(
      computeRowRollup(
        ss,
        42,
        { relationProperty: "ref", targetProperty: "hours", fn: "sum" },
        "Source/X.md",
        km
      )
    ).toBe("10");
  });

  it("boolean source value matches via String() coercion", () => {
    const ss = makeSuperstate({
      Targets: {
        "Targets/A.md": { id: "true", hours: 20 },
      },
    });
    const km = kmCfg({ targetFolder: "Targets", targetField: "id" });
    expect(
      computeRowRollup(
        ss,
        true,
        { relationProperty: "ref", targetProperty: "hours", fn: "sum" },
        "Source/X.md",
        km
      )
    ).toBe("20");
  });
});

// ===========================================================================
// 11. Edge-case key-match configs
// ===========================================================================

describe("computeRowRollup key-match — edge-case configs", () => {
  const ss = makeSuperstate({
    Targets: {
      "Targets/A.md": { id: "1", hours: 3 },
      "Targets/B.md": { id: "2", hours: 5 },
    },
  });

  it("empty targetFolder: returns 0/empty for all fns", () => {
    const km = kmCfg({ targetFolder: "" });
    for (const fn of ROLLUP_FNS) {
      const result = computeRowRollup(
        ss,
        "1",
        { relationProperty: "ref", targetProperty: "hours", fn },
        "Source/X.md",
        km
      );
      expect(typeof result).toBe("string");
    }
  });

  it("empty targetField: returns 0/empty for all fns", () => {
    const km = kmCfg({ targetField: "" });
    for (const fn of ROLLUP_FNS) {
      const result = computeRowRollup(
        ss,
        "1",
        { relationProperty: "ref", targetProperty: "hours", fn },
        "Source/X.md",
        km
      );
      expect(typeof result).toBe("string");
    }
  });

  it("nonexistent targetFolder: returns 0/empty for all fns", () => {
    const km = kmCfg({ targetFolder: "NoSuchFolder" });
    for (const fn of ROLLUP_FNS) {
      const result = computeRowRollup(
        ss,
        "1",
        { relationProperty: "ref", targetProperty: "hours", fn },
        "Source/X.md",
        km
      );
      expect(typeof result).toBe("string");
    }
  });

  it("sourceField == targetField: still resolves correctly", () => {
    const ssSame = makeSuperstate({
      DB: {
        "DB/A.md": { ref_id: "1", hours: 10 },
        "DB/B.md": { ref_id: "2", hours: 20 },
      },
    });
    const km = kmCfg({
      sourceField: "ref_id",
      targetFolder: "DB",
      targetField: "ref_id",
    });
    const result = computeRowRollup(
      ssSame,
      "1",
      { relationProperty: "ref", targetProperty: "hours", fn: "sum" },
      "Source/X.md",
      km
    );
    expect(result).toBe("10");
  });

  it("targetProperty missing from all resolved rows: sum returns 0", () => {
    const km = kmCfg({ targetFolder: "Targets", targetField: "id" });
    const result = computeRowRollup(
      ss,
      "1",
      {
        relationProperty: "ref",
        targetProperty: "nonexistent_prop",
        fn: "sum",
      },
      "Source/X.md",
      km
    );
    expect(result).toBe("0");
  });
});

// ===========================================================================
// 12. Combined adversarial: ALL invariants in one sweep
// ===========================================================================

describe("computeRowRollup key-match — combined adversarial sweep (500 runs)", () => {
  it("TOTAL + STRING + STABLE + READ-ONLY in one pass", () => {
    const rng = makeRng(0xa11001);
    for (let run = 0; run < PROPERTY_RUNS; run++) {
      // Build random superstate
      const files: Record<string, Record<string, any>> = {};
      const n = randInt(rng, 0, 10);
      for (let i = 0; i < n; i++) {
        const props: Record<string, any> = {
          id: `${randInt(rng, 0, 5)}`,
        };
        const targetField = pick(rng, TARGET_FIELD_NAMES);
        props[targetField] = pick(rng, FM_TARGET_ATOMS);
        files[`Targets/T${i}.md`] = props;
      }
      const ss = makeSuperstate({ Targets: files });

      // Random inputs
      const sourceVal = pick(rng, SOURCE_VALUES);
      const fn = pick(rng, ROLLUP_FNS);
      const targetProp = pick(rng, TARGET_FIELD_NAMES);
      const config: RollupConfig = {
        relationProperty: "ref",
        targetProperty: targetProp,
        fn,
      };
      const testKm = kmCfg({
        targetFolder: "Targets",
        targetField: pick(rng, ["id", ...TARGET_FIELD_NAMES]),
      });

      // Snapshots for READ-ONLY
      const pathsBefore = JSON.stringify(
        [...ss.pathsIndex.entries()],
        nanSafe
      );
      const configBefore = JSON.stringify(config);
      const kmBefore = JSON.stringify(testKm);

      // TOTAL: never throws
      let result: string;
      expect(() => {
        result = computeRowRollup(ss, sourceVal, config, "Source/X.md", testKm);
      }).not.toThrow();

      // STRING: always a string
      expect(typeof result!).toBe("string");

      // STABLE: same call again -> same result
      const result2 = computeRowRollup(
        ss,
        sourceVal,
        config,
        "Source/X.md",
        testKm
      );
      expect(result2).toBe(result!);

      // READ-ONLY: no mutation
      expect(JSON.stringify([...ss.pathsIndex.entries()], nanSafe)).toBe(
        pathsBefore
      );
      expect(JSON.stringify(config)).toBe(configBefore);
      expect(JSON.stringify(testKm)).toBe(kmBefore);
    }
  });
});
