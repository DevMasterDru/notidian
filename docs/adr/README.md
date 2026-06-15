# Architecture Decision Records

This directory preserves the architectural decisions behind the Notidian fork.

The governing rule is that **Obsidian vault data remains canonical**. Notidian may provide richer database views, but ordinary file identity and note metadata must not become governed by a hidden context database.

For implementation status, read [Current State](../current-state.md). For the full current architecture, read [Notidian System Architecture](../notidian-system-architecture.md). For practical table behavior, read [Table Database Workflows](../table-database-workflows.md).

## Active Records

These records define the current Notidian architecture and implemented safety model.

| ADR | Decision | Purpose |
| --- | --- | --- |
| [0001](0001-authority-partitioned-database-model.md) | Authority-partitioned database model | Defines ownership for file identity, frontmatter properties, context-native fields, view state, and computed values. |
| [0002](0002-frontmatter-backed-context-columns.md) | Frontmatter-backed context columns | Explains how YAML properties become visible/editable table columns without making MDB rows durable metadata. |
| [0003](0003-editable-page-titles-through-file-renames.md) | Editable page titles through file renames | Canonical full record for why page-title edits must be file rename transactions. |
| [0006](0006-unified-table-edit-transactions.md) | Unified table edit transactions | Defines the shared execution path for value edits, field edits, paste writes, and future grid gestures. |
| [0007](0007-table-edit-feedback.md) | Table edit feedback | Defines transient pending, failed, skipped, and conflict cell feedback. |
| [0008](0008-table-undo-journal.md) | Table undo journal | Defines table-local undo/redo and why replay goes through authority-aware write paths. |
| [0009](0009-frontmatter-conflict-detection.md) | Frontmatter conflict detection | Defines stale-frontmatter detection so table edits do not overwrite newer canonical metadata. |
| [0010](0010-legacy-context-audit-and-migration.md) | Legacy context audit and migration | Defines audit-first migration so legacy context values are not lost. |
| [0014](0014-notidian-only-personal-database-engine.md) | Notidian-only personal database engine | Current governing strategy: Notidian is the only intended database engine/interface. |
| [0015](0015-canonical-schema-planning.md) | Canonical schema planning | Defines frontmatter property discovery, create, rename, and delete previews before destructive schema UI/apply flows. |
| [0017](0017-explicit-notidian-ownership.md) | Explicit Notidian ownership | Closes the silent authority fallback: durable MDB ownership requires an explicit `source: "notidian"` marker, and source-less file-backed columns default to frontmatter. Refines ADR 0001. |
| [0018](0018-makemd-fork-debt-scope-and-frame-trust-boundary.md) | Make.md fork-debt scope + frame trust boundary | Scopes the Make.md-era subsystems. Landed: MKit installer disabled-by-default + `spaceSubFolder` locked. Frames kept (load-bearing); sink hardening tracked for live-verified work (bd Notidian-vke, -ala). |
| [0019](0019-select-to-comment-anchoring-and-ai-review-channel.md) | Select-to-comment anchor + AI-review channel (**Proposed**) | Open product/UX decision: how a comment binds to a selection (recommends Obsidian `^block` id) and the AI-directed review comment format the Atlasidian parser consumes (recommends frontmatter `review.comments`). Awaiting owner direction (bd Notidian-o4w). |
| [0020](0020-date-reminders-and-recurring-events.md) | Date reminders + recurring events (**Proposed**) | Open design decision: reminder delivery (recommends a default-OFF load-time/interval scan firing `superstate.ui.notify`, no external plugin) and recurrence materialization (recommends single-row rrule-shaped `repeat` frontmatter expanded at render time, never generated rows — generalizing the existing calendar expander). Awaiting owner direction (bd Notidian-5io). |
| [0022](0022-frame-execution-settings-toggle-and-trusted-frame-allowlist.md) | Frame-execution settings toggle + trusted-frame allowlist (**Proposed**) | Open design decision following ADR 0018 / bd Notidian-vke: (1) settings-UI toggle for `hardenFrameExecution` (recommends an `advanced`-category, tradeoff-naming toggle); (2) a vault-trusted-frame allowlist that does **not** reopen the RCE — recommends a non-persisted, user-blessed, session-scoped provenance stamp (optionally a content-hash allowlist), never a persisted/attacker-editable "trusted" flag (preserves the `trust.ts` invariant). Gated on the owner first keeping `hardenFrameExecution` ON after live-verify. Awaiting owner direction (bd Notidian-214). |
| [0024](0024-sub-items-back-relations-ux.md) | Sub-items + back-relations UX: property authority, creation, cycles, sort (**Proposed**) | Open product/UX decision for epic item (3); engine/render already shipped (gg9/pv4/s9m/ahk). Load-bearing call: is sub-item creation **one-way (child owns the parent link)** or two-way? Recommends **one-way** — the inverse already exists as read-only computed back-relations, so two-way only duplicates a derivable fact and adds a second authority + reconciliation. Also recommends per-view parent-column designation (status quo), a passive cycle indicator with no edit-time block, and keeping the shipped sort/filter/groupBy rules. Awaiting owner direction (bd Notidian-2uz). |
| [0025](0025-array-comparator-correctness.md) | array.ts order comparators — correctness vs caller-dependence (+ uniqCaseInsensitive casing) (**Proposed**) | Open behavior decision: the two order comparators (`orderStringArrayByArray`/`orderArrayByArrayWithKey`, column + space ordering) are non-reflexive/non-transitive (`cmp(x,x)===-1`), rely on V8 TimSort specifics for absent-item order, and mutate the caller's array in place; current output is **locked as characterization** in `array.test.ts`. Recommends **Option B** — replace with a stable, reflexive, non-mutating comparator and flip the locked assertions — over (A) keep+document or (C) flag-gate, because the present-first invariant callers depend on is already property-tested and neither caller depends on the reversed-absent quirk (one is actively harmed by it — duplicated paths in `cacheParsers.ts:88`). Folds in **Notidian-9v6**: switch `uniqCaseInsensitive` to first-seen casing (display-only). Awaiting owner direction (bd Notidian-e8e). |
| [0026](0026-jsonwithunquoted-frame-payload-parsing.md) | `jsonWithUnquoted` frame-payload parsing — wrapper convention + tolerant tokenizer (**Proposed**) | Open trust-boundary decision following ADR 0018 / bd Notidian-vke: `jsonWithUnquoted.ts` is the boundary between stored frame-action text and code compiled by `runner.ts` `new Function`. (1) Wrapper-convention asymmetry — `"{...}"` parses to a STRING (fast-path), `'{...}'` to an OBJECT; recommends making the **OBJECT convention canonical** (every caller wants the object). (2) The lossy regex parser silently degrades to `{}` on embedded `,`/`}`/`]`; recommends a **tolerant tokenizer gated behind the existing default-OFF `hardenFrameExecution` flag** (a more permissive parser widens the executable-payload set, so it must ride the vke flag + live-verify) — **no new runtime flag**. Parser code untouched. Awaiting owner direction (bd Notidian-fs6). |
| [0027](0027-bd-embedded-dolt-export-stats-blind-and-jsonl-mirror-policy.md) | Upstream bd embedded-dolt `export`/`stats` blind to issues — JSONL mirror policy (**Proposed**) | Owner/upstream action item, **no in-repo fix exists**: on bd 1.0.5 (embedded-dolt) `bd list --all` sees all 113 issues but `bd stats`/`bd export` read the committed `issues` table, which is empty at every Dolt root, so the passive `.beads/issues.jsonl` mirror stays empty (daily bd work is unaffected). Recommends **(1a)** file upstream (`steveyegge/beads` or fork `gastownhall/beads`) with the minimal repro and retest `bd export` per release, closing Notidian-osf when a release re-exports the full graph; and **(2a)** keep the JSONL mirror **empty by design** (never fabricate a lossy hand-built mirror from `bd list --json`). Awaiting owner direction (bd Notidian-nir). |
| [0028](0028-per-database-row-create-templates.md) | Per-database row-create templates: where they live, what they seed, how chosen, schema-default interaction (**Proposed**) | Open product decision for epic item (2); storage already shipped — templates are file-canonical `.md` notes copied whole (frontmatter+body) via `newTemplateInSpace`, and the navigator `+` already applies a default + offers a per-DB picker. Gap: the three in-table/context row-create chokepoints (`TableView.tsx newRow`, `api.ts insert`, `ContextCell.tsx`) bypass templates and create empty files. Recommends keeping templates **file-canonical `.md`** (never an MDB blob without `source:notidian` — ADR 0017; the MDB holds only the default *pointer* = view config), seeding **frontmatter + body** (frontmatter-only is Type Profile's job), **auto-applying the single default + keeping the existing optional picker** (no forced prompt), and **template-wins-wholesale** over Type Profile `newPropertyDefaults` (the shipped precedent — one writer per row create). Optional default-OFF wiring spike offered, not built. Awaiting owner direction (bd Notidian-e29). |

## Historical Records

These records are kept because they explain why the architecture changed. They do not define the active roadmap unless a future ADR explicitly reactivates them.

| ADR | Status | Why keep it |
| --- | --- | --- |
| [0004](0004-authority-hardening-transactions-and-reconciliation.md) | Historical hardening context | Records the phase that introduced the authority registry, frontmatter write gating, conservative type reconciliation, and rename reconciliation. Later focused ADRs own the active rules. |
| [0005](0005-obsidian-bases-alignment-without-replacing-contexts.md) | Superseded by ADR 0014 | Preserves the Bases authority-model lessons that informed Notidian's current source-of-truth model. |
| [0011](0011-bases-first-convergence.md) | Superseded by ADRs 0013 and 0014 | Records why Bases-first convergence was explored before the personal-tool direction changed. |
| [0012](0012-custom-bases-view-feasibility-gate.md) | Retired by ADR 0014 | Records the custom Bases view experiment and why it was removed from the active architecture. |
| [0013](0013-notidian-first-canonical-file-architecture.md) | Superseded by ADR 0014 | Records the intermediate Notidian-first/Bases-compatible strategy and why Bases compatibility was later dropped as a target. |

## Decision Summary

Notidian uses a Notidian-only personal database architecture:

- File paths and file names are canonical page identity.
- Markdown frontmatter is canonical ordinary note metadata.
- Notidian is the only intended database engine/interface.
- Notidian context MDB files store view configuration, ordering, formulas, relations, display schema, legacy state, and explicitly Notidian-owned fields.
- Native Bases and `.base` compatibility are not part of the active architecture.
- Projected values from files/frontmatter may be cached for rendering, but they must be rebuilt from the owning layer and must not become the durable source of truth.
- Property create/rename/delete operations must be planned against canonical frontmatter before any destructive write is offered.

## Maintenance Rule

Changes that only add implemented behavior inside the accepted authority model should update [Current State](../current-state.md). Add or update an ADR only when a durable architectural decision changes.

Update historical ADRs only for correction or status clarification. Do not treat historical ADRs as active roadmap items.
