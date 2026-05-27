# ADR 0008: Table Undo Journal

## Status

Accepted.

## Date

2026-05-25

## Context

Notidian table editing now supports bulk paste, cut, clear, fill-from-selection paste, and page-title paste. These operations can touch many cells and can write through different authorities:

- Markdown file names for page-title cells.
- Markdown frontmatter for ordinary file-backed properties.
- Notidian context MDB rows for explicitly Notidian-owned fields.

A Notion-like table experience needs a fast undo path for these bulk operations, but undo must not become a second hidden source of truth. Reverting a bulk edit by mutating rendered rows would recreate the same data-governance problem the fork is designed to remove.

## Decision

Use a table-local, in-memory undo/redo journal for bulk table operations.

Before a bulk table operation executes, `TableView` builds a `TableUndoEntry` from the current rendered row data. The entry stores inverse writes for undo and sanitized accepted forward writes for redo. After the forward operation reports applied writes, the entry is pushed onto a capped undo stack. Pressing `Cmd/Ctrl+Z` in the table pops the entry and replays its inverse writes through `applyTableEdits`. Pressing `Cmd/Ctrl+Shift+Z` or `Cmd/Ctrl+Y` replays the accepted forward writes through the same path.

Undo and redo therefore use the same canonical execution paths as forward edits:

- File-title undo goes through the controlled rename transaction.
- Frontmatter undo writes through Obsidian frontmatter.
- Context-owned value undo writes through context MDB persistence.
- Mixed file/property undo uses the same path override behavior as mixed forward paste.
- Redo history is cleared by any new forward edit.
- Redo writes do not preserve forced conflict flags, so redo cannot silently reuse a previous Apply anyway decision.

## Boundaries

This ADR covers table bulk operations initiated from the table selection model:

- Paste.
- Cut.
- Delete/clear.
- Fill-from-single-cell paste.
- Bulk page-title rename paste.
- Mixed page-title/property paste.

The journal is intentionally:

- In memory only.
- Local to the table component.
- Capped to avoid unbounded growth.
- Cleared by component lifecycle.

It is not:

- A durable audit trail.
- A cross-session undo system.
- A conflict-resolution prompt.
- A full rollback engine for partially applied cross-file failures.

## Why This Is The Best Fit

The user goal is spreadsheet-like freedom without decoupled data governance. A UI-only undo would feel fast but would be wrong because it could show values that frontmatter or the filesystem rejected. A durable hidden journal would add another governance layer and increase migration risk.

The chosen design keeps undo as an operation replay mechanism. The journal stores intent to restore previous values, then sends that intent through the same authority-aware write APIs that normal table edits use.

The critical rename case is handled by storing the expected current path on inverse file writes. This allows immediate undo after a title paste even if Obsidian metadata has not finished reloading the row path yet.

## Alternatives Considered

### Rely On Obsidian's Global Undo

Rejected.

Table operations can involve file renames, frontmatter writes, and context table writes. Obsidian's editor undo does not consistently represent that multi-authority operation as one table-level action.

### Mutate Rendered Rows Back To Previous Values

Rejected.

This would be fast, but it would make the UI lie whenever the canonical file/frontmatter/context write fails. Notidian must not accept table state without canonical acceptance.

### Durable Operation Journal

Deferred.

A durable journal could support cross-session audit and recovery, but it is heavier than needed for the first trust improvement. It would need schema design, migration, retention policy, privacy review, and conflict handling.

### Full Transaction Rollback

Deferred.

True rollback across file renames and frontmatter batches would be useful, but it requires stronger failure recovery and conflict semantics. The in-memory undo journal is safer as a user-invoked reversal path.

## Consequences

Positive consequences:

- Users can undo the main high-risk bulk table operations with `Cmd/Ctrl+Z`.
- Users can redo the last undone bulk table operations with `Cmd/Ctrl+Shift+Z` or `Cmd/Ctrl+Y`.
- Undo and redo respect file/frontmatter/context authority boundaries.
- Immediate undo after title paste does not depend on metadata reload timing.
- No durable hidden data-governance layer is introduced.

Tradeoffs:

- Undo and redo are not available after the table component is destroyed or Obsidian is reloaded.
- Undo and redo do not bypass conflict detection when external edits happened after the original operation.
- A partially failed undo reports failures through table feedback, but it is not a full rollback system.

## Implementation Notes

Key files:

- `src/core/utils/contexts/tableUndoJournal.ts`
- `src/core/utils/contexts/tableUndoJournal.test.ts`
- `src/core/react/components/SpaceView/Contexts/TableView/TableView.tsx`
- `src/core/react/context/ContextEditorContext.tsx`
- `src/core/utils/contexts/tablePastePlan.ts`

The undo helper:

- Captures previous values from rendered row data.
- Uses page titles rather than full paths for inverse file-title values.
- Stores the expected post-edit file path on inverse file writes so immediate undo can rename from the correct current path.
- Stores accepted forward writes for redo.
- Filters skipped and failed targets out of the stored history after execution.
- Removes forced conflict flags before writes are stored for redo.
- Deduplicates repeated target cells.
- Skips unchanged writes.
- Caps the in-memory stack.

## Follow-Up Work

- Add inline conflict-resolution prompts before undo replay overwrites changed frontmatter.
- Add durable audit/recovery only if a clear product need emerges.
- Add real-vault fixture tests covering immediate undo after metadata reload-sensitive renames.
