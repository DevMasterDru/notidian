---
type: capabilities
description: Notidian's outward interface for cross-repo consultation (ADR-0041)
---

# Notidian — Capabilities

> Per Atlas Method ADR-0041 (cross-repo consultation ladder): read this file
> inline before spawning a subagent or cold-exploring this repo. Stable cited
> facts and pointers only — never volatile counts/state; resolve those live via
> `bd` or the docs this file points at.

## 1. Identity

Notidian is an independent Make.md fork — a Notion-style database engine laid
over canonical Obsidian files, running as a single bundled Obsidian plugin
(`main.js`) inside Obsidian's Electron renderer. It is the sole intended
database engine for the Atlas Vault; native Obsidian Bases is retired and out
of scope (ADR 0014).

- Repo: `~/Projects/Notidian` · bd prefix: `Notidian-` · Portfolio row:
  `Portfolio/Notidian.md` (`kind: product`, serves `[[Atlas]]`).
- Build: `npm run build` (typecheck + bundle); `npm run deploy:vault` (build →
  install → reload — the only path that makes a change visible in a running
  vault, ADR 0051).

## 2. Capabilities

- **Folder-as-database tables**: frontmatter properties materialize as table
  columns; Notion-style UX — spreadsheet paste/cut/fill, undo/redo, frozen
  columns, manual row order, grouped islands, in-view quick find, properties
  visibility panel, per-database row-create templates.
- **File-canonical editing**: page titles are file renames, not detached
  strings; frontmatter writes gate table/context acceptance; stale-write
  conflicts surface inline (Reload / Apply anyway) instead of silently
  overwriting.
- **Hub-declared schema**: a database's hub note can declare `schema_type:
  notidian_type_profile` + a `fields:` map; hub↔table mirror keeps both in
  sync one-directionally-safe (no echo loops).
- **Legacy Make.md migration**: read-only audit/planner classifies a legacy
  context table against live frontmatter (conflicts, backfill candidates,
  context-only values) before any migration write.
- **Embeds**: a database table/view can be embedded live in any note, or on an
  Obsidian **Canvas**, via a `​```notidian` code block (target/kind/id/height/
  editable) — Canvas uses a small wrapper note + the standard JSON Canvas
  `file` node, deliberately avoiding undocumented Canvas-internals patching.
- **Cross-database saved views**: one native saved view can project rows from
  several folder databases through explicit canonical-to-source field mappings;
  filters/sort/group/layouts/embeds/export and the native view switcher operate
  on the live union. F1 is read-only to preserve each source frontmatter key as
  the sole owner ([ADR 0059](adr/0059-cross-database-saved-views.md)).
- **Period-scoped relation rollups**: forward Rollup and reverse Linked From
  columns can aggregate related rows from local Today or the current ISO
  Monday-start week; the live result works in native filters and sort without
  storing counters or latest dates ([ADR
  0060](adr/0060-period-scoped-relation-rollups.md)).
- **In-flight (Data Integrity Program, `Notidian-loan`)**: Type Profile v3
  schema registry (enum-as-law, required/unique/pattern, declared references,
  derived fields), a pure validation core, and a read-only reconciler/health
  surface — ADRs 0056–0058.

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
- **Standing autonomous authorization**: "Long Autonomous Mode" section in
  this repo's `AGENTS.md`, run via the repo-agnostic
  `~/.claude/skills/long-autonomous-mode/` engine (doctrine: Atlas Method
  `docs/decisions/0022`); branch `autonomous/notion-parity-2026-06-12`.
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
- The engine that runs autonomous drives here is **repo-local by design**: it
  reads only this repo's own `AGENTS.md`/`README`/`package.json`, never the
  Atlas Method repo's ADR stream — fresh cross-cutting doctrine does not
  auto-propagate in and must be threaded in by a session that knows to check.

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
