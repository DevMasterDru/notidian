# Page Title Cell Design

## Goal

Make file-backed context tables feel like Notion databases by allowing the visible first-column page name to be edited inline while keeping the Markdown file path as the canonical identity.

## Product Behavior

For context tables whose primary column is the built-in `File` column, Notidian presents that column as a page title column:

- The cell displays the file basename without its extension.
- Inline editing changes the underlying file name, not a context-table string value.
- `Enter` or blur commits the edit.
- `Escape` cancels the edit.
- The rename preserves the current parent folder and file extension.
- Empty names, names containing `/`, and duplicate target paths are rejected.
- Opening the note remains available through modifier-click or an open action, but ordinary table interaction prioritizes editing the cell.

## Architecture

The implementation treats the title as an updatable projection over the canonical row path:

```text
visible title = basename(row.File)
commit title = spaceManager.renamePath(row.File, sameFolder/newTitle.ext)
```

The context table must not store the title separately. After a successful rename, Obsidian and Notidian reload the affected path/context state and the table row identity changes from the old path to the new path.

## Components

- `pageTitle.ts`: pure utilities for deriving display titles, building same-folder rename targets, and validating title edits.
- `PageTitleCell.tsx`: inline editable cell for file-backed primary rows.
- `DataTypeView.tsx`: routes the built-in `File` column to `PageTitleCell`.
- `ContextEditorContext.tsx`: exposes an explicit rename operation for context rows so UI cells do not misuse normal value writes.

## Error Handling

The rename path rejects:

- missing current path
- empty trimmed title
- titles containing `/`
- title values that resolve to the same path
- target paths that already exist, except exact same-path no-ops

Errors are reported through the existing Notidian notification surface when available. The cell keeps or restores the previous display name after failed commits.

## Testing

Tests cover:

- basename display without `.md`
- rename target construction preserving parent folder and extension
- validation rejection for empty names, slash-containing names, and duplicate target paths
- successful rename calls `spaceManager.renamePath` with the computed target
- no context row value is written for title edits

## Non-Goals

- Do not introduce a frontmatter `title` property as a second authority.
- Do not support moving files by typing slashes in the title cell.
- Do not rename folders or tag spaces through this first implementation.
- Do not redesign the rest of the table editing system.
