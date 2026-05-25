# ADR 0009: Frontmatter Conflict Detection

## Status

Accepted.

## Date

2026-05-25

## Context

Notidian treats Markdown frontmatter as the canonical source for ordinary note metadata. A table row can become stale if the same file is edited through another Obsidian surface, a script, Bases, Dataview-adjacent tooling, or direct YAML editing while the Notidian table is still open.

Without conflict detection, a stale Notidian table edit could overwrite a newer frontmatter value. That would violate the fork's core data-governance goal: editing through Notidian must not silently erase canonical vault data that changed elsewhere.

## Decision

Frontmatter-backed table writes compare the current canonical frontmatter value against the table row's base value before writing.

The comparison happens inside `executeTableValueWrites`, before `saveFrontmatterProperties` is called. `ContextEditorContext` supplies the current canonical value from `superstate.pathsIndex` metadata and formats it through the same `parseProperty` path used to project frontmatter into table rows.

If the canonical value differs from the row's current table value, Notidian skips that write with `frontmatter-conflict`. The table feedback layer surfaces the skipped cell with the readable reason:

```text
Frontmatter changed outside Notidian. Reload before editing.
```

No context row change is accepted for that skipped write.

The skipped cell can now expose inline resolution actions:

- Reload refreshes canonical table data and clears transient conflict feedback.
- Apply anyway re-runs the attempted write with `forceFrontmatterWrite: true`.

The cell tooltip includes the current canonical value, the table-rendered base value, and the attempted value so an overwrite is reviewable before it is applied.

`forceFrontmatterWrite` bypasses only the stale-value comparison. It still resolves the target path, writes frontmatter first, and fails if the canonical file write fails. This keeps the default behavior safe while allowing an explicit user-approved overwrite.

## Boundaries

This decision applies to ordinary frontmatter-backed table value writes, including:

- Direct single-cell edits.
- Paste.
- Cut.
- Delete/clear.
- Fill-from-selection paste.
- Undo replay for frontmatter-backed values.

It does not apply to:

- File rename conflict handling, which remains in the page-title rename transaction.
- Context-native MDB values.
- Property schema rename/delete operations.
- Durable multi-user conflict resolution.

If the current canonical metadata is unavailable, Notidian does not block the write solely because the cache is missing. This avoids false conflicts during metadata reload windows; real-vault fixture tests should continue hardening this edge.

## Why This Is The Best Fit

The user wants Notidian to behave like a Notion-style database while preserving Obsidian as the data authority. Last-writer-wins would make the table feel simple, but it would allow stale Notidian state to overwrite newer file metadata. Full merge prompts are better UX eventually, but they require more UI and conflict-resolution design.

The chosen design is conservative and low-risk: when Notidian can prove the table's base value is stale, it refuses that specific frontmatter write and leaves the canonical file untouched. The user may then explicitly choose Apply anyway for that cell, which routes the write back through the same frontmatter-first transaction helper.

## Alternatives Considered

### Last Writer Wins

Rejected.

This is simple but unsafe. It would allow Notidian to overwrite frontmatter edits made elsewhere, recreating hidden governance problems.

### Always Reload Before Every Edit

Rejected.

Reloading every table edit would be expensive and still would not provide a clear user-facing explanation when a value changed between render and commit.

### Full Conflict Merge Prompt

Partially deferred.

A prompt that lets users choose local, remote, or merged values is useful, but it needs careful interaction design for bulk paste and undo operations. Notidian now provides cell-local Reload and Apply anyway actions; richer diff/merge workflows remain future work.

## Consequences

Positive consequences:

- Stale frontmatter-backed table edits cannot silently overwrite newer canonical values.
- Conflict behavior is shared by direct edits, paste, clear, fill, cut, and undo replay.
- Users get cell-level skipped feedback and inline resolution actions when a conflict is detected.
- Context MDB rows are not updated for rejected frontmatter writes.

Tradeoffs:

- There is not yet a richer diff/merge prompt for conflicts.
- Conflict detection depends on the current metadata cache being available.
- Context-native fields still use their existing context MDB authority rules.

## Implementation Notes

Key files:

- `src/core/utils/contexts/tableEditTransaction.ts`
- `src/core/utils/contexts/tableEditTransaction.test.ts`
- `src/core/utils/contexts/tableEditFeedback.ts`
- `src/core/utils/contexts/tableEditFeedback.test.ts`
- `src/core/react/context/ContextEditorContext.tsx`

The transaction helper accepts `currentFrontmatterValue`. When supplied, it compares that value with the row value targeted by the write. A mismatch produces a skipped `frontmatter-conflict` issue and prevents the canonical write.

Conflict issues include:

- `currentValue`: the current canonical frontmatter value.
- `baseValue`: the value the table row was rendered from.
- `attemptedValue`: the user-entered value.

`TableCellWrite.forceFrontmatterWrite` allows a reviewed conflict write to bypass the stale-value comparison. It does not bypass file-path resolution or frontmatter write failure handling.

## Follow-Up Work

- Add richer conflict-resolution UI for local/remote/diff choice.
- Add DOM-level table automation for live conflict actions.
- Extend authority-aware conflict handling to property schema rename/delete operations.
