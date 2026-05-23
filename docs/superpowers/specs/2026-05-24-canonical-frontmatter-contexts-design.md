# Canonical Frontmatter Contexts Design

## Purpose

Notidian should behave like an Obsidian-native database layer: Markdown frontmatter is the canonical data, and context MDB files store view structure, column order, filters, formulas, relations, and compatibility cache state. A normal file property such as `status`, `area`, `project`, `address`, `voltage`, or `ups` must not become governed by a separate context row datastore.

## Decision

Use explicit column provenance for ordinary note properties. Frontmatter-backed columns are marked with `source: "frontmatter"` in the context field metadata. Existing legacy columns that match discovered frontmatter keys are upgraded to this source when the context is otherwise default/frontmatter-backed.

This preserves current Make.md context features while making the file-backed path unambiguous:

- Frontmatter-backed column values are read from `pathsIndex[path].metadata.property`.
- Edits to frontmatter-backed cells write through to Obsidian frontmatter even if the legacy `saveAllContextToFrontmatter` option is disabled.
- Context MDB storage strips frontmatter-backed row values before persistence, so MDB rows do not become the durable source for those values.
- Context-only, relation, aggregate, formula, flex, and advanced columns remain governed by context semantics.

## Scope

This phase finishes the property-backed foundation. It does not replace the entire Make.md/Notidian context model, and it does not implement `.base` export/import. It makes file-backed columns explicit, keeps new external frontmatter keys visible, and reduces durable row duplication.

## Data Flow

When a folder context is parsed, Notidian discovers frontmatter keys from the context paths. If the context contains only default columns or frontmatter-backed columns, Notidian marks existing matching columns as frontmatter-backed and appends newly discovered properties as frontmatter-backed columns.

When Obsidian metadata changes, Notidian reloads the changed path, identifies contexts containing that path, materializes any new frontmatter-backed columns for those contexts, updates row projections from frontmatter, and reloads the affected context.

When a user edits a frontmatter-backed context cell, Notidian awaits the frontmatter write before saving context row state. If the write fails, the local context row is not saved as if it were canonical.

When a context table is saved to MDB, frontmatter-backed row values are omitted from storage. Reloading the context rehydrates those values from Obsidian metadata.

## Compatibility

Existing users can keep legacy context-only columns. A context with non-frontmatter user columns is not automatically converted unless the relevant columns are already marked as frontmatter-backed. The original `saveAllContextToFrontmatter` setting remains for legacy bulk behavior, but explicit frontmatter-backed columns always write to frontmatter.

## Testing

Unit tests should cover source marking, storage stripping, parser materialization, metadata-change materialization, and frontmatter-write gating. Existing identity and parser tests must continue to pass.

