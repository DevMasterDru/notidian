# Table Database Workflows

This guide describes how to use Notidian tables as Notion-style database views while keeping Obsidian files and properties canonical.

For architectural reasoning, read the ADRs. This page is the practical behavior guide: what the table does, how edits are applied, and what to do when an edit is skipped or rejected.

## Source Of Truth

| Table data | Canonical owner | User-facing behavior |
| --- | --- | --- |
| Page title | Markdown file path/name | The `File` cell displays the basename without extension. Editing it renames the file. |
| Ordinary metadata | Markdown frontmatter | Existing YAML properties appear as table columns and edits write back to the note. |
| View layout | Notidian context MDB | Column order, hidden columns, sort/group/filter state, and row order stay in the context. |
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

## Edit Properties

To edit an ordinary metadata value, edit the cell directly.

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

## Undo Bulk Table Operations

Press `Cmd/Ctrl+Z` while the table is focused to undo the last table operation.

Undo is currently supported for:

- Paste.
- Cut.
- Delete/clear.
- Fill-from-single-cell paste.
- Bulk page-title rename paste.
- Mixed page-title/property paste.

Undo is table-local and in-memory. It is not a durable audit log and it does not create another data-governance layer.

The table currently keeps the last 20 undoable entries. Direct single-cell editor commits are not added to this journal yet; the journal is for range and paste-like table operations.

Undo replays inverse writes through the same authority-aware paths as the original operation:

- File-title undo renames files back.
- Frontmatter undo writes the previous value back to the Markdown file.
- Context-owned undo writes the previous context value back to the context table.

Redo is not implemented yet.

## Understand Cell Feedback

Notidian uses transient feedback states while table edits run.

| Feedback | Meaning |
| --- | --- |
| Pending | Notidian has planned the write and is applying it. |
| Failed | The write was attempted but failed. |
| Skipped | The write was intentionally not attempted or not accepted. |

Failed and skipped direct edits reset the cell editor back to canonical row data. This avoids the most dangerous spreadsheet illusion: seeing a value that looks accepted even though the underlying file or context did not change.

## What Notidian Does Not Do Yet

These are known gaps, not accidental omissions:

- Redo support for table operations.
- Richer conflict diff/merge UI beyond the current inline Reload and Apply anyway actions.
- A table command for moving files between folders.
- Broader real-vault UI automation for multi-row paste, copy/cut, rejected title paste, redo, richer conflict merge flows, and Obsidian metadata reload timing.
- Legacy Make.md context audit and migration tooling.
- Authority-aware property rename/delete/schema flows.
- `.base` import/export or bridge behavior.

## Related Records

- [Current State](current-state.md) is the implementation reference.
- [Real Vault Smoke Harness](real-vault-smoke-harness.md) explains opt-in live Obsidian verification.
- [ADR 0001](adr/0001-authority-partitioned-database-model.md) defines the source-of-truth model.
- [ADR 0002](adr/0002-frontmatter-backed-context-columns.md) explains frontmatter-backed columns.
- [ADR 0003](adr/0003-editable-page-titles-through-file-renames.md) explains why page-title edits are file rename transactions.
- [ADR 0006](adr/0006-unified-table-edit-transactions.md) explains the shared value write path.
- [ADR 0007](adr/0007-table-edit-feedback.md) explains transient feedback.
- [ADR 0008](adr/0008-table-undo-journal.md) explains undo.
- [ADR 0009](adr/0009-frontmatter-conflict-detection.md) explains stale frontmatter conflict detection.
