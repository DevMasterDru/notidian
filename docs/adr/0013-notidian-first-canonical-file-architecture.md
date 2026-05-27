# ADR 0013: Notidian-First Canonical File Architecture

## Status

Accepted.

Supersedes ADR 0011 as the strategic product direction. ADR 0011 remains useful historical context for why Bases alignment was explored, but Notidian is no longer defined as Bases-first.

## Date

2026-05-27

## Context

Notidian started as a Make.md fork because Make.md had the right ambition: make Obsidian feel closer to a Notion workspace. The problem was the source-of-truth split. Make.md contexts can contain schema, rows, view state, formulas, relations, aggregates, ordering, and cached values in a separate context database. That was understandable before Obsidian had a native database direction, but it creates the exact governance problem Notidian is meant to avoid:

- a user edits Markdown files or frontmatter and the table can show a different context-owned reality;
- a table edit can appear accepted even when the file did not change;
- AI agents and users can disagree about whether the file, the context, or a generated view file is canonical;
- migration risks are hidden because context-only values can be valuable but invisible in ordinary note files.

The fork initially moved toward Bases-first convergence because Obsidian Bases has the right native primitives for ordinary file databases: files are rows, frontmatter is note properties, file metadata is projected as `file.*`, formulas are computed, and `.base` files describe views. That alignment work was valuable. It forced Notidian to harden frontmatter-backed columns, file-title rename transactions, conflict detection, undo, `.base` export, and custom Bases view feasibility.

The user's product preference is now explicit:

- Notidian should be the primary database experience.
- The user does not want to use native Bases as the main database UI.
- The data must behave like a Notion database where useful, but without Notion's unnecessary complexity.
- Ordinary data governance must not be decoupled from Markdown files, file paths, and frontmatter.

This changes the strategic center. Native Bases remains important for interoperability and semantics, but it should not own Notidian's product architecture.

## Decision

Adopt a Notidian-first canonical file architecture.

The governing product contract is:

- Notidian is the primary database UX.
- Markdown files are rows.
- File path and basename are page identity.
- Markdown frontmatter owns ordinary editable properties.
- Notidian context MDB stores view configuration, UI preferences, legacy state, compatibility state, relations, formulas that cannot yet be represented canonically elsewhere, and explicit Notidian-owned fields.
- Context MDB must not silently own ordinary note metadata.
- `.base` files are optional interoperability artifacts, import/export targets, mirror targets, or runtime proof surfaces. They are not the default product center and not the ordinary data authority.
- Native Bases behavior informs compatibility decisions, but Notidian does not have to become native Bases.

This decision keeps the strongest part of Bases alignment while removing the strategic mistake: treating native Bases as the destination instead of treating it as a compatible Obsidian surface.

## Architecture Rule

Every durable value must have exactly one canonical owner.

| Durable concern | Canonical owner | Notidian role |
| --- | --- | --- |
| Row identity | Markdown file path | Render, sort, filter, create, rename, move, and delete through Obsidian file APIs. |
| Page title | File basename/path | Edit through rename or move transactions only. |
| Ordinary properties | Markdown frontmatter | Discover, type, display, edit, paste, fill, conflict-check, and migrate through frontmatter writes. |
| File projections | Obsidian file metadata | Display as read-only unless mapped to a safe file operation. |
| Computed values | Formula inputs at render time | Display derived values; do not persist as ordinary row data. |
| View state | Notidian view model, stored in context MDB today | Own layout, visible columns, widths, filters, grouping, sorting, local IDs, and UX preferences. |
| Explicit Notidian-owned fields | Notidian context MDB | Store only when the field is clearly labeled and cannot be treated as ordinary note metadata. |
| Legacy Make.md values | Notidian context MDB until audited | Preserve, classify, migrate, or explicitly retain. |
| Bases interop | `.base` files | Export/import/mirror supported semantics without making `.base` canonical. |

## Why Direct File-Name Editing Was Avoided

Make.md did not simply make the visible name cell rename the file because file names are not ordinary strings. They are path identity. Naive edits can break links, conflict with existing files, collide inside bulk operations, race Obsidian metadata refresh, create duplicate table rows, or leave detached context values that no longer point at a real note.

Notidian's solution is not "make the name editable anyway." The chosen solution is a controlled rename transaction:

- the visible name is derived from the file path;
- the edit is validated before writing;
- empty names, slash-containing same-folder edits, duplicate targets, and invalid paths are rejected;
- the rename uses Obsidian's file APIs;
- mixed title/property paste writes title changes first and retargets property writes to the renamed path;
- undo replays through the same authority-aware path;
- metadata reload and duplicate rows are reconciled after the operation.

That makes the table feel editable without turning file identity into a detached context field.

## Why Not Native Bases-First

Native Bases-first was the right thing to explore, but it is not the right final product architecture for this user's Notidian.

Downsides of Bases-first as the product center:

- It makes a UI the user does not prefer into the default database surface.
- It can make Notidian's table UX dependent on native Bases API maturity and custom view limits.
- It pushes Notidian toward `.base` view files even when the user wants a Notidian database experience over ordinary folders.
- It risks reducing Notidian to an adapter layer instead of the product layer that provides Notion-like editing.
- It can still require Notidian-owned state for advanced UX, creating a confusing mix of native Bases and Notidian context anyway.

The correct preservation of the Bases work is compatibility:

- understand `.base` syntax and semantics;
- export supported Notidian views to `.base`;
- import or mirror `.base` views where useful;
- keep the custom Bases view as an optional proof and compatibility surface;
- use native semantics to avoid inventing incompatible property/filter/formula behavior.

## Why Not Fully Standalone Context Database

A fully standalone Notidian database would maximize UX freedom but would recreate Make.md's core problem.

Rejected behaviors:

- ordinary metadata stored only in MDB rows;
- background bidirectional sync between frontmatter and context values as the primary model;
- hidden context columns shadowing frontmatter keys;
- table acceptance before file/frontmatter write success;
- AI guidance that treats Notidian context files as the place to enter ordinary database data.

Notidian may use indexes, caches, and context state for performance and UX. Those layers must be rebuildable or explicitly labeled as Notidian-owned. They must not become the hidden ordinary data authority.

## What Was Not A Mistake

Moving toward Bases semantics was not a mistake.

That work produced useful constraints and implementations:

- file rows instead of detached rows;
- frontmatter-backed columns;
- `file.name` as file identity rather than a title property;
- `.base` export warnings for unsupported behavior;
- a custom view proving live Bases query projection and authority-aware writes;
- Obsidian CLI and real-vault harness validation for runtime behavior.

The correction is scope. Bases is not the product owner. Notidian is.

## Consequences

Positive consequences:

- Users can choose Notidian as the only database UI they regularly use.
- AI agents have a clear default: create Markdown files with frontmatter and a Notidian view, not hidden context rows or native Bases files.
- The system remains compatible with Obsidian's native direction without depending on it for core UX.
- Make.md context data is preserved until audited and explicitly migrated.
- Existing safety work around renames, frontmatter writes, paste, conflict detection, and undo remains central.

Tradeoffs:

- Notidian must own more UI and transaction code than a pure Bases wrapper.
- `.base` export/import/mirroring must be explicitly scoped and tested because it is optional compatibility, not the canonical store.
- Context MDB remains in the architecture for view state, legacy data, and explicit Notidian features, so contributors must keep authority boundaries clear.
- Some native Bases features may not appear in Notidian until they serve the Notidian UX.

## Implementation Direction

The implementation path is:

1. Lock the architecture in docs, ADRs, and AI skills.
2. Treat the context-backed Notidian table as the primary database surface until a better Notidian-owned renderer replaces it.
3. Complete authority-aware table UX: redo, copy/paste/fill, title rename, conflict merge, schema operations, row create/delete, and move.
4. Build a canonical schema and row service over Markdown files and frontmatter.
5. Partition context MDB into view state, explicit Notidian-owned data, legacy state, and compatibility state.
6. Add opt-in legacy Make.md write migration with preview and review.
7. Keep Bases interop as import/export/mirror/custom-view compatibility.
8. Use Obsidian CLI and real-vault harnesses to prove runtime behavior in an actual vault.

The complete plan is saved in `docs/superpowers/plans/2026-05-27-notidian-first-architecture.md`.

## Invariants

Future work must preserve these rules:

- Notidian database rows are Markdown files unless a feature explicitly declares a non-file row type.
- Ordinary editable properties are frontmatter-backed by default.
- File-title edits are file rename or move transactions.
- A table edit is accepted only after the canonical write succeeds.
- Stale frontmatter writes are skipped or explicitly resolved by the user.
- Context MDB cannot silently shadow ordinary frontmatter.
- `.base` files cannot become the only source of ordinary Notidian database data.
- Unsupported import/export/mirror semantics must be surfaced.
- Legacy context-only values must not be stripped without audit, preview, and explicit resolution.
- AI guidance for Atlas Vault database creation must default to Markdown files plus frontmatter plus Notidian views.

## Relationship To Other ADRs

- ADR 0001 remains the authority-partitioned source-of-truth model.
- ADR 0002 remains the rule for frontmatter-backed columns.
- ADR 0003 remains the canonical record for editable page titles and rename transactions.
- ADR 0005 remains historical Bases-alignment context but is narrowed by this ADR.
- ADR 0010 remains the rule for audit-first legacy context migration.
- ADR 0011 is superseded as the strategic product direction.
- ADR 0012 remains accepted as an optional Bases compatibility and feasibility gate, not as a required table replacement path.
