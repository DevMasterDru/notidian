# ADR 0058: Derived-Field Authority Class — Formula Is the Authority for Materialized Fields

## Status

**Accepted** — owner ratified 2026-07-02 via the Data Integrity Program design
(`docs/superpowers/specs/2026-07-02-data-integrity-program-design.md`),
explicitly per §4 risk/decision points **2** ("F4 conflict-authority rule...
must be ratified explicitly; it deliberately weakens ADR-0009 for one declared
field class") and **5** (ADR 0055's open storage question resolved as
frontmatter, engine-owned). This is a **cross-cutting decision**, not a
delivery wave by itself — it grounds
[ADR 0056](0056-type-profile-v3-schema-registry.md)'s `derived` schema
declaration (Wave 1a) and [ADR 0057](0057-validation-core-reconciler-health-surfaces.md)'s
reconciler-healing behavior (Wave 1b), and is the authority chapter
[ADR 0055](0055-template-sync-computed-properties.md) itself flagged as
missing ("this rule must be added to the ADR set explicitly or F4 and
ADR-0009 will fight" — spec F4). Full build-out (generalizing beyond
template sync to `lookup`/`rollup` kinds, the dependency index) is **Wave 4**
of the program (spec §3), tracked by bd epic `Notidian-v341`; this ADR is
ratified now, ahead of that wave, so Wave 1a/1b schema authors and future
Wave 2/4 implementers share one settled rule instead of improvising
inconsistent ones. Not yet sessionized beyond what `Notidian-v341` already
scopes for template sync specifically.

## Date

2026-07-02

## Context

### The tension this closes

Three existing ADRs each say something true about computed values, and taken
together they contradict each other the moment a computed value can be
**stored**:

- [ADR 0001](0001-authority-partitioned-database-model.md) /
  [ADR 0017](0017-explicit-notidian-ownership.md): a `computed` column
  (`fileprop`/`aggregate`/`rollup`/`backlink`) is **never persisted** —
  `apiValueWriteTarget` resolves it to `"skip"`. "Recompute and display; do
  not treat as durable user data."
- [ADR 0009](0009-frontmatter-conflict-detection.md): a frontmatter-backed
  table write compares the row's base value against the current canonical
  value and **refuses the write if they differ**, protecting a concurrent
  external edit from being silently overwritten.
- [ADR 0055](0055-template-sync-computed-properties.md): template sync
  **does** persist a computed value to frontmatter (D2), marked
  `source: "notidian"`, and states plainly that "manual edits are overwritten
  on the next sync cycle" — which is exactly the behavior ADR 0009 exists to
  prevent, for every *other* frontmatter-backed field.

None of the three is wrong on its own terms. ADR 0055 shipped a genuine
fourth case — a computed value that is also persisted — without a formal
authority class to hold it, and without reconciling it against ADR 0009's
protection. The spec names the resulting hazard directly: if F4's dependency
resync and ADR 0009's stale-value defense both apply naively to the same
materialized field, they fight — one side must have a formal exception, and
which side is a genuine design decision, not a bug fix.

### Why this can't wait for Wave 4

The audit's D1 finding (six Gidi pin-map `device` labels scrambled — a stored
copy that drifted from its source) is the canonical case this authority class
exists to close: a `derived, materialize: frontmatter` field, once
[ADR 0058](#) governs it, self-heals instead of requiring another manual
fix. But [ADR 0056](0056-type-profile-v3-schema-registry.md) already lets a
schema author *declare* a `derived` field in Wave 1a, and
[ADR 0057](0057-validation-core-reconciler-health-surfaces.md)'s reconciler
already needs to know, in Wave 1b, whether a divergent materialized value is
a violation to badge-and-heal or a legitimate hand-edit to leave alone. Both
earlier waves need this rule to exist now, even though the write-side
resync engine (Wave 4) is not built yet.

## Decision

### D1 — A fourth (really fifth) authority class: `derived`

Alongside [ADR 0017](0017-explicit-notidian-ownership.md)'s resolution order
(`file` → `frontmatter` → `computed` → `notidian` → ambiguous-default), a
field declared `derived` in [ADR 0056](0056-type-profile-v3-schema-registry.md)'s
schema resolves by its `materialize` setting:

- **`materialize: "none"`** — render-time only. This sub-case is **not new**;
  it is a schema-declared alias for today's existing `computed` authority
  (joins the existing `computedTypes` gate: `fileprop`/`aggregate`/`rollup`/
  `backlink`; `apiValueWriteTarget → "skip"`; never persisted, unchanged).
  Declaring a field `derived, materialize: none` in the schema does not
  change its runtime behavior at all — it only makes the fact that it is
  computed, and by which formula, machine-readable
  ([ADR 0056](0056-type-profile-v3-schema-registry.md)'s entire point).
- **`materialize: "frontmatter"`** — **is** new. The formula's result is
  written to the row's frontmatter, marked `source: "notidian"` (reusing the
  [ADR 0017](0017-explicit-notidian-ownership.md) ownership marker exactly as
  [ADR 0055](0055-template-sync-computed-properties.md) D2 already does for
  templates), reactively resynced on Indexer events (Wave 4 build-out,
  generalizing [ADR 0055](0055-template-sync-computed-properties.md) D3), and
  restricted to a DAG dependency graph (generalizing
  [ADR 0055](0055-template-sync-computed-properties.md) D5's cycle rejection).

### D2 — Formula is the authority for materialized fields: an explicit, narrow carve-out from ADR 0009

**A hand-edit — or any external write — to a `derived, materialize:
frontmatter` field's stored value that diverges from the formula's current
output is not a "stale base value" for
[ADR 0009](0009-frontmatter-conflict-detection.md) to defend.** It is a
violation the reconciler ([ADR 0057](0057-validation-core-reconciler-health-surfaces.md),
extended in Wave 4 to *apply* the heal, not just detect it) recomputes and
rewrites, **journaled** with a notice (the durable journal, F5, is future
work — not built by this ADR — but the requirement that the heal is recorded,
not silent, is ratified now, per the spec's explicit "journaled" language).

This is the direct answer to the spec's §4 risk #2. It is deliberately
**narrow**:

- It applies **only** to a field the schema explicitly declares `derived,
  materialize: frontmatter`. An ordinary frontmatter-backed column — the
  overwhelming majority of every database's columns — keeps
  [ADR 0009](0009-frontmatter-conflict-detection.md)'s exact protection,
  completely unchanged. Nothing about this ADR weakens conflict detection for
  any field that is not explicitly opted into derived materialization.
- The formula wins on **divergence**, not on every write. A materialized
  field's own resync write is not a "conflict" in the ADR 0009 sense at all —
  it is the field's declared authority doing its job. What ADR 0009 must
  *not* do is treat a stale-looking materialized value as something to
  protect from the engine's own recompute.

### D3 — Kinds: `template`, `lookup`, `rollup`

Three kinds, all interpolation-free of a general formula engine (which stays
rejected, unchanged, per [ADR 0055](0055-template-sync-computed-properties.md)
D1 — this ADR does not reopen that):

- **`template`** — [ADR 0055](0055-template-sync-computed-properties.md)'s
  `{field}` local interpolation and `{fk->DB.key:field}` cross-DB lookup,
  contract unchanged. Positioned as the **first** of the three derived kinds
  — the shipped proof of the general pattern this ADR now names.
- **`lookup`** — a typed single-value cross-DB fetch: the degenerate case of
  a template that returns one typed value (not a formatted string) from a
  key-match-resolved target row.
- **`rollup`** — an aggregate over referrers: the materializable version of
  [ADR 0029](0029-frontmatter-relations-rollups-authority-ux.md)'s rollup
  engine (`computeFrontmatterRollup`), which today is render-only and never
  stored (ADR 0029 E1/C1, unchanged as the *default*). A rollup column only
  becomes subject to this ADR's rules when a schema explicitly re-declares it
  `derived, materialize: frontmatter` — an opt-in, not a reversal.

### D4 — Dependency index; supersedes ADR-0029 E3

A `{targetPath → sourcePaths[]}` dependency index — which rows' materialized
values depend on which source rows — drives reactive resync and config-time
cycle detection for all three kinds, generalizing
[ADR 0055](0055-template-sync-computed-properties.md) Phase 2's per-template
tracker. This **supersedes** [ADR 0029](0029-frontmatter-relations-rollups-authority-ux.md)'s
deferred E3 item ("live + memo invalidation keyed on the linked rows'
frontmatter version") — E3 was framed as a *pure performance optimization*
for a value that was render-only and never stored, deferrable until
profiling showed a real cost. The dependency index is not that: the moment a
derived value can be *materialized*, tracking which stored rows depend on
which source rows is **required infrastructure** for correct resync, not an
optional speed-up. E3 itself remains un-built and is subsumed by D4 rather
than implemented separately. Undeclared (`materialize: none`) rollups are
unaffected — they keep ADR 0029 E1's live on-render recompute with no
dependency tracking needed, exactly as today.

### D5 — Resolves ADR-0055's storage question generally

[ADR 0055](0055-template-sync-computed-properties.md) shipped D2 (frontmatter
storage, engine-owned) for template sync specifically, without stating
whether that was the general policy for every future derived kind or a
one-off. This ADR resolves it generally: **`materialize: "frontmatter"` is
available to any derived kind that opts in**, consistent with the owner's
2026-06-30 groupability/interoperability rationale already accepted for
template sync (frontmatter values are groupable, sortable, filterable, and
portable outside Notidian). **`materialize: "none"` remains available and is
the default** for any `derived` field that does not explicitly opt in —
nothing changes for a schema that never declares `materialize`.

## Consequences

### Effect on [ADR 0009](0009-frontmatter-conflict-detection.md)

Gains the explicit, narrow carve-out described in D2. This is the only change
this program makes to ADR 0009's boundaries in Wave 1/pre-Wave-2 — no code in
this ADR touches `tableEditTransaction.ts`; the rule is ratified now so
Wave 2 (the write-gate wiring) and Wave 4 (the resync engine) do not have to
relitigate it when they land. ADR 0009's mechanism, scope, and every other
boundary are otherwise unchanged.

### Effect on [ADR 0017](0017-explicit-notidian-ownership.md)

The authority resolution order gains a class alongside the existing four.
`propertyAuthorityForColumn` will need extending (Wave 4 code, not this
ADR's) to check `derived, materialize: frontmatter` before falling through to
`frontmatter`/`notidian`, and to keep `derived, materialize: none` folded
into the existing `computed` class rather than duplicating it. More
substantively: the `source: "notidian"` marker's **meaning is generalized**.
ADR 0017 only ever discussed the marker for hand-declared, MDB-owned,
caller-written values ("Notidian-owned field" as a user's explicit storage
choice). On a `derived, materialize: frontmatter` field, the same marker
additionally means "this frontmatter value's *formula*, not its last writer,
is authoritative" — new information ADR 0017's text did not carry, because
ADR 0017 predates any engine-recomputed, engine-*rewritten* frontmatter
value. **This ADR refines, and does not supersede, ADR 0017** — the same
posture ADR 0017 itself took toward ADR 0001.

### Effect on [ADR 0029](0029-frontmatter-relations-rollups-authority-ux.md)

C1/C3's "the rollup result stays computed, never stored" is **narrowed**, not
reversed: "...unless the rollup field is explicitly declared `derived,
materialize: frontmatter` under this ADR." The undeclared, default rollup
column keeps ADR 0029's exact behavior — computed live, on-render, never
stored, no dependency tracking. D4 formally supersedes the deferred E3
optimization item (subsumed, not separately built).

### Effect on [ADR 0044](0044-context-insert-row-create-authority-gate.md) (still OPEN)

Clarifies, without resolving, `Notidian-2yh`. ADR 0044 Option B's reasoning
("never persist a derived value" justifies dropping a computed field on
insert) holds **unchanged** for `derived, materialize: none` fields — still
`skip`. A `derived, materialize: frontmatter` field is a genuinely new third
case none of ADR 0044's Options A/B/C enumerated: on insert, a caller-supplied
value for such a field should be **dropped** (the formula, not the caller,
owns the field — consistent with D2's "formula is the authority"), and the
field should be computed-and-written by the derived-sync engine immediately
after row creation, not sourced from the insert payload at all. This ADR
records that guidance for whichever way ADR 0044 eventually resolves; it does
not itself decide ADR 0044 and makes no change to `api.ts` or the pinned
`api.authority.context.test.ts` characterization.

### Effect on [ADR 0055](0055-template-sync-computed-properties.md)

**Generalized, not superseded.** Template becomes the first of the three
`derived` kinds (D3). Every one of ADR 0055's decisions carries forward
unchanged as the shape every derived kind now follows: D2 (frontmatter
storage + `source: "notidian"`), D3 (Indexer-event, debounced sync trigger),
D4 (reactive two-way propagation — forward recompute + FK re-resolution,
explicitly **not** reverse-parsing a stored value back into constituent
fields), D5 (DAG-only; cross-kind cycles rejected at config time, generalized
by D4 above into the shared dependency index). D6 (template config stored as
column `value` JSON) generalizes into
[ADR 0056](0056-type-profile-v3-schema-registry.md)'s `derived:` schema-field
declaration as the now-canonical storage location. ADR 0055's phased
Implementation Plan is unaffected by this ADR; `Notidian-v341` remains its
tracking epic. This ADR is the authority-model chapter ADR 0055's own text
flagged as missing and did not itself write.

## Rejected alternatives

- **Let ADR-0009 win unconditionally** (treat any hand-edit to a materialized
  field as a legitimate value to defend; the formula never overwrites it).
  Rejected: it would make the audit's D1 finding (six wrong pin-map device
  labels) a *permanent* state rather than a self-healing one — directly
  contradicting the whole program's stated philosophy (spec §0: "invalid
  states may exist transiently; they cannot persist unnoticed"). A
  materialized field that can be silently hand-corrupted and then defended by
  conflict detection is not actually engine-owned, no matter what its
  `source: "notidian"` marker claims.
- **Let the reconciler win unconditionally, with no journal entry.**
  Rejected: silently overwriting a hand-edit with zero record is a worse UX
  regression than the drift it fixes — the owner loses all visibility into
  what changed and why. The spec's decision point states "journaled"
  explicitly, not as an optional nicety; D2 keeps that requirement
  load-bearing even though the journal mechanism itself (F5) is future work.
- **Make `materialize: "frontmatter"` the default for every derived kind.**
  Rejected: it would silently start writing frontmatter for every existing
  rollup/lookup-shaped column the moment this ADR's schema surface ships,
  without any owner opt-in. `materialize: "none"` stays the default,
  preserving today's render-only computed behavior for every schema that
  does not explicitly ask for materialization — minimizes blast radius and
  matches [ADR 0029](0029-frontmatter-relations-rollups-authority-ux.md)'s
  existing rollup default exactly.
- **Reopen the formula-engine question** (justify D3's `lookup`/`rollup`
  kinds by finally adding conditionals/arithmetic). Rejected: none of the
  three kinds needs a general expression language; each is a fixed,
  interpolation-free computation shape.
  [ADR 0055](0055-template-sync-computed-properties.md) D1's rejection of a
  formula engine stands unchanged.
- **Fold this decision into a revision of ADR 0009 itself** (rewrite ADR
  0009's text to carry the exception inline). Rejected in favor of a
  cross-cutting ADR that references ADR 0009's scope without touching it:
  the task and the spec both frame this explicitly as "a declared exception
  to ADR-0009," not a rewrite — ADR 0009's own file, boundaries, and
  Implementation Notes are entirely unchanged; no file under
  `docs/adr/0009-*` is touched by this decision.

## Related

- [ADR 0001](0001-authority-partitioned-database-model.md) — the
  authority-partitioned model this class extends.
- [ADR 0009](0009-frontmatter-conflict-detection.md) — receives the narrow
  carve-out (D2).
- [ADR 0014](0014-notidian-only-personal-database-engine.md) — Notidian-only
  engine; MDB/derived values must not silently own frontmatter.
- [ADR 0017](0017-explicit-notidian-ownership.md) — authority resolution
  order extended (D1); `source: "notidian"` marker meaning generalized.
- [ADR 0029](0029-frontmatter-relations-rollups-authority-ux.md) — rollup
  engine the `rollup` kind (D3) materializes; C1/C3 narrowed, E3 superseded
  (D4).
- [ADR 0044](0044-context-insert-row-create-authority-gate.md) — still-OPEN
  insert authority gate; this ADR's D2/D3 inform, but do not resolve, it.
- [ADR 0055](0055-template-sync-computed-properties.md) — generalized, not
  superseded; `template` is the first `derived` kind (D3).
- [ADR 0056](0056-type-profile-v3-schema-registry.md) — the `derived` schema
  surface this ADR gives authority semantics to (Wave 1a).
- [ADR 0057](0057-validation-core-reconciler-health-surfaces.md) — the
  reconciler that detects divergence and (Wave 4) applies the heal.
- Spec: `docs/superpowers/specs/2026-07-02-data-integrity-program-design.md`
  §1 F4, §3 (Wave 4), §4 risk #2 and #5.
- bd epic `Notidian-v341` — template sync tracking epic; natural anchor for
  Wave 4's generalization work when pulled.

## Implementation notes

No code changes ship with this ADR — it is a pure authority-model decision.
Wave 4 build-out (generalizing beyond template sync to `lookup`/`rollup`,
building the dependency index, extending `propertyAuthorityForColumn`, and
implementing the reconciler's *apply* side for materialized-field healing) is
tracked against bd epic `Notidian-v341` and sessionized separately when the
owner pulls Wave 4, per the spec's delivery plan (§3). Until then, this ADR's
only immediate effect is that [ADR 0056](0056-type-profile-v3-schema-registry.md)
schema authors and [ADR 0057](0057-validation-core-reconciler-health-surfaces.md)'s
reconciler share one settled rule for what a `derived` declaration means.
