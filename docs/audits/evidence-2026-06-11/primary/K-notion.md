## Verdict

The table layout is the strongest and closest to the stated Notidian authority model: direct cell edits, paste, undo, row ordering, and page-title renames have an explicit transaction path that preserves Markdown/frontmatter authority. The wider Notion-parity surface is much thinner: list/board/cards/gallery/flow are frame presets over shared list code, and calendar/edit-modal paths still bypass the table transaction guarantees. The highest-risk gaps are not missing features; they are feature paths that look database-like but write through legacy or partial code.

## Findings

### [SEV-high] New folder-table properties default to hidden MDB ownership

Evidence:

- `src/core/react/components/UI/Menus/contexts/newSpacePropertyMenu.tsx:49-52`
  > `const [fieldSource, setFieldSource] = useState<string>(props.fileMetadata ? "$fm" : "");`

- `src/core/react/components/UI/Menus/contexts/newSpacePropertyMenu.tsx:100-103`
  > `fieldSource == "$fm" && !props.isSpace ? frontmatterPropertySource : fieldSource`

- `src/core/react/context/ContextEditorContext.tsx:1356-1363`
  > `newTable.cols = [...newTable.cols, ...newFields];`

- `src/core/utils/contexts/tableEditTransaction.ts:227-230`
  > `const writesFrontmatter = isDefaultSchema && shouldWritePropertyToFrontmatter(column);`

Why it matters: in a Markdown-folder database, ordinary user-created properties should normally become frontmatter-backed. The default “new property” path creates a column without `source: frontmatter`, so future edits are Notidian-owned MDB row data unless the user explicitly chooses discovered frontmatter metadata.

Suggested fix direction: make default-schema new properties frontmatter-backed by default. Keep MDB-owned fields as an explicit advanced option with UI copy that says the field is Notidian-only.

Confidence: high. Cheapest confirmation: create a new property from a folder table, edit a row, and inspect whether YAML or `.notidian` row data changes.

### [SEV-high] Grouped list/board/card drag writes the wrong frontmatter key and bypasses transactions

Evidence:

- `src/core/react/components/SpaceView/Contexts/ContextBuilder/ContextListView.tsx:78-81`
  > `groupBy = cols.find((f) => f.name + f.table == predicate.groupBy[0]);`

- `src/core/react/components/SpaceView/Contexts/ContextBuilder/ContextListView.tsx:326-330`
  > `_groupValue: c, _groupField: groupBy`

- `src/core/react/components/SpaceView/Contexts/ContextBuilder/ContextListInstance.tsx:232-245`
  > `saveProperties(props.superstate, activePath, { [props.props?._groupField]: props.props?._groupValue })`

- `src/core/react/components/SpaceView/Contexts/ContextBuilder/ContextListInstance.tsx:255-266`
  > `updateTableValue(..., props.props?._groupField, props.props?._groupValue)`

Why it matters: `_groupField` is the full column object, not a field name. As an object key, it can become `"[object Object]"` in frontmatter instead of updating the intended grouped property. This affects board/list/card-style grouped drag, which users reasonably expect to be Notion-like group editing.

Suggested fix direction: pass a stable column identifier such as `groupBy.name`, then route grouped drag writes through the same table edit transaction layer used by table cells.

Confidence: high. Cheapest confirmation: drag a default-schema row between groups and inspect the Markdown file’s frontmatter for an unintended `"[object Object]"` key.

### [SEV-high] Calendar edits bypass stale-frontmatter conflict checks

Evidence:

- `src/core/react/components/SpaceView/Contexts/ContextListContainer.tsx:227-232`
  > `insertItem={(row) => updateRow(row, -1)} updateItem={(row) => updateRow(row, parseInt(row._index))}`

- `src/core/react/components/SpaceView/Contexts/TableView/DayView.tsx:327-360`
  > `props.updateItem({ ...props.data[index], [props.field]: ..., [props.fieldEnd]: ... })`

- `src/core/react/context/ContextEditorContext.tsx:751-758`
  > `saveFrontmatterProperties({ path: currentData?.[PathPropertyName], properties: frontmatterChanges })`

- `src/core/utils/contexts/tableEditTransaction.ts:241-260`
  > `if (!valuesEqual(canonical, expectedBase)) { ... status: "frontmatter-conflict" }`

Why it matters: table cell edits compare the current YAML value against the expected base before writing; calendar drag/resize/repeat edits write frontmatter directly through `updateRow`. A calendar move can silently overwrite a Markdown property changed outside the current table snapshot.

Suggested fix direction: make calendar insert/update build `TableValueWrite` operations and call `executeValueWrites`, then surface skipped/conflicted edits in the calendar UI.

Confidence: high. Cheapest confirmation: simulate stale `pathsIndex` data, drag a calendar event, and check whether the external YAML change is overwritten.

### [SEV-medium] Non-table database layouts are frame presets, not full authority-aware database views

Evidence:

- `src/core/react/components/SpaceView/Contexts/FilterBar/FilterBar.tsx:297-403`
  > `table`, `list`, `details`, `board`, `cards`, `catalog`, `gallery`, `flow`, `day`, `week`, `month`

- `src/core/react/components/SpaceView/Contexts/FilterBar/FilterBar.tsx:404-420`
  > `view: value.view ?? "list", listView: value.listView ?? "", listGroup: value.listGroup`

- `src/core/react/components/SpaceView/Contexts/ContextListContainer.tsx:277-329`
  > `<ContextListView ... viewType={props.viewType} ... />`

Why it matters: board/cards/gallery/flow exist and are selectable, but they share the same frame/list renderer rather than having layout-specific database semantics. That makes Notion-parity features such as safe group drag, per-view field editing, empty-state creation, and layout-specific affordances uneven.

Suggested fix direction: introduce a shared database-layout write adapter underneath non-table views, then add layout-specific affordances on top of that adapter.

Confidence: high. Cheapest confirmation: switch a folder database through board/cards/gallery/flow and trace all row mutation paths; they converge on list/frame code, not the table transaction layer.

### [SEV-medium] Relations and rollups remain context-table machinery, not frontmatter-link database features

Evidence:

- `docs/current-state.md:42-43`
  > `Relation-like behavior currently remains in the Notidian context model...`

- `src/core/utils/properties/propertyTypeMenu.ts:8-17`
  > `frontmatterPropertyTypes = ["text", "number", "boolean", "option", "date", "file"]`

- `src/core/utils/properties/propertyTypeMenu.ts:54-57`
  > `!["context", "contextformula", "aggregate"].includes(f.type)`

- `src/core/react/components/SpaceView/Contexts/ContextBuilder/linkContextRow.ts:146-170`
  > `const relationshipFields = fields.filter((f) => f.type.startsWith("context"))`

Why it matters: Notion-style relations and rollups over Markdown links/frontmatter are a top user-facing gap. The dormant machinery is useful, but it is built around Notidian context relationships and aggregates, not canonical frontmatter links.

Suggested fix direction: design relation fields as frontmatter link/list properties first, then adapt existing relation/aggregate UI only where it can read from canonical Markdown data.

Confidence: high. Cheapest confirmation: create a frontmatter link property and verify that relation/rollup UI does not treat it as a relation source.

### [SEV-medium] Row creation modal ignores database templates

Evidence:

- `src/core/react/components/SpaceView/Contexts/ContextCreateItemModal.tsx:227-232`
  > `api.path.create(itemName, source, "md", "")`

- `src/core/superstate/utils/spaces.ts:241-248`
  > `setTemplateInSpace` and `setTemplateNameInSpace`

Why it matters: per-database templates are a major Notion workflow feature. Notidian has folder/space template metadata helpers, but the scoped row creation modal creates an empty Markdown file and applies properties afterward.

Suggested fix direction: resolve the active database template before `path.create`, render its Markdown body, then apply default frontmatter through the same authority-aware property write path.

Confidence: medium. Cheapest confirmation: set a folder/space template, create a row through `ContextCreateItemModal`, and inspect whether the new file body uses the template.

### [SEV-medium] Legacy edit modal can mutate page identity through row data instead of the rename transaction

Evidence:

- `src/core/react/components/SpaceView/Contexts/ContextCreateItemModal.tsx:154-161`
  > `if (isEdit && updateRow && rowIndex !== undefined) { updateRow(updatedItem, rowIndex); }`

- `src/core/react/components/SpaceView/Contexts/ContextCreateItemModal.tsx:299-307`
  > `handleFieldChange(PathPropertyName, newTitle)`

- `src/core/react/components/SpaceView/Contexts/TableView/rowContextMenu.tsx:39-50`
  > `if (schema.id == defaultContextSchemaID && row[PathPropertyName]) { ... return; }`

- `src/core/superstate/api.ts:211-224`
  > `this.openPath("magicbox", { props: { schema, file, index } })`

Why it matters: ordinary primary-row context menus avoid this path, but the API/modal path is still reachable. Editing the title in that modal calls `updateRow` with `PathPropertyName`, not the table page-title rename transaction, risking detached row identity behavior.

Suggested fix direction: disable page-title editing in this modal for default-schema Markdown rows, or route it through `applyTableEdits` page-title rename handling.

Confidence: medium. Cheapest confirmation: invoke `api.table.editModal` for a default-schema row and edit the title field; inspect whether the file is renamed or only row data changes.

### [SEV-low] Quick find is row filtering only, not Notion-style in-table find

Evidence:

- `src/core/react/components/SpaceView/Contexts/FilterBar/SearchBar.tsx:30-35`
  > `onChange={(e) => props.setSearchString(e.currentTarget.value)}`

- `src/core/react/context/ContextEditorContext.tsx:639-648`
  > `resultData = resultData.filter((f) => matchAny(searchString, Object.values(f)))`

Why it matters: the existing search is useful, but it hides non-matching rows rather than navigating matches in the current table. Users coming from Notion expect find-next, highlighted cells, and no destructive change to row visibility.

Suggested fix direction: keep row filtering, but add a separate in-table find mode with highlighted matches and previous/next navigation.

Confidence: high. Cheapest confirmation: search a table and verify there is no cell-level highlight or next/previous navigation state.

## Swept clean

- Table cell writes are authority-aware in the main table path. `ContextEditorContext.tsx:772-806` calls `executeTableValueWrites`, and `tableEditTransaction.ts:283-299` saves frontmatter before root/context table persistence.
- Table persistence strips frontmatter-backed and computed row values before durable MDB writes. `filesystemAdapter.ts:530-545` calls `stripFrontmatterBackedRowValues`, and `allProperties.ts:275-303` removes non-persistent values.
- Page-title rename is correctly treated as file identity in the table transaction path. `ContextEditorContext.tsx:853-908` separates file writes from value writes before applying table saves.
- Saved multi-view switching exists. `ListSelector.tsx:92-117` selects and creates saved views, and `ListSelector.tsx:152-174` renders view crumbs plus creation affordance.
- View option persistence exists for layout settings. `FilterBar.tsx:404-420` writes layout choices into the predicate/view configuration.
- Frontmatter-backed property type selection is constrained away from context/aggregate fields. `propertyTypeMenu.ts:54-57` excludes relation/aggregate types from frontmatter-backed menus.
- Inline list expansion state is intentionally ephemeral. `docs/current-state.md:102-108` says expanded child rows are session/view state and not durable schema or row data.
- No builds, test suite, or write commands were run, per the read-only auditor brief.

## Improvement paths

Top-10 roadmap ranked for a single-user Obsidian database vault:

| Rank | Improvement | Dormant machinery | Safe to wire directly? | Size |
|---:|---|---|---|---|
| 1 | Make new folder-table properties frontmatter-backed by default | New property menu, schema planner | Yes, with explicit MDB-owned escape hatch | S |
| 2 | Route all non-table edits through table transactions | `executeTableValueWrites`, `applyTableEdits` | Yes | M |
| 3 | Fix grouped board/list/card drag between groups | Existing grouping and drag handlers | Yes, after using field IDs and transaction writes | S-M |
| 4 | Add frontmatter-link relations and rollups | Legacy context relation/aggregate UI | Not directly; needs new authority mapping | L |
| 5 | Add per-database templates for row creation | Space template metadata, create modal | Partly | M |
| 6 | Add sub-items using a canonical frontmatter parent/link property | Inline expansion UI only | Mostly greenfield | M-L |
| 7 | Improve date UX with reminders and stronger recurring event handling | Date cells, day/week/month views, repeat field | Partly | M |
| 8 | Add in-table quick find with highlighted cell navigation | Existing SearchBar row filter | Yes | S |
| 9 | Add CSV/Markdown folder import-export workflows | Clipboard/table parsing pieces | Mostly greenfield | M |
| 10 | Add comments/select-to-comment annotations | Planned in docs, little scoped code found | Greenfield | L |

Next step: queue the first three roadmap items as correctness work before investing in larger Notion-parity features.