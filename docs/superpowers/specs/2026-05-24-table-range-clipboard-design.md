# Table Range Clipboard Design

## Goal

Make Notidian context tables behave like a Notion/Excel-style database grid: users can select rectangular blocks of cells, copy them, cut them, and paste them into other table locations while Notidian updates the real underlying authorities.

The table may feel like a spreadsheet, but it must not become a detached spreadsheet datastore. A paste gesture is an edit intent that Notidian converts into file, frontmatter, context, or computed-cell operations.

## Product Behavior

Users can:

- Select one cell by clicking it.
- Extend selection with shift-click.
- Drag across cells to select a rectangular range.
- Use arrow keys to move the active cell.
- Use shift plus arrow keys to extend the rectangular range.
- Copy the selected range with `Cmd/Ctrl+C`.
- Cut the selected range with `Cmd/Ctrl+X`.
- Paste tab/newline clipboard data with `Cmd/Ctrl+V`.
- Fill a larger selected range from a single copied cell.
- Paste a multi-cell block down and right from the active cell.
- Clear selected editable cells with `Delete` or `Backspace`.

Clipboard text uses TSV semantics:

```text
cell A1<TAB>cell B1
cell A2<TAB>cell B2
```

This makes Notidian interoperable with Notion, Excel, Google Sheets, Apple Numbers, and plain text editors.

## Core Decision

Implement range editing as an authority-aware transaction wrapper.

The wrapper owns selection, clipboard parsing, paste expansion, operation planning, progress state, and user feedback. It does not own durable cell data. Each target cell is delegated to a cell adapter that knows how to commit the value to the real source of truth.

```text
paste gesture
  -> clipboard grid
  -> target cell range
  -> operation plan
  -> preflight
  -> authority writes
  -> reconciliation from actual vault/context state
```

This preserves the desired Excel-like freedom without reintroducing hidden context governance for file-backed data.

## Authorities And Adapters

Each column resolves to an adapter before paste execution.

| Authority | Adapter | Commit behavior |
| --- | --- | --- |
| File/page title | `PageTitleCellAdapter` | Rename the Markdown file through a controlled rename transaction. |
| Frontmatter | `FrontmatterCellAdapter` | Write the parsed value to Markdown frontmatter and rely on metadata reload for projection. |
| Notidian context | `ContextCellAdapter` | Write the value to the Notidian context MDB row. |
| Computed/file property/aggregate | `ReadOnlyCellAdapter` | Reject or skip the paste target with a visible reason. |

The existing property authority model remains the source of truth for choosing the adapter.

## Bulk Page Title Paste

Bulk pasting into the `File` column is allowed only through a dedicated bulk rename transaction. It must not use ordinary context row value writes.

The transaction preflights the entire rename plan before applying any file rename:

- Reject empty names.
- Reject names containing `/` for title-only paste.
- Preserve each file's parent folder and extension.
- Reject target paths that already exist outside the selected rename set.
- Reject duplicate target paths inside the pasted set.
- Detect rename swaps and cycles.
- Use temporary paths when needed for swaps or case-only renames.
- Preserve row order after Obsidian metadata events.
- Remove duplicate renamed rows if metadata sync appends them.
- Report per-cell failures.

If preflight fails, Notidian does not partially apply the bulk rename. The user receives actionable feedback and the table remains governed by the current file paths.

If execution fails after preflight because the filesystem or Obsidian rejects an operation, Notidian records which operations succeeded, reconciles from actual vault state, and reports the remaining failed cells. A later undo journal can make this fully reversible, but v1 must at least avoid false success.

## Paste Planning

The paste planner is a pure utility with no React or Obsidian dependency.

Inputs:

- Visible row order.
- Visible editable column order.
- Active cell.
- Current selected rectangular range.
- Clipboard grid.
- Column authority metadata.

Outputs:

- The target rectangle.
- A list of planned cell writes.
- A list of rejected targets and reasons.
- Whether the operation is a normal property paste, a bulk rename paste, or a mixed transaction.

Expansion rules:

- A one-cell clipboard value fills the selected target range.
- A one-cell selected target receives the full clipboard grid down/right from the active cell.
- A multi-cell clipboard grid pasted onto a multi-cell selected range repeats only when the selected dimensions are exact multiples of the source grid.
- Targets outside visible rows/columns are ignored and reported as truncated.

## Selection Model

Table selection moves from row-plus-column state to explicit cell range state:

```ts
type CellCoord = {
  rowId: string;
  columnId: string;
};

type CellSelection = {
  anchor: CellCoord;
  focus: CellCoord;
  active: CellCoord;
};
```

The selected cells are always the rectangle between `anchor` and `focus` in the current visible row and column order. The active cell is where paste begins when there is no larger selected range.

Existing row selection can remain for row-level context menu behavior, but table clipboard behavior should use `CellSelection`.

## Error Handling

Failures must be explicit and local enough for users to understand what happened.

Examples:

- Read-only computed cells are skipped.
- Invalid frontmatter values are rejected before write when the column type has a parser.
- Failed frontmatter writes stop the affected cell from being accepted.
- File rename conflicts block bulk title paste before any rename.
- Mixed transactions show how many cells were applied, skipped, or failed.

The UI should not display a pasted value as accepted unless the owning authority accepted it or the value is marked as pending.

## Implementation Shape

Add pure utilities first:

- `tableClipboard.ts` for TSV parse/serialize.
- `tableSelection.ts` for rectangular selection and keyboard expansion.
- `tablePastePlan.ts` for paste target calculation and operation planning.
- Unit tests for all pure behavior.

Then update React integration:

- `TableView.tsx` owns `CellSelection`.
- Table cells render selected-range classes.
- Keyboard handlers call clipboard and paste-plan utilities.
- Paste execution delegates to `ContextEditorContext`.

Then update write execution:

- Add a batch edit API to `ContextEditorContext`.
- Reuse frontmatter write gating for frontmatter-backed cells.
- Reuse context MDB saves for Notidian-owned cells.
- Reuse and extend page title rename helpers for bulk rename preflight and reconciliation.

## Testing

Unit tests cover:

- TSV parsing and serialization.
- Rectangular range calculation.
- Shift-click and shift-arrow range expansion.
- Single-cell fill over a larger selected range.
- Multi-cell grid paste from the active cell.
- Truncated paste at table edges.
- Read-only target rejection.
- Frontmatter/context/file authority planning.
- Bulk file rename preflight for invalid names, duplicates, existing target collisions, swaps, and case-only renames.

Integration-oriented tests cover:

- Pasted frontmatter values call the frontmatter write path.
- Failed frontmatter writes do not persist context row values as accepted.
- Pasted context-native values save to context MDB.
- Bulk title paste calls file rename operations, preserves row order, and avoids duplicate rows.

## Non-Goals

- Do not create a hidden shadow spreadsheet as a durable source of truth.
- Do not silently sync failed pasted values later.
- Do not use context MDB row values as the durable store for frontmatter-backed cells.
- Do not treat slash-containing title pastes as moves in this feature. Moving files from table cells requires a separate move transaction.
- Do not implement full undo history in the first pass, though the batch operation shape should leave room for an undo journal.
