# Current State

This page is the current implementation reference for the Notidian fork. ADRs explain why the architecture exists; this page summarizes what is implemented now and what remains intentionally unfinished.

## Product Direction

Notidian turns Obsidian folders and Markdown files into database-like workspaces while keeping Obsidian vault data canonical.

The key rule is:

> File-backed data belongs to files and frontmatter. Notidian may project, edit, and organize it, but it must not silently become governed by a hidden context database.

## Source Of Truth

| Data kind | Canonical owner | Current Notidian behavior |
| --- | --- | --- |
| Page identity | Markdown file path/name | Displayed as the `File`/page-title cell and changed through rename transactions. |
| Ordinary note metadata | Markdown frontmatter / Obsidian metadata cache | Discovered as table columns and edited through frontmatter writes. |
| View layout | Notidian context MDB | Stores column order, hidden columns, filters, grouping, sorting, and view state. |
| Context-native fields | Notidian context MDB | Stores values only when a field is explicitly Notidian-owned. |
| Formulas, aggregates, file projections | Computed from current inputs | Displayed as projections, not durable user-entered values. |
| Relations | Notidian context model | Preserved from Make.md semantics unless later mapped to frontmatter links. |

## Implemented Behavior

### Frontmatter-Backed Folder Tables

- Folder contexts can materialize existing YAML/frontmatter properties as visible table columns.
- Frontmatter-backed columns use `source: "frontmatter"`.
- Editing a frontmatter-backed cell writes the Markdown file first.
- If the canonical frontmatter write fails, Notidian does not accept the table row change.
- If the current frontmatter value no longer matches the table row's base value, Notidian skips the stale write instead of overwriting external changes.
- Frontmatter-backed and computed values are stripped before context MDB persistence so MDB rows do not become the durable data source.
- Mixed observed frontmatter types resolve conservatively to `text`.

### Editable Page Titles

- The visible page title is derived from the row's file path basename.
- Editing the title performs a file rename, not a context value write.
- Rename transactions reject empty names, slash-containing names, duplicates, and invalid target conflicts.
- Bulk title paste uses the same rename transaction path.
- Rename reconciliation preserves row order and removes duplicate renamed rows after metadata events.
- Changing folders from the title cell is intentionally not implemented; that requires a separate move command.

### Range Clipboard Editing

- Users can select rectangular table ranges.
- `Cmd/Ctrl+C` copies selected cells as TSV.
- `Cmd/Ctrl+X` copies and clears editable selected cells.
- `Cmd/Ctrl+V` pastes TSV data into the active cell or selected range.
- A single copied cell can fill a larger selected range.
- Multi-cell paste expands down/right from the active cell.
- Read-only computed/file projection targets are skipped by the paste planner.

### Unified Table Edit Transactions

Normal value edits, field-option value edits, and paste value writes go through `executeTableValueWrites`.

That transaction helper:

- Resolves the target row and file path once.
- Treats empty explicit paths as missing and falls back to the row file path.
- Compares frontmatter-backed writes against current canonical metadata before saving.
- Allows an explicit forced frontmatter write only after a conflict has been surfaced to the user.
- Groups frontmatter changes by resolved file path.
- Writes frontmatter before accepting table/context row changes.
- Applies root-table writes to one accumulated table snapshot.
- Applies linked context-table writes to one accumulated table snapshot per context.
- Returns `TableEditTransactionResult` with applied, skipped, and failed writes.

File/page-title edits remain outside this helper because they require rename preflight, temporary paths, metadata settling, and row reconciliation.

### Legacy Context Audit And Migration Planning

Notidian can now audit a legacy Make.md context table against current frontmatter snapshots without writing to the vault.

The audit/planner classifies:

- already frontmatter-backed columns;
- unmarked frontmatter candidates;
- context-only columns that should remain MDB-owned;
- computed/file projection columns;
- matching duplicate values;
- frontmatter-only values;
- context-only values that require backfill or user review;
- conflicting values that require user review.

The migration planner is conservative. It plans automatic cleanup only when a column has no blocking `conflict` or `context-only-value` rows. It preserves context-only columns, recommends discovered frontmatter keys as frontmatter-backed schema columns, and returns a migrated table copy only through a pure helper. There is still no destructive legacy migration command.

### Table Edit Feedback

Paste operations and direct single-cell edits now surface transaction state in the table:

- Planned paste targets show a pending cell state while the transaction runs.
- Direct value edits, field-option edits, and page-title rename edits show a pending cell state while the operation runs.
- Failed cells show failed feedback.
- Skipped cells show skipped feedback.
- Frontmatter conflict cells show inline Reload and Apply anyway actions, with a tooltip showing current, rendered, and attempted values.
- Successful cells clear back to normal after the operation completes.
- Obsidian notices summarize failed/skipped counts.
- Failed or skipped cells are remounted back to canonical row data so optimistic local editor state does not keep showing a value that was not accepted.

This feedback is transient UI state. It is not stored in context MDB and does not change the source-of-truth model.

Detected frontmatter conflicts show skipped cell feedback with:

```text
Frontmatter changed outside Notidian. Reload before editing.
```

Reload refreshes canonical table data and clears the transient conflict feedback. Apply anyway re-runs the attempted write with an explicit forced-frontmatter flag, still writing the Markdown file before any table/context value is accepted.

### Table Undo Journal

Bulk table operations now create an in-memory undo entry before execution and push it after the forward operation applies writes.

Supported undo paths:

- Paste.
- Cut.
- Delete/clear.
- Fill-from-single-cell paste.
- Bulk page-title rename paste.
- Mixed page-title/property paste.

Pressing `Cmd/Ctrl+Z` while the table is focused replays the inverse writes through `applyTableEdits`, so undo uses the same file rename, frontmatter write, and context MDB persistence paths as forward edits.

The undo journal is table-local and transient. It is not a durable audit log and it does not add a hidden data-governance layer.

## Guarantees

Notidian currently guarantees the following for implemented edit paths:

- Ordinary frontmatter-backed values are accepted only after the frontmatter write succeeds.
- A paste path cannot bypass row file-path fallback by passing an empty path.
- Stale frontmatter-backed table edits are skipped instead of overwriting newer canonical frontmatter values.
- Stale frontmatter-backed edits can overwrite newer canonical values only after the user explicitly chooses Apply anyway on the conflicted cell.
- Bulk value writes update table/context snapshots from accumulated state rather than repeatedly saving stale row snapshots.
- Mixed title/property paste writes non-file values to the renamed file path after successful rename.
- Direct single-cell failures surface inline and reset back to canonical table data.
- Bulk table operations can be undone through the same authority-aware edit paths that applied them.
- Immediate undo after title paste uses the expected current renamed path instead of depending on metadata reload timing.
- Context MDB rows do not become the durable source of truth for frontmatter-backed or computed values.
- Legacy context migration planning does not strip a value that exists only in MDB or conflicts with frontmatter.

## Known Gaps

The following work remains before Notidian should be considered final:

- Redo is not implemented.
- Richer conflict diff/merge UI is not implemented beyond the current inline Reload and Apply anyway actions.
- The real-vault smoke harness includes live table direct edit, paste, undo, conflict apply, and file-title rename paths, but broader multi-row paste, copy/cut, rejected title paste, redo, richer conflict merge flows, and metadata timing fixtures are still needed.
- Legacy Make.md context audit/planning exists as a pure utility, but a user-facing read-only report and opt-in write migration command are still needed.
- Property rename/delete/schema operations need stronger authority-aware flows.
- `.base` import/export is not implemented.
- Moving files between folders from table cells is not implemented.

## Documentation Map

- Use [Table Database Workflows](table-database-workflows.md) for practical table usage and troubleshooting.
- Use [Real Vault Smoke Harness](real-vault-smoke-harness.md) for opt-in live Obsidian verification.
- Use [ADR 0001](adr/0001-authority-partitioned-database-model.md) for the source-of-truth model.
- Use [ADR 0002](adr/0002-frontmatter-backed-context-columns.md) for frontmatter-backed columns.
- Use [ADR 0003](adr/0003-editable-page-titles-through-file-renames.md) for page-title/file-rename behavior.
- Use [ADR 0006](adr/0006-unified-table-edit-transactions.md) for shared value edit transactions.
- Use [ADR 0007](adr/0007-table-edit-feedback.md) for transient cell feedback.
- Use [ADR 0008](adr/0008-table-undo-journal.md) for the table-local undo journal.
- Use [ADR 0009](adr/0009-frontmatter-conflict-detection.md) for frontmatter conflict detection.
- Use [ADR 0010](adr/0010-legacy-context-audit-and-migration.md) for legacy context audit and migration rules.
- Use `docs/superpowers` only as historical design and execution context.

## Implementation Map

| Area | Main implementation files |
| --- | --- |
| Table UI, selection, clipboard shortcuts, feedback wiring | [TableView.tsx](../src/core/react/components/SpaceView/Contexts/TableView/TableView.tsx) |
| Context editor write bridge | [ContextEditorContext.tsx](../src/core/react/context/ContextEditorContext.tsx) |
| Unified value write transactions | [tableEditTransaction.ts](../src/core/utils/contexts/tableEditTransaction.ts) and [tableEditTransaction.test.ts](../src/core/utils/contexts/tableEditTransaction.test.ts) |
| Paste planning | [tablePastePlan.ts](../src/core/utils/contexts/tablePastePlan.ts) |
| Transient cell feedback | [tableEditFeedback.ts](../src/core/utils/contexts/tableEditFeedback.ts) and [tableEditFeedback.test.ts](../src/core/utils/contexts/tableEditFeedback.test.ts) |
| Table undo journal | [tableUndoJournal.ts](../src/core/utils/contexts/tableUndoJournal.ts) and [tableUndoJournal.test.ts](../src/core/utils/contexts/tableUndoJournal.test.ts) |
| Page title parsing and rename transactions | [pageTitle.ts](../src/core/utils/contexts/pageTitle.ts) and [pageTitleRename.ts](../src/core/utils/contexts/pageTitleRename.ts) |
| Legacy context audit and migration planning | [legacyContextMigration.ts](../src/core/utils/contexts/legacyContextMigration.ts) and [legacyContextMigration.test.ts](../src/core/utils/contexts/legacyContextMigration.test.ts) |
| Table styling for selection and feedback | [TableView.css](../src/css/SpaceViewer/TableView.css) |
| Real-vault smoke verification | [notidianRealVaultHarness.js](../scripts/notidianRealVaultHarness.js) and [notidianRealVaultHarness.test.js](../scripts/notidianRealVaultHarness.test.js) |

## Verification Commands

Run these before claiming the current implementation is healthy:

```bash
npm test -- --runInBand
npx tsc -noEmit -skipLibCheck
npm run build
```

For local Obsidian validation after copying the built plugin into a vault:

```bash
obsidian plugin:reload id=notidian
obsidian dev:errors
```

For the opt-in real-vault smoke harness:

```bash
npm run test:real-vault -- vault="Atlas Vault" --allow-write
```
