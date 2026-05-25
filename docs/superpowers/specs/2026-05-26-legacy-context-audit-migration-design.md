# Legacy Context Audit And Migration Design

## Purpose

Notidian has moved ordinary note metadata to an Obsidian-native authority model: frontmatter is canonical, while context MDB stores view/configuration state and explicitly Notidian-owned values. Older Make.md contexts can still contain unmarked columns and row values that duplicate frontmatter. Those contexts need a safe migration path before Notidian can claim that legacy workspaces are aligned with the new model.

The migration must not silently discard or overwrite user data. Its first job is to make legacy state visible.

## Decision

Add a pure legacy context audit and migration-planning layer.

The layer classifies context columns and row values into explicit categories:

- `already-frontmatter`: the column is already marked with `source: "frontmatter"`.
- `frontmatter-candidate`: the column is unmarked, but matching frontmatter keys exist for rows in the table.
- `context-only`: the column has no matching frontmatter keys and should remain MDB-owned.
- `file`: the row identity column, owned by the Markdown file path.
- `computed`: file projections, formulas, aggregates, and other non-durable values.

For each frontmatter candidate, the audit also classifies row values:

- `matching`: MDB and frontmatter contain the same value.
- `context-only-value`: MDB has a value where frontmatter is empty or missing.
- `frontmatter-only-value`: frontmatter has a value where MDB is empty or missing.
- `conflict`: both stores have non-empty values and they differ.
- `empty`: neither store has a value.

The planner returns a dry migration preview:

- columns that can be marked as `source: "frontmatter"`;
- persisted row values that should be stripped after the column is frontmatter-backed;
- context-only columns and values that must be preserved;
- conflicts that require user review before any destructive write;
- frontmatter-only keys that can be added to the context schema as frontmatter-backed columns.

The core remains pure and does not write Markdown files or MDB files. Later CLI/UI migration commands can consume the plan after showing the user a preview.

## Why This Is The Right Boundary

The previous Make.md design avoided direct conversion because unmarked context columns are ambiguous. A column named `status` may be an ordinary YAML property, or it may be a context-only field with the same name. A direct migration would have to guess ownership and could destroy data.

The audit/planner removes the guesswork. It does not treat matching names as enough to write data. It exposes ownership and conflict state first. Only values that are explicitly understood as frontmatter-backed can later be stripped from context storage, and conflicting values remain visible until the user chooses a resolution.

This is the minimum durable foundation for an optimal migration flow because every future UX can reuse the same classification rules:

- an Obsidian command can show a migration preview;
- a table banner can explain why a legacy context is not fully canonical;
- a CLI can produce a machine-readable report;
- tests can prove no legacy value disappears accidentally.

## Compatibility Rules

The planner must preserve every context-only field. Context-only fields are still valid Notidian data because Notidian keeps Make.md-style view and context behavior where it does not compete with file metadata.

The planner may recommend marking a legacy column as frontmatter-backed when at least one row path has the same frontmatter key. It must still report value-level conflicts and context-only values before any write path strips MDB values.

Discovered frontmatter keys that are not present in the context schema may be recommended as new frontmatter-backed columns. This matches the current Notidian behavior for default/frontmatter-backed contexts, but the migration plan makes the change explicit for legacy contexts.

## Data Shape

The utility accepts:

- a `SpaceTable`;
- frontmatter values keyed by row path;
- optional schema id override, defaulting to the table schema id.

It returns:

- an audit with column classifications, value issues, discovered frontmatter keys, and conflict counts;
- a migration plan with proposed columns, row cleanup operations, preserved columns, and blocking conflicts;
- an `applyLegacyContextMigrationPlan` helper that returns a migrated table copy only when the caller has already accepted the plan.

`applyLegacyContextMigrationPlan` does not write to disk. It marks accepted candidate columns as frontmatter-backed, appends discovered frontmatter-backed columns, and removes frontmatter-backed row values from the returned table. It never removes context-only columns or values.

## Testing

Unit tests must prove:

- the audit detects frontmatter candidates while preserving context-only columns;
- matching duplicate row values can be stripped only in the migrated table copy;
- conflicting duplicate values are reported and block the automatic plan;
- frontmatter-only keys are recommended as schema additions;
- already frontmatter-backed columns are recognized and cleaned like canonical columns;
- the audit and planner do not mutate the input table.

## Out Of Scope

This phase does not add a destructive vault migration command, does not choose conflict winners, and does not change the live table UI. Those steps should come after the pure planner is implemented and verified.
