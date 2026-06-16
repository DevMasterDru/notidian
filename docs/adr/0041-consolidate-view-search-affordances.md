# ADR 0041: Consolidate the View Search Affordances — Filter-Search vs Cmd/F Quick-Find

## Status

**Accepted** — implemented per owner-directed realignment (bd `Notidian-z8q`).

> **Update (ADR 0049):** the **keep-dormant** sub-decision below — preserving the
> highlight-on-match engine (`QuickFindBar.tsx`, `tableQuickFind.ts`, the cell
> classes, the reveal math) as a re-enable-only A1 follow-up — is **superseded by
> [ADR 0049](0049-remove-dormant-quick-find.md)**, which deleted that
> now-unreachable apparatus outright at the owner's explicit request. The rest of
> this ADR (one consolidated search; `Cmd/Ctrl+F` → `setSearchActive`; the
> standalone `⌕` button removed) **still stands**.

The owner directed the realignment cleanup to implement the recommended Option A
directly (the report — "Find in view" is redundant and "doesn't work" — settled
the product question), so this ADR was ratified and built rather than left
awaiting per-spec review. **Shipped variant:** plain consolidation (the cleanly
offline-verifiable realization of Option A). The filter-search ("Type to
search…", `SearchBar`) is now the **single** view search affordance,
`Cmd/Ctrl+F` is rebound to open it, and the standalone `⌕` quick-find toolbar
button is **removed**. The highlight-on-match engine (`tableQuickFind.ts`,
`QuickFindBar.tsx`, the cell-class highlight + reveal math) is kept **dormant**,
not deleted — sub-variant **A1** (fold highlight in as a *mode* of the one
search) merges two render trees (the FilterBar toolbar input vs the in-table
floating bar) and is render-path UI that cannot be offline-verified, so per the
realignment's "prefer a coherent shipped consolidation the owner can use
immediately" guidance it was deferred: the dormant engine + shared `searchActive`
toggle leave A1 a small, re-enable-only follow-up rather than a rebuild.

> Original (pre-implementation) status was **Proposed** — a decision artifact
> with options + a recommendation + a parallel live-repro action, written when
> the product shape was treated as still-open and the quick-find defect was
> unconfirmed offline.

## Date

2026-06-15

## Context

### The owner's report

The owner reports that the table toolbar's **"Find in view"** button "seems
redundant" — it sits next to a similar **"Type to search"** affordance — and that
it "doesn't work."

### What actually ships today (read-only investigation, all verified in source)

The table toolbar (`FilterBar.tsx`, the `mk-view-options` div) renders **two
distinct, adjacent search controls**:

| | Filter-search (`SearchBar`) | Quick-find (`QuickFindBar`) |
| --- | --- | --- |
| Toolbar control | magnifier sticker `ui//search` (`FilterBar.tsx:1735`) toggling `searchActive` | `⌕` button `mk-quick-find-toggle` (`FilterBar.tsx:1757-1767`) toggling shared `findOpen` |
| Label the user sees | placeholder **"Type to search..."** (`searchPlaceholder`, `src/shared/en.ts:657`; `SearchBar.tsx:32`) | `aria-label`/`title` **"Find in view (⌘/Ctrl+F)"** (`FilterBar.tsx:1759-1760`); input placeholder **"Find in view"** (`QuickFindBar.tsx:55`) |
| What it does | **FILTERS / hides** non-matching rows — sets `searchString`, applied in `ContextEditorContext.tsx:691-712` via `matchAny(searchString)` over every column | **HIGHLIGHTS + navigates** matches (`mk-cell-find-match`/`mk-cell-find-active` CSS classes); **never hides** rows; `n/m` count, `↑ ↓`, wraparound |
| Trigger | click the magnifier (inline input on desktop; phone variant at `FilterBar.tsx:1855`) | `⌕` button **and** `Cmd/Ctrl+F` while the table is focused (`TableView.tsx:854-863` → `setFindOpen(true)`) |
| Logic | `matchAny` filter in the context editor | `computeQuickFindMatches` (`tableQuickFind.ts`, pure, unit-tested); state in `TableView.tsx:494-541` |
| Provenance | long-standing filter toolbar (`Notidian-ddk`) | ADR 0021 / `Notidian-r20`, **shipped 2026-06-12, never owner-live-verified** |

So the two are **technically complementary** — *filter to narrow the working set*
vs *find to locate a value within whatever set is on screen* (exactly the framing
ADR 0021 §(a) used to justify shipping them side by side). But in the toolbar they
**present as redundant twins**: two magnifier-class controls, immediately adjacent,
with near-identical labels ("Type to **search**" / "**Find** in view"). The
distinction (one hides rows, one highlights without hiding) is invisible from the
labels — which is precisely the owner's "redundant" complaint.

### Notion parity (the product north-star)

Notion's database header has **one** in-view search affordance — a single
magnifier that, when you type, **highlights and scrolls to** matches *without*
hiding rows. Filtering rows is a **separate, explicit "Filter" pill/menu**, not a
free-text search box. So Notion's model is: **one free-text search = find
(highlight), and structured filtering is its own named surface** — which Notidian
*already has* as the on-bar **Filter** button (`FilterBar.tsx:1774-1792`,
`predicate.filters`). Measured against parity, Notidian today has **two** free-text
search boxes where Notion has one, and one of them (the row-hide free-text search)
has **no Notion analogue at all** — Notion never offers free-text *row-hiding*; it
offers structured filters.

### The defect claim — unverifiable offline

The owner says quick-find "doesn't work." Offline review **cannot confirm a
defect**: the matching logic (`computeQuickFindMatches`) is pure and unit-tested
(`tableQuickFind.test.ts`), and the failure surface is the **render path** —
whether `Cmd/F` actually opens the bar, whether the cell CSS classes actually
highlight, whether off-screen reveal actually scrolls — none of which tsc/jest/build
can prove. Plausible offline-invisible causes: a hotkey swallowed by another
handler before `TableView.onKeyDown` (the table must be focused for the binding to
fire — `TableView.tsx:850`), a CSS class not visibly styled in the owner's theme,
or the bar opening but matches not computing for that view's column types. This is
an **UNVERIFIABLE OFFLINE** condition, recorded below as a separate live-repro
action that must run **regardless of which consolidation option is chosen** — and
which may itself inform the choice.

### Constraints that bound the options

- **Authority (ADR 0001/0014/0017):** both affordances are **view-layer only** —
  `searchString` and `findOpen` are ephemeral UI state, neither writes frontmatter,
  files, or MDB. Any consolidation must stay view-layer; it must not introduce a
  durable field.
- **Sink invariant (ADR 0017 / `sanitize.ts`):** quick-find deliberately uses
  **cell-level CSS classes, no new `innerHTML` sink** (ADR 0021 §(c)). Any
  consolidation must preserve "no new sink" — in particular, keeping highlight as a
  mode must keep the class-toggle approach, not introduce `<mark>` injection.
- **Don't regress a shipped, tested capability silently.** Quick-find passed a
  Codex review with 4 findings fixed and 399 tests green (ADR 0021). Removing it is
  a real capability decision, not cleanup.

## Decision Question

**Should the table view expose ONE in-view search affordance, or TWO?**

If one: which behavior is primary (filter-and-hide, or find-and-highlight), and
what happens to the other behavior and to `Cmd/F`?

## Options

### Option A (RECOMMENDED) — Consolidate to one toolbar search; bind Cmd/F to it; retire the separate quick-find button

Make the **filter-search ("Type to search") the single primary toolbar search**
affordance, **bind `Cmd/Ctrl+F` to it** (instead of to quick-find), and **remove
the separate `⌕` quick-find toolbar button.**

Two sub-variants for what happens to the *highlight* behavior the user loses by
collapsing — decide between them when picking A:

- **A1 — fold highlight in as a mode of the one search (recommended sub-variant).**
  The single search box, while typing, *both* narrows (or doesn't — see note) *and*
  exposes the existing `↑ ↓ / n of m` navigation + cell highlight. Cleanest
  realization: the one search **highlights + navigates by default** (the Notion
  behavior) and a small inline toggle (or a secondary control) switches it to
  **filter/hide** mode. This **keeps the tested `computeQuickFindMatches` +
  cell-class highlight engine** (no sink added) and **keeps the filter engine** —
  it just merges the *two entry points* into one box with one well-labelled mode
  switch, killing the "redundant twins" perception while losing no capability.
- **A2 — retire highlight entirely; the one search just filters.** Simplest: the
  single box hides non-matching rows (today's `searchString`), `Cmd/F` opens it,
  and the quick-find engine (`tableQuickFind.ts`, `QuickFindBar.tsx`, the cell
  classes, the reveal math) is **deleted**. Smallest surface, but it **drops a
  shipped capability** (highlight-in-place, which is the *Notion-parity* behavior)
  and moves Notidian *away* from parity, not toward it. Pick A2 only if the live
  repro shows highlight is genuinely broken **and** not worth fixing.

**Trade-offs (A):** Resolves the owner's redundancy complaint directly — one search
control, one label, one shortcut. A1 preserves both capabilities behind one entry
point and is the only sub-variant that moves *toward* Notion parity (one box,
highlight-first, separate structured Filter already exists). A2 is the least code
but the only one that regresses a tested feature and parity. The cost of A is the
UI rework of the search box (mode toggle for A1, or deletion + Cmd/F rebind for
A2) and re-pointing the `Cmd/F` handler from `setFindOpen` to the search box.

**One-line why A is recommended:** it is the only option that *eliminates the
redundancy the owner reported* (rather than relabelling it away), and A1 in
particular reaches Notion parity — one in-view search, highlight-first, with
structured filtering kept as its own already-shipped surface.

### Option B (RULED OUT) — Keep both; just relabel/disambiguate

Keep the two adjacent controls but make their distinct purposes obvious — e.g.
rename "Type to search" → "Filter rows" and "Find in view" → "Highlight matches",
add tooltips/icons that visually separate filter-icon vs find-icon.

**Why ruled out:** It treats a **product-shape** problem as a **copy** problem. The
owner's complaint is not "I can't tell them apart" — it is "this is redundant." Two
free-text search boxes in one toolbar is one more than Notion has and one more than
the mental model wants; better labels reduce confusion but **leave the redundancy
the owner objected to in place**, and still present two search-shaped controls where
parity calls for one. Relabelling is also strictly dominated by A1, which keeps both
*behaviors* while removing the redundant *control*.

### Option C — Make quick-find primary; demote/keep filter as the Notion "Filter" surface only

Inverse of A: make **find-and-highlight the one free-text search** (keep `Cmd/F`
on it, keep the `⌕`/magnifier as the single search button), and **remove the
free-text *row-hide* search** entirely — row reduction is done only through the
existing structured **Filter** button (`predicate.filters`), exactly as Notion does.

**Trade-offs (C):** This is arguably the *most* parity-faithful end state (Notion
has free-text find + structured filter, and **no** free-text row-hide). It keeps
the newer, tested engine and discards the older free-text filter. But it is riskier
on two counts: (1) it removes a behavior some users rely on (typing to *hide* rows
is a fast habit), and (2) it makes the **unverified, possibly-broken** quick-find
the *only* search — so it is **gated on the live repro passing**. C and A1
converge on "one highlight-first search + structured Filter"; they differ only in
whether free-text *row-hide* survives as a mode (A1: yes, as a toggle) or is dropped
(C: no). Recommend C **only** if the owner wants strict Notion parity and the live
repro confirms quick-find works.

### Decision-shape summary

- If the owner wants **one search, lowest risk, no capability loss** → **A1**
  (recommended).
- If the owner wants **strict Notion parity** and quick-find is confirmed working →
  **C** (or A1, which is nearly the same with row-hide kept as a toggle).
- If the owner wants **minimal code** and is fine dropping highlight → **A2**.
- "Keep both, just relabel" (**B**) is **ruled out**.

## Live-Repro Action (independent of the consolidation choice)

**Confirm whether quick-find has a real defect in the owner's vault** —
*regardless* of which option is chosen, because:

- If A2 is chosen, we delete the engine anyway — but we still want to know whether
  the bug was real (to learn whether the Cmd/F binding itself is the problem, which
  would *also* affect A1/C where Cmd/F survives).
- If A1 or C is chosen, the highlight engine **survives**, so a real defect must be
  fixed, not consolidated away.

**Repro steps (owner, ~2 min):** open a folder-DB table view, click into it so it
has focus, press **`Cmd/Ctrl+F`** → does the floating "Find in view" bar appear at
the top-right? Type a value you can see in a cell → does it show `n/m`, does the
matching cell visibly change (highlight), do `↑ ↓` / `Enter` jump between matches
and scroll an off-screen match into view? Report which step fails.

**Likely offline-invisible causes to check if it fails:** (1) the table did not
have focus, so `TableView.onKeyDown` never fired (`TableView.tsx:850`); (2) the
`mk-cell-find-match` / `mk-cell-find-active` classes have no visible style in the
owner's active theme (`TableView.css`); (3) another global hotkey handler consumed
`Cmd/F` before the view. This is filed as a child action on `Notidian-z8q`; it is
**not** an offline-provable item.

## Why a Decision, Not a Build (and no spike shipped)

- **The shape is genuinely open** (one vs two affordances; which behavior is
  primary; whether to keep highlight) — a product call only the owner can make.
- **A spike cannot de-risk it.** The risk is not "does the merged code work" (the
  filter engine and the find engine both already work in isolation); the risk is
  *which product shape is right* + *is the existing feature actually broken in the
  vault* — the first is a preference, the second needs the owner's eyes, neither is
  a measurement a throwaway flag yields.
- **Removing a shipped, tested feature blind is the most expensive mistake here** —
  if quick-find works fine and the owner actually wanted A1 (keep highlight, merge
  the control), a blind A2 deletion throws away the parity behavior and the tested
  engine.

No code changed; `FilterBar.tsx`, `QuickFindBar.tsx`, `SearchBar.tsx`,
`tableQuickFind.ts`, and the `Cmd/F` binding are **untouched** until the owner
picks.

## Consequences

- On a pick of **A1**: implementing session merges the two toolbar entry points
  into one search box with a filter/highlight mode toggle, keeps both engines and
  the no-sink cell-class highlight, rebinds `Cmd/F` to the unified box, and removes
  the standalone `⌕` button. View-layer only; no authority/sink change.
- On a pick of **A2**: implementing session deletes the quick-find engine + bar +
  button, rebinds `Cmd/F` to open the filter-search, and confirms green
  suite/tsc/build. Records the capability/parity regression explicitly.
- On a pick of **C**: gated on the live repro passing; implementing session removes
  the free-text row-hide search, keeps quick-find as the one free-text search, and
  documents that row reduction is now the structured Filter button only.
- The **live-repro action** runs in all cases and may itself change the pick (a
  confirmed-broken Cmd/F binding argues against C, which leans hardest on it).

## Cross-links

- **Bead:** `Notidian-z8q` (this decision; stays OPEN awaiting the owner pick) +
  the child live-repro action.
- **Quick-find as shipped:** [ADR 0021](0021-in-table-quick-find.md)
  (Accepted — records the already-shipped design); bd `Notidian-r20` (CLOSED).
- **Filter-search engine:** `ContextEditorContext.tsx:691-712` (`searchString` /
  `matchAny`); inline Filter/Sort bar `Notidian-ddk`.
- **Toolbar:** `FilterBar.tsx` (`mk-view-options`, search/`⌕`/Filter buttons);
  `SearchBar.tsx`; `QuickFindBar.tsx`; `TableView.tsx:854-863` (`Cmd/F` binding).
- **Authority + sink invariants:** [ADR 0001](0001-authority-partitioned-database-model.md),
  [ADR 0014](0014-notidian-only-personal-database-engine.md),
  [ADR 0017](0017-explicit-notidian-ownership.md), `src/shared/utils/sanitize.ts`.
