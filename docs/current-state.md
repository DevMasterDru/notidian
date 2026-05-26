# Current State

This page is the current implementation reference for the Notidian fork. ADRs explain why the architecture exists; this page summarizes what is implemented now and what remains intentionally unfinished.

## Product Direction

Notidian turns Obsidian folders and Markdown files into database-like workspaces while keeping Obsidian vault data canonical.

The key rule is:

> File-backed data belongs to files and frontmatter. Notidian may project, edit, and organize it, but it must not silently become governed by a hidden context database.

The strategic direction is Bases-first convergence. Obsidian Bases semantics are the preferred long-term model for ordinary database views, while Notidian remains the enhanced editor and migration layer for workflows that need stronger UX or safety than plain Bases currently provides.

## Source Of Truth

| Data kind | Canonical owner | Current Notidian behavior |
| --- | --- | --- |
| Page identity | Markdown file path/name | Displayed as the `File`/page-title cell and changed through rename transactions. |
| Ordinary note metadata | Markdown frontmatter / Obsidian metadata cache | Discovered as table columns and edited through frontmatter writes. |
| View layout | `.base`-compatible semantics long term; Notidian context MDB today | Stores column order, hidden columns, filters, grouping, sorting, and view state today. Future work should bridge or migrate simple views toward `.base` where semantics match. |
| Context-native fields | Notidian context MDB | Stores values only when a field is explicitly Notidian-owned. |
| Formulas, aggregates, file projections | Computed from current inputs | Displayed as projections, not durable user-entered values. |
| Relations | Notidian context model | Preserved from Make.md semantics unless later mapped to frontmatter links. |

### Bases-First Convergence

Notidian should not remain a full Make.md-style parallel database. Future database work should prefer Obsidian Bases semantics for files, properties, formulas, filters, visible columns, and view definitions.

That does not mean an immediate Bases-only rewrite. Notidian still owns value in:

- controlled file-title rename transactions;
- spreadsheet-style range editing;
- frontmatter conflict detection and explicit overwrite handling;
- migration review for legacy Make.md contexts;
- compatibility display for context-only data that cannot yet round-trip to `.base`.

The durable decision is recorded in [ADR 0011](adr/0011-bases-first-convergence.md).

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

The migration planner is conservative. It plans automatic cleanup only when a column has no blocking `conflict` or `context-only-value` rows. It preserves context-only columns, recommends discovered frontmatter keys as frontmatter-backed schema columns, and returns a migrated table copy only through a pure helper.

Notidian also includes a read-only CLI report:

```bash
npm run audit:legacy-context -- --vault="/Users/druker/Atlas Vault" --folder="Relays & Devices"
```

The report reads a single folder context, compares context rows with frontmatter, and emits Markdown or JSON. Partial reports created with `--max-files` are marked as incomplete and cannot be treated as automatically applicable. There is still no destructive legacy migration command.

### Bases Adapter

Notidian now has a pure `.base` adapter for simple folder table views and an opt-in command that previews the export before writing.

The adapter can convert a `SpaceTable` plus an optional table predicate into a Bases-compatible document shape and deterministic YAML. It maps file identity to `file.name`, frontmatter-backed columns to note properties, simple file projections such as `File.ctime` to `file.ctime`, and visible table preferences such as order, limit, group-by, simple filters, display names, and summaries where the semantics are supported.

Unsupported Notidian-only semantics are returned as structured warnings instead of being silently dropped. Current unsupported areas include context-owned values, aggregates, complex formulas, many Make.md predicate functions, stable portable sort export, `.base` import, mirroring, and custom Bases view registration.

The command `Export active folder as Obsidian Base` resolves the active folder or the parent folder of the active note, materializes frontmatter-backed columns, chooses a non-overwriting sibling `.base` path, previews the YAML and warnings, and writes only after user confirmation. The real-vault smoke harness has an opt-in `--base-export` mode that executes the command, confirms the preview, verifies the generated folder-scoped table YAML, and cleans up the exported file.

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
- Legacy context CLI reports are read-only, and partial frontmatter scans are never marked migration-ready.

## Known Gaps

The following work remains before Notidian should be considered final:

- Redo is not implemented.
- Richer conflict diff/merge UI is not implemented beyond the current inline Reload and Apply anyway actions.
- The real-vault smoke harness includes live table direct edit, paste, undo, conflict apply, file-title rename, and `.base` export command paths, but broader multi-row paste, copy/cut, rejected title paste, redo, richer conflict merge flows, deeper native Bases renderer validation, and metadata timing fixtures are still needed.
- Legacy Make.md context audit/planning and read-only reports exist, but an opt-in write migration command is still needed.
- Property rename/delete/schema operations need stronger authority-aware flows.
- A previewed `.base` export command exists, but there is not yet `.base` import, mirroring, or custom Bases view behavior.
- Moving files between folders from table cells is not implemented.

## Documentation Map

- Use [Table Database Workflows](table-database-workflows.md) for practical table usage and troubleshooting.
- Use [Bases Adapter](base-adapter.md) for the current pure `.base` export adapter scope.
- Use [Real Vault Smoke Harness](real-vault-smoke-harness.md) for opt-in live Obsidian verification.
- Use [Legacy Context Audit Report](legacy-context-audit-report.md) for read-only reports on old Make.md contexts.
- Use [ADR 0001](adr/0001-authority-partitioned-database-model.md) for the source-of-truth model.
- Use [ADR 0002](adr/0002-frontmatter-backed-context-columns.md) for frontmatter-backed columns.
- Use [ADR 0003](adr/0003-editable-page-titles-through-file-renames.md) for page-title/file-rename behavior.
- Use [ADR 0006](adr/0006-unified-table-edit-transactions.md) for shared value edit transactions.
- Use [ADR 0007](adr/0007-table-edit-feedback.md) for transient cell feedback.
- Use [ADR 0008](adr/0008-table-undo-journal.md) for the table-local undo journal.
- Use [ADR 0009](adr/0009-frontmatter-conflict-detection.md) for frontmatter conflict detection.
- Use [ADR 0010](adr/0010-legacy-context-audit-and-migration.md) for legacy context audit and migration rules.
- Use [ADR 0011](adr/0011-bases-first-convergence.md) for the Bases-first convergence north star.
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
| Legacy context audit and migration planning | [legacyContextMigrationCore.js](../src/core/utils/contexts/legacyContextMigrationCore.js), [legacyContextMigration.ts](../src/core/utils/contexts/legacyContextMigration.ts), and [legacyContextMigration.test.ts](../src/core/utils/contexts/legacyContextMigration.test.ts) |
| Legacy context read-only report | [notidianLegacyContextAudit.js](../scripts/notidianLegacyContextAudit.js) and [notidianLegacyContextAudit.test.js](../scripts/notidianLegacyContextAudit.test.js) |
| Pure `.base` export adapter | [notidianBaseAdapter.ts](../src/core/utils/bases/notidianBaseAdapter.ts), [baseExportWorkflow.ts](../src/core/utils/bases/baseExportWorkflow.ts), [notidianBaseAdapter.test.ts](../src/core/utils/bases/notidianBaseAdapter.test.ts), and [baseExportWorkflow.test.ts](../src/core/utils/bases/baseExportWorkflow.test.ts) |
| `.base` preview/export command | [baseExportCommand.tsx](../src/adapters/obsidian/bases/baseExportCommand.tsx) and [BaseExportPreviewModal.tsx](../src/core/react/components/Bases/BaseExportPreviewModal.tsx) |
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

For a read-only legacy context report:

```bash
npm run audit:legacy-context -- --vault="/Users/druker/Atlas Vault" --folder="Relays & Devices"
```
