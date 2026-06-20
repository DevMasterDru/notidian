# Stream Packet — Notion-parity UX: sub-items creation + rollup honesty

Slim cold-start orientation for the work-stream the owner pulled on 2026-06-20 from
the Notion-parity roadmap. Resolve every pointer **live** (don't trust copies here);
work status lives in **beads**, decisions in **ADRs**, this packet only orients.

## Scope (what this stream builds)

Two **independent**, well-bounded UX features on top of already-shipped, tested
engines — the contract for each is **decided** (ADRs accepted), so this is execution,
not design:

1. **Sub-items creation UX** (ADR 0024) — an "Add sub-item" row action (one-way: writes
   only the child's parent link, never the parent's file), a passive cycle/orphan
   indicator + indent clamp, and docs. → bead **Notidian-f0pj.1** (S1).
2. **Rollup partial-honesty indicator** (ADR 0029 D2) — a passive "N of M · K unresolved"
   marker on rollup cells (CSS/text only, number unchanged). → bead **Notidian-f0pj.2** (S2).

Either order; both can run in one sitting. Each is independently verifiable + committable.

## Pointers (resolve live)

- **Work graph:** epic **Notidian-f0pj** → sessions `Notidian-f0pj.1` (S1), `Notidian-f0pj.2` (S2).
  Run `bd ready` / `bd show <id>` — the issue bodies are the **binding briefs** (exact file:line, complete approach).
- **Decisions:** `docs/adr/0024-sub-items-back-relations-ux.md` (Accepted),
  `docs/adr/0029-frontmatter-relations-rollups-authority-ux.md` (Accepted).
- **Umbrella roadmap epic:** `Notidian-2w0` (these are its items 3 and 1).
- **Routing/gates/invariants:** repo `AGENTS.md` (branch, gate commands, authority + no-innerHTML-sink invariants).

## Key facts (bedrock — verified 2026-06-20, stable enough to cite)

- **The engines already shipped + are tested.** Sub-items: `buildRowTree`/`flattenVisibleTree`
  (`src/core/utils/contexts/tableRowTree.ts`, cycle-safe). Rollups: `parseRelationLinks` +
  `computeFrontmatterRollup` (`tableRollup.ts`), `computeRowRollup` (`tableRollupRuntime.ts`),
  `RollupCell.tsx`, the `rollup`/`backlink` field types + config menu. Shared link resolver:
  `relationResolver.ts`. This stream adds only the **thin decided UX layer**.
- **Two extension points the UX needs (the engines don't yet surface these):**
  - S1: `RowTreeNode` is `{row, depth, hasChildren}` — add a `surfacedAsRoot` flag for the orphan marker.
  - S2: the rollup engine returns only a display string — add a **sibling** that surfaces
    `{relationCount, resolvedCount}` (keep the string API stable: it's also used by back-relations).
- **Two render sites for sub-items, not one:** `subItemsInfo` is consumed by **both**
  `TableView.tsx` (~2427) and `ContextListView.tsx` (~432) — the indicator + clamp land in both.
- **Runner:** Sonnet (live Model Routing config — binding packet ⇒ workhorse tier; gates catch defects);
  escalate to Opus only on a twice-failed gate. If run via the Long Autonomous Mode engine, its Opus override applies.

## Cold-start (any model)

`AGENTS.md` → this packet → `bd ready` → claim the top `Notidian-f0pj` issue → execute its body
within scope → verify with evidence (`npm test -- --runInBand` / `npx tsc --noEmit --skipLibCheck`
/ `npm run build`, plus the feature's own acceptance) → `bd close` with the evidence → commit + push.
