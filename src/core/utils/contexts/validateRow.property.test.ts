import {
  Invariant,
  NotidianTypeProfile,
  TypeProfileField,
  TypeProfileReference,
  typeProfileKindForType,
} from "core/utils/contexts/typeProfile";
import {
  RepairTier,
  ValidateRowCtx,
  Violation,
  ViolationCode,
  ViolationSeverity,
  validateRow,
  validateRowPatch,
} from "core/utils/contexts/validateRow";
import { Filter } from "shared/types/predicate";

// ===========================================================================
// SEEDED PROPERTY NET for the Data Integrity validation core
// (validateRowPatch / validateRow, src/core/utils/contexts/validateRow.ts,
// ADR-0057 D1/D5, Notidian-csuq).
//
// validateRowPatch is THE write-gate guard for the whole Data Integrity
// Program: the ONE pure function every future consumer (the S4 reconciler, the
// S5 health surface, Atlasidian's `db.*` verbs) calls to answer "did this edit
// break something?". This file proves the FOUR cross-cutting invariants a
// guard of that stature must uphold for ALL inputs. It complements — does not
// duplicate — the example suite (validateRow.test.ts, 77 cases) and the
// adversarial companion (validateRow.adversarial.test.ts, isolation /
// declared-cause / empty-required). The NEW ground this file breaks:
//
//   TOTAL     never throws on ANY well-typed OR hostile schema/row/patch/ctx;
//             always returns a well-typed Violation[].
//   READ-ONLY inputs (row / patch / schema / ctx.otherRows) are never mutated —
//             proven TWO independent ways: (a) a before/after structural
//             snapshot, and (b) DEEP-FREEZING every input and asserting the
//             result is byte-identical to an unfrozen run (catches any hidden
//             mutation-DEPENDENCE a snapshot alone would miss — a frozen mutate
//             throws, is swallowed by pushSafe, and would silently drop a
//             violation, diverging the two runs).
//   STABLE    identical input -> byte-identical Violation[] EVERY run, in a
//             deterministic ORDER: all per-field-check violations first (fields
//             in declaration order, each field's checks in a fixed sequence),
//             then all invariants in declaration order. (This is INSERTION
//             order, NOT a global severity sort — pinned, see below.)
//   AUTOFIX   for every Violation whose repairTier is 'autofix' AND whose class
//   SOUNDNESS is mechanically repairable (encoding normalization — the ONLY such
//             class validateRow emits, per ADR-0057 D5), applying the canonical
//             repair yields a row that RE-VALIDATES WITHOUT that code, and a
//             second application is idempotent (converges, no oscillation).
//
// CHARACTERIZATION, NOT CORRECTION. Every assertion LOCKS the live behaviour;
// no production code is changed. Two caller-dependent quirks are PINNED (with a
// concrete example each) rather than "fixed", and filed as follow-up
// **Notidian-ctag**:
//   * output ordering is insertion order, not severity-sorted (the bead's
//     "error-before-warn" phrasing does not match the shipped contract);
//   * an `invariant` autofix is an opaque author string with no schema-derivable
//     transform (Wave-2's write path owns application; this module heals nothing).
//
// CONVENTION: hand-rolled mulberry32 PRNG + fixed seed + PROPERTY_RUNS loop, NO
// fast-check dependency — matching tableRollup.property.test.ts,
// validateRow.adversarial.test.ts, tableRowOrder.property.test.ts, et al. A
// fixed seed makes the suite fully reproducible across machines/CI.
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
type Rng = () => number;
const randInt = (rng: Rng, min: number, max: number): number =>
  min + Math.floor(rng() * (max - min + 1));
const pick = <T>(rng: Rng, pool: readonly T[]): T =>
  pool[randInt(rng, 0, pool.length - 1)];
const chance = (rng: Rng, p: number): boolean => rng() < p;
const sampleDistinct = <T>(rng: Rng, pool: readonly T[], k: number): T[] => {
  const arr = [...pool];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = randInt(rng, 0, i);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr.slice(0, Math.min(k, arr.length));
};

const BASE_SEED = 0xda7a; // distinct from the adversarial file's 0x5eed.
const PROPERTY_RUNS = 500;

// --- declared enum membership (well-typed assertion) -----------------------
const VALID_CODES: ReadonlySet<ViolationCode> = new Set<ViolationCode>([
  "malformed-row",
  "type",
  "enum",
  "required",
  "unique",
  "pattern",
  "title-binding",
  "empty-encoding",
  "reference-broken",
  "invariant",
]);
const VALID_SEVERITIES: ReadonlySet<ViolationSeverity> =
  new Set<ViolationSeverity>(["error", "warn"]);
const VALID_TIERS: ReadonlySet<RepairTier> = new Set<RepairTier>([
  "autofix",
  "one-click",
  "manual-only",
]);
const VIOLATION_KEYS = new Set([
  "field",
  "code",
  "severity",
  "message",
  "repairTier",
  "suggestedFix",
]);

// The FIXED per-field check order validateRowPatch runs (see its per-field
// loop). Used by the STABLE ordering pin to reconstruct the canonical sequence.
const PER_FIELD_CHECK_ORDER: readonly ViolationCode[] = [
  "type",
  "enum",
  "required",
  "pattern",
  "title-binding",
  "empty-encoding",
  "unique",
  "reference-broken",
];
const PER_FIELD_CODES = new Set<ViolationCode>(PER_FIELD_CHECK_ORDER);

const assertWellTyped = (v: Violation): void => {
  expect(VALID_CODES.has(v.code)).toBe(true);
  expect(VALID_SEVERITIES.has(v.severity)).toBe(true);
  expect(VALID_TIERS.has(v.repairTier)).toBe(true);
  expect(typeof v.message).toBe("string");
  expect(v.message.length).toBeGreaterThan(0);
  if (v.field !== undefined) expect(typeof v.field).toBe("string");
  if (v.suggestedFix !== undefined) expect(typeof v.suggestedFix).toBe("string");
  for (const key of Object.keys(v)) expect(VIOLATION_KEYS.has(key)).toBe(true);
  if (v.field === undefined)
    expect(v.code === "invariant" || v.code === "malformed-row").toBe(true);
};

// Structural clone preserving `undefined`-in-object and NaN (JSON would drop
// them) so the READ-ONLY snapshot compares faithfully. Inputs never carry
// functions/cycles — ctx functions are excluded from the snapshot.
const clone = <T>(value: T): T => {
  if (Array.isArray(value)) return value.map(clone) as unknown as T;
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>))
      out[key] = clone((value as Record<string, unknown>)[key]);
    return out as unknown as T;
  }
  return value;
};

// Recursive Object.freeze over plain data (objects + arrays). A frozen input a
// read-only function reads transparently; a function that MUTATES a frozen
// input throws (strict mode) — which pushSafe swallows, dropping a violation
// and diverging the frozen run from the unfrozen one (see READ-ONLY test B).
const deepFreeze = <T>(value: T): T => {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value as Record<string, unknown>))
      deepFreeze((value as Record<string, unknown>)[key]);
  }
  return value;
};

// ---------------------------------------------------------------------------
// Generators. A STRUCTURED (well-formed) case drives the introspective
// invariants (STABLE ordering, AUTOFIX soundness); a GARBAGE case drives the
// pure-robustness net (TOTAL / well-typed / determinism / malformed-guard).
// `empty` policy is biased HIGH and empty-ish values are common so the
// empty-encoding autofix class is exercised densely (non-vacuity below).
// ---------------------------------------------------------------------------

const FIELD_NAMES = [
  "alpha",
  "beta",
  "gamma",
  "delta",
  "status",
  "count",
  "active",
  "installed",
  "tags",
  "ref",
] as const;

const FIELD_TYPES = [
  "text",
  "number",
  "boolean",
  "date",
  "option",
  "option-multi",
  "link",
  "link-multi",
  "password",
] as const;

const ENUM_VOCAB = ["active", "spare", "retired", "on", "off"] as const;
const PATTERNS = ["^[a-z]+$", "^\\d+$", "^x", "(", ".*"] as const;

// A value pool spanning every branch: missing forms (null/undefined/""/[]),
// coercible + un-coercible scalars, enum members + non-members, multi
// encodings, and object shapes. null/undefined/"" are over-represented so
// empty-encoding fires often.
const VALUES: readonly unknown[] = [
  null,
  undefined,
  "",
  null,
  "",
  "abc",
  "42",
  "0",
  "true",
  "false",
  "2026-07-04",
  "not-a-date",
  "active",
  "unknown",
  "a, b",
  "FileTitle",
  0,
  42,
  true,
  false,
  ["a", "b"],
  [],
  { x: 1 },
];

const genFilter = (rng: Rng, declaredNames: readonly string[]): Filter => {
  const asProperty = chance(rng, 0.5);
  const field = chance(rng, 0.8)
    ? pick(rng, declaredNames.length ? declaredNames : ["ghost"])
    : "ghost"; // an undeclared field exercises the fail-open/fail-closed contrast.
  const fn = chance(rng, 0.85)
    ? pick(rng, [
        "is",
        "isNot",
        "isEmpty",
        "isNotEmpty",
        "contains",
        "isLessThanOrEqual",
      ])
    : "bogusFn";
  const value = asProperty
    ? pick(rng, declaredNames.length ? declaredNames : ["alpha"])
    : pick(rng, ["1", "active", "true", ""]);
  return { field, fn, value, fType: asProperty ? "property" : "value" };
};

const genField = (rng: Rng, name: string): TypeProfileField => {
  const type = pick(rng, FIELD_TYPES);
  const field: TypeProfileField = {
    name,
    kind: typeProfileKindForType(type),
    type,
  };
  if (chance(rng, 0.4)) field.required = true;
  if (chance(rng, 0.45))
    field.enum = {
      values: sampleDistinct(rng, ENUM_VOCAB, randInt(rng, 1, 3)),
      strict: chance(rng, 0.7),
    };
  if (chance(rng, 0.3))
    field.unique = {
      scope: "database",
      ...(chance(rng, 0.4) ? { where: [genFilter(rng, FIELD_NAMES)] } : {}),
    };
  if (chance(rng, 0.3)) field.pattern = pick(rng, PATTERNS);
  if (chance(rng, 0.3)) field.title_binding = true;
  // Biased HIGH so the empty-encoding autofix class is common.
  if (chance(rng, 0.55)) field.empty = pick(rng, ["absent", "empty-string"]);
  if (chance(rng, 0.3)) {
    const reference: TypeProfileReference = {
      targetFolder: "Targets",
      targetKey: "id",
      onBrokenWrite: pick(rng, ["block", "warn"] as const),
      onReferencedChange: pick(rng, ["warn", "cascade-preview"] as const),
    };
    field.reference = reference;
  }
  return field;
};

const genInvariant = (rng: Rng, declaredNames: readonly string[]): Invariant => {
  // ~35% deterministically violate (a `require` over an undeclared `ghost`
  // field at severity "error" is fail-closed), so `invariant` is reliably hit.
  if (chance(rng, 0.35)) {
    return {
      require: [{ field: "ghost", fn: "isNotEmpty", value: "", fType: "value" }],
      severity: "error",
      message: "forced-invariant-violation",
      ...(chance(rng, 0.5) ? { autofix: "do the thing" } : {}),
    };
  }
  const invariant: Invariant = {
    require: [genFilter(rng, declaredNames)],
    severity: pick(rng, ["error", "warn"] as const),
    message: "inv-" + randInt(rng, 0, 9999),
  };
  if (chance(rng, 0.4)) invariant.when = [genFilter(rng, declaredNames)];
  if (chance(rng, 0.3)) invariant.autofix = "auto-" + randInt(rng, 0, 9);
  return invariant;
};

const genValueMap = (
  rng: Rng,
  names: readonly string[],
  density: number
): Record<string, unknown> => {
  const out: Record<string, unknown> = {};
  for (const name of names) if (chance(rng, density)) out[name] = pick(rng, VALUES);
  if (chance(rng, 0.25)) out["unrelatedKey"] = pick(rng, VALUES);
  return out;
};

type CtxData = {
  otherRows: Array<Record<string, unknown>>;
  refKeys: Set<string>;
  basename: string;
};

type StructuredCase = {
  schema: NotidianTypeProfile;
  row: Record<string, unknown>;
  patch: Record<string, unknown>;
  ctxData: CtxData;
};

const genStructuredCase = (rng: Rng): StructuredCase => {
  const names = sampleDistinct(rng, FIELD_NAMES, randInt(rng, 1, 5));
  const fields = names.map((n) => genField(rng, n));
  const invariants: Invariant[] = [];
  const invCount = randInt(rng, 0, 2);
  for (let i = 0; i < invCount; i++) invariants.push(genInvariant(rng, names));

  const schema: NotidianTypeProfile = {
    fields,
    kindFields: {},
    invariants,
    issues: [],
  };
  const row = genValueMap(rng, names, 0.8);
  const patch = genValueMap(rng, names, 0.35);

  const otherRows: Array<Record<string, unknown>> = [];
  const otherCount = randInt(rng, 0, 4);
  for (let i = 0; i < otherCount; i++)
    otherRows.push(genValueMap(rng, names, 0.9));
  const refKeys = new Set(["active", "42", "abc", "FileTitle"]);
  const basename = pick(rng, ["FileTitle", "Other", "active", "abc"]);

  return { schema, row, patch, ctxData: { otherRows, refKeys, basename } };
};

// A fully-wired, DETERMINISTIC ctx.
const fullCtx = (data: CtxData): ValidateRowCtx => ({
  getOtherRows: () => data.otherRows,
  resolveReferenceExists: (_ref: TypeProfileReference, value: unknown) =>
    data.refKeys.has(String(value)),
  basename: data.basename,
});

// --- garbage generators (TOTAL robustness) ---------------------------------
const HOSTILE_KEYS = ["__proto__", "constructor", "prototype", "toString"];

const genGarbageValue = (rng: Rng, depth: number): unknown => {
  if (depth > 2 || chance(rng, 0.5)) return pick(rng, VALUES);
  if (chance(rng, 0.5)) {
    const arr: unknown[] = [];
    const n = randInt(rng, 0, 3);
    for (let i = 0; i < n; i++) arr.push(genGarbageValue(rng, depth + 1));
    return arr;
  }
  const obj: Record<string, unknown> = {};
  const n = randInt(rng, 0, 3);
  for (let i = 0; i < n; i++) {
    const key = chance(rng, 0.3) ? pick(rng, HOSTILE_KEYS) : "k" + i;
    obj[key] = genGarbageValue(rng, depth + 1);
  }
  return obj;
};

const genGarbageSchema = (rng: Rng): unknown =>
  pick(rng, [
    null,
    undefined,
    42,
    "schema",
    [],
    {},
    { fields: 5 },
    { fields: "nope", invariants: "nope" },
    { fields: [null, {}, undefined, { name: 1 }, { name: "x", type: {} }, 5] },
    {
      fields: [genField(rng, "alpha"), genField(rng, "beta")],
      invariants: "not-an-array",
    },
    {
      fields: [genField(rng, "gamma")],
      invariants: [null, {}, { require: [] }, genInvariant(rng, ["gamma"])],
    },
    genStructuredCase(rng).schema,
  ]);

const genGarbageCtx = (rng: Rng): ValidateRowCtx | undefined =>
  pick(rng, [
    undefined,
    {} as ValidateRowCtx,
    {
      getOtherRows: (): Array<Record<string, unknown>> => null,
    } as unknown as ValidateRowCtx,
    {
      getOtherRows: () => {
        throw new Error("boom");
      },
    } as unknown as ValidateRowCtx,
    { getOtherRows: () => 7 } as unknown as ValidateRowCtx,
    {
      resolveReferenceExists: () => {
        throw new Error("boom");
      },
    } as unknown as ValidateRowCtx,
    { resolveReferenceExists: () => true } as unknown as ValidateRowCtx,
    { basename: 5 } as unknown as ValidateRowCtx,
    { basename: "X" } as ValidateRowCtx,
    {
      getOtherRows: () => [{ alpha: "x" }, null, 5],
      resolveReferenceExists: () => false,
      basename: "T",
    } as unknown as ValidateRowCtx,
  ]);

type GarbageCase = {
  schema: unknown;
  row: unknown;
  patch: unknown;
  ctx: ValidateRowCtx | undefined;
};

const genGarbageCase = (rng: Rng): GarbageCase => ({
  schema: genGarbageSchema(rng),
  row: pick(rng, [
    null,
    undefined,
    42,
    "row",
    [],
    ["a"],
    genValueMap(rng, FIELD_NAMES, 0.7),
    genGarbageValue(rng, 0),
    { alpha: genGarbageValue(rng, 0), beta: genGarbageValue(rng, 0) },
  ]),
  patch: pick(rng, [
    null,
    undefined,
    42,
    "patch",
    [],
    {},
    genValueMap(rng, FIELD_NAMES, 0.4),
    genGarbageValue(rng, 0),
  ]),
  ctx: genGarbageCtx(rng),
});

// ===========================================================================
// (1) TOTAL — never throws; always returns a well-typed Violation[].
// ===========================================================================

describe("validateRow property net — TOTAL", () => {
  it("never throws and always returns a well-typed Violation[] (structured + garbage)", () => {
    for (let i = 0; i < PROPERTY_RUNS; i++) {
      const rng = makeRng(BASE_SEED + i);
      let schema: unknown;
      let row: unknown;
      let patch: unknown;
      let ctx: ValidateRowCtx | undefined;
      if (i % 2 === 0) {
        const c = genStructuredCase(rng);
        schema = c.schema;
        row = c.row;
        patch = c.patch;
        ctx = fullCtx(c.ctxData);
      } else {
        const g = genGarbageCase(rng);
        schema = g.schema;
        row = g.row;
        patch = g.patch;
        ctx = g.ctx;
      }

      let result: Violation[] = [];
      expect(() => {
        result = validateRowPatch(
          schema as NotidianTypeProfile,
          row as Record<string, unknown>,
          patch as Record<string, unknown>,
          ctx
        );
      }).not.toThrow();
      expect(Array.isArray(result)).toBe(true);
      for (const v of result) assertWellTyped(v);

      // The convenience overload must be equally total.
      expect(() =>
        validateRow(
          schema as NotidianTypeProfile,
          row as Record<string, unknown>,
          ctx
        )
      ).not.toThrow();
    }
  });
});

// ===========================================================================
// (2) READ-ONLY — inputs are never mutated, proven two independent ways.
// ===========================================================================

describe("validateRow property net — READ-ONLY", () => {
  it("A. never mutates schema / row / patch / ctx.otherRows (before/after snapshot)", () => {
    for (let i = 0; i < PROPERTY_RUNS; i++) {
      const c = genStructuredCase(makeRng(BASE_SEED + 1301 + i));
      const snapshot = clone({
        schema: c.schema,
        row: c.row,
        patch: c.patch,
        others: c.ctxData.otherRows,
      });
      validateRowPatch(c.schema, c.row, c.patch, fullCtx(c.ctxData));
      expect({
        schema: c.schema,
        row: c.row,
        patch: c.patch,
        others: c.ctxData.otherRows,
      }).toEqual(snapshot);
    }
  });

  it("B. deep-frozen inputs yield a byte-identical result to unfrozen (no mutation-dependence)", () => {
    for (let i = 0; i < PROPERTY_RUNS; i++) {
      // Two structurally-identical cases from the same seed: freeze one set.
      const frozenCase = genStructuredCase(makeRng(BASE_SEED + 7777 + i));
      const plainCase = genStructuredCase(makeRng(BASE_SEED + 7777 + i));

      deepFreeze(frozenCase.schema);
      deepFreeze(frozenCase.row);
      deepFreeze(frozenCase.patch);
      deepFreeze(frozenCase.ctxData.otherRows);

      let frozenResult: Violation[] = [];
      expect(() => {
        frozenResult = validateRowPatch(
          frozenCase.schema,
          frozenCase.row,
          frozenCase.patch,
          fullCtx(frozenCase.ctxData)
        );
      }).not.toThrow();

      const plainResult = validateRowPatch(
        plainCase.schema,
        plainCase.row,
        plainCase.patch,
        fullCtx(plainCase.ctxData)
      );
      // If any check mutated an input, the frozen run would throw (swallowed by
      // pushSafe) and drop that violation, diverging from the plain run.
      expect(frozenResult).toEqual(plainResult);
    }
  });
});

// ===========================================================================
// (3) STABLE — identical input -> identical Violation[], deterministic order.
// ===========================================================================

describe("validateRow property net — STABLE", () => {
  it("repeated calls on identical input return byte-identical Violation[] (structured + garbage)", () => {
    for (let i = 0; i < PROPERTY_RUNS; i++) {
      const useStructured = i % 2 === 0;
      const c = genStructuredCase(makeRng(BASE_SEED + 2999 + i));
      const g = genGarbageCase(makeRng(BASE_SEED + 4243 + i));
      const schema = useStructured ? c.schema : (g.schema as NotidianTypeProfile);
      const row = (useStructured ? c.row : g.row) as Record<string, unknown>;
      const patch = (useStructured ? c.patch : g.patch) as Record<string, unknown>;
      const ctx = useStructured ? fullCtx(c.ctxData) : g.ctx;

      const first = validateRowPatch(schema, row, patch, ctx);
      const second = validateRowPatch(schema, row, patch, ctx);
      expect(second).toEqual(first);
    }
  });

  it("validateRow(s,r,c) equals validateRowPatch(s,r,r,c) for every input", () => {
    for (let i = 0; i < PROPERTY_RUNS; i++) {
      const useStructured = i % 2 === 0;
      const c = genStructuredCase(makeRng(BASE_SEED + 555 + i));
      const g = genGarbageCase(makeRng(BASE_SEED + 999 + i));
      const schema = useStructured ? c.schema : (g.schema as NotidianTypeProfile);
      const row = (useStructured ? c.row : g.row) as Record<string, unknown>;
      const ctx = useStructured ? fullCtx(c.ctxData) : g.ctx;
      expect(validateRow(schema, row, ctx)).toEqual(
        validateRowPatch(schema, row, row, ctx)
      );
    }
  });

  it("ordering is deterministic INSERTION order: all per-field checks (field decl order, fixed check order) precede all invariants", () => {
    for (let i = 0; i < PROPERTY_RUNS; i++) {
      const c = genStructuredCase(makeRng(BASE_SEED + 8837 + i));
      const fieldIndex = new Map(c.schema.fields.map((f, idx) => [f.name, idx]));
      const result = validateRowPatch(c.schema, c.row, c.patch, fullCtx(c.ctxData));

      // Phase 1 = per-field-check violations; Phase 2 = invariants. Once an
      // invariant appears, no per-field violation may follow.
      let seenInvariant = false;
      for (const v of result) {
        if (v.code === "invariant") seenInvariant = true;
        else {
          expect(PER_FIELD_CODES.has(v.code)).toBe(true);
          expect(seenInvariant).toBe(false);
        }
      }

      // Within Phase 1, the sequence is sorted ascending by
      // (fieldDeclIndex, checkOrderIndex) — the exact loop order.
      const phase1 = result.filter((v) => v.code !== "invariant");
      const sortKey = (v: Violation): number => {
        const fIdx = v.field != null ? fieldIndex.get(v.field) ?? 0 : 0;
        const cIdx = PER_FIELD_CHECK_ORDER.indexOf(v.code);
        return fIdx * 100 + cIdx;
      };
      for (let k = 1; k < phase1.length; k++)
        expect(sortKey(phase1[k])).toBeGreaterThanOrEqual(sortKey(phase1[k - 1]));
    }
  });

  it("PINS (Notidian-ctag): output is NOT globally severity-sorted — a warn can precede an error", () => {
    // A warn `reference-broken` on the FIRST-declared field, and an error
    // `required` on a LATER field. Insertion order emits the warn first — this
    // concretely disproves the "error-before-warn" phrasing. Characterized, not
    // fixed: if the S5 health UI needs severity grouping it sorts at the
    // presentation layer (see Notidian-ctag); the core's stable insertion order
    // stays the canonical wire order.
    const schema: NotidianTypeProfile = {
      fields: [
        {
          name: "board_id",
          kind: "text",
          type: "text",
          reference: {
            targetFolder: "Targets",
            targetKey: "id",
            onBrokenWrite: "warn", // -> warn severity
            onReferencedChange: "warn",
          },
        },
        { name: "model", kind: "text", type: "text", required: true },
      ],
      kindFields: {},
      invariants: [],
      issues: [],
    };
    const v = validateRowPatch(
      schema,
      { board_id: "does-not-exist" },
      {},
      { resolveReferenceExists: () => false }
    );
    expect(v.map((x) => x.code)).toEqual(["reference-broken", "required"]);
    expect(v.map((x) => x.severity)).toEqual(["warn", "error"]);
  });
});

// ===========================================================================
// (4) AUTOFIX SOUNDNESS — applying an autofix repair converges (no oscillation).
//
// ADR-0057 D5 scopes the `autofix` tier to exactly two mechanically-lossless
// classes: ENCODING NORMALIZATION (rewrite to the field's declared `empty`
// policy) and DERIVED-FIELD REFRESH (ADR-0058, not a validateRow output). So
// the ONLY autofix-tier violation validateRow emits whose repair is fully
// determined by the schema is `empty-encoding`. Its canonical repair, keyed
// solely on field.empty:
//   empty: "absent"       -> DELETE the key   (canonical empty = absent)
//   empty: "empty-string" -> SET the value to "" (canonical empty = "")
// ===========================================================================

const applyEmptyEncodingAutofix = (
  row: Record<string, unknown>,
  field: TypeProfileField
): Record<string, unknown> => {
  const next = { ...row };
  if (field.empty === "absent") delete next[field.name];
  else next[field.name] = ""; // "empty-string"
  return next;
};

describe("validateRow property net — AUTOFIX SOUNDNESS", () => {
  it("applying each empty-encoding autofix removes that code and is idempotent (converges, no oscillation)", () => {
    let repaired = 0;
    for (let i = 0; i < PROPERTY_RUNS; i++) {
      const c = genStructuredCase(makeRng(BASE_SEED + 5150 + i));
      const ctx = fullCtx(c.ctxData);
      const effective: Record<string, unknown> = { ...c.row, ...c.patch };

      const before = validateRowPatch(c.schema, c.row, c.patch, ctx);
      const autofixEmpty = before.filter(
        (v) => v.repairTier === "autofix" && v.code === "empty-encoding"
      );
      if (autofixEmpty.length === 0) continue;

      // Every autofix-tier empty-encoding violation must be attributed to a
      // real field carrying an `empty` policy (soundness of the mapping).
      for (const v of autofixEmpty) {
        const field = c.schema.fields.find((f) => f.name === v.field);
        expect(field).toBeDefined();
        expect(field!.empty === "absent" || field!.empty === "empty-string").toBe(
          true
        );
      }

      // Apply all empty-encoding repairs (each touches a distinct field).
      let repairedRow = { ...effective };
      for (const v of autofixEmpty) {
        const field = c.schema.fields.find((f) => f.name === v.field)!;
        repairedRow = applyEmptyEncodingAutofix(repairedRow, field);
        repaired++;
      }

      // CONVERGENCE: re-validating the repaired row has NO empty-encoding left,
      // and specifically none on any repaired field.
      const after = validateRow(c.schema, repairedRow, ctx);
      expect(after.some((v) => v.code === "empty-encoding")).toBe(false);
      for (const v of autofixEmpty)
        expect(
          after.some((x) => x.code === "empty-encoding" && x.field === v.field)
        ).toBe(false);

      // NO OSCILLATION: re-applying the same repair is idempotent — the row and
      // its (empty-encoding-free) violation set are stable under a second pass.
      let repairedAgain = { ...repairedRow };
      for (const v of autofixEmpty) {
        const field = c.schema.fields.find((f) => f.name === v.field)!;
        repairedAgain = applyEmptyEncodingAutofix(repairedAgain, field);
      }
      expect(repairedAgain).toEqual(repairedRow);
      const afterAgain = validateRow(c.schema, repairedAgain, ctx);
      expect(afterAgain).toEqual(after);
    }
    // NON-VACUITY: the corpus actually exercised the empty-encoding autofix.
    expect(repaired).toBeGreaterThan(0);
  });

  it("both empty policies converge for every empty encoding (null / '' / absent)", () => {
    // Exhaustive over the (policy x observed-encoding) matrix: each illegal
    // encoding fires empty-encoding@autofix, and its repair clears it.
    const policies: Array<"absent" | "empty-string"> = ["absent", "empty-string"];
    const encodings: Array<[string, Record<string, unknown>]> = [
      ["null", { x: null }],
      ["empty-string", { x: "" }],
      ["absent", {}],
    ];
    for (const empty of policies) {
      const schema: NotidianTypeProfile = {
        fields: [{ name: "x", kind: "text", type: "text", empty }],
        kindFields: {},
        invariants: [],
        issues: [],
      };
      for (const [, row] of encodings) {
        const before = validateRow(schema, row);
        const ee = before.filter((v) => v.code === "empty-encoding");
        // Whenever it DID fire, it is autofix-tier and its repair converges.
        for (const v of ee) expect(v.repairTier).toBe("autofix");
        if (ee.length === 0) continue;
        const repaired = applyEmptyEncodingAutofix(row, schema.fields[0]);
        expect(
          validateRow(schema, repaired).some((v) => v.code === "empty-encoding")
        ).toBe(false);
      }
    }
  });

  it("PINS (Notidian-ctag): an `invariant` autofix is an opaque author hint, not a schema-derivable transform", () => {
    // Unlike empty-encoding, an invariant's `autofix` is a freeform author
    // string surfaced verbatim as suggestedFix — there is no mechanical repair
    // this module (or this test) can derive from it. ADR-0057 D5: detection
    // only; Wave-2's write path owns application (tracked in Notidian-ctag).
    const schema: NotidianTypeProfile = {
      fields: [{ name: "device", kind: "text", type: "text" }],
      kindFields: {},
      invariants: [
        {
          require: [
            { field: "device", fn: "isNotEmpty", value: "", fType: "literal" },
          ],
          severity: "error",
          message: "device must be set",
          autofix: "normalize-empty",
        },
      ],
      issues: [],
    };
    const v = validateRow(schema, {});
    const inv = v.find((x) => x.code === "invariant");
    expect(inv).toBeDefined();
    expect(inv!.repairTier).toBe("autofix");
    expect(inv!.suggestedFix).toBe("normalize-empty"); // raw author string, not a transform.
    // The module never self-heals: re-validating the unchanged row is stable.
    expect(validateRow(schema, {})).toEqual(v);
  });

  it("empty-encoding and invariant are the ONLY codes that ever carry repairTier 'autofix'", () => {
    // Locks ADR-0057 D5's autofix scope at the detection layer: no other check
    // (type/enum/required/pattern/title-binding/unique/reference-broken) may
    // silently acquire an autofix tier under the fuzzer.
    for (let i = 0; i < PROPERTY_RUNS; i++) {
      const c = genStructuredCase(makeRng(BASE_SEED + 6006 + i));
      const result = validateRowPatch(c.schema, c.row, c.patch, fullCtx(c.ctxData));
      for (const v of result)
        if (v.repairTier === "autofix")
          expect(v.code === "empty-encoding" || v.code === "invariant").toBe(true);
    }
  });
});
