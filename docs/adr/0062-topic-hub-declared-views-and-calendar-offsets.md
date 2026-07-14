# ADR 0062: Topic Hub Declared Views and Calendar Offsets

## Status

Accepted by the owner on 2026-07-14. Implementation is pending in
`Notidian-uupm.2` through `Notidian-uupm.4`.

Authority: Atlas Method ADR 0066 D4/D7 makes database folder-note frontmatter
the declaration home and render-path overlays the v1 mechanism. Atlas Method
ADR 0075 D4 makes a declared view id a shared owner-facing and agent-retrieval
surface. This ADR fixes the remaining Notidian schema, composition, failure,
and calendar arithmetic contracts.

## Context

Notidian already renders a native table or saved view from a `notidian` embed
and accepts repeated `where:` lines as a conjunctive, read-only filter overlay.
The overlay never enters the saved predicate or `views.mdb`. Atlas Method ADR
0066 also requires reusable `views:` declarations in each database folder note,
but did not define how a declaration names its native base, how it composes with
an embed-local overlay, or how invalid declarations behave.

Relative `withinLast` and `olderThan` filters also accept calendar-month and
calendar-year tokens. Native `Date#setMonth` and `Date#setFullYear` roll forward
when the original day does not exist in the target period: 31 March minus one
month lands in early March, and 29 February minus one year lands on 1 March.
That is surprising for owner-facing calendar filters.

## Decision

1. The database folder note owns an ordered `views:` list. Every declaration
   has a unique lowercase slug `id` and an explicit native `base` containing
   `kind: table|view` and a non-empty schema `id`. The enclosing folder note
   implies the database target.
2. A declaration's `where` value is an ordered list of the existing public
   surface-grammar strings, not serialized internal `Filter` objects. This
   keeps implementation registry names out of file-canonical configuration.
3. An existing `kind: view` embed resolves its `id` against valid folder-note
   declarations first. A declaration resolves its explicit native base without
   recursively consulting declarations. If no declaration has that id, native
   saved-view resolution remains byte-identical. A declaration/native id
   collision therefore resolves deterministically through the declaration and
   its explicit base.
4. Row visibility is the conjunction of native base filters, declaration
   `where` clauses, and per-embed `where` clauses, in that stable order. No
   later filter layer overrides or removes an earlier layer.
5. Declaration and embed overlays are read-path only. They never mutate rows,
   frontmatter, predicate state, context MDB state, or `views.mdb`. When
   `renderPathViewOverlays` is false, both overlay layers are dropped and the
   native base predicate passes through unchanged.
6. Invalid `views` shapes, duplicate or invalid ids, invalid or cyclic bases,
   missing native bases, unsupported or malformed clauses, unknown declaration
   keys, and fields absent from the resolved target schema invalidate the
   declared render. Notidian shows its sanitized embed error surface; it does
   not fall back to a same-id native view or apply a valid subset, because either
   behavior can silently widen results.
7. Declared `sort`, `groupBy`, `columns`, `limit`, and display `kind` are
   schema-resolved read-path values. When explicitly present, each replaces the
   corresponding whole native-base value; omission preserves the base value.
   Per-embed rich display tokens remain deferred.
8. Relative `d` and `w` tokens keep fixed-day subtraction from local
   start-of-day. Relative `m` tokens compute the target year/month and clamp the
   day to the last valid day in that month. Relative `y` tokens use the same
   valid-day clamp for leap-day subtraction.
9. `withinLast` remains inclusive at the threshold and `olderThan` remains its
   strict complement for valid operands. Malformed values or tokens remain
   invisible to both operators.

The accepted v1 declaration shape is:

```yaml
views:
  - id: gidi-active
    base:
      kind: view
      id: active
    where:
      - "repo = Gidi"
      - "status != done"
    sort:
      - field: updated
        direction: desc
    groupBy:
      - status
    columns:
      - File
      - status
      - updated
    limit: 50
    kind: table
```

An embed may add another narrowing clause without changing its existing shape:

```notidian
target: Projects
kind: view
id: gidi-active
where: priority = urgent
```

## Options Considered

### A. Explicit Declared Id and Native Base — Chosen

The declared id stays stable when its native base changes, supports several
declared lenses over one base, and serves ADR 0075's `database#view-id`
retrieval contract without coupling it to an MDB schema id.

### B. Declaration Id Implicitly Equals Native View Id — Rejected

This prevents several reusable lenses over one base and makes a file-canonical
retrieval id depend on local native-view identity.

### C. Conjunctive Filter Layers — Chosen

Every additional layer can only narrow. Replacement precedence could silently
widen a base view and violate the render-path overlay's existing contract.

### D. Native Calendar Rollover — Rejected

Native rollover is an implementation accident rather than ordinary calendar
subtraction. End-of-period clamping matches the owner's expectation for month
and year windows.

## Consequences

- Folder-note declarations become model-neutral, versionable reusable lenses;
  native MDB state remains the display substrate rather than a second config
  authority.
- Invalid declarations fail visibly instead of exposing a wider row set.
- The existing kill switch remains honest for both declaration and embed
  overlays.
- Month-end and leap-day filters produce stable calendar boundaries.
- Implementation must cover both inside-folder and adjacent folder-note modes,
  target-schema validation, collision/cycle cases, the write firewall, legacy
  native embeds, and month-end/leap-day fixtures before deployment.
