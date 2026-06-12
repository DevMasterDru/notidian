# Quick Find (in-table) — Design

**bd:** Notidian-r20 · **Epic:** Notidian-2w0 · **Date:** 2026-06-12 · **Status:** approved

## Problem

Today the table toolbar search (`SearchBar` → `searchString`) **hides** non-matching rows (`ContextEditorContext.tsx` filter, `matchAny` over joined non-`_` field values). Notion's database search instead **highlights and navigates** without hiding. Users want both: filter (narrow the set) and find (locate within the set).

## Decisions (chosen)

1. **Augment, don't replace.** Keep the filter-search as-is; add a separate quick-find. Two distinct affordances.
2. **Trigger:** `Cmd/Ctrl+F` when the table view is focused (free — Obsidian's editor find only binds inside markdown editors, not custom views) **and** a `⌕` find button in the filter bar. `Escape` closes and clears.
3. **Match scope:** all **filtered** rows (the filtered array is already fully in memory; pagination only limits the DOM). Count is true `n of m`. Navigating to an off-screen match bumps pagination to load it, then scrolls into view.
4. **Match definition:** case-insensitive substring. v1: no regex, no case toggle (YAGNI). Over all **visible** columns (respecting `colsHidden`) including the primary/title value. **`password`-type columns excluded** (security: otherwise find is an oracle to confirm masked-secret substrings).
5. **Navigation UX:** floating bar at the table's top-right with input, `n of m`, `‹ ›`, `×`. `Enter` = next, `Shift+Enter` = prev, wraparound. Active match gets a distinct highlight + `scrollIntoView`. Changing the query resets the active match to the first.

## Architecture (units)

| Unit | Responsibility |
| --- | --- |
| `core/utils/contexts/tableQuickFind.ts` *(pure, tested)* | `computeQuickFindMatches({rows, cols, hiddenColumnIds, query})` → ordered `QuickFindMatch[]` (`{rowIndex, colKey}`), excluding password + hidden columns; `stepMatchIndex(count, current, dir)` wraparound nav; `pageSizeToRevealRow(rowIndex, pageSize, currentPageSize)` → page size needed to render an off-screen row |
| `core/react/components/SpaceView/Contexts/TableView/QuickFindBar.tsx` *(presentational)* | floating overlay UI; pure props/callbacks |
| `TableView.tsx` | local find state (open/query/activeIndex); `useMemo` matches via helper; `Cmd/Ctrl+F` + `Escape` handlers; `useEffect` on active match → reveal (pagination bump) + `scrollIntoView`; applies `mk-cell-find-match` / `mk-cell-find-active` cell classes; renders `QuickFindBar` |
| `FilterBar.tsx` | the `⌕` find button → toggles shared `findOpen` |
| `ContextEditorContext.tsx` | one shared `findOpen` / `setFindOpen` toggle (mirrors how `searchString` is shared today) so the FilterBar button and the table's `Cmd/Ctrl+F` open the same bar |
| `TableView.css` | match / active-match cell highlight + find-bar styling |

**Why this split:** find state lives in `TableView` because it already holds the filtered rows, pagination, and DOM needed to highlight/scroll; only the *open* toggle is shared. Rejected: computing matches in `ContextEditorContext` (would need to reach into pagination/DOM); a separate search index (the array is already in memory — matching is a cheap scan).

## Data flow

`query` → `computeQuickFindMatches(filtered rows, visible non-password cols, query)` → ordered matches → `n of m` in the bar; `activeIndex` selects the active match → `useEffect` ensures pagination renders that row and scrolls to it; cell render applies highlight classes by membership in the match set / active match.

## Authority / safety

View-layer only. No frontmatter, file, or context-MDB writes. Password columns excluded from matching. Filter-search behavior unchanged and composable (find runs over whatever the filter leaves visible).

## Testing

Pure helper unit tests: ordering (row-major then column order); case-insensitivity; password + hidden exclusion; empty/short query → no matches; multiple matches per row; nav wraparound (`stepMatchIndex`); reveal-page math (`pageSizeToRevealRow`). React wiring (hotkey/scroll/pagination) is out of Jest (consistent with Notidian-3dv: provider-level React tests aren't runnable in the node env) and is verified live in the vault.
