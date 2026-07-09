import {
  Invariant,
  NotidianTypeProfile,
  TypeProfileField,
  TypeProfileIssue,
  normalizeRawFields,
  parseInvariants,
  parseTypeProfile,
  typeProfileSchemaType,
} from "core/utils/contexts/typeProfile";
import { filterFnTypes } from "core/utils/contexts/predicate/filterFns/filterFnTypes";

// ===========================================================================
// ADVERSARIAL + PROPERTY NET for the Type Profile SCHEMA PARSER
// (parseTypeProfile / normalizeRawFields / parseInvariants,
// src/core/utils/contexts/typeProfile.ts, ADR-0056 D1–D8, Notidian-loan.1).
//
// This is the PARSER end of the never-throws chain whose VALIDATOR end is
// pinned by validateRow.adversarial.test.ts (Notidian-vx6h / ADR-0057). The
// two are companions: parseTypeProfile turns untrusted hub-note frontmatter
// (Obsidian's metadata cache — never a typed source) into the
// `NotidianTypeProfile` that validateRowPatch then consumes without its own
// re-validation. So the shape parseTypeProfile guarantees IS validateRowPatch's
// precondition. Notidian-iscd hardened validateRowPatch to filter non-object
// field ELEMENTS at the source; this net proves the parser NEVER emits such an
// element in the first place — every returned field is a plain object with a
// string `name`, so the downstream `fields.map(f => f.name)` deref is total.
//
// Existing coverage (typeProfile.test.ts + typeProfileV3.test.ts) is
// example-based / happy-path / typed. This file is the adversarial companion —
// the same convention every safety-critical pure surface here carries
// (validateRow.adversarial, notidianSchema.adversarial, reconciler.adversarial,
// keyMatchRollup.adversarial.property, ...). It fuzzes hostile frontmatter
// (null/undefined, scalars, arrays, deeply-nested + huge objects, empty maps,
// a WRONG type for every documented field/attribute, JSON-string encodings,
// hostile keys) and asserts the two cross-cutting contracts that must hold for
// ALL inputs:
//
//   (1) TOTALITY  — parseTypeProfile / normalizeRawFields / parseInvariants
//                   NEVER throw on any input, and each returns a value of its
//                   declared shape (a NotidianTypeProfile|null, a plain
//                   object|null, an Invariant[]).
//   (2) OUTPUT INVARIANTS — the exact structural guarantees the downstream
//                   never-throws contract relies on:
//                     - profile.fields is an array with NO null/undefined
//                       element; every element is a PLAIN OBJECT (iscd's
//                       precondition), and field.name is ALWAYS a string.
//                     - enum.values is always string[] (non-empty) when present;
//                       unique / reference / derived / pattern / options /
//                       empty / title_binding are well-formed or absent — never
//                       a half-parsed garbage shape.
//                     - kindFields is a Record of well-formed field arrays.
//                     - invariants are well-formed Filter-DSL rules; issues are
//                       well-formed diagnostics.
//   plus DETERMINISM (pure: same input => equal output) and READ-ONLY (the
//   input frontmatter is never mutated).
//
// CHARACTERIZATION — no production code is changed unless the fuzzer surfaces a
// real totality/shape gap; then it is fixed in place with the defensive-skip
// posture parseTypeProfile already uses. As of this commit none was surfaced.
// CONVENTION: hand-rolled mulberry32 PRNG + fixed seed + PROPERTY_RUNS loop,
// NO fast-check (repo convention) — fixed seed => the suite is deterministic.
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

const BASE_SEED = 0x7ea5;
const PROPERTY_RUNS = 600;

// ---------------------------------------------------------------------------
// Declared closed sets (mirrors of the module's own type unions) — used to
// justify that every emitted shape is a DECLARED member, not garbage that
// merely happened to survive. Deliberate independent re-derivations so a drift
// in the production contract surfaces here as a failing shape-check.
// ---------------------------------------------------------------------------

const VALID_ISSUE_REASONS: ReadonlySet<string> = new Set([
  "missing-fields",
  "invalid-field",
  "unknown-kind",
  "invalid-enum",
  "invalid-unique",
  "invalid-pattern",
  "invalid-title-binding",
  "invalid-empty-policy",
  "invalid-reference",
  "invalid-derived",
  "cyclic-derived",
  "invalid-filter",
  "unknown-filter-fn",
  "invalid-invariant",
  "invalid-invariants-block",
]);

// The exact set of own keys parseFieldsMap ever emits on a TypeProfileField.
const VALID_FIELD_KEYS: ReadonlySet<string> = new Set([
  "name",
  "kind",
  "type",
  "options",
  "required",
  "value",
  "enum",
  "unique",
  "pattern",
  "title_binding",
  "empty",
  "reference",
  "derived",
  "extra",
]);

const VALID_INVARIANT_KEYS: ReadonlySet<string> = new Set([
  "when",
  "require",
  "severity",
  "message",
  "autofix",
]);

const VALID_FILTER_KEYS: ReadonlySet<string> = new Set([
  "field",
  "fn",
  "value",
  "fType",
]);

const KNOWN_FILTER_FNS = new Set(Object.keys(filterFnTypes));

// The `kind` values the parser maps to a real type (everything else degrades to
// text + an unknown-kind diagnostic — never a throw).
const KNOWN_KINDS = [
  "text",
  "select",
  "multi_select",
  "date",
  "number",
  "checkbox",
  "link",
  "url",
  "relation",
  "path",
  "password",
] as const;

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);

// ---------------------------------------------------------------------------
// Well-formedness assertions — the precise post-parse contract each shape must
// satisfy. These are the OUTPUT INVARIANTS (2). They are intentionally strict:
// a partially-parsed or garbage-passthrough shape must FAIL them.
// ---------------------------------------------------------------------------

const assertFilterWellFormed = (raw: unknown): void => {
  expect(isPlainObject(raw)).toBe(true);
  const f = raw as Record<string, unknown>;
  expect(typeof f.field).toBe("string");
  expect((f.field as string).length).toBeGreaterThan(0);
  expect(typeof f.fn).toBe("string");
  expect(KNOWN_FILTER_FNS.has(f.fn as string)).toBe(true);
  expect(typeof f.value).toBe("string");
  expect(typeof f.fType).toBe("string");
  for (const key of Object.keys(f)) expect(VALID_FILTER_KEYS.has(key)).toBe(true);
};

const assertFieldWellFormed = (field: unknown): void => {
  // The LINCHPIN Notidian-iscd relies on: never null/undefined, always a plain
  // object, with a string `name`. validateRowPatch derefs field.name unguarded.
  expect(field == null).toBe(false);
  expect(isPlainObject(field)).toBe(true);
  const f = field as TypeProfileField & Record<string, unknown>;
  expect(typeof f.name).toBe("string");
  expect((f.name as string).length).toBeGreaterThan(0);
  expect(typeof f.kind).toBe("string");
  expect(typeof f.type).toBe("string");

  if (f.options !== undefined) {
    expect(Array.isArray(f.options)).toBe(true);
    for (const o of f.options as unknown[]) expect(typeof o).toBe("string");
  }
  if (f.required !== undefined) expect(typeof f.required).toBe("boolean");
  if (f.value !== undefined) expect(typeof f.value).toBe("string");

  if (f.enum !== undefined) {
    expect(isPlainObject(f.enum)).toBe(true);
    const e = f.enum as { values: unknown; strict: unknown };
    expect(Array.isArray(e.values)).toBe(true);
    expect((e.values as unknown[]).length).toBeGreaterThan(0);
    for (const v of e.values as unknown[]) expect(typeof v).toBe("string");
    expect(typeof e.strict).toBe("boolean");
  }

  if (f.unique !== undefined) {
    expect(isPlainObject(f.unique)).toBe(true);
    const u = f.unique as { scope: unknown; where?: unknown };
    expect(u.scope).toBe("database");
    if (u.where !== undefined) {
      expect(Array.isArray(u.where)).toBe(true);
      for (const w of u.where as unknown[]) assertFilterWellFormed(w);
    }
  }

  if (f.pattern !== undefined) {
    expect(typeof f.pattern).toBe("string");
    expect((f.pattern as string).length).toBeGreaterThan(0);
    // The parser only ever keeps a pattern that compiles.
    expect(() => new RegExp(f.pattern as string)).not.toThrow();
  }

  if (f.title_binding !== undefined)
    expect(typeof f.title_binding).toBe("boolean");

  if (f.empty !== undefined)
    expect(f.empty === "absent" || f.empty === "empty-string").toBe(true);

  if (f.reference !== undefined) {
    expect(isPlainObject(f.reference)).toBe(true);
    const r = f.reference as Record<string, unknown>;
    expect(typeof r.targetFolder).toBe("string");
    expect((r.targetFolder as string).length).toBeGreaterThan(0);
    expect(typeof r.targetKey).toBe("string");
    expect((r.targetKey as string).length).toBeGreaterThan(0);
    expect(r.onBrokenWrite === "block" || r.onBrokenWrite === "warn").toBe(true);
    expect(
      r.onReferencedChange === "warn" || r.onReferencedChange === "cascade-preview"
    ).toBe(true);
  }

  if (f.derived !== undefined) {
    expect(isPlainObject(f.derived)).toBe(true);
    const d = f.derived as Record<string, unknown>;
    expect(
      d.kind === "template" || d.kind === "lookup" || d.kind === "rollup"
    ).toBe(true);
    expect(isPlainObject(d.spec)).toBe(true);
    expect(d.materialize === "none" || d.materialize === "frontmatter").toBe(true);
  }

  if (f.extra !== undefined) expect(isPlainObject(f.extra)).toBe(true);

  for (const key of Object.keys(f)) expect(VALID_FIELD_KEYS.has(key)).toBe(true);
};

const assertInvariantWellFormed = (raw: unknown): void => {
  expect(isPlainObject(raw)).toBe(true);
  const inv = raw as Invariant & Record<string, unknown>;
  expect(Array.isArray(inv.require)).toBe(true);
  expect((inv.require as unknown[]).length).toBeGreaterThan(0);
  for (const r of inv.require as unknown[]) assertFilterWellFormed(r);
  if (inv.when !== undefined) {
    expect(Array.isArray(inv.when)).toBe(true);
    // parseInvariant only attaches `when` when it is a NON-EMPTY filter list.
    expect((inv.when as unknown[]).length).toBeGreaterThan(0);
    for (const w of inv.when as unknown[]) assertFilterWellFormed(w);
  }
  expect(inv.severity === "error" || inv.severity === "warn").toBe(true);
  expect(typeof inv.message).toBe("string");
  expect((inv.message as string).length).toBeGreaterThan(0);
  if (inv.autofix !== undefined) {
    expect(typeof inv.autofix).toBe("string");
    expect((inv.autofix as string).length).toBeGreaterThan(0);
  }
  for (const key of Object.keys(inv))
    expect(VALID_INVARIANT_KEYS.has(key)).toBe(true);
};

const assertIssueWellFormed = (raw: unknown): void => {
  expect(isPlainObject(raw)).toBe(true);
  const issue = raw as TypeProfileIssue & Record<string, unknown>;
  expect(typeof issue.reason).toBe("string");
  expect(VALID_ISSUE_REASONS.has(issue.reason as string)).toBe(true);
};

const assertProfileWellFormed = (profile: NotidianTypeProfile): void => {
  if (profile.database !== undefined)
    expect(typeof profile.database).toBe("string");

  expect(Array.isArray(profile.fields)).toBe(true);
  for (const field of profile.fields) assertFieldWellFormed(field);

  expect(isPlainObject(profile.kindFields)).toBe(true);
  for (const list of Object.values(profile.kindFields)) {
    expect(Array.isArray(list)).toBe(true);
    for (const field of list) assertFieldWellFormed(field);
  }

  expect(Array.isArray(profile.invariants)).toBe(true);
  for (const inv of profile.invariants) assertInvariantWellFormed(inv);

  expect(Array.isArray(profile.issues)).toBe(true);
  for (const issue of profile.issues) assertIssueWellFormed(issue);

  // The downstream never-throws linchpin, exercised concretely: validateRowPatch
  // builds a by-name index over profile.fields and derefs field.name. Prove
  // that exact deref is total on every fuzzed profile.
  expect(() => {
    const byName = new Map<string, TypeProfileField>();
    for (const f of profile.fields) byName.set(f.name.toLowerCase(), f);
    void byName.size;
  }).not.toThrow();
};

// Structural clone that (unlike JSON) preserves `undefined` inside objects and
// NaN — so the READ-ONLY snapshot compares faithfully. Fuzzed inputs never
// carry functions or cycles.
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
// Garbage generators — hostile frontmatter for the robustness net. A rich mix
// of scalars, arrays, deeply-nested + huge objects, empties, JSON-string
// encodings, hostile keys, and a WRONG type per documented field/attribute,
// deliberately interleaved with occasionally-VALID shapes so the output
// invariants are exercised over populated (non-vacuous) profiles too.
// ---------------------------------------------------------------------------

const HOSTILE_KEYS = ["__proto__", "constructor", "prototype", "toString", ""];

const SCALARS: readonly unknown[] = [
  null,
  undefined,
  0,
  1,
  -1,
  42,
  NaN,
  Infinity,
  true,
  false,
  "",
  "x",
  "block",
  "warn",
  "absent",
  "empty-string",
  "template",
  "database",
  "notidian_type_profile",
  "^[a-z]+$",
  "(", // an invalid regex — parsePatternAttr must reject via try/catch.
];

const genGarbageValue = (rng: Rng, depth: number): unknown => {
  if (depth > 5 || chance(rng, 0.55)) return pick(rng, SCALARS);
  if (chance(rng, 0.5)) {
    const arr: unknown[] = [];
    const n = randInt(rng, 0, 4);
    for (let i = 0; i < n; i++) arr.push(genGarbageValue(rng, depth + 1));
    return arr;
  }
  const obj: Record<string, unknown> = {};
  const n = randInt(rng, 0, 4);
  for (let i = 0; i < n; i++) {
    const key = chance(rng, 0.25) ? pick(rng, HOSTILE_KEYS) : "k" + i;
    obj[key] = genGarbageValue(rng, depth + 1);
  }
  return obj;
};

// A deeply-nested object (linear chain) — probes recursion / deref depth.
const genDeeplyNested = (depth: number): unknown => {
  let node: unknown = { leaf: true };
  for (let i = 0; i < depth; i++) node = { nested: node, i };
  return node;
};

// A wide/huge map — probes large-input handling without a contrived size that
// would only ever fail via unrelated engine limits.
const genHuge = (rng: Rng, width: number): Record<string, unknown> => {
  const out: Record<string, unknown> = {};
  for (let i = 0; i < width; i++) out["f" + i] = pick(rng, SCALARS);
  return out;
};

// One field-def value: sometimes a wholly-wrong type (scalar/array), sometimes
// a plausible object with each documented attribute present at a RANDOM type.
const genFieldDef = (rng: Rng): unknown => {
  if (chance(rng, 0.2)) return pick(rng, SCALARS); // not an object at all
  if (chance(rng, 0.1)) return genGarbageValue(rng, 1);
  const def: Record<string, unknown> = {};
  // kind: valid, unknown, or wrong-typed.
  if (chance(rng, 0.85))
    def.kind = chance(rng, 0.7)
      ? pick(rng, KNOWN_KINDS)
      : pick(rng, ["mystery-kind", 42, {}, [], "", null]);
  if (chance(rng, 0.4))
    def.options = chance(rng, 0.6)
      ? ["a", "b", 3, null] // mixed — parser String()-coerces every element
      : pick(rng, [5, "nope", {}, null]);
  if (chance(rng, 0.4)) def.required = pick(rng, [true, false, 1, "yes", null, {}]);
  if (chance(rng, 0.4)) def.value = pick(rng, ["v", 7, false, null, {}, ["a"]]);
  if (chance(rng, 0.5))
    def.enum = chance(rng, 0.45)
      ? { values: ["on", "off"], strict: chance(rng, 0.5) } // valid
      : pick(rng, [
          { values: [], strict: true }, // empty values -> reject
          { values: ["x", 3], strict: true }, // non-string element -> reject
          { values: ["x"], strict: "yes" }, // strict not boolean -> reject
          { values: "on,off", strict: true }, // values not array -> reject
          { strict: true }, // missing values -> reject
          5,
          null,
        ]);
  if (chance(rng, 0.4))
    def.unique = chance(rng, 0.4)
      ? {
          scope: "database",
          ...(chance(rng, 0.5)
            ? {
                where: [
                  {
                    field: "status",
                    fn: pick(rng, [...KNOWN_FILTER_FNS]),
                    value: "x",
                    fType: "text",
                  },
                ],
              }
            : {}),
        } // valid
      : pick(rng, [
          { scope: "global" }, // wrong scope -> reject
          { scope: "database", where: "nope" }, // where not array -> reject
          { scope: "database", where: [{ field: "", fn: "is", value: "x", fType: "t" }] }, // empty field -> reject
          { scope: "database", where: [{ field: "s", fn: "bogusFn", value: "x", fType: "t" }] }, // unknown fn -> reject
          "database",
          null,
        ]);
  if (chance(rng, 0.4))
    def.pattern = pick(rng, ["^[a-z]+$", "\\d+", "(", "", 42, {}, null]);
  if (chance(rng, 0.3))
    def.title_binding = pick(rng, [true, false, "true", 1, null, {}]);
  if (chance(rng, 0.3))
    def.empty = pick(rng, ["absent", "empty-string", "maybe", 3, null, {}]);
  if (chance(rng, 0.4))
    def.reference = chance(rng, 0.4)
      ? {
          targetFolder: "Targets",
          targetKey: "id",
          onBrokenWrite: pick(rng, ["block", "warn"]),
          onReferencedChange: pick(rng, ["warn", "cascade-preview"]),
        } // valid
      : pick(rng, [
          { targetFolder: "", targetKey: "id", onBrokenWrite: "block", onReferencedChange: "warn" },
          { targetFolder: "T", targetKey: "id", onBrokenWrite: "explode", onReferencedChange: "warn" },
          { targetFolder: "T", targetKey: 5, onBrokenWrite: "block", onReferencedChange: "warn" },
          { targetFolder: "T", onBrokenWrite: "block", onReferencedChange: "warn" },
          42,
          null,
        ]);
  if (chance(rng, 0.4))
    def.derived = chance(rng, 0.4)
      ? {
          kind: pick(rng, ["template", "lookup", "rollup"]),
          spec: chance(rng, 0.5) ? { template: "{status}" } : {},
          materialize: pick(rng, ["none", "frontmatter"]),
        } // valid
      : pick(rng, [
          { kind: "mystery", spec: {}, materialize: "none" },
          { kind: "template", spec: "not-an-object", materialize: "none" },
          { kind: "template", spec: {}, materialize: "sometimes" },
          { spec: {}, materialize: "none" },
          7,
          null,
        ]);
  // Forward-compat: a random unknown attribute that must round-trip to `extra`.
  if (chance(rng, 0.35)) def["x_custom_" + randInt(rng, 0, 9)] = genGarbageValue(rng, 2);
  return def;
};

// A `fields` / `kind_fields.<kind>` map value — usually an object of field
// defs, but sometimes a scalar/array/JSON-string/huge/deeply-nested shape.
const genFieldsMap = (rng: Rng): unknown => {
  const shape = randInt(rng, 0, 9);
  switch (shape) {
    case 0:
      return pick(rng, SCALARS); // wholly wrong type
    case 1:
      return []; // array, not a map
    case 2:
      return {}; // empty map -> no fields
    case 3:
      return genDeeplyNested(randInt(rng, 3, 8));
    case 4:
      return genHuge(rng, randInt(rng, 20, 120));
    case 5: {
      // A JSON-STRING encoding (Obsidian metadata cache surfaces nested YAML
      // this way) — valid or intentionally broken JSON.
      if (chance(rng, 0.5))
        return JSON.stringify({ a: { kind: "text" }, b: { kind: "select", options: ["x"] } });
      return '{ broken json '; // safelyParseJSON returns undefined -> null map
    }
    default: {
      const out: Record<string, unknown> = {};
      const n = randInt(rng, 1, 5);
      for (let i = 0; i < n; i++) {
        const name = chance(rng, 0.2)
          ? pick(rng, HOSTILE_KEYS)
          : pick(rng, ["status", "count", "active", "ref", "title", "alpha", "beta"]);
        out[name] = genFieldDef(rng);
      }
      return out;
    }
  }
};

// One invariant list entry — an object with each field present at a random
// type, or a wholly-wrong scalar/array.
const genInvariantEntry = (rng: Rng): unknown => {
  if (chance(rng, 0.25)) return pick(rng, SCALARS);
  const validFilter = () => ({
    field: pick(rng, ["status", "count", "ref"]),
    fn: pick(rng, [...KNOWN_FILTER_FNS]),
    value: pick(rng, ["", "x", "1"]),
    fType: pick(rng, ["text", "number", "value"]),
  });
  const filterOrGarbage = () =>
    chance(rng, 0.6)
      ? validFilter()
      : pick(rng, [
          { field: "", fn: "is", value: "x", fType: "t" }, // empty field
          { field: "s", fn: "bogusFn", value: "x", fType: "t" }, // unknown fn
          { field: "s", fn: "is", value: 5, fType: "t" }, // value not string
          "nope",
          null,
          42,
        ]);
  const entry: Record<string, unknown> = {};
  if (chance(rng, 0.5))
    entry.when = chance(rng, 0.6)
      ? [filterOrGarbage()]
      : pick(rng, ["nope", 5, {}, null]);
  entry.require = chance(rng, 0.7)
    ? [filterOrGarbage()]
    : pick(rng, [[], "nope", 5, {}, null]); // empty/absent/mistyped require -> reject
  if (chance(rng, 0.8))
    entry.severity = pick(rng, ["error", "warn", "fatal", 3, null]);
  if (chance(rng, 0.8))
    entry.message = pick(rng, ["msg", "", 42, null, {}]);
  if (chance(rng, 0.4))
    entry.autofix = pick(rng, ["fix", "", 7, null, {}]);
  return entry;
};

// A whole `invariants:` block value.
const genInvariantsBlock = (rng: Rng): unknown => {
  const shape = randInt(rng, 0, 6);
  switch (shape) {
    case 0:
      return pick(rng, SCALARS); // not a list
    case 1:
      return {}; // object, not array -> invalid-invariants-block
    case 2:
      return []; // empty list -> no invariants, no block issue
    case 3:
      return JSON.stringify([
        { require: [{ field: "s", fn: "isNotEmpty", value: "", fType: "text" }], severity: "error", message: "m" },
      ]); // JSON-string encoding
    case 4:
      return "{ broken";
    default: {
      const arr: unknown[] = [];
      const n = randInt(rng, 1, 5);
      for (let i = 0; i < n; i++) arr.push(genInvariantEntry(rng));
      return arr;
    }
  }
};

// A whole hostile frontmatter object. The schema_type marker is present in the
// large majority (so the parser BODY is exercised, not just its early return);
// a minority omit / corrupt it (so the guard's null-return is exercised too).
const genFrontmatter = (rng: Rng): unknown => {
  // A minority: not even an object (parseTypeProfile still must not throw).
  if (chance(rng, 0.08)) return pick(rng, SCALARS.concat([[1, 2, 3], []]));
  const fm: Record<string, unknown> = {};
  if (chance(rng, 0.9)) fm.schema_type = typeProfileSchemaType;
  else fm.schema_type = pick(rng, ["other", 5, null, undefined]);
  if (chance(rng, 0.5)) fm.slug = pick(rng, ["reviews", 5, null, {}, ["a"]]);
  if (chance(rng, 0.5)) fm.database = pick(rng, ["Reviews", 5, null, {}, ["a"]]);
  if (chance(rng, 0.9)) fm.fields = genFieldsMap(rng);
  if (chance(rng, 0.5)) fm.kind_fields = genKindFields(rng);
  if (chance(rng, 0.6)) fm.invariants = genInvariantsBlock(rng);
  // Occasionally inject a huge/deeply-nested top-level noise key.
  if (chance(rng, 0.15)) fm["noise"] = genDeeplyNested(randInt(rng, 4, 9));
  return fm;
};

const genKindFields = (rng: Rng): unknown => {
  const shape = randInt(rng, 0, 5);
  if (shape === 0) return pick(rng, SCALARS);
  if (shape === 1) return []; // array -> invalid-field(kind_fields)
  if (shape === 2) return {}; // empty
  const out: Record<string, unknown> = {};
  const n = randInt(rng, 1, 3);
  for (let i = 0; i < n; i++) {
    const kindName = pick(rng, ["task", "note", "event", ""]);
    out[kindName] = genFieldsMap(rng);
  }
  return out;
};

const callParse = (fm: unknown): NotidianTypeProfile | null =>
  parseTypeProfile(fm as Record<string, unknown> | null | undefined);

// ===========================================================================
// (1) TOTALITY — the three parser entry points never throw on any input, and
// each returns a value of its declared shape.
// ===========================================================================

describe("typeProfile parser — TOTAL (never throws on any input)", () => {
  it("parseTypeProfile never throws and returns NotidianTypeProfile | null", () => {
    for (let i = 0; i < PROPERTY_RUNS; i++) {
      const rng = makeRng(BASE_SEED + i);
      const fm = genFrontmatter(rng);
      let result: NotidianTypeProfile | null = null;
      expect(() => {
        result = callParse(fm);
      }).not.toThrow();
      // Either null (no marker / non-object) or a well-formed profile.
      expect(result === null || isPlainObject(result)).toBe(true);
    }
  });

  it("normalizeRawFields never throws and returns a plain object | null", () => {
    for (let i = 0; i < PROPERTY_RUNS; i++) {
      const rng = makeRng(BASE_SEED + 4001 + i);
      // Feed both bare field-map shapes and arbitrary garbage values.
      const input = chance(rng, 0.5) ? genFieldsMap(rng) : genGarbageValue(rng, 0);
      let out: Record<string, unknown> | null = null;
      expect(() => {
        out = normalizeRawFields(input);
      }).not.toThrow();
      expect(out === null || isPlainObject(out)).toBe(true);
      // When non-null it is ALWAYS a non-array object (the fieldsByName build
      // downstream iterates Object.entries — an array would corrupt names).
      if (out !== null) expect(Array.isArray(out)).toBe(false);
    }
  });

  it("parseInvariants never throws and returns a well-formed Invariant[]", () => {
    for (let i = 0; i < PROPERTY_RUNS; i++) {
      const rng = makeRng(BASE_SEED + 8009 + i);
      const block = genInvariantsBlock(rng);
      const issues: TypeProfileIssue[] = [];
      let out: Invariant[] = [];
      expect(() => {
        out = parseInvariants(block, issues);
      }).not.toThrow();
      expect(Array.isArray(out)).toBe(true);
      for (const inv of out) assertInvariantWellFormed(inv);
      for (const issue of issues) assertIssueWellFormed(issue);
    }
  });

  it("parseTypeProfile tolerates deeply-nested and huge frontmatter", () => {
    const cases: unknown[] = [
      { schema_type: typeProfileSchemaType, fields: genDeeplyNested(200) },
      { schema_type: typeProfileSchemaType, fields: genHuge(makeRng(1), 500) },
      {
        schema_type: typeProfileSchemaType,
        kind_fields: { k: genHuge(makeRng(2), 300) },
        invariants: Array.from({ length: 200 }, () => ({
          require: [] as unknown[],
          severity: "error",
          message: "",
        })),
      },
      { schema_type: typeProfileSchemaType, fields: genDeeplyNested(50), invariants: genDeeplyNested(50) },
    ];
    for (const fm of cases) {
      let out: NotidianTypeProfile | null = null;
      expect(() => {
        out = callParse(fm);
      }).not.toThrow();
      if (out !== null) assertProfileWellFormed(out);
    }
  });
});

// ===========================================================================
// (2) OUTPUT INVARIANTS — every non-null profile satisfies the exact
// structural contract the downstream never-throws chain relies on. The
// coverage assertion at the end proves the checks are NON-VACUOUS (populated
// enum/reference/derived/unique/pattern/options/extra/invariant shapes and a
// non-null profile with >=1 field were actually observed).
// ===========================================================================

describe("typeProfile parser — OUTPUT INVARIANTS (downstream never-throws precondition)", () => {
  it("every returned profile is well-formed; every field is a plain object with a string name", () => {
    const seen = {
      profileWithFields: false,
      enum: false,
      reference: false,
      derived: false,
      unique: false,
      pattern: false,
      options: false,
      extra: false,
      invariant: false,
      kindField: false,
      issue: false,
    };

    for (let i = 0; i < PROPERTY_RUNS; i++) {
      const rng = makeRng(BASE_SEED + 20011 + i);
      const fm = genFrontmatter(rng);
      const profile = callParse(fm);
      if (profile === null) continue;
      assertProfileWellFormed(profile);

      if (profile.fields.length > 0) seen.profileWithFields = true;
      if (profile.issues.length > 0) seen.issue = true;
      if (profile.invariants.length > 0) seen.invariant = true;
      if (Object.values(profile.kindFields).some((l) => l.length > 0))
        seen.kindField = true;
      for (const f of profile.fields) {
        if (f.enum) seen.enum = true;
        if (f.reference) seen.reference = true;
        if (f.derived) seen.derived = true;
        if (f.unique) seen.unique = true;
        if (f.pattern) seen.pattern = true;
        if (f.options) seen.options = true;
        if (f.extra) seen.extra = true;
      }
    }

    // Non-vacuity: the fuzzer must actually exercise each populated branch, or
    // the invariant assertions above would be trivially satisfied.
    for (const [key, hit] of Object.entries(seen))
      expect([key, hit]).toEqual([key, true]);
  });
});

// ===========================================================================
// DETERMINISM + READ-ONLY — parseTypeProfile is pure: identical input yields
// an equal profile, and the input frontmatter is never mutated.
// ===========================================================================

describe("typeProfile parser — deterministic + read-only", () => {
  it("returns an equal profile for the identical input, twice", () => {
    for (let i = 0; i < PROPERTY_RUNS; i++) {
      const rng = makeRng(BASE_SEED + 33301 + i);
      const fm = genFrontmatter(rng);
      const first = callParse(fm);
      const second = callParse(fm);
      expect(second).toEqual(first);
    }
  });

  it("never mutates the input frontmatter", () => {
    for (let i = 0; i < PROPERTY_RUNS; i++) {
      const rng = makeRng(BASE_SEED + 44403 + i);
      const fm = genFrontmatter(rng);
      // Only object inputs can be structurally snapshotted / mutated.
      if (!isPlainObject(fm)) continue;
      const snapshot = clone(fm);
      callParse(fm);
      expect(fm).toEqual(snapshot);
    }
  });
});
