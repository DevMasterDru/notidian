# ADR 0015: Canonical Schema Planning

## Status

Accepted.

## Date

2026-05-27

## Context

Notidian is expected to feel like a Notion-style database, including property creation, rename, and deletion. In a Markdown vault, those operations are not merely display changes.

The risky cases are:

- creating a property should not write empty keys into every file unless the user asks for default backfill;
- renaming a property can destroy data when a file already has both the old key and the new key;
- deleting a property can mean either hiding a column from the view or deleting a frontmatter key from files;
- type inference must not coerce existing YAML values as a side effect of displaying a table;
- context MDB schema state must not become hidden ordinary metadata authority.

Make.md avoided direct file-name and property mutation because a context database can store a detached table schema without touching files. That is safer for generic workspace features, but it creates the decoupled governance problem Notidian is explicitly trying to remove.

## Decision

Add a pure Notidian schema planner before adding destructive schema UI/apply flows, then wire apply commands only where the planner can prove the operation is automatically safe.

The planner is responsible for:

- discovering frontmatter keys across a row set without writing files;
- inferring conservative property types from observed frontmatter values;
- planning property creation as a frontmatter-backed view/schema column with no file writes by default;
- planning property rename as a per-file migration preview;
- classifying rename states as `old-only`, `new-only`, `both-same`, `both-conflict`, or `neither`;
- blocking automatic rename application when a file contains conflicting old and new values;
- planning property deletion as either hide-from-view or explicit frontmatter deletion;
- returning frontmatter write previews that UI/apply code can execute only after confirmation or conflict resolution.

The first implemented apply flow is automatic frontmatter key rename for non-conflicting plans. It is exposed as `Rename Frontmatter Key` in the column header menu. Confirmed destructive deletion is also implemented for frontmatter-backed columns: the header menu's `Delete Property` action previews affected files, requires confirmation when frontmatter will be removed, revalidates before writing, removes YAML keys from affected files, clears active view references for that column, and hides the column from the current view. Frontmatter-backed table headers display deterministic labels generated from canonical YAML keys, use a very faint marker when labels differ from the raw key, show the full generated label on hover, and keep casual header-name edits from creating display aliases.

The implemented foundation lives in:

- `src/core/utils/contexts/notidianSchema.ts`
- `src/core/utils/contexts/notidianSchema.test.ts`
- `src/core/utils/contexts/notidianSchemaApply.ts`
- `src/core/utils/contexts/notidianSchemaApply.test.ts`

## Why This Is The Right Foundation

This keeps the Notion-like UX goal without returning to hidden Make.md-style authority.

The table can eventually offer simple property commands, but the command path will first know exactly which canonical files are affected and which operations are unsafe. The user can be shown the real consequences before any file is changed.

This also keeps schema work composable with the existing authority-aware write architecture:

- normal property edits still write frontmatter through value transactions;
- page-title edits still use file rename transactions;
- schema rename uses planner output, revalidates the preview after confirmation, writes replacement frontmatter before removing the old key, and stops on the first failed file operation;
- schema delete can later call frontmatter write helpers using the planner output;
- context MDB remains view/schema state, not hidden ordinary row data.

## Consequences

Positive consequences:

- schema behavior is testable without Obsidian runtime state;
- destructive operations have an explicit preview model;
- property rename conflicts are visible before data is changed;
- non-conflicting property renames can be applied from the table without returning to hidden context-only governance;
- create-property defaults to no file writes, avoiding noisy empty frontmatter;
- delete-property distinguishes view cleanup from canonical data deletion.

Tradeoffs:

- this ADR does not yet add the final UI for property creation, default backfill, or conflict resolution;
- direct header text edits for frontmatter-backed columns do not rename canonical YAML keys and do not create display aliases; visible labels are generated from the key, and canonical key changes must use the explicit rename command;
- destructive frontmatter-backed table delete actions require confirmation and must not run as casual hide-only view operations;
- only non-conflicting renames are applied automatically; conflict rows still require a future resolution UI;
- formulas and richer view definitions that reference renamed properties still need broader update planning.

## Invariants

- A schema operation must not silently write or delete frontmatter.
- A rename with `both-conflict` files must require explicit resolution.
- A rename apply path must write the new key before deleting the old key, so a failed set does not remove the user's existing value.
- A rename apply path must re-plan after confirmation and abort if file states or planned writes changed.
- A create-property operation must not backfill frontmatter unless the user explicitly requests it.
- A delete-property operation must distinguish hiding a column from deleting the frontmatter key.
- Mixed observed types must resolve conservatively, currently to `text`.
- Planner output is a preview, not proof that a later write still cannot conflict with newer external edits.

## Future Work

Next schema work should continue wiring this planner into Notidian table UI commands:

1. create property as a visible frontmatter-backed column;
2. optional default backfill through authority-aware frontmatter writes;
3. rename conflict resolution for files that contain different old and new values;
4. delete property preview with hide-only and destructive modes;
5. update formulas and richer saved view definitions that reference renamed or deleted properties.
