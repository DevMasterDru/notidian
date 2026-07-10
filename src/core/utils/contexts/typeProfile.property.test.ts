import {
  Invariant,
  NotidianTypeProfile,
  TypeProfileField,
  TypeProfileSchemaChange,
  parseTypeProfile,
  planFieldsMirror,
  planTypeProfileMirror,
  serializeTypeProfileField,
  typeProfileSchemaType,
} from "core/utils/contexts/typeProfile";
import { filterFnTypes } from "core/utils/contexts/predicate/filterFns/filterFnTypes";

// ===========================================================================
// PROPERTY NET for the Type Profile v3 PARSER + MIRROR
// (parseTypeProfile / serializeTypeProfileField / planTypeProfileMirror /
// planFieldsMirror — src/core/utils/contexts/typeProfile.ts, ADR-0056,
// Notidian-loan.1; bd Notidian-iqvx).
//
// This is the SEEDED property companion to the hostile-input fuzzer in the
// sibling typeProfile.adversarial.test.ts. That file proves the PARSER is
// TOTAL and shape-safe on garbage frontmatter; this file drives WELL-FORMED-
// leaning v3 profile SOURCES (fields / enums / references / required /
// derived / unique / pattern / kind_fields / invariants, with a malformed
// minority) and locks the two round-trip contracts the adversarial file does
// NOT: parse -> serialize -> parse is a fixpoint, and the table -> hub mirror
// is idempotent once applied. It re-states TOTAL + STABLE here too so this net
// stands on its own for the four contracts the bead pins.
//
// The four properties, over randomized profile-source shapes:
//
//   (1) TOTAL    — parseTypeProfile never throws on any generated source and
//                  returns a NotidianTypeProfile | null of its declared shape.
//   (2) STABLE   — parseTypeProfile is pure: the same source parses to an
//                  equal profile, every time.
//   (3) ROUND-TRIP FIXPOINT — re-serializing a parsed profile with the
//                  production serializeTypeProfileField (+ the invariant/kind
//                  inverse below) and re-parsing reproduces the profile's
//                  STRUCTURE (fields, kindFields, invariants, database). The
//                  clean re-parse is additionally a FIXPOINT: applying the
//                  round-trip a second time changes nothing at all (issues
//                  included), so serialize/parse reach a stable normal form.
//   (4) MIRROR IDEMPOTENCE — computing the table->hub mirror for a schema
//                  change is deterministic, and once its plan is applied
//                  (threaded exactly as mirrorSchemaChangeToTypeProfile threads
//                  nextState), recomputing the SAME change reports no further
//                  change — no spurious second write / echo loop.
//
// CHARACTERIZATION, not correction: no production code changes. A failure here
// is a real fixpoint/idempotence gap to pin, not a test to relax.
// CONVENTION: hand-rolled mulberry32 PRNG + fixed seed + PROPERTY_RUNS loop,
// NO fast-check (repo convention) — a fixed seed keeps the suite deterministic.
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

const BASE_SEED = 0x1a5c;
const PROPERTY_RUNS = 400;

const KNOWN_FILTER_FNS = Object.keys(filterFnTypes);

// Every `kind` the parser maps to a real column type, plus a couple of unknown
// kinds. Unknown kinds are deliberately included: the parser keeps the raw
// kind verbatim (degrading `type` to text with a diagnostic), so they must
// still round-trip through serialize -> parse unchanged.
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
const UNKNOWN_KINDS = ["mystery", "gauge", "future_kind"] as const;

// The `type` values a mirror add-column may carry; typeProfileKindForType maps
// each back to a `kind` when materializing the new hub field-def.
const MIRROR_TYPES = [
  "text",
  "option",
  "option-multi",
  "date",
  "number",
  "boolean",
  "link",
  "password",
] as const;

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);

// ---------------------------------------------------------------------------
// SOURCE GENERATORS — well-formed-leaning v3 hub frontmatter with a malformed
// minority. Field-name KEYS are drawn from a safe pool (hostile keys are the
// adversarial file's concern); values exercise every documented v3 attribute
// both valid and, occasionally, malformed so the parser's degrade path is hit.
// ---------------------------------------------------------------------------

const NAME_POOL = [
  "status",
  "count",
  "active",
  "ref",
  "title",
  "alpha",
  "beta",
  "gamma",
  "owner",
  "slug_field",
];

// A distinct set of field names for one map — no case-collisions, so the
// generated schema is unambiguous (round-trip robustness to collisions is
// proven separately in the adversarial net).
const genFieldNames = (rng: Rng, n: number): string[] => {
  const names: string[] = [];
  const used = new Set<string>();
  let guard = 0;
  while (names.length < n && guard++ < 50) {
    const base = pick(rng, NAME_POOL);
    const name = names.length && chance(rng, 0.5) ? base + "_" + names.length : base;
    if (used.has(name.toLowerCase())) continue;
    used.add(name.toLowerCase());
    names.push(name);
  }
  return names;
};

const genValidFilter = (rng: Rng): Record<string, unknown> => ({
  field: pick(rng, ["status", "count", "ref"]),
  fn: pick(rng, KNOWN_FILTER_FNS),
  value: pick(rng, ["", "x", "1", "done"]),
  fType: pick(rng, ["text", "number", "value"]),
});

const genEnum = (rng: Rng): unknown =>
  chance(rng, 0.85)
    ? { values: pick(rng, [["on", "off"], ["a", "b", "c"], ["x"]]), strict: chance(rng, 0.5) }
    : pick(rng, [
        { values: [], strict: true }, // empty -> rejected
        { values: ["x", 3], strict: true }, // non-string element -> rejected
        { values: ["x"], strict: "yes" }, // strict not boolean -> rejected
      ]);

const genReference = (rng: Rng): unknown =>
  chance(rng, 0.85)
    ? {
        targetFolder: pick(rng, ["Boards", "People", "Registry"]),
        targetKey: pick(rng, ["id", "slug", "key"]),
        onBrokenWrite: pick(rng, ["block", "warn"]),
        onReferencedChange: pick(rng, ["warn", "cascade-preview"]),
      }
    : pick(rng, [
        { targetFolder: "", targetKey: "id", onBrokenWrite: "block", onReferencedChange: "warn" },
        { targetFolder: "T", targetKey: "id", onBrokenWrite: "explode", onReferencedChange: "warn" },
        { targetFolder: "T", onBrokenWrite: "block", onReferencedChange: "warn" },
      ]);

const genDerived = (rng: Rng, otherNames: string[]): unknown => {
  if (!chance(rng, 0.85))
    return pick(rng, [
      { kind: "mystery", spec: {}, materialize: "none" },
      { kind: "template", spec: "not-an-object", materialize: "none" },
      { kind: "template", spec: {}, materialize: "sometimes" },
    ]);
  const kind = pick(rng, ["template", "lookup", "rollup"]);
  // For a template kind, sometimes reference another field so the derived-cycle
  // detector actually runs on a populated dependency graph.
  const spec: Record<string, unknown> =
    kind === "template"
      ? {
          template:
            otherNames.length && chance(rng, 0.6)
              ? "{" + pick(rng, otherNames) + "}"
              : "static-" + randInt(rng, 0, 9),
        }
      : { source: pick(rng, otherNames.length ? otherNames : ["ref"]) };
  return { kind, spec, materialize: pick(rng, ["none", "frontmatter"]) };
};

const genUnique = (rng: Rng): unknown =>
  chance(rng, 0.85)
    ? {
        scope: "database",
        ...(chance(rng, 0.5) ? { where: [genValidFilter(rng)] } : {}),
      }
    : pick(rng, [
        { scope: "global" }, // wrong scope -> rejected
        { scope: "database", where: "nope" }, // where not array -> rejected
      ]);

const genFieldDef = (rng: Rng, otherNames: string[]): Record<string, unknown> => {
  const def: Record<string, unknown> = {};
  def.kind = chance(rng, 0.85) ? pick(rng, KNOWN_KINDS) : pick(rng, UNKNOWN_KINDS);
  if (chance(rng, 0.4))
    def.options = chance(rng, 0.7)
      ? pick(rng, [["a", "b"], ["one", "two", "three"], ["solo"]])
      : ["a", 2, null]; // mixed -> String()-coerced, still round-trips
  if (chance(rng, 0.4)) def.required = chance(rng, 0.5);
  if (chance(rng, 0.35)) def.value = pick(rng, ["default", 7, "on"]);
  if (chance(rng, 0.4)) def.enum = genEnum(rng);
  if (chance(rng, 0.3)) def.unique = genUnique(rng);
  if (chance(rng, 0.3)) def.pattern = pick(rng, ["^[a-z]+$", "\\d{3}", "(", ""]);
  if (chance(rng, 0.25)) def.title_binding = chance(rng, 0.5);
  if (chance(rng, 0.3)) def.empty = pick(rng, ["absent", "empty-string", "maybe"]);
  if (chance(rng, 0.3)) def.reference = genReference(rng);
  if (chance(rng, 0.3)) def.derived = genDerived(rng, otherNames);
  // Forward-compat unknown attribute(s) — must round-trip verbatim on `.extra`.
  if (chance(rng, 0.3))
    def["x_note_" + randInt(rng, 0, 4)] = pick(rng, [
      "keepme",
      42,
      { nested: true, tag: "v" },
      ["list", 1],
    ]);
  return def;
};

const genFieldsMap = (rng: Rng): Record<string, unknown> => {
  const names = genFieldNames(rng, randInt(rng, 0, 5));
  const map: Record<string, unknown> = {};
  for (const name of names) map[name] = genFieldDef(rng, names);
  return map;
};

const genKindFields = (rng: Rng): Record<string, unknown> => {
  const out: Record<string, unknown> = {};
  const n = randInt(rng, 0, 2);
  const kinds = ["task", "note", "event"];
  for (let i = 0; i < n; i++) out[kinds[i]] = genFieldsMap(rng);
  return out;
};

const genInvariant = (rng: Rng): unknown => {
  if (chance(rng, 0.2))
    // Malformed minority -> rejected by parseInvariant, absent from the profile.
    return pick(rng, [
      { require: [], severity: "error", message: "empty require" },
      { require: [genValidFilter(rng)], severity: "fatal", message: "bad severity" },
      { require: [genValidFilter(rng)], severity: "error", message: "" },
      "nope",
    ]);
  const inv: Record<string, unknown> = {
    require: Array.from({ length: randInt(rng, 1, 3) }, () => genValidFilter(rng)),
    severity: pick(rng, ["error", "warn"]),
    message: pick(rng, ["must hold", "keep it", "required"]),
  };
  if (chance(rng, 0.5))
    inv.when = Array.from({ length: randInt(rng, 1, 2) }, () => genValidFilter(rng));
  if (chance(rng, 0.3)) inv.autofix = pick(rng, ["normalize", "trim"]);
  return inv;
};

const genFrontmatter = (rng: Rng): Record<string, unknown> => {
  const fm: Record<string, unknown> = { schema_type: typeProfileSchemaType };
  if (chance(rng, 0.6)) fm.slug = pick(rng, ["reviews", "boards", "people"]);
  else if (chance(rng, 0.4)) fm.database = pick(rng, ["Reviews", "Boards"]);
  fm.fields = genFieldsMap(rng);
  if (chance(rng, 0.5)) fm.kind_fields = genKindFields(rng);
  if (chance(rng, 0.6))
    fm.invariants = Array.from({ length: randInt(rng, 0, 3) }, () => genInvariant(rng));
  return fm;
};

// ---------------------------------------------------------------------------
// PROFILE -> FRONTMATTER serializer. serializeTypeProfileField is the
// PRODUCTION inverse of parseFieldsMap's per-field branch (exercised directly);
// invariants and kind maps have no exported serializer, so their inverse is
// hand-written here. An Invariant is already in the raw `{when?, require,
// severity, message, autofix?}` shape, so its inverse is near-identity.
// ---------------------------------------------------------------------------

const serializeInvariant = (inv: Invariant): Record<string, unknown> => ({
  ...(inv.when ? { when: inv.when } : {}),
  require: inv.require,
  severity: inv.severity,
  message: inv.message,
  ...(inv.autofix != null ? { autofix: inv.autofix } : {}),
});

const serializeFieldsMap = (
  fields: TypeProfileField[]
): Record<string, unknown> => {
  const map: Record<string, unknown> = {};
  for (const field of fields) map[field.name] = serializeTypeProfileField(field);
  return map;
};

const serializeProfileToFrontmatter = (
  profile: NotidianTypeProfile
): Record<string, unknown> => ({
  schema_type: typeProfileSchemaType,
  ...(profile.database != null ? { slug: profile.database } : {}),
  fields: serializeFieldsMap(profile.fields),
  kind_fields: Object.fromEntries(
    Object.entries(profile.kindFields).map(([kind, list]) => [
      kind,
      serializeFieldsMap(list),
    ])
  ),
  invariants: profile.invariants.map(serializeInvariant),
});

const roundTrip = (profile: NotidianTypeProfile): NotidianTypeProfile => {
  const parsed = parseTypeProfile(serializeProfileToFrontmatter(profile));
  if (!parsed)
    throw new Error("a serialized profile must always re-parse to non-null");
  return parsed;
};

// All field names materialized by a profile (union + every kind sub-schema) —
// the candidate targets a mirror change can actually hit.
const profileFieldNames = (profile: NotidianTypeProfile): string[] => {
  const names = new Set<string>();
  for (const f of profile.fields) names.add(f.name);
  for (const list of Object.values(profile.kindFields))
    for (const f of list) names.add(f.name);
  return [...names];
};

const genChange = (rng: Rng, names: string[]): TypeProfileSchemaChange => {
  const existing = names.length ? pick(rng, names) : "ghost_field";
  const fresh = "added_" + randInt(rng, 0, 999);
  switch (randInt(rng, 0, 2)) {
    case 0:
      return {
        kind: "add-column",
        name: chance(rng, 0.5) ? fresh : existing,
        type: pick(rng, MIRROR_TYPES),
      };
    case 1:
      return {
        kind: "rename-key",
        oldName: chance(rng, 0.7) ? existing : fresh,
        newName: chance(rng, 0.6) ? fresh : existing,
      };
    default:
      return {
        kind: "add-option",
        name: chance(rng, 0.7) ? existing : fresh,
        option: "opt_" + randInt(rng, 0, 99),
      };
  }
};

// ===========================================================================
// (1) TOTAL + (2) STABLE — restated here so this net is self-standing.
// ===========================================================================

describe("typeProfile v3 — parser is TOTAL and STABLE", () => {
  it("never throws and returns a NotidianTypeProfile | null", () => {
    for (let i = 0; i < PROPERTY_RUNS; i++) {
      const rng = makeRng(BASE_SEED + i);
      const fm = genFrontmatter(rng);
      let result: NotidianTypeProfile | null = null;
      expect(() => {
        result = parseTypeProfile(fm);
      }).not.toThrow();
      expect(result === null || isPlainObject(result)).toBe(true);
    }
  });

  it("is pure — the same source parses to an equal profile twice", () => {
    for (let i = 0; i < PROPERTY_RUNS; i++) {
      const rng = makeRng(BASE_SEED + 5000 + i);
      const fm = genFrontmatter(rng);
      const first = parseTypeProfile(fm);
      const second = parseTypeProfile(fm);
      expect(second).toEqual(first);
    }
  });
});

// ===========================================================================
// (3) ROUND-TRIP FIXPOINT — parse -> serialize -> parse reproduces the profile
// STRUCTURE, and a second application is a no-op (a stable normal form). The
// non-vacuity tracker proves the fixpoint was exercised over populated
// profiles carrying every v3 attribute, not just empty ones.
// ===========================================================================

describe("typeProfile v3 — parse/serialize round-trip FIXPOINT", () => {
  it("re-serializing then re-parsing reproduces fields, kindFields, invariants, database", () => {
    const seen = {
      fields: false,
      enum: false,
      reference: false,
      derived: false,
      unique: false,
      pattern: false,
      options: false,
      required: false,
      titleBinding: false,
      empty: false,
      extra: false,
      unknownKind: false,
      kindFields: false,
      invariants: false,
      database: false,
    };

    for (let i = 0; i < PROPERTY_RUNS; i++) {
      const rng = makeRng(BASE_SEED + 10000 + i);
      const profile = parseTypeProfile(genFrontmatter(rng));
      if (!profile) continue;

      const rt = roundTrip(profile);

      // Structural fixpoint: the schema content is reproduced exactly.
      expect(rt.fields).toEqual(profile.fields);
      expect(rt.kindFields).toEqual(profile.kindFields);
      expect(rt.invariants).toEqual(profile.invariants);
      expect(rt.database).toEqual(profile.database);

      // Full fixpoint (issues included): a SECOND round-trip changes nothing,
      // so serialize/parse converge on a stable normal form.
      expect(roundTrip(rt)).toEqual(rt);

      if (profile.fields.length > 0) seen.fields = true;
      if (Object.values(profile.kindFields).some((l) => l.length > 0))
        seen.kindFields = true;
      if (profile.invariants.length > 0) seen.invariants = true;
      if (profile.database !== undefined) seen.database = true;
      for (const f of [
        ...profile.fields,
        ...Object.values(profile.kindFields).flat(),
      ]) {
        if (f.enum) seen.enum = true;
        if (f.reference) seen.reference = true;
        if (f.derived) seen.derived = true;
        if (f.unique) seen.unique = true;
        if (f.pattern) seen.pattern = true;
        if (f.options) seen.options = true;
        if (f.required) seen.required = true;
        if (f.title_binding !== undefined) seen.titleBinding = true;
        if (f.empty) seen.empty = true;
        if (f.extra) seen.extra = true;
        if (!KNOWN_KINDS.includes(f.kind as (typeof KNOWN_KINDS)[number]))
          seen.unknownKind = true;
      }
    }

    for (const [key, hit] of Object.entries(seen))
      expect([key, hit]).toEqual([key, true]);
  });
});

// ===========================================================================
// (4) MIRROR IDEMPOTENCE — the table->hub mirror is deterministic, and once a
// plan is applied (threaded exactly as mirrorSchemaChangeToTypeProfile threads
// nextState), recomputing the SAME change reports no further change. Covers
// both the kind-aware planTypeProfileMirror and the fields-only planFieldsMirror.
// ===========================================================================

describe("typeProfile v3 — table->hub mirror is idempotent", () => {
  it("planTypeProfileMirror: deterministic, and applying the plan makes the same change a no-op", () => {
    let observedChange = false;
    const observedKinds = new Set<string>();

    for (let i = 0; i < PROPERTY_RUNS; i++) {
      const rng = makeRng(BASE_SEED + 20000 + i);
      const fm = genFrontmatter(rng);
      const profile = parseTypeProfile(fm);
      if (!profile) continue;
      const change = genChange(rng, profileFieldNames(profile));

      const plan1 = planTypeProfileMirror(fm, change);
      // Deterministic: recomputing on the same input yields an equal plan.
      expect(planTypeProfileMirror(fm, change)).toEqual(plan1);

      // Apply the plan the way the production seam threads nextState:
      // fields = plan.fields ?? plan.currentFields, likewise kind_fields.
      const applied = {
        ...fm,
        fields: plan1.fields ?? plan1.currentFields,
        kind_fields: plan1.kindFields ?? plan1.currentKindFields,
      };
      const plan2 = planTypeProfileMirror(applied, change);
      expect(plan2.changed).toBe(false);

      if (plan1.changed) {
        observedChange = true;
        observedKinds.add(change.kind);
      }
    }

    // Non-vacuity: the mirror actually produced real writes for every change
    // kind, so the idempotence assertion is not trivially satisfied by every
    // plan being a no-op.
    expect(observedChange).toBe(true);
    expect([...observedKinds].sort()).toEqual([
      "add-column",
      "add-option",
      "rename-key",
    ]);
  });

  it("planFieldsMirror: deterministic, applying a real plan is a no-op, and a no-op plan never mutates the map", () => {
    let observedChange = false;

    for (let i = 0; i < PROPERTY_RUNS; i++) {
      const rng = makeRng(BASE_SEED + 30000 + i);
      const fm = genFrontmatter(rng);
      const profile = parseTypeProfile(fm);
      if (!profile) continue;
      const rawFields = fm.fields;
      const change = genChange(rng, profileFieldNames(profile));

      const plan1 = planFieldsMirror(rawFields, change);
      expect(planFieldsMirror(rawFields, change)).toEqual(plan1);

      if (plan1.changed) {
        observedChange = true;
        // Applying the plan's fields, then re-planning the same change, is a
        // no-op — no echo loop.
        const plan2 = planFieldsMirror(plan1.fields, change);
        expect(plan2.changed).toBe(false);
      } else if (isPlainObject(rawFields)) {
        // A no-op plan must leave the (normalizable) source map structurally
        // untouched — it reports the current fields, never a mutated copy.
        expect(plan1.fields).toEqual(rawFields);
      }
    }

    expect(observedChange).toBe(true);
  });
});

// ===========================================================================
// (5) ROUND-TRIP + MIRROR over HOSTILE FIELD-NAME KEYS (characterization)
//
// The seeded generators above draw field-name KEYS from a safe pool on purpose
// — hostile keys were "the adversarial file's concern". But the adversarial net
// (typeProfile.adversarial.test.ts) only proves the PARSER is total/shape-safe
// on hostile keys; it never runs them through THIS file's two round-trip
// contracts. serializeProfileToFrontmatter builds `fields` (and each
// `kind_fields.<kind>`) sub-map via plain assignment `map[field.name] = def`,
// while the OUTER kind map is built via Object.fromEntries. Those two
// constructions have DIFFERENT semantics for the one key JS treats specially:
//   - `map["__proto__"] = def` invokes the Object.prototype `__proto__` ACCESSOR
//     (a setter), so it does NOT create an own data property.
//   - Object.fromEntries([["__proto__", def]]) uses CreateDataProperty, so it
//     DOES create an own `__proto__` data key.
// So a `__proto__`-named FIELD can diverge from a re-parse while every other
// hostile key round-trips. This block drives the exact hostile keys the
// adversarial parser net enumerates (`__proto__`, `constructor`, `prototype`,
// `toString`, `''`) through parse -> serializeProfileToFrontmatter -> parse and
// through the mirror, and PINS where each agrees with a re-parse and where it
// genuinely cannot. Per bead Notidian-megy this is characterization only: the
// `__proto__` divergence and the empty-name add-column quirk are DOCUMENTED,
// not fixed — pinning actual behavior guards it against silent drift.
// ===========================================================================

// Ordinary string keys that merely LOOK dangerous: no accessor lives on
// Object.prototype for them and the parser never falsy-skips them, so they
// behave like any other name and are a full round-trip fixpoint.
const ROUND_TRIP_SAFE_HOSTILE = ["constructor", "prototype", "toString"] as const;

// Force an OWN enumerable `key` — Object.fromEntries uses CreateDataProperty, so
// even "__proto__" becomes a real own data key rather than tripping the object-
// literal prototype setter. This reproduces how Obsidian's metadata cache /
// JSON.parse surface a hostile YAML key as own data (an object LITERAL
// `{ __proto__: x }` instead mutates the prototype and is NOT what a hub note
// carries once it has round-tripped through the cache).
const ownKeyMap = (key: string, def: unknown): Record<string, unknown> =>
  Object.fromEntries([[key, def]]);

const parseOrThrow = (fm: Record<string, unknown>): NotidianTypeProfile => {
  const profile = parseTypeProfile(fm);
  if (!profile)
    throw new Error("marked frontmatter must parse to a non-null profile");
  return profile;
};

const fieldNames = (list: TypeProfileField[]): string[] =>
  list.map((f) => f.name);

describe("typeProfile v3 — round-trip over HOSTILE top-level field-name keys", () => {
  it("constructor / prototype / toString field names are a full round-trip FIXPOINT", () => {
    for (const key of ROUND_TRIP_SAFE_HOSTILE) {
      const fm = {
        schema_type: typeProfileSchemaType,
        fields: ownKeyMap(key, { kind: "select", options: ["a", "b"] }),
      };
      const profile = parseOrThrow(fm);
      // The parser faithfully surfaces the hostile-named field.
      expect(fieldNames(profile.fields)).toEqual([key]);

      // serializeProfileToFrontmatter re-creates the key as an OWN data property
      // (these keys have no accessor), so a re-parse reproduces the field...
      const ser = serializeProfileToFrontmatter(profile);
      expect(Object.keys(ser.fields as Record<string, unknown>)).toEqual([key]);

      const rt = roundTrip(profile);
      expect(rt.fields).toEqual(profile.fields);
      // ...and a SECOND application changes nothing — hostile key and all: the
      // serialize/parse pair reaches the same stable normal form as safe keys.
      expect(roundTrip(rt)).toEqual(rt);
    }
  });

  it("'' (empty) field name is dropped at PARSE — never materializes, so the round-trip is vacuously a fixpoint", () => {
    const fm = {
      schema_type: typeProfileSchemaType,
      // A own empty-string key alongside a real field.
      fields: { "": { kind: "text" }, real: { kind: "number" } },
    };
    const profile = parseOrThrow(fm);
    // parseFieldsMap does `if (!name) continue` — the empty-named entry is gone.
    expect(fieldNames(profile.fields)).toEqual(["real"]);
    // Nothing to lose on the way back: the round-trip stays a fixpoint.
    const rt = roundTrip(profile);
    expect(rt.fields).toEqual(profile.fields);
    expect(roundTrip(rt)).toEqual(rt);
  });

  it("__proto__ field name parses but is DROPPED on re-serialize — documented out-of-round-trip-scope (accessor, not CreateDataProperty)", () => {
    const objectProtoBefore = Object.getPrototypeOf({});
    const fm = {
      schema_type: typeProfileSchemaType,
      fields: ownKeyMap("__proto__", { kind: "text" }),
    };
    const profile = parseOrThrow(fm);
    // The PARSER surfaces a __proto__-named field (the source carried it as an
    // own key), so it exists post-parse just like any other field.
    expect(fieldNames(profile.fields)).toEqual(["__proto__"]);

    // But serializeFieldsMap does `map["__proto__"] = def`, which hits the
    // Object.prototype accessor SETTER rather than defining an own data
    // property, so the serialized `fields` map has NO own __proto__ key...
    const ser = serializeProfileToFrontmatter(profile);
    expect(Object.keys(ser.fields as Record<string, unknown>)).toEqual([]);

    // ...and a re-parse therefore cannot see the field: it is silently dropped.
    // This is the pinned divergence — __proto__ field names are out of
    // round-trip scope (Notidian-megy).
    const rt = roundTrip(profile);
    expect(rt.fields).toEqual([]);

    // The divergence is BOUNDED: it drops the one field, it does not throw,
    // does not corrupt a sibling, and does not pollute the global prototype.
    expect(Object.getPrototypeOf({})).toBe(objectProtoBefore);
    expect(({} as Record<string, unknown>).kind).toBeUndefined();
  });

  it("a __proto__ field is dropped in ISOLATION — a safe sibling in the same map still round-trips", () => {
    const fm = {
      schema_type: typeProfileSchemaType,
      fields: ownKeyMap("__proto__", { kind: "text" }),
    };
    // Add a second, safe field AFTER the hostile one (own-key order preserved).
    (fm.fields as Record<string, unknown>).keep = { kind: "number" };
    const profile = parseOrThrow(fm);
    expect(fieldNames(profile.fields)).toEqual(["__proto__", "keep"]);

    const rt = roundTrip(profile);
    // Only __proto__ is lost; `keep` survives intact.
    expect(fieldNames(rt.fields)).toEqual(["keep"]);
    expect(rt.fields[0]).toEqual(profile.fields[1]);
  });
});

describe("typeProfile v3 — round-trip over HOSTILE kind_fields keys", () => {
  it("inner FIELD names behave exactly like top-level field names", () => {
    // Safe keys round-trip inside a kind sub-map.
    for (const key of ROUND_TRIP_SAFE_HOSTILE) {
      const fm = {
        schema_type: typeProfileSchemaType,
        fields: { anchor: { kind: "text" } },
        kind_fields: { task: ownKeyMap(key, { kind: "number" }) },
      };
      const profile = parseOrThrow(fm);
      expect(fieldNames(profile.kindFields.task ?? [])).toEqual([key]);
      const rt = roundTrip(profile);
      expect(rt.kindFields).toEqual(profile.kindFields);
      expect(rt.fields).toEqual(profile.fields);
    }

    // __proto__ inner field: parses into the kind sub-map, dropped on re-serialize.
    {
      const fm = {
        schema_type: typeProfileSchemaType,
        fields: { anchor: { kind: "text" } },
        kind_fields: { task: ownKeyMap("__proto__", { kind: "number" }) },
      };
      const profile = parseOrThrow(fm);
      expect(fieldNames(profile.kindFields.task ?? [])).toEqual(["__proto__"]);
      const rt = roundTrip(profile);
      expect(fieldNames(rt.kindFields.task ?? [])).toEqual([]);
      // The anchor (a safe common field) is the only survivor of the union.
      expect(fieldNames(rt.fields)).toEqual(["anchor"]);
    }

    // '' inner field: dropped at parse by the same falsy-name skip.
    {
      const fm = {
        schema_type: typeProfileSchemaType,
        fields: { anchor: { kind: "text" } },
        kind_fields: { task: { "": { kind: "number" }, real: { kind: "text" } } },
      };
      const profile = parseOrThrow(fm);
      expect(fieldNames(profile.kindFields.task ?? [])).toEqual(["real"]);
      const rt = roundTrip(profile);
      expect(rt.kindFields).toEqual(profile.kindFields);
    }
  });

  it("KIND discriminator names: safe hostile keys AND '' survive+round-trip; __proto__ is dropped at PARSE", () => {
    // Note the asymmetry with FIELD names: the parser only falsy-skips FIELD
    // names, so an empty-string KIND discriminator is KEPT and round-trips.
    for (const key of [...ROUND_TRIP_SAFE_HOSTILE, ""]) {
      const fm = {
        schema_type: typeProfileSchemaType,
        kind_fields: ownKeyMap(key, { real: { kind: "text" } }),
      };
      const profile = parseOrThrow(fm);
      expect(Object.keys(profile.kindFields)).toContain(key);
      const rt = roundTrip(profile);
      expect(Object.keys(rt.kindFields)).toContain(key);
      expect(fieldNames(rt.kindFields[key] ?? [])).toEqual(["real"]);
    }

    // __proto__ KIND name: the parser itself does `kindFields[kindName] = ...`,
    // and for "__proto__" that plain assignment hits the accessor, so the kind
    // never materializes — the whole sub-schema (incl. its "real" field) is gone.
    const fm = {
      schema_type: typeProfileSchemaType,
      fields: { anchor: { kind: "text" } },
      kind_fields: ownKeyMap("__proto__", { real: { kind: "text" } }),
    };
    const profile = parseOrThrow(fm);
    expect(Object.keys(profile.kindFields)).toEqual([]);
    expect(fieldNames(profile.fields)).toEqual(["anchor"]);
  });
});

describe("typeProfile v3 — mirror over HOSTILE field-name keys", () => {
  // add-option, rename (both directions), AND add-column are idempotent for
  // EVERY hostile key including '' — Notidian-ujj8 flipped the former ''
  // add-column quirk (findKey/findMapKey/findOwningKind now test `!== undefined`,
  // honoring an existing empty key). Determinism holds universally.
  const idempotentChanges = (key: string): TypeProfileSchemaChange[] => [
    { kind: "add-option", name: key, option: "opt" },
    { kind: "rename-key", oldName: "existing", newName: key },
    { kind: "rename-key", oldName: key, newName: "renamed" },
  ];

  it("planFieldsMirror: deterministic + idempotent over hostile field-name keys", () => {
    for (const key of [...ROUND_TRIP_SAFE_HOSTILE, "__proto__", ""]) {
      const fields = Object.fromEntries([
        [key, { kind: "select", options: ["a"] }],
        ["existing", { kind: "text" }],
      ]);
      const changes: TypeProfileSchemaChange[] = [
        ...idempotentChanges(key),
        // add-column is idempotent for every hostile key including '' (an
        // existing empty key is now honored — see the '' idempotence test below).
        { kind: "add-column" as const, name: key, type: "text" },
      ];
      for (const change of changes) {
        const plan1 = planFieldsMirror(fields, change);
        // Deterministic: recomputing on the same input yields an equal plan
        // (toEqual compares own __proto__ data keys, which the computed-key
        // spread `{ ...fields, [key]: def }` DOES create — CreateDataProperty).
        expect(planFieldsMirror(fields, change)).toEqual(plan1);
        // Idempotent: applying the plan's fields then re-planning is a no-op.
        expect(planFieldsMirror(plan1.fields, change).changed).toBe(false);
      }
    }
  });

  it("planTypeProfileMirror: deterministic + idempotent with hostile keys inside a kind sub-map", () => {
    for (const key of [...ROUND_TRIP_SAFE_HOSTILE, "__proto__", ""]) {
      const fm = {
        schema_type: typeProfileSchemaType,
        fields: { common: { kind: "text" } },
        kind_fields: {
          task: Object.fromEntries([
            [key, { kind: "select", options: ["a"] }],
            ["existing", { kind: "text" }],
          ]),
        },
      } as Record<string, unknown>;
      const changes: TypeProfileSchemaChange[] = [
        ...idempotentChanges(key),
        { kind: "add-column" as const, name: key, type: "text" },
      ];
      for (const change of changes) {
        const plan1 = planTypeProfileMirror(fm, change);
        expect(planTypeProfileMirror(fm, change)).toEqual(plan1);
        const applied = {
          ...fm,
          fields: plan1.fields ?? plan1.currentFields,
          kind_fields: plan1.kindFields ?? plan1.currentKindFields,
        };
        expect(planTypeProfileMirror(applied, change).changed).toBe(false);
      }
    }
  });

  it("empty ('') column name is idempotent for add-column — Notidian-ujj8 fix", () => {
    // Was a PINNED non-idempotence quirk (Notidian-megy): an empty string is
    // FALSY, so the old truthiness guard `if (findKey(name))` never treated an
    // existing empty-string key as "found", and add-column re-added (overwrote)
    // it on every pass. Notidian-ujj8 changed the guards to `findKey(name) !==
    // undefined` (and the sibling findMapKey/findOwningKind guards), so an
    // existing empty key is now honored and add-column is a proper no-op.
    // Still harmless in practice — parseFieldsMap falsy-skips an empty name, so
    // an empty column can never materialize — but the mirror is now idempotent
    // as defense-in-depth against an echo-loop.
    const change: TypeProfileSchemaChange = {
      kind: "add-column",
      name: "",
      type: "text",
    };

    const fields = Object.fromEntries([
      ["", { kind: "select", options: ["a"] }],
      ["existing", { kind: "text" }],
    ]);
    const p1 = planFieldsMirror(fields, change);
    // The empty key already exists → no-op (not a re-add/overwrite).
    expect(p1.changed).toBe(false);
    expect(p1.fields).toEqual(fields);
    // Idempotent: re-planning the (unchanged) state is still a no-op.
    expect(planFieldsMirror(p1.fields, change).changed).toBe(false);
    // Deterministic.
    expect(planFieldsMirror(fields, change)).toEqual(p1);

    const fm = {
      schema_type: typeProfileSchemaType,
      fields,
    } as Record<string, unknown>;
    const w1 = planTypeProfileMirror(fm, change);
    expect(w1.changed).toBe(false);
    const applied = {
      ...fm,
      fields: w1.fields ?? w1.currentFields,
      kind_fields: w1.kindFields ?? w1.currentKindFields,
    };
    expect(planTypeProfileMirror(applied, change).changed).toBe(false);
  });
});
