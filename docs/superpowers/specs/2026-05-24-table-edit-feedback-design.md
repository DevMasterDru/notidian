# Table Edit Feedback Design

## Goal

Make Notidian table edits visibly honest while preserving the canonical data model.

When a paste or future grid operation begins, affected cells should show a pending state. When the authority transaction completes, successful cells return to normal, skipped cells are marked as skipped, and failed cells are marked as failed.

## Problem

`executeTableValueWrites` now returns a structured transaction result, but the table UI still treats edits as fire-and-forget. That means users can see a value briefly, then lose it after metadata reload, without a clear cell-local explanation.

The result should be surfaced in the table layer before adding broader features such as undo, fill handle, or conflict prompts.

## Decision

Add a small feedback mapping layer between table edit plans and rendered table cells.

The layer will:

- Convert planned writes to pending cell feedback.
- Convert transaction failures and skips to failed/skipped cell feedback.
- Generate concise user notifications from transaction results.
- Leave successful cells unmarked after the transaction completes.

This phase uses CSS classes and Obsidian notices. It does not add a persistent error sidebar or full audit log.

## Behavior

For paste:

```text
paste plan writes
  -> pending cell feedback
  -> applyTableEdits(...)
  -> transaction result
  -> failed/skipped cell feedback or clear success
```

For direct single-cell edits, the transaction result is returned by context methods for future cell-editor feedback. This phase does not rewrite every individual editor component.

## UI States

- Pending: subtle tinted outline while the transaction is in flight.
- Failed: red outline/background, with the failure reason in the cell title.
- Skipped: muted warning outline/background, with the skip reason in the cell title.

These states should not store data. They are transient UI feedback derived from the current operation result.

## Non-Goals

- No undo journal in this phase.
- No external edit conflict prompts in this phase.
- No persistent operation history in this phase.
- No rewrite of all cell editor components in this phase.

## Follow-Up Work

- Feed direct single-cell editor failures back into the active editor component.
- Add an undo journal for bulk table operations.
- Add conflict detection before overwriting externally changed frontmatter.
- Add fixture-vault integration tests for reload timing.
