# ADR 0006: Unified Table Edit Transactions

## Status

Accepted.

## Date

2026-05-24

## Context

Notidian now supports frontmatter-backed table columns, editable page titles, and range clipboard paste. The authority model is correct, but ordinary value-write execution had begun to split across several code paths:

- Single-cell value edits used `updateValue`.
- Field-option value edits used `updateFieldValue`.
- Range paste used `applyTableEdits`.
- Page-title edits used rename helpers.

The paste-revert bug exposed the risk of this split. The paste path passed an empty string as the file path, while the single-cell path omitted the path and fell back to the row's `File` value. The UI briefly showed the pasted value, but the canonical frontmatter did not change, so metadata reload restored the old value.

## Decision

Use a shared table edit transaction helper for ordinary table value writes.

`executeTableValueWrites` is the shared path for:

- Single-cell value edits.
- Field-option edits that also update a cell value.
- Range paste value writes.
- Future clear, fill, and multi-cell grid operations.

The helper is dependency-injected so it can be tested without React or a running Obsidian app. It receives current table data, linked context tables, authority helpers, parse helpers, path resolution, and save functions.

## Boundaries

The helper owns ordinary non-file value writes:

- Resolve the row and target file path once.
- Treat empty explicit paths as missing and fall back to the row path.
- Group frontmatter changes by resolved file path.
- Write frontmatter before saving accepted table row changes.
- Apply multiple root-table writes to one accumulated table snapshot.
- Apply linked context writes to one accumulated context table snapshot per context.
- Apply row-path overrides after mixed file rename transactions so non-file values in the same paste target the renamed file path.
- Return a structured result with applied, skipped, and failed writes.

The helper does not own page identity edits. File/page-title changes still go through `renamePageTitleForRow` and `executeBulkPageTitleRename`, because file identity needs rename preflight, temporary paths, metadata settling, row-order preservation, and duplicate-row reconciliation.

## Why This Is The Best Fit

The user wants a table that feels like Notion or a spreadsheet, but without hidden data governance. That requires many UI gestures to exist: direct typing, paste, delete, fill, cut, and undo. If each gesture writes data through its own path, subtle differences become data bugs.

A shared transaction helper makes the table UX expandable while keeping the authority boundary explicit. UI features can be added as edit intents, then delegated to the same persistence path.

## Alternatives Considered

### Keep Separate Edit Paths

Rejected.

Separate paths already caused an observable persistence bug. Even if each path is fixed individually, future features would likely repeat the problem.

### Route Everything Through Paste Writes

Rejected.

Paste writes were designed as a clipboard planning output, not as the general edit model. The transaction helper uses a smaller `TableCellWrite` shape that normal edits, field edits, and paste can all produce.

### Include File Renames In The Same Helper

Rejected for now.

File renames are not ordinary value writes. They require preflight, conflict checks, temporary paths, rollback attempts, metadata settling, and context row reconciliation. Keeping them separate preserves clarity.

## Consequences

Positive consequences:

- Paste and single-cell edits now share frontmatter path fallback behavior.
- Failed canonical frontmatter writes stop table row acceptance.
- Stale frontmatter-backed writes are skipped before they can overwrite newer canonical values.
- Multiple pasted or edited cells are saved from one accumulated table snapshot.
- Future grid gestures can reuse the same execution model.
- Transaction behavior is unit-tested without Obsidian.

Tradeoffs:

- The helper is not a full cross-file rollback journal. If a later frontmatter batch fails after an earlier batch succeeds, this phase prevents context-row false acceptance but does not reverse the earlier file write.
- The transaction result is now consumed by table feedback for paste and direct single-cell edits, but it is still not a durable operation journal.

## Implementation Notes

Key files:

- `src/core/utils/contexts/tableEditTransaction.ts`
- `src/core/utils/contexts/tableEditTransaction.test.ts`
- `src/core/react/context/ContextEditorContext.tsx`

The helper returns `TableEditTransactionResult` with:

- `ok`
- `applied`
- `skipped`
- `failed`

## Invariants

- Ordinary frontmatter-backed values are accepted only after the frontmatter write succeeds.
- Ordinary frontmatter-backed values are skipped when current canonical metadata no longer matches the table row's base value.
- Empty explicit paths do not suppress row-path fallback.
- File/page-title edits remain delegated to rename transaction helpers.
- Computed/file projection values are not saved as durable user data by this helper.
- Context MDB row writes remain allowed only for explicitly Notidian-owned or linked context fields.

## Follow-Up Work

- Add broader live-vault fixture coverage for metadata reload timing and rejected or partially applied table edits.
- Add integration tests with a real vault fixture covering metadata reload after table edits.
- Add inline conflict-resolution prompts for stale frontmatter edits.
