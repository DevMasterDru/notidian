## Verdict

Performance is workable for small and moderate vaults, but this dimension is not yet sound for 10k-file vaults or 1k-5k row table workflows. The architecture avoids durable row-data corruption in the paths examined, but scalability is limited by full-vault startup scans, repeated frontmatter discovery, full-table row derivation before pagination, pagination-only rendering, and full sql.js database exports. No critical/high data-loss performance finding was found; the dominant risk is UI stalls and event-storm latency.

## Findings

### [SEV-medium] Startup performs full-vault cache warming with an O(files × cachedRows) join

Evidence: `src/main.ts:193-199`

> `await this.superstate.initializeIndex()`  
> `this.obsidianAdapter.loadCacheFromObsidianCache();`

Evidence: `src/adapters/obsidian/filesystem/filesystem.ts:113-120`

> `this.vaultDBCache = getAllAbstractFilesInVault(this.plugin.app).map(file => ({`  
> `const allPaths = await this.persister.loadAll('file');`

Evidence: `src/adapters/obsidian/filesystem/filesystem.ts:123-159`

> `this.vaultDBCache.forEach(f => {`  
> `const h = allPaths.find(g => g.path == f.path)`  
> `await Promise.all(this.vaultDBCache.map(f => this.middleware.createFileCache(f.path)));`

Why it matters: on a 10k-file vault with a 10k-row persisted file cache, the `find` inside `forEach` is roughly 100M path comparisons before the full `createFileCache` pass starts. This directly affects plugin load.

Suggested fix direction: convert `allPaths` to a `Map<path,row>` before the loop, chunk `createFileCache`, and skip unchanged cache entries by mtime/version.

Confidence: high. Cheapest confirmation: add counters/timers around `loadCacheFromObsidianCache` with a synthetic 10k-row persisted cache.

### [SEV-medium] Full path indexing is repeated after cache load and has paths × spaces behavior

Evidence: `src/core/superstate/superstate.ts:492-504`

> `const allFiles = this.spaceManager.allPaths()`  
> `await this.indexer.reload<{[key: string]: {cache: PathState, changed: boolean}}>({ type: 'paths', path: ''})`

Evidence: `src/core/spaceManager/spaceManager.ts:149-157`

> `for (const key of keys) {`  
> `const cache = await this.readPathCache(key);`  
> `caches.set(key, cache);`

Evidence: `src/core/superstate/cacheParsers.ts:336-338`

> `for (const [s, space] of spacesCache) {`  
> `evalSpace(s, space);`

Why it matters: plugin load does not merely hydrate persisted state; it rereads every path cache, then `parseMetadata` evaluates every space for every path. Large vaults with many folder/tag spaces can grow toward O(files × spaces).

Suggested fix direction: keep an incremental dirty-path queue; precompute space join predicates and parent/tag membership maps; avoid full `paths` reload unless cache version/schema changes.

Confidence: high. Cheapest confirmation: log `allFiles.length`, `spacesCache.size`, and total `evalSpace` calls during startup.

### [SEV-medium] Search reindex “debounce” does not coalesce bursts and rebuilds a full Fuse index

Evidence: `src/core/superstate/superstate.ts:234-240`

> `this.eventsDispatcher.addListener('pathStateUpdated', () => {`  
> `debounce(() => this.reindexSearch(), 300)();`  
> `})`

Evidence: `src/core/superstate/superstate.ts:160-163`

> `this.indexer.reload<Record<string, unknown>>({ type: 'index', path: ''}).then(r => {`  
> `this.searchIndex = Fuse.parseIndex(r as any);`

Evidence: `src/core/superstate/workers/indexer/impl.ts:42-48`

> `const items = [...payload.pathsIndex.values()].filter(f => f.hidden == false)`  
> `return Fuse.createIndex(options.keys, items).toJSON();`

Why it matters: because a new debounced function is created per event, metadata bursts can schedule many full-index rebuilds instead of one. A bulk paste or file sync storm can repeatedly rebuild Fuse over all visible paths.

Suggested fix direction: create one stable debounced `reindexSearch` function on the instance, and add dirty-path or thresholded rebuild logic.

Confidence: high. Cheapest confirmation: fire 100 `pathStateUpdated` events and count `indexer.reload({type:'index'})` calls.

### [SEV-medium] Table open derives full row data before pagination, with O(rows²) and O(rows × linkedContexts) pieces

Evidence: `src/core/superstate/superstate.ts:355-371`

> `const items = [...this.spacesMap.getInverse(spacePath)]`  
> `rank: ranks.indexOf(f),`

Evidence: `src/core/spaceManager/filesystemAdapter/filesystemAdapter.ts:428-432`

> `rows = mergeContextRows(this.spaceManager.superstate.getSpaceItems(path).map(f => f.path), table.rows, ...`  
> `rows = rows.map(f => linkContextRow(...))`

Evidence: `src/core/react/context/ContextEditorContext.tsx:521-548`

> `tableData?.rows?.map((r, index) => ({`  
> `contextTable[tagSpacePathFromTag(c)]?.rows.findIndex(`  
> `return { ...p, ...contextRowsWithKeysAppended };`

Evidence: `src/core/react/context/ContextEditorContext.tsx:613-668`

> `const filtered = data.filter(...).filter(...).sort(...)`

Why it matters: pagination only limits DOM rows; it does not limit row assembly, linked-context joins, filtering, or sorting. Opening a 5k-row context can still scan and join thousands of rows before the first 25 are shown.

Suggested fix direction: index ranks and context rows by path, compute filtered/sorted row ids, and derive only the loaded/visible row slice for render.

Confidence: high. Cheapest confirmation: profile `readTable`, `getSpaceItems`, and `ContextEditorContext.data` on a 5k-row context.

### [SEV-medium] Table rendering is pagination-only; “Load All” renders every row and every visible cell

Evidence: `src/core/react/components/SpaceView/Contexts/TableView/TableView.tsx:20-30`

> `getPaginationRowModel,`  
> `useReactTable,`

Evidence: `src/core/react/components/SpaceView/Contexts/TableView/TableView.tsx:1777-1829`

> `{table.getRowModel().rows.map((row, visibleIndex) => {`  
> `{row.getVisibleCells().map((cell, i) =>`

Evidence: `src/core/react/components/SpaceView/Contexts/TableView/TableView.tsx:2011-2013`

> `onClick={() =>`  
> `table.setPageSize(tableLoadAllPageSize(data.length))`

Evidence: `src/core/react/components/SpaceView/Contexts/DataTypeView/DataTypeView.tsx:47-49`

> `export const DataTypeView: React.FC<DataTypeViewProps> = (`  
> `props: DataTypeViewProps`

Why it matters: there is no table row virtualization in the active table path. A user can intentionally render 1k-5k rows via Load All, and cells are plain function components.

Suggested fix direction: use `@tanstack/react-virtual` for rows, keep “loaded rows” as data availability, and memoize row/cell components around stable row ids and column ids.

Confidence: high. Cheapest confirmation: inspect DOM node count after Load All on a 1k-row table.

### [SEV-medium] Cell selection/edit feedback changes can rebuild the visible grid

Evidence: `src/core/react/components/SpaceView/Contexts/TableView/TableView.tsx:552-570`

> `setCellEditFeedback(pendingFeedbackForWrites(writes));`  
> `setCellEditFeedback(resultFeedback);`

Evidence: `src/core/react/components/SpaceView/Contexts/TableView/TableView.tsx:945-1154`

> `const columns: any[] = useMemo(`  
> `[ cols, data, currentEdit, predicate, dbSchema, contextTable, cellResetTokens, ]`

Evidence: `src/core/react/components/SpaceView/Contexts/TableView/TableView.tsx:1894-1904`

> `cellSelection && selectionContainsCell(`  
> `visibleRowOrder,`  
> `visibleColumnOrder,`

Why it matters: editing one cell, changing selection, or updating feedback state forces table-level state changes and recalculates cell selection classes across visible cells. With page size raised, a single edit can touch thousands of cell render paths.

Suggested fix direction: isolate cell feedback/selection lookup in memoized row/cell components, precompute selected cell key sets, and keep column definitions stable across edit state changes.

Confidence: high. Cheapest confirmation: add render counters to `DataTypeView` and edit one cell on a 500-row loaded page.

### [SEV-medium] Frontmatter discovery repeats row-set scans on context parse, view open, and property menu open

Evidence: `src/core/utils/properties/allProperties.ts:132-167`

> `const propertyTypes = observedFrontmatterPropertyTypes(`  
> `for (const path of paths) {`

Evidence: `src/core/utils/properties/allProperties.ts:207-260`

> `contextHasOnlyDefaultOrFrontmatterColumns(`  
> `const frontmatterPropertyTypes = observedFrontmatterPropertyTypes(`  
> `const discoveredCols = discoverFrontmatterPropertiesFromPathStates(`

Evidence: `src/core/superstate/cacheParsers.ts:56-65`

> `const materializedContextTable = materializeFrontmatterBackedContextTable(`

Evidence: `src/core/react/context/ContextEditorContext.tsx:431-461`

> `const discovered = discoverFrontmatterPropertiesFromPathStates(`  
> `const freshDiscovered = discoverFrontmatterPropertiesFromPathStates(`

Why it matters: `materializeFrontmatterBackedContextTable` does several passes across the same path set, and fresh primary-context import runs discovery, rereads the table, then runs discovery again. Large frontmatter-rich folders pay this cost repeatedly.

Suggested fix direction: compute one `FrontmatterDiscoverySummary` per `(contextPath, schemaId, pathSetVersion, columnsVersion)` and share it across materialization, default import, and menus.

Confidence: high. Cheapest confirmation: count calls to `observedFrontmatterPropertyTypes` while opening one fresh 5k-row folder view.

### [SEV-medium] Bulk paste batches per file, but file writes are sequential and metadata events trigger full context reconciliation

Evidence: `src/core/utils/contexts/tableEditTransaction.ts:264-299`

> `frontmatterChangesByPath.set(resolvedPath, { ... })`  
> `for (const [path, group] of frontmatterChangesByPath.entries()) {`  
> `const writeResult = await saveFrontmatterProperties({`

Evidence: `src/core/utils/properties/frontmatterWrite.ts:20-24`

> `const saved = await superstate.spaceManager.saveProperties(`

Evidence: `src/adapters/obsidian/filetypes/markdownAdapter.ts:121-124`

> `public metadataChange (file: TFile) {`  
> `this.parseCache(tFileToAFile(file), true);`

Evidence: `src/core/superstate/superstate.ts:586-600`

> `this.reloadPath(path).then(f =>`  
> `this.addToContextStateQueue(() => updateContextWithProperties(this, path, allContextsWithFile));`

Why it matters: a 500-cell paste into one file is grouped well; a 500-cell paste across 500 files becomes 500 sequential frontmatter writes, each capable of causing a metadata reload and context reconciliation.

Suggested fix direction: add a transaction-scoped metadata reconciliation coalescer: collect changed paths, limit write concurrency, and reload affected contexts once after the batch settles.

Confidence: high. Cheapest confirmation: paste one column across 500 rows and count `updateContextWithProperties` invocations.

### [SEV-medium] Bulk row application uses O(rows × writes) filters

Evidence: `src/core/utils/contexts/tableEditTransaction.ts:144-162`

> `rows: tableData.rows.map((row, index) => {`  
> `const rowWrites = writes.filter((write) => parseInt(write.rowId) == index);`

Evidence: `src/core/utils/contexts/tableEditTransaction.ts:173-186`

> `rows: table.rows.map((row) => {`  
> `const rowWrites = writesWithPaths.filter(({ path }) => row[PathPropertyName] == path)`

Evidence: `src/core/utils/contexts/tableEditTransaction.ts:345-348`

> `!sourceTable.rows.some(`  
> `(contextRow) => contextRow[PathPropertyName] == path`

Why it matters: a 500-cell paste against a 5k-row table can do millions of row/write comparisons before persistence. This is avoidable because writes already have row ids or paths.

Suggested fix direction: pre-index writes by `rowId` and context writes by `path`, and prebuild a `Set` of context row paths.

Confidence: high. Cheapest confirmation: benchmark `executeTableValueWrites` with 5k rows and 500 writes before/after indexing.

### [SEV-medium] MDB persistence rewrites and exports whole sql.js databases

Evidence: `src/core/spaceManager/filesystemAdapter/filesystemAdapter.ts:530-545`

> `return this.fileSystem.saveFileFragment(mdbFile, 'mdbTable', table.schema.id, () =>`  
> `stripFrontmatterBackedRowValues(table)`

Evidence: `src/adapters/mdb/mdbAdapter.ts:188-199`

> `const mdbTable = await this.readContent(file, 'mdbTable', fragmentId);`  
> `return saveDBToPath(this, file.path,{...mdbTablesToDBTables(tables), ...newFields})`

Evidence: `src/adapters/mdb/db/db.ts:274-316`

> `//rewrite the entire table, useful for storing ranks and col order, not good for performance`  
> `DROP TABLE IF EXISTS "${t}";`  
> `rows: tables[t].rows.map`

Evidence: `src/adapters/mdb/db/db.ts:377-380`

> `const result = replaceDB(db, tables);`  
> `await saveDBFile(plugin, path, db.export().buffer as ArrayBuffer);`

Why it matters: context/view saves are full DB rewrites plus full sql.js export. Large context MDBs will scale with table size even for one column resize, row reorder, or small schema change.

Suggested fix direction: use incremental table updates for row/cell mutations, keep a per-file DB session where possible, and reserve full `replaceDB` for schema rebuilds.

Confidence: high. Cheapest confirmation: time one row reorder and one column resize on a context MDB with 5k rows.

### [SEV-low] sql.js/WASM load is not memoized and is part of the bundled runtime surface

Evidence: `src/adapters/mdb/mdbAdapter.ts:35-40`

> `public async sqlJS() {`  
> `const sqljs = await loadSQL();`  
> `return sqljs;`

Evidence: `src/adapters/mdb/db/sqljs.js:4-8`

> `export const loadSQL = async () => {`  
> `const sql = await initSqlJs({ wasmBinary: sql_wasm, });`

Evidence: `esbuild.config.mjs:155-183`

> `entryPoints: ['main.ts'],`  
> `bundle: true,`  
> `plugins: [... inlineWorkerPlugin(), watPlugin(), ...]`

Why it matters: every caller gets a fresh `initSqlJs` path unless the dependency memoizes internally. The plugin also carries sql.js/WASM in its static runtime surface even though table UX frequently only needs metadata/frontmatter projection.

Suggested fix direction: memoize a module-level `sqlJsPromise`, lazy-load MDB code paths after first context/cache access, and consider a lighter non-sql cache for hot superstate metadata.

Confidence: medium. Cheapest confirmation: instrument `loadSQL()` call count during startup plus one table save.

## Swept clean

- Frontmatter-backed values are stripped before context MDB persistence in the active save path: `saveTable` calls `stripFrontmatterBackedRowValues(table)` at `src/core/spaceManager/filesystemAdapter/filesystemAdapter.ts:543-545`.
- Paste planning itself is linear in the target rectangle and rejects computed/read-only targets before writes: `planTablePaste` loops row/column offsets and checks `propertyAuthorityForColumn` at `src/core/utils/contexts/tablePastePlan.ts:179-222`.
- Default table loading is intentionally paginated at 25 rows: `contextPagination: 25` in `src/core/schemas/settings.ts:82`, and `TableView` initializes `pageSize` from that setting at `src/core/react/components/SpaceView/Contexts/TableView/TableView.tsx:430-434`.
- Frontmatter discovery reads from `pathsIndex` metadata, not by reopening Markdown files, in `src/core/utils/properties/allProperties.ts:148-150`.
- Desktop cache writes are debounced rather than exported per individual cache store: `LocalStorageCache.store` calls `debounceSaveSpaceDatabase()` and the export is delayed in `src/adapters/mdb/localCache/localCache.ts:53-80`.

## Improvement paths

1. Replace startup full-vault cache warming with indexed and incremental work: build a persisted-cache `Map`, chunk `createFileCache`, and skip unchanged files.

2. Add a shared frontmatter discovery cache keyed by context path, path-set version, and column version; collapse the repeated scans in `materializeFrontmatterBackedContextTable`, default import, and property menus.

3. Virtualize table rows, memoize row/cell components, and keep provider values/function identities stable so single-cell edits do not rebuild the visible grid.

4. Coalesce metadata reconciliation during bulk writes: group by affected context, limit file-write concurrency, and run one context reload after the paste settles.

5. Make MDB persistence incremental: memoize sql.js initialization, avoid full `replaceDB` for row/cell updates, and defer full DB export to batched checkpoints.

Recommended next step: approve implementation planning for items 1 and 3 first; they address the largest load-time and table-time bottlenecks.