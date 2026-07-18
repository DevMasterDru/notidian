---
type: capabilities
description: Notidian's outward interface for cross-repo consultation (ADR-0041)
---

# Notidian — Capabilities

> Per Atlas Method ADR-0041 (cross-repo consultation ladder): read this file inline
> before spawning a subagent or cold-exploring this repo. Resolve volatile state
> live through `bd` or the cited source; this page holds stable facts and pointers.

## 1. Identity

Notidian is an independent Make.md fork: a Notion-style database engine over
canonical Obsidian files, bundled as one plugin (`main.js`). It is the sole
Atlas Vault database engine; native Obsidian Bases is out of scope (ADR 0014).

- Repo: `~/Projects/Notidian` · bd prefix: `Notidian-` · Portfolio row:
  `Portfolio/Notidian.md` (`kind: product`, serves `[[Atlas]]`).
- Build: `npm run build` (typecheck + bundle); `npm run deploy:vault` (build →
  install → reload, the only path that updates a running vault; ADR 0051).

## 2. Capabilities

- **Folder-as-database tables**: frontmatter properties become table columns;
  UX includes range editing, undo/redo, frozen columns, manual order, grouped
  islands, view search, property visibility, and row-create templates.
- **File-canonical editing**: page titles are file renames, not detached
  strings; frontmatter writes gate acceptance; stale-write conflicts surface
  inline (Reload / Apply anyway) instead of overwriting.
- **Hub-declared schema**: a database's hub note can declare `schema_type:
  notidian_type_profile` plus `fields:`; the hub↔table mirror suppresses echoes.
- **Legacy Make.md migration**: read-only audit/planner classifies a legacy
  table against live frontmatter before any migration write.
- **Embeds**: a database table/view can be embedded live in any note, or on an
  Obsidian **Canvas**, via a `​```notidian` code block. Canvas uses a wrapper
  note and standard JSON Canvas `file` node, not undocumented internals.
- **Cross-database saved views**: one native saved view can project rows from
  several folders through explicit field mappings. Native view operations act
  on the live union; F1 is read-only to preserve source ownership ([ADR
  0059](adr/0059-cross-database-saved-views.md)).
- **Period-scoped relation rollups**: forward Rollup and reverse Linked From
  can aggregate local Today or the current ISO Monday-start week. Results work
  in native filters and sort without durable counters or dates ([ADR
  0060](adr/0060-period-scoped-relation-rollups.md)).
- **Recurrence-aware occurrence filters**: select fields named `cadence` or
  `recurrence` expose Occurs today / Occurs this ISO week predicates over
  canonical frontmatter. They create no occurrence rows or reset daemon ([ADR
  0061](adr/0061-recurrence-aware-occurs-on-filters.md)).
- **In-flight (Data Integrity Program, `Notidian-loan`)**: Type Profile v3
  schema registry, pure validation core, and read-only reconciler/health surface
  — ADRs 0056–0058.

## 3. Concepts & vocabulary

- **Space** — a folder treated as a database; **row** = a Markdown file in it.
- **Schema** (`SpaceTableSchema`: `id`/`name`/`type`) — one saved table/board/
  view on a space; `filesView` is the reserved default view id.
- **Context MDB** (`.notidian/…`) — per-folder view-state store: column
  order/hidden/frozen, filters, sort, group, and any field explicitly marked
  `source: "notidian"`. Never the source of truth for ordinary properties.
- **Type Profile** — a hub-declared schema contract (frontmatter `fields:`
  map) that ordinary frontmatter-backed columns must conform to.
- **Authority partitioning** — the rule that decides who owns a value: file
  path/basename (row identity), frontmatter (ordinary properties), context MDB
  (explicit Notidian-owned fields only) — ADR 0001/0014/0017.

## 4. Interfaces & contracts

- **Verification gate**: `npm test -- --runInBand`, `npx tsc -noEmit
  -skipLibCheck`, `npm run build`, `npm run health:audit -- --live` — all
  green before claiming health (AGENTS.md "Verification").
- **Live-verify contract** (ADR 0051): committed + gates-green ≠ deployed; a
  render-path change needs `npm run deploy:vault` + `obsidian dev:dom`/
  `dev:errors`/`dev:screenshot` before it's considered shipped.
- **Final-completion execution** (ADR 0064): one xhigh root resolves the live
  Beads graph and gates one direct Sol-medium implementation worker at a time on
  `autonomous/notion-parity-2026-06-12`; no hcom or Claude transport proxy.
- **AI operating guidance**: the `notidian` skill (canonical source in the
  *Atlasidian* repo, `.agents/skills/notidian/`) is the routing skill for any
  Obsidian-database task, in this repo or the vault.

## 5. Boundaries & negative knowledge

- Native Obsidian Bases / `.base` files are **not** a dependency, mirror,
  export/import target, or roadmap assumption — do not reintroduce them.
- `.makemd` / `.space` are retired compatibility storage — migration clues
  only, never active write targets; `.notidian` is the only active runtime
  root.
- Internal `MakeMD*`/`mk-*`/`spaces://` names are fork-lineage, not proof of
  live Make.md behavior by themselves.
- No directory symlinks in an indexed vault — Obsidian's crawl follows them
  recursively regardless of ignore filters (V8 OOM risk).
- `.worktrees/` holds ignored local worktree snapshots — not active source,
  do not inspect/summarize unless explicitly asked.
- Autonomous completion state lives in this repo's Beads graph, packet, ADRs,
  and git history; model and invocation details resolve live from the Atlas
  Vault Model Routing registry (ADR 0064).

## 6. Consultation pointers

- Current implementation reference: `docs/current-state.md`.
- Full architecture: `docs/notidian-system-architecture.md`.
- ADR index (verdict-first titles): `docs/adr/README.md`.
- Practical table workflows/troubleshooting: `docs/table-database-workflows.md`.
- Parked/speculative product direction (never built until pulled):
  `docs/ROADMAP.md`.
- Live work state (never mirrored here): `bd ready` / `bd show <id>` with
  prefix `Notidian-`.

## 7. Provenance

Minted 2026-07-05 per Atlas Method ADR-0041 D2 ("next active session, not
big-bang"), during a session that also filed `Notidian-7v4c` (ADR-0040
Database Boundary Test → `Notidian-loan.3`) and `Atlasidian-9me` (notidian
skill citation gap). Maintain per `docs/conventions/capabilities-doc.md`: an
ADR that changes this repo's outward interface names the edit to this file in
the same change-set.
