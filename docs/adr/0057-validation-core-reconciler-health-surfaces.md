# ADR 0057: Pure Validation Core + Read-Only Reconciler & Health Surfaces

## Status

**Accepted** — owner ratified 2026-07-02 via the Data Integrity Program design
(`docs/superpowers/specs/2026-07-02-data-integrity-program-design.md`,
features F2's pure core + F3). This is **Wave 1b** of that design's five-wave
delivery plan (§3), paired with
[ADR 0056](0056-type-profile-v3-schema-registry.md) (Wave 1a, the schema this
ADR validates against) and grounded by
[ADR 0058](0058-derived-field-authority-class.md) (derived-field authority,
cross-cutting). **No write-path change is in scope for this ADR** — the
validation core defined here is read-only in this wave; wiring it into the
interactive write funnel is a future Wave 2 (F2) ADR, not written here. Not
yet sessionized into bd issues.

## Date

2026-07-02

## Context

### The owner's felt problem

The Data Integrity Program's stated enforcement model (spec §0) has three
tiers, strongest first: **derive** (the fact can't drift because it's
computed), **reject** (a sanctioned write channel refuses an invalid value),
**reconcile** (an unsanctioned write — raw filesystem edit, external tool, git
merge — is detected within seconds, badged, journaled, and offered repair).
Wave 1 deliberately ships **only the read-only half of tier 3** first: a
schema now exists ([ADR 0056](0056-type-profile-v3-schema-registry.md)) but
nothing yet checks live data against it. The owner's actual daily question —
"did my edit break something?" — is a read question, answerable without
touching any write path. Shipping that first proves the schema is worth
trusting before any write behavior changes.

### What already exists that this reuses

- **Pure planners, Obsidian-free, as the established pattern**
  (`src/core/utils/contexts/notidianSchema.ts`,
  `typeProfile.ts`) — [ADR 0015](0015-canonical-schema-planning.md)'s
  precedent that schema logic must be testable without runtime state. This ADR
  follows the same pattern for validation.
- **`metadataCache` events + the Indexer** already drive reactive updates
  (`ContextEditorContext` listens to `contextStateUpdated`; the Indexer
  maintains `pathsIndex`/`contextsIndex`) — the natural hook for incremental
  revalidation, same as [ADR 0055](0055-template-sync-computed-properties.md)
  D3's sync trigger.
- **`tableEditFeedback.ts`** ([ADR 0007](0007-table-edit-feedback.md)) already
  establishes transient, non-durable, cell-level feedback state as a UI
  pattern — this ADR's badges are a sibling surface, not a reuse of the same
  state (tableEditFeedback is edit-operation-scoped and transient; health
  badges are schema-derived and live for as long as the violation exists).
- **`computedTypes` gate** (`fileprop`/`aggregate`/`rollup`/`backlink`,
  `src/core/utils/properties/propertyAuthority.ts:21`) — the existing
  "recompute, never persist" class this ADR's read-only checks respect
  unchanged.

### The gap

Today, "did my edit break something?" has exactly one answer: ask an AI to
manually re-derive and check the rules (the audit's framing of the
owner's actual workaround), or trust a hand-written Dataview health query
(the audit's D7 finding: rows escaping hand-written checks because the check
was wrong, not the data). Neither is schema-driven, so neither can catch a
class of defect the schema itself doesn't yet know to check for, and — the
sharper failure — a field rename silently produces a **passing** hand-written
query instead of a screaming one (the audit's "18/19 validators silently
pass-empty" finding).

## Decision

### D1 — `validateRowPatch`: a pure, Obsidian-free validation core

```ts
validateRowPatch(
  schema: TypeProfileSchema,   // ADR 0056 v3 profile, parsed
  row: Record<string, unknown>,       // the row's current known fields
  patch: Record<string, unknown>      // proposed changes; == row when validating as-is
): ValidationIssue[]
```

```ts
type ValidationIssue = {
  field: string;
  code: "type" | "enum" | "required" | "unique" | "pattern"
      | "reference-broken" | "invariant";
  severity: "error" | "warn";
  message: string;
};
```

Checks implemented against [ADR 0056](0056-type-profile-v3-schema-registry.md)'s
v3 schema: type/enum(strict)/required/unique/pattern/reference-existence, plus
every declared invariant (`when`/`require`, evaluated through the existing
`filterReturnForCol` machinery the predicate DSL already provides — no new
evaluator). Uniqueness and reference-existence checks need a live-row
snapshot to compare against; the caller supplies it (the function itself
remains pure — it takes the snapshot as data, it does not read
`pathsIndex`/`contextsIndex` itself).

**This wave's only caller is the read-only reconciler (D2/D3 below), invoked
with `patch === row`** — validating a row as currently observed, not a
proposed edit. `validateRowPatch`'s pre-write invocation inside
`executeTableValueWrites` and every `api.*` write verb (the spec's F2 —
"gates apply to all channels including row-create," per
[ADR 0044](0044-context-insert-row-create-authority-gate.md)'s established
precedent) is **out of scope for this ADR** and deferred to a future Wave 2
ADR. Building the function pure and channel-agnostic now means Wave 2 wires
in an already-tested function rather than writing new validation logic under
write-path time pressure.

### D2 — Revalidation triggers

- **Incremental**: on `metadataCache` change events for rows in a schema'd
  folder, re-validate that one row (debounced), matching
  [ADR 0055](0055-template-sync-computed-properties.md) D3's sync-trigger
  pattern.
- **Full sweep**: on vault open, and on schema change (a hub note's Type
  Profile frontmatter edit — the same trigger
  [ADR 0015](0015-canonical-schema-planning.md)'s planner mirror already
  detects via the default-schema mirror gate; this wave adds a consumer, no
  new detection primitive).
- Read-only throughout: the reconciler consumes `pathsIndex`/`contextsIndex`
  and computes violations; it never writes. At Gidi's live scale (~330 rows)
  this is trivial; the design is batched/incremental regardless, to remain
  correct as any database grows.

### D3 — Health surfaces

- **Per-row violation badges** in table cells — plain text/CSS decoration,
  no new `innerHTML`/`dangerouslySetInnerHTML` sink (the sanitize invariant
  memorialized in [ADR 0017](0017-explicit-notidian-ownership.md) /
  [ADR 0019](0019-select-to-comment-anchoring-and-ai-review-channel.md)'s
  context).
- **Table-header health chip**: green check when the visible table has zero
  violations, or an `N issues` count otherwise.
- **Database Health panel**: per-database and vault-wide, with jump-to-row.
  Violation state is never stored — it is always recomputed from
  [ADR 0056](0056-type-profile-v3-schema-registry.md)'s schema over the live
  index, the same "computed, not durable" posture
  [ADR 0029](0029-frontmatter-relations-rollups-authority-ux.md) already
  applies to rollups.

### D4 — Broken-row rendering

A file in a schema'd folder whose frontmatter **fails to parse** (the audit's
`wall-04` class — an unquoted colon or similar YAML break) renders as a
visible **error row** in the table instead of silently vanishing from every
query. Today, a parse failure means `pathsIndex.get(path)?.metadata?.property`
is absent, so the row is simply missing from every `pathsIndex`-driven view —
invisible, not flagged. The reconciler closes this by enumerating a schema'd
folder's files directly (a vault file listing, not solely the metadata-cache
projection) and cross-referencing against `pathsIndex`/`contextsIndex`: a
file present in the folder but absent or malformed in the index renders as an
error row with a "frontmatter failed to parse" message, gated to schema'd
folders only (an unprofiled folder's behavior is unchanged).

### D5 — Repair tiers (declared in schema, detection only this wave)

Each violation class is declared in the schema
([ADR 0056](0056-type-profile-v3-schema-registry.md)'s `invariant.autofix`
field, and analogously for the built-in checks) as one of three tiers:

- **`autofix`** — mechanical and lossless only. Per the owner's explicit
  ratified scope (spec §4 risk #4): **encoding normalization** (rewriting a
  value to the field's declared `empty` policy,
  [ADR 0056](0056-type-profile-v3-schema-registry.md) D5) and **derived-field
  refresh** (recomputing a stale `derived, materialize: frontmatter` value,
  [ADR 0058](0058-derived-field-authority-class.md)). Nothing else is
  autofixed in this wave or any future wave without a separately ratified
  expansion of this list — this is a scope boundary, not a starting point to
  grow implicitly.
- **`one-click`** — a reviewed, single-action repair the user explicitly
  triggers (e.g. a reference picker to resolve a broken FK).
- **`manual-only`** — flagged with no automated remedy offered.

This wave implements **detection and the tier taxonomy only** — a violation is
labeled with its declared tier in the badge/panel UI. Actually *applying* a
repair (writing the fix) requires a write path and is Wave 2 (`autofix`/
`one-click` application) and Wave 5 (journaling the repair,
[ADR 0058](0058-derived-field-authority-class.md)'s "journaled" requirement
for reconciler heals) — both out of this ADR's scope. Declaring the taxonomy
now lets [ADR 0056](0056-type-profile-v3-schema-registry.md) schema authors
annotate repair tiers starting immediately, even though the "click to repair"
action ships later.

### D6 — Structural immunity to pass-empty

Because every check in D1 derives from the schema evaluated over the live
index — never a hand-written predicate maintained separately — a field
rename or vocabulary drift cannot silently validate as OK. It surfaces as
missing-required or unknown-key violations across every affected row: the
loudest possible signal, not a silent pass. This is the structural answer to
the audit's "18/19 validators silently pass-empty" finding and its D7 finding
(rows escaping hand-written checks): once checks are generated from schema,
there is no hand-written predicate left to get wrong.

## Consequences

### Effect on [ADR 0002](0002-frontmatter-backed-context-columns.md)

D4's broken-row rendering is a new behavior. ADR 0002 established that the
context table is a projection over frontmatter — no parseable frontmatter, no
row — which is why a parse failure is invisible today. This ADR does not
change that projection model; it adds a **diagnostic rendering path**, gated
to schema'd folders, that surfaces the corrupt-parse edge case as a visible
error row sourced from a raw file listing rather than the frontmatter
projection. A non-profiled folder's behavior — silent absence on parse
failure — is unchanged.

### Effect on [ADR 0009](0009-frontmatter-conflict-detection.md)

`validateRowPatch` and ADR 0009's stale-value conflict detection are
orthogonal checks that will compose once Wave 2 wires validation into the
write funnel (out of this ADR's scope — no code in this wave touches
`tableEditTransaction.ts`). Conflict detection answers "is this write based on
stale canonical data"; validation answers "is this value schema-legal." This
ADR fixes their future composition order for the record, so Wave 2 does not
have to relitigate it: conflict detection runs first (cheaper, already
implemented, protects against clobbering a concurrent edit), then validation
(new). Neither check supersedes the other. Separately,
[ADR 0058](0058-derived-field-authority-class.md) declares one **narrow**
exception to ADR 0009's scope for `derived, materialize: frontmatter` fields —
that carve-out is ADR 0058's decision, not this one's.

### Effect on [ADR 0015](0015-canonical-schema-planning.md)

Full-sweep revalidation (D2) triggers on the same "schema changed" signal the
ADR 0015 planner's table↔hub mirror already detects — no new detection
primitive is added; this wave adds a new consumer of an existing signal.

### Effect on [ADR 0044](0044-context-insert-row-create-authority-gate.md)

`validateRowPatch` is deliberately built schema-driven and write-channel
agnostic. Per the spec's explicit citation of ADR 0044's own precedent
("gates apply to all channels including row-create"), when Wave 2 eventually
wires validation into every `api.*` write verb, `api.context.insert` will
receive the same validation as `update`/`setProperty` regardless of which way
ADR 0044's still-open authority-gate decision (`Notidian-2yh`) resolves. This
ADR does **not** resolve ADR 0044 and makes no change to `api.ts` or its
pinned characterization test — it only guarantees the future validation layer
will be uniform across write channels once wired, additional context for that
still-open decision.

## Rejected alternatives

- **Wire `validateRowPatch` into the write funnel this same wave** (fold
  Wave 1b into Wave 2/F2). Rejected: the spec's delivery plan (§3)
  deliberately sequences a read-only proof of value before any write-path
  change, and the owner's stated daily problem is answered passively by
  detection alone. Touching the higher-risk write path is unnecessary to
  deliver this wave's value and would widen this ADR's blast radius for no
  gain this wave.
- **Store violation state durably** (e.g. in the context MDB, or a
  `.notidian/health` cache). Rejected: violations are always recomputed from
  schema + live index — the same "computed, not durable" posture
  [ADR 0001](0001-authority-partitioned-database-model.md) and
  [ADR 0029](0029-frontmatter-relations-rollups-authority-ux.md) already
  apply to rollups — so they self-correct the instant underlying data changes
  and never need their own reconciliation.
- **Full-vault scan on every `metadataCache` event.** Rejected in favor of
  incremental, debounced, per-row revalidation plus a full sweep only at the
  two defined triggers (open, schema change) — matching
  [ADR 0029](0029-frontmatter-relations-rollups-authority-ux.md) C4's
  perf-bounded posture (no full-vault scan on a hot path).
- **Expand the autofix tier beyond encoding normalization + derived refresh**
  (e.g. auto-repairing a broken reference by guessing the closest match).
  Rejected per the owner's explicit ratified scope (spec §4 risk #4): autofix
  must stay mechanical and lossless; anything requiring judgment is
  `one-click` or `manual-only`, never silently auto-applied.
- **Skip the tier taxonomy until Wave 2/5 actually apply repairs.** Rejected:
  declaring the taxonomy now lets [ADR 0056](0056-type-profile-v3-schema-registry.md)
  schema authors annotate tiers from the start, so Wave 1a's pilot (the seven
  Gidi registries) ships with repair intent already recorded rather than
  needing a second schema-authoring pass later.

## Related

- [ADR 0001](0001-authority-partitioned-database-model.md) — computed values
  are recomputed, never durable; the posture violation state follows.
- [ADR 0002](0002-frontmatter-backed-context-columns.md) — the projection
  model D4's broken-row rendering adds a diagnostic path alongside.
- [ADR 0007](0007-table-edit-feedback.md) — sibling transient-feedback
  pattern; badges are a distinct, schema-derived, longer-lived surface.
- [ADR 0009](0009-frontmatter-conflict-detection.md) — orthogonal write-path
  check this ADR's validation core will compose with in Wave 2.
- [ADR 0015](0015-canonical-schema-planning.md) — pure-planner precedent;
  schema-change detection reused by D2.
- [ADR 0017](0017-explicit-notidian-ownership.md) /
  [ADR 0019](0019-select-to-comment-anchoring-and-ai-review-channel.md) — the
  sanitize invariant D3's badges must respect (no new `innerHTML` sink).
- [ADR 0029](0029-frontmatter-relations-rollups-authority-ux.md) — perf-bounded
  posture (C4) D2's incremental design follows; computed-not-durable posture
  (E1) violation state follows.
- [ADR 0044](0044-context-insert-row-create-authority-gate.md) — write-channel
  uniformity precedent D1 is built to satisfy once wired.
- [ADR 0055](0055-template-sync-computed-properties.md) — Indexer-event sync
  trigger pattern D2 reuses.
- [ADR 0056](0056-type-profile-v3-schema-registry.md) — the schema this ADR
  validates against (Wave 1a).
- [ADR 0058](0058-derived-field-authority-class.md) — derived-field refresh
  autofix (D5) and the narrow ADR-0009 carve-out.
- Spec: `docs/superpowers/specs/2026-07-02-data-integrity-program-design.md`
  §1 F2 (pure core) / F3, §2 (Gidi adoption map), §3 (Wave 1), §4 risk #4
  (autofix scope).

## Implementation notes

Not yet sessionized. The existing foundation this reuses: pure-planner
pattern (`src/core/utils/contexts/notidianSchema.ts`), Indexer/metadataCache
event wiring (`ContextEditorContext.tsx`, `contextStateUpdated`),
`tableEditFeedback.ts` as a sibling UI-feedback pattern, and the
`computedTypes` gate (`src/core/utils/properties/propertyAuthority.ts:21`)
this ADR's read-only checks must not disturb. A follow-up session sessionizes
Wave 1b per the Atlas Method, pairing with
[ADR 0056](0056-type-profile-v3-schema-registry.md)'s Wave 1a work per the
spec's stated pilot: author v3 schemas for the seven Gidi registries and
validate the reconciler catches the audit's D1–D7 findings live.
