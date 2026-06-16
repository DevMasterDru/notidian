# ADR 0029: Frontmatter-Link Relations + Rollups — Authority and UX Contract (Source Property, Rollup Definition Storage, One-Way vs Two-Way, Dangling/Non-Numeric Display, Recompute Timing)

## Status

Parked — build when the owner asks.

Parked to [docs/ROADMAP.md](../ROADMAP.md) — genuinely-speculative product
direction the owner validates by *using* the tool and has not requested; this
ADR is retained as grounding reference, not a decision that waits. Tracked by
bd `Notidian-tni`; queued in
[docs/AUTONOMOUS-REVIEW-QUEUE.md](../AUTONOMOUS-REVIEW-QUEUE.md). This ADR was
written instead of building anything blind. It is roadmap item (1) of epic
`Notidian-2w0` ("frontmatter-link relations + rollups") — the headline Notion gap
— which had **no ADR yet**, even though its **engine and runtime wiring already
shipped and are tested** (see below). What is *not* yet ratified is the
user-facing **authority + UX contract**: which frontmatter property is the relation
source, where the rollup *definition* is allowed to live, whether the relation is
one-way or two-way, what the user sees for dangling/non-numeric values, and when a
rollup recomputes. A wrong call here would either invert authority into a hidden
store (the exact failure ADR 0017 closed) or change what the owner reads off their
real notes — both expensive to undo across a vault — so the build stops at the
contract. This decision is the relations/rollups analogue of ADR 0024 (which
ratified the sub-items/back-relations contract over the *same* shared resolver).

## Date

2026-06-15

## Context

### What already shipped (this grounds every option below)

Frontmatter-link relations and rollups are **not greenfield**. The pure engine, the
runtime bridge, the read-only cell, the column type, and the config menu are done,
tested, and Codex-reviewed (beads `Notidian-9ln` capstone, `Notidian-8pl` runtime,
`Notidian-e1u` resolver, `Notidian-ahk` back-relations):

- **Relation parsing** — `parseRelationLinks(value)`
  (`src/core/utils/contexts/tableRollup.ts`) turns a relation property's frontmatter
  value into target paths. It accepts a YAML array or a string of `[[wikilinks]]`
  (alias `|display` and `#heading`/`#^block` fragments stripped), falls back to
  comma-separated plain paths, and `uniq`s the result. Notidian's naming charset has
  no commas, so comma-splitting is safe for wikilink targets.
- **Rollup engine** — `computeFrontmatterRollup({ linkPaths, config, resolveFrontmatter })`
  (same file) aggregates one target property across the linked rows' **own
  frontmatter**. Functions: `count` (relation count, independent of resolution),
  `count_values`, `values`/`unique`, `sum`, `avg`, `min`, `max`. Array-valued
  frontmatter is flattened; numeric coercion is strict (booleans/Dates/blank are not
  numbers — it never sums checkboxes or dates). Pure + property-tested
  (`tableRollup.test.ts`, `tableRollup.property.test.ts`).
- **Runtime bridge** — `computeRowRollup(superstate, relationValue, config, sourcePath)`
  (`src/core/utils/contexts/tableRollupRuntime.ts`) resolves each link to a real
  vault path, reads that note's frontmatter from `superstate.pathsIndex`
  (`.metadata.property`) — the **in-memory frontmatter cache** — and runs the engine.
  Read-only; **it never writes**.
- **Shared link resolver** — `makeRelationLinkResolver(superstate)`
  (`src/core/utils/contexts/relationResolver.ts`) is `superstate.spaceManager.resolvePath(link, sourcePath) ?? link`.
  It tries the pure relative/alias resolver, then Obsidian's link index
  (`getFirstLinkpathDest`) so bare `[[Note]]` / `[[Folder/Note]]` / aliased links
  canonicalize to a `pathsIndex` key. It returns the **original link unchanged when
  nothing resolves (never null)** — a dangling link stays a stable, non-matching key
  instead of crashing or collapsing to `""`. Rollups, sub-items, and back-relations
  all resolve through this one layer so they match identically.
- **Read-only cell + column type** — `RollupCell`
  (`src/core/react/components/SpaceView/Contexts/DataTypeView/RollupCell.tsx`)
  renders the computed string in a `mk-cell-rollup` div with no edit affordance. The
  `rollup` field type (`src/schemas/mdb.ts`, `configKeys: ['ref', 'field', 'fn']`,
  `description: "Aggregate a property across the rows a relation links to"`) and the
  config menu (`PropertyValue.tsx` `selectRollupRelation` / `selectRollupProperty` /
  `selectRollupFn`) are registered.
- **Back-relations (the read-only inverse)** — `filterBackRelations`
  (`src/core/utils/contexts/tableBackRelations.ts`) + `computeRowBackRelation`
  (`tableBackRelationRuntime.ts`) + the `backlink` field type. Already ratified by
  **ADR 0024** as one-way + computed-inverse. The candidate set is the target's
  precomputed `inlinks` (perf-bounded, no full-vault scan); only candidates whose
  *designated relation property* resolves back to the target count.

### What the runtime does *today*, concretely

- **The relation source is an existing `link`/`context` column, picked per rollup.**
  `selectRollupRelation` (`PropertyValue.tsx:349`) offers only the table's columns
  whose `type` starts with `context` or `link` as the relation `ref`. There is **no
  reserved relation-property name**, no per-DB binding, and no default — *any*
  frontmatter link column can be a relation, exactly as ADR 0024 found for sub-items'
  parent column. The relation itself is just `[[links]]` the user typed into a
  frontmatter property; the relation column is not a separate, special object.
- **The rollup *definition* `{ref, field, fn}` is stored as JSON in the rollup
  column's `value` (a column definition), parsed at render time.** `RollupCell` does
  `safelyParseJSON(props.propertyValue)`; the config menu writes via
  `saveParsedValue` → `props.saveValue(JSON.stringify({ ...parsedValue, [field]: value }))`.
  A Notidian column definition (name, type, and that type's config) lives in the
  context **MDB schema's `cols`** — which **ADR 0001 (row "View layout" / "Formulas
  and aggregates") and ADR 0014 explicitly authorize the MDB to own as
  view/config/cache**. This is *column configuration*, not row data: it stores *how
  to compute*, never the computed value and never the relation links themselves.
- **The relation is strictly one-way; the inverse is computed read-only.** A row's
  frontmatter names its targets via `[[links]]`. The targets' files are **never
  touched** by the rollup or the relation. The "linked from" side is the `backlink`
  field type — computed at render, **writes nothing** (ADR 0024).
- **Dangling and non-numeric values degrade gracefully, today, silently.** A
  link that resolves to nothing returns the original link string (resolver), whose
  `pathsIndex.get(...)` is `undefined` → `resolveFrontmatter` yields `null` → that row
  contributes nothing. `count` still counts the dangling link (it counts *relations*,
  not resolutions); `count_values`/`sum`/etc. skip it. Non-numeric values under a
  numeric fn are dropped by strict `toNumber`; `sum` of nothing is `"0"`, other
  numeric fns of nothing are `""`. There is **no badge, tooltip, or "N unresolved"
  hint** — the number just silently reflects only what resolved.
- **Recompute is live, at render, from the in-memory cache.** `RollupCell`'s value is
  a `useMemo` over `[props.propertyValue, props.row]`, reading current
  `superstate.pathsIndex` frontmatter. `ContextEditorContext` already listens to
  `contextStateUpdated` and rebuilds over `pathsIndex`, so when a linked note's
  frontmatter changes and the index updates, the next render recomputes. There is no
  stored rollup result and **no recompute scheduler** — it is on-render off the cache,
  not a cron/interval and not a persisted materialization.

### The legacy `aggregate` type is the contrast that motivates this whole pillar

`src/schemas/mdb.ts` also defines a separate `aggregate` field type
(`configKeys: ['ref', 'space', 'schema', 'filters', 'field', 'fn', 'format']`). That
is the **Make.md-era MDB-relationship path** — it aggregates over a parallel MDB
*relationship table* keyed by space/schema. The whole point of bead `Notidian-9ln`
("authority inversion off `[[links]]`") was to add `rollup` as the
**frontmatter-link-native** alternative that follows Markdown links and reads the
linked notes' *own* frontmatter, so the relationship is canonical in the `.md`
files, not in a hidden MDB relationship structure. This ADR ratifies that the new
`rollup`/relations path — not the legacy `aggregate` path — is the contract for the
roadmap, and that it stays frontmatter-canonical.

### Constraints any contract must respect

- **C1 — File/frontmatter authority (ADR 0001 / 0014 / 0017).** The relation links
  are *ordinary frontmatter*, canonical in the source note's `.md`. The MDB may store
  only **view/column configuration** (which column is the relation; the rollup's
  `{ref, field, fn}` definition; column order/visibility), never the relationship
  itself and never the rollup *result*. A rollup result or relation link must never
  become a durable MDB-owned row value without an explicit `source: "notidian"`
  marker (ADR 0017) — and neither should, because both are derived/canonical-in-file.
- **C2 — Additive, non-destructive.** No relation or rollup flow may rewrite or
  delete frontmatter the user did not target. (Two-way, if ever offered, writes only
  the one reciprocal property and never clobbers existing values.)
- **C3 — No new authority inversion.** The inverse ("linked from") stays
  computed/read-only (ADR 0024 B1); it must not become a stored, editable list that
  competes with the source's link for authority. The rollup result stays computed,
  never stored.
- **C4 — Perf-bounded.** Rollups read frontmatter only from the in-memory
  `pathsIndex` (no per-render disk read); back-relations are bounded by `inlinks`. No
  full-vault scan.

---

## Question (a) — Relation source property: which frontmatter property, and is the relation type configurable per-DB or per-view?

**Decision needed:** Is the relation source a reserved property name, a per-database
binding, or any link column designated per rollup/view (status quo)?

- **Option A1 — Per-view/per-rollup designation (status quo, recommended).** Any
  frontmatter `link`/`context` column can be the relation source; the rollup names it
  by `ref` and back-relations name it by `ref`. Zero reserved names, zero new
  authority, zero migration of the owner's existing notes, maximum flexibility — and
  identical to the parent-column model ADR 0024 already ratified (A1 there).
- **Option A2 — Fixed reserved relation property name(s).** One convention (e.g.
  `relations`) everywhere; rollups "just work" without per-rollup config. But it
  collides with users' existing property names, forces a migration, and contradicts
  the "any link property is a relation" model the engine already embodies.
- **Option A3 — Per-database default relation with per-view override.** A DB-level
  default relation property, overridable per view. Best long-term ergonomics, but it
  needs a new per-DB config surface (none exists) and a precedence rule — net-new
  scope for a single-user tool.

**Recommended: A1 (per-view/per-rollup designation, status quo).** It is already
shipped, respects C1/C3 (a relation is just a link property — no reserved
authority), needs no migration, and is symmetric with the sub-items decision (ADR
0024 A1). The cheapest correct answer for a personal vault. Revisit A3 only if the
owner finds re-picking the relation column per rollup tedious in practice.

## Question (b) — Where does the rollup *definition* live, under file/frontmatter-canonical authority?

**Decision needed:** The relation *links* are unambiguously frontmatter. But the
rollup *definition* (`{relationProperty/ref, targetProperty/field, fn}`) — the
instruction "aggregate `cost` over the rows my `tasks` column links to, summed" —
must be stored somewhere. Where, without violating ADR 0017?

- **Option B1 — Column definition in the MDB view config (status quo, recommended).**
  The `{ref, field, fn}` JSON lives in the `rollup` column's definition inside the
  context MDB schema's `cols` — exactly where every column's type-config lives. This
  is **view/column configuration**, which ADR 0001 (row "View layout" / "Formulas and
  aggregates") and ADR 0014 *explicitly authorize the MDB to own*. It stores *how to
  compute*, not *what was computed* and not the relation itself; the rollup result is
  always recomputed from frontmatter and never persisted. **No `source: "notidian"`
  marker is needed because no ordinary file-backed *value* is being made
  MDB-durable** — the ADR 0017 trigger is "the MDB silently owning a frontmatter
  *value*," which a compute-definition is not.
- **Option B2 — Rollup definition in the view predicate (per-view).** Move the
  `{ref, field, fn}` into `src/shared/types/predicate.ts` (like `subItems`), so a
  rollup is a per-view overlay rather than a column. More faithful to "per-view," and
  it keeps the column list free of compute columns — but it is a net-new predicate
  shape and a migration of the shipped storage for no authority gain (the MDB owns
  the predicate too; it is the same authority layer).
- **Option B3 — Rollup definition + result in frontmatter of the source note.**
  Materialize the rollup as a real frontmatter property on each row. Maximally
  "file-canonical," and the value survives outside Notidian — but it makes a
  *derived* value a *durable* one (must reconcile on every linked-note change),
  reintroduces the exact stored-derived-value hazard ADR 0001/0017 warn against, and
  writes frontmatter the user did not author. Rejected for the result; the *links*
  already live in frontmatter, which is all that must.

**Recommended: B1 (column definition in MDB view config, status quo).** One-line
why: the rollup definition is *column configuration*, which ADR 0001/0014 already put
in the MDB as a legitimate view/config/cache layer — only a frontmatter *value* made
MDB-durable trips ADR 0017, and a rollup stores none (links stay in frontmatter, the
result is always recomputed). It is shipped, needs no migration, and no new persisted
authority. B2 is a clean refactor if the owner later wants compute columns out of the
column list, but it is the *same* authority layer with no correctness benefit.

## Question (c) — One-way (computed inverse) vs two-way relations?

**Decision needed:** When a row links to targets via a relation property, is the
relationship one-way (the source owns the link; the inverse is computed read-only) or
two-way (the targets also get a reciprocal stored property)?

- **Option C1 — One-way, source owns; inverse is computed read-only (status quo,
  recommended).** The source note's frontmatter names its targets. The targets' files
  are never written. The reverse side is the already-shipped `backlink` field type
  ("linked from"), computed at render from `inlinks`. One authority side, one writer,
  the inverse exists for free. Identical to ADR 0024 B1 for sub-items.
- **Option C2 — Two-way, both sides stored.** Linking A→B also writes B's frontmatter
  with A. Matches Notion's bidirectional feel, but: it writes a file the user did not
  target (tension with C2), creates **two competing authorities** for one fact (which
  wins on conflict? — tension with C3), and needs reconciliation on every
  rename/delete (delete A → must scrub B). High blast radius for a tool that already
  shows the inverse via computed back-relations.
- **Option C3 — One-way default + explicit per-DB opt-in two-way.** Ship C1; add a
  per-DB flag that, when ON, maintains the reciprocal property with full
  reconciliation. Keeps the safe default with a documented door for a power user.

**Recommended: C1 (one-way, source owns; computed inverse) as the default, with C3 as
the documented future opt-in.** One-line why: the inverse already exists as read-only
computed back-relations (ADR 0024), so two-way storage would only *duplicate* a fact
we can derive — adding a second authority and reconciliation burden for no new
information. One writer, additive, non-destructive (C2/C3). This keeps relations and
sub-items symmetric.

## Question (d) — Dangling links and non-numeric values: what does the user see?

**Decision needed:** The engine already degrades gracefully (dangling → contributes
nothing; non-numeric under a numeric fn → dropped). This is purely about
user-visible feedback.

- **Option D1 — Silent-graceful (status quo).** Dangling links and non-numeric values
  silently drop; the number reflects only what resolved/coerced; `count` still counts
  every relation. Robust, zero UI cost — but the user can't tell a `sum` of 5 of 8
  linked rows omitted 3 dangling/non-numeric ones, so the figure can mislead.
- **Option D2 — Silent-graceful + a non-blocking "partial" indicator (recommended).**
  Keep the engine's behavior; when a rollup's resolved/coerced count is less than its
  relation count (some links dangled, or some values were non-numeric under a numeric
  fn), show a small passive marker/tooltip on the cell ("N of M counted —
  K unresolved/non-numeric"). No behavior change, no blocking, no extra computation
  beyond a length the runtime already has. Symmetric with ADR 0024's recommended
  passive cycle indicator (C2 there).
- **Option D3 — Surface dangling links as errors / refuse to display.** Show an error
  state or blank when any link dangles. Most "strict," but it punishes the common,
  legitimate intermediate state (a target not yet created) and fights the
  graceful-degradation the engine was deliberately built for.

**Recommended: D2 (silent-graceful + a passive partial/unresolved indicator), no hard
error.** One-line why: the engine is already correct and safe; the only gap is
*honesty* — a passive marker tells the user the figure is partial without ever
blocking or changing the number, mirroring the cycle-indicator call in ADR 0024.
D1 is acceptable as a strictly-smaller fallback if even a marker is unwanted.

## Question (e) — Recompute timing: live vs on-demand?

**Decision needed:** When does a rollup recompute — every render off the live cache,
or on an explicit/throttled trigger?

- **Option E1 — Live, on-render off the in-memory cache (status quo, recommended).**
  `RollupCell` memoizes on `[propertyValue, row]` and reads current `pathsIndex`
  frontmatter; `ContextEditorContext` already rebuilds on `contextStateUpdated`, so a
  linked note's frontmatter change recomputes on the next render. No stored result, no
  scheduler. Always correct, perf-bounded by C4 (cache reads only), zero new
  machinery.
- **Option E2 — On-demand / manual refresh.** Compute once, cache the result, refresh
  on an explicit user action or interval. Cheaper per render for huge tables, but it
  introduces a *stored derived value* (tension with C1/C3 and ADR 0001's
  "recompute, don't treat as durable user data") and a staleness window, for a saving
  that does not exist today (the read is an in-memory map lookup, not disk).
- **Option E3 — Live + memo invalidation keyed on the linked rows' frontmatter
  version.** E1 plus a finer dependency so the memo only recomputes when *relevant*
  frontmatter changed, not on every parent re-render. A pure optimization to defer
  until profiling shows a real cost; it changes no contract.

**Recommended: E1 (live, on-render off the cache).** One-line why: the rollup is a
computed value (ADR 0001: "recompute and display; do not treat as durable user
data"), the read is an in-memory lookup so there is no perf cliff to optimize away,
and any stored result would reintroduce staleness + a derived-authority hazard for no
real saving. E3 is the right *future* optimization (pure, contract-preserving) if a
very large table profiles slow; E2 is rejected as a stored-derived-value regression.

---

## Consequences

- **If accepted as recommended (A1 / B1 / C1 + C3-later / D2 / E1):** the relations +
  rollups pillar is **contract-complete with almost no new code** — the engine,
  runtime, cell, column type, and config menu already implement A1/B1/C1/E1 and the
  graceful core of D2. The *only* new work is small and safe: the passive
  partial/unresolved indicator (D2) — a cell badge/tooltip driven by counts the
  runtime already has, with **no new innerHTML sink** (CSS/text only, per the
  sanitize invariant ADR 0017/0019). Two-way (C3) is deferred behind an explicit
  per-DB opt-in only if the owner asks. No frontmatter the user didn't author is ever
  written; no derived value becomes durable; no migration of existing notes.
- **The contract is the gate, not the engine.** This decision ratifies the shipped
  authority model and unblocks the thin D2 UX layer (a follow-up implementation bead)
  without gambling quota on the wrong product direction, and it makes relations
  symmetric with the sub-items contract (ADR 0024).

## Ruled-out alternatives (summary)

- **Reserved relation property name (A2).** Forces migration and collides with the
  "any link property is a relation" model; flexibility lost for no gain.
- **Rollup definition or result materialized in source-note frontmatter (B3).** Makes
  a derived value durable — the exact stored-derived-value hazard ADR 0001/0017 warn
  against — and writes frontmatter the user did not author. The *links* already live
  in frontmatter, which is all that must.
- **Two-way reciprocal storage by default (C2).** Duplicates a fact already derivable
  from computed back-relations, creates two competing authorities, and forces
  rename/delete reconciliation — violates C2/C3 for no new information.
- **Error-on-dangling / refuse-to-display (D3).** Punishes the legitimate "target not
  yet created" state and fights the engine's deliberate graceful degradation.
- **Stored/cached rollup result with manual or interval refresh (E2).** Reintroduces a
  durable derived value and a staleness window (contra ADR 0001) for a saving that
  does not exist (the read is an in-memory map lookup, not disk).
- **The legacy `aggregate` MDB-relationship path as the roadmap contract.** Rejected
  in favor of the frontmatter-link `rollup` path — that authority inversion (off
  `[[links]]`, reading linked notes' own frontmatter) was the whole point of bead
  `Notidian-9ln` and keeps the relationship canonical in the `.md` files.

## Cross-links

- Epic: bd `Notidian-2w0` (Notion-parity roadmap), item (1).
- This decision: bd `Notidian-tni` (stays OPEN awaiting the owner's pick).
- Shipped engine/runtime: `Notidian-9ln` (capstone), `Notidian-8pl` (runtime + cell +
  column type + config menu), `Notidian-e1u` (shared link resolver), `Notidian-ahk`
  (back-relations).
- Code: `src/core/utils/contexts/tableRollup.ts`
  (`parseRelationLinks`, `computeFrontmatterRollup`, `RollupConfig`),
  `src/core/utils/contexts/tableRollupRuntime.ts` (`computeRowRollup`),
  `src/core/utils/contexts/relationResolver.ts` (`makeRelationLinkResolver`),
  `src/core/utils/contexts/tableBackRelations.ts` (`filterBackRelations`),
  `src/core/react/components/SpaceView/Contexts/DataTypeView/RollupCell.tsx`,
  `src/core/react/components/UI/Menus/contexts/PropertyValue.tsx`
  (`selectRollupRelation`/`selectRollupProperty`/`selectRollupFn`),
  `src/schemas/mdb.ts` (`rollup` + `backlink` field types; the legacy `aggregate`
  type for contrast).
- Sibling contract: ADR 0024 (sub-items + back-relations UX — same resolver, same
  one-way + computed-inverse + per-view-designation recommendations).
- Authority basis: ADR 0001 (authority-partitioned model; "Formulas and aggregates =
  computed, not durable"; MDB owns view layout), ADR 0014 (Notidian-only engine; MDB
  must not silently own frontmatter values), ADR 0017 (explicit `source: "notidian"`
  for durable MDB ownership).
