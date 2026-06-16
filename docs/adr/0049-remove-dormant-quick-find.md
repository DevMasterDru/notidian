# ADR 0049: Remove the Dormant Quick-Find Apparatus

> Note: this decision was requested as "ADR 0042", but `0042` was already taken by
> `0042-nativetounified-empty-input-contract.md`; allocated the next free number
> **0049** to keep ADR numbers unique.

## Status

**Accepted** — executed per explicit owner request (bd `Notidian-fws1`).

**Supersedes [ADR 0041](0041-consolidate-view-search-affordances.md)'s
keep-dormant sub-decision.** ADR 0041 consolidated the table view to one search
affordance and *kept* the highlight-on-match quick-find engine
(`QuickFindBar.tsx`, `tableQuickFind.ts`, the `findOpen` state, the cell-class
highlight + reveal math) **dormant, not deleted**, on the theory that the tested
capability could later be folded back in as a search *mode* (sub-variant A1). The
owner has now explicitly directed: *remove the redundant find affordance.* This
ADR records that the dormant engine was deleted outright. ADR 0041's
consolidation (one search, `Cmd/Ctrl+F` → `setSearchActive`, no standalone `⌕`
button) stands unchanged; only its keep-dormant clause is superseded.

This is an **executed decision, not a decision-that-waits** — the owner made the
product call, the change is offline-verifiable (tsc/jest/build), and it shipped in
the same session.

## Date

2026-06-16

## Context

After ADR 0041, the standalone `⌕` quick-find toolbar button was already removed
and `Cmd/Ctrl+F` was rebound to open the one consolidated filter-search
(`SearchBar`, via `setSearchActive(true)`). The only remaining entry point to the
quick-find engine was `setFindOpen(true)`.

Verified by grep over `src/` **before** removal: **`setFindOpen(true)` is never
called anywhere.** The `findOpen` flag could only ever be `false`, so:

- `<QuickFindBar>` (carrying the literal placeholder **"Find in view"** the owner
  objected to) **never rendered**;
- `computeQuickFindMatches` / `stepMatchIndex` / `pageSizeToRevealRow` in
  `tableQuickFind.ts` were never reached from production;
- the `mk-cell-find-match` / `mk-cell-find-active` cell highlights and the
  `data-find-active` reveal-scroll effect were dead;
- the `findOpen` / `setFindOpen` members on `ContextEditorContext` were inert.

The apparatus was **fully unreachable dead code** — an attractive nuisance and a
stale "Find in view" string contradicting the one-search consolidation the owner
asked for. The "re-enable-only follow-up" that ADR 0041 preserved it for never
materialized, and the owner has now ruled against it.

### Authority / sink invariants (unaffected)

The quick-find engine was **view-layer only** (ADR 0001/0014/0017): `findOpen` was
ephemeral UI state that never touched frontmatter, files, or the context MDB, and
the highlight used **cell-level CSS classes, no `innerHTML`/SVG sink** (ADR 0017 /
`sanitize.ts`). Deleting it removes view-layer code only; it changes no authority
boundary and removes (not adds) UI surface — so there is no new sink to route.

## Decision

**Delete the dormant quick-find apparatus cleanly — no dead code.**

Removed:

- `src/core/react/components/SpaceView/Contexts/TableView/QuickFindBar.tsx` (the
  "Find in view" floating bar).
- `src/core/utils/contexts/tableQuickFind.ts` (`computeQuickFindMatches`,
  `stepMatchIndex`, `pageSizeToRevealRow`) and its test
  `src/core/utils/contexts/tableQuickFind.test.ts`.
- In `TableView.tsx`: the `tableQuickFind` + `QuickFindBar` imports; the
  `findOpen` / `setFindOpen` context destructure; the `findQuery` /
  `findActiveIndex` state; the `findMatches` / `findActiveClamped` /
  `findActiveMatch` / `findMatchKeys` / `findActiveKey` memos; the query/close
  reset effects; the reveal/scroll effect; `stepFind`; `closeFind`; the
  `<QuickFindBar>` render block; and the per-cell `isFindMatch` / `isFindActive`
  highlight logic (`data-find-active` attribute and the
  `mk-cell-find-match` / `mk-cell-find-active` classes).
- In `ContextEditorContext.tsx`: the `findOpen` / `setFindOpen` type members,
  defaults, `useState`, provider passthrough, and the explanatory dormancy
  comment.
- In `src/css/SpaceViewer/TableView.css`: the `.mk-quick-find*` and
  `.mk-td.mk-cell-find-*` rules.
- The stale `setFindOpen` stubs in `FilterBar.anchor.dom.test.tsx`.

Kept (the live consolidated search — do not regress):

- `SearchBar.tsx` and its focus-on-mount (bd `Notidian-z8q`, cc850ef) plus
  `SearchBar.focus.dom.test.tsx`.
- The magnifier toggle `mk-view-search-toggle` in `FilterBar.tsx`.
- `searchActive` / `setSearchActive` on `ContextEditorContext`.
- The `Cmd/Ctrl+F` path in `TableView.onKeyDown` → `setSearchActive(true)`.
- The `FilterBar.anchor.dom.test.tsx` assertion that `.mk-quick-find-toggle` is
  `null` — it correctly continues to prove the standalone control is gone.

### Why delete now (not keep dormant)

- **The owner asked for it.** "Remove the redundant find affordance" is the
  product call ADR 0041 left open; it is now made.
- **It was unreachable dead code**, not a behind-a-flag capability — grep proves
  `setFindOpen(true)` had no callers, so nothing regresses (verified by grep
  before *and* after, plus green jest/tsc/build).
- **Re-adding is cheap from git** if a future "highlight matches" mode is wanted
  (ADR 0041 sub-variant A1) — the deleted engine lives in history and could be
  rebuilt against the one search box, which is the better integration point than
  reviving a second floating bar.

## Consequences

- The table view exposes exactly one in-view search: the filter-search, opened by
  the magnifier or `Cmd/Ctrl+F`. The "Find in view" string and the second
  search-shaped control are gone — directly resolving the owner's redundancy
  complaint at the source.
- The highlight-in-place (Notion-parity) behavior ADR 0041 noted as the A1 upside
  is **not present**; if the owner later wants it, it returns as a *mode of the
  one search* (a fresh build informed by ADR 0021's tested matcher in git
  history), not by reviving this dormant bar.
- Test count drops by the `tableQuickFind.test.ts` suite; no production behavior
  changes (the deleted path never executed).

## Cross-links

- **Supersedes:** [ADR 0041](0041-consolidate-view-search-affordances.md)
  (consolidation kept; its keep-dormant sub-decision is replaced by this
  deletion).
- **Original quick-find design (now removed):**
  [ADR 0021](0021-in-table-quick-find.md) (bd `Notidian-r20`, shipped then
  consolidated out, now deleted).
- **Live search that stays:** `SearchBar.tsx`; `searchActive` in
  `ContextEditorContext.tsx`; the magnifier `mk-view-search-toggle` and the
  `Cmd/Ctrl+F` → `setSearchActive` path in `FilterBar.tsx` / `TableView.tsx`.
- **Bead:** `Notidian-fws1`.
- **Authority + sink invariants (unchanged):**
  [ADR 0001](0001-authority-partitioned-database-model.md),
  [ADR 0014](0014-notidian-only-personal-database-engine.md),
  [ADR 0017](0017-explicit-notidian-ownership.md), `src/shared/utils/sanitize.ts`.
