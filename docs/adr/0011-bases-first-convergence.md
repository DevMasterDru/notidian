# ADR 0011: Bases-First Convergence

## Status

Accepted.

## Date

2026-05-26

## Context

Make.md built its own context/indexing/database mechanism before Obsidian Bases existed. That history explains why Make.md contexts contain schema, rows, ordering, formulas, relations, aggregates, view state, and compatibility data.

Notidian exists for a different goal: make Obsidian folders and Markdown files feel like durable, Notion-style databases without separating data governance from Obsidian's native files and properties.

Obsidian Bases now provides the native direction for database-like views:

- files are the rows;
- file metadata is exposed as file properties;
- frontmatter is exposed as note properties;
- formulas are computed from available inputs;
- `.base` files describe filters, formulas, summaries, properties, and views.

That model matches Notidian's authority requirements better than the original Make.md context model. However, a pure immediate switch to native Bases would still be risky because Notidian has implemented behavior that Bases does not automatically provide as a migration-safe product layer:

- controlled page-title editing through file rename transactions;
- stale frontmatter conflict detection and explicit overwrite actions;
- spreadsheet-style range paste, cut, delete, and undo through authority-aware write paths;
- audit-first legacy context migration planning;
- compatibility with existing Make.md context data that may contain valuable context-only values.

The question is no longer whether Notidian should merely "align" with Bases. It should. The question is how aggressively to converge without losing user data or useful Notion-like workflows.

## Decision

Adopt Bases-first convergence as Notidian's long-term architecture.

Notidian's durable product contract is:

- Ordinary database rows are Markdown files.
- Ordinary editable database values are Markdown frontmatter properties.
- File/page titles are file path identity and are edited only through rename transactions.
- View definitions should be `.base`-compatible wherever the semantics match.
- Context MDB storage is compatibility and advanced Notidian state, not the default authority for ordinary metadata.
- Notidian-owned context fields must be explicit. They must not silently shadow frontmatter keys.
- New database features should be designed against Bases semantics first, then extended only when Notidian has a clear user-facing reason.

This refines ADR 0005. ADR 0005 correctly rejected an immediate replacement of contexts with `.base` files. This ADR goes further: the strategic center is now Bases-compatible semantics, with Make.md contexts gradually demoted to compatibility and explicit advanced state.

## What Bases-First Means

Bases-first does not mean Bases-only today.

It means Notidian should prefer the native Obsidian representation whenever it can safely represent the workflow:

| Concern | Preferred durable representation |
| --- | --- |
| Row identity | Markdown file path |
| Page title | File basename/path |
| Ordinary properties | Markdown frontmatter |
| File projections | `file.*`-style metadata |
| Formulas | `.base`-compatible formula definitions where possible |
| View filters/order/visible columns | `.base`-compatible view definitions where possible |
| Notidian table interaction state | Transient UI state unless the state is a durable view preference |
| Legacy Make.md-only behavior | Context MDB until migrated, replaced, or explicitly kept |

Notidian should continue to keep custom code where it creates necessary value:

- page-title rename transactions;
- frontmatter write gating and conflict handling;
- spreadsheet-like edit gestures;
- table undo/redo over real authorities;
- migration review and resolution tools;
- compatibility display for complex legacy contexts;
- custom Bases views if Obsidian's Bases API can host Notidian's table UX safely.

## Why Not Switch To Bases-Only Immediately

A direct rewrite would optimize conceptual purity before proving migration safety.

It would risk:

- losing or stranding existing Make.md context-only values;
- dropping row order, relations, formulas, or view state that does not round-trip to `.base`;
- weakening the already implemented file-title rename protections;
- rebuilding table paste, conflict feedback, and undo behavior before equivalent coverage exists;
- depending on Bases API surface before Notidian has tested whether custom views can carry the desired UX.

The right sequence is convergence through adapters, migration tools, and tests, not a replacement leap.

## Roadmap

### 1. Codify Agent And Contributor Rules

Create an AI-facing Notidian skill that tells agents to:

- prefer frontmatter and `.base` semantics for ordinary database work;
- read the Notidian ADRs before changing database behavior;
- never write ordinary metadata as hidden context-owned row values;
- use rename transactions for file-title edits;
- treat legacy contexts as migration/compatibility state.

### 2. Build A `.base` Adapter

Add a small, tested adapter for simple folder database views.

The first adapter should cover:

- folder scope;
- visible column order;
- property display names;
- basic filters;
- sort/group settings where semantics match;
- formulas where the expression can round-trip safely.

Unsupported Notidian-only behavior must be reported explicitly instead of silently dropped.

### 3. Add In-App Legacy Audit And Resolution

Bring the existing read-only legacy context audit into Obsidian's UI.

Then add explicit resolution choices for blockers:

- keep frontmatter;
- backfill frontmatter from context;
- keep the value as an explicit Notidian-owned field;
- discard a confirmed duplicate.

No write migration should run until the user has reviewed the plan.

### 4. Prototype Notidian As A Custom Bases View

Use Obsidian's custom Bases view surface to determine whether Notidian's enhanced table can operate as a Bases view while preserving:

- controlled title rename;
- range paste;
- undo/redo;
- frontmatter conflict handling;
- migration-safe behavior.

This prototype is the proof point before deeper context engine removal.

Initial status: ADR 0012 implements the first feasibility gate. Notidian now registers a `notidian-table` custom Bases view when the runtime supports it, reads the native Bases query result, renders a table projection, writes ordinary note properties through frontmatter, renames `file.name` through Obsidian file renames, supports structured note-property and file-name paste with undo, supports focused range copy/cut for note-property cells, and surfaces stale-frontmatter conflicts. It does not yet replace the current safe table editor.

### 5. Migrate Simple Contexts Toward `.base`

After adapter and audit coverage are stable, simple folder contexts should be exportable or mirrorable as `.base` files.

Complex contexts may remain context-backed, but they should be labeled as advanced or legacy Notidian state.

### 6. Prune Unneeded Make.md Surface

After migration coverage exists, remove or demote Make.md features that are not needed for the user's database workflow.

The goal is a smaller Notidian:

- native data model;
- strong table editing UX;
- safe migration and conflict resolution;
- less hidden machinery.

## Alternatives Considered

### Keep Context MDB As The Product Center

Rejected.

This preserves Make.md's original architecture but keeps Notidian tied to the split-governance mechanism the fork is meant to avoid.

### Immediate Bases-Only Rewrite

Rejected for now.

This is attractive conceptually, but it would be a broad rewrite before Notidian has adapter parity, custom Bases view proof, and safe migration for existing contexts.

### Bidirectional Sync Between Contexts And Bases

Rejected as a primary model.

Bidirectional sync keeps two durable authorities alive. It recreates the ambiguity Notidian is meant to remove.

Mirroring may be useful as an implementation phase, but one side must be declared canonical for each data kind.

## Consequences

Positive consequences:

- Notidian has a clearer north star than "Make.md with frontmatter fixes."
- Future database behavior can be judged against Obsidian-native Bases semantics.
- Existing Notidian safety work remains useful.
- Legacy contexts can be migrated instead of discarded.
- The fork can shrink over time instead of carrying Make.md's full feature surface indefinitely.

Tradeoffs:

- For a while, Notidian will still have both context MDB and `.base`-compatible concepts.
- Adapter and migration work must be careful about unsupported semantics.
- Some Make.md-only features may be intentionally left behind if they do not serve the database workflow.
- A custom Bases view prototype may reveal API limitations that require a longer bridge period.

## Invariants

Future work must preserve these rules:

- Frontmatter-backed values are accepted only after the Markdown file write succeeds.
- Context MDB rows must not become the durable source of truth for ordinary frontmatter properties.
- File-title edits must remain file rename transactions, not string writes to a row.
- Automatic migration must not strip context-only values or conflicts.
- `.base` export/import must report unsupported semantics explicitly.
- Notidian-only durable state must be visible as Notidian-owned, not disguised as ordinary Obsidian metadata.

## Relationship To Other ADRs

- ADR 0001 defines the authority-partitioned model this decision narrows toward Bases semantics.
- ADR 0002 defines frontmatter-backed context columns.
- ADR 0003 defines controlled page-title renames.
- ADR 0005 is refined by this ADR: contexts are no longer just "kept for now"; they are compatibility/advanced state on a convergence path.
- ADR 0010 defines the audit-first migration needed before context data can be safely cleaned up.
