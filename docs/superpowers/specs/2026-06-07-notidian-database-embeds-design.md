# Notidian Database Embeds Design

Date: 2026-06-07

Status: Approved direction, pending implementation plan

## Purpose

Notidian needs a first-class way to place live database views inside ordinary
Markdown pages and Obsidian Canvas files.

The feature must not create a second data owner. Embedded databases are live
Notidian projections over the same canonical data used by the main table
surface:

- Markdown files own row identity.
- File paths and basenames own page titles.
- Markdown frontmatter owns ordinary editable properties.
- Notidian context MDB owns view state, explicit Notidian-owned fields, and
  legacy compatibility state.
- Markdown pages and Canvas files own only the embed reference, placement, and
  host-specific sizing.

## Current Behavior

The repository already contains inherited Make.md-era embed support:

- `Folder/#^schema` addresses a table/context.
- `Folder/#*view` addresses a saved frame/view.
- `contextEmbedStringFromContext` and `contextViewEmbedStringFromContext` can
  copy old-style embed links.
- `SpaceFragmentViewComponent` can resolve those fragments and render a
  context/table view.

That support is useful but incomplete as a Notidian feature:

- The syntax is opaque and Make.md-shaped.
- There is no explicit Notidian embed contract.
- There is no first-class Canvas insertion flow.
- Sizing, title visibility, and edit policy are not represented clearly.
- Error states and lifecycle are not centralized.

The design therefore keeps legacy references compatible but builds a
Notidian-native embed layer above them.

## Product Principles

1. Embeds are references, not snapshots.
2. One renderer must serve Markdown pages, legacy links, Canvas wrappers, and
   future Canvas-native hosts.
3. The host surface stores no row data.
4. Read-only is the default embed policy.
5. Editable mode must be explicit and must use the same authority-aware write
   paths as the main table.
6. Missing targets, disabled plugin state, metadata loading, and write conflicts
   must render visible inline states.
7. Canvas support should use stable JSON Canvas/file-node behavior before any
   direct Canvas runtime patching is attempted.

## Notidian Embed Descriptor

Add a canonical descriptor type:

```ts
export type NotidianEmbedKind = "table" | "view";

export type NotidianEmbedDescriptor = {
  target: string;
  kind: NotidianEmbedKind;
  id: string;
  height?: number;
  title?: boolean;
  editable?: boolean;
  density?: "default" | "compact";
};
```

Field meaning:

| Field | Meaning |
| --- | --- |
| `target` | Folder, space, or vault-relative Notidian database scope. |
| `kind` | `table` for a schema/context, `view` for a saved frame/view. |
| `id` | Table/schema id or saved view/frame id. |
| `height` | Host display height in pixels. The host may clamp this. |
| `title` | Whether the embed shows the table/view title. |
| `editable` | Whether cell editing is enabled inside the embed. Defaults to `false`. |
| `density` | Optional presentation hint. It must not affect source-of-truth behavior. |

The descriptor is the feature's internal contract. Markdown block syntax,
legacy fragment links, insertion commands, Canvas wrapper notes, and future
Canvas-native integration all parse to this type.

## Markdown Syntax

New Notidian-native page embeds use a fenced code block:

````md
```notidian
target: Projects
kind: view
id: active
height: 480
title: true
editable: false
```
````

Short aliases are allowed only where they stay unambiguous:

````md
```notidian
target: Projects
view: active
height: 480
```
````

Alias normalization:

| Input | Normalized descriptor |
| --- | --- |
| `view: active` | `kind: "view"`, `id: "active"` |
| `table: files` | `kind: "table"`, `id: "files"` |
| missing `editable` | `editable: false` |
| missing `title` | `title: true` |

Invalid blocks render an inline Notidian error panel. They do not throw out of
the Markdown renderer.

## Legacy Embed Compatibility

Existing legacy links continue to work:

```md
![![Projects/#^files]]
![![Projects/#*active]]
```

The legacy parser converts them to descriptors:

| Legacy ref | Descriptor |
| --- | --- |
| `target/#^schema` | `target`, `kind: "table"`, `id: "schema"` |
| `target/#*view` | `target`, `kind: "view"`, `id: "view"` |

New Notidian UI should generate fenced `notidian` blocks by default. Legacy
links remain accepted so existing notes do not break.

## Shared Renderer

Add a `NotidianEmbed` React component that owns host-independent embed behavior.

Inputs:

- `descriptor`
- `sourcePath`
- `host`: `markdown`, `canvas-wrapper`, `legacy-transclusion`, or
  `workspace-leaf`
- optional host sizing constraints

Responsibilities:

- resolve the target path through `spaceManager.uriByString`;
- choose `#^` table/context or `#*` view/frame rendering;
- render through the existing `SpaceFragmentViewComponent` and
  `ContextListContainer` path where possible;
- enforce read-only default behavior;
- apply height and title display options;
- show loading, missing target, missing schema/view, and invalid descriptor
  states;
- isolate lifecycle cleanup through Obsidian Markdown render children or React
  unmounts, depending on host.

The renderer must not fork the table implementation. Any editable embed must
reuse the same transaction, conflict, undo, and reconciliation paths used by the
main table.

## Markdown Host

Register a Markdown code block processor for `notidian`.

Flow:

1. Obsidian passes source text, target element, and Markdown context.
2. Parser builds a `NotidianEmbedDescriptor`.
3. Renderer mounts `NotidianEmbed` into the provided element.
4. Markdown render child lifecycle unmounts React when Obsidian discards the
   section.

This should work in reading mode first. Live Preview support can reuse the
existing editor-flow infrastructure only after reading-mode behavior is stable.

## Legacy Transclusion Host

Existing post-processing paths that detect legacy `![![...]]` Notidian
fragments should route through `NotidianEmbed`.

This avoids maintaining one renderer for legacy fragments and another for new
blocks.

## Canvas Host

Phase 1 Canvas support uses wrapper Markdown file nodes.

Command behavior:

1. User runs `Insert Notidian database into canvas`.
2. User chooses target folder/database and table or saved view.
3. Notidian creates or updates a small wrapper note containing a `notidian`
   block.
4. Notidian inserts a JSON Canvas file node pointing to the wrapper note.
5. Node dimensions default to a useful table shape, for example 760 x 480.

This is the safest first Canvas path because JSON Canvas file nodes are stable
and do not require patching Obsidian Canvas internals.

Preferred wrapper note location:

```text
.notidian/embeds/<safe-target>-<kind>-<id>.md
```

The wrapper note is implementation-owned presentation glue. It stores no row
data. The descriptor and renderer must not depend on this storage path.

The implementation plan must include a live Canvas probe before locking the
wrapper location:

- if Canvas file nodes preview `.notidian/embeds/*.md` reliably, use
  `.notidian/embeds` because it best preserves data hygiene;
- if Canvas cannot preview hidden wrapper notes reliably, use a visible vault
  folder such as `Notidian Embeds/`, mark those files as implementation glue,
  and exclude that folder from ordinary database scopes.

Phase 2 may support direct Canvas text nodes containing the `notidian` block if
live testing proves Obsidian Canvas runs plugin Markdown code block processors
inside text cards reliably.

Phase 3 may support direct Canvas-native mounting only if Obsidian exposes a
stable enough hook or local patch point. This must remain an enhancement behind
the descriptor and shared renderer, not the foundational architecture.

## Commands And Menus

Add user-facing commands:

- `Copy Notidian database embed`
- `Insert Notidian database embed`
- `Insert Notidian database into canvas`

Table and view menus should expose:

- copy Markdown embed block;
- copy legacy embed link, if useful for compatibility;
- insert into current Markdown editor;
- insert into current Canvas, when the active leaf is a Canvas file.

The selection flow should prefer saved views over raw tables when the user is
currently looking at a saved view. Saved views preserve the user's intended
filters, sorting, columns, frozen columns, direction, and presentation state.

## Edit Policy

Initial embeds default to read-only:

```yaml
editable: false
```

Reasons:

- Canvas drag/select gestures can conflict with spreadsheet selection.
- Page embeds can contain multiple tables, which complicates undo focus.
- Accidental embedded edits are more likely in overview pages.
- Read-only live projections satisfy the primary placement need first.

Editable embeds are allowed by descriptor but may be gated in the first release.
When enabled, edits must use the existing Notidian table transaction layer:

- frontmatter writes must happen before UI acceptance;
- file title edits must use rename transactions;
- conflicts must surface inline;
- undo/redo must remain scoped and predictable.

## Error States

`NotidianEmbed` must handle:

- invalid descriptor syntax;
- missing `target`;
- target path not found;
- target is not a Notidian database scope;
- table/schema id not found;
- saved view/frame id not found;
- plugin/context system not initialized yet;
- Canvas wrapper note cannot be created;
- Canvas file cannot be parsed or updated;
- editable mode requested but unsupported in the current host.

Errors render inline and include the target/id where useful. They must not write
fallback data or silently convert to static tables.

## Data Flow

Markdown page embed:

```text
notidian code block
  -> parse descriptor
  -> NotidianEmbed
  -> SpaceFragmentViewComponent / ContextListContainer
  -> existing Notidian table projection
  -> Markdown/frontmatter/file path canonical data
```

Canvas wrapper embed:

```text
Canvas file node
  -> wrapper Markdown note
  -> notidian code block
  -> same Markdown page embed path
```

Legacy transclusion:

```text
![![target/#^schema]]
  -> legacy ref parser
  -> NotidianEmbedDescriptor
  -> same NotidianEmbed renderer
```

## Testing And Verification

Unit tests:

- parse valid descriptor blocks;
- reject invalid descriptors with structured errors;
- normalize `view:` and `table:` aliases;
- convert legacy `#^` and `#*` refs to descriptors;
- serialize descriptors to canonical fenced blocks;
- compute wrapper note paths without unsafe characters.

Component/DOM tests:

- Markdown processor mounts and unmounts a React root;
- invalid blocks render inline errors;
- read-only mode suppresses edit affordances where the table supports that
  distinction;
- title and height options affect only presentation.

Canvas tests:

- create a valid JSON Canvas file node;
- preserve existing nodes and edges;
- generate unique node ids;
- avoid overlapping inserted nodes when enough canvas context exists;
- create wrapper Markdown content with the expected `notidian` block.

Live-vault verification:

```bash
npm test -- --runInBand
npx tsc -noEmit -skipLibCheck
npm run build
npm run health:audit -- --live
```

For implementation work that writes into a real vault, add an opt-in smoke path
that:

- creates two fixture Markdown rows with frontmatter;
- creates or opens a Notidian saved view;
- inserts the embed into a Markdown page;
- inserts the embed into a Canvas file as a wrapper file node;
- reloads Notidian;
- verifies no `.space`, `.makemd`, or `.base` runtime artifact is created;
- captures Obsidian developer errors.

## Documentation Updates

When implemented, update:

- `docs/current-state.md` with implemented embed behavior;
- `docs/table-database-workflows.md` with user workflow;
- `docs/notidian-system-architecture.md` if the descriptor becomes part of the
  durable architecture;
- ADR only if implementation changes the source-of-truth model.

No native Obsidian Bases documentation or `.base` flow should be introduced.

## Implementation Order

1. Add descriptor parser, normalizer, serializer, and tests.
2. Add shared `NotidianEmbed` renderer and host error states.
3. Register Markdown `notidian` code block processor.
4. Route legacy Notidian fragment embeds through the shared renderer.
5. Add copy/insert commands for Markdown.
6. Add Canvas wrapper note and JSON Canvas node insertion.
7. Add focused tests and live-vault smoke coverage.
8. Document the shipped behavior.
9. Evaluate direct Canvas text-node and Canvas-native enhancements only after
   stable wrapper-node behavior is verified.

## Non-Goals

- No native Obsidian Bases integration.
- No `.base` export/import/mirroring.
- No copied row-data snapshots as the primary embed mechanism.
- No direct Canvas DOM patching in the first release.
- No hidden context MDB copies of ordinary frontmatter values.
- No default editable Canvas embeds until interaction conflicts are resolved.
