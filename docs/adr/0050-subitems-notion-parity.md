# ADR 0050: Sub-items — Notion-Parity Contract (Relationship Model, Display/Filter Modes, Collapse Persistence, Progress Rollups, Parent Delete; Drag + Two-Way Deferred)

## Status

**Accepted — owner pulled for build on 2026-06-20.** Following a verified research
pass on *current* Notion sub-items behavior (web sources, every load-bearing claim
independently re-checked) and an adversarially-reviewed design pass, the owner chose
a **full parity push** with these binding decisions: **one-way relationship +
computed children** (no stored reciprocal, no two-way writes); **non-destructive
parent delete + a 3-way prompt**; **display modes** (nested / flattened /
parents-only); **filter-visibility scopes** (parents / parents+sub-items /
sub-items); **per-view collapse persistence** + expand/collapse-all; **progress
rollups** (percent / percent-checked + bar/ring render); and an **inline
"Add sub-item"** affordance. **Drag-to-reparent**, **two-way/reciprocal pairing**,
and **multi-parent** are explicitly **deferred / rejected** (see below).

Implementation: bd epic **`Notidian-5ond`** (children `S0`–`S7` land in the
conflict-aware build order); builds on the shipped one-way engine (ADR 0024) and the
rollup honesty contract (ADR 0029). Stream packet: `docs/streams/notion-parity-ux.md`.

## Date

2026-06-20

## Context

Notidian already shipped the structurally-hard core of Notion sub-items (ADR 0024 /
`Notidian-pv4`/`f0pj.1`): a **one-way**, frontmatter-native parent/child tree
(`buildRowTree`/`flattenVisibleTree` over `predicate.subItems.field`) with
cycle-breaking, a passive orphan/cycle marker (`surfacedAsRoot`), per-parent
collapse, a depth-12 render clamp, read-time back-relations that derive a parent's
children for free, and a one-way "Add sub-item" action. The owner asked to take the
feature "as close as possible to Notion."

A verified-research pass (33 agents; every load-bearing Notion claim independently
re-checked) established the basis for this contract and corrected three points that
would otherwise have mis-shaped the design:

- **"Unlimited nesting depth" — REFUTED.** Notion silently breaks past ~10 items in
  a hierarchy and expert guidance recommends ~2 levels; its rollups miscalculate
  past ~7. Notidian's unbounded, cycle-safe tree (render clamp only) **exceeds**
  Notion here and must not adopt Notion's broken ceiling.
- **Multiple parents — UNCERTAIN / contradicted.** A credible source says Notion's
  "Parent item" relation is single-valued; the UX is a single-parent tree. We do
  **not** build multi-parent/DAG support on an unverified claim.
- **Reciprocity + cascade-delete — CONFIRMED for Notion**, but both are deliberate,
  defensible divergences for Notidian (a second stored authority, and irreversible
  deletion of the owner's real `.md` notes, respectively).

Confirmed real Notion behaviors we *do* target: three filter/display modes
("Parents only", "Parents and sub-items", "Sub-items only"), a "Nested in toggle"
vs "Flattened list" layout, sub-item counts, and percent/progress rollups.

All seven work items share a small set of core files (`predicate.ts`,
`ContextEditorContext.tsx`, the two render surfaces, `FilterBar.tsx`, the rollup
pair, the two context menus), so the parity contract is ratified here **before**
implementation to keep semantics consistent.

## Decision

- **Relationship model — ONE-WAY + computed children.** The child owns the parent
  `[[link]]` in its own frontmatter; the parent's "children" is the read-time
  back-relation computed by `buildRowTree`. **No** stored reciprocal property, **no**
  two-way write. Computed children are surfaced as first-class affordances: a
  view-scoped child-count badge beside the chevron, and a one-click "Add children
  column" that pre-configures the existing read-only backlink field over the
  parent-link property (vault-scoped, zero stored reciprocal). The two children
  scopes (view-scoped count vs vault-scoped backlink) legitimately differ and are
  labeled distinctly; the auto column is **not** named "Sub-items".
- **Parent delete — NON-DESTRUCTIVE + PROMPT.** Deleting a row that has sub-items
  opens a 3-way choice: (1) *delete this item only / promote children to roots*
  **[default; no child frontmatter is rewritten — children survive via
  `surfacedAsRoot`]**, (2) *delete this item and all sub-items recursively* [behind a
  counted confirmation], (3) *cancel*. A leaf row keeps today's silent delete.
  Recursive delete walks only descendants present in the **visible** row set.
- **Single-parent tree only.** `buildRowTree` attaches each child to its first
  resolving parent; multi-parent is not a target.
- **Display modes** persist as `predicate.subItems.display ∈ {nested (default),
  flattened, parents-only}`: *flattened* bypasses tree ordering so the global
  `predicate.sort` wins (each child shows a parent reference); *parents-only* shows
  roots with descendant counts.
- **Filter-visibility** persists as `predicate.subItems.filterScope ∈ {parents,
  parentsAndSubItems (default == today), subItems}`, applied in a pure seam between
  filtering and tree-building. Notion's exact "detached child" rendering is
  unverified; Notidian ships clean, documented, internally-consistent semantics
  rather than reverse-engineering it.
- **Collapse state** persists per-view as `predicate.subItems.collapsed` (row
  PATHS, rename-safe), plus an expand-all / collapse-all header affordance.
- **Progress rollups** add `percent` and `percent_checked` aggregates (integer
  `0..100` string; `""` when the denominator is 0; denominator = resolved links, so
  unchecked/empty sub-items honestly lower the percent) and an optional bar/ring
  render mode on the rollup cell, reusing the ADR-0029 D2 partial marker. Checkbox
  truth is a raw YAML boolean (`v === true`), tolerating string `"true"`.
- **Depth** keeps no hard cap (render clamp at 12 only).
- **Terminology:** feature "Sub-items", action "Add sub-item"; the underlying
  parent-link column stays user-named.
- All new `predicate.subItems` keys are **optional and default-absent == legacy**;
  validation drops defaults so existing stored predicates round-trip byte-identical.

## Rejected / Deferred Options

- **Two-way paired relationship** (storing + writing a reciprocal "children"
  property on the parent) — *rejected*: doubles the write surface, needs
  reconciliation/conflict handling on every add/move, and the read-time
  back-relation already yields children for free; one-way keeps the child as the
  single owner of its link (symmetric with ADR 0024 B1 / 0029 C1). Door left open
  for a future ADR; nothing in this stream writes a reciprocal property.
- **Cascade (silent recursive) delete** of a parent's subtree — *rejected*:
  permanently destroys the owner's `.md` files with no consent; replaced by the
  explicit 3-way prompt whose default promotes children non-destructively.
- **Multi-parent membership** — *rejected*: Notion's multi-parent claim was
  unverified, `buildRowTree` is single-first-parent by construction, and multi-parent
  breaks the subtree-collect/delete and count invariants.
- **Matching Notion's finite/broken depth cap** — *rejected*: Notidian already
  supports unbounded, cycle-safe depth; keep only the render clamp.
- **`localStorage` for collapse persistence** — *rejected*: no per-view key that
  survives a view rename or syncs across machines; the per-view predicate is the
  existing durable store.
- **Drag-to-reparent** — *deferred* (owner): the one genuinely-new interaction (must
  be disambiguated from the existing drag-to-reorder); build after the cheaper
  render/affordance wins, as its own bead.

## Consequences

- A synced/shared view now ships `display` / `filterScope` / `collapsed` inside its
  predicate JSON; dropping defaults and pruning empties keeps fully-default views
  byte-stable (back-compat with every pre-existing predicate; no migrations).
- Parent delete has two entry points (MDB `rowContextMenu` + `pathContextMenu`) that
  must funnel through one pure subtree-collection over the same visible row set as
  the rendered tree; recursive delete removes only descendants present in the view
  (documented intentional behavior).
- `predicate.subItems` grew from `{ field }` to `{ field, display?, filterScope?,
  collapsed? }`; every writer of `subItems` must spread the existing object or it
  silently erases sibling keys — fixed once in the foundation (FilterBar writer,
  rename remap, column-delete clear).
- A separate `subItemsParentKey` (= `name+table`, the tree/READ key) is exposed
  alongside the bare `subItemsField` (the frontmatter WRITE key) so non-primary
  parent columns resolve correctly for tree/delete reads.
- No hard depth cap means recursive delete + collapse operate on the full data past
  the 12-level render clamp (clamp is render-only; data operations are complete).
- Drag-to-reparent and two-way remain open for a future ADR.

## Verification basis

This contract was set from a verified-research workflow (Notion behavior, web
sources, adversarial cross-checking) + an adversarially-reviewed design workflow
(per-item specs → conflict-aware build order). The refuted/uncertain Notion claims
above are why depth, multi-parent, and "detached child" rendering are **not** parity
targets.

## Related

- [ADR 0024](0024-sub-items-back-relations-ux.md) — the shipped one-way sub-items +
  back-relations contract this builds on.
- [ADR 0029](0029-frontmatter-relations-rollups-authority-ux.md) — relations/rollups
  authority + the D2 partial-honesty marker the progress rollups reuse.
- [ADR 0017](0017-explicit-notidian-ownership.md) — why the inverse stays
  computed, not a second stored authority.
- Stream packet: `docs/streams/notion-parity-ux.md`.
