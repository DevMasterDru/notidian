## Verdict
CONFIRMED: F1, F2, F3, F5.

## Trace
- F1: title-cell rename can start at [TableView.tsx](/Users/druker/Projects/Notidian/src/core/react/components/SpaceView/Contexts/TableView/TableView.tsx:974), flow through [ContextEditorContext.tsx](/Users/druker/Projects/Notidian/src/core/react/context/ContextEditorContext.tsx:853), then `renamePath` at [pageTitleRename.ts](/Users/druker/Projects/Notidian/src/core/utils/contexts/pageTitleRename.ts:457), [spaceManager.ts](/Users/druker/Projects/Notidian/src/core/spaceManager/spaceManager.ts:298), [filesystemAdapter.ts](/Users/druker/Projects/Notidian/src/core/spaceManager/filesystemAdapter/filesystemAdapter.ts:239), and Obsidian rename at [filesystem.ts](/Users/druker/Projects/Notidian/src/adapters/obsidian/filesystem/filesystem.ts:415). External renames also reach `onPathRename` via [spaceManager.ts](/Users/druker/Projects/Notidian/src/core/spaceManager/spaceManager.ts:85).
- F1 fires only after `oldFileCache` exists, then contexts whose `contextCache.outlinks.includes(oldPath)` are queued at [superstate.ts](/Users/druker/Projects/Notidian/src/core/superstate/superstate.ts:614) and [superstate.ts](/Users/druker/Projects/Notidian/src/core/superstate/superstate.ts:639). The helper path is [context.ts](/Users/druker/Projects/Notidian/src/core/utils/contexts/context.ts:517) -> [links.ts](/Users/druker/Projects/Notidian/src/core/utils/contexts/links.ts:42). Values reaching `replaceLinkInValue` are MDB multi strings parsed by [parsers.ts](/Users/druker/Projects/Notidian/src/utils/parsers.ts:8), and the corrupt map is at [links.ts](/Users/druker/Projects/Notidian/src/core/utils/contexts/links.ts:13). `linkColumns` checks type only, not `source`, at [links.ts](/Users/druker/Projects/Notidian/src/core/utils/contexts/links.ts:21).
- F2: tag add/remove UI reaches [TagCell.tsx](/Users/druker/Projects/Notidian/src/core/react/components/SpaceView/Contexts/DataTypeView/TagCell.tsx:51) and [TagCell.tsx](/Users/druker/Projects/Notidian/src/core/react/components/SpaceView/Contexts/DataTypeView/TagCell.tsx:60), then [tags.ts](/Users/druker/Projects/Notidian/src/core/superstate/utils/tags.ts:13), [spaceManager.ts](/Users/druker/Projects/Notidian/src/core/spaceManager/spaceManager.ts:406), [filesystemAdapter.ts](/Users/druker/Projects/Notidian/src/core/spaceManager/filesystemAdapter/filesystemAdapter.ts:985), [filesystem.ts](/Users/druker/Projects/Notidian/src/adapters/obsidian/filesystem/filesystem.ts:67), and `addTagToProperties` at [tags.ts](/Users/druker/Projects/Notidian/src/adapters/obsidian/utils/tags.ts:72). `readProperties` projects frontmatter through [markdownAdapter.ts](/Users/druker/Projects/Notidian/src/adapters/obsidian/filetypes/markdownAdapter.ts:410); `parseProperty("tags", ["foo","bar"])` serializes arrays at [parsers.ts](/Users/druker/Projects/Notidian/src/utils/parsers.ts:21) and [serializers.ts](/Users/druker/Projects/Notidian/src/utils/serializers.ts:2). The tag helper then comma-splits that string at [tags.ts](/Users/druker/Projects/Notidian/src/adapters/obsidian/utils/tags.ts:156).
- F3: frontmatter rename apply wires `deleteProperty` at [ContextEditorContext.tsx](/Users/druker/Projects/Notidian/src/core/react/context/ContextEditorContext.tsx:1187), awaits `spaceManager.deleteProperty`, then returns `{ ok: true }` at [ContextEditorContext.tsx](/Users/druker/Projects/Notidian/src/core/react/context/ContextEditorContext.tsx:1196). `spaceManager.deleteProperty` returns the adapter at [spaceManager.ts](/Users/druker/Projects/Notidian/src/core/spaceManager/spaceManager.ts:369), but the filesystem adapter drops `deleteFileFragment` at [filesystemAdapter.ts](/Users/druker/Projects/Notidian/src/core/spaceManager/filesystemAdapter/filesystemAdapter.ts:821). Downstream, `applyFrontmatterSchemaWritePlans` increments `applied` after the wrapper result at [notidianSchemaApply.ts](/Users/druker/Projects/Notidian/src/core/utils/contexts/notidianSchemaApply.ts:55).
- F5: Delete/Backspace calls `clearCell` at [TableView.tsx](/Users/druker/Projects/Notidian/src/core/react/components/SpaceView/Contexts/TableView/TableView.tsx:910), which calls `pasteSelection("")` at [TableView.tsx](/Users/druker/Projects/Notidian/src/core/react/components/SpaceView/Contexts/TableView/TableView.tsx:776). Empty clipboard becomes `[[""]]` at [tableClipboard.ts](/Users/druker/Projects/Notidian/src/core/utils/contexts/tableClipboard.ts:6), then a normal write at [tablePastePlan.ts](/Users/druker/Projects/Notidian/src/core/utils/contexts/tablePastePlan.ts:215). Real parse wiring is [ContextEditorContext.tsx](/Users/druker/Projects/Notidian/src/core/react/context/ContextEditorContext.tsx:785); coercion is [properties.ts](/Users/druker/Projects/Notidian/src/utils/properties.ts:134). `processFrontMatter` receives and assigns those coerced values at [markdownAdapter.ts](/Users/druker/Projects/Notidian/src/adapters/obsidian/filetypes/markdownAdapter.ts:476).

## Evidence
Repro test: [codex-yaml-fidelity.audit.test.ts](/Users/druker/Projects/Notidian/src/core/utils/contexts/__audit__/codex-yaml-fidelity.audit.test.ts:17)

Command run:
```text
npx jest src/core/utils/contexts/__audit__/codex-yaml-fidelity.audit.test.ts --runInBand
PASS src/core/utils/contexts/__audit__/codex-yaml-fidelity.audit.test.ts
✓ F1 corrupts unrelated links while renaming a two-link value
✓ F1 writes every renamed link/context column through saveProperties, including frontmatter-backed columns
✓ F2 mangles a projected YAML tags array when adding a tag
✓ F3 counts a frontmatter deletion as applied before the adapter deletion completes
✓ F5 coerces clear-cell empty strings through the real ContextEditor parseValue wiring
Test Suites: 1 passed, 1 total
Tests: 5 passed, 5 total
```

## Severity check
F1 critical holds: a normal file rename can corrupt unrelated links and bypass frontmatter authority.

F2 critical holds for tag rename/bulk tag operations; for a single add/remove it is high, but the helper is shared by broader tag flows.

F3 high holds: schema apply can report success before deletion completes or fails, leaving duplicate/old frontmatter keys.

F5 high holds for boolean/number clears: clear overwrites `true` to `false` and number to `NaN`; multi-select becomes an explicit empty array.

## Fix sketch
Fix `replaceLinkInValue` so non-matching entries return `f`, not `link`, and await/batch link rename writes.

Route link/context maintenance through authority-aware helpers; skip or correctly frontmatter-write `source: "frontmatter"` columns.

Make `deleteProperty` return a real `Promise` result from `deleteFileFragment`; treat false/undefined/rejection as schema apply failure.

Add explicit clear semantics: frontmatter clears should delete/unset scalar keys instead of parsing `""` through type coercion.

Use the new audit repro as the first regression check while implementing the fixes.