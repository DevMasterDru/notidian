# ADR 0061: Recurrence-Aware Occurs-On Filters

## Status

Accepted, implemented, deployed, and live-verified for F3.

Authority: Atlas Method ADR 0037 fixes local-day and ISO Monday-start week
semantics and treats `times_per_week` routines as N-of-M rather than due/not
due. Atlas Method ADR 0083 accepts F3 as a Notidian engine capability. The
owner authorized continued execution on `Notidian-1ceb` on 2026-07-14.

## Context

Routines and recurring Events store a compact schedule on the canonical row:
an ordinary select property named `cadence` or `recurrence`, plus optional
`days` and `times_per_week` properties. A saved Today or This Week view needs to
ask whether each row occurs in the current period. Generic equality filters
cannot interpret that schedule.

Generating occurrence rows, storing `occurs_today` flags, or running a reset
daemon would introduce a second owner for schedule facts. The schedule already
lives in frontmatter and can be evaluated cheaply while Notidian filters an
open view.

## Decision

1. The native predicate engine gains two value-free row predicates:
   `occursToday` and `occursThisWeek`. Their labels are **Occurs today** and
   **Occurs this ISO week**.
2. The operators appear only on ordinary select columns whose case-insensitive
   field name is `cadence` or `recurrence`. They are not generic option
   predicates and therefore do not pollute unrelated select-property menus.
3. Evaluation reads the selected cadence/recurrence cell plus the row's `days`
   and `times_per_week` frontmatter. It never writes a computed value or creates
   a materialized occurrence.
4. Today uses the local calendar day. Daily schedules occur every day;
   weekdays occur Monday through Friday; weekly/custom schedules occur today
   only when `days` contains today's weekday.
5. This ISO week uses the local Monday-start week. Daily and weekday schedules
   occur in the week. Weekly schedules occur in the week even without a chosen
   day. Custom schedules occur when they have at least one valid day or a
   positive finite `times_per_week` value.
6. A frequency-only weekly/custom schedule never claims a specific Today
   occurrence. This preserves the accepted N-of-M contract: frequency states a
   weekly target, not which day is due.
7. Monthly schedules fail closed because the accepted compact fields do not
   identify a day of month. Unknown cadences, malformed day tokens, and
   incomplete schedules also fail closed.
8. While an open view contains an enabled occurrence predicate, the provider
   schedules a render-only recomputation at the next local-day boundary and
   reschedules after it fires. This reuses the period-rollup refresh epoch and
   performs no filesystem or MDB write.
9. `recurrenceAwareFilters` is default on because F3 is owner-requested. It is
   an honest kill switch: when false, the UIs hide the special operators and
   the row matcher ignores any stored occurrence predicates (fail-open), so
   legacy row visibility is restored.

## Options Considered

### A. Native Row Predicate Operators — Chosen

This reuses saved-view filters, composes with grouping/sort/search, reads the
canonical row once, and adds no storage or background service.

### B. Materialized Occurrence Instances — Rejected

Generated child rows would require identity, cleanup, reconciliation, and a
second durable representation for facts already owned by the recurrence row.
That machinery is not needed for Today/This Week membership.

### C. Stored Boolean or Date Flags — Rejected

Fields such as `occurs_today` become stale at midnight and require a reset
daemon. They violate the one-fact-one-home contract and make filtered results
depend on the daemon rather than the canonical schedule.

### D. Treat `times_per_week` as Due Today — Rejected

An N-of-M target contains no day assignment. Inventing one would misstate the
schedule and conflict with Atlas Method ADR 0037.

## Consequences

- Saved Routines and Events views can express Today and This ISO Week directly
  with native filters.
- A day-assigned Routine can combine **Occurs today** with F2's Today completion
  count to express due-but-not-done. A frequency-only `times_per_week` Routine
  instead compares its F2 ISO-week count with the weekly target; it never uses
  a fabricated Today due state.
- `cadence` and `recurrence` remain ordinary frontmatter-backed select fields;
  `days` and `times_per_week` remain the only supporting schedule facts.
- Monthly occurrence filtering remains unsupported until a canonical month-day
  field or richer recurrence grammar is ratified.
- Existing saved predicates remain forward-compatible: older builds fail open
  on unknown operators, and disabling the F3 flag also fails open.
- Events may adopt ordinary `recurrence` and `days` fields through the later
  cockpit schema rollout; F3 does not mutate the Atlas Vault schema itself.

## Verification

Pure tests pin cadence/day parsing, local weekday behavior, ISO-week inclusion,
N-of-M frequency behavior, malformed/monthly failure, full-row predicate
dispatch, UI scoping, and the default-on fail-open kill switch. The full
repository gates plus deployed Obsidian DOM/error checks remain mandatory for
owner-facing completion.
