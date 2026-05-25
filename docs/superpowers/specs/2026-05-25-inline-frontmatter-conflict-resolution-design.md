# Inline Frontmatter Conflict Resolution Design

## Goal

Turn stale frontmatter edit skips into an inline, actionable table workflow without weakening Notidian's source-of-truth model.

When a table edit conflicts with a newer canonical frontmatter value, Notidian should keep the safe default behavior: do not overwrite the file. The user should then be able to resolve the conflicted cell from the table by either reloading canonical data or explicitly applying their attempted value anyway.

## Approaches Considered

### Message Only

Keep the current skipped-cell feedback and improve the tooltip text.

This is safe but not sufficient. It still forces the user to manually reload, find the value again, and re-enter the edit.

### Blocking Modal

Show a conflict modal whenever a stale frontmatter write is skipped.

This makes the decision explicit, but it interrupts spreadsheet-like work. It is especially awkward for paste operations with multiple skipped cells.

### Inline Actions

Keep the conflict localized to the affected cell and show two actions:

- Reload: refresh canonical table data and clear the conflict feedback.
- Apply anyway: re-run the attempted write through the same transaction path with an explicit forced-frontmatter flag.

This is the selected approach. It keeps Notidian safe by default, keeps table editing local and fluid, and makes the dangerous operation explicit.

## Transaction Model

`TableCellWrite` gains an optional `forceFrontmatterWrite` flag.

Default behavior remains unchanged:

- If the current canonical frontmatter value differs from the row value the table edit was based on, the write is skipped with `frontmatter-conflict`.
- No file write occurs.
- No context row value is accepted.

Forced behavior is opt-in:

- A write with `forceFrontmatterWrite: true` bypasses only the stale-value comparison.
- It still resolves the target file path.
- It still writes frontmatter before accepting the table/context edit.
- It still returns failure if the frontmatter write fails.

The conflict issue should include enough detail for feedback:

- The attempted value.
- The table row base value.
- The current canonical frontmatter value.

## UI Behavior

A conflicted cell remains visually distinct from a generic skipped cell. The cell should show:

- A clear tooltip explaining that the file changed outside Notidian.
- A small inline conflict action row.
- A Reload action.
- An Apply anyway action.

Reload should refresh the current context from Obsidian and clear the transient conflict feedback.

Apply anyway should re-run the conflicted write with `forceFrontmatterWrite: true`. It should show pending feedback while running and then reuse the same success, failed, or skipped feedback handling as every other table write.

## Safety Invariants

- Silent overwrite remains impossible.
- Context MDB rows do not become canonical for frontmatter-backed values.
- The only bypass is explicit, cell-local, and represented in the transaction input.
- Failed forced writes still remount the cell from canonical data.
- Existing paste, direct edit, and field-option paths continue to use the same transaction helper.

## Testing

Unit tests cover:

- Default conflict skip still prevents writes.
- Forced frontmatter writes bypass only the stale-value comparison.
- Conflict issues carry current/base/attempted values.
- Feedback maps frontmatter conflicts to a conflict action state.
- Conflict feedback preserves the write needed for Apply anyway.

The existing real-vault smoke harness remains valid for live metadata/cache behavior. DOM-level table automation remains future work.
