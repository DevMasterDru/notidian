# ADR 0024: Sub-Items and Back-Relations UX — Property Authority, Creation, Cycles, and Sort Interaction

## Status

**Superseded as the governing sub-items contract by
[ADR 0050](0050-subitems-notion-parity.md)** (Historical). ADR 0050 — the
Notion-parity contract (Accepted 2026-06-20) — **builds on and subsumes** this
decision: it re-ratifies the one-way + computed-children model recorded here and
extends it with display/filter modes, per-view collapse persistence, progress
rollups, and non-destructive parent delete. This record is retained for the
decision trail; the acceptance below still describes the shipped **creation UX**
(`Notidian-f0pj.1`), which ADR 0050 did not reverse.

**Accepted — owner pulled for build on 2026-06-20.** The recommendations below are
ratified as the contract: **A1** (per-view parent column), **B1** (one-way,
child-owns; "Add sub-item" pre-fills the child's parent link), **C2** (passive
cycle/orphan indicator + indent clamp, no hard cap, no blocking validation),
**D1–D4** (hierarchy wins row order; sort + manual order govern siblings;
filtered-out parents drop children to roots; groupBy adjacency is a documented
caveat). Deferred (build only if later asked): **B3** two-way reciprocal opt-in,
drag-to-re-nest, **A3** per-DB default parent. Implementation: bd
**`Notidian-f0pj.1`** (S1) under epic **`Notidian-f0pj`**; stream packet
`docs/streams/notion-parity-ux.md`.

History: previously Parked (genuinely-speculative until the owner pulled it);
written instead of building the feature blind. Tracked by bd `Notidian-2uz` (the
decision bead); roadmap item (3) of epic `Notidian-2w0`. The **engine and render
plumbing already shipped and tested** (see below); what was *not* decided was the
user-facing contract — the four product questions a person drives. A wrong call
would write the wrong frontmatter into the owner's real notes, or silently mutate
the parent's file — so the build stopped at the contract, which is now ratified.

## Date

2026-06-15

## Context

### What already shipped (this grounds every option below)

Sub-items and back-relations are **not greenfield**. The pure engine and the
render plumbing are done, tested, and Codex-reviewed:

- **Parent/child tree** — `buildRowTree` + `flattenVisibleTree`
  (`src/core/utils/contexts/tableRowTree.ts`, bead `Notidian-gg9`). A row's parent
  is the **first link in its parent property that resolves to another row in the
  set**; rows with no/out-of-set/self parent are roots; **cycles are broken** (each
  row emitted exactly once, `visited` guard; rows reachable only through a cycle
  surface as roots). Collapse hides a subtree without losing its rows. Pure +
  unit-tested (`tableRowTree.test.ts`).
- **Table render** — wired into the table (bead `Notidian-pv4`, commit `242ca32`):
  depth-first ordering, `depth*16px` indent, collapse chevron, and a
  **parent-column picker** in the view config. Inert when unconfigured.
- **List render** — same affordance in the list view (bead `Notidian-s9m`, commit
  `f3ad16f`), reusing the same tree-ordered `filteredData`.
- **Back-relations ("linked from")** — `filterBackRelations`
  (`src/core/utils/contexts/tableBackRelations.ts`) + `computeRowBackRelation`
  (`tableBackRelationRuntime.ts`), a read-only `backlink` field type
  (`src/schemas/mdb.ts`), bead `Notidian-ahk`, commit `61c9a45`. The candidate set
  is the target's precomputed `inlinks` (perf-bounded — no full-vault scan); only
  candidates whose *designated relation property* resolves back to the target count
  (incidental body links are excluded). `fn: "list"` shows linking rows' titles;
  other fns reuse the forward rollup engine.
- **Shared link resolver** — `makeRelationLinkResolver`
  (`src/core/utils/contexts/relationResolver.ts`, bead `Notidian-e1u`)
  canonicalizes `[[Note]]` / `[[Folder/Note]]` / aliased links to a real vault path
  via the link index, so bare/basename wikilinks match `pathsIndex` keys.

### What the runtime does *today*, concretely

- **The parent property is chosen per view, not fixed.** The view's predicate
  carries `subItems: { field }` (`src/shared/types/predicate.ts`); the field is an
  *existing column* selected in the view config (`ContextEditorContext.tsx`
  `subItemsCol` → `predicate?.subItems?.field`). Any frontmatter link property can
  be the parent property; there is no reserved name, no per-DB binding, and no
  default.
- **The tree runs *after* filter and sort.** `subItemsNodes` is built over
  `filteredSortedData` and then *replaces* the row order
  (`filteredData = subItemsNodes.map(n => n.row)`). So children are **re-parented
  under their parents regardless of the active sort** — the sort orders siblings,
  but the parent→child hierarchy always wins the row order. A filter that removes a
  parent currently leaves its children to surface as roots (out-of-set parent).
- **Creating a row writes no link.** `newRow` → `newPathInSpace`
  (`TableView.tsx`) creates an **empty** Markdown file (title only). There is **no
  "add sub-item" affordance, no parent pre-fill, and no reciprocal write anywhere**
  in the codebase. The user makes something a child by **typing/pasting a `[[parent]]`
  link into the parent column** of an existing row.
- **The relation is strictly one-way today.** The child's frontmatter names the
  parent. The parent's file is never touched. Back-relations ("linked from") are
  the read-only inverse view; they compute the reverse side at render time and
  **write nothing**.
- **Cycles/depth are silent at the UX layer.** The resolver breaks cycles by
  emitting each row once and surfacing cycle-only rows as roots. The user sees a
  consistent flat-looking tree; there is **no warning, badge, or depth cap shown**.

### Constraints any contract must respect

- **C1 — File/frontmatter authority (ADR 0014, 0017).** The parent link and any
  back-relation are *ordinary frontmatter*, canonical in the child's `.md` file. The
  MDB stores only view config (which column is the parent column), never the
  relationship itself.
- **C2 — Additive, non-destructive.** No flow may rewrite or delete frontmatter the
  user did not target. Two-way sync, if ever offered, writes only the one reciprocal
  property and never clobbers existing values.
- **C3 — No new authority inversion.** Back-relations stay computed/read-only; they
  must not become a stored, editable "children" list that competes with the child's
  parent link for authority.
- **C4 — Perf-bounded.** Tree build is O(rows-in-view); back-relations are bounded
  by `inlinks`. No full-vault scan, no per-render file read.

The four open questions, each with options + a recommendation:

---

## Question (a) — Parent / back-relation property names: fixed, or configurable?

**Decision needed:** Is the parent-link property a reserved canonical name (e.g.
`parent`), or any column the user designates per database/view?

- **Option A1 — Per-view designation (status quo).** Any frontmatter link column can
  be the parent column; the view's `subItems.field` names it. Back-relations'
  `backlink` field already names its source relation property by `ref`. Zero new
  authority, zero migration, maximum flexibility.
- **Option A2 — Fixed reserved name** (`parent` for the tree; a fixed inverse like
  `children`/`subitems` for the back side). One convention everywhere; trees "just
  work" without per-view config; but it collides with users who already use those
  names differently, forces a migration, and contradicts the "any link property is a
  relation" model that relations/rollups already established.
- **Option A3 — Per-database default with per-view override.** A database-level
  setting picks a default parent property; a view may override. Best ergonomics
  long-term, but it needs a new per-DB config surface (none exists for this) and a
  precedence rule — net-new scope for a single-user tool.

**Recommended: A1 (per-view designation, status quo).** It is already shipped,
respects C1/C3 (the relation is just a link property, no reserved authority), and
needs no migration of the owner's existing notes — the cheapest correct answer for
a personal vault. Revisit A3 only if the owner finds re-picking the column per view
tedious in practice.

## Question (b) — Creating a sub-item: who writes which side? (one-way vs two-way)

**Decision needed:** When the user creates/nests a child, does Notidian write the
**child→parent** link only (one-way, child owns), or also write the
**parent→child** reciprocal (two-way)? And what is the creation affordance?

- **Option B1 — One-way, child owns; creation = an "Add sub-item" action that
  pre-fills the child's parent link (recommended).** Add a row-context action
  ("Add sub-item") that creates a new row and writes only the new child's parent
  property = `[[parent]]`. The parent's file is never touched. The existing
  back-relations view *is* the parent's "children" list, computed read-only. This is
  the natural extension of what shipped: one authority side (the child), one writer,
  the inverse already exists for free.
- **Option B2 — Two-way, both sides written.** Creating a child also appends the
  child to a `children`/`subitems` array in the *parent's* frontmatter. Matches
  Notion's bidirectional feel, but: it writes a second file the user did not target
  (tension with C2), creates **two competing authorities** for the same fact (which
  wins on conflict? — tension with C3), and needs reconciliation on rename/delete
  (delete a child → must scrub the parent's array). High blast radius for a
  single-user tool that already shows the inverse via computed back-relations.
- **Option B3 — One-way by default, explicit opt-in two-way per database.** Ship B1;
  add a per-DB flag that, when ON, also maintains the parent's reciprocal array with
  full reconciliation. Keeps the safe default while leaving a door for a power user.

**Recommended: B1 (one-way, child owns) as the shipped default, with B3 as the
documented future opt-in.** Rationale in one line: the inverse already exists as
read-only computed back-relations, so two-way storage would only *duplicate* a fact
we can derive — adding a second authority and reconciliation burden for no new
information. One writer, one authority, additive and non-destructive (C2/C3). The
creation affordance is a row-context "Add sub-item" action that creates the row and
pre-fills the child's parent link (no new modal needed).

## Question (c) — Cycles and depth: what does the user *see*?

**Decision needed:** The resolver already *prevents* breakage; this is purely about
user-visible feedback when a cycle or extreme depth exists.

- **Option C1 — Silent-safe (status quo): break the cycle, render a sane tree, show
  nothing.** Robust, zero UI cost, but a self-referential or mutually-referential
  pair just "looks fine," so the user can't tell their data is malformed.
- **Option C2 — Silent-safe + a non-blocking indicator.** Keep the resolver's
  behavior; when a row was reached only through a broken cycle (surfaced as a root
  despite having a parent link), show a small inline marker/tooltip ("cycle — shown
  as top-level"). No depth cap (the tree is already bounded by row count); optionally
  a soft indent clamp so a 30-deep chain doesn't run off-screen.
- **Option C3 — Validate-and-warn on edit.** When the user types a parent link that
  would create a cycle, refuse/warn at edit time. Most "correct," but it needs cycle
  detection in the cell-edit path and a blocking UX — heavier, and it can fight
  legitimate intermediate states while reorganizing.

**Recommended: C2 (silent-safe + a non-blocking cycle indicator), no hard depth
cap.** The resolver is already cycle-proof, so the only gap is *visibility*; a
passive marker tells the truth without ever blocking an edit (C3's cost) or hiding a
problem (C1's gap). Indent clamping is a minor render guard, not a behavior change.

## Question (d) — Interaction with reorder / filter / sort: do children follow parents?

**Decision needed:** Confirm (and where ambiguous, decide) the rule when sub-items
is on together with sort, manual reorder, filter, and groupBy.

- **Sort — Option D1 (status quo, recommended): hierarchy wins, sort orders
  siblings.** The tree is applied after sort, so parent→child nesting always holds
  and the sort decides sibling order within each parent. This is the Notion/outliner
  expectation (children stay under their parent) and is what shipped.
  - *Rejected D1-alt:* let sort flatten the tree (children scatter to match a global
    sort). That defeats the point of sub-items; only sensible as an explicit
    "flatten / ignore hierarchy" toggle, deferred.
- **Manual reorder — Option D2 (recommended): manual order is sibling order; nesting
  still wins.** Drag/reorder sets order among siblings under the same parent. (Drag
  *to re-nest* — changing a row's parent by dragging it onto another — is a
  desirable but separate feature; today re-parenting is done by editing the parent
  link. Defer drag-to-nest as its own bead.)
- **Filter — Option D3 (recommended): a filtered-out parent's children surface as
  roots (status quo), and document it.** This is the current behavior (out-of-set
  parent → root). The alternative (auto-include a hidden parent so its children stay
  nested) muddies "filter means hide" and is surprising; keep the simple rule and
  document it.
- **GroupBy — Option D4 (recommended, status quo + documented limitation): groupBy
  partitions first; tree applies within the data but a parent and child in different
  groups won't sit adjacent.** Already the known list-view limitation (depth still
  renders, collapse still works globally). Treat groupBy + sub-items as a power-user
  combination with a documented caveat rather than forcing one to disable the other.

**Recommended: keep the shipped rule — hierarchy always wins row order; sort and
manual order govern siblings; filtered-out parents drop their children to roots;
groupBy + sub-items is allowed with a documented adjacency caveat.** Rationale: this
is the outliner-standard behavior, it is already implemented and tested, and the
edge cases are documentation, not redesign. Drag-to-re-nest is the one genuinely new
capability and is split to its own follow-up.

---

## Consequences

- **If accepted as recommended (A1 / B1 + B3-later / C2 / D1–D4):** the *only* new
  code to build is small and safe — an "Add sub-item" row action (one-way parent
  pre-fill), a passive cycle indicator + indent clamp, and documentation of the
  sort/filter/groupBy rules. No frontmatter the user didn't target is ever written;
  no second authority is introduced; no migration of existing notes. Two-way (B3) is
  deferred behind an explicit per-DB opt-in only if the owner asks for it.
- **The contract is the gate, not the engine.** The engine/render are done; this
  decision unblocks the thin UX layer (`Notidian-2uz` → a follow-up implementation
  bead) without gambling quota on the wrong product direction.

## Ruled-out alternatives (summary)

- **Two-way reciprocal storage by default (B2).** Duplicates a fact already derivable
  from computed back-relations, creates two competing authorities, and forces
  rename/delete reconciliation — violates C2/C3 for no new information.
- **Fixed reserved property names (A2).** Forces migration and collides with the
  established "any link property is a relation" model; flexibility lost for no gain
  in a single-user vault.
- **Blocking cycle validation at edit time (C3).** Unnecessary — the resolver is
  already cycle-proof — and it fights legitimate intermediate states during
  reorganization.
- **Sort flattens the tree (D1-alt).** Defeats sub-items; only viable as an explicit
  opt-in "ignore hierarchy" toggle, deferred.

## Cross-links

- Epic: bd `Notidian-2w0` (Notion-parity roadmap), item (3).
- This decision: bd `Notidian-2uz` (CLOSED — parked to ROADMAP 2026-06-16, then
  owner-pulled 2026-06-20 and shipped via bd `Notidian-f0pj.1`; see Status
  above). ADR 0050 now supersedes this as the governing sub-items contract.
- Shipped engine/render: `Notidian-gg9`, `Notidian-pv4`, `Notidian-s9m`,
  `Notidian-ahk`, `Notidian-9ln`, `Notidian-e1u` (link resolver).
- Code: `src/core/utils/contexts/tableRowTree.ts`,
  `src/core/utils/contexts/tableBackRelations.ts`,
  `src/core/utils/contexts/tableBackRelationRuntime.ts`,
  `src/core/utils/contexts/relationResolver.ts`,
  `src/shared/types/predicate.ts` (`SubItemsPredicate`),
  `src/core/react/context/ContextEditorContext.tsx` (tree memos),
  `src/schemas/mdb.ts` (`backlink` field type).
- Authority basis: ADR 0014, ADR 0017.
