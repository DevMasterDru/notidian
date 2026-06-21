
import { mdbTablesToDBTables, saveDBToPath } from 'adapters/mdb/db/db';
import { deleteMDBTable, getMDB, getMDBTable, getMDBTableProperties, getMDBTableSchemas, getMDBTables } from 'adapters/mdb/utils/mdb';
import { commandToDBTables, mdbSchemaToCommandSchema } from 'core/utils/commands/commands';
import { mdbFrameToDBTables, mergeFrameFields } from "core/utils/frames/frame";
import _ from 'lodash';
import MakeMDPlugin from 'main';
import { AFile, FileTypeAdapter, FilesystemMiddleware } from 'makemd-core';
import { fieldSchema } from "shared/schemas/fields";
import { Command } from 'shared/types/commands';
import { DBTable, DBTables, MDB, SpaceProperty, SpaceTable, SpaceTableSchema, SpaceTables } from 'shared/types/mdb';
import { MDBFrame } from 'shared/types/mframe';
import { frameSchemaToTableSchema } from "shared/utils/makemd/schema";
import { loadSQL } from "./db/sqljs";
import { deletePropertyToDBTables, savePropertyToDBTables } from './utils/property';
import { saveSchemaToDBTables } from './utils/schema';
type MDBContent = {
    schema: SpaceTableSchema,
    schemas: SpaceTableSchema[],
    field: SpaceProperty,
    fields: SpaceProperty[],
    table: DBTable,
    tables: DBTables,
    mdbTable: SpaceTable,
    mdbTables: SpaceTables,
    mdbFrame: MDBFrame,
    mdbCommand: Command,
    mdbCommands: Command[]
}

export class MDBFileTypeAdapter implements FileTypeAdapter<MDB, MDBContent> {

    constructor (public plugin: MakeMDPlugin) {
    }
    public async sqlJS() {
        // console.time("Loading SQlite");
        const sqljs = await loadSQL();
        // console.timeEnd("Loading SQlite");
        return sqljs;
      }
    public async newFile (parent: string, name: string, type: string, content?: DBTables) {
        const newPath = `${parent}/${name}.${type}`;
        await saveDBToPath(this, newPath, content);

        return this.middleware.getFile(newPath)
    }

    public supportedFileTypes = ['mdb'];
    public id = "mdb.notidian";
    public cache: Map<string, MDB>
    public middleware: FilesystemMiddleware;
    public initiate (middleware: FilesystemMiddleware) {
        this.middleware = middleware;
        this.cache = new Map();
    }
    
    public async parseCache (file: AFile, refresh: boolean) {    
        await getMDB(this, file.path).then(mdb => {
            if (!mdb) {
                return false;
            }
            this.cache.set(file.path, {
                schemas: mdb.schemas ?? [],
                fields: mdb.fields,
                tables: mdb.tables
            })
            return true;
        }).then(f => {
            if (f)
            this.middleware.updateFileCache(file.path, this.cache.get(file.path), refresh);
        })
        
    }
    
    public contentTypes (file: AFile) {
        return ['schemas', 'fields', 'tables', 'field', 'table', 'schema', 'field', 'mdbTable', 'mdbTables', 'mdbFrame', 'mdbCommand', 'mdbCommands'] as Array<keyof MDBContent>;
    }
    public cacheTypes (file: AFile) {
        return ['schemas', 'fields', 'tables'] as Array<keyof MDB>;
    }
    public getCacheTypeByRefString (file: AFile, refString: string) 
    {
        return null as any;
    }
    public getCache (file: AFile, fragmentType: keyof MDB, query?: string) {
        return this.cache.get(file.path)[fragmentType];
    }
    public async readContent (file: AFile, fragmentType: keyof MDBContent, fragmentId: any) : Promise<MDBContent[typeof fragmentType]> {

        if (fragmentType == 'table') {
        return this.cache.get(file.path)['tables'][fragmentId];
        }
        if (fragmentType == 'schema') {
            const schema =  this.cache.get(file.path)['schemas'].find(t => t.id == fragmentId);
            if (schema) {
                return schema;
            }
            return getMDBTableSchemas(this, file.path).then(f => f.find(t => t.id == fragmentId));
        }
        if (fragmentType == 'schemas') {
            return getMDBTableSchemas(this, file.path)
        // return this.cache.get(file.path)[fragmentType]
        }
        if (fragmentType == 'fields') {
        return getMDBTableProperties(this, file.path) ?? [];
        }
        
        if (fragmentType == 'mdbTables') {
            return getMDBTables(this, file.path);
        }
        if (fragmentType == 'mdbTable') {
            return getMDBTable(this, file.path, fragmentId);
            
        //    const table = this.readFragment(file, 'table', fragmentId) as DBTable;
        //    const schema = this.readFragment(file, 'schema', fragmentId) as MDBSchema;
        //    const fields = this.readFragment(file, 'fields', fragmentId) as MDBField[];
        //     return dbTableToMDBTable(table, schema, fields)
        }
        
        if (fragmentType == 'mdbFrame') {
            return getMDBTable(this, file.path, fragmentId);
        }

        if (fragmentType == 'mdbCommand') {
            const table = await getMDBTable(this, file.path, fragmentId);
            if (table)
            return {
                    schema: mdbSchemaToCommandSchema(table.schema),
                    fields: table.cols.filter(f => f.name != '$function'),
                    code: table.cols.find(f => f.name == '$function')?.value ?? ''
                } as Command;
        }

        if (fragmentType == 'mdbCommands') {
            const tables = await getMDBTables(this, file.path);
            return Object.keys(tables ?? {}).map(t => {
                return {
                    schema: mdbSchemaToCommandSchema(tables[t].schema),
                    fields: tables[t].cols.filter(f => f.name != '$function'),
                    code: tables[t].cols.find(f => f.name == '$function')?.value ?? ''
                } as Command;
            })
            
        }
    }
    public async newContent (file: AFile, fragmentType: keyof MDBContent, name: string, content: any, options: { [key: string]: any; }) {
        if (fragmentType == 'schema') {
            const schemas = await this.readContent(file, "schemas", null) as SpaceTableSchema[];
            const dbTables = saveSchemaToDBTables(content, schemas);
            return saveDBToPath(this, file.path, dbTables)
        }
        if (fragmentType == 'field') {

            const oldFields = await this.readContent(file, 'fields', null) as SpaceProperty[]
            const dbTables = savePropertyToDBTables(content, oldFields);

            return saveDBToPath(this, file.path, dbTables)
        }
        if (fragmentType == 'table') {
            return saveDBToPath(this, file.path, { [name]: content})
        }
        if (fragmentType == 'tables') {
            return saveDBToPath(this, file.path, content)
        }
        if (fragmentType == 'mdbTable') {
            return saveDBToPath(this, file.path, mdbTablesToDBTables({ [name]: content }))
        }
        if (fragmentType == 'mdbFrame') {
            // Notidian-2y21: a frame/view save must NOT clobber the m_fields rows of
            // EVERY OTHER frame/view in this file. mdbFrameToDBTables rebuilds m_fields
            // from ONLY the passed frame's cols, and replaceDB DROPs + recreates the
            // m_fields table — so writing one frame's DBTables wipes all sibling
            // views' column definitions (the visible "view reset": a view's columns,
            // and with them its colsHidden/colsSize/colsOrder layout, disappear).
            // Merge the new frame's cols over the persisted ones, keyed by schemaId,
            // exactly as the mdbTable save path already does.
            const oldFields = await this.readContent(file, 'fields', null) as SpaceProperty[] ?? []
            return saveDBToPath(this, file.path, mergeFrameFields(
                mdbFrameToDBTables({ [name]: content }),
                oldFields,
                name
            ))
        }

    }
    public async saveContent (file: AFile, fragmentType: keyof MDBContent, fragmentId: any, content: (prev: any) => any) {
        if (fragmentType == 'schema') {
            const schemas = await this.readContent(file, 'schemas', null) as SpaceTableSchema[] ?? [];
            const dbTables = saveSchemaToDBTables(content(schemas.find(t => t.id == fragmentId)), schemas);
            return saveDBToPath(this, file.path, dbTables)
        }
        if (fragmentType == 'field') {
            const oldFields = await this.readContent(file, 'fields', null) as SpaceProperty[]
            const oldField = oldFields.find(t => t.name == fragmentId.name && t.schemaId == fragmentId.schemaId)
            const dbTables = savePropertyToDBTables(content(oldField), oldFields, oldField);
            return saveDBToPath(this, file.path, dbTables)
        }
        if (fragmentType == 'table') {
            return saveDBToPath(this, file.path, { [fragmentId]: content(this.cache.get(file.path)['tables'][fragmentId])})
        }
        if (fragmentType == 'mdbTable') {
            const mdbTable = await this.readContent(file, 'mdbTable', fragmentId);
            const oldFields = await this.readContent(file, 'fields', null) as SpaceProperty[]
            const tables = { [fragmentId]: content(mdbTable) };
            const newFields = {
                m_fields: {
                    uniques: fieldSchema.uniques,
                    cols: fieldSchema.cols,
                    rows: [...oldFields.filter(f => f.schemaId != fragmentId), ...Object.values(tables).flatMap(f => f.cols)],
                  }
            }
            return saveDBToPath(this, file.path,{...mdbTablesToDBTables(tables), ...newFields})
        }
        if (fragmentType == 'mdbFrame') {
            // Notidian-2y21 — DURABILITY OF VIEW CUSTOMIZATIONS. The lone destructive
            // reset vector confirmed by the real-engine regression: this single-frame
            // save fed mdbFrameToDBTables({ [id]: frame }) straight to saveDBToPath ->
            // replaceDB, which (a) DROPs+recreates m_fields with ONLY this frame's
            // columns, erasing every sibling view's column definitions, and with them
            // each view's colsHidden/colsSize/colsOrder layout. The m_schema PREDICATE
            // survives (m_schema isn't in the written tables, so replaceDB leaves it
            // untouched), but a view with no columns renders reset all the same.
            // FIX: read the persisted m_fields and merge the saved frame's columns
            // over them by schemaId — the exact non-destructive pattern the mdbTable
            // save above already uses — so unchanged views keep every field row.
            const mdbTable = await this.readContent(file, 'mdbFrame', fragmentId);
            const oldFields = await this.readContent(file, 'fields', null) as SpaceProperty[] ?? []
            return saveDBToPath(this, file.path, mergeFrameFields(
                mdbFrameToDBTables({ [fragmentId]: content(mdbTable) }),
                oldFields,
                fragmentId
            ))
        }
        if (fragmentType == 'mdbCommand') {
            const mdbTable = await this.readContent(file, 'mdbCommand', fragmentId);
            const schemas = await this.readContent(file, 'schemas', null) as SpaceTableSchema[] ?? [];
            const schema = schemas.find(t => t.id == fragmentId);
            const newCommand = content(mdbTable);
            const newSchema = frameSchemaToTableSchema(newCommand.schema);
            if (!_.isEqual(newSchema, schema))
            {
            const dbTables = saveSchemaToDBTables(newSchema, schemas);
            await saveDBToPath(this, file.path, dbTables)
            }
            const fields = await this.readContent(file, 'fields', null) as SpaceProperty[];
            return saveDBToPath(this, file.path, commandToDBTables(newCommand, fields))
        }
    }
    public async deleteContent(file: AFile, fragmentType: keyof MDBContent, fragmentId: any) {
        if (fragmentType == 'schema') {
            return deleteMDBTable(this, fragmentId, file.path);
        }
        if (fragmentType == 'field') {
            const fields = await this.readContent(file, 'fields', null) as SpaceProperty[]
            const field = fields.find(t => t.name == fragmentId.name && t.schemaId == fragmentId.schemaId);
            if(!field) return;
            const dbTables = deletePropertyToDBTables(field, fields);
            return saveDBToPath(this, file.path, dbTables)
        }
        if (fragmentType == 'table') {
            return deleteMDBTable(this, fragmentId, file.path);
        }
        if (fragmentType == 'mdbCommand') {
            return deleteMDBTable(this, fragmentId, file.path);
        }
    }
    
}
