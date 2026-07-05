
import { dbResultsToDBTables, deleteFromDB, insertIntoDB, openZippedDBWithStatus, replaceDB, saveZippedDBFile, selectDB, withDBPathWriteQueue } from "adapters/mdb/db/db";
import { MDBFileTypeAdapter } from "adapters/mdb/mdbAdapter";
import { debounce } from "lodash";
import { CacheDBSchema } from "schemas/cache";
import { DBRow, DBTables } from "shared/types/mdb";
import { quoteIdent, sanitizeSQLStatement } from "shared/utils/sanitizers";
import { Database } from "sql.js";
import { LocalCachePersister } from "../../../shared/types/persister";

/** Simpler wrapper for a file-backed cache for arbitrary metadata. */
export class LocalStorageCache implements LocalCachePersister {
    public db: Database;
    private initialized: boolean;
    public indexVersion = Date.now().toString();
    private defaultTables : DBTables;
    public constructor( public storageDBPath: string, private mdbAdapter: MDBFileTypeAdapter, types: string[]) {
        this.defaultTables = types.reduce((acc, type) => ({...acc, [type]: CacheDBSchema}), {})
    }

    public async unload() {
        this.initialized = false;
        this.db?.close();
    }
    public async initialize () {

        const { db, status } = await openZippedDBWithStatus(this.mdbAdapter, await this.mdbAdapter.sqlJS(), this.storageDBPath);
        if (status === "corrupt") {
            console.warn(`[notidian] Rebuilding unreadable local cache at ${this.storageDBPath}.`);
        }
        this.db = db;
        let tables;
        try {
            tables =  dbResultsToDBTables(
                this.db.exec(
                    "SELECT name FROM sqlite_schema WHERE type ='table' AND name NOT LIKE 'sqlite_%';"
                    )
            );
            } catch (e) {
                this.mdbAdapter.plugin.superstate.ui.error(e);
            tables = [];
            }
        if (tables.length == 0) {
            // Notidian-g6f5: this.defaultTables is built entirely from the
            // fixed CacheDBSchema constant (non-empty cols: path/cache/version)
            // with no rows, so the empty-cols-with-rows refusal (Notidian-jn8p)
            // can't fire here. Still capture+log the boolean for defense in
            // depth -- mirrors the saveDBToPath/saveZippedDBToPath contract
            // (Notidian-jn41) so a genuine seed failure (e.g. a mid-batch exec
            // throw) is surfaced instead of silently treated as initialized.
            const seeded = replaceDB(this.db, this.defaultTables);
            if (!seeded) {
                console.warn(`[notidian] Failed to seed local cache schema at ${this.storageDBPath}.`);
            }
        }
        this.initialized = true;
    }

    public isInitialized() {
        return this.initialized;
    }
public reset() {
    if (!this.initialized) return;
    // Notidian-g6f5: same fixed-schema guarantee as initialize() above.
    const seeded = replaceDB(this.db, this.defaultTables);
    if (!seeded) {
        console.warn(`[notidian] Failed to reset local cache schema at ${this.storageDBPath}.`);
    }
}
    /** Store file metadata by path. */
    public async store(path: string, cache: string, type: string): Promise<void> {
        if (!this.initialized) return;
        if (!this.db) return;

        await insertIntoDB(this.db, {
            [type]: {...this.defaultTables[type], rows: [{ path, cache, version: this.indexVersion}]},
        }, true)
        this.debounceSaveSpaceDatabase();
        return;
    }
    public async remove(path: string, type: string): Promise<void> {
        if (!this.initialized) return;
        if (!this.db) return;
        await deleteFromDB(this.db, type, `${quoteIdent("path")}='${sanitizeSQLStatement(path)}'`)
        this.debounceSaveSpaceDatabase();
        return;
    }
    public cleanType (type: string) {
        if (!this.initialized) return;
        if (!this.db) return;
        deleteFromDB(this.db, type, `${quoteIdent("version")} != '${this.indexVersion}'`)
        return;
    }
    private debounceSaveSpaceDatabase = debounce(
        () => {
             return withDBPathWriteQueue(this.storageDBPath, () =>
                saveZippedDBFile(this.mdbAdapter, this.storageDBPath, this.db.export().buffer as ArrayBuffer)
             )
    }, 5000,
    {
        leading: false,
      })

    /** Obtain a list of all persisted files. */
    public async loadAll(type: string): Promise<DBRow[]> {
        if (!this.initialized) return [];
        if (!this.db) return [];
        return selectDB(this.db, type)?.rows ?? []
    }

}
