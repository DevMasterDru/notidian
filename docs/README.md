# Notidian Documentation

This directory keeps the active Notidian reference set and the preserved decision history for the fork.

Use the active docs first. Historical records explain how the architecture changed, but they do not override the current Notidian-only architecture.

## Start Here

- [Current State](current-state.md): implemented behavior, guarantees, known gaps, and verification commands.
- [Notidian System Architecture](notidian-system-architecture.md): current A-Z architecture and source-of-truth model.
- [Table Database Workflows](table-database-workflows.md): practical table behavior for database use.
- [Real Vault Smoke Harness](real-vault-smoke-harness.md): opt-in live Obsidian verification.
- [Legacy Context Audit Report](legacy-context-audit-report.md): read-only reports for older Make.md contexts.
- [Architecture Decision Records](adr/README.md): active and historical decisions.

## Current Contract

Notidian's current architecture is authority-partitioned:

- Markdown files own row identity.
- Markdown file paths and basenames own page titles.
- Markdown frontmatter owns ordinary editable properties.
- Notidian is the only intended database engine/interface.
- Notidian context MDB storage owns view state, legacy state, explicit Notidian-owned fields, and advanced Notidian behavior.
- Native Bases and `.base` compatibility are not part of the active architecture.
- Cached projections of file/frontmatter data may exist for rendering, but they must be rebuildable from the owning layer.

## Active ADRs

Read [the ADR index](adr/README.md) for the full split between active and historical records.

The active decision set is:

- [ADR 0001: Authority-partitioned database model](adr/0001-authority-partitioned-database-model.md)
- [ADR 0002: Frontmatter-backed context columns](adr/0002-frontmatter-backed-context-columns.md)
- [ADR 0003: Editable page titles through file renames](adr/0003-editable-page-titles-through-file-renames.md)
- [ADR 0006: Unified table edit transactions](adr/0006-unified-table-edit-transactions.md)
- [ADR 0007: Table edit feedback](adr/0007-table-edit-feedback.md)
- [ADR 0008: Table undo journal](adr/0008-table-undo-journal.md)
- [ADR 0009: Frontmatter conflict detection](adr/0009-frontmatter-conflict-detection.md)
- [ADR 0010: Legacy context audit and migration](adr/0010-legacy-context-audit-and-migration.md)
- [ADR 0014: Notidian-only personal database engine](adr/0014-notidian-only-personal-database-engine.md)
- [ADR 0015: Canonical schema planning](adr/0015-canonical-schema-planning.md)

## Historical Records

The following records are preserved for context, but are not the active read path:

- [ADR 0004](adr/0004-authority-hardening-transactions-and-reconciliation.md): authority-hardening phase record, now operationally covered by later focused ADRs.
- [ADR 0005](adr/0005-obsidian-bases-alignment-without-replacing-contexts.md): historical Bases authority-model research.
- [ADR 0011](adr/0011-bases-first-convergence.md): superseded Bases-first strategy.
- [ADR 0012](adr/0012-custom-bases-view-feasibility-gate.md): retired custom Bases view experiment.
- [ADR 0013](adr/0013-notidian-first-canonical-file-architecture.md): superseded Notidian-first/Bases-compatible strategy.
- `docs/superpowers`: historical specs and execution plans from development work. These files preserve useful context but do not override ADRs or current-state docs.

## Maintenance Rules

- Keep [Current State](current-state.md) synchronized with implemented behavior and known gaps.
- Keep [Notidian System Architecture](notidian-system-architecture.md) focused on the current target architecture.
- Keep [Table Database Workflows](table-database-workflows.md) practical and user-facing.
- Add or update ADRs only when a durable architectural decision changes.
- Update historical ADRs only for correction or status clarification.
- Do not bury source-of-truth decisions only in chat history, tests, local skills, or generated bundle diffs.
- Do not move retained history into paths whose names contain `archive` or `ignore`; repository agent rules skip those paths.
