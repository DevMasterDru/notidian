# ADR 0060: Period-Scoped Relation Rollups

## Status

Accepted and implemented for F2.

Authority: Atlas Method ADR 0037 fixes routine state as a completion log with
local-day and ISO Monday-start week semantics. Atlas Method ADR 0083 Decision 2
accepts F2 as a Notidian engine capability and requires its values to be
filterable/sortable, computed at render, and never stored. The owner authorized
continued execution on `Notidian-x7pn` on 2026-07-14.

## Context

Notidian already had forward `rollup` and reverse `backlink` computed columns,
but they aggregated every related row and calculated only inside the visible
cell. A Routines row therefore could not ask how many Routine Log rows matched
today or the current ISO week, and native filters/sort could not consume the
displayed aggregate because it was absent from the provider's row data.

Writing `done_today`, `this_week_count`, or `last_done` into routine
frontmatter would duplicate facts already owned by Routine Log and require a
reset or reconciliation daemon. That contradicts the accepted one-fact-one-home
contract.

## Decision

1. Existing `rollup` and `backlink` configs may carry an optional period:
   `{ field, scope: "today" | "iso-week" }`. No new column type is introduced.
2. Period matching reads the configured date property from each related row.
   `today` compares local calendar dates. `iso-week` uses Monday 00:00 through
   the following Monday 00:00 in local time, including year boundaries.
   Missing, malformed, or impossible date-only values fail closed and do not
   enter the scoped relation set.
3. Period filtering happens before aggregation. Consequently `count` and the
   detailed relation/resolution counts describe only rows in the selected
   period.
4. `earliest` and `latest` are date aggregate functions. They ignore invalid
   dates and return the winning stored value without creating a durable copy.
5. The context provider overlays computed `rollup` and `backlink` values on
   cloned, ephemeral rows before native predicate filtering and sorting. The
   source table, frontmatter, and context MDB rows are not mutated. Column
   authority remains `computed`.
6. While a table with relation-computed columns is open, path-state updates
   schedule a small debounced recomputation from the in-memory frontmatter and
   inlink indexes. An open table also schedules one recomputation at the next
   local-day boundary, then reschedules, so Today and ISO-week membership cannot
   stay stale across midnight. No table write or new source of truth is involved.
7. Aggregate function determines comparison type for native controls: numeric
   reducers compare as number, earliest/latest as date, and listing reducers as
   text. The persisted column type remains `rollup` or `backlink`, preserving
   its read-only renderer and authority class.
8. `periodScopedRollups` is default on because F2 is owner-requested. It is the
   kill switch for the provider render-path change. When false, saved period
   scopes are ignored and provider materialization is skipped; legacy
   cell-only, unscoped rollups remain available.

## Options Considered

### A. Extend Existing Rollup and Backlink Configs — Chosen

One relation resolver, aggregate engine, property menu, renderer, and authority
class serve both unscoped and period-scoped values. This is the smallest design
that also supports Routine Log's reverse `routine` relation.

### B. Add a New Period-Rollup Column Type — Rejected

This would duplicate configuration, cell rendering, write-firewall, filter,
sort, and relation-resolution code while representing the same computed fact.

### C. Store Counters and Latest Dates on Source Rows — Rejected

Stored `done_today`, weekly counts, or `last_done` would become a second owner
for Routine Log facts and require reset/reconciliation machinery. It violates
Atlas Method ADR 0037 and ADR 0083 directly.

## Consequences

- Routines can expose a reverse `routine` count scoped by `done` for Today or
  This ISO Week and use that number in native filter/sort.
- A separate latest-`done` backlink rollup supplies last-completion ordering
  without storing `last_done`.
- `times_per_week` can render and filter against the live weekly count; the
  presentation of literal “N of M” text remains a view concern.
- Existing unscoped rollups keep their stored config and aggregate semantics.
- Computation cost occurs only in an open view with relation-computed columns
  and reads existing in-memory indexes rather than the filesystem.

## Verification

Pure tests pin local-day parsing, ISO week boundaries, invalid-date failure,
period-before-count ordering, earliest/latest, forward and reverse runtime
bridges, non-mutating materialization, comparison typing, and setting parity.
The full repository gates plus deployed Obsidian DOM/error checks remain
mandatory for owner-facing completion.
