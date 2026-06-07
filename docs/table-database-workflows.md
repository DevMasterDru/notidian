# Table Database Workflows

This guide describes how to use Notidian tables as Notion-style database views while keeping Obsidian files and properties canonical.

For architectural reasoning, read the ADRs. This page is the practical behavior guide: what the table does, how edits are applied, and what to do when an edit is skipped or rejected.

## Source Of Truth

| Table data | Canonical owner | User-facing behavior |
| --- | --- | --- |
| Page title | Markdown file path/name | The `File` cell displays the basename without extension. Editing it renames the file. |
| Ordinary metadata | Markdown frontmatter | Existing YAML properties appear as table columns and edits write back to the note. |
| View layout | Notidian view model, stored in context MDB today | Column order, hidden columns, frozen columns, sort/group/filter state, and row order stay in Notidian view state. |
| Notidian-owned fields | Notidian context MDB | Values stay in the context only when the field is explicitly context-owned. |
| Formulas and projections | Computed from current inputs | Displayed in the table, but skipped by paste and normal value writes. |

The rule is simple: if a value belongs to the note, Notidian must write the note before accepting the table edit.

## Open A Folder As A Database Table

When a folder context is opened as a table, Notidian treats each Markdown file as a row.

Existing frontmatter keys are materialized as visible table columns. These columns are marked internally with:

```text
source: "frontmatter"
```

That marker is important because it prevents the context MDB row from becoming a hidden second source of truth. The context can remember that the column exists and where it appears in the view, but the durable value remains in the Markdown file.

If a file has a property that another file does not have, the table can still show the property as a column. Missing values are just empty cells for those rows.

Large folders are paginated for faster initial rendering. The footer shows how many rows are currently loaded out of the current visible/filtered row count. Use Load More to append one more configured chunk, or Load All to show every row in the current filtered table view at once.

## Freeze Columns

Use a column header menu to choose `Freeze up to column`. The row-number gutter and every visible column from the start of the table through that column stay pinned while you scroll horizontally.

Use `Unfreeze columns` from any column header menu to return the table to normal horizontal scrolling.

Freezing is table view state only. It does not write frontmatter, change row values, or create a hidden data owner. If you hide, delete, resize, or reorder columns later, Notidian recomputes the frozen area from the current visible column order and clamps it to valid columns.

## Edit Properties

To edit an ordinary metadata value, edit the cell directly.

Select properties behave like Notion-style single selects. Clicking the visible chip or dropdown opens the option menu. Typing a new option creates the option, selects it for the cell, and writes the selected value to frontmatter before Notidian accepts the table update.

Multi-select properties use the same option configuration but store a list of selected values. The menu stays in multi-select mode, so selecting additional values appends them instead of replacing the existing set.

Option configuration is saved with the table schema/view state, while the selected value is saved to Markdown frontmatter. Notidian persists the configuration part even when a linked context row is still settling, so a successful value edit does not lose newly created Select or Multi-select choices.

Frontmatter-backed columns can use the reliable file-backed table types: Text,
Number, Yes/No, Date, Select, Multi-select, Link, and Image. Notidian keeps the
raw Markdown property canonical, while the selected column type controls how the
table projects and edits that value. Context-only Make.md types such as Formula,
Context, Flex, Aggregate, and Object are intentionally not offered for ordinary
frontmatter columns.

`Tags` is special. It represents Obsidian file tags, not an arbitrary YAML key.
For non-`tags` properties, use Select or Multi-select behavior for tag-like labels.

For frontmatter-backed columns, Notidian:

1. Resolves the row's current file path.
2. Reads the current canonical frontmatter value from Obsidian metadata.
3. Compares that value with the value the table row was rendered from.
4. Writes the Markdown file if the row is still current.
5. Accepts the table/context update only after the file write succeeds.

If the frontmatter changed outside Notidian after the table rendered, the edit is skipped instead of overwriting newer data. The cell shows skipped feedback and the tooltip says:

```text
Frontmatter changed outside Notidian. Reload before editing.
```

The conflicted cell shows two inline actions:

- Reload refreshes canonical table data from Obsidian and clears the conflict feedback.
- Apply anyway writes the attempted value to the Markdown file through the same frontmatter transaction path.

Apply anyway is explicit by design. Notidian still never silently overwrites newer frontmatter.

## Change Properties

Notidian treats ordinary properties as frontmatter keys, so schema changes are migrations over files, not hidden context-only edits.

The current implementation includes a non-destructive planner for property schema operations:

- creating a property adds a frontmatter-backed table column without writing empty keys to every file;
- renaming a property previews each file and blocks automatic application when a file already has conflicting old and new values;
- deleting a property distinguishes hiding the column from deleting the key in Markdown frontmatter;
- destructive deletion is represented as an explicit affected-file preview.

For frontmatter-backed columns, use `Rename Frontmatter Key` from the column header menu to rename the canonical YAML key. The command asks for the new key, shows a confirmation summary, revalidates the plan after confirmation, writes the new key before deleting the old key, updates the table/view references, and reloads from canonical Obsidian metadata. It refuses to run if any file already has both keys with different values or if the frontmatter preview changed before the write starts.

Frontmatter-backed table headers display deterministic labels generated from the canonical YAML key, such as `sensor_id` -> `Sensor ID`. When the label differs from the raw key, the header text has a very faint hairline marker and the hover tooltip shows the full generated label. Casual header-name edits are ignored for frontmatter-backed columns, so existing file metadata is not hidden, moved, or visually renamed by view-only schema text.

Use the column menu's compact `Header Display` segmented control to decide how compact a header should be in the current view: `Adaptive`, `Icon + Text`, `Text Only`, or `Icon Only`. Icon-only headers can be resized down to the 24px sticker footprint: the 18px sticker with 3px of side padding on each side. At that size, Notidian shows only the header sticker and keeps the full beautiful label available through the hover tooltip. Boolean/Yes-No columns use compact checkbox cell padding at that width, so the body cells do not force the column open again. Older 18px or 26px collapsed widths from previous builds are treated as 24px when loaded. The same menu includes `Data Anchor`: `Auto`, `Left`, `Center`, and `Right`. Auto centers icon-only columns, defaults to right in RTL table mode, right-aligns visible Hebrew/RTL data in LTR table mode, and otherwise left-aligns data. The view options menu includes `Direction`: `Left to Right` keeps the standard table layout, while `Right to Left` fully mirrors the table for Hebrew databases, including the row gutter and frozen columns. The current header icon appears to the left of the header-name input at the top of the menu; click it to configure the icon, or use `Default` inside the icon picker to return to the field-type icon. These presentation settings are saved with the Notidian view and do not write frontmatter.

For the same reason, frontmatter-backed columns distinguish view hiding from frontmatter deletion. Use `Hide Property` to hide a column from the current Notidian view without touching Markdown. Use `Delete Property` only when you want to remove the actual YAML key from affected files; Notidian shows a confirmation summary, revalidates the file preview after confirmation, removes the key from frontmatter, clears active view references for that column, hides it from the view, and reloads canonical metadata.

## Edit Page Titles

The `File` column is the page-title column. It is not ordinary metadata.

Editing a `File` cell performs a file rename. Notidian keeps the file in the same folder, trims surrounding whitespace, and preserves the original extension.

Examples:

| Old path | Edited title | New path |
| --- | --- | --- |
| `Relays & Devices/Sensor.md` | `Pressure Sensor` | `Relays & Devices/Pressure Sensor.md` |
| `Relays & Devices/Sensor v2.md` | `Pressure Sensor v2` | `Relays & Devices/Pressure Sensor v2.md` |

The rename is rejected when:

- The title is empty.
- The title contains `/`.
- A file with the target name already exists.
- Obsidian cannot complete the rename.

Folder moves are intentionally not performed through the title cell. A slash in the title is treated as a request to change folders, and Notidian rejects it with guidance to use a move command. A dedicated table move command is still a known gap.

## Copy, Cut, Paste, And Clear Ranges

Notidian tables support rectangular spreadsheet-style selection.

| Action | Shortcut |
| --- | --- |
| Copy selected cells as TSV | `Cmd/Ctrl+C` |
| Cut selected cells | `Cmd/Ctrl+X` |
| Paste TSV into the active cell or selected range | `Cmd/Ctrl+V` |
| Clear selected editable cells | `Backspace` or `Delete` |
| Undo the last table operation | `Cmd/Ctrl+Z` |
| Redo the last undone table operation | `Cmd/Ctrl+Shift+Z` or `Cmd/Ctrl+Y` |
| Clear the current selection | `Escape` |

Copying a page-title cell copies the visible title, not the full file path.

Pasting follows these rules:

- A single copied cell can fill a larger selected range.
- A rectangular copied range can repeat across a compatible selected range.
- A multi-cell paste into one active cell expands down and right from that cell.
- Targets outside the table are skipped.
- Computed and read-only projection cells are skipped.
- Pasting into page-title cells renames files.
- Pasting into frontmatter-backed cells writes frontmatter.
- Mixed title/property paste renames files first, then writes property values to the renamed paths.

Skipped cells are reported through cell feedback and an Obsidian notice. A skipped cell means the requested edit was not accepted.

## Select And Move Rows

The left row gutter selects whole rows. Its width adapts to the largest visible row number, so one-digit views stay narrower than two- or three-digit views. Dragging from the row-number lane draws a marquee rectangle and selects every visible row the rectangle intersects. Dragging the overlay grip above the row number moves rows in the table order.

- Drag an unselected row to move only that row.
- Select multiple rows, then drag one selected row to move the selected rows together.
- Drag from the row-number lane to marquee-select multiple rows.
- Shift-select rows in the gutter to select a contiguous row block.
- Cmd/Ctrl-select rows in the gutter to toggle individual rows.

The drag preview is display-only and shows only the page/title name for each dragged row. It cannot open cell editors or option menus while a row is being moved.

Manual row movement updates Notidian row order, not frontmatter values. If the current table has an explicit sort or group active, a successful row drag clears that sort/group and switches the view to manual row order. This matches the spreadsheet/Notion behavior: once the user manually places rows, the visible order is governed by the manual order instead of by a computed sort.

## Undo Table Operations

Press `Cmd/Ctrl+Z` while the table is focused to undo the last table operation.

Undo is currently supported for:

- Direct single-cell property edits.
- Direct Select and Multi-select edits that update option configuration and the selected value.
- Direct page-title/file rename edits.
- Paste.
- Cut.
- Delete/clear.
- Fill-from-single-cell paste.
- Bulk page-title rename paste.
- Mixed page-title/property paste.

Undo is table-scoped and in-memory. It can survive a table remount during the current plugin session, but it is not a durable audit log and it does not create another data-governance layer.

The table currently keeps the last 20 undoable entries.

Undo replays inverse writes through the same authority-aware paths as the original operation:

- File-title undo renames files back.
- Frontmatter undo writes the previous value back to the Markdown file.
- Context-owned undo writes the previous context value back to the context table.

Redo uses `Cmd/Ctrl+Shift+Z` or `Cmd/Ctrl+Y`. It replays the original accepted writes through the same authority-aware paths as the original operation. A new forward edit clears redo history, and redo does not reuse a previous forced conflict overwrite. If a bulk edit partially skips or fails, skipped and failed targets are left out of the undo/redo history.

## Understand Cell Feedback

Notidian uses transient feedback states while table edits run.

| Feedback | Meaning |
| --- | --- |
| Pending | Notidian has planned the write and is applying it. |
| Failed | The write was attempted but failed. |
| Skipped | The write was intentionally not attempted or not accepted. |

Failed and skipped direct edits reset the cell editor back to canonical row data. This avoids the most dangerous spreadsheet illusion: seeing a value that looks accepted even though the underlying file or context did not change.

## Legacy Make.md Contexts

Older Make.md contexts can contain unmarked columns and MDB row values that duplicate frontmatter. Notidian now has a non-destructive audit/planning layer for these contexts.

The audit separates:

- properties that are already frontmatter-backed;
- unmarked columns that appear to correspond to frontmatter keys;
- context-only columns that should remain MDB-owned;
- duplicate values that match frontmatter;
- values that exist only in context;
- conflicts where context and frontmatter disagree.

Matching duplicates can be planned for cleanup because frontmatter already contains the same data. Values that exist only in context and conflicts are blockers. They need a future review flow so the user can choose whether to backfill frontmatter, keep the value as context-only data, or discard a duplicate.

Run the read-only audit report with:

```bash
npm run audit:legacy-context -- --vault="/Users/druker/Atlas Vault" --folder="Relays & Devices"
```

Use `--max-files=1` for a quick sample. Sampled reports are marked as partial and cannot be treated as automatically applicable.

This means the safe migration sequence is audit, preview, resolve blockers, then apply. There is not yet a write migration command, so the current table behavior remains non-destructive for legacy contexts.

## What Notidian Does Not Do Yet

These are known gaps, not accidental omissions:

- Richer conflict diff/merge UI beyond the current inline Reload and Apply anyway actions.
- A table command for moving files between folders.
- Broader real-vault UI automation for multi-row paste, copy/cut, rejected title paste, richer conflict merge flows, and Obsidian metadata reload timing.
- Opt-in legacy Make.md context write migration tooling.
- Remaining table UI/apply commands for property create, default backfill, destructive delete, and rename conflict resolution.

## Related Records

- [Current State](current-state.md) is the implementation reference.
- [Notidian System Architecture](notidian-system-architecture.md) is the full architecture reference.
- [Real Vault Smoke Harness](real-vault-smoke-harness.md) explains opt-in live Obsidian verification.
- [Legacy Context Audit Report](legacy-context-audit-report.md) explains read-only reports for older Make.md contexts.
- [ADR 0001](adr/0001-authority-partitioned-database-model.md) defines the source-of-truth model.
- [ADR 0002](adr/0002-frontmatter-backed-context-columns.md) explains frontmatter-backed columns.
- [ADR 0003](adr/0003-editable-page-titles-through-file-renames.md) explains why page-title edits are file rename transactions.
- [ADR 0006](adr/0006-unified-table-edit-transactions.md) explains the shared value write path.
- [ADR 0007](adr/0007-table-edit-feedback.md) explains transient feedback.
- [ADR 0008](adr/0008-table-undo-journal.md) explains undo.
- [ADR 0009](adr/0009-frontmatter-conflict-detection.md) explains stale frontmatter conflict detection.
- [ADR 0010](adr/0010-legacy-context-audit-and-migration.md) explains legacy context audit and migration planning.
- [ADR 0014](adr/0014-notidian-only-personal-database-engine.md) explains the current Notidian-only architecture.
- [ADR 0015](adr/0015-canonical-schema-planning.md) explains property schema planning.
- [ADR Index](adr/README.md) lists historical and superseded records.
