# ADR 0021: In-Table Quick Find (Highlight + Navigate, Not Row-Hide)

## Status

**Accepted (historical).** Later **consolidated by ADR 0041** and its dormant
apparatus **removed outright by ADR 0049** — the quick-find highlight engine no
longer ships. Retained for the decision trail (see the ADR index Historical Records).

**Accepted** — the design described here was approved and **already shipped**.

This ADR documents a decision the codebase has already implemented; it is recorded
after the fact for the decision trail, not as a build proposal. Epic item (5) of
[bd `Notidian-2w0`](#cross-links) ("in-table quick find with highlighted match
navigation vs current row-hide filter") was decomposed into child bead **`Notidian-r20`**,
which is **CLOSED** (shipped 2026-06-12: Cmd/Ctrl+F highlight + navigate,
off-screen reveal, password/hidden columns excluded, Codex-reviewed with 4 findings
fixed, 399 tests / tsc / build green). The approved design spec is
[`docs/superpowers/specs/2026-06-12-quick-find-design.md`](../superpowers/specs/2026-06-12-quick-find-design.md).

The autonomous loop was tasked to write a *Proposed* options ADR for this item.
On investigation the feature was found already designed, implemented, tested, and
merged — so proposing options to build it would be fiction. The honest decision
artifact is this record of the accepted design plus the **one genuinely-open
follow-up** that does need an owner direction (see
[Open follow-up](#open-follow-up-quick-find-under-true-row-virtualization)).

## Date

2026-06-15

## Context

The table toolbar already had a **filter-search** (`SearchBar` → `searchString`,
applied in the context editor): typing **hides** non-matching rows. Notion's
database search does the opposite — it **highlights and navigates** matches
*without* hiding rows. Users want both affordances: *filter* to narrow the working
set, *find* to locate a value within whatever set is on screen.

The relevant code surfaces:

- The filtered row array is already fully in memory; pagination only limits how
  many rows reach the DOM (the assemble-before-pagination behavior parked in
  [`Notidian-8h9`](#cross-links)).
- Cell highlighting and scroll need access to pagination and the rendered DOM,
  which live in `TableView.tsx`.
- ADR 0017 ([Explicit Notidian Ownership](0017-explicit-notidian-ownership.md))
  and the security sink work (`src/shared/utils/sanitize.ts`) establish a hard
  invariant: any `innerHTML` of vault-derived text must be routed through a
  sanitizer. The cheapest way to honor that invariant is to **introduce no new
  `innerHTML` sink at all.**

## Decision

Add a **separate, additive quick-find** to the table view, view-layer only,
distinct from the row-hide filter-search. The specific choices (all implemented):

### (a) Interaction model — additive find that coexists with active filters

Keep the row-hide filter-search ([`Notidian-ddk`](#cross-links) toolbar) exactly
as is. Quick find is a **second, independent affordance** that **highlights and
navigates** and **never hides rows**. It searches **only the rows the filter
leaves visible** — `computeQuickFindMatches` runs over the already-filtered `data`
array, so find and filter compose: filter narrows, find locates within the
narrowed set, true `n of m` count.

- **Trigger:** `Cmd/Ctrl+F` while the table view is focused (free — Obsidian's
  editor find binds only inside markdown editors, not custom views) **and** a `⌕`
  button in the filter bar (`mk-quick-find-toggle`). Both toggle one shared
  `findOpen` state. `Escape` closes and clears.
- **Bar UX:** floating `QuickFindBar` at the table's top-right — input, `n of m`,
  `↑ ↓`, `✕`. `Enter` = next, `Shift+Enter` = prev, with wraparound. Changing the
  query resets the active match to the first.

### (b) Match scope — visible rendered cell text (WYSIWYG)

Matching is over the **rendered/parsed cell value text** (`cellText` over each
row's column value), not raw frontmatter keys — so what the user sees is what they
search. Case-insensitive substring; v1 has no regex and no case toggle (YAGNI).

- **`password`-type columns are excluded** — otherwise find becomes an oracle that
  confirms substrings of a masked secret.
- **Hidden columns** (`predicate.colsHidden`) are excluded — they have no visible
  cell to highlight.

### (c) Highlight rendering — no `innerHTML` sink (the preferred path in the task)

The active and matched cells are highlighted by toggling **cell-level CSS
classes** on the `<td>` — `mk-cell-find-match` and `mk-cell-find-active`
(`src/css/SpaceViewer/TableView.css`). There is **no `innerHTML` and no
text-node splitting** to insert `<mark>` spans. This is the strongest possible
compliance with the ADR 0017 / sanitize invariant: the invariant is satisfied by
**avoidance** — no new sink to sanitize. (The known cost is sub-string granularity:
the whole matching cell is highlighted, not the exact substring. Accepted as a
v1 tradeoff; see [Consequences](#consequences).)

### (d) Match navigation + scroll-into-view, and virtualization interaction

Navigating to an **off-screen** match grows pagination so the row renders, then
`scrollIntoView`s the active cell:

- Flat case: `pageSizeToRevealRow(rowIndex, pageSize, currentPageSize)` rounds the
  page size up to the smallest multiple that renders the target row, never
  shrinking the current page.
- Grouping active: synthetic group-header rows make flat-index math unreliable, so
  it loads all rows (find is an explicit action; grouped tables are typically
  small) to guarantee the active cell renders. A short retry covers the frame
  where pagination just changed.

This reveal strategy is **coupled to the current pagination model**. Notidian's
table is pagination-only today; true row virtualization is parked in
[`Notidian-8h9`](#cross-links). When that lands, the "grow pageSize to reveal"
mechanism must change to "scroll the virtualizer to the row index" — see
[Open follow-up](#open-follow-up-quick-find-under-true-row-virtualization).

### Architecture (as built)

| Unit | Responsibility |
| --- | --- |
| `src/core/utils/contexts/tableQuickFind.ts` *(pure, unit-tested)* | `computeQuickFindMatches` → ordered `QuickFindMatch[]` (row-major then column order), excluding password + hidden columns; `stepMatchIndex` wraparound nav; `pageSizeToRevealRow` reveal math |
| `.../TableView/QuickFindBar.tsx` *(presentational)* | floating bar UI; pure props/callbacks, owns no match state |
| `TableView.tsx` | find state (open/query/activeIndex); `useMemo` matches; hotkey + reveal/scroll effects; applies the two cell classes |
| `FilterBar.tsx` | `⌕` button toggling the shared `findOpen` |
| context editor | one shared `findOpen`/`setFindOpen` toggle (mirrors how `searchString` is shared) |

## Why This Is The Best Fit

**Additive find that coexists with filters, matching rendered cell text, with no
new `innerHTML` sink** is the lowest-risk, highest-fidelity design: it preserves
the existing filter behavior unchanged, gives WYSIWYG matching, and honors the
ADR 0017 sanitize invariant for free by never building a sink — exactly the three
recommendations the decision question framed.

## Alternatives Considered (ruled out)

### Replace the row-hide filter with highlight-only find

Rejected. Filter (narrow the set) and find (locate within it) are distinct user
needs; collapsing them would remove the ability to *reduce* the visible set. Two
affordances, composable, is what users want.

### Match raw frontmatter values instead of rendered cell text

Rejected. Find should match what the user sees. Searching raw YAML would surface
hits in cells the user can't visually locate and would diverge from the displayed
text (formatted dates, resolved links, option labels).

### Highlight the exact substring via `innerHTML` (`<mark>`) — even if sanitized

Rejected for v1. It is the only path that would touch an HTML sink, and ADR 0017 /
the sanitize work make any new sink a liability that must be sanitized and
maintained. Cell-level highlighting avoids the sink entirely. (React text-node
splitting into `<mark>` spans — sink-free but more invasive per cell renderer — is
the upgrade path if substring-precise highlighting is later wanted; see below.)

### Build a separate search index

Rejected. The filtered row array is already in memory; matching is a cheap linear
scan. An index would add state to keep in sync for no benefit at vault scale.

### Compute matches in the context editor rather than `TableView`

Rejected. Highlight + scroll need pagination and the rendered DOM, which live in
`TableView`. Only the *open* toggle is shared upward; match computation stays where
the rows and DOM are.

## Open follow-up (quick find under true row virtualization)

This is the **one item that genuinely needs an owner direction**, and the only
reason this ADR is on the review queue.

The current off-screen-reveal mechanism (`pageSizeToRevealRow` + grow `pageSize`)
is bound to the pagination model. If/when [`Notidian-8h9`](#cross-links) replaces
pagination with `@tanstack/react-virtual` row virtualization, revealing a match
must change to **`virtualizer.scrollToIndex(rowIndex)`** (then await mount, then
`scrollIntoView` the cell). Two viable directions:

- **Recommended:** fold the quick-find reveal change **into the `Notidian-8h9`
  virtualization work** as an explicit acceptance criterion (reveal an off-screen
  match by scrolling the virtualizer, not by growing a page) — so find never
  regresses the day virtualization lands. One-line why: the two are the same DOM
  concern; doing them together avoids a window where find silently can't reach
  off-screen matches.
- Alternative: ship virtualization first and treat quick-find reveal as a
  fast-follow fix. Cheaper per-PR but leaves a regression window.

No code is needed now; this is a sequencing decision for whenever `8h9` is taken
up.

## Consequences

Positive:

- Filter and find compose; neither's behavior changed the other.
- WYSIWYG matching; no new authority or security surface (view-layer only, no
  frontmatter/file/MDB writes, no new `innerHTML` sink).
- Password and hidden columns can't be probed via find.

Tradeoffs:

- **Cell-granular, not substring-granular** highlight: the whole matching cell is
  marked, not the exact matched span. Upgrade path is React text-node splitting
  into `<mark>` (still sink-free) if precision is later wanted.
- The reveal mechanism is **pagination-coupled** and must be migrated when row
  virtualization lands (the open follow-up above).
- v1 is substring-only (no regex, no case toggle) — deliberate YAGNI.

## Cross-links

- **Epic:** bd `Notidian-2w0` (Notion-parity roadmap), item (5).
- **Implementation child:** bd `Notidian-r20` (CLOSED — shipped 2026-06-12).
- **Coexisting filter toolbar:** bd `Notidian-ddk` (inline Filter/Sort buttons).
- **Virtualization (open follow-up):** bd `Notidian-8h9` (row virtualization).
- **Authority / sink invariant:** [ADR 0014](0014-notidian-only-personal-database-engine.md),
  [ADR 0017](0017-explicit-notidian-ownership.md), `src/shared/utils/sanitize.ts`.
- **Approved design spec:** `docs/superpowers/specs/2026-06-12-quick-find-design.md`.
