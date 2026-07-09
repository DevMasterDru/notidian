import { SpaceProperty, SpaceTable } from "shared/types/mdb";
import {
  ApiValueWriteTarget,
  apiValueWriteTarget,
  notidianPropertySource,
} from "../properties/propertyAuthority";
import { frontmatterPropertySource } from "../properties/allProperties";
import { apiFieldWriteTarget, resolveApiFieldColumn } from "./apiValueWrite";

// ===========================================================================
// ADVERSARIAL NET for the authority-partitioned API value-write gate
// (resolveApiFieldColumn / apiFieldWriteTarget, apiValueWrite.ts — bd
// Notidian-9wzv / Notidian-1da, ADR 0001/0014/0017).
//
// apiValueWrite.ts is the PURE authority gate that decides WHERE a single
// programmatic field write (api.context.update / api.path.setProperty) lands:
// the file's frontmatter (visible, portable) vs the Notidian context MDB
// (hidden, durable). The authority-partition invariant (ADR 0001/0017) is that
// durable MDB ownership must be EXPLICIT (`source: "notidian"` or a
// context-only type) — file-backed metadata must never silently flip into the
// hidden store. The existing apiValueWrite.test.ts is an EXAMPLE-based suite;
// this file is its adversarial companion, the same convention the other
// safety-critical pure surfaces here carry (validateRow.adversarial,
// typeProfile.adversarial, ...). It pins the three cross-cutting invariants
// that must hold for ALL inputs:
//
//   (1) TOTALITY   — resolveApiFieldColumn / apiFieldWriteTarget NEVER throw on
//                    a malformed contextTables list: null/undefined table
//                    entries, `cols` undefined/null/not-an-array, `cols`
//                    holding null entries or entries lacking `.name`, an empty
//                    list. Every result is a well-typed SpaceProperty|undefined
//                    resp. an ApiValueWriteTarget ("frontmatter"|"context"|
//                    "skip").
//   (2) DETERMINISM— first-defining-table-wins is STABLE: the EARLIER table
//                    governs a same-field-name collision, and appending ANY
//                    further tables (defining, non-defining, or malformed)
//                    after the governing one never changes the resolved column
//                    or the routed target.
//   (3) FALLTHROUGH— when NO table defines the field, resolveApiFieldColumn
//                    returns undefined and apiFieldWriteTarget falls back to the
//                    verb's defaultTarget, for BOTH 'frontmatter' and 'context'
//                    defaults — asserted THROUGH the real
//                    propertyAuthority.apiValueWriteTarget (its logic is never
//                    re-implemented here). The strongest form of this is the
//                    COMPOSITION identity below, checked over every input:
//                      apiFieldWriteTarget(f, tables, d)
//                        === apiValueWriteTarget(resolveApiFieldColumn(f, tables), d)
//                    which ties the composed gate to the real authority gate
//                    for all inputs, malformed included.
//
// CONVENTION: hand-rolled mulberry32 PRNG + fixed seed + PROPERTY_RUNS loop, no
// fast-check (repo convention). Fixed seed => the suite is deterministic.
// ===========================================================================

// ---------------------------------------------------------------------------
// PRNG + sampling (repo convention: mulberry32)
// ---------------------------------------------------------------------------

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
type Rng = () => number;
const randInt = (rng: Rng, min: number, max: number): number =>
  min + Math.floor(rng() * (max - min + 1));
const pick = <T>(rng: Rng, pool: readonly T[]): T =>
  pool[randInt(rng, 0, pool.length - 1)];
const chance = (rng: Rng, p: number): boolean => rng() < p;

const BASE_SEED = 0x9c2f;
const PROPERTY_RUNS = 500;

const VALID_TARGETS: ReadonlySet<ApiValueWriteTarget> =
  new Set<ApiValueWriteTarget>(["frontmatter", "context", "skip"]);

// ---------------------------------------------------------------------------
// Column / table generators — a rich pool spanning every authority branch.
// ---------------------------------------------------------------------------

// Types with a native frontmatter form (source-less => "frontmatter").
const FRONTMATTER_TYPES = [
  "text",
  "password",
  "number",
  "boolean",
  "date",
  "option",
  "option-multi",
  "link",
  "image",
  "tags-multi",
] as const;
// Context-only types (no frontmatter form; source-less => "context").
const CONTEXT_ONLY_TYPES = ["context", "object", "flex", "super"] as const;
// Computed/read-only types (always "skip", even with a stray source marker).
const COMPUTED_TYPES = ["fileprop", "aggregate", "rollup", "backlink"] as const;
const ALL_TYPES = [
  ...FRONTMATTER_TYPES,
  ...CONTEXT_ONLY_TYPES,
  ...COMPUTED_TYPES,
] as const;
// `undefined` (ambiguous), the two real sources, and a stray/garbage marker.
// Explicitly typed: a bare `undefined` in an `as const` array widens to `any`
// under this repo's tsconfig (TS7005), so annotate the element type instead.
const SOURCES: ReadonlyArray<string | undefined> = [
  undefined,
  frontmatterPropertySource,
  notidianPropertySource,
  "bogus-source",
];

const FIELD_NAMES = [
  "status",
  "manual",
  "rel",
  "total",
  "title",
  "alpha",
  "beta",
] as const;
const DEFAULTS = ["frontmatter", "context"] as const;

const genColumn = (rng: Rng, name: string): SpaceProperty => {
  const type = pick(rng, ALL_TYPES);
  const source = pick(rng, SOURCES);
  const col: SpaceProperty = { name, type };
  if (source !== undefined) col.source = source;
  return col;
};

// A well-formed context table over a chosen subset of field names.
const genTable = (rng: Rng, names: readonly string[]): SpaceTable => ({
  schema: { id: "ctx", name: "ctx", type: "db" },
  cols: names.map((n) => genColumn(rng, n)),
  rows: [],
});

// A grab-bag of MALFORMED table entries — the exact totality classes the bead
// enumerates. Typed as SpaceTable through `unknown` so the production gate
// meets the hostile shapes a corrupt/legacy MDB or an external raw edit can
// hand it, without the test itself lying about the declared type.
const MALFORMED_TABLES: ReadonlyArray<SpaceTable | null | undefined> = [
  null,
  undefined,
  { schema: { id: "s", name: "s", type: "db" }, cols: undefined, rows: [] },
  { schema: { id: "s", name: "s", type: "db" }, cols: null, rows: [] },
  { cols: {} } as unknown as SpaceTable, // cols is a non-array object
  { cols: "not-an-array" } as unknown as SpaceTable,
  { cols: 5 } as unknown as SpaceTable,
  { cols: true } as unknown as SpaceTable,
  { cols: [null] } as unknown as SpaceTable, // null entry
  { cols: [undefined] } as unknown as SpaceTable, // undefined entry
  { cols: [{ type: "text" }] } as unknown as SpaceTable, // entry lacks .name
  { cols: [42, "x", { name: "status", type: "text" }] } as unknown as SpaceTable,
  {} as unknown as SpaceTable, // no cols key at all
];

// A random contextTables list mixing well-formed and malformed entries.
const genMixedTables = (
  rng: Rng
): ReadonlyArray<SpaceTable | null | undefined> => {
  const out: Array<SpaceTable | null | undefined> = [];
  const n = randInt(rng, 0, 5);
  for (let i = 0; i < n; i++) {
    if (chance(rng, 0.5)) {
      const count = randInt(rng, 0, 3);
      const names: string[] = [];
      for (let k = 0; k < count; k++) names.push(pick(rng, FIELD_NAMES));
      out.push(genTable(rng, names));
    } else {
      out.push(pick(rng, MALFORMED_TABLES));
    }
  }
  return out;
};

// ===========================================================================
// (1) TOTALITY — never throws on malformed contextTables; results well-typed.
// ===========================================================================

describe("apiValueWrite — TOTALITY (never throws on malformed contextTables)", () => {
  it("handles every enumerated malformed table shape without throwing", () => {
    for (const bad of MALFORMED_TABLES) {
      for (const field of ["status", "missing"]) {
        expect(() => resolveApiFieldColumn(field, [bad])).not.toThrow();
        for (const def of DEFAULTS) {
          expect(() => apiFieldWriteTarget(field, [bad], def)).not.toThrow();
          const target = apiFieldWriteTarget(field, [bad], def);
          expect(VALID_TARGETS.has(target)).toBe(true);
        }
      }
    }
  });

  it("handles the empty list and an all-malformed list without throwing", () => {
    expect(resolveApiFieldColumn("status", [])).toBeUndefined();
    expect(apiFieldWriteTarget("status", [], "frontmatter")).toBe("frontmatter");
    expect(apiFieldWriteTarget("status", [], "context")).toBe("context");

    expect(() =>
      resolveApiFieldColumn("never-present-field", [...MALFORMED_TABLES])
    ).not.toThrow();
    // No malformed entry defines this field, so it degrades to the verb default
    // rather than throwing or guessing a durable home. (One malformed entry
    // DOES carry a valid `status` column amid garbage; the guard correctly
    // skips the garbage and finds it — see the CLOSED GAP suite — so we query a
    // name absent from every entry to isolate the degrade-to-default path.)
    expect(
      resolveApiFieldColumn("never-present-field", [...MALFORMED_TABLES])
    ).toBeUndefined();
    expect(
      apiFieldWriteTarget("never-present-field", [...MALFORMED_TABLES], "context")
    ).toBe("context");
  });

  it("never throws and always returns a well-typed result over fuzzed mixed lists", () => {
    for (let i = 0; i < PROPERTY_RUNS; i++) {
      const rng = makeRng(BASE_SEED + i);
      const tables = genMixedTables(rng);
      const field = chance(rng, 0.8) ? pick(rng, FIELD_NAMES) : "never-defined";
      const def = pick(rng, DEFAULTS);

      let col: SpaceProperty | undefined;
      expect(() => {
        col = resolveApiFieldColumn(field, tables);
      }).not.toThrow();
      // A resolved column is a real object carrying the queried field name.
      if (col !== undefined) {
        expect(typeof col).toBe("object");
        expect(col.name).toBe(field);
      }

      let target: ApiValueWriteTarget = "skip";
      expect(() => {
        target = apiFieldWriteTarget(field, tables, def);
      }).not.toThrow();
      expect(VALID_TARGETS.has(target)).toBe(true);
    }
  });
});

// ===========================================================================
// (2) DETERMINISM — first-defining-table-wins is stable regardless of later
// tables; on a same-field collision the EARLIER table governs.
// ===========================================================================

describe("apiValueWrite — DETERMINISM (first-defining-table-wins)", () => {
  const tableWith = (cols: SpaceProperty[]): SpaceTable => ({
    schema: { id: "ctx", name: "ctx", type: "db" },
    cols,
    rows: [],
  });

  it("the EARLIER table governs a same-field-name collision", () => {
    const early = tableWith([
      { name: "status", type: "text", source: frontmatterPropertySource },
    ]);
    const late = tableWith([
      { name: "status", type: "text", source: notidianPropertySource },
    ]);
    // Earlier (frontmatter) wins over later (notidian) => frontmatter.
    expect(resolveApiFieldColumn("status", [early, late])?.source).toBe(
      frontmatterPropertySource
    );
    expect(apiFieldWriteTarget("status", [early, late], "context")).toBe(
      "frontmatter"
    );
    // Swap the order => the (now-earlier) notidian column governs => context.
    expect(resolveApiFieldColumn("status", [late, early])?.source).toBe(
      notidianPropertySource
    );
    expect(apiFieldWriteTarget("status", [late, early], "frontmatter")).toBe(
      "context"
    );
  });

  it("appending ANY further tables after the governing one never changes the outcome", () => {
    for (let i = 0; i < PROPERTY_RUNS; i++) {
      const rng = makeRng(BASE_SEED + 4111 + i);
      const field = pick(rng, FIELD_NAMES);
      const def = pick(rng, DEFAULTS);

      // A prefix that DEFINES the field somewhere, so a first-defining table
      // exists (guaranteed by making the last prefix table define it).
      const prefixLen = randInt(rng, 1, 3);
      const prefix: Array<SpaceTable | null | undefined> = [];
      for (let k = 0; k < prefixLen - 1; k++) {
        // earlier prefix tables may or may not define `field`.
        prefix.push(
          chance(rng, 0.5)
            ? genTable(rng, chance(rng, 0.5) ? [field] : ["unrelated"])
            : pick(rng, MALFORMED_TABLES)
        );
      }
      // Guarantee at least one definer in the prefix.
      prefix.push(genTable(rng, [field]));

      const baseColumn = resolveApiFieldColumn(field, prefix);
      const baseTarget = apiFieldWriteTarget(field, prefix, def);

      // Any arbitrary suffix (defining, non-defining, malformed) must not move
      // the needle — the earliest definer already governs.
      const suffix = genMixedTables(makeRng(BASE_SEED + 9001 + i));
      const withSuffix = [...prefix, ...suffix];

      expect(resolveApiFieldColumn(field, withSuffix)).toBe(baseColumn); // same ref
      expect(apiFieldWriteTarget(field, withSuffix, def)).toBe(baseTarget);
    }
  });
});

// ===========================================================================
// (3) FALLTHROUGH — no definer => undefined => defaultTarget, asserted THROUGH
// the real apiValueWriteTarget; plus the composition identity over all inputs.
// ===========================================================================

describe("apiValueWrite — FALLTHROUGH via the real apiValueWriteTarget", () => {
  it("an undefined column falls back to the verb default for BOTH defaults", () => {
    const noDefiners: ReadonlyArray<SpaceTable | null | undefined> = [
      genTable(makeRng(BASE_SEED + 1), ["unrelated"]),
      null,
      undefined,
      { cols: [{ type: "text" }] } as unknown as SpaceTable,
    ];
    expect(resolveApiFieldColumn("ghost", noDefiners)).toBeUndefined();
    for (const def of DEFAULTS) {
      // Expected value derived from the REAL gate (undefined column => default),
      // never a hardcoded/duplicated mapping.
      expect(apiFieldWriteTarget("ghost", noDefiners, def)).toBe(
        apiValueWriteTarget(undefined, def)
      );
      // And the real gate's own contract: undefined column resolves to default.
      expect(apiValueWriteTarget(undefined, def)).toBe(def);
    }
  });

  it("apiFieldWriteTarget is EXACTLY resolveApiFieldColumn composed with the real gate (all inputs)", () => {
    let sawUndefined = false;
    let sawResolved = false;
    for (let i = 0; i < PROPERTY_RUNS; i++) {
      const rng = makeRng(BASE_SEED + 20250709 + i);
      const tables = genMixedTables(rng);
      const field = chance(rng, 0.75) ? pick(rng, FIELD_NAMES) : "never-defined";
      const def = pick(rng, DEFAULTS);

      const column = resolveApiFieldColumn(field, tables);
      if (column === undefined) sawUndefined = true;
      else sawResolved = true;

      // The composed gate must equal the real authority gate applied to the
      // resolved column — proving apiFieldWriteTarget owns NO routing logic of
      // its own, only the composition (fallthrough included: when column is
      // undefined the real gate returns `def`).
      expect(apiFieldWriteTarget(field, tables, def)).toBe(
        apiValueWriteTarget(column, def)
      );
    }
    // Non-vacuity: the corpus exercised BOTH the fallthrough (undefined) and the
    // resolved-column branches, so the identity above is not trivially passing.
    expect(sawUndefined).toBe(true);
    expect(sawResolved).toBe(true);
  });
});

// ===========================================================================
// CLOSED GAP (Notidian-9wzv) — two real totality gaps this bead surfaced and
// closed in resolveApiFieldColumn:
//
//   (A) `table.cols` a truthy NON-ARRAY value (a corrupt/legacy MDB, or an
//       external raw edit) once reached `cols.find(...)` on a value with no
//       `.find` method and threw `TypeError: ...find is not a function`.
//   (B) `table.cols` an ARRAY holding a null/undefined ENTRY once dereferenced
//       `c.name` on the null entry inside the find predicate and threw.
//
// Both violated the "never throws" gate contract (a single-user vault: a
// crashing write path is strictly worse than degrading to the verb default and
// letting the frontmatter/MDB layers reconcile). The fix guards defensively
// with the same posture validateRow uses (Array.isArray + a null-entry skip);
// `parseTypeProfile`/materialize never emit these shapes, so this is
// defensive-depth for hostile/legacy input, not a reachable well-formed path.
// These cases PIN the closed behavior.
// ===========================================================================

describe("apiValueWrite — CLOSED GAP: malformed cols shapes (Notidian-9wzv)", () => {
  it("does not throw when cols is a non-array value; degrades to undefined", () => {
    for (const badCols of [{}, "cols", 5, true, () => 1]) {
      const table = { cols: badCols } as unknown as SpaceTable;
      expect(() => resolveApiFieldColumn("status", [table])).not.toThrow();
      expect(resolveApiFieldColumn("status", [table])).toBeUndefined();
      expect(apiFieldWriteTarget("status", [table], "context")).toBe("context");
    }
  });

  it("does not throw when cols holds null/undefined entries; skips them and matches later valid entries", () => {
    const table = {
      cols: [null, undefined, { name: "status", type: "text" }],
    } as unknown as SpaceTable;
    let col: SpaceProperty | undefined;
    expect(() => {
      col = resolveApiFieldColumn("status", [table]);
    }).not.toThrow();
    // The null/undefined entries are skipped; the real column after them wins.
    expect(col?.name).toBe("status");
    // A source-less frontmatter-storable text column routes to frontmatter.
    expect(apiFieldWriteTarget("status", [table], "context")).toBe("frontmatter");
  });

  it("skips a cols entry lacking a .name without throwing", () => {
    const table = {
      cols: [{ type: "text" }, { name: "status", type: "context" }],
    } as unknown as SpaceTable;
    expect(() => resolveApiFieldColumn("status", [table])).not.toThrow();
    // The nameless entry is passed over; the context-only column routes to context.
    expect(apiFieldWriteTarget("status", [table], "frontmatter")).toBe("context");
  });
});
