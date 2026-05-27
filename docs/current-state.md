# Current State

This page is the current implementation reference for the Notidian fork. ADRs explain why the architecture exists; this page summarizes what is implemented now and what remains intentionally unfinished.

## Product Direction

Notidian turns Obsidian folders and Markdown files into database-like workspaces while keeping Obsidian vault data canonical.

The key rule is:

> File-backed data belongs to files and frontmatter. Notidian may project, edit, and organize it, but it must not silently become governed by a hidden context database.

The strategic direction is Notidian-only personal database architecture. Notidian is the only intended database engine and interface for Atlas Vault. Native Obsidian Bases is not a runtime dependency, compatibility pillar, or roadmap target.

## Source Of Truth

| Data kind | Canonical owner | Current Notidian behavior |
| --- | --- | --- |
| Page identity | Markdown file path/name | Displayed as the `File`/page-title cell and changed through rename transactions. |
| Ordinary note metadata | Markdown frontmatter / Obsidian metadata cache | Discovered as table columns and edited through frontmatter writes. |
| View layout | Notidian view model, stored in context MDB today | Stores column order, hidden columns, filters, grouping, sorting, and view state. |
| Context-native fields | Notidian context MDB | Stores values only when a field is explicitly Notidian-owned. |
| Formulas, aggregates, file projections | Computed from current inputs | Displayed as projections, not durable user-entered values. |
| Relations | Notidian context model | Preserved from Make.md semantics unless later mapped to frontmatter links. |

### Notidian-Only Personal Architecture

Notidian should not remain a full Make.md-style parallel database, and it should not become a native Bases wrapper or compatibility layer.

The durable direction is:

- Notidian is the database surface the user primarily works in;
- Markdown files are rows;
- file path and basename are page identity;
- frontmatter owns ordinary editable properties;
- context MDB stores view state, explicit Notidian-owned state, and legacy Make.md compatibility state;
- native Bases and `.base` files are outside the active architecture.

Bases alignment was useful research. It helped validate:

- file rows instead of detached rows;
- frontmatter-backed ordinary properties;
- `file.name` as file identity;
- authority-aware frontmatter writes;
- runtime verification discipline.

Notidian still owns necessary product value in:

- controlled file-title rename transactions;
- spreadsheet-style range editing;
- frontmatter conflict detection and explicit overwrite handling;
- migration review for legacy Make.md contexts;
- compatibility display for legacy context-only data until it is audited and migrated.

The durable decision is recorded in [ADR 0014](adr/0014-notidian-only-personal-database-engine.md). Historical Bases and Notidian-first/Bases-compatible records are preserved in the [ADR index](adr/README.md), but they are not part of the active roadmap.

## Implemented Behavior

### Frontmatter-Backed Folder Tables

- Folder contexts can materialize existing YAML/frontmatter properties as visible table columns.
- Frontmatter-backed columns use `source: "frontmatter"`.
- Editing a frontmatter-backed cell writes the Markdown file first.
- If the canonical frontmatter write fails, Notidian does not accept the table row change.
- If the current frontmatter value no longer matches the table row's base value, Notidian skips the stale write instead of overwriting external changes.
- Frontmatter-backed and computed values are stripped before context MDB persistence so MDB rows do not become the durable data source.
- Mixed observed frontmatter types resolve conservatively to `text`.
- User-selected column types are preserved as schema/view metadata for frontmatter-backed properties and are used when projecting row values from Obsidian metadata.
- Frontmatter-backed type menus expose only the reliable file-backed table types: Text, Number, Yes/No, Date, Option, Link, and Image. Make.md context-only types such as Formula, Context, Flex, Aggregate, and Object stay available for Notidian-owned columns, not ordinary frontmatter columns.
- `Tags` is reserved for the real Obsidian tags property. A non-`tags` property that already has `tags-multi` type is rendered as a multi-option property so it does not accidentally display unrelated file tags.

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
Single-option cells now open the option menu from the whole visible option chip,
not only from the small dropdown glyph. Creating a new option from that menu
saves the option configuration and the selected frontmatter value through the
same transaction.

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

### Canonical Schema Planning

Notidian now has a pure schema planner for ordinary frontmatter-backed properties.

The planner can:

- discover existing frontmatter keys across a row set without writing files;
- summarize present/missing counts and observed value types;
- create a frontmatter-backed view column without writing empty frontmatter into every file;
- reject duplicate property names case-insensitively;
- preview property renames file by file;
- classify rename rows as `old-only`, `new-only`, `both-same`, `both-conflict`, or `neither`;
- block automatic rename application when a file contains conflicting old and new property values;
- distinguish hiding a property from the view from deleting its frontmatter key from files;
- produce explicit frontmatter write previews for future confirmed apply flows.

This planner is intentionally not a destructive UI command yet. It is the safety foundation for property create, rename, delete, default backfill, and conflict-resolution UI.

Until that planner-backed schema UI exists, editing the visible header text of a frontmatter-backed column is treated as a display alias. Notidian keeps the canonical YAML/frontmatter key unchanged so a context column rename cannot silently hide or orphan existing file metadata.

Deleting a frontmatter-backed column from the table menu is also intentionally blocked until destructive schema UI exists. Users can hide the column from the current view; Notidian keeps the schema column and canonical YAML data intact.

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

Table operations now create an in-memory undo entry before execution and push it after the forward operation applies writes. The active undo stack is scoped to the table context, so immediate undo remains available across table remounts caused by frontmatter writes or context reloads.

Supported undo paths:

- Direct single-cell property edits.
- Direct option edits that update option configuration and the selected cell value.
- Direct page-title/file rename edits.
- Paste.
- Cut.
- Delete/clear.
- Fill-from-single-cell paste.
- Bulk page-title rename paste.
- Mixed page-title/property paste.

Pressing `Cmd/Ctrl+Z` while the table is focused replays the inverse writes through `applyTableEdits`, so undo uses the same file rename, frontmatter write, and context MDB persistence paths as forward edits.

Pressing `Cmd/Ctrl+Shift+Z` or `Cmd/Ctrl+Y` replays the accepted forward writes from the redo stack through the same `applyTableEdits` path. Any new forward table edit clears redo history. Redo entries do not preserve forced conflict flags, so a redo cannot silently reuse a previous Apply anyway decision against newer frontmatter.

If an operation partially skips or fails, only accepted targets enter the undo/redo history.

The undo journal is table-scoped and transient. It is not a durable audit log and it does not add a hidden data-governance layer.

## Guarantees

Notidian currently guarantees the following for implemented edit paths:

- Ordinary frontmatter-backed values are accepted only after the frontmatter write succeeds.
- A paste path cannot bypass row file-path fallback by passing an empty path.
- Stale frontmatter-backed table edits are skipped instead of overwriting newer canonical frontmatter values.
- Stale frontmatter-backed edits can overwrite newer canonical values only after the user explicitly chooses Apply anyway on the conflicted cell.
- Bulk value writes update table/context snapshots from accumulated state rather than repeatedly saving stale row snapshots.
- Mixed title/property paste writes non-file values to the renamed file path after successful rename.
- Direct single-cell failures surface inline and reset back to canonical table data.
- Direct and bulk table operations can be undone through the same authority-aware edit paths that applied them.
- Direct and bulk table operations can be redone through the same authority-aware edit paths that applied them, without replaying forced conflict flags.
- Immediate undo after title paste uses the expected current renamed path instead of depending on metadata reload timing.
- Context MDB rows do not become the durable source of truth for frontmatter-backed or computed values.
- Legacy context migration planning does not strip a value that exists only in MDB or conflicts with frontmatter.
- Legacy context CLI reports are read-only, and partial frontmatter scans are never marked migration-ready.
- Property create, rename, and delete planning can now preview canonical frontmatter consequences before destructive schema UI/apply work is added.
- Frontmatter-backed header label edits do not rename canonical YAML keys; they store a display alias until planner-backed property rename UI exists.
- Frontmatter-backed delete actions are hide-only until planner-backed destructive property deletion UI exists.
- Frontmatter-backed type changes stay inside the supported file-backed type surface and do not expose context-only Make.md field types as ordinary property types.

## Known Gaps

The following work remains before Notidian should be considered final:

- Richer conflict diff/merge UI is not implemented beyond the current inline Reload and Apply anyway actions.
- The real-vault smoke harness includes live table direct edit undo/redo, paste, paste undo/redo, frontmatter-backed type changes, option creation, conflict apply, and file-title rename paths, but broader multi-row paste/copy/cut, rejected title paste, richer conflict merge flows, and metadata timing fixtures are still needed.
- Legacy Make.md context audit/planning and read-only reports exist, but an opt-in write migration command is still needed.
- Property schema planning exists, but table UI/apply flows for create, rename, delete, default backfill, and schema conflict resolution are still needed.
- Moving files between folders from table cells is not implemented.

## Documentation Map

- Use [Table Database Workflows](table-database-workflows.md) for practical table usage and troubleshooting.
- Use [Notidian System Architecture](notidian-system-architecture.md) for the full A-Z architecture reference.
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
- Use [ADR 0014](adr/0014-notidian-only-personal-database-engine.md) for the current Notidian-only architecture.
- Use [ADR 0015](adr/0015-canonical-schema-planning.md) for frontmatter property schema create/rename/delete planning.
- Use the [ADR index](adr/README.md) for historical/superseded decision records.
- Treat `docs/superpowers` as historical execution evidence only. It does not override ADRs or current-state docs.

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
| Frontmatter schema planning and safe column actions | [notidianSchema.ts](../src/core/utils/contexts/notidianSchema.ts), [notidianSchema.test.ts](../src/core/utils/contexts/notidianSchema.test.ts), [propertyColumnActions.ts](../src/core/utils/contexts/propertyColumnActions.ts), and [propertyColumnActions.test.ts](../src/core/utils/contexts/propertyColumnActions.test.ts) |
| Legacy context audit and migration planning | [legacyContextMigrationCore.js](../src/core/utils/contexts/legacyContextMigrationCore.js), [legacyContextMigration.ts](../src/core/utils/contexts/legacyContextMigration.ts), and [legacyContextMigration.test.ts](../src/core/utils/contexts/legacyContextMigration.test.ts) |
| Legacy context read-only report | [notidianLegacyContextAudit.js](../scripts/notidianLegacyContextAudit.js) and [notidianLegacyContextAudit.test.js](../scripts/notidianLegacyContextAudit.test.js) |
| Table styling for selection and feedback | [TableView.css](../src/css/SpaceViewer/TableView.css) |
| Real-vault smoke verification | [notidianRealVaultHarness.js](../scripts/notidianRealVaultHarness.js) and [notidianRealVaultHarness.test.js](../scripts/notidianRealVaultHarness.test.js) |
| Local vault plugin installer | [notidianInstallToVault.js](../scripts/notidianInstallToVault.js) and [notidianInstallToVault.test.js](../scripts/notidianInstallToVault.test.js) |

## Verification Commands

Run these before claiming the current implementation is healthy:

```bash
npm test -- --runInBand
npx tsc -noEmit -skipLibCheck
npm run build
```

For local Obsidian validation after copying the built plugin into a vault:

```bash
npm run install:vault -- --vault-path="/Users/druker/Atlas Vault" --allow-write
obsidian vault="Atlas Vault" plugin:reload id=notidian
obsidian vault="Atlas Vault" dev:errors
```

For the opt-in real-vault smoke harness:

```bash
npm run test:real-vault -- vault="Atlas Vault" --allow-write
```

For a read-only legacy context report:

```bash
npm run audit:legacy-context -- --vault="/Users/druker/Atlas Vault" --folder="Relays & Devices"
```
