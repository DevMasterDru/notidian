# ADR 0023: Type Profile Hub-Deletion Notice — Prior-State Signal

## Status

Declined — parked per `docs/ROADMAP.md` (build only if the owner asks). The ADR's
own recommendation is option (c): decline the per-edit notice. This is a P3,
explicitly low-value ambient-status nicety; the only data-loss-adjacent case is
already covered by the existing `saveFrontmatterProperties` failure notice, and
the use-driven validation model (the owner validates by USING the tool) has not
surfaced a need for it. This ADR is retained as grounding reference for the
blocker analysis (the three-way-collapsed `{ ok:false, state:null }` and the
always-computed `notePath`); it is not a decision-that-waits. If the owner later
wants the ambient status, the recommended build is option (a) per the analysis
below.

Originally: Proposed; awaiting owner direction (bd Notidian-n2t). This ADR refuses
to build the notice blind: a naive "the hub stopped tracking" notice cannot be
implemented correctly without a sound prior-state signal, and obtaining one is a
genuine design choice with a false-positive risk and a
Notidian-ownership/authority constraint. It frames the options and recommends one.
Nothing in the runtime render path changes here.

## Date

2026-06-15

## Context

A folder database can opt into a **Type Profile**: its hub note (the folder note)
declares `schema_type: notidian_type_profile` plus `fields` / `kind_fields` maps,
and Notidian mirrors table-schema edits into that hub two-way
([Notidian-5qr, Notidian-egz]; `src/core/utils/contexts/typeProfile.ts`,
`typeProfileMirror.ts`). The desired feature (bd Notidian-n2t, split from the
Notidian-9vp epic): when a database that **previously** declared a Type Profile
loses its hub (the folder note is deleted), tell the user the hub stopped
tracking — instead of the current silent no-op.

### Why a notice cannot fire correctly today (the hard blocker)

The table→hub mirror entry point is
`mirrorSchemaChangeToTypeProfile(superstate, contextPath, change, baseOverride)`
(`src/core/utils/contexts/typeProfileMirror.ts`). It returns
`{ ok: false, state: null }` in **three distinct situations that are
indistinguishable from each other** at the call site:

1. `notePath` is falsy — never actually reached for folder spaces (see below).
2. The hub note has no frontmatter (`pathsIndex.get(notePath)?.metadata?.property`
   is absent) — folder note absent, *or* present with empty frontmatter.
3. `parseTypeProfile(frontmatter)` returns `null` — no `schema_type`, or it is not
   `notidian_type_profile` (`typeProfile.ts:124`).

Two facts make "no profile resolved" un-discriminable from "hub deleted":

- **`notePath` is always a computed path.** For every folder space,
  `fileSystemSpaceInfoFromFolder` synthesizes
  `notePath = <folder>/<folderNoteName>.md` (or the adjacent-mode sibling path)
  **regardless of whether that file exists**
  (`src/core/spaceManager/filesystemAdapter/spaceInfo.ts:121-132`). So the path's
  presence proves nothing about the note's existence; case (1) above is effectively
  dead and "deleted hub" collapses into case (2)/(3).

- **The mirror fires on EVERY schema change for ANY folder DB.** The caller gates
  only on the schema being the default context schema —
  `dbSchema?.id == defaultContextSchemaID`
  (`src/core/react/context/ContextEditorContext.tsx:1402, 1574, 1585`) — **not** on
  the space having a profile. Every folder database's column add / rename /
  retype / add-option therefore enters the mirror, and the overwhelming majority of
  folder DBs have **no** profile and never will.

Consequently, a naive "the hub stopped tracking" notice keyed on
`{ ok: false }` (or on `state == null`) would fire on **every column edit of every
non-Type-Profile folder database** — pure false-positive spam. There is currently
no notice at all on this path: the mirror is invoked fire-and-forget
(`void runSerializedTypeProfileMirror`, `ContextEditorContext.tsx:1403, 1589,
1616`), so its result is discarded by design.

Distinguishing "this space **previously** resolved a profile and now resolves
none" from "this space never had one" requires a **prior-state signal** that does
not exist today. That signal is the real decision.

### What already covers the only data-loss-adjacent case

The genuinely dangerous case — the hub note is deleted **between** the mirror's
read of frontmatter and its write — is already surfaced. When a profile *was*
resolved and the subsequent `saveFrontmatterProperties` write fails (the file is
gone), it notifies with
`"Could not mirror the schema change to the database hub note."`
(`typeProfileMirror.ts:78-85`, `frontmatterWrite.ts:26,29`). The table write
itself is never rolled back. So the loss-of-mirrored-edit scenario is not silent;
what is silent is the *steady-state* "the hub you set up is no longer there"
ambient status — which is informational, not a data-integrity gap.

### Authority constraint (ADR 0017 / ADR 0014)

Any persisted "last-known profile" is an **explicitly Notidian-owned field** and
must live in Notidian context storage (`.notidian`/context MDB), never in the
user's note frontmatter or as inferred row data. Notidian "never creates a profile
uninvited" (`typeProfileMirror.ts:45`), and projected/cached values must be
rebuilt from the owning layer and must not become a durable source of truth
([ADR 0014], [ADR 0017]). This raises the bar for option (a): it is net-new
durable Notidian state with its own create/update/delete lifecycle.

## Decision Drivers

- **Correctness first:** no notice may fire for a folder DB that never had a
  profile (zero false positives is the bar — this path runs on ordinary edits).
- **Cost vs value:** the bead is **P3, explicitly low value**. The only
  data-adjacent case is already covered. The remaining payoff is an ambient status
  nicety.
- **Authority:** any persisted prior-state is Notidian-owned and must respect the
  context-storage ownership model; it must not leak into user frontmatter.
- **No new per-edit overhead on the hot path** unless it buys real value: the
  mirror runs on every default-schema column edit of every folder DB.

## Options

### (a) Persist last-known-profile per space (Notidian-owned context field)

Record, in Notidian context storage, that a given space's hub *did* declare a
profile (e.g. a `typeProfileLastSeen` marker, set whenever a profile resolves).
On a mirror call that now resolves no profile **and** the marker is set, fire the
"hub stopped tracking" notice once, then clear the marker.

- **Pro:** the only option that can detect a true deletion across app restarts and
  metadata-cache churn; soundly separates "had one, lost it" from "never had one".
- **Con:** net-new durable Notidian-owned state with a full lifecycle (set on
  resolve, clear on intentional un-declare vs deletion, migrate, reconcile on
  external edits to the hub). Marker staleness reintroduces a false-positive risk
  (e.g. user deliberately removes `schema_type` → looks identical to deletion).
  Highest build + maintenance cost; an ADR-0017 authority surface to design and
  defend — disproportionate to a P3 status notice.

### (b) Read-before-write diff (schema_type-was-present-now-gone)

Within a single mirror burst, capture whether the *first* read of the hub in this
session resolved a profile, and if a later call in the same in-flight chain
resolves none, infer deletion. The serializer
(`typeProfileMirrorQueue.ts`) already threads `TypeProfileSchemaState` across a
hub's burst; a "had-profile" boolean could ride alongside it.

- **Pro:** no durable storage; reuses the existing in-flight threaded state;
  respects authority (nothing persisted).
- **Con:** the signal lives **only** for the duration of one in-flight burst —
  `threaded`/`depth` are deleted the moment a hub's chain drains
  (`typeProfileMirrorQueue.ts:58-63`). It cannot detect the realistic case (hub
  deleted while the table is closed / between sessions / between unrelated edits),
  which is exactly when a status notice would matter. It only catches "deleted mid-
  burst", which the `saveFrontmatterProperties` failureMessage **already** reports.
  Low marginal value over the status quo.

### (c) Decline — keep the silent steady-state no-op; rely on the existing failure notice

Do not add a hub-deletion notice. The mid-operation deletion (the only case with a
lost edit) already surfaces via the `saveFrontmatterProperties` failureMessage. The
steady-state "your hub is gone" status is informational and low value; it is not
worth net-new Notidian-owned authority state (a) or a burst-scoped half-signal that
duplicates an existing notice (b). If wanted later, surface hub presence/absence
**passively** in a Type Profile status/diagnostics view (read-only, computed from
`pathsIndex` at view time — no hot-path notice, no persisted state), rather than as
a per-edit toast.

## Recommendation

**Adopt (c) — decline the per-edit notice.** One-line why: the only case that
loses work is *already* reported, and the remaining value is a P3 ambient status
that does not justify net-new Notidian-owned authority state (a) or a burst-scoped
signal that merely re-reports the case (b) already covers — declining is the
highest durable-value-per-token choice, and the deferred passive-status idea keeps
the door open at zero ongoing cost.

If the owner judges the ambient status genuinely worth it, the recommended *build*
is **(a)**, not (b): only (a) detects the realistic across-session deletion that
makes such a notice meaningful, and it must be implemented as an explicitly
Notidian-owned context field per ADR 0017 with a defined set/clear/reconcile
lifecycle. (b) is not recommended as a standalone — it adds code to catch a case
the existing failureMessage already catches.

## Ruled Out

- **Notice keyed on `{ ok: false }` / `state == null` (the naive build).** Fires on
  every column edit of every non-Type-Profile folder DB (the dominant case) —
  guaranteed false-positive spam. This is precisely why the bead is DESIGN-OPEN and
  not a one-liner.
- **Storing last-known-profile in the hub note's frontmatter or any user-owned
  field.** Violates ADR 0017 / ADR 0014: prior-state is Notidian-owned and must not
  be written into user frontmatter or inferred row data.
- **Gating the mirror call on "has a profile" to suppress the noise.** Does not
  solve the problem — you only learn there is no profile *by* attempting resolution,
  which is the same point at which deletion and never-had collapse; it just moves the
  indistinguishable check upstream.

## Consequences

- If (c): no code changes; bd Notidian-n2t closes as Won't-Build-As-Specified with
  the deferred passive-status idea recorded for a future low-priority view bead.
  Behavior is unchanged; the mid-operation deletion notice (failureMessage) remains
  the only signal, which is the correct one.
- If (a): a follow-up bead designs the Notidian-owned `typeProfileLastSeen` context
  field, its set/clear/reconcile lifecycle (incl. distinguishing intentional
  un-declare from deletion), and the one-shot notice — scoped behind the standard
  default-OFF verify path since it touches the live edit flow.
- A spike was deliberately **not** added: neither (b) (burst-scoped, duplicates an
  existing notice) nor (a) (net-new authority state) can be de-risked by a throwaway
  flag without committing to the design choice this ADR exists to defer to the owner.

## References

- bd Notidian-n2t (this decision); split from epic bd Notidian-9vp item 1.
- [ADR 0014](0014-notidian-only-personal-database-engine.md),
  [ADR 0017](0017-explicit-notidian-ownership.md) — Notidian-owned-field authority.
- `src/core/utils/contexts/typeProfileMirror.ts` — the three-way-collapsed
  `{ ok:false, state:null }`; the mid-op failureMessage.
- `src/core/spaceManager/filesystemAdapter/spaceInfo.ts:121-132` — `notePath` is
  always computed.
- `src/core/react/context/ContextEditorContext.tsx:1402,1574,1585` — the
  default-schema-only gate; `:1403,1589,1616` — fire-and-forget invocation.
- `src/core/utils/contexts/typeProfileMirrorQueue.ts:58-63` — burst-scoped threaded
  state lifecycle (relevant to option (b)).
- `src/core/utils/properties/frontmatterWrite.ts:26,29` — the existing failure
  notice path.
