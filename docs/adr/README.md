# Architecture Decision Records

This directory preserves the architectural decisions behind the Notidian fork.

The most important rule across these ADRs is that **Obsidian vault data remains canonical**. Notidian may provide richer database views, but ordinary file identity and note metadata must not become governed by a separate hidden context database.

## Records

If you only need the file-name/page-title decision, read [ADR 0003](0003-editable-page-titles-through-file-renames.md). It is intentionally self-contained because that decision has the highest risk of subtle data-governance regressions.

If you need the current implementation status rather than the decision history, read [Current State](../current-state.md). If you need to use or troubleshoot the table behavior, read [Table Database Workflows](../table-database-workflows.md).

| ADR | Decision | Purpose |
| --- | --- | --- |
| [0001](0001-authority-partitioned-database-model.md) | Authority-partitioned database model | Defines which layer owns file identity, frontmatter properties, context-native fields, view state, and computed values. |
| [0002](0002-frontmatter-backed-context-columns.md) | Frontmatter-backed context columns | Explains how existing YAML properties become visible/editable table columns without turning MDB rows into the durable metadata store. |
| [0003](0003-editable-page-titles-through-file-renames.md) | Editable page titles through file renames | Canonical full record for why direct file-name editing was problematic, what solution was chosen, and how the implemented rename transaction handles the risks. |
| [0004](0004-authority-hardening-transactions-and-reconciliation.md) | Authority hardening transactions and reconciliation | Records the transaction, persistence, type reconciliation, and rename deduplication hardening that keeps the authority model trustworthy. |
| [0005](0005-obsidian-bases-alignment-without-replacing-contexts.md) | Obsidian Bases alignment without replacing contexts | Explains why Notidian aligns with Bases' data authority model while retaining Make.md contexts for richer view behavior. |
| [0006](0006-unified-table-edit-transactions.md) | Unified table edit transactions | Defines the shared execution path for normal value edits, field edits, paste writes, and future grid gestures. |
| [0007](0007-table-edit-feedback.md) | Table edit feedback | Defines transient pending, failed, and skipped cell feedback derived from edit transaction results. |
| [0008](0008-table-undo-journal.md) | Table undo journal | Defines the table-local undo stack for bulk operations and why replay goes through authority-aware write paths. |
| [0009](0009-frontmatter-conflict-detection.md) | Frontmatter conflict detection | Defines stale frontmatter write detection so table edits do not overwrite newer canonical metadata. |
| [0010](0010-legacy-context-audit-and-migration.md) | Legacy context audit and migration | Defines audit-first migration for old Make.md contexts so frontmatter authority can be restored without losing context data. |
| [0011](0011-bases-first-convergence.md) | Bases-first convergence | Defines Notidian's long-term convergence toward Obsidian Bases semantics while keeping Notidian as the enhanced editor and migration layer. |
| [0012](0012-custom-bases-view-feasibility-gate.md) | Custom Bases view feasibility gate | Defines the first `notidian-table` custom Bases view as a native-alignment proof point before replacing the current safe table editor. |

## Decision Summary

Notidian uses an authority-partitioned model with Bases-first convergence:

- File paths and file names are canonical page identity.
- Markdown frontmatter is canonical ordinary note metadata.
- `.base`-compatible semantics are preferred for database view definitions wherever they can represent the behavior safely.
- Notidian context MDB files store view configuration, ordering, formulas, relations, display schema, compatibility cache state, legacy state, and explicitly Notidian-owned fields.
- Custom Bases views are the preferred proof surface for moving the enhanced table UX into `.base` files, but current context-backed table behavior remains available until parity is proven.
- Projected values from files/frontmatter may be cached for rendering, but they must be rebuilt from the owning layer and must not become the durable source of truth.

## Maintenance Rule

Any future change that moves authority between files, frontmatter, context MDB storage, computed projections, or `.base` interoperability should update the relevant ADR in this directory. The goal is that a future maintainer can understand the governing decision without reconstructing it from chat history or implementation diffs.

Changes that only add implemented behavior inside the accepted authority model should update [Current State](../current-state.md), and should add or update an ADR only when they change a durable architectural decision.
