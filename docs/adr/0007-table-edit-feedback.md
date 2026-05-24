# ADR 0007: Table Edit Feedback

## Status

Accepted.

## Date

2026-05-24

## Context

ADR 0006 introduced `TableEditTransactionResult` so ordinary table edits can report accepted, skipped, and failed writes. The table UI still needed to surface that result to users.

Without visible feedback, a user can perform a paste, see transient values, and not know whether every target cell was accepted by its owning authority. This is especially risky for frontmatter and file-backed operations where metadata reload can later correct the visible table.

## Decision

Use transient cell-level feedback derived from edit transaction results.

For paste operations:

- Planned writes become pending feedback while the transaction is running.
- Failed transaction issues become failed cell feedback.
- Skipped transaction issues become skipped cell feedback.
- Successful cells clear back to normal once the transaction completes.
- A concise Obsidian notice summarizes failed/skipped counts.

The feedback is UI state only. It does not become durable data and does not change the authority model.

## Boundaries

`TableView` owns transient feedback state because it owns selection, paste handling, and rendered table cells.

Pure helpers in `tableEditFeedback.ts` own:

- Stable cell feedback keys.
- Planned-write to pending-feedback mapping.
- Transaction-result to failed/skipped-feedback mapping.
- Summary text for notices.

`ContextEditorContext` owns edit execution and returns `TableEditTransactionResult` to callers.

## Alternatives Considered

### Only Show Global Notices

Rejected.

Global notices are useful, but they do not tell the user which table cells failed or were skipped.

### Persist Operation Errors In Context MDB

Rejected.

Errors are operation feedback, not database data. Persisting them in MDB would blur the same governance boundary Notidian is trying to protect.

### Rewrite Every Cell Editor Immediately

Rejected for this phase.

The first high-value path is paste feedback because paste can touch many cells and authorities at once. Direct single-cell editor feedback can use the same result model later without broadening this phase.

## Consequences

Positive consequences:

- Bulk paste no longer fails silently at the cell level.
- Users can distinguish pending, failed, and skipped cells.
- The UI consumes the existing transaction result instead of inventing a parallel status model.
- The design leaves room for undo and conflict prompts.

Tradeoffs:

- Direct single-cell editor components still do not render inline failure state in this phase.
- Feedback is transient; users who need a durable audit trail still need the future undo/journal work.

## Implementation Notes

Key files:

- `src/core/utils/contexts/tableEditFeedback.ts`
- `src/core/utils/contexts/tableEditFeedback.test.ts`
- `src/core/react/components/SpaceView/Contexts/TableView/TableView.tsx`
- `src/css/SpaceViewer/TableView.css`

## Follow-Up Work

- Feed direct single-cell editor failures back into the active editor component.
- Add undo journal entries for bulk paste, delete, and fill operations.
- Add conflict detection before overwriting externally changed frontmatter.
- Add fixture-vault integration tests for metadata reload timing.
