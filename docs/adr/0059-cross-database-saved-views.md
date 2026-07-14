# ADR 0059: Cross-Database Saved Views

## Status

Accepted and implemented for F1.

Authority: Atlas Method ADR 0083 Decision 2 is accepted and explicitly
commissions F1 as the keystone for the Life HQ Next, Schedule, and State views.
The owner then approved execution of `Notidian-42tx` on 2026-07-14.

## Context

Notidian saved views previously selected one database table from one folder
context through `FrameSchema.def.context` and `FrameSchema.def.db`. Life HQ
needs one saved view whose rows come from Routines, Events, Memos, the Beads
Portfolio mirror, Life Tasks, and Portfolio, even though those sources use
different property names for shared concepts such as priority, status, date,
time of day, domain, and person.

Materializing a generated Today database was explicitly rejected by Atlas
Method ADR 0083. The view therefore has to remain a live projection over the
canonical source rows. Ordinary properties must remain owned by each Markdown
files frontmatter; the host contexts MDB may own only the saved view definition
and predicate.

## Decision

1. A saved frame may carry `def.sources`, an ordered array of source
   definitions. Each definition names a folder context, database schema, label,
   and a map from canonical view field to source field.
2. A source set activates only when it normalizes to at least two distinct
   context and schema pairs and the default-on `crossDatabaseSavedViews`
   setting is enabled. Otherwise the existing singular source path is used.
3. The read path loads every source table and builds a synthetic table with:
   the canonical File column; one column per configured canonical field; a
   computed Source column; and private per-row source provenance. Source order
   is authoritative for both row order and duplicate-file precedence.
4. A canonical field keeps its source type only when every mapped source column
   agrees. Mixed or missing type declarations reconcile to text.
5. F1 projections are read-only. Filtering, sorting, grouping, searching,
   layouts, charting, CSV export, embeds, and saved predicates remain available;
   row edits, file renames, row creation/deletion/reorder, schema changes, and
   CSV import are blocked. The `source: cross-database` marker resolves to
   computed authority, and the provider also firewalls programmatic writes.
6. The native view-options menu owns source-set authoring. Before activation it
   offers Combine sources; after activation it offers Sources with the current
   count. The modal edits context, database, label, and `canonical=sourceField`
   mapping lines, and persists only through `saveSchema` into frame definition
   authority.
7. Source load failures are isolated. Successfully loaded sources still render;
   an entirely unavailable source set renders the empty projection rather than
   stale host rows or a render crash.

## Why F1 Is Read-Only

A mapped column may project `status` from `state` in one source and from
`workflow_status` in another. The existing table transaction API writes by the
displayed column name. Allowing it to edit the synthetic `status` cell would
therefore create a new `status` frontmatter key instead of updating the owning
source key, violating ADR 0001 and ADR 0017.

The safe F1 boundary is a read-only live projection. A later editable extension
must carry a row-specific canonical-to-source write key through conflict
detection, undo/redo, option configuration, bulk paste, and file rename tests
before this boundary can change.

## Flag Contract

`crossDatabaseSavedViews` is default on because F1 is owner-requested. It is
retained as a kill switch for a core render-path change. When false,
`FrameSchema.def.sources` is ignored and the prior singular context/database
path is restored.

## Consequences

- The Life HQ cockpit can define Next, Schedule, and State as ordinary saved
  views in the My Day space and switch among them with the native view selector.
- No generated feed, daemon, Dataview query, or new durable row store exists.
- Shared-field mappings are explicit configuration rather than inferred schema
  aliases.
- Source databases remain the only editing surfaces in F1.
- F2 rollups and F3 recurrence can build on the same projection boundary without
  changing where ordinary facts live.

## Verification

The pure assembler tests normalization, mapping, type reconciliation,
provenance, deduplication, and empty-source behavior. Provider jsdom tests cover
multi-source loading, the write firewall, and the flag-off legacy path. Modal
jsdom tests cover source creation, mapping parsing, normalization, and the
two-source activation gate. The repository pre-commit chain plus deploy and
live-verify contract remain mandatory.
