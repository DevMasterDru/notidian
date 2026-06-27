# ADR 0053: Text-Backed Grouped Island Management

## Status

**Accepted — owner-approved 2026-06-24.** Implementation is tracked by bd
`Notidian-ht8t`.

## Context

ADR 0052 made the grouped-island manager safe for static Select properties.
The owner's live `board` grouping is an ordinary text property, however, so it
has distinct observed group values without a configured option list. Leaving
that manager disabled makes the requested ordering and rename interaction
unavailable precisely where it is needed.

## Decision

- Editable `text` groupings use their distinct non-empty observed row values as
  their manager entries. A new value appears after explicitly ordered values in
  stable observed order; the existing `No <property>` bucket remains last.
- The shared/default text-group order is explicit Notidian column configuration:
  a `notidianGroupOrder` JSON array inside `SpaceProperty.attrs`, the persisted
  metadata envelope already owned by Notidian. It is schema/UI configuration,
  not a row value and never frontmatter metadata. The key is namespaced and is
  updated without replacing other field metadata such as a property icon. This
  keeps it global across views while respecting the file/frontmatter authority
  boundary and the fixed `m_fields` schema.
- A view-local override remains in `Predicate.groupOrder`; it takes precedence
  over the column's global order and can be cleared to resume it.
- Renaming an editable text group is a counted bulk value operation. It rejects
  empty and colliding names and writes every matching row through the existing
  authority-aware, all-or-nothing table transaction. Frontmatter-owned text is
  updated in Markdown; explicitly `source: "notidian"` text stays in the MDB.
- File identity, computed values, non-text fields, and source-backed/dynamic
  option groups remain non-renameable and explain why in the manager.

## Rejected Options

- **Keep text grouping view-only** — it contradicts the owner-required global
  default.
- **Store a text group order in hidden row data or frontmatter** — group order
  is view/schema behavior, not ordinary note metadata.
- **Reorder backing rows to order groups** — it breaks manual row order and the
  grouped-row identity invariant from ADR 0052.
- **Allow a rename to merge with an existing group implicitly** — that is a
  destructive recategorisation, not a rename; require a separate future merge
  operation if needed.

## Consequences

- Text-backed group management is available in the current Board view without
  changing its row order or creating a second authority for row metadata.
- Column configuration gains one optional, backwards-compatible Notidian-owned
  field. Legacy columns without it preserve observed grouping order.
- The manager's option-oriented component becomes a generic group-value panel,
  while Select option lifecycle configuration stays unchanged.

## Related

- [ADR 0001](0001-authority-partitioned-database-model.md) — owner boundaries.
- [ADR 0006](0006-unified-table-edit-transactions.md) — bulk value writes.
- [ADR 0017](0017-explicit-notidian-ownership.md) — explicit MDB ownership.
- [ADR 0052](0052-grouped-table-island-state-and-ordering.md) — base island
  behavior and per-view ordering.
