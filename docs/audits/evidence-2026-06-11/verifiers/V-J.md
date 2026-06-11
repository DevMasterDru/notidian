## Verdict
- J1: CONFIRMED
- J2: CONFIRMED
- J3: CONFIRMED, with narrowed blast radius

## Trace
J1 direct edit path:
`TextCell.onBlur` saves edited text at `src/core/react/components/SpaceView/Contexts/DataTypeView/TextCell.tsx:11-14` → `DataTypeView.saveValue` forwards to `props.updateValue` at `src/core/react/components/SpaceView/Contexts/DataTypeView/DataTypeView.tsx:51-53` → `TableView.saveValue` calls table meta `updateData` at `src/core/react/components/SpaceView/Contexts/TableView/TableView.tsx:974-994`; meta maps `updateData: updateValue` at `src/core/react/components/SpaceView/Contexts/TableView/TableView.tsx:1190-1192` → `ContextEditorContext.updateValue` builds the write at `src/core/react/context/ContextEditorContext.tsx:827-843` → `executeTableValueWrites` calls `saveDB`/`saveContextDB` at `src/core/utils/contexts/tableEditTransaction.ts:301-314` and `src/core/utils/contexts/tableEditTransaction.ts:317-377` → `saveDB`/`saveContextDB` call `spaceManager.saveTable` at `src/core/react/context/ContextEditorContext.tsx:486-496` and `src/core/react/context/ContextEditorContext.tsx:562-568` → `SpaceManager.saveTable` delegates at `src/core/spaceManager/spaceManager.ts:225-227` → `FilesystemSpaceAdapter.saveTable` calls `saveFileFragment(..., "mdbTable", ...)` at `src/core/spaceManager/filesystemAdapter/filesystemAdapter.ts:530-545` → middleware delegates at `src/core/middleware/filesystem.ts:207-212` → `MDBFileTypeAdapter.saveContent("mdbTable")` calls `saveDBToPath` at `src/adapters/mdb/mdbAdapter.ts:188-199` → `saveDBToPath` reads, replaces, exports, writes at `src/adapters/mdb/db/db.ts:349-379` → `saveDBFile` writes the target path at `src/adapters/mdb/db/db.ts:114-130` → middleware write at `src/core/middleware/filesystem.ts:265-267` → Obsidian adapter `writeBinary` at `src/adapters/obsidian/filesystem/filesystem.ts:403-407`.

J2 corrupt-reset path:
`getDBFile` returns `null` only for missing file, otherwise reads bytes at `src/adapters/mdb/db/db.ts:14-26` → `getDB` constructs SQL.js DB, catches `SELECT name FROM sqlite_schema`, and returns `new sqlJS.Database()` on error or missing file at `src/adapters/mdb/db/db.ts:28-46` → zipped variant does the same at `src/adapters/mdb/db/db.ts:49-67`; zip-load failure is swallowed at `src/adapters/mdb/db/db.ts:78-88` → later `saveDBToPath` writes the replacement DB to the original path at `src/adapters/mdb/db/db.ts:342-385`.

J3 identifier path:
Normal table creation sanitizes IDs with `sanitizeTableName` at `src/core/react/components/SpaceView/SpaceHeaderBar.tsx:61-67` and `src/core/react/components/SpaceEditor/SpaceListProperty.tsx:41-50`; table/view rename changes `schema.name`, not `schema.id`, at `src/core/react/components/SpaceEditor/SpaceListProperty.tsx:169-186` and `src/core/react/components/SpaceView/Contexts/FilterBar/ContextTitle.tsx:33-45`. But saved view IDs use only `value.replace(/ /g, "_")` at `src/core/react/components/SpaceView/Contexts/FilterBar/ListSelector.tsx:101-116` and persist through `FramesMDBContext.saveSchema` at `src/core/react/context/FramesMDBContext.tsx:109-128`. Column names from manual input use `sanitizeColumnName` at `src/core/react/components/UI/Menus/contexts/newSpacePropertyMenu.tsx:313-319`, and that sanitizer strips only double quotes/leading `_`/`$` at `src/shared/utils/sanitizers.ts:8-12`. Frontmatter-discovered property names are imported directly from keys at `src/core/utils/properties/allProperties.ts:148-162`. SQL then interpolates schema IDs and table IDs unsafely at `src/adapters/mdb/utils/mdb.ts:116-122`, `src/adapters/mdb/utils/mdb.ts:136-139`, `src/adapters/mdb/utils/mdb.ts:188-207`, and `src/adapters/mdb/db/db.ts:274-304`.

## Evidence
No Jest repro file was created; the brief allowed structural verification.

J1 safeguard search result: `Superstate` has a FIFO queue at `src/core/superstate/superstate.ts:149` and `src/core/superstate/superstate.ts:253-257`, but the traced UI save path never calls it. It is used by metadata maintenance paths such as `src/core/superstate/superstate.ts:645` and `src/core/superstate/superstate.ts:704-711`.

J2 SQL.js spot-check output:
```text
exec-error file is not a database
flipped exec-error database disk image is malformed
```
Those are exactly the errors caught by `getDB`/`getZippedDB`, which then return an empty DB.

J3 key code:
`sanitizeSQLStatement` escapes string literals only at `src/shared/utils/sanitizers.ts:2-7`; `sanitizeColumnName` removes `"` rather than escaping identifiers at `src/shared/utils/sanitizers.ts:8-12`; table/schema names are still interpolated into SQL identifier positions.

## Severity check
J1: downgrade from SEV-critical to SEV-high for overall vault safety. It can lose/corrupt Notidian MDB state, view state, explicit context-owned fields, and caches, but ordinary Markdown/frontmatter row data is not the authority here.

J2: SEV-critical holds for Notidian-owned MDB storage integrity. Scope is still `.notidian`/MDB state rather than ordinary Markdown row data, but recoverable corrupt state can be overwritten without quarantine or user warning.

J3: SEV-high holds with narrowed entry points. Normal table creation/rename is mostly guarded, but saved view IDs, legacy/imported schemas, and property names still reach unsafe SQL; outcomes include wrong rows, empty views/tables, exceptions, or silent save failure.

## Fix sketch
Add a per-MDB-path async write queue around all `saveDBToPath`/`saveZippedDBToPath` writes.

Write to `path.tmp`, verify by reopening, then adapter-rename over the target; keep a timestamped `.bak` before replacement.

Make `getDB`/`getZippedDB` return `{status: "missing"|"ok"|"corrupt"}` and block writes on corrupt unless an explicit recovery path quarantines the old file.

Replace SQL string interpolation with identifier quoting helpers that double embedded `"` and parameterized/bound values for `WHERE`.

Next step: approve implementing J1/J2 storage hardening first; J3 can follow as a smaller SQL helper cleanup.