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

The chosen design is conservative and low-risk: when Notidian can prove the table's base value is stale, it refuses that specific frontmatter write and leaves the canonical file untouched.

## Alternatives Considered

### Last Writer Wins

Rejected.

This is simple but unsafe. It would allow Notidian to overwrite frontmatter edits made elsewhere, recreating hidden governance problems.

### Always Reload Before Every Edit

Rejected.

Reloading every table edit would be expensive and still would not provide a clear user-facing explanation when a value changed between render and commit.

### Full Conflict Merge Prompt

Deferred.

A prompt that lets users choose local, remote, or merged values is useful, but it needs careful interaction design for bulk paste and undo operations. The first requirement is to stop silent overwrites.

## Consequences

Positive consequences:

- Stale frontmatter-backed table edits cannot silently overwrite newer canonical values.
- Conflict behavior is shared by direct edits, paste, clear, fill, cut, and undo replay.
- Users get cell-level skipped feedback when a conflict is detected.
- Context MDB rows are not updated for rejected frontmatter writes.

Tradeoffs:

- There is not yet an inline merge or overwrite-anyway prompt.
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

## Follow-Up Work

- Add an explicit conflict-resolution UI for local/remote choice.
- Add real-vault fixture tests for metadata cache timing.
- Extend authority-aware conflict handling to property schema rename/delete operations.
