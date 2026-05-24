# ADR 0003: Editable Page Titles Through File Renames

## Status

Accepted.

## Date

2026-05-24

## Purpose Of This Record

This is the canonical record for why file-name editing was hard in Make.md/Notidian, why direct generic cell editing was rejected, and why Notidian implements page-title editing as a controlled file rename transaction.

The broader ADR set explains the surrounding data-governance model. This file is intentionally self-contained so the file-renaming decision can be understood without reconstructing the reasoning from scattered plans, chat history, tests, or implementation details.

## User Goal

The user wants Notidian context tables to behave more like Notion databases:

- A folder should feel like a database.
- Each Markdown file should feel like a page row.
- The visible first column should behave like the page title.
- Clicking a row name should allow inline editing.
- Editing the name should update the real file, not a detached display value.
- There should not be a separate governance layer where Notidian says one thing and Obsidian files say another.

In Notion, the first column is a special title property. It is not a normal text field. It identifies the page represented by the row. The Obsidian equivalent is not a frontmatter `title`; it is the Markdown file path/name.

## Context

Make.md historically treated the built-in `File` column cautiously. That caution was technically reasonable. A file name is not ordinary metadata. It is part of the file path, and the path is used as identity by both Obsidian and Make.md.

In Obsidian, a Markdown note is not a database row with a hidden stable page ID. It is a file in a folder. The file path participates in:

- The physical vault file system.
- Obsidian's metadata cache.
- Internal links and embeds.
- Open editor panes and workspace state.
- File explorer state.
- Plugin path indexes.
- Make.md/Notidian context row identity.
- Space membership.
- Context relations.
- Aggregates and formulas that depend on row identity.
- Row ordering in context MDB files.
- Link rename handling.
- External tools that read or write the vault directly.

That means a file-name edit has a different risk profile than editing a frontmatter property such as `status` or `voltage`.

## Why Make.md Avoided Naive Direct Name Editing

The original Make.md behavior was not just an omission. A naive "make the File cell editable" implementation can create serious inconsistencies.

### File Path Is Identity

The context table's `File` value is not simply a value. It is the key that ties a row to a Markdown file.

If a generic text cell writes a new value into `row.File`, the table may display a different name while the actual file remains unchanged. That creates split-brain identity:

```text
Context row says: Relays & Devices/New Name.md
Vault file is:    Relays & Devices/Old Name.md
```

This is worse than a failed rename because it looks successful while corrupting the model.

### Rename Is A Cross-System Operation

Renaming a file affects many systems at once:

- The filesystem path must change.
- Obsidian must observe the rename.
- Metadata cache entries must move from old path to new path.
- Links may need to update.
- Notidian path indexes must update.
- Context rows containing the old path must update.
- Any row order in the context must be preserved.
- Views must refresh without duplicating rows.

A generic cell editor cannot safely coordinate those effects.

### Metadata Events Are Asynchronous

Obsidian and Notidian react to metadata and path events asynchronously. During live testing, a real race appeared:

1. The file was renamed.
2. Metadata sync saw the new path.
3. The context table appended the new path as a new row.
4. The original row order was lost because the renamed row appeared at the end.

This confirmed that the risk was not theoretical. Rename handling needed transaction-level reconciliation.

### Context Rows Can Duplicate

If the old row is not rewritten before the new path is indexed, the table can temporarily or durably contain both:

```text
Relays & Devices/Old Name.md
Relays & Devices/New Name.md
```

Or, after partial cleanup, it can contain the new path twice:

```text
Relays & Devices/New Name.md
Relays & Devices/New Name.md
```

This is especially harmful because context row order and row identity are user-visible database behavior.

### Row Order Is User Data

In a database-like table, row order may represent manual organization. A rename must not move a row to the end just because a metadata event arrived in a different order.

The live vault test showed this exact failure during development: a renamed row moved from index `0` to the end of the context. The final implementation specifically defends against that.

### File-System Constraints Are Not Text-Field Constraints

A file name must respect filesystem rules and vault rules:

- It cannot be empty.
- It cannot contain `/` when the operation is intended to rename only the basename.
- It must preserve the extension unless an explicit extension-editing feature exists.
- It must not collide with an existing file.
- It may need special handling for case-only renames on case-insensitive file systems.

A generic text editor does not know these constraints.

### Moving Is Not The Same Operation As Renaming

If the title cell allowed `/`, then typing a slash would combine two operations:

```text
Rename file
Move file to another folder
```

Moving a file has broader consequences than renaming the basename. It can change folder membership, database scope, backlinks, and context inclusion. For this phase, Notidian intentionally treats title editing as same-folder rename only.

### A Frontmatter Title Would Create A Second Authority

One tempting solution is to leave the file name alone and edit a frontmatter property:

```yaml
title: New Name
```

This was rejected because the user's goal is unified governance. If the table title comes from frontmatter but the note is still named `Old Name.md`, then the system has two titles. Other Obsidian tools, filesystem views, and links may still use the file name.

That is the decoupling the fork is trying to avoid.

## Decision

Treat the built-in `File` column as a special page title cell.

The visible title is a projection of the canonical path:

```text
visible title = basename(row.File)
```

Committing an edit performs a real file rename:

```text
new path = same folder + edited title + original extension
commit   = spaceManager.renamePath(old path, new path)
```

The title is not stored separately in frontmatter or context rows. The file path remains the source of truth.

## Implemented Behavior

For context tables whose row identity is the built-in `File` column:

- The cell displays the file basename without `.md`.
- Clicking the title starts inline editing.
- `Enter` commits the edit.
- Blur commits the edit.
- `Escape` cancels the edit.
- The rename preserves the parent folder.
- The rename preserves the file extension.
- Empty names are rejected.
- Names containing `/` are rejected.
- Duplicate target paths are rejected.
- Same-title edits are treated as no-ops.
- Modifier-click still opens the note.
- The `File` column header remains non-editable.

This intentionally makes `File` a special column. That matches the Notion model, where the title column is also special.

## Implemented Solution

The implementation has four layers.

### 1. Pure Title/Path Utilities

`pageTitle.ts` derives display titles and validates/builds rename targets.

Responsibilities:

- Convert a path to a visible title.
- Reject empty titles.
- Reject titles containing `/`.
- Preserve the parent folder.
- Preserve the file extension.
- Build the target path.

This keeps string/path behavior testable without UI or Obsidian state.

### 2. Page Title Cell UI

`PageTitleCell.tsx` is a dedicated cell for the built-in `File` column.

Responsibilities:

- Render the basename as the table title.
- Enter edit mode on normal click.
- Preserve note opening through modifier-click.
- Commit on blur or `Enter`.
- Cancel on `Escape`.
- Reset visible text on failed commits.

This avoids reusing generic text-cell or link-cell behavior for file identity.

### 3. Rename Transaction Helper

`pageTitleRename.ts` performs the actual rename transaction.

Responsibilities:

- Validate that the row has a file path.
- Build the target path.
- Detect no-op edits.
- Check duplicate target paths.
- Allow case-only rename scenarios where appropriate.
- Call `spaceManager.renamePath`.
- Return a typed success or failure result for deterministic handling.
- Wait for context state queue settlement.
- Reload the affected context.
- Preserve the original row position.
- Deduplicate rows for the renamed path.

This is the core protection against the Make.md failure modes.

### 4. Context Rename Ordering

`superstate.onPathRename` was adjusted so context rows are rewritten before the renamed path is reloaded.

That order matters:

```text
Preferred:
1. Rewrite context row old path -> new path
2. Remove orphaned old path rows
3. Reload/index the new path

Risky:
1. Reload/index the new path
2. Metadata sync appends a new row
3. Try to clean up after duplication already occurred
```

The transaction helper still performs delayed reconciliation because async metadata events can happen outside the ideal order.

## Why This Overcomes The Original Obstacles

### It Edits The Owning Layer

The owner of the page title is the file path. The implementation writes to the file path through a rename operation, not to a context row or frontmatter title.

### It Avoids Split-Brain Title State

There is no separate durable title value. The displayed title is always derived from `row.File`.

### It Preserves Context Semantics

The context row remains keyed by `File`, and row ordering is preserved after rename. This keeps the table behaving like a database rather than a raw file list.

### It Handles The Observed Async Race

The implementation was changed after live vault testing showed row-order loss. The final version waits for context sync, reloads the context, moves the renamed row back to the original index, and removes duplicate renamed rows.

### It Keeps Other File/Link Fields Safe

Only the canonical built-in `File` column uses this behavior. Other file/link fields are not converted into rename controls.

### It Respects Filesystem Constraints

The title editor validates file-name constraints before invoking the rename.

### It Makes Failures Explicit

The transaction distinguishes known failure reasons:

- `missing-path`
- `empty`
- `slash`
- `duplicate`
- `rename-failed`

The existing UI-compatible wrapper still returns `string | null`, but the underlying transaction returns a typed result. This keeps current callers stable while making future UI, tests, and telemetry deterministic.

### It Keeps Move Semantics Separate

Rejecting `/` is intentional. Same-folder rename and cross-folder move are different user actions and need different handling.

## Alternatives Considered

### Alternative 1: Keep File Names Read-Only

Rejected.

This is safe, but it fails the core Notion-like UX requirement. The user expects to edit row names directly.

### Alternative 2: Edit A Frontmatter `title`

Rejected.

This is easier to implement but creates two competing titles:

- File name.
- Frontmatter title.

That undermines the user's requirement that the system should not have decoupled data/governance.

### Alternative 3: Make `File` A Generic Editable Text Cell

Rejected.

This writes to the wrong layer and can corrupt row identity. The `File` column is identity, not ordinary cell data.

### Alternative 4: Replace The File Path With A Hidden Stable ID

Rejected as a default.

This would make rename behavior easier in some ways, closer to Notion's internal model. But hidden IDs would introduce another Notidian-owned governance layer. If stable IDs are ever needed, they should be explicit and probably stored in frontmatter, not hidden only in context MDB.

### Alternative 5: Allow Slashes And Treat Title Editing As Move/Rename

Rejected for this phase.

A move operation changes folder scope and can affect whether the file belongs in the current database. It deserves an explicit move command.

### Alternative 6: Replace Contexts With Obsidian Bases

Rejected for this decision.

Obsidian Bases aligns with the desired authority model, but it does not remove the rename problem. `file.name` is still file identity. Editing it still requires a controlled file rename transaction.

## Live Testing Findings

The important live finding was that rename order and metadata sync can cause row-order corruption.

During testing in the user's vault:

- A file in `Relays & Devices` was renamed from the Notidian table.
- The actual `.md` file was renamed.
- Context sync appended or moved the renamed row.
- The row that started at index `0` ended up at the end of the table in an intermediate implementation.

The implementation was then hardened:

- Rename context rows before path reload in `onPathRename`.
- Capture original row index in the title transaction.
- Wait for the context state queue.
- Reload the context after rename.
- Move the renamed row back to the original index.
- Remove duplicate renamed rows if metadata sync created them.

The final live test verified that:

- The file path changed on disk.
- The old path disappeared.
- The new path appeared.
- The context row stayed at the original row index.
- The rename could be reversed cleanly.

## Consequences

Positive consequences:

- The table feels more like a Notion database.
- The visible row title edits the actual Obsidian file.
- The file path remains canonical.
- No frontmatter `title` or hidden context title is introduced.
- The design is compatible with Obsidian-native governance.
- The implementation directly addresses metadata race and row-order problems.

Tradeoffs:

- The `File` column is special by design.
- Renaming is slower and more complex than ordinary cell editing.
- Some conflicts must be surfaced to the user rather than silently resolved.
- Cross-folder moves are not supported through the title cell.
- External filesystem moves/deletes still need broader lifecycle reconciliation.

## Current Implementation Files

Core path/title logic:

- `src/core/utils/contexts/pageTitle.ts`
- `src/core/utils/contexts/pageTitleRename.ts`

Tests:

- `src/core/utils/contexts/pageTitle.test.ts`
- `src/core/utils/contexts/pageTitleRename.test.ts`

UI routing and title cell:

- `src/core/react/components/SpaceView/Contexts/DataTypeView/PageTitleCell.tsx`
- `src/core/react/components/SpaceView/Contexts/DataTypeView/DataTypeView.tsx`
- `src/core/react/components/SpaceView/Contexts/TableView/TableView.tsx`

Context operation plumbing:

- `src/core/react/context/ContextEditorContext.tsx`
- `src/core/superstate/superstate.ts`

Related authority hardening:

- `src/core/utils/properties/propertyAuthority.ts`
- `src/core/utils/properties/frontmatterWrite.ts`

## Invariants To Preserve

Future work must preserve these invariants:

- The displayed title is derived from the file path.
- The title cell must not write a separate title into context MDB.
- The title cell must not create a frontmatter `title` authority by default.
- The built-in `File` property header must remain protected.
- A committed title edit must call the file rename path.
- Known rename failures must return explicit reasons rather than only collapsing to `null`.
- Rename must preserve row order.
- Rename must remove duplicate rows for the renamed path.
- Same-folder rename and cross-folder move must remain separate operations unless a future ADR explicitly changes that.
- External metadata/path events must be reconciled against file-system truth.

## Future Work

Recommended next work:

- Add a dedicated move command for changing folders from a table row.
- Add clearer UI feedback for duplicate-name and invalid-name failures.
- Add broader path lifecycle reconciliation for external file moves/deletes.
- Add integration tests with a fixture vault that exercises Obsidian metadata timing.
- Consider an explicit optional frontmatter stable ID only if relations or sync workflows require it, and only with a separate ADR.
