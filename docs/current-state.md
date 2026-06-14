# Current State

This page is the current implementation reference for the Notidian fork. ADRs explain why the architecture exists; this page summarizes what is implemented now and what remains intentionally unfinished.

## Product Direction

Notidian turns Obsidian folders and Markdown files into database-like workspaces while keeping Obsidian vault data canonical.

The key rule is:

> File-backed data belongs to files and frontmatter. Notidian may project, edit, and organize it, but it must not silently become governed by a hidden context database.

The strategic direction is Notidian-only personal database architecture. Notidian is the only intended database engine and interface for Atlas Vault. Native Obsidian Bases is not a runtime dependency, compatibility pillar, or roadmap target.

## Internal Lineage Names

Some internal identifiers still use Make.md-era names, including `MakeMDPlugin`, `MakeMDSettings`, `makemd-core`, `mk-*` CSS classes, `spaces://`, and `.mkit`. These are implementation-lineage or compatibility names, not active Make.md runtime paths.

Do not use those names alone to infer that Notidian reads `.obsidian/plugins/make-md`, writes `.makemd`, fetches Make.md web kits, depends on the Make.md `vaul` fork, or targets native Bases. Active architecture is determined by the source-of-truth table below, the runtime adapter registration, package dependencies, and live-vault health checks.

### Notidian Storage Root

Notidian uses `.notidian` as its active vault storage root for runtime caches, root assets, language overrides, templates, and per-folder context MDB view state. `.makemd` is retired root cache state. `.space` is retired Make.md compatibility storage and should appear only as migration input or external backup material. Runtime vault adapter operations normalize exact `.space` and `.makemd` path segments to `.notidian`, which prevents stale in-memory listeners from recreating retired roots after an update.

The storage-root migration command is dry-run-first:

```bash
npm run migrate:space-store -- --vault-path="/Users/druker/Atlas Vault"
npm run migrate:space-store -- --vault-path="/Users/druker/Atlas Vault" --allow-write
```

The write phase copies missing `.space` files into sibling `.notidian` folders, refuses content conflicts, rewrites migrated JSON string values that contain exact `.space` or `.makemd` path segments to `.notidian`, and moves original `.space` folders into an external `/tmp/notidian-space-store-backups` rollback tree instead of leaving stale backup folders inside the vault.

## Source Of Truth

| Data kind | Canonical owner | Current Notidian behavior |
| --- | --- | --- |
| Page identity | Markdown file path/name | Displayed as the `File`/page-title cell and changed through rename transactions. |
| Ordinary note metadata | Markdown frontmatter / Obsidian metadata cache | Discovered as table columns and edited through frontmatter writes. |
| View layout | Notidian view model, stored in `.notidian` context MDB today | Stores column order, hidden columns, frozen columns, filters, grouping, sorting, and view state. |
| Context-native fields | Notidian context MDB | Stores a row value only when the column is **explicitly** Notidian-owned (`source: "notidian"`) or is a context-only type with no frontmatter form ([ADR 0017](adr/0017-explicit-notidian-ownership.md)). |
| Authority-ambiguous columns (no source marker) | Markdown frontmatter | A source-less, file-backed-compatible column (text/number/date/select/link/…) defaults to frontmatter and is never silently owned by the MDB ([ADR 0017](adr/0017-explicit-notidian-ownership.md)). |
| Formulas, aggregates, file projections | Computed from current inputs | Displayed as projections, not durable user-entered values. |
| Relations | Notidian context model | Preserved from Make.md semantics unless later mapped to frontmatter links. |

### Notidian-Only Personal Architecture

Notidian should not remain a full Make.md-style parallel database, and it should not become a native Bases wrapper or compatibility layer.

The durable direction is:

- Notidian is the database surface the user primarily works in;
- Markdown files are rows;
- file path and basename are page identity;
- frontmatter owns ordinary editable properties;
- `.notidian` context MDB stores view state, explicit Notidian-owned state, and legacy Make.md compatibility state;
- native Bases and `.base` files are outside the active architecture.

Bases alignment was useful research. It helped validate:

- file rows instead of detached rows;
- frontmatter-backed ordinary properties;
- `file.name` as file identity;
- authority-aware frontmatter writes;
- runtime verification discipline.

Notidian still owns necessary product value in:

- controlled file-title rename transactions;
- spreadsheet-style range editing;
- frontmatter conflict detection and explicit overwrite handling;
- migration review for legacy Make.md contexts;
- compatibility display for legacy context-only data until it is audited and migrated.

The durable decision is recorded in [ADR 0014](adr/0014-notidian-only-personal-database-engine.md). Historical Bases and Notidian-first/Bases-compatible records are preserved in the [ADR index](adr/README.md), but they are not part of the active roadmap.

## Implemented Behavior

### Frontmatter-Backed Folder Tables

- Folder contexts can materialize existing YAML/frontmatter properties as visible table columns.
- Frontmatter-backed columns use `source: "frontmatter"`.
- Editing a frontmatter-backed cell writes the Markdown file first.
- If the canonical frontmatter write fails, Notidian does not accept the table row change.
- If the current frontmatter value no longer matches the table row's base value, Notidian skips the stale write instead of overwriting external changes.
- Frontmatter-backed and computed values are stripped before context MDB persistence so MDB rows do not become the durable data source.
- Mixed observed frontmatter types resolve conservatively to `text`.
- User-selected column types are preserved as schema/view metadata for frontmatter-backed properties and are used when projecting row values from Obsidian metadata.
- Frontmatter-backed type menus expose only the reliable file-backed table types: Text, Number, Yes/No, Date, Select, Multi-select, Link, and Image. Make.md context-only types such as Formula, Context, Flex, Aggregate, and Object stay available for Notidian-owned columns, not ordinary frontmatter columns.
- `Tags` is reserved for the real Obsidian tags property. A non-`tags` property that already has `tags-multi` type is rendered as a multi-option property so it does not accidentally display unrelated file tags.

### Editable Page Titles

- The visible page title is derived from the row's file path basename.
- A view may designate one frontmatter property as its display property (`predicate.listViewProps.displayProperty`, set from the view-options Display Property picker). When set, list and table row labels render that property's value; empty or missing values fall back to the basename ([ADR 0016](adr/0016-per-view-display-properties-and-inline-row-expansion.md)).
- The display property changes only the rendered label. Row identity, links, copy, and rename transactions stay basename-owned; editing the title cell still edits and renames the basename.
- Editing the title performs a file rename, not a context value write.
- Rename transactions reject empty names, slash-containing names, duplicates, and invalid target conflicts.
- Bulk title paste uses the same rename transaction path.
- Rename reconciliation preserves row order and removes duplicate renamed rows after metadata events.
- Changing folders from the title cell is intentionally not implemented; that requires a separate move command.

### Inline List Row Expansion

- List-layout rows in file-backed contexts show a collapse chevron next to the row label ([ADR 0016](adr/0016-per-view-display-properties-and-inline-row-expansion.md)).
- Expanding a row renders the note body inline below the row header through the existing inline-note flow editor; collapsing removes it.
- Multiple rows can be open at once, and each row's open state toggles independently.
- Open state is per-session React state only. It is not written to the view predicate or the context MDB; persisted open-state is an explicit deferred follow-up in ADR 0016.
- Rows that do not resolve to a markdown note keep an alignment spacer and no affordance. Board, cards, gallery, catalog, flow, calendar, and table layouts are unchanged.

### Hub Note Body Above The Table

- The space view renders the space's folder/hub note body as an editable inline embed between the space header and the frame body (`SpaceNoteBody`), so a database's definitions/legend live at the top of its page (Notidian-7oj).
- The region renders nothing when the note is missing or its body (frontmatter stripped) is blank; emptiness is evaluated on mount/path change so the region does not vanish mid-edit. The embed hides the note's frontmatter properties widget — schema frontmatter is edited in the hub note itself.
- Gated by `spaceViewShowNoteBody` (default on) and requires `enableFolderNote`.
- `folderNoteInsideFolder` now actually controls `notePath` resolution: `true` keeps the note inside the folder (legacy default, honors `folderNoteName`); `false` resolves the adjacent sibling note (`Reviews.md` beside `Reviews/`, custom note names ignored to avoid sibling collisions). Note creation (`saveLabel`, `saveSpace`, `NoteView` force-create), space renames, and folder-note creation reload (`onPathCreated`) follow the same resolution. The Atlas Vault runs adjacent mode per Atlas Method ADR-0008.

### Hub Note Type Profiles

- A database's hub note can declare its schema in frontmatter:
  `schema_type: notidian_type_profile` plus a `fields:` map (Atlas Method ADR-0008; Notidian-5qr). The pure planner layer lives in `core/utils/contexts/typeProfile.ts`.
- Hub → table (auto on context load, in `parseContextTableToCache`): missing profile fields materialize as frontmatter-backed columns with no row writes; the profile owns the kind for frontmatter-backed columns (an inferred `text` upgrades to the profile's `option`/`date`/etc.); hub select options seed/refresh the column config hub-first while keeping table-local extras and their colors. Conforming tables are a strict no-op.
- Kinds v1: text, select(options), date, number, checkbox, link/url; `password` parses but maps to text until the masked field kind ships. Unknown kinds degrade to text with a parse issue, never an error.
- Table → hub mirror (`typeProfileMirror.ts`, hooked in `ContextEditorContext`): adding a primary-table column, renaming a frontmatter key via `Rename Frontmatter Key`, and adding select options write the updated `fields:` map back to the hub. The mirror fires only when the hub already declares a profile, only for ordinary value kinds (computed/relation/layout types stay table-local), and suppresses echoes so the two directions cannot loop. Mirror failures notify and never roll back the table write.

### Password Field Kind

- `password` is a first-class column type (property-type menu, `ui//lock` icon) for secret values such as API keys (Atlas Method ADR-0009; Notidian-k6e). Type Profile `kind: password` maps to it.
- **Masking is a UI concern, not encryption**: values are stored as plain frontmatter and the vault-local threat model is accepted in the ADR. Obsidian's native properties panel on the raw note still shows the value — only Notidian surfaces mask.
- Cells render fixed-length dots (no length leak) with hover eye/copy buttons: the eye toggles reveal (auto-rehides on pointer leave, Escape, and when editing ends), copy puts the real value on the clipboard without revealing it. Edit mode is a real `<input type="password">`; no `dangerouslySetInnerHTML` of the value anywhere.
- Rectangular/TSV range copy includes real values by user decision — clipboard writes are deliberate actions; display stays masked.
- `parseProperty` treats `password` as a string kind so frontmatter values sync into context rows like text.

### Add-Property Menu Frontmatter Discovery

- The add-property menu discovers existing frontmatter keys across the context's rows when it opens and lists them as a visible `Existing Property` section with inferred-type icons ([ADR 0016](adr/0016-per-view-display-properties-and-inline-row-expansion.md)).
- Selecting a suggestion adds the key as a frontmatter-backed column/property through the same save path as the previous import-button submenu; creating a new property is unchanged.
- Typing in the property-name input narrows the suggestions. Keys that are already table columns are not suggested, and the section is absent when nothing is discovered.
- The `$fm` property source (single-file frontmatter, object subfields, action parameters) shows no suggestions because it has no space row set to discover from; choosing a concrete space as the property source surfaces discovery scoped to that space.

### Frontmatter Default Columns On Fresh Primary Contexts

- Opening a view on a primary file context whose persisted table still has only the default `File`/`Created` columns imports the discovered frontmatter properties as persisted frontmatter-backed columns once, so a fresh table or list view starts with all row properties, like Notion.
- The import gate (`shouldImportFrontmatterColumns`) requires a primary schema, a persisted table with only default columns, and at least one discovered frontmatter key. Read-only contexts, read mode, tag spaces, and non-primary schemas never import.
- The import re-reads the persisted table and re-runs discovery against its current columns immediately before the save, so concurrent loads or user edits cannot duplicate columns. After the single save the persisted table no longer has only default columns, so the gate stays closed on every later load.
- Accepted v1 consequence: a frontmatter-rich folder opened as a context gets a wide-by-default table. Column visibility is managed from there through the view's hidden-columns state.
- Accepted v1 consequence: a user who deletes every non-default column and reopens the context gets the discovered frontmatter columns imported again.

### Properties Visibility Panel

- The view-options `Properties` item opens a Notion-style panel with two groups: `Shown in view` (columns not in `predicate.colsHidden`, ordered by `predicate.colsOrder` like the live table) and `Hidden in view` (columns in `colsHidden`).
- Each row shows a drag handle, the property's type sticker, its name, and an eye toggle (`ui//eye` shown / `ui//eye-off` hidden) that moves the property between groups immediately.
- Dragging within `Shown in view` reorders `predicate.colsOrder` with the same move semantics as the table header drag; dragging a row across groups toggles `colsHidden`.
- The primary `File` column is pinned at the top of `Shown in view`: it has no eye toggle, is not draggable, and bulk `Hide all` never hides it.
- Group headers carry bulk actions: `Hide all` on the shown group and `Show all` on the hidden group. `Show all` only clears hidden keys belonging to the panel's columns, preserving unknown predicate entries.
- A search input narrows both groups by property name. Clicking a row name still opens the existing per-property edit menu, and a `New Property` footer item keeps the previous create flow.
- All visibility and order state stays in the view predicate (`colsHidden`, `colsOrder`, keyed `name + table`) through `savePredicate`; nothing is written to files or context MDB columns.

### Range Clipboard Editing

- Users can select rectangular table ranges.
- `Cmd/Ctrl+C` copies selected cells as TSV.
- `Cmd/Ctrl+X` copies and clears editable selected cells.
- `Cmd/Ctrl+V` pastes TSV data into the active cell or selected range.
- A single copied cell can fill a larger selected range.
- Multi-cell paste expands down/right from the active cell.
- Read-only computed/file projection targets are skipped by the paste planner.

### Table Loading

- Large tables initially render in configured page-size chunks.
- The loading footer shows the current loaded row count against the current visible/filtered row count.
- `Load More` appends one more configured chunk without exceeding the current filtered row count.
- `Load All` expands the current table view to every currently visible/filtered row.

### Frozen Columns

- Column header menus include `Freeze up to column` and, when freezing is active, `Unfreeze columns`.
- Freezing is stored as Notidian view state, not frontmatter or ordinary row data.
- The row-number gutter and every visible column up to the selected column stay sticky during horizontal scrolling.
- Frozen offsets are computed from the current visible column order and column widths, so hidden columns, reordered columns, and resized columns remain aligned.
- If a frozen column is later hidden or removed, Notidian clamps the frozen count to the remaining visible columns instead of creating stale hidden governance.

### Manual Row Ordering

- The table row gutter selects whole rows.
- Dragging from the row-number lane draws a marquee selection rectangle and selects intersecting visible rows.
- Dragging the row gutter grip reorders rows in Notidian's context table order.
- If multiple selected rows include the dragged row, Notidian moves those rows together as one block and preserves their relative order.
- The drag overlay is read-only preview UI that shows only the page/title name, not the full row's metadata.
- A successful row drag clears active sort/group state so the view becomes manual order. Filters can remain active; hidden rows keep their relative order while visible rows move.
- Row movement is view/order governance only. It does not write frontmatter values and does not create a second owner for ordinary metadata.

### Unified Table Edit Transactions

Normal value edits, field-option value edits, and paste value writes go through `executeTableValueWrites`.
Select and Multi-select are separate user-facing property types. Internally they keep the existing `option` and `option-multi` type IDs, so existing tables and frontmatter-backed view schemas do not require migration.

Select cells now open the option menu from the whole visible option chip, not only from the small dropdown glyph. Creating a new option from that menu saves the option configuration and the selected frontmatter value through the same transaction. Multi-select cells use the same option configuration path but keep the menu in multi mode and save the complete selected value set.

That transaction helper:

- Resolves the target row and file path once.
- Treats empty explicit paths as missing and falls back to the row file path.
- Compares frontmatter-backed writes against current canonical metadata before saving.
- Allows an explicit forced frontmatter write only after a conflict has been surfaced to the user.
- Groups frontmatter changes by resolved file path.
- Writes frontmatter before accepting table/context row changes.
- Applies root-table writes to one accumulated table snapshot.
- Applies linked context-table writes to one accumulated table snapshot per context.
- Persists field configuration updates even if a linked context row is temporarily missing, so option lists do not get lost while frontmatter value writes succeed.
- Returns `TableEditTransactionResult` with applied, skipped, and failed writes.

File/page-title edits remain outside this helper because they require rename preflight, temporary paths, metadata settling, and row reconciliation.

### Legacy Context Audit And Migration Planning

Notidian can now audit a legacy Make.md context table against current frontmatter snapshots without writing to the vault.

The audit/planner classifies:

- already frontmatter-backed columns;
- unmarked frontmatter candidates;
- context-only columns that should remain MDB-owned;
- computed/file projection columns;
- matching duplicate values;
- frontmatter-only values;
- context-only values that require backfill or user review;
- conflicting values that require user review.

The migration planner is conservative. It plans automatic cleanup only when a column has no blocking `conflict` or `context-only-value` rows. It preserves context-only columns, recommends discovered frontmatter keys as frontmatter-backed schema columns, and returns a migrated table copy only through a pure helper.

Notidian also includes a read-only CLI report:

```bash
npm run audit:legacy-context -- --vault="/Users/druker/Atlas Vault" --folder="Relays & Devices"
```

The report reads a single folder context, compares context rows with frontmatter, and emits Markdown or JSON. Partial reports created with `--max-files` are marked as incomplete and cannot be treated as automatically applicable. There is still no destructive legacy context-value migration command.

### Canonical Schema Planning

Notidian now has a pure schema planner for ordinary frontmatter-backed properties.

The planner can:

- discover existing frontmatter keys across a row set without writing files;
- summarize present/missing counts and observed value types;
- create a frontmatter-backed view column without writing empty frontmatter into every file;
- reject duplicate property names case-insensitively;
- preview property renames file by file;
- classify rename rows as `old-only`, `new-only`, `both-same`, `both-conflict`, or `neither`;
- block automatic rename application when a file contains conflicting old and new property values;
- distinguish hiding a property from the view from deleting its frontmatter key from files;
- produce explicit frontmatter write previews for confirmed apply flows.

The table header menu now includes `Rename Frontmatter Key` for frontmatter-backed columns. This command prompts for the new canonical key, previews affected file-state counts in a confirmation dialog, revalidates the plan after confirmation, writes replacement frontmatter values before removing the old key, updates table/view references, and reloads canonical data. It refuses to run when the planner finds duplicate target columns, files with conflicting old and new key values, or metadata that changed after the confirmation preview.

Editing the visible header text of a frontmatter-backed column is still treated as a display alias. Notidian keeps inline header edits non-destructive so a casual label edit cannot silently move YAML/frontmatter keys across files. Canonical key changes must use the explicit `Rename Frontmatter Key` command.

Deleting a frontmatter-backed column from the table menu is also intentionally blocked until destructive schema UI exists. Users can hide the column from the current view; Notidian keeps the schema column and canonical YAML data intact.

### Table Edit Feedback

Paste operations and direct single-cell edits now surface transaction state in the table:

- Planned paste targets show a pending cell state while the transaction runs.
- Direct value edits, field-option edits, and page-title rename edits show a pending cell state while the operation runs.
- Failed cells show failed feedback.
- Skipped cells show skipped feedback.
- Frontmatter conflict cells show inline Reload and Apply anyway actions, with a tooltip showing current, rendered, and attempted values.
- Successful cells clear back to normal after the operation completes.
- Obsidian notices summarize failed/skipped counts.
- Failed or skipped cells are remounted back to canonical row data so optimistic local editor state does not keep showing a value that was not accepted.

This feedback is transient UI state. It is not stored in context MDB and does not change the source-of-truth model.

Detected frontmatter conflicts show skipped cell feedback with:

```text
Frontmatter changed outside Notidian. Reload before editing.
```

Reload refreshes canonical table data and clears the transient conflict feedback. Apply anyway re-runs the attempted write with an explicit forced-frontmatter flag, still writing the Markdown file before any table/context value is accepted.

### Table Undo Journal

Table operations now create an in-memory undo entry before execution and push it after the forward operation applies writes. The active undo stack is scoped to the table context, so immediate undo remains available across table remounts caused by frontmatter writes or context reloads.

Supported undo paths:

- Direct single-cell property edits.
- Direct option edits that update option configuration and the selected cell value.
- Direct page-title/file rename edits.
- Paste.
- Cut.
- Delete/clear.
- Fill-from-single-cell paste.
- Bulk page-title rename paste.
- Mixed page-title/property paste.

Pressing `Cmd/Ctrl+Z` while the table is focused replays the inverse writes through `applyTableEdits`, so undo uses the same file rename, frontmatter write, and context MDB persistence paths as forward edits.

Pressing `Cmd/Ctrl+Shift+Z` or `Cmd/Ctrl+Y` replays the accepted forward writes from the redo stack through the same `applyTableEdits` path. Any new forward table edit clears redo history. Redo entries do not preserve forced conflict flags, so a redo cannot silently reuse a previous Apply anyway decision against newer frontmatter.

If an operation partially skips or fails, only accepted targets enter the undo/redo history.

The undo journal is table-scoped and transient. It is not a durable audit log and it does not add a hidden data-governance layer.

## Guarantees

Notidian currently guarantees the following for implemented edit paths:

- Ordinary frontmatter-backed values are accepted only after the frontmatter write succeeds.
- A paste path cannot bypass row file-path fallback by passing an empty path.
- Stale frontmatter-backed table edits are skipped instead of overwriting newer canonical frontmatter values.
- Stale frontmatter-backed edits can overwrite newer canonical values only after the user explicitly chooses Apply anyway on the conflicted cell.
- Bulk value writes update table/context snapshots from accumulated state rather than repeatedly saving stale row snapshots.
- Mixed title/property paste writes non-file values to the renamed file path after successful rename.
- Direct single-cell failures surface inline and reset back to canonical table data.
- Direct and bulk table operations can be undone through the same authority-aware edit paths that applied them.
- Direct and bulk table operations can be redone through the same authority-aware edit paths that applied them, without replaying forced conflict flags.
- Immediate undo after title paste uses the expected current renamed path instead of depending on metadata reload timing.
- Context MDB rows do not become the durable source of truth for frontmatter-backed or computed values.
- Legacy context migration planning does not strip a value that exists only in MDB or conflicts with frontmatter.
- Legacy context CLI reports are read-only, and partial frontmatter scans are never marked migration-ready.
- Property create, rename, and delete planning can now preview canonical frontmatter consequences before destructive schema UI/apply work is added.
- Frontmatter-backed header label edits do not rename canonical YAML keys; they store a display alias. Use `Rename Frontmatter Key` for explicit canonical key migration.
- Frontmatter-backed delete actions are hide-only until planner-backed destructive property deletion UI exists.
- Frontmatter-backed type changes stay inside the supported file-backed type surface and do not expose context-only Make.md field types as ordinary property types.

## Known Gaps

The following work remains before Notidian should be considered final:

- Richer conflict diff/merge UI is not implemented beyond the current inline Reload and Apply anyway actions.
- The real-vault smoke harness includes live table direct edit undo/redo, paste, paste undo/redo, frontmatter-backed type changes, Select option creation, existing Select selection from filled and empty cells, Multi-select persistence, conflict apply, and file-title rename paths, but broader multi-row paste/copy/cut, rejected title paste, richer conflict merge flows, and metadata timing fixtures are still needed.
- Legacy Make.md context audit/planning and read-only reports exist, but an opt-in write migration command for context-owned values is still needed.
- Property schema planning exists, and safe automatic frontmatter key rename is available from the header menu. Create-property, destructive delete, default backfill, and rename conflict-resolution flows are still needed.
- Moving files between folders from table cells is not implemented.

## Documentation Map

- Use [Table Database Workflows](table-database-workflows.md) for practical table usage and troubleshooting.
- Use [Notidian System Architecture](notidian-system-architecture.md) for the full A-Z architecture reference.
- Use [Real Vault Smoke Harness](real-vault-smoke-harness.md) for opt-in live Obsidian verification.
- Use [Legacy Context Audit Report](legacy-context-audit-report.md) for read-only reports on old Make.md contexts.
- Use [ADR 0001](adr/0001-authority-partitioned-database-model.md) for the source-of-truth model.
- Use [ADR 0002](adr/0002-frontmatter-backed-context-columns.md) for frontmatter-backed columns.
- Use [ADR 0003](adr/0003-editable-page-titles-through-file-renames.md) for page-title/file-rename behavior.
- Use [ADR 0006](adr/0006-unified-table-edit-transactions.md) for shared value edit transactions.
- Use [ADR 0007](adr/0007-table-edit-feedback.md) for transient cell feedback.
- Use [ADR 0008](adr/0008-table-undo-journal.md) for the table-local undo journal.
- Use [ADR 0009](adr/0009-frontmatter-conflict-detection.md) for frontmatter conflict detection.
- Use [ADR 0010](adr/0010-legacy-context-audit-and-migration.md) for legacy context audit and migration rules.
- Use [ADR 0014](adr/0014-notidian-only-personal-database-engine.md) for the current Notidian-only architecture.
- Use [ADR 0015](adr/0015-canonical-schema-planning.md) for frontmatter property schema create/rename/delete planning.
- Use the [ADR index](adr/README.md) for historical/superseded decision records.
- Treat `docs/superpowers` as historical execution evidence only. It does not override ADRs or current-state docs.

## Implementation Map

| Area | Main implementation files |
| --- | --- |
| Table UI, selection, clipboard shortcuts, feedback wiring | [TableView.tsx](../src/core/react/components/SpaceView/Contexts/TableView/TableView.tsx) |
| Context editor write bridge | [ContextEditorContext.tsx](../src/core/react/context/ContextEditorContext.tsx) |
| Unified value write transactions | [tableEditTransaction.ts](../src/core/utils/contexts/tableEditTransaction.ts) and [tableEditTransaction.test.ts](../src/core/utils/contexts/tableEditTransaction.test.ts) |
| Paste planning | [tablePastePlan.ts](../src/core/utils/contexts/tablePastePlan.ts) |
| Transient cell feedback | [tableEditFeedback.ts](../src/core/utils/contexts/tableEditFeedback.ts) and [tableEditFeedback.test.ts](../src/core/utils/contexts/tableEditFeedback.test.ts) |
| Table undo journal | [tableUndoJournal.ts](../src/core/utils/contexts/tableUndoJournal.ts) and [tableUndoJournal.test.ts](../src/core/utils/contexts/tableUndoJournal.test.ts) |
| Page title parsing and rename transactions | [pageTitle.ts](../src/core/utils/contexts/pageTitle.ts) and [pageTitleRename.ts](../src/core/utils/contexts/pageTitleRename.ts) |
| Per-view display property row labels | [rowDisplayLabel.ts](../src/core/utils/contexts/rowDisplayLabel.ts) and [rowDisplayLabel.test.ts](../src/core/utils/contexts/rowDisplayLabel.test.ts) |
| Inline list row expansion | [rowExpansion.ts](../src/core/utils/contexts/rowExpansion.ts), [rowExpansion.test.ts](../src/core/utils/contexts/rowExpansion.test.ts), and [ContextListView.tsx](../src/core/react/components/SpaceView/Contexts/ContextBuilder/ContextListView.tsx) |
| Add-property menu frontmatter discovery | [allProperties.ts](../src/core/utils/properties/allProperties.ts), [allProperties.test.ts](../src/core/utils/properties/allProperties.test.ts), and [newSpacePropertyMenu.tsx](../src/core/react/components/UI/Menus/contexts/newSpacePropertyMenu.tsx) |
| Frontmatter default-column import on fresh primary contexts | [allProperties.ts](../src/core/utils/properties/allProperties.ts), [allProperties.test.ts](../src/core/utils/properties/allProperties.test.ts), and [ContextEditorContext.tsx](../src/core/react/context/ContextEditorContext.tsx) |
| Properties visibility panel (shown/hidden groups, drag reorder, eye toggles) | [propertyVisibility.ts](../src/core/utils/contexts/propertyVisibility.ts), [propertyVisibility.test.ts](../src/core/utils/contexts/propertyVisibility.test.ts), [propertyVisibilityMenu.tsx](../src/core/react/components/UI/Menus/contexts/propertyVisibilityMenu.tsx), and [FilterBar.tsx](../src/core/react/components/SpaceView/Contexts/FilterBar/FilterBar.tsx) |
| Frontmatter schema planning and safe column actions | [notidianSchema.ts](../src/core/utils/contexts/notidianSchema.ts), [notidianSchema.test.ts](../src/core/utils/contexts/notidianSchema.test.ts), [notidianSchemaApply.ts](../src/core/utils/contexts/notidianSchemaApply.ts), [notidianSchemaApply.test.ts](../src/core/utils/contexts/notidianSchemaApply.test.ts), [propertyColumnActions.ts](../src/core/utils/contexts/propertyColumnActions.ts), and [propertyColumnActions.test.ts](../src/core/utils/contexts/propertyColumnActions.test.ts) |
| Legacy context audit and migration planning | [legacyContextMigrationCore.js](../src/core/utils/contexts/legacyContextMigrationCore.js), [legacyContextMigration.ts](../src/core/utils/contexts/legacyContextMigration.ts), and [legacyContextMigration.test.ts](../src/core/utils/contexts/legacyContextMigration.test.ts) |
| Legacy context read-only report | [notidianLegacyContextAudit.js](../scripts/notidianLegacyContextAudit.js) and [notidianLegacyContextAudit.test.js](../scripts/notidianLegacyContextAudit.test.js) |
| Table styling for selection and feedback | [TableView.css](../src/css/SpaceViewer/TableView.css) |
| Real-vault smoke verification | [notidianRealVaultHarness.js](../scripts/notidianRealVaultHarness.js) and [notidianRealVaultHarness.test.js](../scripts/notidianRealVaultHarness.test.js) |
| Local vault plugin installer | [notidianInstallToVault.js](../scripts/notidianInstallToVault.js) and [notidianInstallToVault.test.js](../scripts/notidianInstallToVault.test.js) |

## Verification Commands

Run these before claiming the current implementation is healthy:

```bash
npm run verify:source
```

Use `npm run verify:source:pristine` when the working tree must be clean before
and after verification.

For local Obsidian validation after copying the built plugin into a vault:

```bash
npm run install:vault -- --vault-path="/Users/druker/Atlas Vault" --allow-write
obsidian vault="Atlas Vault" plugin:reload id=notidian
obsidian vault="Atlas Vault" dev:errors
```

For the opt-in real-vault smoke harness:

```bash
npm run test:real-vault -- vault="Atlas Vault" --allow-write
```

For the full live-vault gate, including health audit, migration dry-run,
real-vault smoke, post-smoke settle, second health audit, and Obsidian
developer-error capture:

```bash
npm run verify:live
```

Use `npm run verify:live:ui` when the live table DOM workflows should also be
exercised.

For a read-only legacy context report:

```bash
npm run audit:legacy-context -- --vault="/Users/druker/Atlas Vault" --folder="Relays & Devices"
```
