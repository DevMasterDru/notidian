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
