## Verdict

This dimension is partially sound inside a single table edit transaction, but not sound across concurrent edit invocations, undo replay, metadata reloads, and debounced view-state saves. The most serious risks are user-visible data loss: undo/redo can silently overwrite newer frontmatter, and undo can target the wrong file after row order changes. I did not run builds or tests per the read-only auditor brief.

## Findings

### [SEV-critical] Undo/redo can silently overwrite newer external frontmatter after reload

Evidence: `src/core/react/components/SpaceView/Contexts/TableView/TableView.tsx:786-788`

```ts
const result = await applyTableEdits(undoEntry.writes);
```

Evidence: `src/core/react/components/SpaceView/Contexts/TableView/TableView.tsx:817-819`

```ts
const result = await applyTableEdits(redoEntry.redoWrites);
```

Evidence: `src/core/utils/contexts/tableEditTransaction.ts:241-253`

```ts
const canonicalValue = currentFrontmatterValue?.({ path: resolvedPath, column, row, write });
const baseValue = rowValueForWrite(row, write);
if (!write.forceFrontmatterWrite && canonicalValue !== undefined && canonicalValue != baseValue) {
```

Why it matters: undo entries store the value to restore, but not the expected current value. If a cell goes `A -> B` in Notidian, then external frontmatter changes `B -> C` and the table reloads to `C`, Cmd+Z compares canonical `C` against current row `C`, sees no conflict, and writes `A`. That violates the frontmatter conflict guarantee.

Suggested fix direction: store `expectedCurrentValue` on undo/redo writes, captured from the accepted forward operation. During replay, compare canonical frontmatter to that expected value, not to the currently reloaded row value.

Confidence: high. Cheapest confirmation: unit test undo after simulating metadata reload to a third value before replay.

### [SEV-critical] Undo writes can target the wrong file after row reordering

Evidence: `src/core/react/components/SpaceView/Contexts/TableView/TableView.tsx:976-980`

```ts
const undoWrite = tableUndoWriteForDirectEdit({
  rowId: rowIndex.toString(),
  column: f,
  value,
});
```

Evidence: `src/core/utils/contexts/tableUndoJournal.ts:107-116`

```ts
if (write.authority != "file") return write.path;
```

Evidence: `src/core/utils/contexts/tableEditTransaction.ts:110-114`

```ts
const rowForWrite = (rows: DBRow[], write: TableCellWrite): DBRow | undefined =>
  rows[parseInt(write.rowId)];
```

Evidence: `src/core/react/components/SpaceView/Contexts/TableView/TableView.tsx:1602-1606`

```ts
saveDB({
  ...tableData,
  rows: moveResult.rows,
});
```

Why it matters: non-file undo writes usually have no path and are replayed by row index. If a user edits row 5, then row ordering changes, Cmd+Z can resolve row 5 to a different Markdown file and write the old value into the wrong file’s frontmatter.

Suggested fix direction: persist resolved target path on every undoable write, not just file-title writes. Prefer path-based row resolution for frontmatter/context row replay, with row index only as a display fallback.

Confidence: high. Cheapest confirmation: test direct frontmatter edit, reorder rows, undo, and assert the original path changes rather than the current row index.

### [SEV-high] Concurrent table edit invocations can drop MDB/context-owned writes

Evidence: `src/core/react/context/ContextEditorContext.tsx:775-803`

```ts
return executeTableValueWrites({
  writes,
  tableData,
  contextTable,
```

Evidence: `src/core/utils/contexts/tableEditTransaction.ts:301-314`

```ts
const tableWithRootWrites =
  rootWrites.length > 0 ? applyRootWrites(tableData, rootWrites) : tableData;
await saveDB({ ...tableWithRootWrites, cols: ... });
```

Evidence: `src/core/spaceManager/filesystemAdapter/filesystemAdapter.ts:543-545`

```ts
return this.fileSystem.saveFileFragment(mdbFile, 'mdbTable', table.schema.id, () =>
  stripFrontmatterBackedRowValues(table)
)
```

Why it matters: each edit invocation builds and saves a full table from the React state snapshot it closed over. Two rapid context-owned edits from the same base table can each save a different full snapshot; the later save can erase the earlier edit. This affects explicit Notidian-owned/legacy MDB data and view state.

Suggested fix direction: add a per-context/schema transaction queue, or re-read and merge inside `saveTable` with optimistic version checks before replacing an MDB table fragment.

Confidence: high. Cheapest confirmation: invoke two `updateValue` calls on different Notidian-owned columns before the first save resolves.

### [SEV-medium] Fresh frontmatter-column import is idempotent only for identical races, not atomic

Evidence: `src/core/react/context/ContextEditorContext.tsx:422-448`

```ts
const frontmatterImportAttempts = useRef(new Set<string>());
...
if (frontmatterImportAttempts.current.has(attemptKey)) return;
frontmatterImportAttempts.current.add(attemptKey);
```

Evidence: `src/core/react/context/ContextEditorContext.tsx:449-474`

```ts
props.superstate.spaceManager
  .readTable(contextPath, dbSchema.id)
...
.saveTable(
  contextPath,
  { ...f, cols: [...(f.cols ?? []), ...freshDiscovered] },
  true
)
```

Why it matters: two identical simultaneous loads save the same columns, so they should not duplicate. But the guard is per mounted component and the save is a whole-table write from a prior read. If metadata discovery or a user schema edit changes between read and save, a later stale import save can drop the concurrent column change.

Suggested fix direction: use a shared per-context import lock plus a save-time re-read/merge, or move this into a schema updater that receives and mutates the latest persisted table.

Confidence: medium. Cheapest confirmation: two mounted providers, delay one save, add a column through the other, then release the delayed import.

### [SEV-medium] Metadata event storms can re-enter full table reloads during bulk frontmatter writes

Evidence: `src/core/utils/contexts/tableEditTransaction.ts:283-287`

```ts
for (const [path, group] of frontmatterChangesByPath.entries()) {
  const writeResult = await saveFrontmatterProperties({ path, properties: group.properties });
```

Evidence: `src/core/superstate/superstate.ts:591-600`

```ts
this.reloadPath(path).then(f => {
  ...
  this.addToContextStateQueue(() => updateContextWithProperties(this, path, allContextsWithFile));
  this.dispatchEvent("pathStateUpdated", {path: path})
});
```

Evidence: `src/core/react/context/ContextEditorContext.tsx:372-380`

```ts
if (tableData?.rows.some((f) => f[PathPropertyName] == payload.path)) {
  retrieveCachedTable(dbSchema);
}
```

Why it matters: bulk paste across M files can trigger M metadata refreshes and M table reloads while the table transaction is still running. I did not find evidence this mutates the helper’s local accumulated snapshot, but it can clobber optimistic UI state, create flicker, and multiply expensive reload work.

Suggested fix direction: coalesce path metadata refreshes per context, and suppress or reconcile table reloads while a table transaction is in flight.

Confidence: medium. Cheapest confirmation: instrument `retrieveCachedTable` count during a multi-file paste.

### [SEV-medium] Fire-and-forget edit shortcuts can leave unhandled rejections or stuck feedback

Evidence: `src/core/react/components/SpaceView/Contexts/TableView/TableView.tsx:878-880`

```ts
navigator.clipboard.readText().then((f) => pasteSelection(f));
```

Evidence: `src/core/react/components/SpaceView/Contexts/TableView/TableView.tsx:887-900`

```ts
redoLastTableOperation();
...
undoLastTableOperation();
```

Evidence: `src/core/react/components/SpaceView/Contexts/TableView/TableView.tsx:769-773`

```ts
const result = await applyTableEdits(plan.writes);
finishCellFeedbackOperation(operationId, result);
```

Evidence: `src/core/react/context/ContextEditorContext.tsx:330-351`

```ts
return spaceManager
  .readTable(...)
  .then(...)
  .catch((error) => {});
```

Why it matters: if `applyTableEdits`, clipboard reads, reloads, or table reads reject, several edit paths have no catch/finally. Pending feedback may remain pending, undo stacks may already have been popped, and reload failures can become silent no-ops.

Suggested fix direction: wrap all async keyboard edit paths in a shared `runTableOperation` helper with catch/finally, failed feedback, and non-empty error logging.

Confidence: high. Cheapest confirmation: mock `applyTableEdits` rejection from paste and assert feedback clears and a notice/log appears.

### [SEV-medium] Stale column-size debounce can overwrite newer predicate/view state

Evidence: `src/core/react/components/SpaceView/Contexts/TableView/TableView.tsx:542-550`

```ts
const debouncedSavePredicate = useCallback(
  debounce(
    (nextValue) =>
      savePredicate({
        colsSize: nextValue,
      }),
    1000
  ),
  [predicate]
);
```

Evidence: `src/core/react/context/ContextEditorContext.tsx:1030-1042`

```ts
const pred = {
  ...(predicate ?? defPredicate),
  ...newPredicate,
};
...
saveSchema({
  ...frameSchema,
  predicate: JSON.stringify(cleanedPredicate),
});
```

Why it matters: the debounced function is recreated as predicate changes, but old pending timers are not canceled. An older timer can call an older `savePredicate` closure and save a full predicate built from stale filters/sort/group state plus the column size update.

Suggested fix direction: keep one debounced saver with a latest-state ref, cancel on unmount/dependency change, or make predicate saves functional/versioned.

Confidence: medium. Cheapest confirmation: resize a column, change filter before 1s, then assert the delayed resize save does not revert the filter.

## Swept clean

- Single-call batching in `executeTableValueWrites` is sound for accumulated snapshots within one invocation: root writes are reduced into one table and linked context writes into one table per context.
- Frontmatter-backed/computed row values are stripped before MDB table persistence via `stripFrontmatterBackedRowValues`, so the audited concurrency issues do not appear to reintroduce durable frontmatter copies into MDB.
- File-title rename paths are more carefully sequenced than ordinary value writes: bulk and single rename wait for settle delay, context queue, context reload, and row reconciliation.
- Listener cleanup in `ContextEditorContext` removes the same `contextStateUpdated`, `spaceStateUpdated`, and `pathStateUpdated` callbacks it registers. I did not find a direct listener leak there.
- The table undo stack is intentionally preserved across React remounts through `tableUndoJournalStore`; the preservation mechanism works, but the stored write identities are not strong enough as noted above.

## Improvement paths

1. Add a per-context/schema edit coordinator: queue table edit transactions, version persisted MDB saves, and coalesce metadata-triggered reloads behind that coordinator.
2. Redesign undo/redo write records to include resolved target path and expected current/base value; replay should use those, not current row index/current rendered value.
3. Add focused race tests: concurrent context-owned edits, undo after external frontmatter reload, undo after row reorder, delayed frontmatter import save, and delayed column-size debounce.