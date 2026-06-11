## Verdict

Test adequacy is strong for pure authority utilities and planning helpers, but weaker for the React and Obsidian event paths that actually deliver those guarantees in the plugin. The suite mostly proves “the helper behaves” rather than “the UI bridge always calls the helper with live Obsidian state.” No complete guarantee is totally untested, but several are only partially pinned or depend on the opt-in real-vault harness.

## Findings

### [SEV-high] Several claimed guarantees are only partially pinned outside opt-in smoke

Evidence: `docs/current-state.md:286-306`

> "Notidian currently guarantees the following for implemented edit paths"

Guarantee matrix:

| Guarantee | Pinning tests |
| --- | --- |
| G1 frontmatter accepted only after write succeeds | `src/core/utils/contexts/tableEditTransaction.test.ts:235` "does not save table snapshots when a canonical frontmatter write fails"; `src/core/utils/properties/frontmatterWrite.test.ts:4` |
| G2 paste empty path fallback | `src/core/utils/contexts/tablePasteExecution.test.ts:9` |
| G3 stale edits skipped | `src/core/utils/contexts/tableEditTransaction.test.ts:254` |
| G4 Apply anyway required | Partial: `src/core/utils/contexts/tableEditTransaction.test.ts:331`; UI click only in opt-in harness docs `docs/real-vault-smoke-harness.md:133-136`; NONE in normal Jest for the rendered action path |
| G5 accumulated snapshots | `src/core/utils/contexts/tableEditTransaction.test.ts:202`; `src/core/utils/contexts/tablePasteExecution.test.ts:27` |
| G6 mixed title/property paste uses renamed path | Partial: `src/core/utils/contexts/tableEditTransaction.test.ts:166`; NONE for full `ContextEditorContext.applyTableEdits` mixed rename/value bridge |
| G7 direct failure inline/reset | Partial helpers: `src/core/utils/contexts/tableEditFeedback.test.ts:55`, `:81`, `:122`; NONE for direct rendered failure/remount path |
| G8 undo through authority-aware paths | Helpers: `src/core/utils/contexts/tableUndoJournal.test.ts:78`, `:143`, `:366`; opt-in UI smoke docs `docs/real-vault-smoke-harness.md:124-126` |
| G9 redo without forced flags | `src/core/utils/contexts/tableUndoJournal.test.ts:274`; opt-in UI smoke docs `docs/real-vault-smoke-harness.md:127` |
| G10 immediate undo after title paste path | `src/core/utils/contexts/tableUndoJournal.test.ts:143`; NONE for metadata-timing fixture |
| G11 MDB not source for frontmatter/computed | `src/core/utils/properties/propertyAuthority.test.ts:46`; `src/core/utils/properties/allProperties.test.ts:411`; `src/core/spaceManager/filesystemAdapter/filesystemAdapter.test.ts:30` |
| G12 legacy migration preserves MDB-only/conflicts | `src/core/utils/contexts/legacyContextMigration.test.ts:157`, `:186` |
| G13 CLI read-only and partial scans not ready | `scripts/notidianLegacyContextAudit.test.js:107`, `:175` |
| G14 schema planning previews consequences | `src/core/utils/contexts/notidianSchema.test.ts:86`, `:126`, `:231`; `notidianSchemaApply.test.ts:4` |
| G15 header labels alias, not YAML rename | `src/core/utils/contexts/propertyNameValue.test.ts:5` |
| G16 frontmatter delete hide-only | `src/core/utils/contexts/propertyColumnActions.test.ts:40`; `notidianSchema.test.ts:250` |
| G17 type changes limited to file-backed surface | `src/core/utils/contexts/propertyTypeMenu.test.ts:10`, `:39`, `:55`, `:85`; opt-in UI smoke docs `docs/real-vault-smoke-harness.md:128` |

Why it matters: the core architecture rule is protected well in pure helpers, but guarantees G4, G6, G7, G8, G9, and G10 can still regress at the UI/bridge layer without failing normal Jest.

Suggested fix direction: add focused bridge/integration tests for `ContextEditorContext.applyTableEdits`, `TableView` failure feedback, mixed title/property paste, and immediate undo/redo behavior.

Confidence: high. Cheapest confirmation: `rg -n "describe\\(|it\\(" src/core/react`.

### [SEV-high] ContextEditorContext and TableView are critical write bridges with no direct Jest coverage

Evidence: `docs/current-state.md:341-346`

> "Table UI, selection, clipboard shortcuts, feedback wiring | TableView.tsx"

> "Context editor write bridge | ContextEditorContext.tsx"

Evidence: `src/core/react/context/ContextEditorContext.tsx:775-805`

> "return executeTableValueWrites({"

Evidence: `src/core/react/components/SpaceView/Contexts/TableView/TableView.tsx:753-774`

> "const result = await applyTableEdits(plan.writes);"

Why it matters: these files bind row ids, visible order, resolved paths, current frontmatter snapshots, feedback, and undo journal updates. A wrong bridge argument could bypass the architecture guarantees while all pure helper tests still pass.

Suggested fix direction: add a small test harness around the provider/component with mocked `superstate`, not a full app render.

Confidence: high. Cheapest confirmation: render `TableView` with one frontmatter row, paste into it, and assert `applyTableEdits` receives file/metadata authority writes.

### [SEV-medium] Obsidian API semantics are mostly not mocked, so timing bugs can hide

Evidence: `jest.config.js:3`

> `testEnvironment: "node"`

Evidence: `src/adapters/obsidian/filetypes/markdownAdapter.ts:473-486`

> "await this.app.fileManager.processFrontMatter"

Evidence: `src/main.ts:213-216`

> `this.app.metadataCache.on("changed", this.metadataChange);`

Why it matters: `processFrontMatter`, metadata cache updates, rename events, and cache refresh ordering are the riskiest real-Obsidian semantics. Normal unit tests bypass them; the live harness catches some, but not broad timing races.

Suggested fix direction: introduce a narrow fake Obsidian adapter that models delayed metadata-cache updates and rename side effects.

Confidence: high. Cheapest confirmation: add a test where `processFrontMatter` resolves before metadata cache updates, then assert conflict detection still sees canonical state.

### [SEV-medium] Superstate event flow is thinly tested compared with its role in reconciliation

Evidence: `src/core/superstate/superstate.ts:586-600`

> "this.addToContextStateQueue(() => updateContextWithProperties"

Evidence: `src/core/superstate/superstate.ts:627-638`

> "Rename context rows before indexing the new path"

Evidence: `src/core/superstate/cacheParsers.test.ts:26-27`

> "parseContextTableToCache property materialization"

Why it matters: rename reconciliation and stale frontmatter handling rely on event order and queued context updates. Current tests cover parsing/materialization, not `onMetadataChange`, `onPathRename`, or queue sequencing.

Suggested fix direction: add event-flow tests with fake `spaceManager`, `pathsIndex`, and delayed queue operations.

Confidence: medium. Cheapest confirmation: invoke `onPathRename` with a context row and assert rename/remove/reload ordering.

### [SEV-medium] Lower-level MDB adapter persistence is reachable but untested

Evidence: `src/main.ts:429`

> `this.registerExtensions(["mdb"], MDB_FILE_VIEWER_TYPE);`

Evidence: `src/main.ts:584`

> `this.mdbFileAdapter = new MDBFileTypeAdapter(this);`

Evidence: `src/adapters/mdb/mdbAdapter.ts:188-199`

> "const tables = { [fragmentId]: content(mdbTable) };"

Why it matters: `FilesystemSpaceAdapter.saveTable` strips frontmatter-backed rows before saving, but `MDBFileTypeAdapter.saveContent("mdbTable")` writes the caller’s table content into SQLite. This is not a proven bug, but it is a reachable persistence layer without a direct test asserting frontmatter-backed values cannot leak if another path uses it.

Suggested fix direction: either enforce stripping at the MDB adapter boundary for context tables or add a regression test proving every active context-table write reaches the filesystem strip wrapper.

Confidence: medium. Cheapest confirmation: search all `saveFileFragment(..., "mdbTable"` callers and test any path that can receive context tables.

## Swept clean

- `executeTableValueWrites` has strong unit coverage for frontmatter write gating, stale conflict skips, forced writes, accumulated snapshots, linked contexts, and option config persistence.
- Page-title utilities cover invalid titles, duplicate rejection, same-folder rename, temp swap renames, row-order reconciliation, and duplicate-row cleanup.
- MDB source-of-truth stripping is covered at pure helper and `FilesystemSpaceAdapter.saveTable` levels.
- Legacy migration planning and CLI reporting cover context-only values, conflicts, read-only mode, and partial-scan blocking.
- Schema planning covers create, rename classification, delete preview, write ordering, hide-only delete, alias labels, and type-menu restrictions.
- Verification tooling is tested for planned source/live gate commands and fail-fast behavior.

## Improvement paths

1. Add the five highest-value missing tests:
   - `ContextEditorContext.applyTableEdits` mixed paste: setup one file rename write plus one frontmatter write; action `applyTableEdits`; assert value write path is overridden to the renamed path.
   - `TableView` direct failure feedback: setup `updateData` returning a failed transaction; action edit a cell; assert failed feedback renders and reset token remounts canonical value.
   - Realistic stale metadata timing: setup fake `processFrontMatter` resolving before metadata cache changes; action edit same property twice; assert stale detection uses canonical metadata, not optimistic row data.
   - `Superstate.onPathRename` ordering: setup context row and queued rename/remove calls; action rename path; assert context row is renamed before reload appends duplicates.
   - `MDBFileTypeAdapter.saveContent("mdbTable")`: setup frontmatter-backed and computed columns; action save table; assert persisted DB rows exclude those values or prove caller sanitization.

2. Make the live harness gap explicit in CI policy: normal Jest is unit coverage; `verify:live --ui` is the only coverage for real DOM/Obsidian edit paths.

3. Add a small Obsidian-semantics fake for `processFrontMatter`, `metadataCache.changed`, and `fileManager.renameFile` so timing regressions do not require a full live vault to catch.

Next step: prioritize the five missing tests above in the central audit consolidation.