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

Add a pure Notidian schema planner before adding destructive schema UI/apply flows.

The planner is responsible for:

- discovering frontmatter keys across a row set without writing files;
- inferring conservative property types from observed frontmatter values;
- planning property creation as a frontmatter-backed view/schema column with no file writes by default;
- planning property rename as a per-file migration preview;
- classifying rename states as `old-only`, `new-only`, `both-same`, `both-conflict`, or `neither`;
- blocking automatic rename application when a file contains conflicting old and new values;
- planning property deletion as either hide-from-view or explicit frontmatter deletion;
- returning frontmatter write previews that later UI/apply code can execute only after confirmation or conflict resolution.

The implemented foundation lives in:

- `src/core/utils/contexts/notidianSchema.ts`
- `src/core/utils/contexts/notidianSchema.test.ts`

## Why This Is The Right Foundation

This keeps the Notion-like UX goal without returning to hidden Make.md-style authority.

The table can eventually offer simple property commands, but the command path will first know exactly which canonical files are affected and which operations are unsafe. The user can be shown the real consequences before any file is changed.

This also keeps schema work composable with the existing authority-aware write architecture:

- normal property edits still write frontmatter through value transactions;
- page-title edits still use file rename transactions;
- schema rename/delete can later call frontmatter write helpers using the planner output;
- context MDB remains view/schema state, not hidden ordinary row data.

## Consequences

Positive consequences:

- schema behavior is testable without Obsidian runtime state;
- destructive operations have an explicit preview model;
- property rename conflicts are visible before data is changed;
- create-property defaults to no file writes, avoiding noisy empty frontmatter;
- delete-property distinguishes view cleanup from canonical data deletion.

Tradeoffs:

- this ADR does not yet add the final UI for property creation, rename, delete, default backfill, or conflict resolution;
- until that UI exists, direct header text edits for frontmatter-backed columns are display aliases rather than canonical YAML key renames;
- the planner must be wired into UI commands and transaction helpers before users can safely run destructive schema migrations from the table;
- formulas and view predicates that reference renamed properties still need update planning.

## Invariants

- A schema operation must not silently write or delete frontmatter.
- A rename with `both-conflict` files must require explicit resolution.
- A create-property operation must not backfill frontmatter unless the user explicitly requests it.
- A delete-property operation must distinguish hiding a column from deleting the frontmatter key.
- Mixed observed types must resolve conservatively, currently to `text`.
- Planner output is a preview, not proof that a later write still cannot conflict with newer external edits.

## Future Work

Next schema work should wire this planner into Notidian table UI commands:

1. create property as a visible frontmatter-backed column;
2. optional default backfill through authority-aware frontmatter writes;
3. rename property preview with conflict resolution;
4. delete property preview with hide-only and destructive modes;
5. update formulas, filters, sorts, and saved view definitions that reference renamed or deleted properties.
