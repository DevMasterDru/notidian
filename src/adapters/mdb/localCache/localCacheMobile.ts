
import { dbResultsToDBTables, openZippedDBWithStatus, replaceDB, saveZippedDBFile, saveZippedDBToPath, selectDB, withDBPathWriteQueue } from "adapters/mdb/db/db";
import { MDBFileTypeAdapter } from "adapters/mdb/mdbAdapter";
import { debounce } from "lodash";
import { CacheDBSchema } from "schemas/cache";
import { DBRow } from "shared/types/mdb";
import { LocalCachePersister } from "../../../shared/types/persister";


/** Simpler wrapper for a file-backed cache for arbitrary metadata. */
export class MobileCachePersister implements LocalCachePersister {
    public indexVersion = Date.now().toString();
    private initialized = false;
    // Notidian-b6lv: guards unload() so a plugin:reload teardown call is safe
    // to make exactly once and idempotent if invoked again -- see unload().
    private disposed = false;
    private maps : Record<string, Map<string, DBRow>>;
    public constructor( public storageDBPath: string, private mdbAdapter: MDBFileTypeAdapter, private types: string[]) {

    }

    public async getDB (){
        const { db, status } = await openZippedDBWithStatus(this.mdbAdapter, await this.mdbAdapter.sqlJS(), this.storageDBPath);
        if (status === "corrupt") {
            console.warn(`[notidian] Rebuilding unreadable local cache at ${this.storageDBPath}.`);
        }
        return db;
    }
    public async initialize () {
        const db = await this.getDB();
        let tables;
        try {
            tables =  dbResultsToDBTables(
                db.exec(
                    "SELECT name FROM sqlite_schema WHERE type ='table' AND name NOT LIKE 'sqlite_%';"
                    )
            );
            } catch (e) {
            this.mdbAdapter.plugin.superstate.ui.error(e);
            tables = [];
            }
        if (tables.length == 0) {
            // Notidian-g6f5: the seed schema is built entirely from the fixed
            // CacheDBSchema constant (non-empty cols: path/cache/version) with
            // no rows, so the empty-cols-with-rows refusal (Notidian-jn8p)
            // can't fire here. Still gate the write on replaceDB's result --
            // mirrors saveZippedDBToPath's fix (Notidian-jn41) so a genuine
            // seed failure (e.g. a mid-batch exec throw) never exports a
            // half-seeded image and reports success.
            const seeded = replaceDB(db, this.types.reduce((acc, type) => ({...acc, [type]: CacheDBSchema}), {}));
            if (seeded) {
                await withDBPathWriteQueue(this.storageDBPath, () =>
                    saveZippedDBFile(this.mdbAdapter, this.storageDBPath, db.export().buffer as ArrayBuffer)
                )
            } else {
                console.warn(`[notidian] Failed to seed local cache schema at ${this.storageDBPath}; skipping write.`);
            }
        }
        this.maps = this.types.reduce((p, type) => ({...p, [type]: new Map((selectDB(db, type)?.rows ?? []).map(f => [f.path, f]))}), {});
        db.close();
        this.initialized = true;
        
    }
    // Notidian-b6lv: same leak shape as 043x (localCache.ts's
    // LocalStorageCache.unload()), but for this class's own hand-rolled
    // debounce. Without cancelling the pending debounced flush here, a
    // MobileCachePersister instance from a previous plugin load kept firing
    // its ~2s debounced saveZippedDBToPath flush after plugin:reload
    // discarded it, racing the freshly reloaded instance's own writes to the
    // same .notidian/*.mdc path. unload() must be safe to call exactly once
    // at plugin teardown and idempotent if invoked again; once disposed,
    // store()/remove()/cleanType() already no-op via the initialized check,
    // so no successor flush can ever be scheduled.
    public unload () {
        if (this.disposed) return;
        this.disposed = true;
        this.initialized = false;
        this.debounceSaveSpaceDatabase.cancel();
    }
    public isInitialized() {
        return this.initialized;
    }
public async reset() {
    if (!this.initialized) return;
    const db = await this.getDB();
    // Notidian-g6f5: same fixed-schema guarantee as initialize() above --
    // gate the write on replaceDB's result.
    const seeded = replaceDB(db, this.types.reduce((acc, type) => ({...acc, [type]: CacheDBSchema}), {}));
    if (seeded) {
        await withDBPathWriteQueue(this.storageDBPath, () =>
            saveZippedDBFile(this.mdbAdapter, this.storageDBPath, db.export().buffer as ArrayBuffer)
        )
    } else {
        console.warn(`[notidian] Failed to reset local cache schema at ${this.storageDBPath}; skipping write.`);
    }
    this.maps = this.types.reduce((acc, type) => ({...acc, [type]: new Map((selectDB(db, type)?.rows ?? []).map(f => [f.path, f]))}), {});
    db.close();
}

    /** Store file metadata by path. */
    public async store(path: string, cache: string, type: string): Promise<void> {
        if (!this.initialized) return;
        this.maps[type].set(path, {path, cache, version: this.indexVersion});
        this.debounceSaveSpaceDatabase(this.maps);
        return;
    }
    public async remove(path: string, type: string): Promise<void> {
        if (!this.initialized) return;
        this.maps[type].delete(path)
        this.debounceSaveSpaceDatabase(this.maps);
        return;
    }
    public async cleanType (type: string) {
        if (!this.initialized) return;
        this.maps[type] = new Map( [...this.maps[type]]
            .filter(([k, f]) => f.version == this.indexVersion))
        this.debounceSaveSpaceDatabase(this.maps);
        return;
    }
    private debounceSaveSpaceDatabase = debounce(
        (maps: Record<string, Map<string, DBRow>>) => {
            const tables = Object.keys(maps).reduce((p,c) => {
                return {...p, 
                    [c] : {
                        ...CacheDBSchema,
                        rows: [...this.maps[c].values()]
                    }
                }
            }, {})
            saveZippedDBToPath(this.mdbAdapter, this.storageDBPath, tables)
    }, 2000,
    {
        leading: false,
      })

    /** Obtain a list of all persisted files. */
    public async loadAll(type: string): Promise<DBRow[]> {
        if (!this.initialized) return [];
        return [...this.maps[type].values()]
    }

}
