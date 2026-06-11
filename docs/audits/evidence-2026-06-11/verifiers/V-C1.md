## Verdict
CONFIRMED

## Trace
- Direct cell edit builds undo intent from the edited cell value, then calls table meta `updateData`: `src/core/react/components/SpaceView/Contexts/TableView/TableView.tsx:974`, `:989`.
- `updateData` is bound to `ContextEditorContext.updateValue`: `src/core/react/components/SpaceView/Contexts/TableView/TableView.tsx:1190`.
- Undo entry creation uses rendered `data` rows and stores inverse `writes` plus `redoWrites`: `src/core/react/components/SpaceView/Contexts/TableView/TableView.tsx:637`, `src/core/utils/contexts/tableUndoJournal.ts:128`, `:143`, `:160`.
- External reload updates current `tableData`, not a journal snapshot: `src/core/react/context/ContextEditorContext.tsx:372`, `:379`, `:330`, `:347`, `:353`.
- `data` is recomputed from current `tableData.rows`: `src/core/react/context/ContextEditorContext.tsx:521`.
- Cmd+Z/Cmd+Y replay journal writes through current `applyTableEdits`: `src/core/react/components/SpaceView/Contexts/TableView/TableView.tsx:893`, `:899`, `:810`, `:818`.
- `applyTableEdits` sends value writes to `executeValueWrites`: `src/core/react/context/ContextEditorContext.tsx:853`, `:901`.
- `executeValueWrites` passes current `tableData` and current canonical frontmatter from `pathsIndex`: `src/core/react/context/ContextEditorContext.tsx:772`, `:775`, `:787`.
- Conflict gate compares canonical value to `rowValueForWrite(row, write)` where `row` came from current `tableData.rows`: `src/core/utils/contexts/tableEditTransaction.ts:210`, `:248`, `:249`.
- If canonical C equals current row C, the undo write is accepted and persisted as A: `src/core/utils/contexts/tableEditTransaction.ts:264`, `:283`, `:307`.

## Evidence
Repro test: `src/core/utils/contexts/__audit__/c1-undo-stale-overwrite.audit.test.ts`

Relevant output:
```text
PASS src/core/utils/contexts/__audit__/c1-undo-stale-overwrite.audit.test.ts
  audit c1 undo/redo stale overwrite
    ✓ accepts stale undo when current tableData already matches newer canonical frontmatter (2 ms)
    ✓ accepts stale redo when current tableData already matches newer canonical frontmatter (1 ms)
```

Command run:
```bash
npx jest src/core/utils/contexts/__audit__/c1-undo-stale-overwrite.audit.test.ts --runInBand
```

## Severity check
Original SEV-critical holds. This is silent canonical frontmatter data loss after a realistic external edit plus table reload; no conflict feedback fires because the transaction result has `applied: 1` and `skipped: []`.

## Fix sketch
- Add an optional expected-current/base value to replay writes, populated by `createTableUndoEntry`.
- For undo, expected current should be the accepted forward value; for redo, expected current should be the inverse/restored value.
- In `executeTableValueWrites`, compare canonical frontmatter against `write.expectedCurrentValue ?? rowValueForWrite(row, write)`.
- Preserve this field in undo/redo history while still stripping `forceFrontmatterWrite`.
- Convert the audit repro into a normal regression test and assert `frontmatter-conflict`.
- Next step: tell me whether to implement the fix now.