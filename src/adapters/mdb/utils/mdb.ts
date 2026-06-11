
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

const updateFieldsToSchema = (fields: SpaceProperty[], space: FilesystemSpaceInfo) => {
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
  let dbTable
  try {
   dbTable = schemas.filter(f => f.type == 'db').map(f => ({[f.id]: dbResultsToDBTables(
    db.exec(
      `SELECT * FROM ${quoteIdent(f.id)}`
    )
  )[0]})).reduce((p,c) => ({...p, ...c}), {});
  
    } catch (e) {
      db.close();
      return null
    }

  db.close();
  return {
    schemas,
    fields,
    tables: dbTable
  }
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
  
    let schemas : SpaceTableSchema[] = []
    try {
       schemas = (dbResultsToDBTables(
      db.exec(`SELECT * FROM ${quoteIdent("m_schema")}`)
    )[0]?.rows ?? []) as SpaceTableSchema[];
    } catch (e) {
    }
    if (schemas.length == 0) {
      const tableResults = dbResultsToDBTables(
        db.exec(
            "SELECT name FROM sqlite_schema WHERE type ='table' AND name NOT LIKE 'sqlite_%';"
            ));
      const tables = tableResults[0]?.rows?.map(f => f.name) as string[] ?? [];
      schemas = tables.filter(f => !f.startsWith('m_')).map(f => (f == defaultContextSchemaID ? defaultContextDBSchema : { id: f, name: f, type: 'db', primary: ''}));
      db.exec(
        `CREATE TABLE IF NOT EXISTS ${quoteIdent("m_schema")} (${["id", "name", "type", "def", "predicate", "primary"].map((f) => `${quoteIdent(f)} char`).join(", ")})`
      );
      db.exec(schemas.map(f => `INSERT INTO ${quoteIdent("m_schema")} (${["id", "name", "type", "primary"].map(quoteIdent).join(", ")}) VALUES ('${sanitizeSQLStatement(f.id)}', '${sanitizeSQLStatement(f.name)}', '${sanitizeSQLStatement(f.type)}', '${sanitizeSQLStatement(f.primary)}')`).join(';'));
      await saveDBFile(plugin, dbPath, db.export().buffer as ArrayBuffer);
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

export const initiateDB = (db: Database) => {
  replaceDB(db, {
    vault: vaultSchema,
  });
};
