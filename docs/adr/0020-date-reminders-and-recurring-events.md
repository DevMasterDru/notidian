# ADR 0020: Date Reminders and Recurring Events — Delivery Mechanism and Recurrence Materialization

## Status

Proposed.

Awaiting an owner decision. Tracked by bd `Notidian-5io`; queued in
[docs/AUTONOMOUS-REVIEW-QUEUE.md](../AUTONOMOUS-REVIEW-QUEUE.md). This ADR was
written instead of building the feature blind: the bead itself records "these are
design decisions for the user," and the two open choices (how a reminder is
*delivered* and how a recurrence *materializes*) are runtime/render/notification
concerns that no offline gate (tsc/jest/build) can prove correct. A wrong choice
here would either spam the owner with notifications, couple Notidian to an external
plugin, or explode the vault with generated rows — all expensive to undo.

## Date

2026-06-15

## Context

This is the second half of the date roadmap slice under epic `Notidian-2w0`
("Notion-parity"). The first half — Notion-style Today/Tomorrow/Next-week date-cell
shortcuts — shipped in `0e289e0` (bead `Notidian-e6v`, now closed). The remainder,
split into `Notidian-5io`, is **optional reminder + recurring/repeat metadata on
date fields, frontmatter-canonical**.

### What already exists in the code (this grounds the options)

Recurrence is **not greenfield**. The calendar views already consume a single-row,
rrule-shaped recurrence definition and expand it at render time:

- `getFreqValue` / `getWeekdayValue` in `src/core/utils/date.ts` map string tokens
  (`DAILY`/`WEEKLY`/`MONTHLY`/`YEARLY`/`HOURLY`; `SU`..`SA`) to `rrule` constants.
  They are dormant only at the *editing* layer — they are **live at the render
  layer** and are now covered by tests (bead `Notidian-873`,
  `src/core/utils/date.test.ts`, incl. the undefined-on-unknown-token contract).
- `MonthWeekRow.tsx` and `DayView.tsx` read a per-view `fieldRepeat`
  (`predicate.listViewProps?.repeat`), `safelyParseJSON` it into a `repeatDef`, and
  if `repeatDef.freq` is set they build `new RRule({ dtstart, freq, count, interval,
  byweekday, until, wkst })` and call `rule.between(...)` to materialize occurrences
  **for the visible window only**. Generated instances are spread off the base
  `event` (`{ ...event, ... }`) — they are ephemeral render artifacts, never written
  back. The occurrence count is already bounded: `count: Math.min(count, 100)`.

So the de-facto recurrence model today is **one canonical row carrying a recurrence
rule; occurrences are expanded on demand at render time and never persisted.** The
recurrence half of this ADR is mostly about (1) writing that `repeatDef` to the
*row's frontmatter* (today it is a per-view MDB-side `listViewProps.repeat` field,
not a frontmatter property) and (2) giving it an editing UI — not about inventing a
materialization strategy.

Reminders, by contrast, are **fully greenfield**: there is no reminder field, no
scheduler, and no due-time delivery anywhere in the codebase.

### Delivery primitives that already exist

- `superstate.ui.notify(content, destination?)` (`src/shared/types/uiManager.ts`),
  backed by `new Notice(content)` in the Obsidian adapter
  (`src/adapters/obsidian/ui/ui.tsx` `openToast`). This is the existing toast/Notice
  abstraction — testable via a `notify` jest mock, already used elsewhere.
- `this.app.workspace.onLayoutReady(async () => …)` in `src/main.ts` — the existing
  plugin-startup hook (used several times) where a load-time scan can run after the
  vault index is ready.
- Plugin lifecycle owns `registerInterval` (Obsidian `Component` API) for any
  in-session periodic check.

### Constraints (what any design must respect)

- **C1 — File/frontmatter authority (ADR 0014, ADR 0017).** A reminder time and a
  recurrence rule are ordinary, portable, human-meaningful row metadata → they must
  be **file-canonical** in the row's frontmatter, visible in the `.md`, diff-able in
  git, and meaningful without Notidian. They must **not** live silently in the
  hidden `.notidian` MDB. ADR 0017: a source-less file-backed value resolves to
  frontmatter, never the hidden store. (Note the existing `listViewProps.repeat` is
  MDB *view* config; the canonical recurrence rule for a row belongs in that row's
  frontmatter.)
- **C2 — No notification spam / no missed-due ambiguity.** Obsidian is not a
  background daemon; the plugin only runs while Obsidian is open. Any delivery design
  must define what happens for reminders that came due while Obsidian was closed
  (fire once on next open? silently skip past-due? a digest?) and must not re-fire
  the same reminder every reload.
- **C3 — No hard dependency on an external plugin.** Coupling reminders to a
  third-party reminders plugin (e.g. obsidian-reminder) would import that plugin's
  format, lifecycle, and maintenance risk into Notidian's authority model and break
  C1 (the reminder data would live in the other plugin's convention, not Notidian
  frontmatter). Single-user portability and file-canonical authority outweigh
  reusing someone else's scheduler.
- **C4 — No row explosion.** Materializing a recurrence as many generated rows
  (one file per occurrence) multiplies vault files without bound, fragments edits
  ("change all future occurrences" becomes an N-file rewrite), and contradicts the
  already-shipped render-time expansion model. The vault must stay one-row-per-event.
- **C5 — Reuse the established recurrence shape.** A second, incompatible recurrence
  representation would fork the calendar render path. The reminder/recurrence keys
  should reuse the existing `freq`/`interval`/`byweekday`/`count`/`until`/`wkst`
  vocabulary that `getFreqValue`/`getWeekdayValue` and the calendar views already
  speak.

## Decision (proposed)

Two coupled choices: **(a)** how a reminder is *delivered*, and **(b)** how a
recurrence *materializes*. Both keep the row's frontmatter canonical (C1).

### (a) Reminder delivery mechanism

**Recommended: a default-OFF load-time + interval scan that fires
`superstate.ui.notify` (Obsidian Notice), with last-fired tracking to avoid
re-firing.**

On `workspace.onLayoutReady` (and on a coarse `registerInterval`, e.g. every few
minutes while open), scan rows that carry a reminder key whose due time has passed
and that have not already fired, and call `superstate.ui.notify(...)` once per due
reminder (optionally opening the row). "Has not already fired" is tracked so the
same reminder does not re-fire on every reload — see "open lifecycle detail" below
for where that marker lives (the one sub-choice left to the owner). Reminders that
came due while Obsidian was closed fire **once** on next open (a catch-up Notice),
not silently skipped and not back-spammed per missed interval.

Reasons (one line each):

- **Reuses existing primitives (no new subsystem)** — `notify`/`Notice`,
  `onLayoutReady`, and `registerInterval` all already exist and are testable.
- **No external dependency (C3)** — Notidian owns the whole path; the reminder data
  stays Notidian-frontmatter-canonical, portable without any other plugin.
- **Honest about Obsidian's runtime (C2)** — "fire once on next open" is the correct
  semantics for a plugin that only runs while the app is open; no false promise of
  background/OS notifications.

### (b) Recurrence materialization

**Recommended: single canonical row carrying an rrule-shaped recurrence rule in its
frontmatter; occurrences expand on demand at render time (generalize the existing
calendar pattern), never as generated rows.**

The row's frontmatter carries the recurrence rule using the **already-spoken**
vocabulary (`freq`, `interval`, `byweekday`, `count`, `until`, `wkst`). The calendar
views already expand exactly this shape via `RRule.between(...)` for the visible
window; this choice **promotes that per-view MDB `listViewProps.repeat` field to a
row-frontmatter property** and adds an editing UI, rather than inventing anything.
No occurrence is ever written to disk; the base row stays the single source of
truth, and `count: Math.min(count, 100)` already bounds expansion.

Reasons (one line each):

- **Matches the de-facto shipped model (C4, C5)** — render-time expansion of one row
  is already how the calendar works; this just makes the rule frontmatter-canonical
  and editable.
- **No row explosion, edits stay atomic (C4)** — "change the series" is a one-row
  edit; deleting the event deletes one file.
- **Portable and diff-friendly (C1)** — the whole recurrence is one readable
  frontmatter block, meaningful in plain Obsidian.

### Frontmatter shape (proposed)

Reuse the existing recurrence vocabulary; add a minimal reminder key. Exact key
names are part of the decision (this is the recommendation):

```yaml
# an event row's frontmatter
due: 2026-06-20T09:00:00          # the existing date field (canonical)
# recurrence — same vocabulary the calendar views already expand
repeat:
  freq: WEEKLY                     # DAILY|WEEKLY|MONTHLY|YEARLY|HOURLY
  interval: 1
  byweekday: [MO, WE, FR]          # optional
  count: 10                        # optional; expansion already caps at 100
  until: 2026-09-01                # optional
# reminder — fully new
reminder:
  before: PT30M                    # ISO-8601 duration before `due` (or an absolute time)
```

`reminder.before` (a lead time relative to the due date) is preferred over an
absolute reminder timestamp because it survives the date being rescheduled and
composes naturally with recurrence (each occurrence inherits the same lead time).

### Open lifecycle detail (a sub-choice, not a blocker)

Where the "already fired" marker lives is the one remaining sub-decision:

- **Recommended:** a Notidian-owned, non-canonical marker (last-fired timestamp) in
  the hidden `.notidian` view-state — because "did this session already toast this
  reminder" is **runtime delivery state, not portable note content**, so ADR 0017
  permits (indeed prefers) it to live in the Notidian-owned layer, keeping the
  human-meaningful `due`/`repeat`/`reminder` in frontmatter clean. (Contrast with
  ADR 0019, where the *comment* is portable content and must be frontmatter.)
- Alternative: an in-memory per-session set (simplest; re-fires across app restarts
  within the same due window — acceptable for a single-user tool, and lossless on
  data).

Either keeps the **canonical** reminder/recurrence data in frontmatter (C1); only
the ephemeral fired-state differs.

### Optional default-OFF spike (de-risks, does not pre-commit)

A minimal spike behind a **default-OFF** `dateReminders` setting (sibling of the
existing `datePickerTime` flag in `src/shared/types/settings.ts`, defaulted in
`src/core/schemas/settings.ts`): on `onLayoutReady`, scan rows for a `reminder`
frontmatter key whose computed due time is in the past, and fire one
`superstate.ui.notify(...)` per due reminder, with an in-memory fired-set (the
simplest lifecycle). **No** recurrence-aware reminder expansion, **no** persisted
fired-state, **no** editing UI. This proves the scan → due-computation → Notice path
and the frontmatter-read against a real vault, without shipping a half-built UX or
touching the calendar render path. It is offered as the recommended **first
implementation step after** the owner picks (a) and (b) — it is not included in this
ADR's change (no production code here). Because it is default-OFF and read-only, it
satisfies the autonomous-drive flag-gating rule if landed.

## Options considered

### (a) Reminder delivery mechanism

| Option | How it delivers | External dep (C3) | Closed-while-due (C2) | Verdict |
| --- | --- | --- | --- | --- |
| **D1. Load-time + interval scan → `notify`/Notice** *(recommended)* | plugin scans due reminders on `onLayoutReady` + a coarse interval, toasts via existing `superstate.ui.notify` | None — all in-plugin | Fires once on next open (catch-up), tracked to avoid re-fire | **Chosen** |
| D2. Delegate to an existing reminders plugin (e.g. obsidian-reminder) | write the other plugin's reminder syntax; it schedules/notifies | Hard dependency on a 3rd-party plugin's format + lifecycle | Depends on that plugin | Ruled out (breaks C1/C3) |
| D3. Immediate Notice only when a date cell is set/edited | toast at edit time, no scheduler | None | No due-time delivery at all (not actually a reminder) | Ruled out (does not meet the need) |

### (b) Recurrence materialization

| Option | Storage | Row count (C4) | Reuses shipped expander (C5) | Verdict |
| --- | --- | --- | --- | --- |
| **R1. Single row + rrule frontmatter, expand at render** *(recommended)* | one row, `repeat` frontmatter | One row per series | Yes — calendar already does exactly this | **Chosen** |
| R2. Generated rows (one file per occurrence) | N files | Unbounded explosion; N-file edits | No — would bypass/duplicate the expander | Ruled out (breaks C4) |
| R3. Hybrid: rule + materialize only "exception/overridden" occurrences as rows | one base row + sparse override rows | Bounded (only edited occurrences) | Extends the expander with overrides | Deferred — more power than needed now; revisit if per-occurrence edits become a real need |

## Ruled-out options (and why)

- **D2 — delegate to an external reminders plugin.** Rejected: it imports a
  third-party plugin's reminder format and lifecycle into Notidian's authority model,
  so the reminder data would live in *that* plugin's convention rather than Notidian
  frontmatter (fails C1), and adds a hard runtime dependency and maintenance risk
  (fails C3). For a single-user, file-canonical tool, owning the path is cheaper than
  inheriting someone else's.
- **D3 — edit-time-only Notice.** Rejected: a toast when you set a date is not a
  reminder; it delivers nothing at the due time, so it does not meet the bead's
  actual need.
- **R2 — generated rows per occurrence.** Rejected: it multiplies vault files
  without bound (fails C4), makes "edit the series" an N-file rewrite, and
  contradicts the already-shipped render-time single-row expansion (fails C5). The
  existing `count: Math.min(count, 100)` cap exists precisely because expansion is
  ephemeral; persisting it would remove that safety.
- **R3 — full exception/override materialization** is *not* rejected, only
  **deferred**: it is the natural next step **if** the owner needs to edit individual
  occurrences ("move just this Friday"), but it is more machinery than the current
  need justifies, and R1 is forward-compatible with adding it later.

## Consequences

If accepted:

- The recurrence rule moves from a per-view MDB `listViewProps.repeat` field to a
  **row frontmatter** `repeat` property (file-canonical), and gains a small editing
  UI in the date-cell menu (`datePickerMenu.tsx`); the calendar render path is
  unchanged because it already expands this exact shape.
- A new, default-OFF reminder scanner is added to the plugin lifecycle
  (`onLayoutReady` + interval) that toasts due reminders via `superstate.ui.notify`;
  reminder lead time lives in a `reminder` frontmatter key.
- A small lifecycle surface (fired-state tracking, catch-up-on-open semantics) is
  introduced; per the open sub-choice it lives in Notidian view-state (ephemeral),
  not frontmatter.

Tradeoffs:

- Reminders fire only while Obsidian is open — there is **no background/OS
  notification**. This is an honest limitation of an Obsidian plugin (C2) and is
  surfaced as "fires once on next open" rather than hidden.
- Block-granular per-occurrence edits are not supported in R1; that is the deferred
  R3 path, accepted as a later increment because R1 is forward-compatible.
- `byweekday`/`wkst` token mapping has an undefined-on-unknown-token footgun
  (covered by `Notidian-873` tests); the editing UI must emit only the known tokens
  the expander accepts.

## Relationship to other ADRs / code

- Honors **ADR 0014** (Notidian-only engine; ordinary row data canonical in
  files/frontmatter) and **ADR 0017** (no silent MDB ownership — `due`/`repeat`/
  `reminder` are file-canonical; only ephemeral fired-state may sit in Notidian
  view-state).
- Reuses the dormant-at-edit-layer `getFreqValue`/`getWeekdayValue`
  (`src/core/utils/date.ts`, tested under `Notidian-873`) and the existing
  `RRule.between` render-time expansion in `MonthWeekRow.tsx` / `DayView.tsx`.
- Reuses `superstate.ui.notify` / `Notice`, `workspace.onLayoutReady`, and
  `registerInterval` already present in the codebase.
- Sibling-in-spirit to **ADR 0019** (also a frontmatter-canonical, default-OFF-spike
  decision for an open-design Notion-parity slice).

## The one decision needed from the owner

Approve the pair **(a) load-time + interval scan firing `superstate.ui.notify`
(Obsidian Notice), no external plugin** + **(b) single canonical row with rrule-
shaped `repeat` frontmatter, expanded at render time (never generated rows)** — and
say whether to land the default-OFF, read-only `dateReminders` reminder-scan spike
as the first implementation step. Two minor sub-choices ride along (decide now or
defer): the exact frontmatter key names/shape shown above, and where the
"already-fired" marker lives (recommended: Notidian view-state, ephemeral). If you
prefer delegating reminders to an existing plugin or materializing recurrences as
rows, say so here — those choices change the authority model and the vault file
shape, so they are settled before any build.
