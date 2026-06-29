# ADR 0054: Filename Template Mirror

**Status:** Accepted  
**Date:** 2026-06-30  
**Beads:** Notidian-pay5.1.1 (S1: template engine), Notidian-pay5.1.2 (S2: auto-rename watcher), Notidian-pay5.1.3 (S3: configuration UI + first-time adoption)

## Context

In Notidian databases, each markdown file is a row whose identity is its
filesystem path/basename (ADR 0001, ADR 0014, ADR 0016). Users often want
filenames to reflect frontmatter property values -- e.g. a Device Registry
where each file is named `02-ch05-joker-fill-ro-sol-1.md` derived from
`board_id`, `address`, and `device` fields.

Without this feature, filenames drift from frontmatter as properties are edited,
creating a confusing gap between what the file says it is (frontmatter) and what
it is called (filesystem name).

## Decision

Implement a per-database **filename template** stored in SpaceDefinition
(view/config authority, per ADR 0001/0014 -- same class as `template` and
`templateName`). The feature has three layers:

### Template syntax

`{field}`, `{field:format}`, `{field|transform}`, `{field|transform:param}`

- **Formats:** `Nd` (e.g. `02d`) -- zero-pad a number.
- **Transforms:** `slug` -- emoji-strip, lowercase, hyphenate, sanitize,
  truncate (default 50 chars, parameterized via `slug:N`).
- **Missing fields:** substituted with `_` placeholder.
- **Validation:** the result is run through `validatePageTitle` to ensure
  filesystem safety.

### Auto-rename enforcement

`FilenameEnforcer` hooks into the Obsidian metadata-change event pipeline.
On every frontmatter save in a template-configured database:

1. Parse the template and evaluate it against the current frontmatter.
2. Compare to the actual basename.
3. If they differ, rename the file (with collision resolution: `-2`, `-3`, etc.).

Reentrancy guard: a `Set<string>` with 2-second TTL prevents infinite loops
when the rename itself triggers metadata events. Sequential drain queue
prevents filesystem races when multiple files change rapidly.

**Strict enforcement:** manual rename is transient -- the next frontmatter
save re-renames to match the template. The template is the authority for naming.

### Configuration UI

`SpaceFilenameTemplateProperty` React component in the space settings header:
- Template input with syntax hint
- Preview: shows current name -> new name for all database files
- Bulk rename: after confirmation modal, renames all divergent files
- Clear template: removes the template

### Storage

The template string is stored as `_filenameTemplate` in the space definition
frontmatter (same serialization path as `_template`, `_sort`, etc.). It
round-trips through `spaceDefinitionFrontmatter` (serializer) and
`parseSpaceMetadata` (parser).

### Kill-switch

`filenameTemplateEnforcement` setting (default ON). When OFF, the enforcer
returns immediately -- no files are auto-renamed. The UI still allows
configuring templates and previewing, but enforcement is suspended.

## Ruled-out alternatives

- **Frontmatter `title` field:** creates a second authority for naming alongside
  the filesystem, violating ADR 0014's "basename owns identity" principle.
- **Polling/interval-based rename:** unnecessary overhead; the metadata-change
  event is already available in the pipeline.
- **No enforcement (template as hint only):** defeats the purpose; filenames
  would still drift after the initial bulk rename.
- **Conditional template segments (`{field?prefix-}`):** deferred to V2 to keep
  V1 simple and shippable.
- **Per-file freeze flag:** deferred to V2.

## Consequences

- Files in template-configured databases auto-rename on frontmatter change.
- The preview + bulk-rename flow provides a safe first-time adoption path.
- Unblocks Notidian-mx0k (key-match FK relations) which needs descriptive,
  stable filenames.

## Cross-references

- ADR 0001: authority-partitioned model
- ADR 0003: page title renames
- ADR 0014: Notidian-only personal database engine
- ADR 0016: basename owns row identity
- ADR 0028: row-create templates
