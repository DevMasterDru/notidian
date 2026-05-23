# Obsidian Property Backed Contexts Design

## Decision

Ordinary note metadata must be canonical in Obsidian Markdown frontmatter. Make.md contexts may define views, visible columns, column order, filters, grouping, formulas, relations, aggregates, and advanced Make.md-only behavior, but they must not become a separate canonical datastore for normal note properties such as `status`, `area`, `project`, `board`, `address`, `voltage`, or `ups`.

## Problem

When a folder such as `Relays & Devices` is opened as a Make.md database, Make.md shows only its default context columns, currently `File` and `Created`. The notes already contain YAML frontmatter properties, but Make.md only syncs frontmatter values into context rows for columns that exist in the Make.md context schema.

The result is a split mental model:

- Obsidian Properties and native Bases treat file frontmatter as the data.
- Make.md contexts treat a folder as a context with its own MDB schema and rows.
- Existing frontmatter properties are available to Make.md, but they are not automatically projected into the database view.

For a Notion-like database experience inside Obsidian, this is the wrong default. A file's properties should be immediately visible and editable across the system, regardless of whether the user opens the note, the Obsidian Properties view, native Bases, Dataview, scripts, or Make.md.

## Goals

- Opening a folder context should surface existing frontmatter properties as table columns when the context has only default columns.
- Editing a file-backed property from Make.md should write to the Markdown file frontmatter.
- Editing a file-backed property outside Make.md should update Make.md after Obsidian metadata changes.
- Make.md context data for file-backed properties should be a cache or projection, not the source of truth.
- The feature should preserve existing Make.md-only advanced context features.
- The design should create a path toward `.base` import/export or interoperability without requiring a full rewrite first.

## Non-Goals

- Do not replace all Make.md context storage in the first implementation.
- Do not implement a complete `.base` parser, writer, or renderer in the first implementation.
- Do not change relation, aggregate, formula, or custom Make.md context semantics except where needed to keep file-backed property behavior consistent.
- Do not scan the whole vault when a folder-specific property scan is sufficient.

## Current Architecture Findings

Make.md stores context schemas and rows in MDB tables. The default context fields include:

- `File`, a primary file column.
- `Created`, a `fileprop` column backed by `File.ctime`.

The Obsidian Markdown file adapter reads note frontmatter from Obsidian's metadata cache and exposes it as path metadata. Context row sync uses the context columns to decide which frontmatter properties to copy into rows. If the context schema does not include a frontmatter property, that property is not shown in the context table.

Make.md already has a manual "add existing frontmatter" path in the new property menu. It gathers properties from paths in a context and appends selected properties to the context schema. This is the best existing seam to generalize, automate, and harden.

## Native Bases Model To Align With

Native Obsidian Bases treats:

- Files as rows.
- Note properties from frontmatter as note properties.
- File metadata as `file.*` properties.
- Formulas as view/base-defined derived properties.
- `.base` files as configuration for filters, formulas, summaries, and views.

The important architectural point is that Bases stores data in Markdown files and their properties. The base definition stores view behavior, not duplicate row values for normal note properties.

## Proposed Architecture

### 1. Property Discovery

Add a small utility that discovers frontmatter properties for a set of paths:

- Input: `Superstate`, candidate paths, existing context columns, settings.
- Output: `SpaceProperty[]` for note properties not already present as columns.
- Behavior:
  - Read from `superstate.pathsIndex.get(path)?.metadata?.property`.
  - Infer Make.md field type using existing `detectPropertyType`.
  - Exclude Make.md control metadata keys, alias keys, and tag keys already intentionally filtered by the current menu code.
  - Preserve first-seen property order by path order, then property order as returned by metadata.

This should replace duplicated logic currently embedded in the new property menu.

### 2. Automatic Column Materialization

When a folder context is first initialized or opened and its context schema contains only default columns, Make.md should add discovered frontmatter properties to the default context table schema.

Recommended trigger:

- During context initialization/reload, after the context paths are known and before rows are built for display.
- Only for folder-backed contexts.
- Only when user settings allow automatic import.
- Only when the non-default column set is empty, to avoid changing mature contexts unexpectedly.

Initial setting:

- `autoImportObsidianPropertiesToContexts: true`

This setting should default to true in this fork because the fork's purpose is Obsidian-native, property-backed database behavior.

### 3. File-Backed Column Semantics

For normal note-property columns:

- The column name maps to a frontmatter key.
- Display values should be read from path metadata/frontmatter during row sync.
- Cell edits should write through to Markdown frontmatter, not only to the MDB row.
- MDB row values for these columns are treated as rebuildable projection data.

For Make.md-only fields:

- Existing behavior can remain for advanced context fields that do not directly map to ordinary frontmatter.
- `fileprop`, formula, relation, aggregate, flex, and context fields should remain governed by Make.md context schema semantics.

### 4. Sync Behavior

When Obsidian metadata changes for a Markdown file:

- The Markdown adapter already reparses the file cache.
- Make.md should reload the affected path.
- Any context containing that path should update its projected row values from frontmatter.
- The UI should receive the existing path/context update events.

This keeps edits from Obsidian Properties, direct YAML editing, scripts, or other plugins visible in Make.md.

### 5. Manual Import Remains Available

Keep the existing "add existing frontmatter" action, but route it through the same discovery utility. This gives users an explicit command for contexts where automatic import is disabled or where new properties appear later.

### 6. Future `.base` Interoperability

After property-backed contexts are stable, add a separate feature for `.base` interoperability:

- Export a Make.md folder context to a `.base` file.
- Import a simple `.base` table into a Make.md context view.
- Optionally mirror column order, filters, and visible properties.

This is deliberately phase two because `.base` view semantics and Make.md context semantics are similar but not identical.

## Data Flow

1. User opens folder context.
2. Make.md identifies paths in the folder through the existing spaces/index mechanism.
3. The new discovery utility scans only those paths' cached frontmatter properties.
4. If the context has only default columns, Make.md adds discovered note properties as context columns.
5. Context row generation reads values from `pathsIndex[path].metadata.property`.
6. User edits a file-backed cell in Make.md.
7. Make.md writes the value to file frontmatter.
8. Obsidian metadata cache emits a change.
9. Make.md reloads path/context state and updates the table projection.

## Error Handling

- If a path has no metadata or no frontmatter, skip it.
- If a property type cannot be inferred consistently, use `any` or `text`, matching the closest existing Make.md behavior.
- If frontmatter write fails, notify the user and do not silently update only the MDB row.
- If a context has user-defined columns, do not auto-add new properties without an explicit manual import.
- If two properties differ only by case, preserve the exact keys returned by Obsidian and avoid merging them in this feature.

## Testing Strategy

Add Jest coverage before implementation:

- Property discovery returns frontmatter keys from path metadata.
- Discovery excludes Make.md control keys and already-present columns.
- Discovery infers basic field types for strings, numbers, booleans, dates, and links.
- Auto-materialization appends discovered columns only when a context has only default columns.
- Auto-materialization does not modify contexts with user-defined columns.
- Row sync reads updated frontmatter values for file-backed columns.

If the existing Jest setup cannot run TypeScript tests, add the smallest Jest configuration needed for `ts-jest`.

## Baseline Risks

The fork baseline currently has no Jest tests. `npm test -- --runInBand` exits with "No tests found." `npm run build` fails before TypeScript because `scripts/sync-version.mjs` is referenced but missing from the repository. Direct TypeScript checking also exposes an existing target mismatch in `src/adapters/text/textCacher.ts` because the project targets `es6` while using a regex flag that requires ES2018.

These are baseline issues, not caused by the property-backed context work. The implementation plan should add focused tests for the new behavior and use direct test commands for those files. Build-system repair can be tracked separately unless it blocks validation.

## Acceptance Criteria

- A folder with Markdown files containing frontmatter properties opens in Make.md with those properties visible as columns without manual setup.
- For the `Relays & Devices` example, expected properties include `record`, `status`, `area`, `domain`, `field`, `project`, `sort_order`, `updated`, `board`, `block`, `address`, `voltage`, `ups`, and `state`.
- Editing those properties in Make.md writes to the note frontmatter.
- Editing those properties outside Make.md updates Make.md after metadata reload.
- Existing Make.md advanced columns remain available.
- The implementation has failing-then-passing tests for discovery and materialization behavior.
