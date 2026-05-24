# ADR 0001: Authority-Partitioned Database Model

## Status

Accepted.

## Date

2026-05-24

## Context

The fork exists because the original Make.md context model does not behave enough like an Obsidian-native Notion-style database. A folder such as `Relays & Devices` can contain Markdown files with existing YAML properties, but Make.md historically treated the folder context as a separate MDB-backed structure. That can leave existing frontmatter invisible until Make.md context columns are created, and it can make context rows feel like a second governance layer.

The desired behavior is different:

- Opening a folder as a database should surface existing note properties.
- Editing properties from the table should update the Markdown file.
- Editing properties outside Notidian should update the table.
- Editing a row title should update the actual file identity, not a separate display value.
- Advanced Make.md features should not be thrown away if they can coexist with Obsidian-native data authority.

The central trilemma is:

1. A Notion-like table UX wants rows, schemas, inline edits, views, formulas, relations, and page-like rows.
2. Obsidian-native governance wants plain files and frontmatter to remain readable, editable, and authoritative outside Notidian.
3. Make.md compatibility wants existing context features, row ordering, custom fields, filters, and view behavior to keep working.

No single storage layer can maximize all three goals. A pure context database breaks Obsidian-native governance. A pure `.base` or raw-frontmatter rewrite loses too much Make.md behavior and still does not solve file-name edits by itself.

## Decision

Use an authority-partitioned database model.

| Data kind | Canonical authority | Notidian role |
| --- | --- | --- |
| Page identity | File path/name | Display, rename transaction, context row identity |
| Ordinary note metadata | Markdown frontmatter / Obsidian metadata cache | Discover, project, edit through frontmatter writes |
| View layout | Notidian context MDB | Persist column order, hidden columns, filters, grouping, sorting, view state |
| Context-native fields | Notidian context MDB | Persist values when the field is explicitly Notidian-owned |
| Formulas and aggregates | Computed from current inputs | Recompute and display; do not treat as durable user data |
| Relations | Notidian context model, unless later mapped to frontmatter links | Preserve existing Make.md semantics |

Notidian context MDB files remain useful, but they are no longer allowed to silently own ordinary file-backed data. They are a view/configuration/cache layer for file-backed properties, not the source of truth for those properties.

## Why This Is The Best Fit

This model gives the closest Notion-like experience that still respects Obsidian's file-first architecture.

It preserves the user's core requirement: no hidden second database should govern ordinary metadata. It also avoids a destabilizing rewrite of Make.md's context engine before the fork has a stable replacement for views, formulas, relations, ordering, and existing context data.

The model intentionally resembles Obsidian Bases at the data boundary: note properties live in files, while a view definition controls how they are displayed. Notidian differs by continuing to support richer Make.md context features that Bases may not represent one-to-one.

## Alternatives Considered

### Keep Make.md Contexts As The Canonical Database

Rejected.

This preserves Make.md behavior but violates the main goal. Any failed sync between context rows and frontmatter creates split-brain data: the table says one thing, the file says another.

### Replace Contexts Entirely With Obsidian Bases

Rejected for now.

This maximizes native alignment but would require replacing major parts of the Make.md context renderer and would lose or delay Make.md-specific behavior. It also does not solve direct file-name editing because file names are still identity, not ordinary cell values.

### Bidirectional Sync Between Context Rows And Frontmatter

Rejected as a primary model.

Bidirectional sync sounds convenient but creates conflict ambiguity. When both stores have values, the system must decide which one wins. That is exactly the governance ambiguity this fork is meant to remove.

### Add Hidden Stable Page IDs In Context MDB

Rejected as a default.

Notion has stable internal page IDs, but adding hidden context-owned IDs would introduce another governance layer. If stable IDs become necessary, they should be explicit frontmatter properties or an opt-in migration, not hidden MDB state.

## Consequences

Positive consequences:

- Plain Markdown and frontmatter remain inspectable and portable.
- Notidian edits are visible across Obsidian, native Properties, Bases, Dataview, scripts, and external tools.
- Make.md context features can be preserved incrementally.
- The system can reason about ownership per column instead of guessing.

Tradeoffs:

- Some operations require transactions rather than simple cell writes.
- File renames remain inherently asynchronous and need reconciliation.
- Context-native fields still exist, but they must be explicit.
- A later migration path is needed for older Make.md contexts that have unmarked frontmatter-like columns.

## Implementation Notes

The authority model is now represented in code by `propertyAuthorityForColumn`, `shouldWriteAuthorityValueToFrontmatter`, and `shouldPersistAuthorityValueToContext` in `src/core/utils/properties/propertyAuthority.ts`.

The current authority categories are:

- `file`
- `frontmatter`
- `notidian`
- `computed`

## Follow-Up Work

- Add a migration command for legacy Make.md contexts.
- Add explicit UI labeling for frontmatter-backed versus Notidian-owned columns.
- Add property rename/delete flows that distinguish view changes from frontmatter key changes.
- Add conflict reporting for concurrent external edits.
