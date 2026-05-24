# Architecture Decision Records

This directory preserves the architectural decisions behind the Notidian fork.

The most important rule across these ADRs is that **Obsidian vault data remains canonical**. Notidian may provide richer database views, but ordinary file identity and note metadata must not become governed by a separate hidden context database.

## Records

- [ADR 0001: Authority-partitioned database model](0001-authority-partitioned-database-model.md)
- [ADR 0002: Frontmatter-backed context columns](0002-frontmatter-backed-context-columns.md)
- [ADR 0003: Editable page titles through file renames](0003-editable-page-titles-through-file-renames.md)
- [ADR 0004: Authority hardening transactions and reconciliation](0004-authority-hardening-transactions-and-reconciliation.md)
- [ADR 0005: Obsidian Bases alignment without replacing contexts](0005-obsidian-bases-alignment-without-replacing-contexts.md)

## Decision Summary

Notidian uses an authority-partitioned model:

- File paths and file names are canonical page identity.
- Markdown frontmatter is canonical ordinary note metadata.
- Notidian context MDB files store view configuration, ordering, formulas, relations, display schema, compatibility cache state, and explicitly Notidian-owned fields.
- Projected values from files/frontmatter may be cached for rendering, but they must be rebuilt from the owning layer and must not become the durable source of truth.
