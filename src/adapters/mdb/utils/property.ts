import { fieldSchema } from "shared/schemas/fields";
import { DBTables, SpaceProperty } from "shared/types/mdb";
import { sanitizeColumnName } from "shared/utils/sanitizers";
import { uniqueNameFromString } from "shared/utils/array";

export const savePropertyToDBTables = (newColumn: SpaceProperty, fields: SpaceProperty[], oldColumn?: SpaceProperty): DBTables => {
    // Resolve the slot being replaced by the table's OWN identity key
    // (name AND schemaId) — the same key the callers use to resolve `oldColumn`
    // (mdbAdapter.saveContent/deleteContent: `t.name == fragmentId.name &&
    // t.schemaId == fragmentId.schemaId`) and that deletePropertyToDBTables
    // filters on. `fields` here is the WHOLE m_fields table across every schemaId
    // (getMDBTableProperties does `SELECT * FROM m_fields` with no schemaId
    // filter), where same-name fields in different schemas (e.g. the per-schema
    // `Name`/path `File` defaults) are the NORM. A name-ONLY match would point at
    // a wrong-schema row, clobbering it AND defeating the self-collision exclusion
    // below (the genuine same-schema slot would stay in the collision set, so a
    // no-op type/format edit would spuriously suffix the unchanged name).
    const oldFieldIndex = oldColumn
      ? fields.findIndex((f) => f.name == oldColumn.name && f.schemaId == oldColumn.schemaId)
      : -1;

    // m_fields declares unique key `name,schemaId` (fieldSchema.uniques). Without
    // a dedup here the builder can emit two rows with the same (name,schemaId)
    // when the sanitized new name collides with an existing field — violating the
    // table's own contract. So, mirroring the CSV-import sibling (tableCsv.ts /
    // parseCsvToRecords, which dedups headers via uniqueNameFromString), route the
    // sanitized new name through uniqueNameFromString. The collision set is scoped
    // to the SAME schemaId (cross-schemaId same-name fields are legitimately
    // distinct rows and must NOT be deduped against each other) and, on the RENAME
    // path, EXCLUDES the slot being replaced (oldFieldIndex) so a rename that keeps
    // its own name is a no-op rather than a self-collision.
    const sanitizedName = sanitizeColumnName(newColumn.name);
    const existingNamesInSameSchemaId = fields
      .filter((f, i) => i != oldFieldIndex && f.schemaId == newColumn.schemaId)
      .map((f) => f.name);
    const column = {
      ...newColumn,
      name: uniqueNameFromString(sanitizedName, existingNamesInSameSchemaId),
    };

    const newFields: SpaceProperty[] =
      oldFieldIndex == -1
        ? [...fields, column]
        : fields.map((f, i) => (i == oldFieldIndex ? column : f));
    return {
        m_fields: {
            uniques: fieldSchema.uniques,
            cols: fieldSchema.cols,
            rows: newFields,
          },
    };
  };

  export const deletePropertyToDBTables = (column: SpaceProperty, fields: SpaceProperty[]): DBTables => {
    const newFields = fields.filter((f) => !(f.name == column.name && f.schemaId == column.schemaId));
    return {
        m_fields: {
            uniques: fieldSchema.uniques,
            cols: fieldSchema.cols,
            rows: [...newFields],
          },
    };
  } 