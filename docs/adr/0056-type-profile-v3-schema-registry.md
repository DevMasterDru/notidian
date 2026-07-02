# ADR 0056: Type Profile v3 — Schema Registry

## Status

**Accepted** — owner ratified 2026-07-02 via the Data Integrity Program design
(`docs/superpowers/specs/2026-07-02-data-integrity-program-design.md`, feature
F1). This is **Wave 1a** of that design's five-wave delivery plan (§3).
Companion to [ADR 0057](0057-validation-core-reconciler-health-surfaces.md)
(pure validation core + read-only reconciler, Wave 1b) and
[ADR 0058](0058-derived-field-authority-class.md) (derived-field authority
class, cross-cutting). Not yet sessionized into bd issues.

## Date

2026-07-02

## Context

### Problem provenance

The design responds to `Gidi repo
docs/audits/2026-07-02-notidian-database-governance-audit.md` (defects D1–D7,
root causes RC1–RC6) — a governance audit of the seven Gidi hardware
registries, which are Notidian databases. Several findings trace to the same
root cause: **the schema has no single machine-readable home**, so every
consumer (the table UI, hand-written Dataview health queries, `gidi_tooling.py`
checks, AI-agent prompts) restates its own copy of "what's valid here," and the
copies drift from each other and from the data.

### What already exists (Type Profile v1/v2)

A folder database can already opt into a **Type Profile**: its hub note (the
folder note) declares `schema_type: notidian_type_profile` plus `fields:` /
`kind_fields:` maps (`src/core/utils/contexts/typeProfile.ts`,
`parseTypeProfile`). Per field, today's `TypeProfileField` carries:

```ts
type TypeProfileField = {
  name: string;
  kind: string;      // discriminator: text/select/multi_select/date/number/...
  type: string;       // mapped Notidian column type
  options?: string[]; // v1: advisory suggestions only, not enforced
  required?: boolean; // v1/v2: parsed, but has zero consumers beyond the parse
  value?: string;      // default value seeded on row create (ADR 0028)
};
```

`planTypeProfileApply` mirrors the hub's declared `kind`/`options` onto the
table's columns (hub → table); `planTypeProfileMirror` mirrors schema edits
made in the table back onto the hub's `fields`/`kind_fields` maps (table →
hub), keeping both in sync. `newRowFrontmatterFromProfile` seeds a new row's
frontmatter from declared `value` defaults. This is a real, tested,
bidirectional schema mirror — but it stops at type + advisory options + an
inert `required` flag. It has **no** enum enforcement, uniqueness, pattern
validation, title binding, empty-encoding policy, declared cross-database
references, or derived-field declarations, and **no** per-database invariant
language at all.

### The gap this closes

Confirmed by inspection: `TypeProfileField.options` never gates a write
anywhere in the codebase (the field is a suggestion list consumed only by the
option-column UI), and `.required` has exactly one write site — the parse
assignment in `typeProfile.ts:114` — and zero read sites outside its own test.
This matches the audit's D6 finding (required `model` field silently missing on
Gidi rows) and the "18/19 validators silently pass-empty" finding: nothing in
the schema layer can currently make a violation loud.

## Decision

Extend the Type Profile schema — the hub note's `schema_type:
notidian_type_profile` frontmatter — to **v3**, adding per-field declarations
and a new per-database `invariants:` block. v3 is additive and
backward-compatible: every v3 key is optional; a v1/v2 hub with no new keys
parses identically to today.

### D1 — Extended per-field schema

`TypeProfileField` gains six new optional properties. None of them enforce
anything by themselves — enforcement is [ADR 0057](0057-validation-core-reconciler-health-surfaces.md)'s
`validateRowPatch` (Wave 1b, read-only detection) and a future Wave 2 write
gate (F2, not part of this ADR):

```ts
type TypeProfileField = {
  // ...existing kind/type/options/required/value, unchanged...
  enum?: { values: string[]; strict: boolean };
  unique?: { scope: "database"; where?: Filter[] };
  pattern?: string;          // regex; id-shaped fields
  title_binding?: boolean;   // this field must mirror the file basename
  empty?: "absent" | "empty-string"; // canonical empty encoding
  reference?: {
    targetFolder: string;
    targetKey: string;
    onBrokenWrite: "block" | "warn";
    onReferencedChange: "warn" | "cascade-preview";
  };
  derived?: {
    kind: "template" | "lookup" | "rollup";
    spec: Record<string, unknown>;
    materialize: "none" | "frontmatter";
  };
};
```

### D2 — Enum-as-law

`options` remains the advisory suggestion list it is today (unchanged
behavior when `enum` is absent). A field may additionally declare `enum:
{values, strict: true}`: when `strict` is true, only the listed values are
legal — a value outside the list is a schema violation
([ADR 0057](0057-validation-core-reconciler-health-surfaces.md) detects it;
Wave 2 blocks it at write time). This directly answers the audit's "T8 vocab
copy drifts from doc enum" finding: the vocabulary lives once, in the Type
Profile, and every consumer (UI picker, validator, `gidi_tooling.py` via the
Wave 5 headless core) reads it from there instead of maintaining its own copy.

### D3 — Uniqueness

`unique: { scope: "database", where?: Filter[] }` declares that the field's
value must be unique across the database's live rows, optionally scoped by a
predicate (`where`, in the existing Filter/predicate DSL — see D8). Uniqueness
is checked against the **live index** at validation time; it is a declared
schema fact, not a stored constraint — there is no separate uniqueness ledger
to keep in sync.

### D4 — Pattern and title binding

`pattern` is a regex a field's value must match (id-shaped fields — e.g. a
GPIO pin id, a board slave number). `title_binding: true` marks a field whose
value must mirror the file's basename; this is a **declaration**, not a new
enforcement mechanism — it composes with the already-shipped filename template
mirror ([ADR 0054](0054-filename-template-mirror.md)), which already performs
basename↔frontmatter reconciliation. `title_binding` lets the schema *state*
which field that relationship holds for, so a validator can check it even on
databases that have not configured a filename template.

### D5 — Empty-encoding policy

`empty: "absent" | "empty-string"` declares the field's canonical empty
representation, so a database no longer has an unowned null-vs-`""` split (the
audit's D3 finding). This is declaration only in this ADR; normalization to
the declared policy is a Wave 2 (F2) write-time concern and an
[ADR 0057](0057-validation-core-reconciler-health-surfaces.md) autofix class.

### D6 — Declared references (key-match foreign keys)

`reference: {targetFolder, targetKey, onBrokenWrite, onReferencedChange}`
declares a field as a foreign key resolved via the existing key-match resolver
(`resolveKeyMatch`, `src/core/utils/contexts/keyMatchResolver.ts`, shipped
under [ADR 0029](0029-frontmatter-relations-rollups-authority-ux.md) B1 /
`Notidian-mx0k.1`). The config shape mirrors
`KeyMatchRelationConfig.{targetFolder, targetField}` exactly (`targetKey` here
= `targetField` there — renamed for schema-declaration readability, same
semantics). What is new is that the reference becomes **declared and
validated**, not just resolvable on demand from a rollup config:

- `onBrokenWrite: "block" | "warn"` — what happens (once Wave 2 wires the
  write gate) when a write would set the field to a value with no matching
  target row.
- `onReferencedChange: "warn" | "cascade-preview"` — what happens when a row
  that N other rows key-match-reference is edited or deleted: warn with the
  referrer list, or offer a cascade preview (reusing the
  [ADR 0015](0015-canonical-schema-planning.md) preview pattern).

This directly answers the audit's "3-file ESP sync set" finding once paired
with [ADR 0058](0058-derived-field-authority-class.md)'s rollup kind: a
declared reference plus a derived rollup collapses a 3-file manual sync set to
1–2 files with the third auto-derived.

### D7 — Derived-field declarations (schema surface only)

`derived: {kind, spec, materialize}` declares that a field's value is computed
rather than authored. This ADR adds only the **schema surface** — the shape a
hub note can declare. The authority semantics (what "computed" means for
writes, conflict detection, and the reconciler) are the cross-cutting decision
in [ADR 0058](0058-derived-field-authority-class.md), which this ADR depends
on for meaning but not for its own schema shape. `kind: "template"` reuses
[ADR 0055](0055-template-sync-computed-properties.md)'s interpolation syntax
unchanged; `lookup` and `rollup` are new kinds ADR 0058 defines.

### D8 — Per-database invariants, in the existing predicate DSL

A hub note gains an optional top-level `invariants:` list. Each invariant is:

```ts
type Invariant = {
  when?: Filter[];      // optional guard; empty/absent = applies to every row
  require: Filter[];    // must all hold for the row to be valid
  severity: "error" | "warn";
  message: string;
  autofix?: string;     // an autofix class name declared in ADR 0057, or absent
};
```

`Filter` is the **existing** `{field, fn, value, fType}` shape
(`src/shared/types/predicate.ts`) already used by every view's filter bar and
evaluated by `filterReturnForCol`
(`src/core/utils/contexts/predicate/filter.ts`) — no new expression language.
This mirrors [ADR 0055](0055-template-sync-computed-properties.md) D1's
rejection of a full formula engine for templates: the same "reuse the smallest
existing DSL" posture applies to invariants.

**Invariants only ever see the row's own fields, including derived fields
(D7).** There is deliberately no cross-database condition syntax. A rule like
the audit's D4 finding ("board's used channels ≤ board.channels") is expressed
in two steps: (1) declare a `derived, kind: rollup` field (e.g.
`used_channels`) that aggregates the referring rows, then (2) write a
row-local invariant `require: [{field: "used_channels", fn: "lte", value:
"channels"}]`. This keeps the invariant language simple (row-local predicate
evaluation only) and pushes all cross-database complexity into
[ADR 0058](0058-derived-field-authority-class.md)'s dependency machinery,
where it has one home instead of two.

Invariants live in the hub note's Type Profile frontmatter, which is already
established schema/config authority (the hub note is a declared schema
artifact, not an ordinary row) — the same authority class
[ADR 0029](0029-frontmatter-relations-rollups-authority-ux.md) B1 already
grants to rollup column definitions.

### D9 — Schema adoption command

A new command, "Adopt schema for this database," generates a **draft** v3
profile from a database's live rows: type inference reuses the
[ADR 0015](0015-canonical-schema-planning.md) planner's conservative-type
inference; enum candidates come from observed value-distribution frequency;
foreign-key candidates come from cross-database value-overlap scanning (the
same kind of matching `resolveKeyMatch` performs, run speculatively over every
other database instead of one declared target). The draft is written to the
hub note for the **owner to review and ratify** — it is never auto-applied.
This turns onboarding an existing, unprofiled database into a minutes-long
review instead of hand-authoring a schema from scratch.

### D10 — Schema edits go through the ADR-0015 planner

All schema edits — including a brand-new v3 kind of edit, **enum value
rename** — are planned before being applied, extending
[ADR 0015](0015-canonical-schema-planning.md)'s preview/classify/confirm
model. Enum value rename adds a row-cascade preview: because `enum: {strict:
true}` makes a value law, renaming a value is effectively a bulk data
migration (every row currently holding the old value must move to the new one
or become invalid) and must be previewed with the same rigor as the planner's
existing key-rename conflict classification (`old-only` / `new-only` /
`both-same` / `both-conflict` / `neither`).

## Consequences

### Effect on [ADR 0002](0002-frontmatter-backed-context-columns.md)

v3 schema declarations (`enum`, `pattern`, `unique`, `reference`, `derived`)
apply to frontmatter-backed columns (`source: "frontmatter"`) — the ordinary
note-property case ADR 0002 defined. They do not change ADR 0002's authority
model (frontmatter stays canonical, the context table stays a projection over
it); they add a schema layer *on top of* that projection. Explicit
`source: "notidian"` columns may also declare schema for symmetry, though the
richest v3 use case (Gidi's hardware registries) is entirely frontmatter-backed.
The schema-adoption command (D9) is a new consumer of ADR 0002's frontmatter
materialization and the ADR 0015 planner's type inference together.

### Effect on [ADR 0015](0015-canonical-schema-planning.md)

Extends the planner's remit from single-field create/rename/delete previews to
two new planner operations: (a) whole-database draft-profile generation
(D9) and (b) enum-value rename with row-cascade preview (D10). Both follow
ADR 0015's existing invariants unchanged: a schema operation must not silently
write or delete frontmatter; a rename with conflicting files must require
explicit resolution; planner output remains a preview, not proof against a
concurrent external edit.

### Effect on [ADR 0029](0029-frontmatter-relations-rollups-authority-ux.md)

- D6 (`reference`) formalizes the key-match resolver (`resolveKeyMatch`,
  shipped under ADR 0029 B1 / `Notidian-mx0k.1`) as a **declared, validated**
  foreign key rather than an ad-hoc per-rollup config. It does not change
  ADR 0029's C1 (one-way, computed inverse) decision: a declared `reference`
  stays one-way; `onReferencedChange` only warns or previews a cascade, it
  never creates a stored reciprocal (that would reopen C3's rejected
  two-way-storage case).
- D8 (invariants) allows invariants to read `derived` rollup fields as inputs.
  This does not change ADR 0029 E1 (rollups recompute live, on-render, off the
  in-memory cache, never stored) for an *undeclared* rollup column — that
  default is untouched. It only becomes relevant for a rollup field
  additionally declared `derived, materialize: frontmatter` under
  [ADR 0058](0058-derived-field-authority-class.md), which is that ADR's
  carve-out, not this one's.

## Rejected alternatives

- **A new invariant expression language.** Rejected for the same reason
  [ADR 0055](0055-template-sync-computed-properties.md) D1 rejected a formula
  engine for templates: the existing Filter/predicate DSL is already
  implemented, tested, and understood by every view's filter bar — reusing it
  keeps the schema layer's vocabulary identical to the UI's vocabulary instead
  of adding a second rule language to learn and maintain.
- **Cross-database invariant conditions** (e.g. `board.channels` referenced
  directly from a sensor row's invariant). Rejected: it would require the
  invariant evaluator to resolve foreign rows during row-local validation,
  turning a cheap, row-local check into a graph traversal on every
  revalidation. Routing cross-database facts through a declared derived
  rollup field (D7/D8) keeps invariant evaluation row-local and pushes the
  one genuinely cross-database concern (dependency tracking) into
  [ADR 0058](0058-derived-field-authority-class.md), where it has one home.
- **Storing invariants/enum vocabularies in a separate config file instead of
  the hub note.** Rejected: it would recreate the exact "schema has two
  homes" problem this design exists to close (spec §0). The hub note is
  already the one machine-readable schema home; v3 extends it rather than
  forking a second location.
- **Reusing wikilink relations (ADR 0029 A1) instead of key-match for
  `reference`.** Rejected: `reference` needs uniform broken-link detection
  across every write channel, including AI/API writes that supply a plain
  value, not a `[[wikilink]]`. Key-match already matches on plain frontmatter
  values; wikilink relations remain available, unchanged, as the mechanism
  for genuine relation columns (ADR 0029 A1) — a different, already-shipped
  feature kept separate from schema-declared `reference` fields.
- **Making `enum: strict` the default for every `select`/`multi_select`
  field.** Rejected: it would silently reclassify every existing option-typed
  column's advisory list as law the moment v3 ships, invalidating rows the
  owner never asked to be validated. `enum` is opt-in per field.

## Related

- [ADR 0001](0001-authority-partitioned-database-model.md) — authority
  boundaries the schema layer must respect.
- [ADR 0002](0002-frontmatter-backed-context-columns.md) — frontmatter-backed
  columns v3 schema applies to.
- [ADR 0014](0014-notidian-only-personal-database-engine.md) — Notidian-only
  engine; MDB must not silently own frontmatter values.
- [ADR 0015](0015-canonical-schema-planning.md) — planner extended by D9/D10.
- [ADR 0017](0017-explicit-notidian-ownership.md) — `source: "notidian"`
  marker reused by derived materialization (see ADR 0058).
- [ADR 0028](0028-per-database-row-create-templates.md) — `value` defaults,
  unchanged, carried into v3.
- [ADR 0029](0029-frontmatter-relations-rollups-authority-ux.md) — key-match
  resolver (D6) and rollup engine (D7/D8 inputs).
- [ADR 0054](0054-filename-template-mirror.md) — `title_binding` (D4) composes
  with the shipped filename template mirror.
- [ADR 0055](0055-template-sync-computed-properties.md) — `derived, kind:
  template` (D7) reuses this ADR's syntax unchanged.
- [ADR 0057](0057-validation-core-reconciler-health-surfaces.md) — consumes
  this schema to detect violations (Wave 1b).
- [ADR 0058](0058-derived-field-authority-class.md) — authority semantics for
  D7's `derived` declarations.
- Spec: `docs/superpowers/specs/2026-07-02-data-integrity-program-design.md`
  §1 F1, §2 (Gidi adoption map), §3 (Wave 1).
- Problem provenance: `Gidi repo
  docs/audits/2026-07-02-notidian-database-governance-audit.md` (D1–D7,
  RC1–RC6).

## Implementation notes

Not yet sessionized. The existing foundation this extends lives in
`src/core/utils/contexts/typeProfile.ts` (`parseTypeProfile`,
`planTypeProfileApply`), `typeProfileMirror.ts` (table↔hub mirror),
`typeProfileDefaults.ts` (row-create defaults), and
`src/core/utils/contexts/notidianSchema.ts` /
`notidianSchemaApply.ts` (the ADR-0015 planner D9/D10 extends). This ADR fixes
the design; a follow-up session sessionizes Wave 1a per the Atlas Method
(bd epic + window-sized session issues), pairing with
[ADR 0057](0057-validation-core-reconciler-health-surfaces.md)'s Wave 1b work
per the spec's stated pilot: author v3 schemas for the seven Gidi registries.
