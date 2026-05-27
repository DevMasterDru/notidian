# Notidian Documentation

This directory preserves the durable reasoning and implementation planning behind the Notidian fork.

## What Is Canonical

- [Current State](current-state.md) describes what the implementation does today.
- [Notidian System Architecture](notidian-system-architecture.md) is the full A-Z architecture reference.
- [Table Database Workflows](table-database-workflows.md) describes how the current table behaves in practical database use.
- [Bases Adapter](base-adapter.md) describes the pure `.base` export adapter, the custom Bases view gate, and current limitations.
- [Real Vault Smoke Harness](real-vault-smoke-harness.md) describes the opt-in live Obsidian verification workflow.
- [Legacy Context Audit Report](legacy-context-audit-report.md) describes the read-only report for older Make.md contexts.
- [Architecture Decision Records](adr/README.md) are the durable source of truth for architectural decisions.
- [ADR 0013](adr/0013-notidian-first-canonical-file-architecture.md) is the current strategic architecture: Notidian is the primary database UX, files/frontmatter are canonical ordinary data, and Bases is optional interop.
- [ADR 0011](adr/0011-bases-first-convergence.md) is historical context for the earlier Bases-first direction and is superseded by ADR 0013.
- [ADR 0012](adr/0012-custom-bases-view-feasibility-gate.md) records why `notidian-table` starts as an optional custom Bases view feasibility gate rather than a required table rewrite.
- [ADR 0003](adr/0003-editable-page-titles-through-file-renames.md) is the canonical full record for editable page titles and file renames.
- `docs/superpowers` contains historical specs and plans from implementation work. These files preserve useful development context, but they do not override the ADRs.

## Current Model

Notidian's current architecture is intentionally authority-partitioned:

- Markdown files own page identity.
- Markdown frontmatter owns ordinary user-editable metadata.
- Notidian is the primary database UX.
- Notidian context MDB files currently own view state, row order, compatibility state, formulas, relations, legacy state, and explicit Notidian-specific fields.
- `.base`-compatible semantics are optional import/export/mirror/custom-view compatibility, not the ordinary data authority.
- Custom Bases views are a proof and compatibility surface for `.base` workflows, not the required primary table architecture.
- Cached projections of file/frontmatter data can be used for rendering, but they must be rebuildable from the owning layer.

## Architecture Decisions

Start with [Architecture Decision Records](adr/README.md).

The most important ADRs are:

- [ADR 0001: Authority-partitioned database model](adr/0001-authority-partitioned-database-model.md)
- [ADR 0002: Frontmatter-backed context columns](adr/0002-frontmatter-backed-context-columns.md)
- [ADR 0003: Editable page titles through file renames](adr/0003-editable-page-titles-through-file-renames.md)
- [ADR 0004: Authority hardening transactions and reconciliation](adr/0004-authority-hardening-transactions-and-reconciliation.md)
- [ADR 0005: Obsidian Bases alignment without replacing contexts](adr/0005-obsidian-bases-alignment-without-replacing-contexts.md)
- [ADR 0006: Unified table edit transactions](adr/0006-unified-table-edit-transactions.md)
- [ADR 0007: Table edit feedback](adr/0007-table-edit-feedback.md)
- [ADR 0008: Table undo journal](adr/0008-table-undo-journal.md)
- [ADR 0009: Frontmatter conflict detection](adr/0009-frontmatter-conflict-detection.md)
- [ADR 0010: Legacy context audit and migration](adr/0010-legacy-context-audit-and-migration.md)
- [ADR 0011: Bases-first convergence](adr/0011-bases-first-convergence.md)
- [ADR 0012: Custom Bases view feasibility gate](adr/0012-custom-bases-view-feasibility-gate.md)
- [ADR 0013: Notidian-first canonical file architecture](adr/0013-notidian-first-canonical-file-architecture.md)

ADR 0003 is the canonical full record for the page-title/file-rename decision. It explains why naive direct file-name editing was risky, why the selected transaction model was chosen, and what invariants future work must preserve.

## Implementation Planning Artifacts

The `docs/superpowers` files are historical design and implementation artifacts from the development process. They are useful for reconstructing how each phase was planned and verified, but the ADRs are the durable architectural source of truth.

Current implementation reference:

- [Current State](current-state.md)

Practical workflow guide:

- [Table Database Workflows](table-database-workflows.md)
- [Bases Adapter](base-adapter.md)
- [Real Vault Smoke Harness](real-vault-smoke-harness.md)
- [Legacy Context Audit Report](legacy-context-audit-report.md)

Key design specs:

- [Notidian rebrand design](superpowers/specs/2026-05-23-notidian-rebrand-design.md)
- [Obsidian property-backed contexts design](superpowers/specs/2026-05-23-obsidian-property-backed-contexts-design.md)
- [Canonical frontmatter contexts design](superpowers/specs/2026-05-24-canonical-frontmatter-contexts-design.md)
- [Page title cell design](superpowers/specs/2026-05-24-page-title-cell-design.md)
- [Table range clipboard design](superpowers/specs/2026-05-24-table-range-clipboard-design.md)
- [Table edit transactions design](superpowers/specs/2026-05-24-table-edit-transactions-design.md)
- [Table edit feedback design](superpowers/specs/2026-05-24-table-edit-feedback-design.md)

Key implementation plans:

- [Notidian rebrand plan](superpowers/plans/2026-05-23-notidian-rebrand.md)
- [Obsidian property-backed contexts plan](superpowers/plans/2026-05-23-obsidian-property-backed-contexts.md)
- [Canonical frontmatter contexts plan](superpowers/plans/2026-05-24-canonical-frontmatter-contexts.md)
- [Page title cell plan](superpowers/plans/2026-05-24-page-title-cell.md)
- [Authority hardening plan](superpowers/plans/2026-05-24-authority-hardening.md)
- [Table range clipboard plan](superpowers/plans/2026-05-24-table-range-clipboard.md)
- [Table edit transactions plan](superpowers/plans/2026-05-24-table-edit-transactions.md)
- [Table edit feedback plan](superpowers/plans/2026-05-24-table-edit-feedback.md)
- [Notidian-first architecture plan](superpowers/plans/2026-05-27-notidian-first-architecture.md)

## Documentation Rules

- Keep ADRs focused on decisions, alternatives, consequences, and invariants.
- Keep [Current State](current-state.md) synchronized with implemented behavior and known gaps.
- Keep implementation plans as historical execution records.
- Update ADR 0003 whenever the page-title rename transaction changes materially.
- Update ADR 0001 whenever ownership of file identity, frontmatter metadata, context data, or computed data changes materially.
- Update ADR 0013 for strategic Notidian architecture changes, ADR 0011 only for historical correction, and ADR 0012 for changes to the optional custom Bases view gate or runtime API assumptions.
- Do not bury source-of-truth decisions only in chat history, tests, or generated bundle diffs.
