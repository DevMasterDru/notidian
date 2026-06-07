# Current State

This page is the current implementation reference for the Notidian fork. ADRs explain why the architecture exists; this page summarizes what is implemented now and what remains intentionally unfinished.

## Product Direction

Notidian turns Obsidian folders and Markdown files into database-like workspaces while keeping Obsidian vault data canonical.

The key rule is:

> File-backed data belongs to files and frontmatter. Notidian may project, edit, and organize it, but it must not silently become governed by a hidden context database.

The strategic direction is Notidian-only personal database architecture. Notidian is the only intended database engine and interface for Atlas Vault. Native Obsidian Bases is not a runtime dependency, compatibility pillar, or roadmap target.

## Internal Lineage Names

Some internal identifiers still use Make.md-era names, including `MakeMDPlugin`, `MakeMDSettings`, `makemd-core`, `mk-*` CSS classes, `spaces://`, and `.mkit`. These are implementation-lineage or compatibility names, not active Make.md runtime paths.

Do not use those names alone to infer that Notidian reads `.obsidian/plugins/make-md`, writes `.makemd`, fetches Make.md web kits, depends on the Make.md `vaul` fork, or targets native Bases. Active architecture is determined by the source-of-truth table below, the runtime adapter registration, package dependencies, and live-vault health checks.

### Notidian Storage Root

Notidian uses `.notidian` as its active vault storage root for runtime caches, root assets, language overrides, templates, and per-folder context MDB view state. `.makemd` is retired root cache state. `.space` is retired Make.md compatibility storage and should appear only as migration input or external backup material. Runtime vault adapter operations normalize exact `.space` and `.makemd` path segments to `.notidian`, which prevents stale in-memory listeners from recreating retired roots after an update.

The storage-root migration command is dry-run-first:

```bash
npm run migrate:space-store -- --vault-path="/Users/druker/Atlas Vault"
npm run migrate:space-store -- --vault-path="/Users/druker/Atlas Vault" --allow-write
```

The write phase copies missing `.space` files into sibling `.notidian` folders, refuses content conflicts, rewrites migrated JSON string values that contain exact `.space` or `.makemd` path segments to `.notidian`, and moves original `.space` folders into an external `/tmp/notidian-space-store-backups` rollback tree instead of leaving stale backup folders inside the vault.

## Source Of Truth

| Data kind | Canonical owner | Current Notidian behavior |
| --- | --- | --- |
| Page identity | Markdown file path/name | Displayed as the `File`/page-title cell and changed through rename transactions. |
| Ordinary note metadata | Markdown frontmatter / Obsidian metadata cache | Discovered as table columns and edited through frontmatter writes. |
| View layout | Notidian view model, stored in `.notidian` context MDB today | Stores column order, hidden columns, frozen columns, filters, grouping, sorting, and view state. |
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
- `.notidian` context MDB stores view state, explicit Notidian-owned state, and legacy Make.md compatibility state;
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
- Frontmatter-backed type menus expose only the reliable file-backed table types: Text, Number, Yes/No, Date, Select, Multi-select, Link, and Image. Make.md context-only types such as Formula, Context, Flex, Aggregate, and Object stay available for Notidian-owned columns, not ordinary frontmatter columns.
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

### Table Loading

- Large tables initially render in configured page-size chunks.
- The loading footer shows the current loaded row count against the current visible/filtered row count.
- `Load More` appends one more configured chunk without exceeding the current filtered row count.
- `Load All` expands the current table view to every currently visible/filtered row.

### Frozen Columns

- Column header menus include `Freeze up to column` and, when freezing is active, `Unfreeze columns`.
- Freezing is stored as Notidian view state, not frontmatter or ordinary row data.
- The row-number gutter and every visible column up to the selected column stay sticky during horizontal scrolling.
- Frozen offsets are computed from the current visible column order and column widths, so hidden columns, reordered columns, and resized columns remain aligned.
- If a frozen column is later hidden or removed, Notidian clamps the frozen count to the remaining visible columns instead of creating stale hidden governance.

### Manual Row Ordering

- The table row gutter selects whole rows.
- The row-number gutter width is derived from the visible row-number digit count: one-digit views are narrower than two- or three-digit views, and the drag grip overlays above the gutter number instead of reserving permanent width.
- Dragging from the row-number lane draws a marquee selection rectangle and selects intersecting visible rows.
- Dragging the row gutter grip reorders rows in Notidian's context table order.
- If multiple selected rows include the dragged row, Notidian moves those rows together as one block and preserves their relative order.
- The drag overlay is read-only preview UI that shows only the page/title name, not the full row's metadata.
- A successful row drag clears active sort/group state so the view becomes manual order. Filters can remain active; hidden rows keep their relative order while visible rows move.
- Row movement is view/order governance only. It does not write frontmatter values and does not create a second owner for ordinary metadata.

### Unified Table Edit Transactions

Normal value edits, field-option value edits, and paste value writes go through `executeTableValueWrites`.
Select and Multi-select are separate user-facing property types. Internally they keep the existing `option` and `option-multi` type IDs, so existing tables and frontmatter-backed view schemas do not require migration.

Select cells now open the option menu from the whole visible option chip, not only from the small dropdown glyph. Creating a new option from that menu saves the option configuration and the selected frontmatter value through the same transaction. Multi-select cells use the same option configuration path but keep the menu in multi mode and save the complete selected value set.

That transaction helper:

- Resolves the target row and file path once.
- Treats empty explicit paths as missing and falls back to the row file path.
- Compares frontmatter-backed writes against current canonical metadata before saving.
- Allows an explicit forced frontmatter write only after a conflict has been surfaced to the user.
- Groups frontmatter changes by resolved file path.
- Writes frontmatter before accepting table/context row changes.
- Applies root-table writes to one accumulated table snapshot.
- Applies linked context-table writes to one accumulated table snapshot per context.
- Persists field configuration updates even if a linked context row is temporarily missing, so option lists do not get lost while frontmatter value writes succeed.
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

The report reads a single folder context, compares context rows with frontmatter, and emits Markdown or JSON. Partial reports created with `--max-files` are marked as incomplete and cannot be treated as automatically applicable. There is still no destructive legacy context-value migration command.

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
- produce explicit frontmatter write previews for confirmed apply flows.

The table header menu now includes `Rename Frontmatter Key` for frontmatter-backed columns. This command prompts for the new canonical key, previews affected file-state counts in a confirmation dialog, revalidates the plan after confirmation, writes replacement frontmatter values before removing the old key, updates table/view references, and reloads canonical data. It refuses to run when the planner finds duplicate target columns, files with conflicting old and new key values, or metadata that changed after the confirmation preview.

The table header menu also exposes confirmed destructive deletion for frontmatter-backed columns. `Delete Property` previews the number of files whose YAML key will be removed, requires confirmation when any file is affected, revalidates the preview after confirmation, removes the key from Markdown frontmatter, clears active filter/sort/group/display references for that column, hides the column from the current Notidian view, and reloads canonical data.

Frontmatter-backed table headers render deterministic labels generated from the canonical YAML/frontmatter key, such as `sensor_id` -> `Sensor ID`. Stored view aliases are ignored for these ordinary metadata columns. When a generated label differs from the actual key, the header text gets a very faint hairline marker and its hover tooltip shows the full generated label. Header-name edits for frontmatter-backed columns are ignored rather than stored as display aliases, so a casual label edit cannot create hidden view/schema text that disagrees with Markdown. Canonical key changes must use the explicit `Rename Frontmatter Key` command.

Column headers also support per-view display modes stored in predicate view state: `Adaptive`, `Icon + Text`, `Text Only`, and `Icon Only`. Adaptive uses the saved column width to compact from icon+text to text-only and then icon-only. Icon-only headers can resize down to the 24px sticker footprint: an 18px sticker plus 3px of side padding on each side. That collapsed state hides auxiliary context marker text so the sticker remains the only visible header content. Table headers, body cells, and aggregate cells all set `width`, `minWidth`, and `maxWidth` so browser table layout cannot stretch compact columns back open. Compact boolean/Yes-No columns also remove body-cell padding so checkbox cells do not force the column wider than the collapsed header, and older saved 18px or 26px collapsed widths are normalized to 24px at load time. The column menu's top header-name row shows the current header icon to the left of the name input; clicking it opens icon configuration. The picker contains a `Default` control that clears the configured icon back to the field-type default without touching frontmatter or changing the current column width. Data anchoring is also view state: columns can use `Auto`, `Left`, `Center`, or `Right`; Auto centers icon-only columns, defaults to right in RTL table mode, right-aligns Hebrew/RTL data in LTR table mode, and otherwise left-aligns data. Table direction is predicate view state exposed in the view options menu: LTR is the default, while RTL fully mirrors table chrome so the row gutter sits on the right, columns visually flow right-to-left, and frozen columns pin from the right.

Deleting a frontmatter-backed column from the table menu is destructive only after confirmation. Users can still hide the column from the current view without deleting frontmatter; confirmed deletion removes the YAML key from affected files and hides the column.

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
- Frontmatter-backed table headers display generated labels from canonical YAML keys, use a very faint marker when labels differ from the raw key, and show the full generated label on hover; header-name edits do not create display aliases. Use `Rename Frontmatter Key` for explicit canonical key migration.
- Per-column header display modes and configured header icons are view/schema presentation state; they do not change Markdown frontmatter values.
- Frontmatter-backed delete actions either hide the column from the view or, after confirmation, remove the YAML key from affected files and hide the column.
- Frontmatter-backed type changes stay inside the supported file-backed type surface and do not expose context-only Make.md field types as ordinary property types.

## Known Gaps

The following work remains before Notidian should be considered final:

- Richer conflict diff/merge UI is not implemented beyond the current inline Reload and Apply anyway actions.
- The real-vault smoke harness includes live table direct edit undo/redo, paste, paste undo/redo, frontmatter-backed type changes, Select option creation, existing Select selection from filled and empty cells, Multi-select persistence, conflict apply, and file-title rename paths, but broader multi-row paste/copy/cut, rejected title paste, richer conflict merge flows, and metadata timing fixtures are still needed.
- Legacy Make.md context audit/planning and read-only reports exist, but an opt-in write migration command for context-owned values is still needed.
- Property schema planning exists, and safe automatic frontmatter key rename plus confirmed destructive frontmatter-key delete are available from the header menu. Create-property, default backfill, and rename conflict-resolution flows are still needed.
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
| Frontmatter schema planning and safe column actions | [notidianSchema.ts](../src/core/utils/contexts/notidianSchema.ts), [notidianSchema.test.ts](../src/core/utils/contexts/notidianSchema.test.ts), [notidianSchemaApply.ts](../src/core/utils/contexts/notidianSchemaApply.ts), [notidianSchemaApply.test.ts](../src/core/utils/contexts/notidianSchemaApply.test.ts), [propertyColumnActions.ts](../src/core/utils/contexts/propertyColumnActions.ts), and [propertyColumnActions.test.ts](../src/core/utils/contexts/propertyColumnActions.test.ts) |
| Legacy context audit and migration planning | [legacyContextMigrationCore.js](../src/core/utils/contexts/legacyContextMigrationCore.js), [legacyContextMigration.ts](../src/core/utils/contexts/legacyContextMigration.ts), and [legacyContextMigration.test.ts](../src/core/utils/contexts/legacyContextMigration.test.ts) |
| Legacy context read-only report | [notidianLegacyContextAudit.js](../scripts/notidianLegacyContextAudit.js) and [notidianLegacyContextAudit.test.js](../scripts/notidianLegacyContextAudit.test.js) |
| Table styling for selection and feedback | [TableView.css](../src/css/SpaceViewer/TableView.css) |
| Real-vault smoke verification | [notidianRealVaultHarness.js](../scripts/notidianRealVaultHarness.js) and [notidianRealVaultHarness.test.js](../scripts/notidianRealVaultHarness.test.js) |
| Local vault plugin installer | [notidianInstallToVault.js](../scripts/notidianInstallToVault.js) and [notidianInstallToVault.test.js](../scripts/notidianInstallToVault.test.js) |

## Verification Commands

Run these before claiming the current implementation is healthy:

```bash
npm run verify:source
```

Use `npm run verify:source:pristine` when the working tree must be clean before
and after verification.

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

For the full live-vault gate, including health audit, migration dry-run,
real-vault smoke, post-smoke settle, second health audit, and Obsidian
developer-error capture:

```bash
npm run verify:live
```

Use `npm run verify:live:ui` when the live table DOM workflows should also be
exercised.

For a read-only legacy context report:

```bash
npm run audit:legacy-context -- --vault="/Users/druker/Atlas Vault" --folder="Relays & Devices"
```
