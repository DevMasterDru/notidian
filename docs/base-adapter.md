# Bases Adapter

The Bases adapter is the first implementation step for ADR 0011's Bases-first convergence path.

It is intentionally pure and conservative. It converts a Notidian `SpaceTable` plus an optional table predicate into an in-memory `.base` document shape and deterministic YAML. It does not write files, mutate context MDB data, or claim that every Notidian context can round-trip to native Bases.

## What It Exports

The first adapter supports simple folder table views:

- folder scope as a global `file.inFolder(...)` filter;
- the `File` column as `file.name`;
- frontmatter-backed columns as note properties;
- file property columns such as `File.ctime` as `file.ctime`;
- visible column order;
- column display names when a Notidian alias exists;
- table limits;
- one group-by field when it maps to a supported property;
- simple equality, inequality, numeric comparison, and boolean filters;
- column summaries when they target supported visible properties.

Unsupported behavior is returned in a structured `unsupported` list. This is a core safety rule: the adapter must report unsupported semantics instead of silently dropping them.

## What It Does Not Export Yet

The adapter does not yet provide:

- an Obsidian command for writing `.base` files;
- `.base` import back into Notidian;
- custom Bases view registration;
- guaranteed handling for every Make.md predicate function;
- stable sort export, because current documented Bases syntax does not expose a general portable sort field;
- context-owned values, relations, aggregates, or complex formulas.

Context-owned values must be migrated to frontmatter or kept as explicit Notidian-owned state before they can be represented in native Bases.

## Implementation

Main files:

- [notidianBaseAdapter.ts](../src/core/utils/bases/notidianBaseAdapter.ts)
- [notidianBaseAdapter.test.ts](../src/core/utils/bases/notidianBaseAdapter.test.ts)

Primary functions:

- `notidianTableToBaseDocument`
- `basePropertyForNotidianColumn`
- `serializeBaseDocumentToYaml`

The adapter returns:

```ts
{
  document: BaseDocument;
  unsupported: BaseUnsupportedFeature[];
}
```

Callers should only write the YAML to a vault after presenting unsupported features to the user.

## Relationship To ADRs

- [ADR 0011](adr/0011-bases-first-convergence.md) defines why Notidian is converging toward Bases semantics.
- [ADR 0010](adr/0010-legacy-context-audit-and-migration.md) defines why legacy context data must be audited before cleanup.
- [ADR 0001](adr/0001-authority-partitioned-database-model.md) defines the source-of-truth model that this adapter preserves.
