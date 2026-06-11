## Verdict

Authority enforcement is solid in the main table editing path, but it is not yet system-wide. `saveTable` persistence generally strips `source: "frontmatter"` and computed row values, and table cell/paste/undo writes use `executeTableValueWrites`; however several active UI/API surfaces still write frontmatter or context rows directly. The biggest risk is not the adapter boundary, but older write/read helpers that bypass source-aware transaction semantics before data reaches that boundary.

## Findings

### [SEV-high] Context reload can persist frontmatter values into unmarked Notidian-owned columns

Evidence: `src/core/utils/contexts/linkContextRow.ts:92-108`

> `const frontmatter = (paths.get(resolvedPath)?.metadata?.property ?? {});`  
> `.filter(f => fieldsByName.has(f) && f != PathPropertyName)`  
> `return { ..._row, ...filteredFrontmatter, ...tagData }`

Evidence: `src/core/superstate/cacheParsers.ts:78-83`, `src/core/superstate/superstate.ts:795-797`

> `rows = rows.map(f => syncContextRow(pathsIndex, f, cols, spacePath))`  
> `await this.spaceManager.saveTable(path, cache.contextTable);`

Evidence: `src/core/utils/properties/propertyAuthority.ts:30-34`

> `return authority === "file" || authority === "notidian";`

Why it matters: a legacy/custom column with no `source: "frontmatter"` but the same name as a YAML key is treated as Notidian-owned by the stripper, yet `syncContextRow` overlays the frontmatter value and `contextReloaded` can save it back into MDB. That silently duplicates ordinary metadata into durable context row data.

Suggested fix direction: make `syncContextRow` overlay frontmatter only for columns whose authority is frontmatter, plus explicit tag/file projections. Leave unmarked legacy columns untouched and route candidate cleanup through the legacy audit/migration planner.

Confidence: high. Cheapest confirmation: create or inspect a context with an unmarked `status` column and a note with `status` frontmatter, then reload and inspect the saved MDB row.

### [SEV-high] Create/edit item modal can persist `File` row identity without the rename transaction

Evidence: `src/core/react/components/UI/Modals/ContextCreateItemModal.tsx:300-307`

> `if (isEdit) { handleFieldChange(PathPropertyName, newTitle); }`

Evidence: `src/core/react/components/UI/Modals/ContextCreateItemModal.tsx:154-160`

> `if (isEdit) { ... updateRow(updatedItem, rowIndex); }`

Evidence: `src/core/react/context/ContextEditorContext.tsx:759-768`

> `rows: tableData.rows.map((r, i) => i == index ? { ...r, ...row } : r)`

Why it matters: editing the title field in the modal goes through `updateRow`, not `renamePageTitleForRow`. `PathPropertyName` is durable context row identity, so this can save a detached path/name into MDB before or without a controlled file rename.

Suggested fix direction: never pass `PathPropertyName` through `updateRow`. Modal title edits should call the same page-title rename transaction used by table cells, with the same duplicate/slash/empty preflight.

Confidence: high. Cheapest confirmation: edit an existing modal title, blur without completing save, and inspect the context row path.

### [SEV-high] Non-table layouts bypass stale frontmatter conflict detection through `updateRow`

Evidence: `src/core/react/context/ContextEditorContext.tsx:737-758`

> `const frontmatterChanges = changedCols.reduce(...)`  
> `saveFrontmatterProperties({ ... path: currentData?.[PathPropertyName], properties: frontmatterChanges })`

Evidence: `src/core/react/components/SpaceView/Contexts/ContextListContainer.tsx:226-232`, `250-254`, `269-273`

> `insertItem={(row: DBRow) => { updateRow(row, -1); }}`  
> `updateItem={(row: DBRow) => { updateRow(row, parseInt(row._index)); }}`

Evidence: `src/core/react/components/SpaceView/Contexts/CalendarView/DayView/DayView.tsx:348-360`

> `props.updateItem({ ...props.data[index], [props.field]: ..., [props.fieldEnd]: ... });`

Why it matters: calendar day/week/month updates and modal autosave write frontmatter-backed values without `executeTableValueWrites`’ current-value comparison. A stale calendar/list/modal view can overwrite newer YAML edits that the table path would skip as `frontmatter-conflict`.

Suggested fix direction: replace `updateRow` frontmatter handling with a row-level wrapper around `executeTableValueWrites`, preserving row creation separately.

Confidence: high. Cheapest confirmation: edit a date property externally while calendar is open, then drag the calendar item and observe whether the newer YAML value is overwritten.

### [SEV-high] Note context properties panel writes every context property to frontmatter and context rows directly

Evidence: `src/core/react/components/SpaceView/Contexts/SpaceEditor/HeaderPropertiesView.tsx:295-313`

> `saveProperties(props.superstate, pathState.path, { [field.property.name]: ... })`  
> `updateContextValue(... field.property.name, value)`

Evidence: `src/core/react/components/SpaceView/Contexts/SpaceEditor/HeaderPropertiesView.tsx:315-335`

> `saveProperties(... { [field.property.name]: ... })`  
> `spaceManager.saveSpaceProperty(...)`

Why it matters: this path does not check `source`, `propertyAuthorityForColumn`, or current canonical frontmatter. It writes Notidian-owned context fields into YAML, writes frontmatter-backed fields without the stale gate, and mirrors values into context helpers that rely on later stripping.

Suggested fix direction: split note-panel edits by authority: frontmatter-backed fields use the conflict-aware transaction path; Notidian-owned fields update only context MDB; computed/file fields stay read-only.

Confidence: high. Cheapest confirmation: edit a frontmatter-backed field from the note header properties panel after changing the YAML elsewhere.

### [SEV-high] Dragging grouped list items writes frontmatter without conflict detection

Evidence: `src/core/react/components/SpaceView/Contexts/ContextBuilder/ContextListInstance.tsx:232-244`

> `if (groupValueMismatch) { saveProperties(props.superstate, activePath, { [props.props?._groupField]: props.props?._groupValue }); }`

Why it matters: grouped list/board-style drag changes a grouping property directly in frontmatter. If the group field is frontmatter-backed ordinary metadata, this bypasses stale compare and table feedback entirely.

Suggested fix direction: convert group drag into a `TableCellWrite` for the group field and execute it through `applyValueEdits` or a shared authority-aware row write API.

Confidence: high. Cheapest confirmation: group by a frontmatter field, externally change that field, then drag the card to another group.

### [SEV-high] Action/API write paths expose raw context and frontmatter writes

Evidence: `src/core/superstate/api.ts:41-47`

> `if (property.startsWith("$contexts")) { ... this.context.update(context, path, prop, value) }`

Evidence: `src/core/superstate/api.ts:235-239`, `src/core/utils/contexts/context.ts:394-411`

> `updateValueInContext(this.spaceManager as SpaceManager, file, field, value, space.space)`  
> `return {...mdb, rows: mdb.rows.map(f => ... ({...f, [field]: value}) ... )}`

Evidence: `src/core/superstate/commands.ts:700-708`, `1004-1012`

> `id: 'context.update'`  
> `result = await namespaceMethods[method](...command.fields.map(...))`

Why it matters: frame/actions and API commands can update context rows directly. For frontmatter-backed columns, persistence stripping can make the write disappear; for unmarked ordinary columns, it can create hidden durable MDB row data.

Suggested fix direction: make `api.context.update` authority-aware by resolving the target column and delegating to the same transaction path, or restrict it to explicit Notidian-owned fields.

Confidence: high. Cheapest confirmation: run an API action against a frontmatter-backed field and inspect both YAML and MDB after reload.

### [SEV-medium] New item modal writes typed properties to the bare title, not the created path

Evidence: `src/core/react/components/UI/Modals/ContextCreateItemModal.tsx:227-243`

> `await props.superstate.api.path.create(itemName, source, "md", "")`  
> `await props.superstate.api.path.setProperty(itemName, key, value)`

Evidence: `src/core/superstate/api.ts:98-105`, `106-117`

> `return newPathInSpace(... space ..., name, true, content)`  
> `saveProperties(this.superstate, path, { [property]: value })`

Why it matters: `path.create` creates in the context source and returns the created path, but the modal ignores that return value and sets properties on `itemName`. In folder contexts, typed values can be dropped or written to the wrong path.

Suggested fix direction: capture the path returned from `api.path.create` and set properties on that resolved path, preferably in one authority-aware creation transaction.

Confidence: high. Cheapest confirmation: create a modal item in a non-root folder with a filled property and inspect the new file’s YAML.

### [SEV-medium] Display-property labels can be shadowed by unknown persisted MDB row keys

Evidence: `src/core/utils/properties/allProperties.ts:293-299`

> `const column = colsByName.get(key);`  
> `if (column && nonPersistentColumns.has(key)) return next;`  
> `return { ...next, [key]: row[key] };`

Evidence: `src/core/utils/contexts/rowDisplayLabel.ts:24-35`

> `const fromRow = rowDisplayLabelOverride(row, displayProperty);`  
> `if (fromRow != null) return fromRow;`  
> `const fmValue = pathState?.metadata?.property?.[displayProperty];`

Evidence: `src/core/react/components/SpaceView/Contexts/FilterBar/FilterBar.tsx:650-659`

> `Frontmatter keys that were never persisted as columns are equally valid display properties`

Why it matters: unknown row keys are preserved by the stripper. If a legacy MDB row contains `displayProperty` and the file also has frontmatter with that key, the display label reads the row value first.

Suggested fix direction: for display properties discovered from frontmatter, prefer `pathState.metadata.property` over row data, or strip unknown row keys that match discovered frontmatter keys after migration review.

Confidence: medium. Cheapest confirmation: seed a row with an unknown `label` key and a file with `label` frontmatter, then select `label` as display property.

## Swept clean

- Main persistence primitive: `SpaceManager.saveTable` delegates to `FilesystemSpaceAdapter.saveTable`, which calls `stripFrontmatterBackedRowValues` before `saveFileFragment` (`src/core/spaceManager/spaceManager.ts:225-227`, `src/core/spaceManager/filesystemAdapter/filesystemAdapter.ts:530-545`).
- Strip implementation: frontmatter and computed columns are non-persistent because `shouldPersistAuthorityValueToContext` returns true only for `file` and `notidian` (`src/core/utils/properties/allProperties.ts:275-304`, `src/core/utils/properties/propertyAuthority.ts:12-20`, `30-34`).
- No direct non-test caller of `fileSystem.saveFileFragment(..., "mdbTable", ...)` was found outside `FilesystemSpaceAdapter.saveTable`; the lower `mdbAdapter.saveContent("mdbTable")` lacks stripping, but appears reached through the adapter boundary.
- Table cell edits, option edits, paste, cut, clear, undo, redo, and conflict “Apply anyway” route through `updateValue` / `updateFieldValue` / `applyTableEdits` into `executeTableValueWrites`.
- Table page-title edits and title paste route through `renamePageTitleForRow` / `executeBulkPageTitleRename`, not ordinary value writes.
- Column visibility, order, freeze, filter, sort, and display-property settings use `savePredicate`; they do not write ordinary row metadata.
- Frontmatter-backed column deletion is hide-only via `planPropertyColumnDelete`; the delete menu is suppressed for frontmatter-backed fields.
- Frontmatter key rename uses a planner, confirmation, re-plan, frontmatter set-before-delete, and `saveDB` reload path; it is substantially safer than the raw value paths above.

## Improvement paths

1. Replace `updateRow`, grouped-drag writes, header context property edits, and API context updates with one authority-aware row/value write service.
2. Make context materialization source-aware: only `source: "frontmatter"` columns should overlay YAML into rows, and legacy candidate cleanup should stay audit-driven.
3. Add static or unit-test coverage that fails on raw `saveProperties` / `updateContextValue` use from database UI surfaces unless the caller proves it is canonical single-file metadata, not context table data.