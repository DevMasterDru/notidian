## Verdict
CONFIRMED

## Trace
- Direct cell edit UI calls `table.options.meta?.updateData(...)` from [TableView.tsx](/Users/druker/Projects/Notidian/src/core/react/components/SpaceView/Contexts/TableView/TableView.tsx:989); field-option edits call `updateFieldValue(...)` at [TableView.tsx](/Users/druker/Projects/Notidian/src/core/react/components/SpaceView/Contexts/TableView/TableView.tsx:1019).
- TanStack meta wires those handlers to `updateValue` / `updateFieldValue` at [TableView.tsx](/Users/druker/Projects/Notidian/src/core/react/components/SpaceView/Contexts/TableView/TableView.tsx:1190). Paste routes through `applyTableEdits` at [TableView.tsx](/Users/druker/Projects/Notidian/src/core/react/components/SpaceView/Contexts/TableView/TableView.tsx:753).
- `ContextEditorContext` exposes those bridge methods at [ContextEditorContext.tsx](/Users/druker/Projects/Notidian/src/core/react/context/ContextEditorContext.tsx:1446).
- `updateValue` builds a single `TableCellWrite` and calls `executeValueWrites` at [ContextEditorContext.tsx](/Users/druker/Projects/Notidian/src/core/react/context/ContextEditorContext.tsx:827); `updateFieldValue` does the same with `fieldValue` at [ContextEditorContext.tsx](/Users/druker/Projects/Notidian/src/core/react/context/ContextEditorContext.tsx:925); paste calls `executeValueWrites(valueWrites)` at [ContextEditorContext.tsx](/Users/druker/Projects/Notidian/src/core/react/context/ContextEditorContext.tsx:901).
- `executeValueWrites` passes the closed-over `tableData` and `contextTable` directly into `executeTableValueWrites` at [ContextEditorContext.tsx](/Users/druker/Projects/Notidian/src/core/react/context/ContextEditorContext.tsx:772).
- The helper applies root writes to that snapshot and calls `saveDB(...)` with the whole resulting table at [tableEditTransaction.ts](/Users/druker/Projects/Notidian/src/core/utils/contexts/tableEditTransaction.ts:301).
- `saveDB` optimistically updates React state, then calls `spaceManager.saveTable(contextPath, newTable, true)` at [ContextEditorContext.tsx](/Users/druker/Projects/Notidian/src/core/react/context/ContextEditorContext.tsx:486).
- `SpaceManager.saveTable` is a direct adapter pass-through, with no queue/version check, at [spaceManager.ts](/Users/druker/Projects/Notidian/src/core/spaceManager/spaceManager.ts:225).
- `filesystemAdapter.saveTable` calls `saveFileFragment(..., () => stripFrontmatterBackedRowValues(table))`, so the freshly read previous fragment is not merged at this layer: [filesystemAdapter.ts](/Users/druker/Projects/Notidian/src/core/spaceManager/filesystemAdapter/filesystemAdapter.ts:530).
- `FilesystemMiddleware.saveFileFragment` delegates directly to the filetype adapter at [filesystem.ts](/Users/druker/Projects/Notidian/src/core/middleware/filesystem.ts:207).
- `MDBFileTypeAdapter.saveContent` does re-read `mdbTable`, but then uses `content(mdbTable)`; the `saveTable` callback ignores `prev`, so this is not a safeguard: [mdbAdapter.ts](/Users/druker/Projects/Notidian/src/adapters/mdb/mdbAdapter.ts:188).
- `saveDBToPath` calls `replaceDB`, and `replaceDB` drops/recreates the target table before writing supplied rows: [db.ts](/Users/druker/Projects/Notidian/src/adapters/mdb/db/db.ts:274), [db.ts](/Users/druker/Projects/Notidian/src/adapters/mdb/db/db.ts:342).

## Evidence
Repro test: [codex-c3-concurrent-snapshot-loss.audit.test.ts](/Users/druker/Projects/Notidian/src/core/utils/contexts/__audit__/codex-c3-concurrent-snapshot-loss.audit.test.ts:18)

The test mirrors `ContextEditorContext` wiring by passing the same captured `tableData` into two concurrent `executeTableValueWrites` calls, then asserts the incorrect final persisted table lost `first-edit`: [codex-c3-concurrent-snapshot-loss.audit.test.ts](/Users/druker/Projects/Notidian/src/core/utils/contexts/__audit__/codex-c3-concurrent-snapshot-loss.audit.test.ts:24), [codex-c3-concurrent-snapshot-loss.audit.test.ts](/Users/druker/Projects/Notidian/src/core/utils/contexts/__audit__/codex-c3-concurrent-snapshot-loss.audit.test.ts:65).

Relevant test output:
```text
PASS src/core/utils/contexts/__audit__/codex-c3-concurrent-snapshot-loss.audit.test.ts
✓ reproduces last-write-wins loss for two root context-owned writes sharing one captured table snapshot (1 ms)
Test Suites: 1 passed, 1 total
Tests: 1 passed, 1 total
```

## Severity check
SEV-high holds for context-owned/legacy MDB values and field option/config writes: accepted user edits can be silently lost by a later full-table save from the same base snapshot. Scope is narrower than ordinary frontmatter-backed cell edits, which have canonical frontmatter conflict checks and are stripped from MDB persistence.

## Fix sketch
- Add a per-context/table serialized write queue or updater API for MDB table saves.
- Re-read the latest table immediately before persisting and merge accepted context-owned row writes into that fresh table.
- Merge rows by stable path / schema identity where possible, not only by closed-over row index.
- Preserve the current frontmatter-first authority flow; only accepted context-owned values/config should merge into MDB.
- Add a focused regression test where two queued edits from one base snapshot persist both values.