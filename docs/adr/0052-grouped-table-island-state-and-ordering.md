# ADR 0052: Grouped Table Islands — Per-View State, Global-Default Ordering, And Safe Rename

## Status

**Accepted — owner-approved 2026-06-23.** Implementation is tracked by bd
`Notidian-jvj5`.

## Context

Grouped table headers already render as distinct visual islands, but the table
controls TanStack expansion with a permanently `true` state. The caret therefore
cannot retain a collapsed state. Group sequence also follows incidental row order,
even though select-property options have an explicit lifecycle order. Finally,
the existing Cmd/Ctrl+F path is attached only to the table keyboard handler rather
than sharing a named operation with the visible **Search This View** control.

The owner requires collapsible islands with a visible collapsed treatment, an
island-label panel that lists all configured options and can reorder or rename
them, and a global-default order that may be overridden for an individual view.

## Decision

- A group header has two separate controls: its caret toggles collapse; its label
  opens **Manage groups**.
- Collapse state is view state. It is stored in the view predicate, keyed by the
  grouped column id and a stable encoded group value; an absent key means
  expanded. A collapsed header receives a slightly muted island treatment.
- Select-option order is global by default: the configured options array remains
  the shared lifecycle order. **Manage groups** exposes a per-view mode that
  writes an explicit predicate override; clearing it resumes the global order.
  The no-value (`No <property>`) group remains last and is not an option that can
  be reordered.
- Group ordering is applied only to the grouped row model. It must not alter the
  underlying row array, flat-row order, sub-item order, rendered-row identity,
  or copy/paste addressing.
- Renaming a static editable select option is a global data operation. After a
  counted confirmation, it changes both the option configuration and every
  matching value through the existing authority-aware value transaction:
  frontmatter-owned values write canonical Markdown frontmatter; explicitly
  `source: "notidian"` values remain in the context MDB. Computed, file-identity,
  and source-backed option groups do not expose rename. Empty or colliding target
  names are rejected.
- The visible toggle and Cmd/Ctrl+F share one open-only **open view search**
  operation. The shortcut opens the existing filter-search, never closes it, and
  focuses the mounted input immediately.

## Rejected Options

- **Make every group order view-only** — it prevents a property lifecycle from
  having a default order shared across views.
- **Make every group order global** — it cannot support a purposefully different
  arrangement in one view.
- **Reorder the backing rows to order groups** — it would silently change manual
  row order and risks desynchronising rendered indices from edits, range paste,
  and sub-items.
- **Treat option rename as a cosmetic label** — group labels and stored values
  would diverge, leaving notes under an orphaned option value.
- **Keep Cmd/Ctrl+F as a table-local key handler** — focus location determines
  whether the advertised view-search shortcut works.

## Consequences

- New predicate fields are optional. Their absence round-trips as the legacy
  fully-expanded, global-order behavior.
- Global option ordering remains property configuration; per-view order and
  collapse remain Notidian-owned view state. Neither ordering mode adds an owner
  for ordinary row metadata.
- Rename is intentionally unavailable for values whose authority or source is
  outside this view. The panel must explain disabled states rather than issuing a
  partial write.
- The existing `No <property>` last-group polish (`Notidian-2kmo`) becomes part
  of the same grouped-row ordering layer.

## Related

- [ADR 0014](0014-notidian-only-personal-database-engine.md) — file/frontmatter
  authority and Notidian view-state boundary.
- [ADR 0041](0041-consolidate-view-search-affordances.md) and
  [ADR 0049](0049-remove-dormant-quick-find.md) — one consolidated view search.
- [ADR 0050](0050-subitems-notion-parity.md) — established predicate-backed
  collapse state.
- bd `Notidian-jvj5`; related group-order polish bd `Notidian-2kmo`.
