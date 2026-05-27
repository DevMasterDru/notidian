# Notidian System Architecture

Status: Accepted architecture reference.

Governing ADR: [ADR 0013: Notidian-first canonical file architecture](adr/0013-notidian-first-canonical-file-architecture.md).

## Mission

Notidian makes Obsidian folders and Markdown files behave like practical Notion-style databases without moving ordinary data governance out of the vault.

The system optimizes for:

- fast table work over real notes;
- spreadsheet-like editing where it is safe;
- file names editable as titles through real file operations;
- frontmatter properties visible and editable as table columns;
- explicit migration from old Make.md context data;
- compatibility with Obsidian Bases without requiring native Bases as the main UI.

The system does not optimize for cloning every Notion feature or preserving every Make.md feature. Features stay only when they serve the Notidian database workflow and can be implemented without hidden ordinary-data authority.

## Core Contract

Notidian is the database UX. Markdown files, file paths, and frontmatter are the ordinary data authority.

```text
User intent
  -> Notidian table/view UX
  -> authority-aware transaction planner
  -> Markdown file, file path, frontmatter, or explicit Notidian state
  -> Obsidian metadata refresh
  -> Notidian projection refresh
```

The table may feel like a spreadsheet. It may render cached projections. It may store view state. It may use compatibility adapters. It must not accept ordinary data changes that did not reach the canonical owner.

## System Layers

| Layer | Owns | Must not own |
| --- | --- | --- |
| Markdown vault | Note content, file path, file basename, frontmatter | Notidian view preferences. |
| Obsidian metadata cache | Current parsed view of files and frontmatter | Durable user values beyond what files contain. |
| Notidian table UX | Selection, editing, copy/paste, fill, undo/redo, conflict UI, schema UI | Detached ordinary row data. |
| Notidian transaction layer | Safe write planning and application | Silent overwrite or sync ambiguity. |
| Notidian context MDB | View state, explicit Notidian-owned fields, legacy state, compatibility state | Ordinary note metadata unless explicitly Notidian-owned. |
| Bases interop | Optional `.base` export/import/mirror/custom view compatibility | Required product governance. |
| Real-vault harness | Runtime proof in Obsidian | Product behavior that bypasses source-of-truth rules. |

## Database Model

### Database

A Notidian database is a view over a set of Markdown files.

The default database source is a folder scope:

- each Markdown file in the folder is a row;
- subfolder inclusion must be explicit in the view;
- non-Markdown files are excluded from ordinary row sets unless a feature explicitly supports them.

Future database sources may include saved searches or explicit collections, but the row identity rule remains the same unless the feature declares a different row type.

### Row

A row is a Markdown file.

The row's stable identity is its file path. Obsidian metadata timing can lag after a rename, so UI reconciliation must tolerate temporary old and new paths.

### Title Cell

The visible title cell displays the file basename without extension.

Editing it performs a file operation:

- same-folder rename for a simple title edit;
- future move transaction for folder changes;
- never a detached context title string by default;
- no default frontmatter `title` authority.

### Property Column

An ordinary property column maps to a frontmatter key.

Notidian discovers frontmatter keys across the row set and materializes them as visible columns. Editing a property writes the row Markdown file through Obsidian's frontmatter API before the UI accepts the value.

### File Projection Column

File projections such as creation time, modification time, extension, and path are computed from Obsidian file metadata.

They are read-only unless the projection maps to a safe file operation. `file.name` maps to rename. Other file projections remain read-only until a transaction exists.

### Formula Column

A formula column is computed from current inputs.

It can be stored as a view definition or Notidian formula definition, but displayed formula results are projections. They are not ordinary durable row values.

### Explicit Notidian-Owned Field

A Notidian-owned field is allowed only when it is visibly and intentionally not ordinary frontmatter.

Examples:

- legacy context-only values awaiting migration;
- relation state that cannot yet be represented as frontmatter links;
- advanced view behavior that has no safe frontmatter representation.

These fields must be labeled and surfaced so the user and AI agents know they are not ordinary Obsidian properties.

## Storage Model

### Canonical Storage

Canonical ordinary data lives in:

- Markdown file paths;
- Markdown file basenames;
- Markdown frontmatter;
- Markdown file content when a feature explicitly edits note body content.

### Context MDB Storage

Context MDB remains a Notidian implementation store, not a general data authority.

Allowed context categories:

- view layout: visible columns, widths, order, sort, grouping, filters, saved views;
- UI preferences: density, collapsed groups, display options;
- compatibility: Make.md legacy state and adapter metadata;
- explicit Notidian-owned fields;
- formulas and relations that are not yet represented canonically elsewhere.

Disallowed context categories:

- hidden copies of ordinary frontmatter values treated as durable row data;
- detached page titles for Markdown-file rows;
- bidirectional sync state that lets both frontmatter and context claim ownership of the same value.

### `.base` Storage

`.base` files are optional interoperability artifacts.

They may be:

- exported from a Notidian view;
- imported into a Notidian view;
- mirrored for compatibility;
- used to host the optional `notidian-table` custom Bases view.

They do not become the default source of truth for ordinary Notidian databases. If a `.base` view and a Notidian view disagree, ordinary data still comes from files and frontmatter; view configuration ownership depends on the explicit import/export/mirror mode.

### Transient State

Transient state includes:

- selected ranges;
- active cell/editor;
- pending, skipped, failed, and conflict feedback;
- in-memory undo/redo stacks;
- runtime capability snapshots;
- optimistic rendering state.

Transient state must be clearable without data loss.

## Write Architecture

All user edits go through an authority-aware planner before writing.

### Property Edit

1. Resolve row file path.
2. Read current frontmatter from Obsidian metadata or file API.
3. Compare the current canonical value with the value rendered in the table.
4. If current data is stale, surface conflict feedback.
5. If accepted, write frontmatter first.
6. Refresh or reconcile the table projection.

### Title Edit

1. Resolve current file path.
2. Normalize the desired visible title.
3. Reject empty, slash-containing same-folder edits, duplicate targets, unsafe paths, and non-Markdown targets.
4. Rename through Obsidian file APIs.
5. Reconcile metadata refresh, row order, and duplicate old/new rows.

### Mixed Title And Property Edit

For paste or fill operations that include title and property cells in the same row:

1. Preflight all title changes.
2. Apply title changes first.
3. Retarget same-row property writes to the new path.
4. Write frontmatter.
5. Store inverse undo operations in dependency-safe order.

### Range Paste, Cut, Fill, And Clear

The planner maps each cell target to one of:

- file rename or move;
- frontmatter write;
- explicit Notidian-owned context write;
- read-only skip;
- invalid skip;
- failed write.

Single-cell fill across a range is allowed. Rectangular TSV paste is allowed. Read-only formulas and unsupported file projections are skipped.

### Undo And Redo

Undo and redo replay through the same authority-aware write paths used by forward edits.

They are not direct state mutation. They must be allowed to fail, skip, or surface conflicts when canonical data changed after the original edit.

### Conflict Handling

Conflict handling must make the mismatch visible.

The minimum conflict actions are:

- reload from canonical data;
- apply anyway through an explicit forced write;
- preserve current canonical value.

The target architecture adds richer diff/merge for multi-cell operations so users can resolve conflicts without losing either side's value.

## Schema Architecture

Schema operations are file/frontmatter operations, not context-only display changes.

### Create Property

Creating a property adds a view column immediately. It writes frontmatter only when a value is assigned or when the user explicitly requests default backfill.

### Rename Property

Renaming a property is a migration:

1. Preview affected files.
2. Detect files that contain both old and new keys.
3. Require explicit conflict resolution for collisions.
4. Apply frontmatter key changes file by file.
5. Update Notidian view definitions and formulas that reference the property.

### Delete Property

Deleting a property must distinguish between:

- removing the column from the view;
- deleting the frontmatter key from files.

The destructive option requires preview and confirmation.

### Types

Notidian should infer types conservatively and preserve existing frontmatter values.

Type-specific editors may improve UX, but type coercion must not rewrite files unless the user performs an explicit conversion or edit.

## Legacy Make.md Migration

Legacy context data is valuable until proven otherwise.

The migration sequence is:

1. Audit context rows against current Markdown/frontmatter.
2. Classify columns and values.
3. Preview a migration plan.
4. Require resolution for context-only values and conflicts.
5. Apply writes only after user confirmation.
6. Preserve a reversible report of what changed.

Automatic cleanup is allowed only for duplicates that match frontmatter exactly and have no blocking context-only values or conflicts.

## Bases Compatibility

Bases compatibility is a product boundary, not the product center.

### Export

Export maps supported Notidian view semantics to `.base` YAML and reports unsupported features.

Supported semantics should include:

- folder scope;
- Markdown-file rows;
- frontmatter properties;
- file projections;
- visible columns;
- display names;
- simple filters;
- grouping;
- summaries where representable.

Unsupported semantics must be visible in the export preview.

### Import

Import should create or update a Notidian view from supported `.base` semantics.

Import must not convert `.base` into the ordinary data authority. Files and frontmatter still own row values.

### Mirror

Mirroring is optional and explicit.

One side must own each concern:

- files/frontmatter own ordinary data;
- Notidian owns Notidian view UX state unless the user chooses a `.base`-owned view mirror;
- unsupported semantics are reported and preserved where possible.

### Custom Bases View

`notidian-table` remains useful as:

- runtime proof that Notidian can render a custom Bases query result;
- compatibility for users who open `.base` files;
- a test surface for Obsidian Bases API behavior.

It is not required to become the only or primary Notidian table.

## AI And Skill Architecture

AI agents should follow this hierarchy:

```text
Notidian decides product and source-of-truth rules.
Obsidian Bases explains .base compatibility semantics.
Obsidian CLI proves behavior in a live vault.
```

For Atlas Vault database creation, the default format is:

- a folder of Markdown files;
- frontmatter properties for ordinary fields;
- Notidian view configuration for database UX;
- optional `.base` export only when the user asks for native Bases interoperability.

Agents must not create hidden context-only ordinary metadata when the user asks for a database.

## Runtime Verification

Repository verification:

```bash
npm test -- --runInBand
npx tsc -noEmit -skipLibCheck
npm run build
git diff --check
```

Live Obsidian verification after build/install:

```bash
npm run install:vault -- --vault-path="/Users/druker/Atlas Vault" --allow-write
npm run test:real-vault -- vault="Atlas Vault" --allow-write
obsidian vault="Atlas Vault" dev:errors
```

Use narrower live flags for focused coverage:

```bash
npm run test:real-vault -- vault="Atlas Vault" --allow-write --base-export
npm run test:real-vault -- vault="Atlas Vault" --allow-write --base-view
```

## Final Architecture Target

The final Notidian system should be:

- Notidian-first in UX;
- Markdown/frontmatter-first in data ownership;
- context-aware only for explicit Notidian state and legacy preservation;
- Bases-compatible without requiring native Bases;
- safe under external edits;
- easy for AI agents to operate because there is one ordinary data authority;
- smaller than Make.md because unused parallel database machinery is removed or demoted.
