# ADR 0010: Legacy Context Audit And Migration

## Status

Accepted.

## Date

2026-05-26

## Context

Make.md contexts predate Notidian's authority-partitioned model. A legacy context MDB can contain columns and row values for properties that also exist in Markdown frontmatter. Those values may be harmless duplicates, stale duplicates, context-only user data, or data that should be backfilled into frontmatter before the context is cleaned.

This is the same reason Make.md avoided direct file-name/property changes in several places: context rows were not just a projection over files. They also stored Make.md-specific state, custom fields, formulas, relations, ordering, and view behavior. A column name alone does not prove ownership.

For example, a legacy `status` column can mean several different things:

- an ordinary YAML property already stored in the file;
- a context-only planning field that happens to share the same name;
- a duplicate where the context and frontmatter values match;
- a conflict where context and frontmatter disagree;
- a value present only in context, where stripping the MDB row would lose user data.

The user requirement is that Notidian behave like a Notion-style database while keeping Obsidian files and properties canonical. That means legacy migration must remove split-brain governance, but it must not erase valuable legacy context data while doing so.

## Decision

Use an audit-first migration model for legacy Make.md contexts.

Notidian now has a pure utility that compares a context `SpaceTable` with frontmatter snapshots keyed by row path. It returns an audit and a migration plan without writing to Markdown files or MDB files.

The audit classifies columns as:

- `file`: file identity, owned by the Markdown path.
- `computed`: file projections, formulas, aggregates, or other non-durable values.
- `already-frontmatter`: already marked with `source: "frontmatter"`.
- `frontmatter-candidate`: unmarked, but matching frontmatter keys exist for rows in the table.
- `context-only`: no matching frontmatter key was found, so the column remains MDB-owned.

For frontmatter-backed or candidate columns, the audit classifies row values as:

- `matching`: context and frontmatter agree.
- `frontmatter-only-value`: frontmatter has a value and context does not.
- `context-only-value`: context has a value and frontmatter does not.
- `conflict`: both stores have non-empty values and they differ.
- `empty`: neither store has a value.

The automatic migration plan is intentionally conservative:

- It may mark a candidate column as `source: "frontmatter"` only when the column has no blocking row values.
- It may strip persisted row values only for computed columns and safe frontmatter-backed columns.
- It preserves context-only columns and values.
- It recommends missing frontmatter keys as new frontmatter-backed columns.
- It blocks automatic cleanup when any candidate/frontmatter-backed value is `conflict` or `context-only-value`.

`context-only-value` is blocking because stripping the context row would lose data unless a later migration writes that value to frontmatter first or the user explicitly discards it.

## Why This Is The Best Fit

This decision preserves the core Notidian rule: ordinary note metadata belongs to Markdown frontmatter, not hidden context rows. It also respects the Make.md compatibility reality that context MDB files can contain legitimate non-frontmatter data.

Direct conversion would be faster but unsafe. It would turn ambiguous column names into authority decisions without evidence. Bidirectional sync would keep both stores alive and recreate the governance split the fork is meant to remove.

Audit-first migration gives Notidian a stable foundation:

- user data can be previewed before any write;
- conflicts are explicit instead of guessed;
- context-only data remains available;
- future UI and CLI migration commands can reuse the same tested rules;
- a live vault migration can be dry-run before any destructive operation.

## Consequences

Positive consequences:

- Legacy contexts can be inspected without modifying the vault.
- Matching duplicates can be safely planned for cleanup.
- Values that would be lost are surfaced as blockers.
- Notidian can gradually converge old contexts toward the canonical frontmatter model.

Tradeoffs:

- This phase does not yet provide a one-click migration command.
- Users still need a future review UI or CLI to resolve conflicts and backfill context-only values.
- The audit depends on the caller providing current frontmatter snapshots for the relevant row paths.

## Implementation Notes

Key files:

- `src/core/utils/contexts/legacyContextMigrationCore.js`
- `src/core/utils/contexts/legacyContextMigration.ts`
- `src/core/utils/contexts/legacyContextMigration.test.ts`
- `scripts/notidianLegacyContextAudit.js`
- `scripts/notidianLegacyContextAudit.test.js`

Primary functions:

- `auditLegacyContextTable`
- `createLegacyContextMigrationPlan`
- `applyLegacyContextMigrationPlan`

The core classifier is shared by the TypeScript plugin utility and the Node CLI report so migration semantics cannot drift between surfaces. The apply helper is still pure. It returns a migrated table copy that marks safe candidate columns as frontmatter-backed, appends discovered frontmatter-backed columns, and removes planned row values from the copy. It does not write files.

The CLI report reads one explicit folder context and can emit Markdown or JSON:

```bash
npm run audit:legacy-context -- --vault="/Users/druker/Atlas Vault" --folder="Relays & Devices"
```

Reports generated with `--max-files` are partial inspection reports. They are explicitly marked as not automatically applicable.

## Follow-Up Work

- Add a read-only Obsidian command that shows the same report inside the app.
- Add a migration preview UI that shows conflicts and context-only values.
- Add explicit resolution actions: keep frontmatter, backfill frontmatter from context, keep as context-only under a renamed column, or discard context duplicate.
- Add an opt-in write command that applies only reviewed plans.
