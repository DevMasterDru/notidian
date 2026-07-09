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
import { filterFnTypes } from "core/utils/contexts/predicate/filterFns/filterFnTypes";
import { Filter } from "shared/types/predicate";
import { parseMultiString } from "utils/parsers";

// ===========================================================================
// ADVERSARIAL + PROPERTY NET for the Data Integrity validation core
// (validateRowPatch / validateRow, src/core/utils/contexts/validateRow.ts,
// ADR-0057 D1, Notidian-loan.2 / S2, Notidian-vx6h).
//
// The existing validateRow.test.ts is an EXAMPLE-based suite (77 cases). This
// file is its adversarial/property companion — the same convention every other
// safety-critical pure surface here carries (reconciler.adversarial,
// notidianSchema.adversarial, keyMatchRollup.adversarial.property,
// tableRowOrder.property, ...). It fuzzes random {schema x row x patch x ctx}
// and asserts the CROSS-CUTTING invariants that must hold for ALL inputs:
//
//   (a) TOTAL         — never throws on any malformed schema/row/patch/ctx
//                       (the malformed-row input guard + the degrade-to-skip
//                       ctx contract + the pushSafe per-check swallow).
//   (b) DETERMINISTIC — same input => byte-identical Violation[]; and
//                       validateRow(s,r,c) === validateRowPatch(s,r,r,c);
//                       READ-ONLY — inputs are never mutated.
//   (c) ISOLATION     — an under-wired ctx (missing getOtherRows / reference
//                       resolver / basename) silently skips ONLY that
//                       capability's own ViolationCode; it never adds, removes,
//                       or alters ANY other field's violation.
//   (d) WELL-TYPED    — every emitted code/severity/repairTier is a declared
//                       enum member; message is a non-empty string; a
//                       field-less violation is ONLY ever an `invariant`
//                       (multi-field require) or the `malformed-row` guard.
//   (e) DECLARED-CAUSE— each ViolationCode fires ONLY from its declared cause
//                       (enum only when strict + out-of-set; unique only via a
//                       wired getOtherRows on a unique field; reference-broken
//                       only when the resolver returns false; etc.). A coverage
//                       assertion proves the per-code checks are non-vacuous
//                       (every field-attribute code was actually observed).
//   (f) EMPTY/REQUIRED— empty-encoding vs required interplay: required fires
//                       only on a MISSING value; empty-encoding fires only on a
//                       policy-illegal empty ENCODING; a genuinely non-empty
//                       present value triggers neither.
//
// CHARACTERIZATION ONLY — no production code is changed. If the fuzzer surfaces
// a real defect it is filed as a follow-up bead and routed separately.
// CONVENTION: hand-rolled mulberry32 PRNG + fixed seed + PROPERTY_RUNS loop,
// NO fast-check (repo convention). Fixed seed => the suite is deterministic.
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
const sampleDistinct = <T>(rng: Rng, pool: readonly T[], k: number): T[] => {
  const arr = [...pool];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = randInt(rng, 0, i);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr.slice(0, Math.min(k, arr.length));
};

const BASE_SEED = 0x5eed;
const PROPERTY_RUNS = 500;

// ---------------------------------------------------------------------------
// Oracles — mirrors of the module's own predicates, used ONLY to justify a
// violation's declared cause. Deliberately independent re-derivations so a
// drift in the production contract surfaces here as a failing cause-check.
// ---------------------------------------------------------------------------

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

const isMissingValue = (value: unknown): boolean =>
  value == null || value === "" || (Array.isArray(value) && value.length === 0);

const isMultiValueFieldType = (fieldType: unknown): boolean =>
  typeof fieldType === "string" &&
  (fieldType.startsWith("option-multi") ||
    fieldType.startsWith("link-multi") ||
    fieldType.startsWith("tags-multi"));

// The subset of declared types `checkType` actively constrains. Any other
// (scalar text/option/link/password/unknown) accepts EVERY primitive — it only
// rejects a non-null object/array. So a `type` violation implies the field's
// type is constrained OR the effective value is an object.
const isConstrainedType = (fieldType: unknown): boolean =>
  fieldType === "number" ||
  fieldType === "boolean" ||
  (typeof fieldType === "string" && fieldType.startsWith("date")) ||
  isMultiValueFieldType(fieldType);

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);

const enumIllegalValues = (
  field: TypeProfileField,
  value: unknown
): string[] => {
  const values = Array.isArray(value)
    ? value
    : isMultiValueFieldType(field.type) && typeof value === "string"
    ? parseMultiString(value)
    : [value];
  const legal = new Set(field.enum!.values);
  return values.map((v) => String(v)).filter((v) => !legal.has(v));
};

// Structural clone that (unlike JSON) preserves `undefined` inside objects and
// NaN — so the READ-ONLY snapshot compares faithfully. Inputs never carry
// functions/cycles (ctx functions are excluded from the snapshot).
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

// ---------------------------------------------------------------------------
// Generators — a STRUCTURED (well-formed) case for the introspective
// invariants (isolation / declared-cause / empty-required), and a GARBAGE case
// for the pure robustness invariants (total / well-typed / determinism /
// malformed-guard) that must hold even for hostile, ill-typed input.
// ---------------------------------------------------------------------------

const FIELD_NAMES = [
  "alpha",
  "beta",
  "gamma",
  "status",
  "count",
  "active",
  "installed",
  "tags",
  "ref",
  "title",
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
  "tags-multi",
  "password",
] as const;

const ENUM_VOCAB = ["active", "spare", "retired", "on", "off"] as const;
const PATTERNS = ["^[a-z]+$", "^\\d+$", "^x", "(", ".*"] as const;
const FN_KEYS = Object.keys(filterFnTypes);

// A rich value pool that deliberately spans every branch of every check:
// missing forms (null/undefined/""/[]), coercible + un-coercible scalars,
// enum-legal + enum-illegal strings, multi encodings, and object/array shapes.
const VALUES: readonly unknown[] = [
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
  "ABC123",
  "FileTitle",
  null,
  undefined,
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
  const fn = chance(rng, 0.85) ? pick(rng, FN_KEYS) : "bogusFn";
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
  if (chance(rng, 0.5)) field.required = true;
  if (chance(rng, 0.5))
    field.enum = {
      values: sampleDistinct(rng, ENUM_VOCAB, randInt(rng, 1, 3)),
      strict: chance(rng, 0.7),
    };
  if (chance(rng, 0.35))
    field.unique = {
      scope: "database",
      ...(chance(rng, 0.4) ? { where: [genFilter(rng, FIELD_NAMES)] } : {}),
    };
  if (chance(rng, 0.35)) field.pattern = pick(rng, PATTERNS);
  if (chance(rng, 0.3)) field.title_binding = true;
  if (chance(rng, 0.4)) field.empty = pick(rng, ["absent", "empty-string"]);
  if (chance(rng, 0.35)) {
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
  // ~40% of invariants are constructed to DETERMINISTICALLY violate (a `require`
  // over an undeclared `ghost` field at severity "error" is fail-closed), so the
  // "invariant" code is reliably exercised by the coverage assertion.
  if (chance(rng, 0.4)) {
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

type StructuredCase = {
  schema: NotidianTypeProfile;
  row: Record<string, unknown>;
  patch: Record<string, unknown>;
  ctxData: {
    otherRows: Array<Record<string, unknown>>;
    refKeys: Set<string>;
    basename: string;
  };
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
  const row = genValueMap(rng, names, 0.85);
  const patch = genValueMap(rng, names, 0.4);

  const otherRows: Array<Record<string, unknown>> = [];
  const otherCount = randInt(rng, 0, 4);
  for (let i = 0; i < otherCount; i++)
    otherRows.push(genValueMap(rng, names, 0.9));
  // A reference resolver that recognizes a small, fixed key set — so most
  // FK values resolve to "broken" (reference-broken fires) but some resolve.
  const refKeys = new Set(["active", "42", "abc", "FileTitle"]);
  const basename = pick(rng, ["FileTitle", "Other", "active", "abc"]);

  return { schema, row, patch, ctxData: { otherRows, refKeys, basename } };
};

// A fully-wired, DETERMINISTIC ctx (used by declared-cause + empty/required).
const fullCtx = (data: StructuredCase["ctxData"]): ValidateRowCtx => ({
  getOtherRows: () => data.otherRows,
  resolveReferenceExists: (_ref: TypeProfileReference, value: unknown) =>
    data.refKeys.has(String(value)),
  basename: data.basename,
});

// A ctx variant whose three capabilities are all PRESENT but some may be
// hostile (throwing / garbage-returning / mistyped) — used by the isolation
// invariant, which must hold regardless of a capability's internal behavior.
const genCtxVariant = (rng: Rng, data: StructuredCase["ctxData"]): ValidateRowCtx => {
  const others = pick(rng, [0, 1, 2, 3]);
  const getOtherRows =
    others === 0
      ? () => data.otherRows
      : others === 1
      ? () => null as unknown as Array<Record<string, unknown>>
      : others === 2
      ? () => 5 as unknown as Array<Record<string, unknown>>
      : () => {
          throw new Error("getOtherRows blew up");
        };
  const refMode = pick(rng, [0, 1, 2]);
  const resolveReferenceExists =
    refMode === 0
      ? (_r: TypeProfileReference, v: unknown) => data.refKeys.has(String(v))
      : refMode === 1
      ? () => true
      : () => {
          throw new Error("resolver blew up");
        };
  const basename = pick(rng, [
    data.basename,
    "",
    42 as unknown as string,
    null as unknown as string,
  ]);
  return { getOtherRows, resolveReferenceExists, basename };
};

// ---------------------------------------------------------------------------
// Garbage generator — hostile schema/row/patch/ctx for the robustness net.
// ---------------------------------------------------------------------------

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
    // NOTE: deliberately NO null/undefined ELEMENT inside `fields` here — that
    // one class currently throws (unguarded deref at the fieldsByName Map
    // build) and is pinned separately as a KNOWN GAP + follow-up Notidian-iscd.
    // Non-object entries that the pushSafe wrapper DOES tolerate stay in-scope.
    { fields: [{}, { name: 1 }, { name: "x", type: {} }, 5] },
    {
      fields: [genField(rng, "alpha"), genField(rng, "beta")],
      invariants: "not-an-array",
    },
    {
      fields: [genField(rng, "gamma")],
      invariants: [null, {}, { require: [] }, genInvariant(rng, ["gamma"])],
    },
    {
      fields: [{ name: "__proto__", kind: "number", type: "number" }],
      invariants: [],
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

// ---------------------------------------------------------------------------
// Shared assertion: a single violation is well-typed (invariant d).
// ---------------------------------------------------------------------------

const assertWellTyped = (v: Violation): void => {
  expect(VALID_CODES.has(v.code)).toBe(true);
  expect(VALID_SEVERITIES.has(v.severity)).toBe(true);
  expect(VALID_TIERS.has(v.repairTier)).toBe(true);
  expect(typeof v.message).toBe("string");
  expect(v.message.length).toBeGreaterThan(0);
  if (v.field !== undefined) expect(typeof v.field).toBe("string");
  if (v.suggestedFix !== undefined) expect(typeof v.suggestedFix).toBe("string");
  for (const key of Object.keys(v)) expect(VIOLATION_KEYS.has(key)).toBe(true);
  // A field-less violation is ONLY ever a multi-field invariant or the guard.
  if (v.field === undefined)
    expect(v.code === "invariant" || v.code === "malformed-row").toBe(true);
};

// ===========================================================================
// (a) TOTAL — never throws; always returns a Violation[]; (d) WELL-TYPED.
// ===========================================================================

describe("validateRowPatch — TOTAL + well-typed (all inputs, incl. garbage)", () => {
  it("never throws and always returns a well-typed Violation[]", () => {
    for (let i = 0; i < PROPERTY_RUNS; i++) {
      const rng = makeRng(BASE_SEED + i);
      // Alternate structured and garbage inputs across the run.
      let schema: unknown;
      let row: unknown;
      let patch: unknown;
      let ctx: ValidateRowCtx | undefined;
      if (i % 2 === 0) {
        const c = genStructuredCase(rng);
        schema = c.schema;
        row = c.row;
        patch = c.patch;
        ctx = genCtxVariant(rng, c.ctxData);
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

      // The `validateRow` convenience overload must be equally total.
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
// (b) DETERMINISM + READ-ONLY + validateRow ≡ validateRowPatch(row, row).
// ===========================================================================

describe("validateRowPatch — deterministic, read-only, overload-equivalent", () => {
  it("returns identical violations for identical inputs (structured + garbage)", () => {
    for (let i = 0; i < PROPERTY_RUNS; i++) {
      const rng = makeRng(BASE_SEED + 7919 + i);
      const useStructured = i % 2 === 0;
      const c = genStructuredCase(makeRng(BASE_SEED + 7919 + i));
      const g = genGarbageCase(makeRng(BASE_SEED + 4243 + i));
      const schema = useStructured ? c.schema : (g.schema as NotidianTypeProfile);
      const row = (useStructured ? c.row : g.row) as Record<string, unknown>;
      const patch = (useStructured ? c.patch : g.patch) as Record<string, unknown>;
      const ctx = useStructured ? fullCtx(c.ctxData) : g.ctx;
      void rng;

      const first = validateRowPatch(schema, row, patch, ctx);
      const second = validateRowPatch(schema, row, patch, ctx);
      expect(second).toEqual(first);
    }
  });

  it("never mutates schema/row/patch/other-rows", () => {
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

  it("validateRow(s,r,c) equals validateRowPatch(s,r,r,c)", () => {
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
});

// ===========================================================================
// malformed-row guard — exact iff, and it is the SOLE violation when it fires.
// ===========================================================================

describe("validateRowPatch — malformed-row input guard", () => {
  it("emits malformed-row exactly when row/patch is not a plain object, as the only violation", () => {
    for (let i = 0; i < PROPERTY_RUNS; i++) {
      const g = genGarbageCase(makeRng(BASE_SEED + 31337 + i));
      const rowMalformed = !isPlainObject(g.row);
      const patchMalformed = g.patch != null && !isPlainObject(g.patch);
      const expected = rowMalformed || patchMalformed;

      const result = validateRowPatch(
        g.schema as NotidianTypeProfile,
        g.row as Record<string, unknown>,
        g.patch as Record<string, unknown>,
        g.ctx
      );
      const hasMalformed = result.some((v) => v.code === "malformed-row");
      expect(hasMalformed).toBe(expected);
      if (expected) {
        expect(result).toHaveLength(1);
        expect(result[0].code).toBe("malformed-row");
        expect(result[0].field).toBeUndefined();
        expect(result[0].severity).toBe("error");
      }
    }
  });
});

// ===========================================================================
// (c) ISOLATION — an under-wired ctx skips ONLY its own code, never another.
// ===========================================================================

describe("validateRowPatch — under-wired ctx isolation", () => {
  // For each ctx capability C owning code X: dropping C from an otherwise
  // identical ctx must (1) leave every non-X violation byte-identical, and
  // (2) remove every code-X violation (X is EXCLUSIVELY sourced from C).
  const assertIsolation = (
    withCap: Violation[],
    withoutCap: Violation[],
    ownedCode: ViolationCode
  ): void => {
    const strip = (vs: Violation[]) => vs.filter((v) => v.code !== ownedCode);
    expect(strip(withoutCap)).toEqual(strip(withCap));
    expect(withoutCap.some((v) => v.code === ownedCode)).toBe(false);
  };

  it("dropping getOtherRows / resolveReferenceExists / basename removes only its own code", () => {
    for (let i = 0; i < PROPERTY_RUNS; i++) {
      const c = genStructuredCase(makeRng(BASE_SEED + 2027 + i));
      const ctx = genCtxVariant(makeRng(BASE_SEED + 2027 + i + 1), c.ctxData);

      const full = validateRowPatch(c.schema, c.row, c.patch, { ...ctx });

      const noOthers: ValidateRowCtx = { ...ctx };
      delete noOthers.getOtherRows;
      assertIsolation(
        full,
        validateRowPatch(c.schema, c.row, c.patch, noOthers),
        "unique"
      );

      const noRef: ValidateRowCtx = { ...ctx };
      delete noRef.resolveReferenceExists;
      assertIsolation(
        full,
        validateRowPatch(c.schema, c.row, c.patch, noRef),
        "reference-broken"
      );

      const noBase: ValidateRowCtx = { ...ctx };
      delete noBase.basename;
      assertIsolation(
        full,
        validateRowPatch(c.schema, c.row, c.patch, noBase),
        "title-binding"
      );
    }
  });

  it("an empty ctx never suppresses non-ctx-gated codes vs a fully-wired ctx", () => {
    for (let i = 0; i < PROPERTY_RUNS; i++) {
      const c = genStructuredCase(makeRng(BASE_SEED + 6091 + i));
      const wired = validateRowPatch(c.schema, c.row, c.patch, fullCtx(c.ctxData));
      const bare = validateRowPatch(c.schema, c.row, c.patch, {});
      const ctxGated = new Set<ViolationCode>([
        "unique",
        "reference-broken",
        "title-binding",
      ]);
      const strip = (vs: Violation[]) => vs.filter((v) => !ctxGated.has(v.code));
      // Every violation NOT gated by a ctx capability is present with or
      // without ctx wiring — a missing capability never hides another field's
      // type/enum/required/pattern/empty-encoding/invariant finding.
      expect(strip(bare)).toEqual(strip(wired));
    }
  });
});

// ===========================================================================
// (e) DECLARED-CAUSE — each ViolationCode fires only from its declared cause,
// with a coverage assertion proving the per-code checks are non-vacuous.
// ===========================================================================

describe("validateRowPatch — each ViolationCode fires only from its declared cause", () => {
  it("every emitted violation is justified by its declared cause", () => {
    const seen = new Set<ViolationCode>();

    for (let i = 0; i < PROPERTY_RUNS; i++) {
      const c = genStructuredCase(makeRng(BASE_SEED + 8837 + i));
      const ctx = fullCtx(c.ctxData);
      const effective: Record<string, unknown> = { ...c.row, ...c.patch };
      const byName = new Map(c.schema.fields.map((f) => [f.name, f]));
      const result = validateRowPatch(c.schema, c.row, c.patch, ctx);

      for (const v of result) {
        seen.add(v.code);
        const field = v.field != null ? byName.get(v.field) : undefined;
        const value = field ? effective[field.name] : undefined;

        switch (v.code) {
          case "type": {
            // Only from a present value that fails its field's type profile;
            // a constrained type, or an object value on any scalar type.
            expect(field).toBeDefined();
            expect(isMissingValue(value)).toBe(false);
            expect(
              isConstrainedType(field!.type) || typeof value === "object"
            ).toBe(true);
            break;
          }
          case "enum": {
            // Only when the field declares a STRICT enum AND some element is
            // out of the declared set.
            expect(field).toBeDefined();
            expect(field!.enum?.strict).toBe(true);
            expect(isMissingValue(value)).toBe(false);
            expect(enumIllegalValues(field!, value).length).toBeGreaterThan(0);
            break;
          }
          case "required": {
            // Only a `required` field whose effective value is missing.
            expect(field).toBeDefined();
            expect(field!.required).toBe(true);
            expect(isMissingValue(value)).toBe(true);
            break;
          }
          case "pattern": {
            // Only a field with a compilable pattern the present value fails.
            expect(field).toBeDefined();
            expect(typeof field!.pattern).toBe("string");
            expect(isMissingValue(value)).toBe(false);
            expect(new RegExp(field!.pattern as string).test(String(value))).toBe(
              false
            );
            break;
          }
          case "title-binding": {
            // Only a title_binding field, a wired basename, and a mismatch.
            expect(field).toBeDefined();
            expect(field!.title_binding).toBe(true);
            expect(ctx.basename != null).toBe(true);
            const current = value == null ? "" : String(value);
            expect(current).not.toBe(ctx.basename);
            break;
          }
          case "empty-encoding": {
            // Only a policy-declared field with a policy-illegal empty encoding.
            expect(field).toBeDefined();
            expect(field!.empty === "absent" || field!.empty === "empty-string").toBe(
              true
            );
            const illegal =
              value === null ||
              (value === undefined && field!.empty === "empty-string") ||
              (value === "" && field!.empty === "absent");
            expect(illegal).toBe(true);
            break;
          }
          case "unique": {
            // Only a unique field with a wired getOtherRows and a present value.
            expect(field).toBeDefined();
            expect(field!.unique).toBeDefined();
            expect(typeof ctx.getOtherRows).toBe("function");
            expect(isMissingValue(value)).toBe(false);
            break;
          }
          case "reference-broken": {
            // Only a reference field whose wired resolver returns false.
            expect(field).toBeDefined();
            expect(field!.reference).toBeDefined();
            expect(typeof ctx.resolveReferenceExists).toBe("function");
            expect(isMissingValue(value)).toBe(false);
            expect(
              ctx.resolveReferenceExists!(field!.reference!, value)
            ).toBe(false);
            // Severity is derived from the reference's onBrokenWrite policy.
            expect(v.severity).toBe(
              field!.reference!.onBrokenWrite === "block" ? "error" : "warn"
            );
            break;
          }
          case "invariant": {
            // Only from a declared invariant; severity is a declared value.
            expect(c.schema.invariants.length).toBeGreaterThan(0);
            expect(VALID_SEVERITIES.has(v.severity)).toBe(true);
            break;
          }
          case "malformed-row": {
            // Never reachable from a structured (plain-object) row + patch.
            throw new Error("malformed-row from a well-formed structured case");
          }
          default: {
            throw new Error("unexpected violation code: " + v.code);
          }
        }
      }
    }

    // NON-VACUITY: across the random corpus, every field-attribute + invariant
    // code was actually observed — the per-code cause checks above are real,
    // not trivially-passing on an empty stream.
    for (const code of [
      "type",
      "enum",
      "required",
      "pattern",
      "title-binding",
      "empty-encoding",
      "unique",
      "reference-broken",
      "invariant",
    ] as ViolationCode[]) {
      expect(seen.has(code)).toBe(true);
    }
  });
});

// ===========================================================================
// (f) EMPTY-ENCODING vs REQUIRED interplay.
// ===========================================================================

describe("validateRowPatch — empty-encoding vs required interplay", () => {
  const schemaOf = (field: TypeProfileField): NotidianTypeProfile => ({
    fields: [field],
    kindFields: {},
    invariants: [],
    issues: [],
  });
  const codes = (vs: Violation[]) => vs.map((v) => v.code).sort();

  it("required + empty:'empty-string' + null => BOTH required and empty-encoding", () => {
    const schema = schemaOf({
      name: "x",
      kind: "text",
      type: "text",
      required: true,
      empty: "empty-string",
    });
    expect(codes(validateRow(schema, { x: null }))).toEqual([
      "empty-encoding",
      "required",
    ]);
  });

  it("required + empty:'absent' + '' => BOTH required and empty-encoding", () => {
    const schema = schemaOf({
      name: "x",
      kind: "text",
      type: "text",
      required: true,
      empty: "absent",
    });
    expect(codes(validateRow(schema, { x: "" }))).toEqual([
      "empty-encoding",
      "required",
    ]);
  });

  it("not-required + empty:'absent' + '' => empty-encoding only", () => {
    const schema = schemaOf({
      name: "x",
      kind: "text",
      type: "text",
      empty: "absent",
    });
    expect(codes(validateRow(schema, { x: "" }))).toEqual(["empty-encoding"]);
  });

  it("required + empty:'empty-string' + '' => required only ('' is a legal encoding)", () => {
    const schema = schemaOf({
      name: "x",
      kind: "text",
      type: "text",
      required: true,
      empty: "empty-string",
    });
    expect(codes(validateRow(schema, { x: "" }))).toEqual(["required"]);
  });

  it("property: a genuinely non-empty present value never yields required or empty-encoding", () => {
    for (let i = 0; i < PROPERTY_RUNS; i++) {
      const c = genStructuredCase(makeRng(BASE_SEED + 4801 + i));
      const effective: Record<string, unknown> = { ...c.row, ...c.patch };
      const result = validateRowPatch(c.schema, c.row, c.patch, fullCtx(c.ctxData));
      for (const v of result) {
        if (v.code !== "required" && v.code !== "empty-encoding") continue;
        const field = c.schema.fields.find((f) => f.name === v.field);
        if (!field) continue;
        const value = effective[field.name];
        // A non-missing value that is ALSO not a bare `null`/`""`/absent
        // encoding is a genuine value — it must not have produced either code.
        const isGenuineValue =
          !isMissingValue(value) &&
          value !== null &&
          value !== "" &&
          value !== undefined;
        expect(isGenuineValue).toBe(false);
      }
    }
  });
});

// ===========================================================================
// KNOWN GAP (follow-up: Notidian-iscd) — surfaced by this fuzzer.
//
// The adversarial contract promises validateRowPatch NEVER throws on a
// malformed schema, and the module already defends against `fields` not being
// an array. But a `fields` ARRAY holding a null/undefined ELEMENT is
// dereferenced unguarded at the fieldsByName Map build
// (validateRow.ts: `fields.map((field) => [field.name, field])`) — OUTSIDE the
// pushSafe wrapper — so it currently THROWS instead of degrading to skip.
// parseTypeProfile never emits such an element (each parsed field is a
// constructed object), so this is defensive-depth only, not a live-reachable
// crash — hence a routed follow-up bead rather than an in-bead product fix.
//
// This test PINS the current behavior so the gap stays visible: when
// Notidian-iscd lands, flip this to `.not.toThrow()` and re-add a null/
// undefined field element to `genGarbageSchema`'s pool so the TOTAL property
// covers it.
// ===========================================================================

describe("validateRowPatch — KNOWN GAP: null field entry (Notidian-iscd)", () => {
  it("currently throws on a null element inside schema.fields (pins the gap)", () => {
    const schema = {
      fields: [null],
      kindFields: {},
      invariants: [],
      issues: [],
    } as unknown as NotidianTypeProfile;
    expect(() => validateRowPatch(schema, {}, {})).toThrow();
  });

  it("currently throws on an undefined element inside schema.fields (pins the gap)", () => {
    const schema = {
      fields: [undefined],
      kindFields: {},
      invariants: [],
      issues: [],
    } as unknown as NotidianTypeProfile;
    expect(() => validateRowPatch(schema, {}, {})).toThrow();
  });
});
