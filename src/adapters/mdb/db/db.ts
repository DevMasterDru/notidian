import { getParentPathFromString } from "utils/path";

import { MDBFileTypeAdapter } from "adapters/mdb/mdbAdapter";
import JSZip from "jszip";
import { DBRow, DBRows, DBTable, DBTables, SpaceTables } from "shared/types/mdb";
import { stableCanonicalByKey, uniqByKey, uniqCaseInsensitive } from "shared/utils/array";
import { removeTrailingSlashFromFolder } from "shared/utils/paths";
import { quoteIdent, sanitizeSQLStatement } from "shared/utils/sanitizers";
import { Database, QueryExecResult, SqlJsStatic } from "sql.js";
import { serializeSQLFieldNames, serializeSQLStatements, serializeSQLValues } from "utils/serializers";

JSZip.support.nodebuffer = false;

const dbPathWriteQueues = new Map<string, Promise<void>>();

export const withDBPathWriteQueue = async <T>(
  path: string,
  operation: () => Promise<T>
): Promise<T> => {
  const previous = dbPathWriteQueues.get(path) ?? Promise.resolve();
  let releaseCurrent: () => void = () => {};
  const current = new Promise<void>((resolve) => {
    releaseCurrent = resolve;
  });
  const tail = previous.catch(() => {}).then(() => current);
  dbPathWriteQueues.set(path, tail);

  await previous.catch(() => {});
  try {
    return await operation();
  } finally {
    releaseCurrent();
    if (dbPathWriteQueues.get(path) === tail) {
      dbPathWriteQueues.delete(path);
    }
  }
};

export const getDBFile = async (plugin: MDBFileTypeAdapter,
  path: string, isRemote: boolean) => {
  if (isRemote) {
    return fetch(path).then((res) => res.arrayBuffer());
  }
  if (!(await plugin.middleware.fileExists(path))) {
    return null;
  }
  const file = await plugin.middleware.readBinaryToFile(
    path
  );
  return file;
};

// missing  -> no file on disk (a fresh empty DB is the correct initial state)
// ok       -> file exists and parses as a readable database
// corrupt  -> file exists but is not a readable database. Critically distinct
//             from "missing": callers must NOT silently overwrite a corrupt file
//             with a fresh empty DB, or recoverable view/context state is lost.
//             See bd Notidian-44c.
export type DBOpenStatus = "missing" | "ok" | "corrupt";

const isReadableDB = (db: Database): boolean => {
  try {
    db.exec("SELECT name FROM sqlite_schema");
    return true;
  } catch {
    return false;
  }
};

const openDBFromBuffer = (
  sqlJS: SqlJsStatic,
  buf: ArrayBuffer | null
): { db: Database; status: DBOpenStatus } => {
  if (!buf) {
    return { db: new sqlJS.Database(), status: "missing" };
  }
  let db: Database;
  try {
    db = new sqlJS.Database(new Uint8Array(buf));
  } catch {
    return { db: new sqlJS.Database(), status: "corrupt" };
  }
  if (isReadableDB(db)) {
    return { db, status: "ok" };
  }
  db.close();
  return { db: new sqlJS.Database(), status: "corrupt" };
};

export const openDBWithStatus = async (
  plugin: MDBFileTypeAdapter,
  sqlJS: SqlJsStatic,
  path: string,
  isRemote?: boolean,
): Promise<{ db: Database; status: DBOpenStatus }> => {
  const buf = await getDBFile(plugin, path, isRemote);
  return openDBFromBuffer(sqlJS, buf as ArrayBuffer | null);
};

export const openZippedDBWithStatus = async (
  plugin: MDBFileTypeAdapter,
  sqlJS: SqlJsStatic,
  path: string,
  isRemote?: boolean,
): Promise<{ db: Database; status: DBOpenStatus }> => {
  if (!isRemote && !(await plugin.middleware.fileExists(path))) {
    return openDBFromBuffer(sqlJS, null);
  }
  const buf = await getZippedDBFile(plugin, path, isRemote);
  if (!isRemote && !buf) {
    return { db: new sqlJS.Database(), status: "corrupt" };
  }
  return openDBFromBuffer(sqlJS, buf as ArrayBuffer | null);
};

// Best-effort quarantine: copy the unreadable bytes to a timestamped sibling so
// the user can attempt recovery, instead of leaving the file to be overwritten.
export const quarantineCorruptDBFile = async (
  plugin: MDBFileTypeAdapter,
  path: string,
  isZipped: boolean,
) => {
  try {
    const buf = isZipped
      ? await plugin.middleware.readBinaryToFile(path)
      : await getDBFile(plugin, path, false);
    if (!buf) return;
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    await plugin.middleware.writeBinaryToFile(
      `${path}.corrupt-${stamp}.bak`,
      buf as ArrayBuffer
    );
  } catch (e) {
    // Quarantine is best-effort; never let it block the refuse-to-overwrite path.
  }
};

export const refuseCorruptDBWrite = async (
  plugin: MDBFileTypeAdapter,
  path: string,
  isZipped: boolean,
) => {
  await quarantineCorruptDBFile(plugin, path, isZipped);
  console.warn(
    `[notidian] Refusing to overwrite unreadable database at ${path}; original left in place (a .corrupt-*.bak copy was made).`
  );
};

export const getDB = async (
  plugin: MDBFileTypeAdapter,
  sqlJS: SqlJsStatic,
  path: string,
  isRemote?: boolean,
) => {
  const { db, status } = await openDBWithStatus(plugin, sqlJS, path, isRemote);
  if (status === "corrupt") {
    db.close();
    return null;
  }
  return db;
};

export const getZippedDB =  async (
  plugin: MDBFileTypeAdapter,
  sqlJS: SqlJsStatic,
  path: string,
  isRemote?: boolean,
) => {
  const { db, status } = await openZippedDBWithStatus(plugin, sqlJS, path, isRemote);
  if (status === "corrupt") {
    db.close();
    return null;
  }
  return db;
};

export const getZippedDBFile = async (plugin: MDBFileTypeAdapter,
  path: string, isRemote: boolean) => {
  if (isRemote) {
    return fetch(path).then((res) => res.arrayBuffer());
  }
  if (!(await plugin.middleware.fileExists(path))) {
    return null;
  }
  const zip = new JSZip();

  const file = await plugin.middleware.readBinaryToFile(
    path
  );
  let buffer;
  try {
    buffer = await zip.loadAsync(file).then(f => zip.file("data.mdb").async("arraybuffer"))
  } catch (e) {
  }
  return buffer;
};

const ensureDBParentFolder = async (plugin: MDBFileTypeAdapter, path: string) => {
  const parentPath = getParentPathFromString(path);
  if (
    !(await plugin.middleware.fileExists(
      removeTrailingSlashFromFolder(parentPath)
    ))
  ) {
    await plugin.middleware.createFolder(parentPath);
  }
};

const tempPathForDBWrite = (path: string) =>
  `${path}.tmp-${Date.now()}-${Math.random().toString(36).slice(2)}`;

const cleanupTempDBFile = async (plugin: MDBFileTypeAdapter, path: string) => {
  const deleteFile = (plugin.middleware as any).deleteFile;
  if (typeof deleteFile !== "function") return;
  try {
    if (await plugin.middleware.fileExists(path)) {
      await deleteFile.call(plugin.middleware, path);
    }
  } catch {
  }
};

const verifyTempDBReadable = async (
  plugin: MDBFileTypeAdapter,
  path: string,
  isZipped: boolean,
) => {
  const sqlJS = await plugin.sqlJS();
  const { db, status } = isZipped
    ? await openZippedDBWithStatus(plugin, sqlJS, path)
    : await openDBWithStatus(plugin, sqlJS, path);
  db.close();
  if (status !== "ok") {
    throw new Error(`[notidian] Refusing to save unreadable temporary database at ${path}`);
  }
};

const writeBinaryToFileWithTempReplace = async (
  plugin: MDBFileTypeAdapter,
  path: string,
  binary: ArrayBuffer,
  isZipped: boolean,
) => {
  await ensureDBParentFolder(plugin, path);
  const tempPath = tempPathForDBWrite(path);
  try {
    await plugin.middleware.writeBinaryToFile(tempPath, binary);

    const renameFile = (plugin.middleware as any).renameFile;
    if (typeof renameFile === "function") {
      const finalPath = await renameFile.call(plugin.middleware, tempPath, path);
      if (finalPath === path) {
        return;
      }
    }

    // Without a usable rename primitive, the fallback target write is non-atomic.
    await verifyTempDBReadable(plugin, tempPath, isZipped);
    await plugin.middleware.writeBinaryToFile(path, binary);
  } finally {
    await cleanupTempDBFile(plugin, tempPath);
  }
};

export const saveZippedDBFile = async (plugin: MDBFileTypeAdapter, path: string, binary: ArrayBuffer) => {
  const zip = new JSZip();
  zip.file("data.mdb", binary)
  const zipFile = await zip.generateAsync({type : "arraybuffer", compression: "DEFLATE",
  compressionOptions: {
      level: 5
  }});
  const file = writeBinaryToFileWithTempReplace(
    plugin,
    path,
    zipFile,
    true
  );
  return file;
}

export const saveDBFile = async (plugin: MDBFileTypeAdapter, path: string, binary: ArrayBuffer) => {
  const file = writeBinaryToFileWithTempReplace(
    plugin,
    path,
    binary,
    false
  );
  return file;
};



export const mdbTablesToDBTables = (tables: SpaceTables, uniques?: { [x: string] : string[] }) : DBTables => {
  return Object.keys(tables).reduce((p, c) => {
    return {
      ...p,
      [c]: {
        uniques: uniques?.[c] ?? [],
        cols: tables[c].cols.map((f) => f.name),
        rows: tables[c].rows
      },
    };
  }, {}) as DBTables;
  
}

export const dbResultsToDBTables = (res: QueryExecResult[]): DBTable[] => {
  return res.reduce(
    (p, c, i) => [
      ...p,
      {
        cols: c.columns,
        rows: c
          ? c.values.map((r) =>
              c.columns.reduce(
                (prev, curr, index) => ({ ...prev, [curr]: r[index] }),
                {}
              )
            )
          : [],
      },
    ],
    []
  ) as DBTable[];
};



export const selectDB = (
  db: Database,
  table: string,
  condition?: string,
  fields?: string
): DBTable | null => {
  const fieldsStr = fields ?? "*";
  const sqlstr = condition
    ? `SELECT ${fieldsStr} FROM ${quoteIdent(table)} WHERE ${condition};`
    : `SELECT ${fieldsStr} FROM ${quoteIdent(table)};`;
  let tables;
  try {
    tables = dbResultsToDBTables(db.exec(sqlstr)); // Run the query without returning anything
  } catch (e) {
    return null;
  }
  if (tables.length == 1) return tables[0];
  return null;
};

export const insertIntoDB = (
  db: Database,
  tables: DBTables,
  replace?: boolean
) => {
  // ADR 0046 (Option C, folded onto the ADR 0045 / Notidian-k778 SQL-builder
  // pass): build per-row statements via .map() and let serializeSQLStatements
  // ('; ') own ALL separators, instead of a reduce seeded with "" + a `${prev} `
  // prefix. That seed produced a leading space on every statement and — once the
  // join added its own '; ' between per-table rows that already ended in ';' — a
  // ';;  ' double-semicolon seam. Both were benign no-ops (empty statements), but
  // are now removed at the source so the emitted SQL is clean: a single '; '
  // separator and no leading space.
  const sqlstr = serializeSQLStatements(Object.keys(tables)
    .flatMap((t) => {
      const tableFields = tables[t].cols;
      return tables[t].rows.map((curr) => {
        return `${
          replace ? "REPLACE" : "INSERT"
        } INTO ${quoteIdent(t)} VALUES (${serializeSQLValues(tableFields
          .map((c) => `'${sanitizeSQLStatement(curr?.[c]) ?? ""}'`)
          )})`;
      });
    })
    );
  try {
    db.exec(`${sqlstr}`);
  } catch (e) {
  }
};


export const updateDB = (
  db: Database,
  tables: DBTables,
  updateCol: string,
  updateRef: string
) => {
  // ADR 0046 (Option C): same array+join cleanup as insertIntoDB — per-row
  // statements via .map(), separators owned by serializeSQLStatements ('; '),
  // dropping the reduce seed's leading space and the ';;  ' two-table seam.
  const sqlstr = serializeSQLStatements(Object.keys(tables)
    .flatMap((t) => {
      const tableFields = tables[t].cols.filter((f) => f != updateRef);
      return tables[t].rows.map((curr) => {
        return `UPDATE ${quoteIdent(t)} SET ${serializeSQLValues(tableFields
          .map((c) => `${quoteIdent(c)}='${sanitizeSQLStatement(curr?.[c]) ?? ""}'`)
          )} WHERE ${quoteIdent(updateCol)}='${
          sanitizeSQLStatement(curr?.[updateRef]) ?? ""
        }'`;
      });
    })
    );
  try {
    db.exec(sqlstr);
  } catch (e) {
  }
};

export const execQuery = (db: Database, sqlstr: string) => {
  //Fastest, but doesn't handle errors
  // Run the query without returning anything
  try {
    db.exec(sqlstr);
  } catch (e) {
  }
};


export const deleteFromDB = (
  db: Database,
  table: string,
  condition: string
) => {
  const sqlstr = `DELETE FROM ${quoteIdent(table)} WHERE ${condition};`;
  // Run the query without returning anything
  try {
    db.exec(sqlstr);
  } catch (e) {
  }
};

export const dropTable = (db: Database, table: string) => {
  const sqlstr = `DROP TABLE IF EXISTS ${quoteIdent(table)};`;
  // Run the query without returning anything
  try {
    db.exec(sqlstr);
  } catch (e) {
  }
};



export const replaceDB = (db: Database, tables: DBTables) => {
  //rewrite the entire table, useful for storing ranks and col order, not good for performance
  const sqlStatements : string[] = [];
  // Notidian-yu9c: warn at most once per replaceDB call (not once per skipped
  // entry) so a stale schema doesn't spam the console across many tables.
  let warnedMissingUniqueColumn = false;
  for (const t of Object.keys(tables)) {
      const tableFields = tables[t].cols;
      // Notidian-buqr: m_fields is a ROW-based table — a field's `name` is a row
      // VALUE, not a SQLite identifier — so it can hold BOTH "Status" and "status"
      // for one schemaId (its unique key `name,schemaId` uses SQLite's default
      // case-SENSITIVE BINARY collation). But the PHYSICAL data table those rows
      // describe cannot: liveCols below folds column identifiers case-INSENSITIVELY
      // (SQLite folds identifier case), so it carries only the first-seen casing.
      // Left unchecked, m_fields would report more columns than the table has. Fold
      // the m_fields rows with the SAME first-seen-wins rule, per schemaId, so the
      // persisted field list and the physical table stay in permanent agreement.
      // Whole rows survive verbatim — no field merge, no source/authority tie-break
      // (that would risk crossing the frontmatter<->notidian boundary, ADR
      // 0001/0014/0017).
      //
      // Notidian-rcvg: BOTH folds — this m_fields-ROW fold and the liveCols COLUMN
      // fold below — are first-seen passes, but over two INDEPENDENTLY-built arrays
      // (mdbTablesToDBTables derives the data cols from `tables[c].cols`; the
      // m_fields rows are assembled separately by callers — e.g. `SELECT * FROM
      // m_fields` with no ORDER BY, or mergeFrameFields concatenation). So a raw
      // first-seen survivor is input-ORDER-dependent: the same schema can persist
      // "Status" from one save-path assembly and "status" from another, and the two
      // folds can even keep DIFFERENT casings, drifting the persisted field name
      // from its physical column. stableCanonicalByKey pre-sorts BOTH folds by an
      // authority-neutral name-string tie-break (NOT a source/authority preference),
      // so the SAME survivor and casing win every time, whatever the input order.
      const mFieldRowKey = (r: DBRow) =>
        JSON.stringify([r?.schemaId ?? "", String(r?.name ?? "").toLowerCase()]);
      const liveRows =
        t === "m_fields"
          ? uniqByKey(
              stableCanonicalByKey(tables[t].rows ?? [], mFieldRowKey, (r) =>
                String(r?.name ?? "")
              ),
              mFieldRowKey
            )
          : tables[t].rows ?? [];
      // ADR 0045 (Option A) / Notidian-k778: derive ONE de-duped, falsy-filtered
      // column list and use it for BOTH the CREATE field definition AND the
      // REPLACE rows, so the emitted statement is correct by construction —
      // count- AND position-matched for any cols (dup, empty, or reordered).
      // Notidian-1q8y: the dedup is case-INSENSITIVE (first-seen casing wins)
      // because SQLite folds identifier case — "Status" and "status" in one
      // CREATE TABLE throw `duplicate column name` and fail the whole save.
      // Notidian-rcvg: the same stableCanonicalByKey pre-sort feeds this fold, so
      // the surviving COLUMN casing matches the m_fields-row survivor above (they
      // share the name-string tie-break) regardless of either array's input order.
      // A collision-free cols list is returned unchanged, so column order is
      // preserved for the normal (non-corrupt) case.
      const liveCols = uniqCaseInsensitive(
        stableCanonicalByKey(
          tableFields.filter((f) => f),
          (f) => f.toLowerCase(),
          (f) => f
        )
      );
      if (liveCols.length === 0) {
        // Notidian-jn8p: SQLite has no zero-column tables, so there is no
        // CREATE to pair with the DROP below. Never DROP without recreating:
        // with rows present the write would silently destroy them AND leave
        // m_schema referencing a missing table (which used to make the whole
        // .mdb unloadable via getMDB), so REFUSE the entire write; with no
        // rows the table is skipped as a no-op.
        if (liveRows.length > 0) return false;
        continue;
      }
      const fieldQuery = serializeSQLFieldNames(liveCols.map((f) => `${quoteIdent(f)} char`));
      // Explicit column list removes the positional coupling between the created
      // column order and the VALUES order: REPLACE INTO "t" ("a","b") VALUES (...).
      const colList = serializeSQLFieldNames(liveCols.map((f) => quoteIdent(f)));

      const createQuery = `CREATE TABLE IF NOT EXISTS ${quoteIdent(t)} (${fieldQuery}); `
      const idxQuery = tables[t].uniques
        .filter((f) => f)
        .filter((c) => {
          // Notidian-yu9c: sql.js/SQLite's double-quoted-string (DQS)
          // misfeature means CREATE UNIQUE INDEX ... ON t("no_such_col")
          // does NOT throw when the column is absent -- it silently falls
          // back to treating the quoted identifier as a STRING LITERAL,
          // building a unique index over a CONSTANT expression. Every row
          // then shares that one constant key, so the REPLACE INTO below
          // silently collapses a multi-row table down to its last row. A
          // uniques entry can only drift out of sync with liveCols via a
          // stale/hand-edited schema (today's normal path derives both from
          // the same cols array), but when it does, skip the whole entry
          // (composite indexes are all-or-nothing -- a partially-applied
          // subset would silently change uniqueness semantics) rather than
          // let DQS paper over a missing column. The match is
          // case-insensitive, symmetric with the uniqCaseInsensitive fold
          // already applied to liveCols above (SQLite itself resolves
          // identifiers case-insensitively).
          const missing = c
            .split(",")
            .map((col) => col.trim())
            .filter(
              (col) =>
                !liveCols.some((lc) => lc.toLowerCase() === col.toLowerCase())
            );
          if (missing.length > 0) {
            if (!warnedMissingUniqueColumn) {
              console.warn(
                `Notidian: skipping unique index "${c}" on table "${t}" -- column(s) ${missing
                  .map((m) => `"${m}"`)
                  .join(", ")} not found (would otherwise hit SQLite's DQS misfeature and build a constant-expression index)`
              );
              warnedMissingUniqueColumn = true;
            }
            return false;
          }
          return true;
        })
        .reduce((p, c) => {
          const indexName = `idx_${t}_${c.replace(/,/g, "_")}`;
          const indexCols = c.split(",").map((f) => quoteIdent(f.trim())).join(",");
          return `${p} CREATE UNIQUE INDEX IF NOT EXISTS ${quoteIdent(indexName)} ON ${quoteIdent(t)}(${indexCols});`;
        }, "");
      const beginTransaction = `BEGIN TRANSACTION;`
      const rowsQuery = liveRows.map((curr) => {
        return `REPLACE INTO ${quoteIdent(t)} (${colList}) VALUES (${serializeSQLValues(liveCols
          .map((c) => `'${sanitizeSQLStatement(curr?.[c] ?? "")}'`))});`;
      });
      const commitQuery = `COMMIT;`;
      // Notidian-jn8p: the DROP..CREATE..rows sequence rides INSIDE one
      // transaction so a mid-sequence exec failure can never leave the
      // in-memory DB with the table dropped but not recreated — the catch
      // below rolls the open transaction back before reporting failure.
      sqlStatements.push(beginTransaction);
      sqlStatements.push(`DROP INDEX IF EXISTS ${quoteIdent(`idx_${t}__id`)}; DROP TABLE IF EXISTS ${quoteIdent(t)};`)
      sqlStatements.push(createQuery);
      sqlStatements.push(idxQuery);
      sqlStatements.push(...rowsQuery);
      sqlStatements.push(commitQuery);
  }
  // Run the query without returning anything
  try {
    for (const s of sqlStatements) {
      db.exec(s)
    }
  } catch (e) {
    // Roll back the open per-table transaction so a caller that exports the
    // DB image regardless of the result (saveZippedDBToPath) can never
    // persist a half-replaced table. Best-effort: throws when no transaction
    // is open, which is fine.
    try {
      db.exec(`ROLLBACK;`)
    } catch (rollbackError) {
      // no open transaction to roll back
    }
    return false
  }
  return true;
};

export const saveZippedDBToPath = async (
  plugin: MDBFileTypeAdapter,
  path: string,
  tables: DBTables
): Promise<boolean> => {
  return withDBPathWriteQueue(path, async () => {

  const sqlJS = await plugin.sqlJS();
  //rewrite the entire table, useful for storing ranks and col order, not good for performance
  const { db, status } = await openZippedDBWithStatus(plugin, sqlJS, path);
  if (status === "corrupt") {
    db.close();
    await refuseCorruptDBWrite(plugin, path, true);
    return false;
  }
  if (!db) {
    db.close()
    return false;
  }
  const result = replaceDB(db, tables);
  if (result) {
    await saveZippedDBFile(plugin, path, db.export().buffer as ArrayBuffer);
  }
  db.close();


  return result;
  });
};


export const saveDBToPath = async (
  plugin: MDBFileTypeAdapter,
  path: string,
  tables: DBTables,
  mdb = true
): Promise<boolean> => {
  return withDBPathWriteQueue(path, async () => {

  const sqlJS = await plugin.sqlJS();
  //rewrite the entire table, useful for storing ranks and col order, not good for performance
  const { db, status } = await openDBWithStatus(plugin, sqlJS, path);
  if (status === "corrupt") {
    db.close();
    await refuseCorruptDBWrite(plugin, path, false);
    return false;
  }
  if (!db) {
    db.close()
    return false;
  }
  if (mdb) {
    let mdbStruct : DBRows = []
    try {
      mdbStruct = dbResultsToDBTables(db.exec(`SELECT name FROM sqlite_master WHERE type='table' AND name='m_schema' OR name='m_fields';`))[0]?.rows ?? []
    } catch (e) {
    }
    if (!mdbStruct.some(f => f.name == "m_schema")) {
      const createSchemaTable = `CREATE TABLE ${quoteIdent("m_schema")} (${["id", "name", "type", "def", "predicate", "primary"].map((f) => `${quoteIdent(f)} char`).join(", ")})`
      try {
      db.exec(createSchemaTable);
      } catch(e) {
      }
    }
    if (!mdbStruct.some(f => f.name == "m_fields")) {
      const createFieldsTable = `CREATE TABLE ${quoteIdent("m_fields")} (${["name", "schemaId", "type", "value", "hidden", "attrs", "unique", "primary"].map((f) => `${quoteIdent(f)} char`).join(", ")})`
      try {db.exec(createFieldsTable);
      } catch(e) { 
      }
    }

  }
  const result = replaceDB(db, tables);
if (result) {
  await saveDBFile(plugin, path, db.export().buffer as ArrayBuffer);
}
  
  db.close();

    
  return result;
  });
};
