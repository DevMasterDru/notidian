
import {
  DBTable,
  MDB,
  SpaceProperty,
  SpaceTable,
  SpaceTableSchema,
  SpaceTables
} from "shared/types/mdb";
import { FilesystemSpaceInfo } from "shared/types/spaceInfo";

import { vaultSchema } from "adapters/obsidian/filesystem/schemas/vaultSchema";
import i18n from "shared/i18n";
import { defaultContextDBSchema, defaultContextSchemaID } from "shared/schemas/context";
import { defaultFieldsForContext } from "shared/schemas/fields";
import { quoteIdent, sanitizeSQLStatement } from "shared/utils/sanitizers";
import { Database, QueryExecResult } from "sql.js";
import {
  dbResultsToDBTables,
  deleteFromDB,
  dropTable, getDBFile, openDBWithStatus, refuseCorruptDBWrite, replaceDB, saveDBFile, withDBPathWriteQueue
} from "../db/db";
import { MDBFileTypeAdapter } from "../mdbAdapter";




export const dbTableToMDBTable = (
  table: DBTable,
  schema: SpaceTableSchema,
  fields: SpaceProperty[]
): SpaceTable => {
  return {
    schema,
    cols: fields,
    rows: table?.rows ?? [],
  };
};

// Exported for test only (Notidian-c2ef): this default-field merge is a pure,
// deterministic seam whose dedup key (name AND schemaId) mirrors the m_fields
// unique key — the same authority invariant pinned by Notidian-ub72. It has no
// exported caller in this module, so the only clean way to characterize it
// offline is to export the function itself; the export is otherwise inert.
export const updateFieldsToSchema = (fields: SpaceProperty[], space: FilesystemSpaceInfo) => {
  const defaultFields = defaultFieldsForContext(space);
  return [
    ...fields,
    ...(defaultFields.rows.filter(
      (f) => !fields.some((g) => g.name == f.name && g.schemaId == f.schemaId)
    ) as SpaceProperty[]),
  ];
};


export const getMDB = async (
  plugin: MDBFileTypeAdapter,
  path: string,
): Promise<MDB> => {
  const sqlJS = await plugin.sqlJS();
  // Route through openDBWithStatus so a constructor-corrupt file returns null
  // instead of throwing before the exec catch. bd Notidian-51n.
  const { db, status } = await openDBWithStatus(plugin, sqlJS, path);
  if (status !== "ok") {
    db.close();
    return null;
  }

  let fields;
  let schemas;
  try {
    fields = dbResultsToDBTables(
      db.exec(`SELECT * FROM ${quoteIdent("m_fields")}`)
    )[0].rows as SpaceProperty[];
    schemas = dbResultsToDBTables(
      db.exec(`SELECT * FROM ${quoteIdent("m_schema")}`)
    )[0].rows as SpaceTableSchema[];
  } catch (e) {
    db.close();
    return null;
  }
  // Notidian-jn8p: build each schema's backing table INDIVIDUALLY. An orphaned
  // m_schema row (schema present, physical table missing — e.g. a degenerate
  // save DROPped the table without recreating it) used to throw out of a single
  // try/catch that returned null for the WHOLE file, so every intact table in
  // the .mdb became unloadable on the next parse. Skip only the broken schema,
  // keep the rest, and surface the corruption to the user instead of hiding it.
  const dbTable: { [key: string]: DBTable } = {};
  const orphanedSchemas: string[] = [];
  for (const schema of schemas.filter((f) => f.type == "db")) {
    try {
      dbTable[schema.id] = dbResultsToDBTables(
        db.exec(`SELECT * FROM ${quoteIdent(schema.id)}`)
      )[0];
    } catch (e) {
      orphanedSchemas.push(schema.id);
    }
  }
  notifyOrphanedSchemas(plugin, path, orphanedSchemas);

  db.close();
  return {
    schemas,
    fields,
    tables: dbTable
  }
};

// Notify once per file+schema-set per session so a permanently orphaned schema
// surfaces to the user without turning every re-parse into a toast storm.
const notifiedOrphanedSchemas = new Set<string>();
const notifyOrphanedSchemas = (
  plugin: MDBFileTypeAdapter,
  path: string,
  orphanedSchemas: string[]
) => {
  if (orphanedSchemas.length === 0) return;
  const key = `${path}//${orphanedSchemas.join(",")}`;
  if (notifiedOrphanedSchemas.has(key)) return;
  notifiedOrphanedSchemas.add(key);
  plugin.plugin?.superstate?.ui?.notify?.(
    `${i18n.notice.missingTableSkipped}${orphanedSchemas.join(", ")} (${path})`
  );
};



export const getMDBTable = async (
  adapter: MDBFileTypeAdapter,
  dbPath: string,
  table: string,
): Promise<SpaceTable> => {

  
  const sqlJS = await adapter.sqlJS();
  const { db, status } = await openDBWithStatus(adapter, sqlJS, dbPath);
  if (status !== "ok") {
    db.close();
    return null;
  }

  let fieldsTables;
  let schema;
  try {
    fieldsTables = dbResultsToDBTables(
      db.exec(`SELECT * FROM ${quoteIdent("m_fields")} WHERE ${quoteIdent("schemaId")} = '${sanitizeSQLStatement(table)}'`)
    );
    schema = dbResultsToDBTables(
      db.exec(`SELECT * FROM ${quoteIdent("m_schema")} WHERE ${quoteIdent("id")} = '${sanitizeSQLStatement(table)}'`)
    )[0]?.rows[0] as SpaceTableSchema;
  } catch (e) {
    adapter.plugin.superstate.ui.error(e);
    db.close();
    return null;
  }
  if (!schema) return null;
  

  const fields = (fieldsTables[0]?.rows as SpaceProperty[] ?? []).filter(
    (f) => f.name.length > 0
  );
  let dbTable;
  try {
      dbTable = dbResultsToDBTables(
      db.exec(
        `SELECT * FROM ${quoteIdent(table)}`
      )
    );
      } catch (e) {
      db.close();
      return {
        schema: schema,
        cols: fields,
        rows: [],
      };
    }

  db.close();
  return dbTableToMDBTable(
    dbTable[0],
    schema,
    fields
  );
};

export const getMDBTables = async (plugin: MDBFileTypeAdapter, dbPath: string) => {
  return withDBPathWriteQueue(dbPath, async () => {
  const sqlJS = await plugin.sqlJS();
    const { db, status } = await openDBWithStatus(plugin, sqlJS, dbPath, false);
    if (status === "missing") {
      db.close();
      return null;
    }
    if (status === "corrupt") {
      db.close();
      await refuseCorruptDBWrite(plugin, dbPath, false);
      return null;
    }
  
    // Notidian-eedq: the per-DB header layout (column widths/display/anchor/wrap/
    // hidden/order) is stored as the view PREDICATE on m_schema rows of type
    // 'view'/'frame'. This recovery/init block used to DESTROY that on every read
    // that found no schema rows: it (a) treated a THROWN read as "empty" and then
    // overwrote the file, and (b) when seeding, derived schemas from backing TABLE
    // NAMES only — which drops every view/frame row (those have no data table) —
    // and wrote an INSERT that omitted def+predicate, NULLing them. Net effect:
    // any time this path ran, all persisted header config was lost. The fixes
    // below make it strictly non-destructive: never overwrite on a failed read,
    // never derive-from-scratch in a way that drops view/frame rows, and always
    // carry def+predicate so no persisted column is ever NULLed.
    let schemas : SpaceTableSchema[] = []
    try {
       schemas = (dbResultsToDBTables(
      db.exec(`SELECT * FROM ${quoteIdent("m_schema")}`)
    )[0]?.rows ?? []) as SpaceTableSchema[];
    } catch (e) {
      // The m_schema read THREW (table absent on a fresh DB, or a transient engine
      // error). We deliberately do NOT trust this as "the DB is empty"; the
      // recovery block below re-reads persisted rows from m_schema itself before
      // deciding anything, so a transient throw can never clobber persisted views.
    }
    if (schemas.length == 0) {
      // RECOVERY / INIT — strictly NON-DESTRUCTIVE (Notidian-eedq).
      //
      // Whether the read above threw or returned zero rows, we must never blindly
      // derive schemas from backing TABLE NAMES and overwrite the file: that drops
      // every type:'view'/'frame' row (those have no data table) and NULLs the
      // predicate (where the per-DB header layout lives). Instead:
      //   1. Re-read whatever m_schema rows actually persist (the source of truth
      //      for views/frames + predicates), if the table exists.
      //   2. Derive db-type schema rows ONLY for backing data tables that have no
      //      persisted schema row, and MERGE them in (never replace).
      //   3. Write ONLY the newly-derived rows, with the FULL 6-column shape
      //      (incl. def + predicate, never NULL). If nothing new is derived, leave
      //      the file untouched — a pure read must not rewrite persisted state.
      let mSchemaExists = false;
      try {
        const existsRes = dbResultsToDBTables(
          db.exec(
            "SELECT name FROM sqlite_schema WHERE type ='table' AND name = 'm_schema';"
          )
        );
        mSchemaExists = (existsRes[0]?.rows?.length ?? 0) > 0;
      } catch (e) {
        mSchemaExists = false;
      }

      // (1) Recover persisted rows (view/frame schemas + their predicates).
      let persisted: SpaceTableSchema[] = [];
      if (mSchemaExists) {
        try {
          persisted = (dbResultsToDBTables(
            db.exec(`SELECT * FROM ${quoteIdent("m_schema")}`)
          )[0]?.rows ?? []) as SpaceTableSchema[];
        } catch (e) {
          persisted = [];
        }
      }

      // (2) Derive db-type schemas for backing tables lacking a persisted row.
      const tableResults = dbResultsToDBTables(
        db.exec(
            "SELECT name FROM sqlite_schema WHERE type ='table' AND name NOT LIKE 'sqlite_%';"
            ));
      const tables = tableResults[0]?.rows?.map(f => f.name) as string[] ?? [];
      const derived = tables
        .filter(f => !f.startsWith('m_'))
        .filter(f => !persisted.some(p => p.id == f)) // don't duplicate a persisted row
        .map(f => (f == defaultContextSchemaID ? defaultContextDBSchema : { id: f, name: f, type: 'db', primary: '' } as SpaceTableSchema));
      schemas = [...persisted, ...derived];

      // (3) Persist ONLY the newly-derived rows, full 6-column shape, no NULLs.
      if (derived.length > 0) {
        db.exec(
          `CREATE TABLE IF NOT EXISTS ${quoteIdent("m_schema")} (${["id", "name", "type", "def", "predicate", "primary"].map((f) => `${quoteIdent(f)} char`).join(", ")})`
        );
        const cols = ["id", "name", "type", "def", "predicate", "primary"];
        db.exec(derived.map(f =>
          `INSERT INTO ${quoteIdent("m_schema")} (${cols.map(quoteIdent).join(", ")}) VALUES (` +
          [f.id, f.name, f.type, f.def ?? '', f.predicate ?? '', f.primary ?? '']
            .map(v => `'${sanitizeSQLStatement(v as string)}'`)
            .join(", ") +
          `)`
        ).join(';'));
        await saveDBFile(plugin, dbPath, db.export().buffer as ArrayBuffer);
      }
    }
    const mdbTables = {} as SpaceTables;
    schemas.forEach(schema => {
      let fieldsTables;
      try {
        fieldsTables = dbResultsToDBTables(
          db.exec(`SELECT * FROM ${quoteIdent("m_fields")} WHERE ${quoteIdent("schemaId")} = '${sanitizeSQLStatement(schema.id)}'`)
        );
        
      } catch (e) {
        return;
      }
      
    
      const fields = (fieldsTables?.[0]?.rows as SpaceProperty[] ?? []).filter(
        (f) => f.name.length > 0
      );
    
      let dbTable;
      try {
      dbTable = dbResultsToDBTables(db.exec(`SELECT * FROM ${quoteIdent(schema.id)}`));
      
      mdbTables[schema.id] = dbTableToMDBTable(
        dbTable[0],
        schema,
        fields
      );} catch (e) {
        
        mdbTables[schema.id] = {
          schema,
          cols: fields,
          rows: [],
        };
        return;
      }
    })
    db.close();
    return mdbTables
  });
}

export const deleteMDBTable = async (
  plugin: MDBFileTypeAdapter,
  table: string,
  dbPath: string,
): Promise<boolean> => {
  return withDBPathWriteQueue(dbPath, async () => {
  const sqlJS = await plugin.sqlJS();
  const { db, status } = await openDBWithStatus(plugin, sqlJS, dbPath, false);
  if (status === "missing") {
    db.close();
    return false;
  }
  if (status === "corrupt") {
    db.close();
    await refuseCorruptDBWrite(plugin, dbPath, false);
    return false;
  }
  deleteFromDB(db, "m_schema", `${quoteIdent("id")} = '${sanitizeSQLStatement(table)}'`);
  deleteFromDB(db, "m_schema", `${quoteIdent("def")} = '${sanitizeSQLStatement(table)}'`);
  deleteFromDB(db, "m_fields", `${quoteIdent("schemaId")} = '${sanitizeSQLStatement(table)}'`);
  dropTable(db, table);
  await saveDBFile(plugin, dbPath, db.export().buffer as ArrayBuffer);
  db.close();
  return true;
  });
};

export const getMDBTableSchemas = async (
  plugin: MDBFileTypeAdapter,
  path: string,
): Promise<SpaceTableSchema[]> => {
  const sqlJS = await plugin.sqlJS();
  const { db, status } = await openDBWithStatus(plugin, sqlJS, path);
  if (status !== "ok") {
    db.close();
    return null;
  }
  let schemas : QueryExecResult[] = [];
  try {
    schemas = db.exec(`SELECT * FROM ${quoteIdent("m_schema")}`)
  } catch (e) {
  }
  db.close();
  return (schemas[0]?.values ?? []).map((f) => {
    const [id, name, type, def, predicate, primary] = f as string[];
    return { id, name, type, def, predicate, primary };
  });
};

export const getMDBTableProperties = async (
  adapter: MDBFileTypeAdapter,
  path: string,
): Promise<SpaceProperty[]> => {
  const sqlJS = await adapter.sqlJS();
  const { db, status } = await openDBWithStatus(adapter, sqlJS, path);
  if (status !== "ok") {
    db.close();
    return null;
  }
  let fieldsTables


  try {
    fieldsTables = dbResultsToDBTables(db.exec(`SELECT * FROM ${quoteIdent("m_fields")}`))[0].rows as SpaceProperty[];

  } catch (e) {
    db.close();
    return [];
  }
  
  if (fieldsTables.length == 0) {
    try {
      db.exec(
        `CREATE TABLE ${quoteIdent("m_fields")} (${["name", "schemaId", "type", "value", "hidden", "attrs", "unique", "primary"].map((f) => `${quoteIdent(f)} TEXT`).join(", ")})`
      );
    } catch (e) {
    }
    
    db.close();

    return [];
  }
  db.close();
  return fieldsTables;
};

export const initiateDB = (db: Database): boolean => {
  // Notidian-g6f5: vaultSchema is a fixed, non-empty-cols constant (path/
  // parent/created/sticker/color/folder/rank/name), so the empty-cols-with-
  // rows refusal (Notidian-jn8p) can't fire here. Capture+log the boolean
  // anyway (mirrors the saveDBToPath/saveZippedDBToPath contract established
  // by Notidian-jn41) so a genuine seed failure is surfaced to any future
  // caller instead of being silently swallowed -- initiateDB currently has no
  // callers in this repo, so this is a forward-looking correctness fix.
  const result = replaceDB(db, {
    vault: vaultSchema,
  });
  if (!result) {
    console.warn(`[notidian] Failed to initiate DB with the vault schema.`);
  }
  return result;
};
