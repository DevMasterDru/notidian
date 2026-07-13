import { filterReturnForCol } from "core/utils/contexts/predicate/filter";
import {
  Invariant,
  NotidianTypeProfile,
  RESERVED_SYSTEM_FIELDS,
  TypeProfileField,
  TypeProfileReference,
} from "core/utils/contexts/typeProfile";
import { DBRow, SpaceProperty, SpaceTableColumn } from "shared/types/mdb";
import { Filter } from "shared/types/predicate";
import { parseMultiString } from "utils/parsers";

// Pure validation core (ADR-0057 D1, Notidian-loan.2 / S2): the ONE function
// family every future consumer calls to answer "did my edit break something?"
// against an ADR-0056 v3 Type Profile (`NotidianTypeProfile`, the parsed
// schema S1's `parseTypeProfile` produces). Zero Obsidian/Electron imports —
// same pure-planner posture as `typeProfile.ts` (ADR-0015 precedent) and the
// same dependency-injection shape as `executeTableValueWrites`
// (`tableEditTransaction.ts`): every capability this module cannot compute
// on its own (a live-row snapshot for uniqueness, foreign-key existence, the
// file's current basename) arrives via the injected `ValidateRowCtx`, never
// via a direct import of an Obsidian-adjacent module (e.g. `keyMatchResolver`
// stays the CALLER's import, not this module's).
//
// This wave is READ-ONLY DETECTION ONLY (ADR-0057 scope): nothing here
// writes, repairs, or blocks anything. `repairTier` labels a violation with
// its declared remedy class (ADR-0057 D5) for a FUTURE UI/write-gate to act
// on; this module never applies a repair itself.
//
// Adversarial contract: `validateRowPatch`/`validateRow` NEVER throw. A
// malformed `row`/`patch` (not a plain object), an invariant/`unique.where`
// filter naming a field the schema never declared, an unparseable pattern,
// or any single check's unexpected failure all degrade to a diagnostic (or
// silent skip for that one check) rather than propagating an exception.

// ---------------------------------------------------------------------------
// Public shape
// ---------------------------------------------------------------------------

export type RepairTier = "autofix" | "one-click" | "manual-only";

// Machine-readable, STABLE code strings (Atlasidian's W3 `db.*` surface will
// pass these through verbatim to callers outside this repo) — never rename an
// existing code; add a new one instead. `"malformed-row"` is this module's own
// input-shape guard (never reaches a real schema check); the rest cover every
// class ADR-0057 D1 + the bead's coverage list name: type coercion, strict
// enum, required, unique(+where), pattern, title_binding, empty-encoding
// policy, declared reference existence, and per-database invariants.
export type ViolationCode =
  | "malformed-row"
  | "type"
  | "enum"
  | "required"
  | "unique"
  | "pattern"
  | "title-binding"
  | "empty-encoding"
  | "reference-broken"
  | "invariant";

export type ViolationSeverity = "error" | "warn";

export type Violation = {
  // Absent only for a violation that cannot be attributed to one column: an
  // invariant whose `require` touches more than one field, or the top-level
  // malformed-input guard.
  field?: string;
  code: ViolationCode;
  severity: ViolationSeverity;
  message: string;
  repairTier: RepairTier;
  suggestedFix?: string;
};

// Dependency-injected capabilities this module cannot compute on its own
// (same posture as `ExecuteTableValueWritesParams` in `tableEditTransaction.ts`
// — every external capability is a caller-supplied function, never a direct
// import of the Obsidian-adjacent module that implements it). ALL members are
// optional: an under-wired ctx degrades the corresponding check to a silent
// skip rather than a throw (never fails validation of every OTHER field
// because one capability wasn't wired yet).
export type ValidateRowCtx = {
  // Uniqueness (`unique` fields, ADR-0056 D3): lazily returns every OTHER
  // row's currently known fields in the SAME database — the CALLER has
  // already excluded the row under validation (ADR-0057 D1: "the caller
  // supplies [the snapshot]... it does not read pathsIndex/contextsIndex
  // itself"). Called at most once per field that declares `unique`, and only
  // when that field's effective value is non-empty and (if `unique.where` is
  // set) in scope — so a schema with no uniqueness constraints, or a row
  // whose unique field is blank, never pays for a snapshot it doesn't need.
  getOtherRows?: () => Array<Record<string, unknown>>;
  // Reference existence (`reference` fields, ADR-0056 D6): resolves whether
  // AT LEAST ONE row exists in `reference.targetFolder` whose
  // `reference.targetKey` equals `value`. Mirrors `resolveKeyMatch`'s pure
  // contract (`keyMatchResolver.ts`) WITHOUT this module importing it (that
  // stays the wiring layer's job — S4/W2 — keeping this module Superstate/
  // Obsidian-free).
  resolveReferenceExists?: (
    reference: TypeProfileReference,
    value: unknown
  ) => boolean;
  // The row's current file basename (no extension) — for `title_binding`
  // fields (ADR-0056 D4). Undefined skips every title_binding check (nothing
  // to compare against, e.g. a draft row with no file identity yet).
  basename?: string;
};

// ---------------------------------------------------------------------------
// Input-shape guard
// ---------------------------------------------------------------------------

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value == "object" && !Array.isArray(value);

// `row` is "the row's current known fields" (ADR-0057 D1) — it should always
// BE an object, even an empty one; `null`/`undefined`/an array/a scalar is a
// genuine caller error worth surfacing loudly. Strict: only a real plain
// object passes.
const asRow = (value: unknown): Record<string, unknown> | null =>
  isPlainObject(value) ? value : null;

// `patch` is "proposed changes" — a caller commonly has NONE (validating a
// row as-is, or an as-yet-unedited row), so `null`/`undefined` normalize to an
// empty object rather than being treated as malformed. Anything else that
// isn't a plain object (an array, string, number) IS malformed input.
const asPatch = (value: unknown): Record<string, unknown> | null => {
  if (value == null) return {};
  return isPlainObject(value) ? value : null;
};

const isMissingValue = (value: unknown): boolean =>
  value == null || value === "" || (Array.isArray(value) && value.length == 0);

// Case-folded names of the reserved system fields (Notidian-loan.15) — used to
// drop any same-named field a hub also declared before the AUTHORITATIVE
// reserved definition is appended to the working field set (see validateRowPatch).
const reservedFieldNames = new Set(
  RESERVED_SYSTEM_FIELDS.map((field) => field.name.toLowerCase())
);

// ---------------------------------------------------------------------------
// Filter evaluation (ADR-0057 D1: reuse `filterReturnForCol` — the EXISTING
// per-row predicate dispatcher every view's filter bar already uses — no new
// evaluator). ADR-0056 D8: "invariants only ever see the row's OWN fields" —
// a `fType: "property"` filter's `value` therefore resolves against the SAME
// effective row passed as `properties`, letting an invariant compare one
// field on a row to ANOTHER field on that same row (e.g. `used_channels` <=
// `channels`) without inventing a second lookup mechanism.
// ---------------------------------------------------------------------------

type FilterEvaluation = { ok: true; result: boolean } | { ok: false };

// `ok: false` is the "missing schema field" adversarial class: a Filter's
// `field` names something S1's parser never cross-validated against the
// fields map (invariants/`unique.where` are free-standing field-name strings,
// not validated against `fields:`/`kind_fields:` at parse time — see the
// loan.1 `bd note`). Never throws: an absent field just can't be evaluated.
const evaluateFilter = (
  filter: Filter,
  row: Record<string, unknown>,
  fieldsByName: Map<string, TypeProfileField>
): FilterEvaluation => {
  const field = fieldsByName.get(filter.field);
  if (!field) return { ok: false };
  const col: SpaceProperty = { name: field.name, type: field.type };
  const result = filterReturnForCol(
    col as SpaceTableColumn,
    filter,
    row as unknown as DBRow,
    row
  );
  return { ok: true, result };
};

// A GUARD clause (invariant `when`, `unique.where`): every filter must hold
// for the guard to pass. An unresolvable filter defaults to TRUE — the guard
// does not itself suppress the rule it gates — the SAME ADR-0034 fail-open
// convention `filterReturnForCol`'s own dispatcher already uses for an
// unrecognized construct (a single-user vault; hiding data on an ambiguous
// predicate is the worse failure). No new evaluator, no new gating semantics.
const guardPasses = (
  filters: Filter[] | undefined,
  row: Record<string, unknown>,
  fieldsByName: Map<string, TypeProfileField>
): boolean =>
  (filters ?? []).every((filter) => {
    const evaluated = evaluateFilter(filter, row, fieldsByName);
    return evaluated.ok ? evaluated.result : true;
  });

// ---------------------------------------------------------------------------
// Per-field checks. Each takes the EFFECTIVE row (row with patch applied) and
// returns one Violation or null — never throws (defensive parsing/lookups
// throughout); the caller (`validateRowPatch`) additionally wraps every call
// so a genuinely unexpected exception degrades to "no violation from this
// check" instead of aborting the whole pass.
// ---------------------------------------------------------------------------

// A "multi" field's live value legally arrives in two shapes (see
// `checkType`'s own acceptance below and `validateRow.test.ts`'s "accepts an
// array or a delimited string for a multi field"): a real array, OR the
// delimited-string representation `parseMultiString`/`listEquals`/
// `listIncludes` (predicate/filter.ts) already split before comparing. Any
// check that iterates a multi field's individual values (`checkEnum`) must
// split the SAME way, or a schema-legal delimited string reads as one
// composite "value" instead of its constituent elements.
const isMultiValueFieldType = (fieldType: string): boolean =>
  fieldType.startsWith("option-multi") ||
  fieldType.startsWith("link-multi") ||
  fieldType.startsWith("tags-multi");

const typeMismatchReason = (fieldType: string, value: unknown): string | null => {
  if (fieldType == "number") {
    if (typeof value == "number") return Number.isFinite(value) ? null : "is not a finite number";
    if (typeof value == "string") {
      const trimmed = value.trim();
      return trimmed.length > 0 && Number.isFinite(Number(trimmed))
        ? null
        : `"${value}" is not a valid number`;
    }
    return `expected a number, got ${typeof value}`;
  }
  if (fieldType == "boolean") {
    if (typeof value == "boolean") return null;
    if (typeof value == "string" && (value == "true" || value == "false"))
      return null;
    return `expected true/false, got ${JSON.stringify(value)}`;
  }
  if (fieldType.startsWith("date")) {
    const raw =
      typeof value == "string"
        ? value
        : typeof value == "number"
        ? String(value)
        : null;
    if (raw == null) return `expected a date, got ${typeof value}`;
    const parsed = isNaN(Date.parse(raw)) ? new Date(parseInt(raw, 10)) : new Date(raw);
    return isNaN(parsed.valueOf()) ? `"${raw}" is not a valid date` : null;
  }
  if (isMultiValueFieldType(fieldType)) {
    if (Array.isArray(value) || typeof value == "string") return null;
    return `expected a list, got ${typeof value}`;
  }
  // Scalar text/option/link/password/etc: any primitive is acceptable
  // (frontmatter values are string-typed in practice); a raw object/array
  // where a scalar was declared is the "malformed row" coercion class.
  if (typeof value == "object")
    return `expected a scalar value, got ${Array.isArray(value) ? "an array" : "an object"}`;
  return null;
};

const checkType = (
  field: TypeProfileField,
  row: Record<string, unknown>
): Violation | null => {
  const value = row[field.name];
  if (isMissingValue(value)) return null; // required/empty-encoding own absence.
  const reason = typeMismatchReason(field.type, value);
  if (!reason) return null;
  return {
    field: field.name,
    code: "type",
    severity: "error",
    message: `${field.name}: ${reason}.`,
    repairTier: "manual-only",
  };
};

const checkEnum = (
  field: TypeProfileField,
  row: Record<string, unknown>
): Violation | null => {
  if (!field.enum?.strict) return null; // non-strict enum stays advisory-only.
  const value = row[field.name];
  if (isMissingValue(value)) return null;
  // A multi-value field's live value may be a real array OR the delimited-
  // string encoding `checkType` already accepts for this same field type
  // (ADR-0056/0057; see `isMultiValueFieldType`'s comment) — split it the
  // same way before enum-checking each element, so "wash, fill" isn't
  // enum-checked as one composite string against single-value declarations.
  const values = Array.isArray(value)
    ? value
    : isMultiValueFieldType(field.type) && typeof value == "string"
    ? parseMultiString(value)
    : [value];
  const legal = new Set(field.enum.values);
  const illegal = values.map((v) => String(v)).filter((v) => !legal.has(v));
  if (illegal.length == 0) return null;
  return {
    field: field.name,
    code: "enum",
    severity: "error",
    message: `${field.name}: "${illegal.join(", ")}" is not a declared enum value.`,
    repairTier: "one-click",
    suggestedFix: `Choose one of: ${field.enum.values.join(", ")}.`,
  };
};

const checkRequired = (
  field: TypeProfileField,
  row: Record<string, unknown>
): Violation | null => {
  if (!field.required) return null;
  const value = row[field.name];
  if (!isMissingValue(value)) return null;
  return {
    field: field.name,
    code: "required",
    severity: "error",
    message: `${field.name} is required but missing.`,
    repairTier: "manual-only",
    suggestedFix: `Provide a value for "${field.name}".`,
  };
};

const checkPattern = (
  field: TypeProfileField,
  row: Record<string, unknown>
): Violation | null => {
  if (!field.pattern) return null;
  const value = row[field.name];
  if (isMissingValue(value)) return null;
  let re: RegExp;
  try {
    re = new RegExp(field.pattern);
  } catch {
    // S1's parser already rejects an unparseable pattern at parse time
    // (never reaches a live TypeProfileField); this is a defensive no-op,
    // not a reachable production path.
    return null;
  }
  if (re.test(String(value))) return null;
  return {
    field: field.name,
    code: "pattern",
    severity: "error",
    message: `${field.name}: "${String(value)}" does not match the declared pattern.`,
    repairTier: "manual-only",
    suggestedFix: `Value must match /${field.pattern}/.`,
  };
};

const checkTitleBinding = (
  field: TypeProfileField,
  row: Record<string, unknown>,
  ctx: ValidateRowCtx
): Violation | null => {
  if (!field.title_binding) return null;
  if (ctx.basename == null) return null; // nothing to compare against.
  const value = row[field.name];
  const current = value == null ? "" : String(value);
  if (current == ctx.basename) return null;
  return {
    field: field.name,
    code: "title-binding",
    severity: "error",
    message: `${field.name} ("${current}") does not match the file title ("${ctx.basename}").`,
    repairTier: "one-click",
    suggestedFix: `Set "${field.name}" to "${ctx.basename}", or rename the file to "${current}".`,
  };
};

const emptyEncodingViolation = (
  field: TypeProfileField,
  observed: "null" | "absent" | "empty-string"
): Violation => ({
  field: field.name,
  code: "empty-encoding",
  severity: "error",
  message: `${field.name}: empty value is encoded as ${observed}, but the declared policy is "${field.empty}".`,
  repairTier: "autofix",
  suggestedFix:
    field.empty == "absent"
      ? `Remove the "${field.name}" key entirely instead of writing an empty value.`
      : `Set "${field.name}" to an explicit empty string ("") instead of omitting or nulling it.`,
});

// ADR-0056 D5 / the Gidi audit's D3 finding: a field's canonical empty
// representation is declared once (`empty: "absent" | "empty-string"`); a
// bare YAML `null` is NEVER a legal encoding of either policy — it is the
// third, unowned state the audit's null-vs-`""` split produced.
const checkEmptyEncoding = (
  field: TypeProfileField,
  row: Record<string, unknown>
): Violation | null => {
  if (!field.empty) return null;
  const value = row[field.name];
  if (value === null) return emptyEncodingViolation(field, "null");
  if (value === undefined && field.empty == "empty-string")
    return emptyEncodingViolation(field, "absent");
  if (value === "" && field.empty == "absent")
    return emptyEncodingViolation(field, "empty-string");
  return null;
};

const normalizeUniqueValue = (value: unknown): string =>
  Array.isArray(value) ? JSON.stringify(value) : String(value).trim();

const checkUnique = (
  field: TypeProfileField,
  row: Record<string, unknown>,
  fieldsByName: Map<string, TypeProfileField>,
  ctx: ValidateRowCtx
): Violation | null => {
  if (!field.unique) return null;
  const value = row[field.name];
  if (isMissingValue(value)) return null; // an empty value is not unique-checked.
  if (!guardPasses(field.unique.where, row, fieldsByName)) return null; // out of scope.
  if (!ctx.getOtherRows) return null; // caller not wired for uniqueness — skip, never throw.
  const normalized = normalizeUniqueValue(value);
  const others = ctx.getOtherRows() ?? [];
  const collides = others.some((other) => {
    if (!isPlainObject(other)) return false;
    if (!guardPasses(field.unique!.where, other, fieldsByName)) return false;
    const otherValue = other[field.name];
    if (isMissingValue(otherValue)) return false;
    return normalizeUniqueValue(otherValue) == normalized;
  });
  if (!collides) return null;
  return {
    field: field.name,
    code: "unique",
    severity: "error",
    message: `${field.name}: "${String(value)}" is already used by another row in this database.`,
    repairTier: "manual-only",
    suggestedFix: `Choose a different value for "${field.name}".`,
  };
};

const checkReference = (
  field: TypeProfileField,
  row: Record<string, unknown>,
  ctx: ValidateRowCtx
): Violation | null => {
  if (!field.reference) return null;
  const value = row[field.name];
  if (isMissingValue(value)) return null; // an unset FK is not "broken"; `required` owns absence.
  if (!ctx.resolveReferenceExists) return null; // caller not wired — skip, never throw.
  const exists = ctx.resolveReferenceExists(field.reference, value);
  if (exists) return null;
  const severity: ViolationSeverity =
    field.reference.onBrokenWrite == "block" ? "error" : "warn";
  return {
    field: field.name,
    code: "reference-broken",
    severity,
    message: `${field.name}: "${String(
      value
    )}" has no matching row in "${field.reference.targetFolder}" (key "${
      field.reference.targetKey
    }").`,
    repairTier: "one-click",
    suggestedFix: `Pick a valid "${field.reference.targetKey}" value from "${field.reference.targetFolder}".`,
  };
};

// ---------------------------------------------------------------------------
// Invariants (ADR-0056 D8, ADR-0057 D1's "every declared invariant" item).
// ---------------------------------------------------------------------------

const evaluateInvariant = (
  invariant: Invariant,
  row: Record<string, unknown>,
  fieldsByName: Map<string, TypeProfileField>
): Violation | null => {
  // `when` is a GUARD: unresolvable defaults to true (see `guardPasses`).
  if (!guardPasses(invariant.when, row, fieldsByName)) return null;

  // `require`: THE deliberate fail-open/fail-closed CONTRAST this ADR asks
  // for (vs ADR-0032/0034's universal fail-open filter semantics). A view
  // filter stays fail-open everywhere because silently hiding the owner's own
  // rows is the worse failure for a passive view. A VALIDATOR's job is the
  // opposite: silently treating an unevaluatable `error`-severity requirement
  // as "satisfied" would recreate exactly the "18/19 validators silently
  // pass-empty" failure the Data Integrity Program exists to close (D6). So
  // an unresolvable `require` filter (its `field` names something the schema
  // never declared — the "missing schema field" adversarial class) is
  // FAIL-CLOSED (treated as violated) for `severity: "error"` invariants, and
  // stays fail-open (treated as satisfied, today's lenient default) for
  // `severity: "warn"` invariants — a warn-level rule's ambiguity is
  // deliberately lower-stakes.
  const allSatisfied = invariant.require.every((filter) => {
    const evaluated = evaluateFilter(filter, row, fieldsByName);
    return evaluated.ok ? evaluated.result : invariant.severity != "error";
  });
  if (allSatisfied) return null;

  const requireFields = new Set(invariant.require.map((f) => f.field));
  const singleField = requireFields.size == 1 ? [...requireFields][0] : undefined;

  return {
    ...(singleField ? { field: singleField } : {}),
    code: "invariant",
    severity: invariant.severity,
    message: invariant.message,
    repairTier: invariant.autofix ? "autofix" : "manual-only",
    ...(invariant.autofix ? { suggestedFix: invariant.autofix } : {}),
  };
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

// Runs `compute`, collecting whatever it returns; an unexpected exception
// from a SINGLE check degrades to "no violation from this check" instead of
// aborting the rest of the pass (belt-and-braces on top of every individual
// check already being written defensively — the adversarial contract is
// "never throws", not "never throws as long as every check is bug-free").
const pushSafe = (
  violations: Violation[],
  compute: () => Violation | null
): void => {
  try {
    const result = compute();
    if (result) violations.push(result);
  } catch {
    // Swallow: see comment above.
  }
};

// `validateRowPatch(schema, row, patch, ctx)` -> Violation[] (ADR-0057 D1).
// `patch` represents PROPOSED changes overlaid on `row`'s current fields; the
// EFFECTIVE row validated is `{ ...row, ...patch }` (a patch key explicitly
// set to `undefined`/`null` therefore represents "clear this field", exactly
// like a real write would). Passing `patch === row` (the read-only
// reconciler's only mode this wave, per ADR-0057 D1) validates the row AS
// OBSERVED, with no proposed change.
export const validateRowPatch = (
  schema: NotidianTypeProfile | null | undefined,
  row: Record<string, unknown>,
  patch: Record<string, unknown>,
  ctx: ValidateRowCtx = {}
): Violation[] => {
  const violations: Violation[] = [];

  const rowRecord = asRow(row);
  const patchRecord = asPatch(patch);
  if (rowRecord == null || patchRecord == null) {
    return [
      {
        code: "malformed-row",
        severity: "error",
        message:
          rowRecord == null
            ? "row is not a valid object; cannot validate."
            : "patch is not a valid object; cannot validate.",
        repairTier: "manual-only",
      },
    ];
  }

  // NOTE: deliberately no `fields.length == 0` early return here. A profile
  // can validly declare `invariants` with zero `fields` (S1's `parseTypeProfile`
  // parses each independently — a `missing-fields` schema `issue` does not
  // stop invariant parsing), and an unresolvable `severity: "error"` invariant
  // must still fail CLOSED (see `evaluateInvariant`'s contract) rather than
  // being silently skipped because the fields list happened to be empty. The
  // per-field loop below is already a correct no-op over an empty `fields`
  // array, so this early return bought nothing but a defeated invariant.
  // `schema.fields` is already Array-guarded above; ALSO drop any non-object
  // ELEMENT (null/undefined/scalar) before either the `fieldsByName` Map build
  // or the per-field loop dereferences `field.name` (Notidian-iscd). That deref
  // at the Map build sits OUTSIDE `pushSafe`, so an unguarded null element there
  // threw `TypeError` and aborted the whole pass — a real gap vs the "never
  // throws" adversarial contract. `parseTypeProfile` only ever emits constructed
  // object fields, so this is defensive-depth only; the skip mirrors that
  // parser's own `isPlainObject` posture — a malformed field has no name to
  // attribute, so it degrades to a silent skip rather than a diagnostic.
  const fields = (
    Array.isArray(schema?.fields) ? schema!.fields : []
  ).filter((field): field is TypeProfileField => isPlainObject(field));

  // Reserved system fields (Notidian-loan.15, Atlas Method ADR-0069 D1):
  // context_class + locked are RECOGNIZED field names with FIXED definitions,
  // merged into the working field set of every REAL parsed profile so the SAME
  // per-field machinery below validates them (strict enum for context_class,
  // the existing boolean coercion path for locked). Merged HERE, at the
  // validation boundary — NOT into NotidianTypeProfile.fields — so they never
  // reach planTypeProfileApply's column projection or serializeTypeProfileField's
  // hub round-trip (the loan.15 scope fence). The reserved definition is
  // AUTHORITATIVE: any same-named field the hub also declared is dropped
  // (case-folded) before the reserved one is appended. A null/undefined schema
  // (not a type profile) injects nothing — `fields` is already [] — so
  // validateRow(null, ...) stays [] exactly as before this wave.
  const allFields =
    schema == null
      ? fields
      : [
          // A field whose `name` is absent/non-string (a malformed def that
          // survived the isPlainObject filter above) can never BE a reserved
          // name, so keep it untouched — matching this module's "never throws"
          // adversarial contract; only string names are case-folded/compared.
          ...fields.filter(
            (field) =>
              typeof field.name != "string" ||
              !reservedFieldNames.has(field.name.toLowerCase())
          ),
          ...RESERVED_SYSTEM_FIELDS,
        ];

  const effectiveRow: Record<string, unknown> = { ...rowRecord, ...patchRecord };
  const fieldsByName = new Map(allFields.map((field) => [field.name, field]));

  for (const field of allFields) {
    pushSafe(violations, () => checkType(field, effectiveRow));
    pushSafe(violations, () => checkEnum(field, effectiveRow));
    pushSafe(violations, () => checkRequired(field, effectiveRow));
    pushSafe(violations, () => checkPattern(field, effectiveRow));
    pushSafe(violations, () => checkTitleBinding(field, effectiveRow, ctx));
    pushSafe(violations, () => checkEmptyEncoding(field, effectiveRow));
    pushSafe(violations, () => checkUnique(field, effectiveRow, fieldsByName, ctx));
    pushSafe(violations, () => checkReference(field, effectiveRow, ctx));
  }

  const invariants = Array.isArray(schema?.invariants) ? schema!.invariants : [];
  for (const invariant of invariants) {
    pushSafe(violations, () => evaluateInvariant(invariant, effectiveRow, fieldsByName));
  }

  return violations;
};

// `validateRow(schema, row, ctx)` -> Violation[]: validates a row AS CURRENTLY
// OBSERVED (`patch === row`) — this wave's only caller (the read-only
// reconciler, S4) never has a "proposed" patch, only a live snapshot.
export const validateRow = (
  schema: NotidianTypeProfile | null | undefined,
  row: Record<string, unknown>,
  ctx: ValidateRowCtx = {}
): Violation[] => validateRowPatch(schema, row, row, ctx);
