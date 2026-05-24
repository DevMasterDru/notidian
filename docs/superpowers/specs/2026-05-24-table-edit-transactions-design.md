# Table Edit Transactions Design

## Goal

Make Notidian table edits use one authority-aware transaction path for pasted cells, single-cell edits, field-value edits, and future grid operations.

The visible table can behave like a Notion or spreadsheet grid, but accepted values must still be written to the owning authority: file path/name, Markdown frontmatter, Notidian context MDB, or computed read-only projection.

## Problem

The current implementation has the right authority model, but write execution is still spread across multiple paths:

- `updateValue` writes single-cell values.
- `updateFieldValue` writes a cell value and updates the column's serialized field options.
- `applyTableEdits` writes paste batches.
- Page-title edits go through dedicated rename helpers.

The paste-revert bug showed why this is risky. The paste path passed an empty path where the single-cell path omitted the path, so frontmatter writes missed the real row file and reloaded old metadata. A unified executor prevents those differences from reappearing.

## Decision

Introduce a shared table edit transaction helper for non-file cell value writes.

The helper will:

- Resolve each edit's row and target file path once.
- Group frontmatter writes by resolved file path.
- Write frontmatter before accepting table/context row changes.
- Apply root table row changes to one accumulated table snapshot.
- Apply linked context-table row changes to one accumulated table snapshot per linked context.
- Apply path overrides from successful file renames before writing non-file cells in a mixed paste transaction.
- Return a structured transaction result with applied, skipped, and failed counts.

File/page-title edits continue to use `executeBulkPageTitleRename` and `renamePageTitleForRow`, because file identity changes need preflight, temporary paths, and rename reconciliation.

## Scope

This phase intentionally focuses on execution correctness.

Included:

- Shared execution utility for ordinary cell writes.
- Structured transaction result.
- Reuse from paste and single-cell edit paths.
- Unit tests for path fallback, frontmatter gating, root-row batching, context-row batching, and failure behavior.

Not included yet:

- Visual pending/error cell states.
- Undo journal.
- External edit conflict prompts.
- Property key rename/delete flows.
- `.base` import/export.

Those features should build on the transaction result rather than each owning a new persistence path.

## Data Flow

```text
cell edit or paste
  -> TableCellWrite[]
  -> executeTableValueWrites
  -> frontmatter write batches
  -> root table snapshot update
  -> linked context table snapshot updates
  -> TableEditTransactionResult
```

`executeTableValueWrites` receives dependencies instead of importing React or Obsidian hooks. This keeps the core behavior testable.

## Result Model

The transaction result reports:

- `ok`: false if any canonical write failed.
- `applied`: number of accepted writes.
- `skipped`: skipped writes such as missing rows, missing paths, or missing linked context tables.
- `failed`: failed writes such as frontmatter write failures.

The first UI integration can continue returning `Promise<void>` to existing callers, but internally it should use this result. Later UI work can expose the same result as cell-level pending/error feedback.

## Invariants

- Frontmatter-backed values are not saved into context rows as accepted values when frontmatter write fails.
- Empty explicit paths are treated as missing and fall back to the row path.
- Multiple writes to the same row are applied to one table snapshot.
- Multiple writes to the same linked context are applied to one context table snapshot.
- Computed/file writes are not handled by this helper.
- File/page-title writes remain delegated to rename transaction helpers.

## Testing

Tests should be pure Jest tests with injected dependencies.

Required cases:

- Empty path falls back to row file path.
- Frontmatter writes are grouped by resolved path.
- Failed frontmatter write stops the transaction before saving table snapshots.
- Multiple root writes update one accumulated table snapshot.
- Linked context writes update the matching row by `File` path.
- Missing linked context tables are skipped and reported.

## Follow-Up Work

- Add UI pending/error state using `TableEditTransactionResult`.
- Add undo journal entries for bulk paste and delete.
- Add vault fixture integration tests for edit, metadata reload, and rehydration.
- Add conflict detection for external edits.
