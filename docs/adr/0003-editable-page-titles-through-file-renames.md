# ADR 0003: Editable Page Titles Through File Renames

## Status

Accepted.

## Date

2026-05-24

## Context

The user wants a Notion-like table where clicking a row name lets them edit it directly. In Notion, the first column is a special title property: every database row is a page, and editing the title changes the page's title.

In Obsidian, the closest equivalent to a Notion page title is the Markdown file name. However, a file name is not an ordinary property. It is part of the file path, and the file path is identity throughout Obsidian and Make.md.

Make.md avoided direct name editing for understandable reasons. Treating the `File` column as a normal editable text cell is dangerous.

## Why Direct Name Editing Was Risky In Make.md

File names and paths participate in many systems at once:

- The physical file path in the vault.
- Obsidian metadata cache identity.
- Internal links and embeds.
- Open panes and UI state.
- Make.md path indexes.
- Context row identity.
- Space membership.
- Relation maps and context lookup tables.
- Row ordering in MDB context tables.
- Filesystem constraints such as duplicate names, invalid path characters, and case-only renames.

A naive implementation could produce several failure modes:

- The visible table title changes but the actual file name does not.
- A file is renamed but the context table keeps the old path.
- Obsidian metadata sync appends a duplicate row for the new path.
- The renamed row moves to the end of the table.
- Links or path caches briefly reference stale paths.
- Two files collide at the same target path.
- A frontmatter `title` property becomes a second competing title authority.

These risks explain why Make.md treated the file column cautiously and did not simply make it a generic editable text field.

## Decision

Treat the built-in `File` column as a special page title cell.

The visible title is a projection:

```text
visible title = basename(row.File)
```

Committing an edit performs a file transaction:

```text
commit title = spaceManager.renamePath(row.File, sameFolder/newTitle.ext)
```

The title is not stored separately in context rows or frontmatter. The actual Markdown file path remains canonical.

## Behavior

For the built-in `File` column:

- Display the basename without `.md`.
- Click to edit inline.
- `Enter` or blur commits.
- `Escape` cancels.
- The rename preserves the parent folder and extension.
- Empty names are rejected.
- Names containing `/` are rejected.
- Duplicate target paths are rejected, except no-op/case-only handling.
- Modifier-click still opens the note.

The column definition itself remains locked. Users can edit row titles, but they cannot rename the canonical `File` property header as if it were a normal field.

## How The Implementation Overcomes The Risks

### It Does Not Create A Second Title

No frontmatter `title` property is introduced. No context-row title value is stored. The rendered name comes from the file path.

### It Uses The Real Rename Path

The transaction calls `spaceManager.renamePath`, so the file system and Obsidian/Notidian rename handling are involved. This is not a context string update.

### It Narrows The Editable Surface

Only the canonical built-in `File` column receives `PageTitleCell`. Other file/link fields continue to use normal link cell behavior.

### It Validates Before Renaming

The rename helper rejects invalid titles and duplicate targets before attempting the file operation.

### It Handles Metadata Races

The observed race was that metadata sync could append the renamed path as a new row before the old context row was rewritten. The implementation addresses this in two layers:

1. `onPathRename` rewrites context rows before reloading the new path.
2. The title transaction waits for context sync, reloads the context, preserves original row position, and removes duplicate renamed rows.

### It Preserves Row Order

Before renaming, Notidian records the original row index. After metadata sync settles, it moves the renamed row back to that index if needed.

### It Deduplicates Renamed Rows

If async sync leaves multiple rows with the renamed path, the transaction keeps one row and removes the duplicates while preserving the original row position.

## Alternatives Considered

### Edit A Frontmatter `title` Property

Rejected.

This would be easier, but it creates two titles: the file name and the frontmatter title. The user explicitly wants unified governance, not a decoupled title layer.

### Let Users Type Paths In The Title Cell

Rejected for this phase.

Typing slashes would combine rename and move semantics. Moving files has more consequences than renaming the basename. It should be a separate explicit operation.

### Make The `File` Column A Generic Text Cell

Rejected.

This would write to the wrong layer and recreate split-brain identity.

### Keep File Names Read-Only

Rejected.

This is safer but fails the Notion-like row editing goal.

## Consequences

Positive consequences:

- The table feels much more like a Notion database.
- The file system remains canonical.
- There is no duplicate title property.
- Rename races are explicitly handled.

Tradeoffs:

- The `File` column is intentionally special.
- File renames remain heavier than normal property edits.
- Future move support must be designed separately.
- External filesystem renames still need robust reconciliation beyond this specific UI path.

## Implementation Notes

Key files:

- `src/core/utils/contexts/pageTitle.ts`
- `src/core/utils/contexts/pageTitleRename.ts`
- `src/core/react/components/SpaceView/Contexts/DataTypeView/PageTitleCell.tsx`
- `src/core/react/components/SpaceView/Contexts/DataTypeView/DataTypeView.tsx`
- `src/core/react/components/SpaceView/Contexts/TableView/TableView.tsx`
- `src/core/react/context/ContextEditorContext.tsx`
- `src/core/superstate/superstate.ts`

## Follow-Up Work

- Add an explicit move command for changing folders.
- Add conflict UI when a rename target exists.
- Extend path lifecycle reconciliation for external moves and deletes.
