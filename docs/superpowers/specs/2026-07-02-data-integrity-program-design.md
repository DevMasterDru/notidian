# Data Integrity Program — design (PROPOSED, awaiting owner ratification)

**Date:** 2026-07-02 · **Author:** orchestrated design session (Gidi five-agent audit → Notidian
three-agent capability scout → synthesis) · **Status:** PROPOSED — each wave below becomes its own
ADR on acceptance; nothing here is ratified yet.
**Problem provenance:** `Gidi repo docs/audits/2026-07-02-notidian-database-governance-audit.md`
(defects D1–D7, root causes RC1–RC6). **Capability provenance:** ADR-0001/0002/0006/0007/0008/
0009/0015/0017/0029/0044/0055, Type Profiles (`typeProfile.ts`), predicate DSL
(`predicate/filter.ts`), key-match resolver (`keyMatchResolver.ts`), write funnel
(`tableEditTransaction.ts`), API gate (`apiValueWrite.ts`/`propertyAuthority.ts`).

## 0. Goal and enforcement philosophy

Owner requirement: **every fact has one source of truth; where a copy must exist, Notidian owns
and enforces it.** Optimize for user convenience; implementation complexity is not a constraint.

On a files-as-rows substrate any text editor is a legal writer, so the engine cannot be a pure
gatekeeper. Enforcement model: **guarded write paths where possible, continuous reconciliation
everywhere else.** Invalid states may exist transiently; they cannot persist unnoticed. Three
enforcement tiers, strongest first:

1. **Derive** — the fact is computed, not stored (or stored but engine-owned). Drift impossible.
2. **Reject** — sanctioned write channels validate against schema; invalid writes fail loudly
   with machine-readable reasons.
3. **Reconcile** — unsanctioned writes (raw fs, external tools, git) are detected within seconds,
   badged at the row, journaled, and offered/applied a repair.

Corollary: **the schema itself must have one home** — a machine-readable per-database artifact
that the UI, the write gate, the reconciler, generated health checks, external validators, and AI
agents all read. Rule copies (Gidi's T8 vocab superset, hand-written Dataview health queries,
schema restated in AI prompts) are the meta-level version of the same disease and are eliminated
by construction.

## 1. Feature set (six features, five delivery waves)

### F1 — Schema Registry: Type Profile v3 (extends `typeProfile.ts`, ADR-0015 planner)

Type Profiles already give a hub-note machine-readable schema (`schema_type:
notidian_type_profile`, `fields:` kind/options/required/default, bidirectional table↔hub mirror).
Extend per-field with:

- `enum` — closed vocabulary (today's `options` are suggestions; `strict: true` makes them law).
- `required` — parsed today, enforced nowhere; F2 enforces it.
- `unique` — uniqueness over the database's live rows (optionally `where` a predicate holds).
- `pattern` — regex for id-shaped fields; `title_binding` for fields that must mirror basename.
- `empty` — canonical empty encoding (`""` vs absent) so null-vs-`""` splits cannot exist.
- `reference` — `{targetFolder, targetKey, onBrokenWrite: block|warn, onReferencedChange:
  warn|cascade-preview}` — key-match FKs (reuses `keyMatchResolver.ts`) become *declared and
  validated*, not just resolvable.
- `derived` — `{kind: template|lookup|rollup, spec, materialize: frontmatter|none}` (see F4).

And per-database:

- `invariants:` — list of row-level rules in the **existing Filter/predicate DSL**
  (`{when: [filters], require: [filters], severity: error|warn, message, autofix?}`).
  Invariants only ever see the row's own fields *including derived fields* — cross-database
  conditions (e.g. "board's used channels ≤ board.channels") are expressed by first declaring a
  derived rollup field, then a local invariant over it. This keeps the rule language simple and
  pushes all cross-DB complexity into F4's dependency machinery.
- Schema edits go through the ADR-0015 planner (preview/classify/confirm), now including enum
  value renames with row-cascade preview.
- **Schema adoption command**: "Adopt schema for this database" generates a draft v3 profile from
  the live rows (planner's type inference + enum candidates from value distributions + FK
  candidates from cross-DB value overlap) for the owner to review and ratify. Onboarding an
  existing database ≈ minutes.

### F2 — Validation gate (extends `tableEditTransaction.ts` + `apiValueWrite.ts`)

A pure validation core (`validateRowPatch(schema, row, patch)` — Obsidian-free, like the existing
planners) invoked as a pre-write pass in `executeTableValueWrites` and in every `api.*` write verb
(ADR-0044 precedent: gates apply to all channels including row-create):

- type/enum/required/unique/pattern/reference-existence/invariant checks; `error` blocks,
  `warn` requires override (UI dialog / API flag), everything surfaced through the existing
  `tableEditFeedback.ts` (ADR-0007) with machine-readable codes for programmatic callers.
- **Value normalization**: empty-encoding policy applied at the boundary; values written as JS
  objects via `processFrontMatter`, so funnel-routed writes are always parse-valid YAML —
  the `wall-04` class (unquoted-colon breaking a whole row) is impossible on sanctioned channels.
- UI upgrades that make correct edits the path of least resistance: enum pickers, reference
  pickers (search the target DB), required-field indicators.
- Write-side referential integrity: changing/deleting a row that N key-match referrers point at
  warns with the referrer list (or opens a cascade preview), per the field's `onReferencedChange`.

### F3 — Reconciler + health surfaces (net-new; hooks existing metadataCache listeners)

The always-on "balance light" — replaces the owner's ask-the-AI-to-verify ritual:

- Incremental: on metadata-cache change events for rows in schema'd folders, re-validate that row
  (debounced). Full sweep on vault open and on schema change. (Gidi scale, ~330 rows, is trivial;
  design batched/incremental anyway.)
- Surfaces: per-row violation badges in tables; a health chip on the table header (green ✓ / N
  issues); a Database Health panel (per-DB and vault-wide) with jump-to-row; **broken-row
  rendering** — a file in a schema'd folder whose frontmatter fails to parse renders as an error
  row instead of silently vanishing from every query (the exact `wall-04` failure).
- Repairs: per violation class, `autofix` (mechanical + lossless: encoding normalization,
  derived-field refresh), one-click, or manual-only — declared in schema, all journaled (F5).
- Because validation derives from schema over the live index, the "validator silently passes
  empty after a field rename" class is structurally gone: a renamed field = missing-required/
  unknown-key violations across every row — the loudest possible signal, not an OK.

### F4 — Derived fields: one authority model (builds ADR-0055 / epic `Notidian-v341`)

Resolves the ADR-0017 ("computed is never persisted") vs ADR-0055 ("template sync writes
frontmatter") tension with a declared third authority class:

- `derived` fields have `materialize: none` (render-time only — joins today's `computedTypes`
  gate: fileprop/aggregate/rollup/backlink) **or** `materialize: frontmatter` (ADR-0055's model:
  stored for groupability/portability/Dataview/grep, `source: "notidian"` ownership marker,
  reactively resynced via Indexer events, DAG-only).
- **The formula is the authority for materialized fields.** ADR-0009 conflict detection must not
  defend a hand-edit to a materialized value against the resync — a divergent stored value is a
  *violation the reconciler heals* (journaled, with notice), not a conflict to preserve. This
  rule must be added to the ADR set explicitly or F4 and ADR-0009 will fight.
- Kinds: `template` (ADR-0055 string interpolation, `{field}` + `{fk->DB.key:field}`), `lookup`
  (typed single-value cross-DB fetch), `rollup` (aggregate over referrers — materializable
  version of ADR-0029 rollups). Formula engine stays rejected (per owner, extensible later).
- Dependency index (which rows' derived values depend on which source rows) — supersedes the
  deferred ADR-0029 E3 memoization work; needed for reactive resync at any scale.

### F5 — Durable journal + provenance + transactions (extends ADR-0008 shapes)

- Append-only journal per database (JSONL under `.notidian/journal/` — runtime area; the journal
  is *about* row data, never row data itself): `{ts, txn, actor, rowPath, field, old→new,
  schemaVersion}`. Actor = `ui` | `api:<client>` | `reconciler` | `external`. Reuses the
  `TableUndoEntry` inverse-op shape. The in-memory undo journal (deliberately transient,
  ADR-0008) stays for ctrl-Z; the durable journal is audit + recovery.
- Views: row history, database timeline, **revert row / revert transaction**.
- External raw edits: the reconciler journals detected diffs as `external` (best-effort old
  values from the last index state; edits made while Obsidian was closed appear as one external
  diff at next open — stated honestly).
- **Logical transactions**: journal-intent-first, apply per file, best-effort inverse rollback on
  partial failure (full cross-file ACID is impossible on files — documented, like ADR-0006).
  Unified rename+property-write op (closes the ADR-0006 two-step gap). All bulk operations
  (paste, fill, API batch) run as one transaction and gain a **preview-diff mode** (reuse the
  ADR-0015 preview pattern; API `dryRun: true`). Also closes the correctness-audit "mid-batch
  failure reported as applied:0 with dropped writes" class.

### F6 — The AI contract: Atlasidian `db.*` operations + write firewall

Confirmed today: Atlasidian writes vault files via raw `app.vault.modify` — no conflict
detection, no authority gate, no schema, raw text (the only channel that can produce `wall-04`).
Atlasidian's MCP server runs **in the same Obsidian process** as Notidian, so it can call
`app.plugins.plugins.notidian.superstate.api` directly (graceful degradation when Notidian is
disabled):

- New MCP operation family: `db.describe` (schema + invariants + enum vocabularies + examples —
  the agent no longer needs schema in its prompt), `db.read` (rows *with derived fields
  resolved* — agents finally see joined truth), `db.validate` (would-this-write-be-legal, with
  machine-readable errors), `db.write` / `db.create` / `db.rename` (funnel-routed: validated,
  normalized, conflict-checked, journaled with `actor: api:<agent>`; returns post-write readback
  state), `db.journal` (what changed, by whom, since when).
- **Write firewall**: Atlasidian's generic raw ops (`vault.modify`, `edit.patch`) targeting a
  path inside a schema'd database folder are flagged and journaled, configurable warn→block.
  Protects against agents that don't know `db.*` yet.
- `db.describe --markdown` copy affordance for pasting schema into non-Atlasidian AI contexts.
- Result: **weak-model sessions become safe-by-construction on the write path** — out-of-schema
  writes are rejected with reasons, in-schema writes are journaled and revertible. The remaining
  exposure is semantically-plausible-but-physically-wrong values, which no engine can know;
  mitigations are provenance (journal + actor) and invariants narrowing the plausible-wrong space.

### Headless validation core (closing move, after F1–F3 prove out)

`validateRowPatch` + the Type Profile parser are pure/Obsidian-free by design → extractable as a
small library/CLI (`notidian validate <vault> <db>`). Gidi's `gidi_tooling.py` vault-side checks
then *delegate to the engine's own rules* — true one-rule-one-home across the vault UI, the write
gate, and repo CI. Until then gidi_tooling stays as the independent CI belt.

## 2. Gidi adoption map (the payoff, per audit finding)

| Gidi finding | Feature that ends the class |
|---|---|
| D1 GPIO label scramble (stored copy drifted) | F4: pin-map `device` → `derived/template, materialize: frontmatter` — self-healing; the six wrong labels get rewritten by the engine on first resync |
| D2 wall-04 (YAML breakage invisible) | F2 (sanctioned writes can't produce it) + F6 firewall (AI raw-writes routed) + F3 broken-row rendering (residual raw-fs cases visible instantly) |
| D3 null-vs-`""` split | F1 `empty` policy + F2 normalization + F3 autofix |
| D4 spurious 07-ch05 (rows > board channels) | F1: derived `used_channels` rollup + invariant `used_channels <= channels` |
| D5 spare-with-device lifecycle violations | F1 invariant `when status=spare require isEmpty(device)` — blocked at write, badged if entered externally |
| D6 required `model` missing | F1 `required` + F2 enforcement |
| D7 rows escaping hand-written health checks | F3: checks generated from schema; no hand-written predicates to get wrong |
| 18/19 validators silently pass-empty | F3: schema-driven validation cannot pass-empty (see F3) |
| 3-file ESP sync set | F4 rollup (`hosts_sensors` derived from pin maps) + F2 reference pickers → sync set collapses to 1–2 files |
| AI writes race watcher / bypass cache / unlogged | F6 (in-process, funnel-routed, journaled) + F5 (revertible) |
| T8 vocab copy drifts from doc enum | F1: enum lives once in the Type Profile; every consumer reads it |

## 3. Delivery waves and dependencies

- **Wave 0 (in flight):** correctness-audit epic `Notidian-vonm` — engine trust base; everything
  below routes more writes through the engine, so its 16 bugs land first.
- **Wave 1 — the balance light:** F1 (Type Profile v3 + adoption command) + pure validation core
  + F3 read-only (sweep, badges, health panel, broken-row). No write-path changes yet. Pilot:
  author schemas for the 7 Gidi registries. *Owner's felt problem — "did my edit break
  something?" — is answered passively from this wave on.*
- **Wave 2 — guarded writes:** F2 (funnel + API gate, pickers, normalization, referrer warnings).
- **Wave 3 — the AI channel:** F6 (`db.*` + firewall) + F5 journal (provenance priority is AI
  writes; they become engine-visible in this wave).
- **Wave 4 — one source of truth:** F4 (build `Notidian-v341` generalized: template/lookup/rollup
  + derived authority + dependency index). Gidi flips pin-map `device` and `hosts_sensors`.
- **Wave 5 — polish:** transactions/bulk preview/row history UI (rest of F5), headless
  validation core + gidi_tooling delegation.

## 4. Risks / open decisions for the owner

1. Schema bugs become systemic (one schema feeds everything) — mitigated by ADR-0015 preview on
   every schema edit + git history; still worth a schema-change journal entry class.
2. F4 conflict-authority rule (formula beats hand-edit on materialized fields) — must be
   ratified explicitly; it deliberately weakens ADR-0009 for one declared field class.
3. Firewall default (warn vs block) for raw writes into schema'd folders — recommend warn for
   two weeks of telemetry, then block.
4. Reconciler autofix scope — recommend autofix only for encoding normalization + derived
   refresh; everything else one-click.
5. ADR-0055's open question ("frontmatter vs MDB-only for computed values") is resolved by this
   design as *frontmatter, engine-owned* (F4) — consistent with the owner's 06-30 groupability/
   interop rationale; MDB-only remains available as `materialize: none`.
