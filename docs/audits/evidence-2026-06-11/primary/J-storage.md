## Verdict

The authority partition is mostly respected at the context save boundary, but the MDB storage layer is not yet durable enough for cloud-synced vault storage. Saves are whole-file sql.js exports written directly to the vault path, corruption is often treated as an empty database, and SQL is assembled with ad hoc quoting. Runtime `.space`/`.makemd` normalization is mostly covered for MDB binary adapter calls, but it is not a universal filesystem choke point.

## Findings

### [SEV-critical] MDB saves directly overwrite whole SQLite files without atomic replace or write conflict checks

Evidence: `src/adapters/mdb/db/db.ts:342-379`

> `const db = await getDB(plugin, sqlJS, path);`  
> `const result = replaceDB(db, tables);`  
> `await saveDBFile(plugin, path, db.export().buffer as ArrayBuffer);`

Evidence: `src/adapters/mdb/db/db.ts:114-129`

> `const file = plugin.middleware.writeBinaryToFile(path, binary);`

Evidence: `src/adapters/obsidian/filesystem/filesystem.ts:403-407`

> `await this.plugin.app.vault.adapter.writeBinary(path, buffer);`

Why it matters: every save is a read-modify-export-write of the whole `.mdb`. There is no temp-file-plus-rename, no backup, no per-path save queue, and no mtime/hash compare before overwriting. A crash or partial cloud sync can corrupt `.notidian` view/context state, and two windows/devices can lose each other’s Notidian-owned state by last writer wins.

Suggested fix direction: write to a same-directory temp file, verify it can be reopened, then rename into place; serialize writes per path; compare the source file’s mtime/hash before committing and surface a conflict instead of overwriting.

Confidence: high. Cheapest confirmation: run two concurrent `saveDBToPath` calls against the same fixture with different table fragments and inspect the surviving DB.

### [SEV-critical] Corrupt or unreadable MDB files are silently reset to empty databases

Evidence: `src/adapters/mdb/db/db.ts:34-46`

> `db.exec("SELECT name FROM sqlite_schema");`  
> `} catch { return new sqlJS.Database(); }`

Evidence: `src/adapters/mdb/db/db.ts:55-67`

> `} catch { return new sqlJS.Database(); }`

Evidence: `src/adapters/mdb/db/db.ts:377-379`

> `const result = replaceDB(db, tables);`  
> `if (result) { await saveDBFile(plugin, path, db.export().buffer as ArrayBuffer); }`

Why it matters: missing files and corrupt files collapse to the same “empty DB” behavior. Under Obsidian Sync/iCloud partial files, the next save can overwrite recoverable context/view state with a newly initialized partial database instead of quarantining the bad file.

Suggested fix direction: distinguish `missing` from `corrupt`; on corrupt reads, block writes, rename/copy the bad file to a timestamped recovery path, and notify the user with recovery instructions.

Confidence: high. Cheapest confirmation: replace a fixture `.mdb`/`.mdc` with invalid bytes and call a save path; today it will proceed from an empty sql.js DB.

### [SEV-high] SQL identifiers and schema IDs are interpolated without proper identifier quoting

Evidence: `src/adapters/mdb/utils/mdb.ts:116-122`

> `db.exec(\`SELECT * FROM m_fields WHERE schemaId = '${table}'\`)`  
> `db.exec(\`SELECT * FROM m_schema WHERE id = '${table}'\`)`

Evidence: `src/adapters/mdb/utils/mdb.ts:136-139`

> `db.exec(\`SELECT * FROM "${table}"\`)`

Evidence: `src/adapters/mdb/db/db.ts:280-283`

> `.map((f) => \`'${sanitizeSQLStatement(f)}' char\`)`  
> `const createQuery = \`CREATE TABLE IF NOT EXISTS "${t}" (${fieldQuery}); \``

Evidence: `src/shared/utils/sanitizers.ts:2-12`

> `return name?.replace(/'/g, \`''\`)`  
> `return name?.replace(/"/g, \`\`);`

Why it matters: values get single-quote escaping, but table/schema identifiers are not consistently escaped as identifiers. User-created schema/table IDs or imported legacy names containing quotes can break reads, select the wrong schema, or turn a delete/drop path into SQL corruption.

Suggested fix direction: add one `quoteIdent()` helper that doubles `"` and wraps identifiers in `"..."`; use prepared statements for values; stop building `WHERE` clauses with raw template strings.

Confidence: high. Cheapest confirmation: create a fixture schema/table id containing `'` and `"` and run `getMDBTable` plus `deleteMDBTable`.

### [SEV-high] MDB schema evolution is unversioned, and one read path mutates old DBs in place

Evidence: `src/adapters/mdb/db/db.ts:362-370`

> `CREATE TABLE m_schema ("id" char, "name" char, "type" char, "def" char, "predicate" char, "primary" char)`  
> `CREATE TABLE m_fields ("name" char, "schemaId" char, "type" char, "value" char, "hidden" char, "attrs" char, "unique" char, "primary" char)`

Evidence: `src/adapters/mdb/utils/mdb.ts:174-185`

> `if (schemas.length == 0) {`  
> `db.exec(\`CREATE TABLE IF NOT EXISTS m_schema ...\`)`  
> `await saveDBFile(plugin, dbPath, db.export().buffer as ArrayBuffer);`

Why it matters: there is no `PRAGMA user_version`, metadata table, migration registry, or backup path. Worse, `getMDBTables` can rewrite an old database during a read, so format repair happens without explicit migration state or user recovery point.

Suggested fix direction: add a `notidian_meta` or `PRAGMA user_version` version, explicit migrators, and backups; keep read APIs read-only unless called through a named migration command.

Confidence: high. Cheapest confirmation: `rg "user_version|schemaVersion|PRAGMA"` in the scoped storage files and open an old no-`m_schema` fixture through `getMDBTables`.

### [SEV-medium] Desktop and mobile local cache cleanup diverge, and debounced writes are not flushed on unload

Evidence: `src/core/superstate/superstate.ts:290-293`

> `this.persister.cleanType('space')`  
> `this.persister.cleanType('path')`  
> `this.persister.cleanType('context')`  
> `this.persister.cleanType('frame')`

Evidence: `src/adapters/mdb/localCache/localCache.ts:70-79`

> `deleteFromDB(this.db, type, \`version != '${this.indexVersion}'\`)`  
> `return;`  
> `saveZippedDBFile(... this.db.export().buffer ...)`

Evidence: `src/adapters/mdb/localCache/localCacheMobile.ts:72-77`

> `this.maps[type] = new Map(...filter(...))`  
> `this.debounceSaveSpaceDatabase(this.maps);`

Evidence: `src/main.ts:802-803`

> `onunload() { this.superstate.persister.unload(); }`

Why it matters: desktop `cleanType` removes stale rows only in memory and does not schedule a save, while mobile does. Both use debounced persistence, but unload does not flush pending cache writes, so shutdown timing can preserve stale rows or drop recent cache updates.

Suggested fix direction: make `cleanType` schedule/await persistence on both implementations; expose `flush()`/`cancel()` on persisters; call it for both superstate and filesystem cache persisters during unload.

Confidence: high. Cheapest confirmation: fake timers around `LocalStorageCache.cleanType()` and assert no write occurs before another store/remove.

### [SEV-medium] Deleted filesystem cache rows can remain in `.notidian/fileCache.mdc` and be reused

Evidence: `src/adapters/obsidian/filesystem/filesystem.ts:41-50`

> `this.cache.set(path, newCache);`  
> `this.persister.store(path,JSON.stringify(newCache), 'file');`

Evidence: `src/adapters/obsidian/filesystem/filesystem.ts:120-138`

> `const allPaths = await this.persister.loadAll('file');`  
> `const h = allPaths.find(g => g.path == f.path)`  
> `cache = {...cache, ...parsePathState(h.cache)}`

Evidence: `src/adapters/obsidian/filesystem/filesystem.ts:284-290`

> `this.fileNameWarnings.delete(file.path);`  
> `this.middleware.onDelete(tFileToAFile(file))`

Why it matters: delete events do not remove the Obsidian filesystem cache entry or its durable `fileCache.mdc` row. A later file created at the same path can inherit stale cached labels/metadata, which is misleading in a file-identity-owned database.

Suggested fix direction: on delete, remove `this.cache` and `this.persister` rows for the deleted path; on rename, remove the old durable file-cache row after storing the new path.

Confidence: high. Cheapest confirmation: persist a label for `A.md`, delete it, recreate `A.md`, reload, and inspect whether the old label returns.

### [SEV-medium] Legacy-root normalization is not a universal filesystem choke point

Evidence: `src/adapters/obsidian/legacyStorageGuard.ts:27-39`

> `around(adapter, {`  
> `readBinary: (old) => guardMethod(old, onePathArg),`  
> `writeBinary: (old) => guardMethod(old, onePathArg),`  
> `rename: (old) => guardMethod(old, twoPathArgs),`

Evidence: `src/adapters/obsidian/filesystem/filesystem.ts:387-391`

> `const newFile = this.plugin.app.vault.getAbstractFileByPath(path) as TFile`  
> `{await this.plugin.app.vault.modify(newFile, content)}`

Evidence: `src/adapters/obsidian/filesystem/filesystem.ts:449-455`

> `aFile = tFileToAFile(this.plugin.app.vault.getAbstractFileByPath(path))`

Why it matters: active MDB binary writes are guarded, but text/file-object operations can bypass the adapter wrapper when an existing `.space`/`.makemd` path resolves to a `TFile`. That leaves a path for stale callers to modify legacy storage artifacts instead of normalizing through `.notidian`.

Suggested fix direction: normalize paths at the `ObsidianFileSystem` public entry points before `getAbstractFileByPath`, not only at vault adapter methods.

Confidence: medium. Cheapest confirmation: create an existing `Folder/.space/def.json`, call `writeTextToFile("Folder/.space/def.json", ...)`, and check whether `.space` or `.notidian` changed.

### [SEV-low] Space-store migration can partially apply and walks blocked names inside a found `.space` store

Evidence: `scripts/notidianSpaceStoreMigration.js:102-120`

> `const child = await walkStore(fullPath, rootPath);`  
> `files.push(relativePath);`

Evidence: `scripts/notidianSpaceStoreMigration.js:137-140`

> `if (!entry.isDirectory()) continue;`  
> `if (shouldSkipDirectory(entry.name)) continue;`

Evidence: `scripts/notidianSpaceStoreMigration.js:298-311`

> `await fs.copyFile(sourceFile, targetFile, fs.constants.COPYFILE_EXCL);`  
> `await rewriteJsonFileStorageReferences(targetFile);`  
> `await fs.rename(store.source, store.backup);`

Why it matters: the scanner skips blocked directory names while finding `.space` roots, but once inside a `.space` root, `walkStore` does not apply the same skip. The write phase is resumable-ish, but not transaction-like; a crash can leave copied/re-written `.notidian` files beside the original `.space`.

Suggested fix direction: apply blocked-name skipping inside `walkStore`; write JSON rewrites through temp files; record per-store migration state so re-runs can distinguish resumed work from fresh work.

Confidence: high. Cheapest confirmation: dry-run a fixture `.space/nested-ignore/file.json` and inspect the generated plan.

## Swept clean

- Active context table saves strip frontmatter-backed and computed values before persistence: `src/core/spaceManager/filesystemAdapter/filesystemAdapter.ts:530-545` calls `stripFrontmatterBackedRowValues(table)`, and `src/core/utils/properties/allProperties.ts:275-299` removes columns where `shouldPersistAuthorityValueToContext` is false.
- Runtime MDB binary reads/writes through the vault adapter are covered by the legacy storage guard: `src/main.ts:580-592` installs the guard before creating/registering `MDBFileTypeAdapter`, and `src/adapters/obsidian/legacyStorageGuard.ts:27-39` wraps `readBinary`/`writeBinary`.
- Exact legacy storage setting values are normalized on load/save: `src/main.ts:169-180` and `src/main.ts:781-795` rewrite `.space`/`.makemd` `spaceSubFolder` values to `.notidian`.
- The migration planner refuses known content conflicts before write: `scripts/notidianSpaceStoreMigration.js:263-280` computes `ok`, and `scripts/notidianSpaceStoreMigration.js:283-289` refuses writes when conflicts exist.

## Improvement paths

1. Recommended next step: fix physical durability first: atomic temp-write/rename, corrupt-file quarantine, per-path save queues, and stale-source conflict detection.
2. Replace SQL string assembly with shared identifier quoting and prepared value binding, then add fixtures for quoted/unicode schema, table, and column names.
3. Add explicit MDB/cache schema versions plus migration tests, then make cache cleanup/delete/rename invalidation identical across desktop and mobile.