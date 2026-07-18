# ADR 0020: Date Reminders and Recurring Events — Delivery Mechanism and Recurrence Materialization

## Status

Accepted — owner-pulled on 2026-07-10 by the instruction to "finalize all open
features in notidian" and to build each ADR's recommended option. The owner pull is
recorded on bd `Notidian-5io`; bd `Notidian-tluq.6` confirmed the binding delivery,
recurrence, validation, persistence, and lifecycle contracts on 2026-07-18.
Implementation is split into `Notidian-tluq.7` (reminder delivery) and
`Notidian-tluq.8` (recurrence/reminder authoring and rendering).

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
- `predicate.listViewProps?.repeat` is a per-view **field-name selector**, not the
  recurrence rule. `MonthWeekRow.tsx` and `DayView.tsx` read the selected value from
  the row (`event[fieldRepeat]`), currently accept only a JSON string through
  `safelyParseJSON`, and build `RRule` occurrences for the visible window. Generated
  instances are spread off the base event and are ephemeral render artifacts, never
  written back. The two views currently disagree about `until`, validation is
  permissive, and an unbounded hourly series can still exceed the apparent count
  guard; the implementation sessions replace these duplicated paths with one strict,
  capped expander.

So the de-facto recurrence model today is **one canonical row carrying a recurrence
rule; occurrences are expanded on demand at render time and never persisted.** The
recurrence half of this ADR makes the rule a strict YAML mapping in the row's
frontmatter, keeps the existing selector as legacy view compatibility, and gives the
rule an authority-aware editing UI. A source-less generic `object` column currently
defaults to MDB ownership, so the authoring transaction must explicitly target
frontmatter rather than reuse that generic object write path.

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

## Decision

Two coupled choices: **(a)** how a reminder is *delivered*, and **(b)** how a
recurrence *materializes*. Both keep the row's frontmatter canonical (C1).

### (a) Reminder delivery mechanism

**Recommended: a default-OFF load-time + interval scan that fires
`superstate.ui.notify` (Obsidian Notice), with last-fired tracking to avoid
re-firing.**

After the first indexed superstate update, and every 60 seconds while the plugin is
loaded, scan indexed rows with a valid `due` + `reminder.before` schedule. A reminder
that became due during the inclusive seven-day catch-up window fires once on the
next scan. Delivery claims are durably recorded before `superstate.ui.notify(...)`
is called so reloads and concurrent ticks cannot repeat the same notice.

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
window; this choice stores the actual rule as a row-frontmatter property while the
per-view `listViewProps.repeat` remains only a legacy field selector. The editing UI
writes the fixed canonical `repeat` key and never materializes an occurrence.
No occurrence is ever written to disk; the base row stays the single source of
truth. The shared expander adds an explicit visible-occurrence cap rather than
relying on an optional authored `count`.

Reasons (one line each):

- **Matches the de-facto shipped model (C4, C5)** — render-time expansion of one row
  is already how the calendar works; this just makes the rule frontmatter-canonical
  and editable.
- **No row explosion, edits stay atomic (C4)** — "change the series" is a one-row
  edit; deleting the event deletes one file.
- **Portable and diff-friendly (C1)** — the whole recurrence is one readable
  frontmatter block, meaningful in plain Obsidian.

### Frontmatter shape

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
  count: 10                        # optional; positive integer, maximum 100
  until: 2026-09-01                # optional
  wkst: MO                         # optional
# reminder — fully new
reminder:
  before: PT30M                    # strict ISO-8601 duration before `due`
```

`reminder.before` is a lead time relative to the due date, so it survives a
reschedule and composes with recurrence. V1 accepts strict, nonnegative ISO-8601
durations containing integer weeks, days, hours, minutes, or seconds (`P2W`, `P3D`,
`PT2H30M`, `PT0S`); signs, fractions, months, years, and values above 365 days are
invalid. V1 deliberately has one fixed anchor (`due`) and no absolute-reminder form.

### Binding implementation contract (confirmed 2026-07-18)

#### Reminder delivery and fired state (`Notidian-tluq.7`)

- `dateReminders` is default-OFF. Enabling authoring does not implicitly enable
  notification delivery.
- Seed a candidate map from `superstate.pathsIndex`, then maintain it through the
  path-created, path-state-updated, path-deleted, path-changed, and superstate update
  events. Scans are single-flight and operate on the candidate map, not a repeated
  whole-vault parse.
- A delivery identity is canonical path + occurrence-start epoch + a normalized
  schedule fingerprint (`due`, `repeat`, `reminder.before`). Rename migrates state;
  a relevant schedule edit invalidates the prior identity; delete purges it.
- Claim before notifying. A recovered claim is treated as fired, favoring at-most-
  once delivery over duplicate spam after a crash. Persist claims in dedicated
  Notidian-owned noncanonical storage under `.notidian`, with awaited claim, delete,
  rename, prune, and unload-flush operations; the existing debounced view cache is
  not itself a sufficient durability primitive.
- Keep fired state for 30 days, cap it at 50,000 records, and prune oldest first.
  Limit recurrence expansion to 100 occurrences per row per scan and 1,000 globally.
  Emit at most 10 individual notices per scan plus one summary notice for overflow;
  overflow identities are claimed so they do not become a later spam backlog.
- If fired-state storage fails, fail closed: send no reminder notices, show at most
  one session warning, and write a diagnostic. Start idempotently after the index is
  ready; reconcile setting changes; stop, unsubscribe, and flush on unload.
- Tests inject the clock, index, state store, notifier, and timer. They cover due,
  overdue, recurrence, reload, edit, rename, delete, duplicate ticks, overflow,
  persistence failure, and unload.

#### Recurrence/reminder authoring and rendering (`Notidian-tluq.8`)

- Canonical `repeat` and `reminder` values are YAML mappings. A legacy JSON string
  may be read for compatibility but new writes always produce mappings.
- The parser is strict: `freq` is one of DAILY/WEEKLY/MONTHLY/YEARLY/HOURLY;
  `interval` is a positive integer; `count` is a positive integer no greater than
  100; weekday tokens are exact; `until` is valid and not before `due`; unknown
  keys and malformed types are visible validation errors, never silently dropped or
  clamped.
- Authored `until` is the inclusive series ceiling. View windows belong only in
  `RRule.between`. Day and Month use one shared expander, capped at 100 visible
  occurrences per row, that returns occurrences, validation error, and truncation
  state.
- The base Markdown row remains the only durable row. An invalid recurrence renders
  the base event once with an accessible warning; no generated file or MDB row is
  ever created.
- Schedule edits use a dedicated stale-aware, frontmatter-targeted transaction. The
  generic source-less `object` property path is not used because it can resolve to
  MDB ownership.
- The date UI authors `due`, `repeat`, and `reminder`; offers only supported
  frequencies; uses real buttons with keyboard and accessible error behavior; and
  shares the same editor across Day and Month. A disabled-delivery state is visible
  when authoring is available but `dateReminders` is OFF.
- `dateScheduleAuthoring` is a default-ON kill switch. OFF restores the legacy
  authoring/render branch. Unit/jsdom tests cover settings parity, parsing,
  expansion, transactions, both calendar views, accessibility, and the kill switch.
  Deployment and live verification still require fresh owner approval.

The earlier default-OFF in-memory spike is superseded by the owner-pulled, fully
specified S7 implementation; shipping a duplicate-prone interim scheduler would no
longer reduce risk.

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

The accepted decision has these consequences:

- The actual recurrence rule becomes a **row frontmatter** `repeat` property
  (file-canonical); the per-view `listViewProps.repeat` remains only a legacy field
  selector. The duplicated calendar expanders are replaced because they do not
  currently share validation, YAML-object parsing, or `until` semantics.
- A new, default-OFF reminder scanner is added to the plugin lifecycle
  (`onLayoutReady` + interval) that toasts due reminders via `superstate.ui.notify`;
  reminder lead time lives in a `reminder` frontmatter key.
- A lifecycle surface (durable fired-state claims, catch-up-on-open semantics,
  bounded batching, index subscriptions, and unload flush) lives in dedicated
  Notidian-owned runtime state, never frontmatter.

Tradeoffs:

- Reminders fire only while Obsidian is open — there is **no background/OS
  notification**. This is an honest limitation of an Obsidian plugin (C2) and is
  surfaced as "fires once on next open" rather than hidden.
- Block-granular per-occurrence edits are not supported in R1; that is the deferred
  R3 path, accepted as a later increment because R1 is forward-compatible.
- Invalid recurrence/reminder metadata stays visible and editable rather than being
  silently normalized. This is stricter than the current parser and may expose
  malformed legacy strings that previously rendered incompletely.

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
- Sibling-in-spirit to **ADR 0019**: both keep portable row metadata in frontmatter
  while noncanonical operational state remains Notidian-owned.

## Owner ratification

The owner pulled the recommended pair on 2026-07-10 by instructing the autonomous
finalization stream to implement every open Notidian feature using each ADR's
recommended option. No owner-value contradiction was found during the 2026-07-18
contract confirmation. The remaining numeric bounds and failure behavior above are
implementation safety decisions that preserve the chosen file-authority,
non-spamming, and non-materializing product shape.
