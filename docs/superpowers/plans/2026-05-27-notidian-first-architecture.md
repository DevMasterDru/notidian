# Notidian-First Architecture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Notidian a final, coherent, Notidian-first database system: Notidian is the primary Notion-like table UX, Markdown files/frontmatter/file identity are canonical ordinary data, context MDB is limited to explicit Notidian/legacy/view state, and Bases remains optional interoperability rather than the product center.

**Architecture:** Notidian-first canonical file architecture. A database is a Notidian view over Markdown files. Row identity is file path. Page title is file basename edited through rename/move transactions. Ordinary fields are frontmatter-backed. View state and explicit Notidian-only state may live in context MDB. `.base` support is import/export/mirror/custom-view compatibility and must never become hidden ordinary data authority.

**Tech Stack:** TypeScript, React, Obsidian plugin APIs, Markdown/frontmatter, existing Make.md context MDB infrastructure, Jest, Obsidian CLI, Notidian real-vault harness, optional Obsidian Bases `.base` interop.

---

## Phase 0: Lock The Decision

- [x] Verify [ADR 0013](../../adr/0013-notidian-first-canonical-file-architecture.md) exists and states that it supersedes ADR 0011 as the strategic product direction.
- [x] Verify [Notidian System Architecture](../../notidian-system-architecture.md) exists and defines the system layers, canonical owners, write architecture, schema architecture, legacy migration, Bases compatibility, AI guidance, and verification gates.
- [x] Update [Current State](../../current-state.md) so "Product Direction" says Notidian-first canonical file architecture, not Bases-first convergence.
- [x] Update [ADR README](../../adr/README.md) so ADR 0013 is listed as the current governing architecture and ADR 0011 is historical/superseded.
- [x] Update [Docs README](../../README.md) so the architecture reference and ADR 0013 are the top-level strategic sources.
- [x] Update [Bases Adapter](../../base-adapter.md) so `.base` export/custom view is described as optional compatibility and proof, not the replacement path.
- [x] Update [Table Database Workflows](../../table-database-workflows.md) so practical guidance says Notidian view state is primary and `.base` is optional interop.
- [x] Update `/Users/druker/.agents/skills/obsidian-skills/notidian/SKILL.md` so agents default to Notidian-first canonical files and use `obsidian-bases` only for `.base` compatibility semantics.
- [x] Run:

  ```bash
  rg -n "Bases-first|Bases backed|Bases-backed|strategic north star|long-term target|replace the current context-backed" docs /Users/druker/.agents/skills/obsidian-skills/notidian/SKILL.md -g '!**/2026-05-27-notidian-first-architecture.md'
  git diff --check
  ```

  Accept matches only in historical ADR 0011/0012 text that explicitly points to ADR 0013 or marks the wording as superseded.

## Phase 1: Make The Notidian Table The Primary Database Surface

- [ ] Audit table entry points in [TableView.tsx](../../../src/core/react/components/SpaceView/Contexts/TableView/TableView.tsx), [ContextEditorContext.tsx](../../../src/core/react/context/ContextEditorContext.tsx), and [main.ts](../../../src/main.ts).
- [ ] Ensure user-facing commands and copy call the primary surface "Notidian Table" or "Notidian Database", not "Make.md context" or "Bases table".
- [ ] Add a pure `src/core/utils/contexts/notidianDatabaseModel.ts` module with these exported types:

  ```ts
  export type NotidianColumnAuthority = "file" | "frontmatter" | "formula" | "notidian" | "legacy";
  export type NotidianRowIdentity = { path: string; basename: string; extension: string };
  export type NotidianCellAuthority =
    | { type: "fileName"; path: string }
    | { type: "frontmatter"; path: string; key: string }
    | { type: "formula"; expressionId: string }
    | { type: "notidian"; contextPath: string; fieldId: string }
    | { type: "legacy"; contextPath: string; fieldId: string };
  ```

- [ ] Add `src/core/utils/contexts/notidianDatabaseModel.test.ts` covering column authority classification for file title, file projections, frontmatter fields, formulas, explicit Notidian fields, and legacy fields.
- [ ] Refactor paste/feedback/transaction callers to use this authority classification before planning writes.
- [ ] Run:

  ```bash
  npm test -- --runInBand src/core/utils/contexts/notidianDatabaseModel.test.ts
  npm test -- --runInBand
  npx tsc -noEmit -skipLibCheck
  ```

## Phase 2: Complete Context-Backed Table Redo

- [ ] Extend [tableUndoJournal.ts](../../../src/core/utils/contexts/tableUndoJournal.ts) so it keeps both undo and redo stacks for context-backed tables.
- [ ] Add a redo API that replays the original accepted forward writes through `applyTableEdits`, not through direct table-state mutation.
- [ ] Clear redo history after any new forward edit.
- [ ] Ensure forced conflict-apply writes do not store a reusable force flag in redo entries.
- [ ] Update [TableView.tsx](../../../src/core/react/components/SpaceView/Contexts/TableView/TableView.tsx) to bind `Cmd/Ctrl+Shift+Z` and `Cmd/Ctrl+Y` to redo when the table is focused.
- [ ] Add tests in [tableUndoJournal.test.ts](../../../src/core/utils/contexts/tableUndoJournal.test.ts) for paste redo, cut redo, clear redo, mixed title/property redo, redo clearing on new edit, and conflict surfacing during redo.
- [ ] Update [Table Database Workflows](../../table-database-workflows.md) and [Current State](../../current-state.md) to remove the context-backed redo gap after implementation.
- [ ] Run:

  ```bash
  npm test -- --runInBand src/core/utils/contexts/tableUndoJournal.test.ts
  npm test -- --runInBand
  npx tsc -noEmit -skipLibCheck
  npm run build
  ```

## Phase 3: Canonical Schema Service

- [ ] Add `src/core/utils/contexts/notidianSchema.ts`.
- [ ] Implement `discoverFrontmatterSchema(rows)` as a pure helper that returns observed keys, observed value types, missing counts, and conflict-safe display types.
- [ ] Implement `planCreateProperty`, `planRenameProperty`, and `planDeleteProperty` as pure planners.
- [ ] `planRenameProperty` must report files with old key only, new key only, both keys with same value, both keys with conflicting values, and neither key.
- [ ] `planDeleteProperty` must distinguish "hide from view" from "delete key from files".
- [ ] Add `src/core/utils/contexts/notidianSchema.test.ts` covering mixed observed types, rename collisions, delete-preview counts, empty folders, and frontmatter keys that differ only by case.
- [ ] Add UI wiring for property create/rename/delete in the existing table header/property controls without directly writing MDB-only ordinary properties.
- [ ] Add a preview modal for destructive rename/delete operations. Reuse existing modal patterns in `src/core/react/components` and avoid adding a second confirmation system.
- [ ] Run:

  ```bash
  npm test -- --runInBand src/core/utils/contexts/notidianSchema.test.ts
  npm test -- --runInBand
  npx tsc -noEmit -skipLibCheck
  ```

## Phase 4: Row Creation, Deletion, And Move Transactions

- [ ] Add `src/core/utils/contexts/notidianRows.ts`.
- [ ] Implement `planCreateRow(folderPath, requestedTitle, initialFrontmatter)` to choose a safe Markdown path, reject path traversal, and preserve frontmatter values.
- [ ] Implement `planDeleteRows(paths, mode)` where `mode` is `"delete-files"` or `"remove-from-view"`; folder-scoped file databases should make the destructive nature explicit.
- [ ] Implement `planMoveRows(paths, targetFolder)` for future folder move support from table commands.
- [ ] Add tests in `src/core/utils/contexts/notidianRows.test.ts` for duplicate file names, invalid titles, target folder missing, move collision, delete preview, and initial frontmatter serialization.
- [ ] Wire table row creation to create real Markdown files with frontmatter before inserting the row into the projection.
- [ ] Add a dedicated move command instead of accepting slashes in the title cell.
- [ ] Run:

  ```bash
  npm test -- --runInBand src/core/utils/contexts/notidianRows.test.ts
  npm test -- --runInBand
  npx tsc -noEmit -skipLibCheck
  ```

## Phase 5: Conflict Resolution Center

- [ ] Add `src/core/utils/contexts/tableConflictResolution.ts`.
- [ ] Model conflict actions as `reload`, `keep-canonical`, `apply-anyway`, and `merge`.
- [ ] Preserve current inline Reload and Apply anyway behavior as the minimum UI.
- [ ] Add a multi-cell conflict modal for paste/fill operations with a row-by-row preview of rendered value, current frontmatter value, attempted value, and selected resolution.
- [ ] Add tests in `src/core/utils/contexts/tableConflictResolution.test.ts` for single-cell conflict, multi-cell conflict, merge preview, and forced write replay without reusable force flags.
- [ ] Run:

  ```bash
  npm test -- --runInBand src/core/utils/contexts/tableConflictResolution.test.ts
  npm test -- --runInBand
  npx tsc -noEmit -skipLibCheck
  ```

## Phase 6: Legacy Make.md Write Migration

- [ ] Extend [legacyContextMigrationCore.js](../../../src/core/utils/contexts/legacyContextMigrationCore.js) with a pure write plan that produces explicit file writes and context cleanup writes.
- [ ] Add an Obsidian UI command named `Preview Notidian legacy context migration`.
- [ ] Add an Obsidian UI command named `Apply reviewed Notidian legacy context migration`.
- [ ] The apply command must refuse to run if unresolved conflicts or context-only values remain.
- [ ] The apply command must write Markdown/frontmatter first and clean context duplicates only after file writes succeed.
- [ ] Write a Markdown migration report into a Notidian-owned reports folder or present it in a modal without modifying user notes unless the user chooses to save it.
- [ ] Add tests in [legacyContextMigration.test.ts](../../../src/core/utils/contexts/legacyContextMigration.test.ts) for duplicate cleanup, frontmatter backfill, context-only preservation, conflict refusal, and partial-report refusal.
- [ ] Run:

  ```bash
  npm test -- --runInBand src/core/utils/contexts/legacyContextMigration.test.ts
  npm test -- --runInBand scripts/notidianLegacyContextAudit.test.js
  npx tsc -noEmit -skipLibCheck
  ```

## Phase 7: Bases Compatibility Without Bases Ownership

- [ ] Update [notidianBaseAdapter.ts](../../../src/core/utils/bases/notidianBaseAdapter.ts) comments and exported warnings to say `.base` is compatibility, not canonical Notidian storage.
- [ ] Add `.base` import planner in `src/core/utils/bases/notidianBaseImport.ts` that converts supported `.base` scope/properties/views into a Notidian view plan.
- [ ] Add `src/core/utils/bases/notidianBaseImport.test.ts` for folder scope, visible columns, display names, simple filters, unsupported formulas, unsupported relations, and no ordinary data writes.
- [ ] Add an explicit mirror mode design before writing bidirectional mirror code. Mirror mode must define owner per concern and must reject ambiguous ownership.
- [ ] Keep [notidianBasesView.ts](../../../src/adapters/obsidian/bases/notidianBasesView.ts) as optional compatibility. Do not make it required for ordinary Notidian table use.
- [ ] Run:

  ```bash
  npm test -- --runInBand src/core/utils/bases/notidianBaseAdapter.test.ts
  npm test -- --runInBand src/core/utils/bases/notidianBaseImport.test.ts
  npm test -- --runInBand src/adapters/obsidian/bases/notidianBasesView.test.ts
  npx tsc -noEmit -skipLibCheck
  ```

## Phase 8: AI/Vault Database Defaults

- [ ] Update `/Users/druker/.agents/skills/obsidian-skills/notidian/SKILL.md` whenever architecture terms change.
- [ ] Keep `/Users/druker/.agents/skills/obsidian-skills/obsidian-bases/SKILL.md` separate. It should describe `.base` semantics and should defer to Notidian when the user wants Notidian databases.
- [ ] Keep `/Users/druker/.agents/skills/obsidian-skills/obsidian-cli/SKILL.md` separate. It should remain the live-vault verification layer.
- [ ] Add an AI-facing Notidian database creation recipe to the Notidian skill: create Markdown files with frontmatter, then create or update a Notidian view; create `.base` only when native Bases interop is requested.
- [ ] Validate skill YAML/frontmatter with:

  ```bash
  ruby -e 'require "psych"; ARGV.each { |path| text = File.read(path); if text.start_with?("---\n"); Psych.safe_load(text.split(/^---\\s*$/, 3)[1] || ""); end; puts path }' /Users/druker/.agents/skills/obsidian-skills/notidian/SKILL.md /Users/druker/.agents/skills/obsidian-skills/obsidian-bases/SKILL.md /Users/druker/.agents/skills/obsidian-skills/obsidian-cli/SKILL.md
  ```

## Phase 9: Performance And Indexing

- [ ] Profile folder table open for `/Users/druker/Atlas Vault/Relays & Devices` and one larger folder chosen by the user.
- [ ] Ensure schema discovery can sample for preview but marks sampled results as incomplete.
- [ ] Cache projections only when they are rebuildable from files/frontmatter/context view state.
- [ ] Add invalidation tests for file rename, frontmatter edit, external metadata refresh, row create, row delete, and folder move.
- [ ] Do not add a second durable index of ordinary values unless it is explicitly documented as rebuildable cache.

## Phase 10: Real-Vault Verification Matrix

- [ ] Extend [notidianRealVaultHarness.js](../../../scripts/notidianRealVaultHarness.js) with focused flags for context-backed redo, schema rename/delete preview, row create/delete, and move.
- [ ] Keep every live fixture isolated under a generated temporary folder.
- [ ] Ensure cleanup runs unless `--keep-fixture` is passed.
- [ ] Run the full local verification set before claiming system health:

  ```bash
  npm test -- --runInBand
  npx tsc -noEmit -skipLibCheck
  npm run build
  perl -pi -e 's/[ \t]+$//' main.js
  git diff --check
  npm run install:vault -- --vault-path="/Users/druker/Atlas Vault" --allow-write
  npm run test:real-vault -- vault="Atlas Vault" --allow-write
  npm run test:real-vault -- vault="Atlas Vault" --allow-write --base-export
  npm run test:real-vault -- vault="Atlas Vault" --allow-write --base-view
  obsidian vault="Atlas Vault" dev:errors
  ```

## Completion Criteria

- [ ] ADR 0013 is the current governing strategy.
- [ ] The architecture reference describes every durable owner and boundary.
- [ ] The Notidian skill directs agents to Notidian-first canonical files.
- [ ] Ordinary property edits, range edits, undo, and redo write through canonical authorities.
- [ ] File-title edits and bulk title paste remain file transactions.
- [ ] Property create/rename/delete flows do not create hidden ordinary context data.
- [ ] Legacy Make.md context migration is audit-first and write-safe.
- [ ] Bases interop exists without making native Bases mandatory.
- [ ] Real-vault verification proves the table behavior in `/Users/druker/Atlas Vault` without leaving fixtures behind.
