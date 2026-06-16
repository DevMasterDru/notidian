import { dbTableToMDBTable, updateFieldsToSchema } from "./mdb";
import { defaultFieldsForContext } from "shared/schemas/fields";
import { defaultContextSchemaID } from "shared/schemas/context";
import { PathPropertyName } from "shared/types/context";
import { DBTable, SpaceProperty, SpaceTableSchema } from "shared/types/mdb";
import { FilesystemSpaceInfo } from "shared/types/spaceInfo";

// ===========================================================================
// DEPTH characterization + adversarial net for the two PURE projection/merge
// seams in src/adapters/mdb/utils/mdb.ts — Notidian-c2ef.
//
// WHY THIS EXISTS. mdb.ts (the MDB deserialization/projection layer feeding the
// in-memory SpaceTable the UI renders) had ZERO test references (grep across
// every *.test.ts). Most of the module is async sql.js-engine-bound and is
// covered indirectly by db.realengine.roundtrip + the getMDB* paths. But two
// helpers are PURE, deterministic, and offline-verifiable, and were uncovered:
//
//   1. dbTableToMDBTable(table, schema, fields) — projects a DBTable into a
//      SpaceTable. It is the final hop in BOTH getMDBTable and getMDBTables: the
//      rows that come out of sql.js are wrapped here before the UI consumes
//      them. The null/undefined-table -> rows-fallback-[] guard
//      (`table?.rows ?? []`) is the difference between an empty-but-valid view
//      and a throw on a freshly-created / partially-read table; the schema/cols
//      pass-through is what the renderer keys its columns off of.
//
//   2. updateFieldsToSchema(fields, space) — merges defaultFieldsForContext(space)
//      onto an existing field list, deduping by (name AND schemaId). This dedup
//      key is the SAME authority invariant as the persisted m_fields unique key
//      "name,schemaId" (fieldSchema.uniques) — the contract pinned for the
//      persistence builder by Notidian-ub72/gm6q. Here it governs the in-memory
//      merge: a default field is appended ONLY when no existing field shares
//      BOTH name and schemaId. Getting this wrong either drops a real default
//      (under-merge) or duplicates a column the user already has (over-merge),
//      both of which the UI would render. updateFieldsToSchema is module-private
//      with no exported caller, so it is `export`ed for-test (a clean, otherwise
//      inert export) and characterized directly rather than reimplemented.
//
// METHOD. Both seams are PURE: input objects/arrays only, no I/O, no clock, no
// randomness. defaultFieldsForContext(space) currently ignores `space` and
// returns the static defaultContextFields table (File + Created, both on the
// "files" schema), so the merge is fully deterministic. Every assertion is
// offline-verifiable. This is a CHARACTERIZATION net first (it pins what the
// code does TODAY) and an ADVERSARIAL net second (the three (name,schemaId)
// corner cases, ordering, and input non-mutation).
//
// CHARACTERIZATION-ONLY DECISION (per the implement route's "production change
// ONLY if a clear-correct bug surfaces"). No production logic was changed: the
// only edit to mdb.ts is the export-for-test keyword on updateFieldsToSchema.
// Both seams behave correctly against their contracts (the fallback guard is
// present; the dedup key is exactly (name && schemaId)); there is no
// clear-correct bug to fix, so this LOCKS the current behavior as a tripwire.
// ===========================================================================

const prop = (over: Partial<SpaceProperty> & { name: string }): SpaceProperty => ({
  type: "text",
  ...over,
});

const schema: SpaceTableSchema = {
  id: "view1",
  name: "View 1",
  type: "db",
  primary: "true",
};

// A throwaway FilesystemSpaceInfo: updateFieldsToSchema only forwards it to
// defaultFieldsForContext, which currently ignores it. Pin that here so the
// merge stays deterministic regardless of the space.
const space = {} as FilesystemSpaceInfo;

describe("dbTableToMDBTable — DBTable -> SpaceTable projection (Notidian-c2ef)", () => {
  const fields: SpaceProperty[] = [
    prop({ name: "Name", schemaId: "view1" }),
    prop({ name: "Count", schemaId: "view1", type: "number" }),
  ];

  it("projects rows verbatim and wires schema + cols(=fields) through", () => {
    const table: DBTable = {
      uniques: [],
      cols: ["Name", "Count"],
      rows: [
        { Name: "a", Count: "1" },
        { Name: "b", Count: "2" },
      ],
    };

    const result = dbTableToMDBTable(table, schema, fields);

    expect(result).toEqual({
      schema,
      cols: fields,
      rows: table.rows,
    });
  });

  it("passes schema, cols, and rows through BY REFERENCE (no copy)", () => {
    const table: DBTable = {
      uniques: [],
      cols: ["Name"],
      rows: [{ Name: "a" }],
    };

    const result = dbTableToMDBTable(table, schema, fields);

    // The projection is a thin wrap, not a deep clone: identity is preserved.
    expect(result.schema).toBe(schema);
    expect(result.cols).toBe(fields);
    expect(result.rows).toBe(table.rows);
  });

  it("falls back to [] rows when table is undefined (the partial-read guard)", () => {
    const result = dbTableToMDBTable(undefined as unknown as DBTable, schema, fields);

    expect(result.rows).toEqual([]);
    expect(result.schema).toBe(schema);
    expect(result.cols).toBe(fields);
  });

  it("falls back to [] rows when table is null", () => {
    const result = dbTableToMDBTable(null as unknown as DBTable, schema, fields);

    expect(result.rows).toEqual([]);
    expect(result.schema).toBe(schema);
    expect(result.cols).toBe(fields);
  });

  it("falls back to [] rows when table.rows is undefined (?? guard, not just ?.)", () => {
    // A DBTable shell with no rows key — the `?? []` half of `table?.rows ?? []`.
    const table = { uniques: [], cols: [] } as unknown as DBTable;

    const result = dbTableToMDBTable(table, schema, fields);

    expect(result.rows).toEqual([]);
  });

  it("preserves an explicitly empty rows array (does not replace [] via ??)", () => {
    const table: DBTable = { uniques: [], cols: [], rows: [] };

    const result = dbTableToMDBTable(table, schema, fields);

    // [] is not nullish, so the same instance flows through.
    expect(result.rows).toBe(table.rows);
    expect(result.rows).toEqual([]);
  });

  it("does NOT mutate any of its inputs", () => {
    const table: DBTable = {
      uniques: [],
      cols: ["Name"],
      rows: [{ Name: "a" }],
    };
    const tableSnapshot = JSON.parse(JSON.stringify(table));
    const fieldsSnapshot = JSON.parse(JSON.stringify(fields));
    const schemaSnapshot = JSON.parse(JSON.stringify(schema));

    dbTableToMDBTable(table, schema, fields);

    expect(table).toEqual(tableSnapshot);
    expect(fields).toEqual(fieldsSnapshot);
    expect(schema).toEqual(schemaSnapshot);
  });
});

describe("updateFieldsToSchema — default-field merge keyed on (name AND schemaId) (Notidian-c2ef)", () => {
  // Pin the default fields this merge folds in, so the assertions below read
  // against a known set rather than a magic number. defaultFieldsForContext
  // returns File + Created, both on the "files" (defaultContextSchemaID) schema.
  const defaults = defaultFieldsForContext(space).rows as SpaceProperty[];

  it("characterizes the default fields being merged (File + Created on 'files')", () => {
    expect(defaults.map((f) => [f.name, f.schemaId])).toEqual([
      [PathPropertyName, defaultContextSchemaID],
      ["Created", defaultContextSchemaID],
    ]);
  });

  it("appends ALL defaults when none collide, existing-first then defaults", () => {
    const fields: SpaceProperty[] = [prop({ name: "Title", schemaId: "view1" })];

    const result = updateFieldsToSchema(fields, space);

    expect(result).toEqual([fields[0], ...defaults]);
    // Ordering contract: existing fields first, surviving defaults appended.
    expect(result.slice(0, fields.length)).toEqual(fields);
  });

  it("EXACT (name,schemaId) match suppresses that default", () => {
    // Existing field shares BOTH name and schemaId with the File default.
    const fields: SpaceProperty[] = [
      prop({ name: PathPropertyName, schemaId: defaultContextSchemaID, type: "file" }),
    ];

    const result = updateFieldsToSchema(fields, space);

    // The File default is suppressed; only Created survives from the defaults.
    const survivingDefaults = defaults.filter((f) => f.name !== PathPropertyName);
    expect(result).toEqual([fields[0], ...survivingDefaults]);
    expect(result.filter((f) => f.name === PathPropertyName)).toHaveLength(1);
  });

  it("SAME name, DIFFERENT schemaId keeps BOTH (the dedup is AND, not name-only)", () => {
    // Same name as the File default but a different schemaId -> not a collision.
    const fields: SpaceProperty[] = [
      prop({ name: PathPropertyName, schemaId: "view1", type: "file" }),
    ];

    const result = updateFieldsToSchema(fields, space);

    // Both the existing File@view1 AND the default File@files must be present.
    const fileRows = result.filter((f) => f.name === PathPropertyName);
    expect(fileRows).toHaveLength(2);
    expect(fileRows.map((f) => f.schemaId).sort()).toEqual(
      ["view1", defaultContextSchemaID].sort()
    );
    // No default was suppressed.
    expect(result).toEqual([fields[0], ...defaults]);
  });

  it("SAME schemaId, DIFFERENT name keeps BOTH (the dedup is AND, not schemaId-only)", () => {
    // Same schemaId as the defaults but a name no default uses -> not a collision.
    const fields: SpaceProperty[] = [
      prop({ name: "Custom", schemaId: defaultContextSchemaID }),
    ];

    const result = updateFieldsToSchema(fields, space);

    expect(result).toEqual([fields[0], ...defaults]);
    // Both defaults survive alongside the same-schemaId custom field.
    expect(result.filter((f) => f.schemaId === defaultContextSchemaID)).toHaveLength(
      1 + defaults.length
    );
  });

  it("suppresses only the colliding default when multiple defaults exist", () => {
    // Collide with Created (exact), leave File untouched.
    const fields: SpaceProperty[] = [
      prop({
        name: "Created",
        schemaId: defaultContextSchemaID,
        type: "fileprop",
        value: PathPropertyName + ".ctime",
      }),
    ];

    const result = updateFieldsToSchema(fields, space);

    const survivingDefaults = defaults.filter((f) => f.name !== "Created");
    expect(result).toEqual([fields[0], ...survivingDefaults]);
    expect(result.filter((f) => f.name === "Created")).toHaveLength(1);
  });

  it("returns ONLY the surviving defaults when fields is empty", () => {
    const result = updateFieldsToSchema([], space);

    expect(result).toEqual(defaults);
  });

  it("does NOT mutate the input fields array or its elements", () => {
    const fields: SpaceProperty[] = [
      prop({ name: PathPropertyName, schemaId: defaultContextSchemaID, type: "file" }),
      prop({ name: "Title", schemaId: "view1" }),
    ];
    const fieldsSnapshot = JSON.parse(JSON.stringify(fields));
    const originalLength = fields.length;

    const result = updateFieldsToSchema(fields, space);

    expect(fields).toEqual(fieldsSnapshot);
    expect(fields).toHaveLength(originalLength);
    // A new array is returned (spread), distinct from the input.
    expect(result).not.toBe(fields);
  });

  it("does NOT mutate defaultContextFields (shared module-level default table)", () => {
    // The merge reads defaultFieldsForContext(space).rows; ensure the shared
    // default table is not mutated across calls (it is returned by reference).
    const before = JSON.parse(JSON.stringify(defaultFieldsForContext(space).rows));

    updateFieldsToSchema([prop({ name: "X", schemaId: "view1" })], space);

    expect(defaultFieldsForContext(space).rows).toEqual(before);
  });
});
