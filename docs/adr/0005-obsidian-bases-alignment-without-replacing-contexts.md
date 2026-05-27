# ADR 0005: Obsidian Bases Alignment Without Replacing Contexts

## Status

Superseded as strategy by [ADR 0014](0014-notidian-only-personal-database-engine.md).

This record remains useful historical context for the authority-model lessons taken from Bases. Native Bases is no longer an active Notidian target.

## Date

2026-05-24

## Context

The user wanted Notidian to align with the native Obsidian Bases plugin rather than maintain a separate Make.md indexing/governance mechanism for ordinary metadata.

Obsidian Bases distinguishes:

- Note properties from frontmatter.
- File properties such as file name, path, folder, created time, and modified time.
- Formula properties computed from available data.
- View definitions stored separately from note data.

This model is directionally correct for Notidian. The data belongs in the vault. The view controls how the data is displayed.

However, Notidian is also a fork of Make.md, whose context system already supports behavior beyond a simple native Base view: context schemas, row order, relations, aggregates, formulas, spaces, and custom table behavior.

## Decision

Align with the Obsidian Bases authority model without replacing the Make.md context engine in the first phases.

Notidian should behave like Bases for ordinary file-backed data:

- File metadata is canonical file data.
- Frontmatter is canonical note-property data.
- View/configuration state is separate from the data.

Notidian may continue using context MDB files for capabilities that Bases does not directly own:

- View layout.
- Column order.
- Hidden columns.
- Filters and grouping.
- Context-native fields.
- Relations.
- Aggregates.
- Formula configuration.
- Compatibility with existing Make.md contexts.

## Why Not Replace Contexts Immediately

A full Bases replacement would be a broad rewrite. It would risk losing functionality before Notidian has equivalent implementations.

It also would not eliminate the hardest problem: file name editing. In Bases, `file.name` or `file.basename` is still a file property, not a normal note property. Editing it still needs an explicit file rename transaction.

Therefore, the optimal path is staged:

1. Align authority boundaries now.
2. Keep the context engine where it provides value.
3. Add import/export or bridge behavior later.
4. Consider deeper replacement only after feature parity and migration safety exist.

## Alternatives Considered

### Full `.base` Renderer Replacement

Rejected for now.

This would align with native Obsidian semantics, but it would require replacing too much Make.md behavior at once.

### Ignore Bases And Keep Make.md Semantics

Rejected.

That preserves the original plugin but fails the purpose of the fork. The user specifically wants Obsidian-native data governance.

### Store `.base` Files As The Only View Format

Deferred.

This may become useful for interoperability, but `.base` semantics and Make.md context semantics are not identical. Prematurely forcing all Notidian views into `.base` files could lose information.

## Consequences

Positive consequences:

- Notidian follows the same core data authority as Bases.
- Existing Make.md context functionality remains available.
- The system can later export/import or mirror `.base` views.
- Users can edit frontmatter outside Notidian and still expect Notidian to update.

Tradeoffs:

- There are still two view/configuration formats: Notidian context MDB and Obsidian `.base`.
- Some Notidian-only features may not round-trip to Bases.
- Future interop work must define mappings carefully.

## Future Interoperability Direction

The original recommended future path was a bridge, not an immediate replacement:

- Export a simple Notidian folder context to `.base`.
- Import a simple `.base` table into a Notidian view.
- Map visible columns, filters, sort order, and formulas where semantics match.
- Mark unsupported Notidian-only features explicitly instead of silently dropping them.

ADR 0011 keeps the no-immediate-rewrite constraint but makes the long-term direction more explicit: Notidian should converge toward Bases-compatible semantics for ordinary database views, while context MDB storage becomes compatibility or explicit advanced Notidian state.

## Relationship To Other ADRs

- ADR 0001 defines the overall authority partition.
- ADR 0002 defines how frontmatter-backed columns work.
- ADR 0003 defines why page title editing still needs a special rename transaction.
- ADR 0004 defines the hardening needed to keep the authority model trustworthy.
