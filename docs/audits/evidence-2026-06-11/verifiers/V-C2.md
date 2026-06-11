## Verdict
CONFIRMED

## Trace
1. `ContextEditorContext` derives rendered row ids from current row position: `tableData.rows.map((r, index) => ({ _index: index.toString(), ...r }))` at `src/core/react/context/ContextEditorContext.tsx:521-552`, then provides `filteredData` and `applyTableEdits` at `src/core/react/context/ContextEditorContext.tsx:1421-1448`.
2. `TableView` aliases `filteredData` to `data` and receives `applyTableEdits` at `src/core/react/components/SpaceView/Contexts/TableView/TableView.tsx:408-425`.
3. Direct cell edit reads `rowIndex` from `data[index]._index` at `src/core/react/components/SpaceView/Contexts/TableView/TableView.tsx:970-973`, creates an undo write with `rowId: rowIndex.toString()` and no `path` at `src/core/react/components/SpaceView/Contexts/TableView/TableView.tsx:976-980`, performs the forward write through `updateData(..., rowIndex)` at `src/core/react/components/SpaceView/Contexts/TableView/TableView.tsx:989-994`, then pushes undo at `src/core/react/components/SpaceView/Contexts/TableView/TableView.tsx:995-998`.
4. `pushDirectTableUndo` builds the journal entry from `rows: data`, `columns: cols`, and the direct write at `src/core/react/components/SpaceView/Contexts/TableView/TableView.tsx:637-649`.
5. `tableUndoWriteForDirectEdit` includes `path` only if one was supplied at `src/core/utils/contexts/tableUndoJournal.ts:54-75`. For non-file writes, `currentPathAfterWrite` returns only `write.path`, not the row path, at `src/core/utils/contexts/tableUndoJournal.ts:107-116`.
6. Manual row drag persists a reordered `tableData.rows` via `saveDB({ ...tableData, rows: moveResult.rows })` at `src/core/react/components/SpaceView/Contexts/TableView/TableView.tsx:1593-1606`; it clears sort/group predicate only at `src/core/react/components/SpaceView/Contexts/TableView/TableView.tsx:1620-1626`, with no undo-stack invalidation.
7. Cmd+Z reads the table undo journal and replays `undoEntry.writes` through `applyTableEdits` at `src/core/react/components/SpaceView/Contexts/TableView/TableView.tsx:779-788`.
8. `applyTableEdits` routes non-file writes into `executeValueWrites` at `src/core/react/context/ContextEditorContext.tsx:853-903`, which calls `executeTableValueWrites` with current `tableData` at `src/core/react/context/ContextEditorContext.tsx:772-805`.
9. `executeTableValueWrites` resolves rows by `rows[parseInt(write.rowId)]` at `src/core/utils/contexts/tableEditTransaction.ts:110-112`, uses the current row path when `write.path` is absent at `src/core/utils/contexts/tableEditTransaction.ts:223-226`, and writes frontmatter to that resolved path at `src/core/utils/contexts/tableEditTransaction.ts:241-287`.

## Evidence
Repro test: `src/core/utils/contexts/__audit__/c2-undo-wrong-row.audit.test.ts`

Key assertions:
- Realistic direct-edit undo write has `rowId: "0"` and no `path`: `src/core/utils/contexts/__audit__/c2-undo-wrong-row.audit.test.ts:38-44`
- Reordered table puts `B.md` at current row index `0`: `src/core/utils/contexts/__audit__/c2-undo-wrong-row.audit.test.ts:56-61`
- Undo replay writes `{ status: "old-a" }` to `B.md`: `src/core/utils/contexts/__audit__/c2-undo-wrong-row.audit.test.ts:94-101`

Test output:
```text
PASS src/core/utils/contexts/__audit__/c2-undo-wrong-row.audit.test.ts
  audit c2 undo wrong row
    ✓ replays a direct-edit undo to the current row at the old index after manual row reorder (1 ms)

Test Suites: 1 passed, 1 total
Tests:       1 passed, 1 total
```

## Severity check
Original severity holds for manual row reordering: this is silent cross-file frontmatter corruption after a supported table action and Cmd+Z. The sort-change example is not confirmed by this trace because sorting changes visible order but not `tableData.rows`; the confirmed critical path is persisted manual row reorder.

## Fix sketch
- Bind undo/redo value writes to file identity, not only row index.
- In undo history creation, store `path: write.path ?? row[PathPropertyName]` for non-file authorities; preserve the existing file-title post-rename path behavior.
- Ensure direct-edit redo writes also receive the same path, either in `tableUndoWriteForDirectEdit` callers or centrally in `createTableUndoEntry`.
- Keep replay through `executeTableValueWrites`; its path-first resolution and frontmatter conflict check then target the original file.
- Add a normal regression test that expects undo after reorder to write `A.md`, not `B.md`.