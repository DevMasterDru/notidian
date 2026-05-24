# ADR 0002: Frontmatter-Backed Context Columns

## Status

Accepted.

## Date

2026-05-24

## Context

The first concrete problem was that a folder containing Markdown files with existing YAML properties opened in Make.md/Notidian with only default context fields such as `File` and `Created`. The user expected a database table similar to Notion or Obsidian Bases: existing metadata should already appear as properties.

Make.md already had context schemas and rows in MDB storage. It also had some paths for reading frontmatter and manually adding existing properties. The problem was not that frontmatter was completely inaccessible. The problem was that frontmatter-backed data was not the automatic, canonical default.

The risk was that if Notidian simply copied all frontmatter into context rows, the MDB context could become a second durable copy of ordinary metadata.

## Decision

Represent ordinary note properties as frontmatter-backed context columns.

Frontmatter-backed columns are marked with:

```ts
source: "frontmatter"
```

For these columns:

- Values are read from Obsidian path metadata/frontmatter.
- Cell edits write through to Markdown frontmatter.
- Saved MDB rows omit frontmatter-backed values.
- Reloading the context rehydrates values from Obsidian metadata.
- Newly discovered frontmatter keys may be materialized as columns when the context is default or already frontmatter-backed.

This makes the context table a projection over frontmatter for ordinary note properties.

## Hurdles

### Existing Context Schema Semantics

Make.md contexts are not just lists of note properties. They also define column order, hidden columns, filters, custom fields, formulas, and relations. Replacing all context schema behavior with frontmatter would remove useful functionality.

The solution is to keep context schemas for view/configuration while marking ordinary note properties with explicit provenance.

### Legacy Contexts

Some existing Make.md contexts may already contain columns with the same names as frontmatter properties but without a provenance marker.

The current implementation upgrades matching columns only when the context is otherwise default/frontmatter-backed. Contexts with unrelated user columns are not automatically converted, because silently changing their ownership could corrupt existing workflows.

### Type Inference

YAML values can vary across files. One file can contain `voltage: 24`, while another contains `voltage: "24V"`.

The chosen rule is conservative: if observed frontmatter values for a property have conflicting mapped types, Notidian uses `text`. This avoids locking a property into an unsafe numeric/date/boolean editor based on the first file scanned.

### Save Failures

A frontmatter write can fail or return an unconfirmed result. If Notidian continued saving the context row afterward, the UI would imply a successful edit even though the canonical file was not updated.

The chosen rule is that frontmatter-backed edits must be gated by a confirmed frontmatter write. Failed writes stop the context update path.

## Alternatives Considered

### Copy Frontmatter Values Into Context Rows Permanently

Rejected.

This would show the right columns quickly, but it creates duplicate durable data. Once duplicated, there is no single obvious authority when values diverge.

### Require Manual Property Import

Rejected as the default.

Manual import preserves control but fails the expected database experience. A folder with existing properties should already look like a database.

### Convert Every Matching Legacy Column Automatically

Rejected.

This can surprise existing Make.md users whose context-only columns happen to share a name with frontmatter keys. The safer path is automatic conversion only for default/frontmatter-backed contexts, plus a future explicit migration command.

## Consequences

Positive consequences:

- Opening a folder can show existing frontmatter properties immediately.
- Notidian edits update the files and stay visible across Obsidian.
- MDB rows no longer become the durable authority for ordinary metadata.
- Property-backed contexts remain compatible with context views.

Tradeoffs:

- Context parsing must inspect path metadata.
- Metadata cache timing matters.
- Type inference must be conservative.
- Some legacy contexts require explicit migration later.

## Implementation Notes

Key implementation points:

- `frontmatterPropertySource = "frontmatter"` in `src/core/utils/properties/allProperties.ts`.
- `materializeFrontmatterBackedContextTable` discovers and marks frontmatter-backed columns.
- `stripFrontmatterBackedRowValues` removes frontmatter-backed and computed values before saving MDB rows.
- `saveFrontmatterProperties` treats frontmatter writes as transactions.
- `ContextEditorContext` now returns early when frontmatter writes fail.

## Follow-Up Work

- Add a legacy context migration command with a preview/diff.
- Add UI indicators for column authority.
- Add property rename/delete workflows that can operate either on the view column or on the underlying frontmatter key.
