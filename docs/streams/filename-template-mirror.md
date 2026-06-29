# Stream Packet — Filename Template Mirror

Slim cold-start orientation for the filename template mirror feature (Notidian-pay5).
Resolve every pointer **live** (don't trust copies here); work status lives in
**beads**, decisions in **ADRs**, this packet only orients.

## Scope (what this stream builds)

Per-database filename templates that auto-rename files when frontmatter changes.
A configurable template like `{board_id:02d}-ch{address:02d}-{device|slug}` stored
in SpaceDefinition (view/config authority, per ADR 0001/0014) drives file naming.
When template variables change in frontmatter, the file auto-renames. Three sessions:

1. **Template engine + ADR** — pure logic: parser, evaluator, slug transform, collision
   suffix, SpaceDefinition plumbing. → bead **Notidian-pay5.1.1** (S1).
2. **Auto-rename watcher** — `FilenameEnforcer` hooks into metadataCache events,
   evaluates templates, renames via `spaceManager.renamePath`, reentrancy guard +
   batch queue. Kill-switch setting. → bead **Notidian-pay5.1.2** (S2).
3. **Configuration UI + first-time adoption** — space settings component to
   configure/preview templates, bulk rename for existing databases.
   → bead **Notidian-pay5.1.3** (S3).

Dependency chain: S1 → S2 → S3 (each session's DoD gates the next).

## Pointers (resolve live)

- **Work graph:** epic **Notidian-pay5.1** → sessions `.1.1` (S1), `.1.2` (S2), `.1.3` (S3).
  Run `bd ready` / `bd show <id>` — the issue bodies are the **binding briefs**.
- **Parent issue:** `Notidian-pay5` (the feature description with full requirements + examples).
- **Decisions:** ADR 0001 (authority partition), ADR 0003 (page title renames),
  ADR 0014 (Notidian-only engine), ADR 0028 (per-DB row-create templates).
  S1 writes the new template mirror ADR.
- **Downstream:** `Notidian-mx0k` (key-match FK relations) depends on pay5.
- **Routing/gates/invariants:** repo `AGENTS.md` (branch, gate commands, authority +
  no-innerHTML-sink invariants).

## Key facts (verified 2026-06-30, stable enough to cite)

- **SpaceDefinition** (`src/shared/types/spaceDef.ts:28-49`) already holds per-database
  view/config (template, sort, joins, etc.). The `filenameTemplate` field goes here
  (same authority class as `template`).
- **Serialization round-trip** is `spaceDefinitionFrontmatter` (`src/core/types/space.ts:84-99`)
  ↔ `parseSpaceMetadata` (`src/core/superstate/utils/spaces.ts:64-79`). Both must be extended.
- **Metadata change pipeline:** `metadataCache.on('changed')` → `markdownAdapter.metadataChange`
  → `superstate.onMetadataChange` → the enforcer hooks in here.
- **Rename path:** `spaceManager.renamePath` → `superstate.onPathRename` (context row
  updates, link renames, index updates). Existing `pageTitleRename.ts` is the
  reconciliation pattern precedent.
- **Pattern precedent:** `typeProfileMirror.ts` watches metadata changes and auto-writes
  another system — same reentrancy suppression pattern the enforcer needs.
- **Runner:** Opus for all sessions (AGENTS.md binding override, explicit owner directive).

## Cold-start (any model)

`AGENTS.md` → this packet → `bd ready` → claim the top `Notidian-pay5` session issue →
execute its body within scope → verify with evidence (`npm test -- --runInBand` /
`npx tsc --noEmit --skipLibCheck` / `npm run build`) → `bd close` with the evidence →
commit + push.
