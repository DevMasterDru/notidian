import fs from "fs";
import path from "path";
import initSqlJs from "sql.js";
import type { SqlJsStatic } from "sql.js";

jest.mock("./db/sqljs", () => ({
  loadSQL: async () => { throw new Error("test injects the real sql.js instance"); },
}));

import { MDBFileTypeAdapter } from "./mdbAdapter";
import { getMDBTable } from "./utils/mdb";
import { replaceDB } from "./db/db";
import { PathPropertyName } from "shared/types/context";
import { SpaceProperty } from "shared/types/mdb";

const loadRealSqlJS = async (): Promise<SqlJsStatic> => {
  const wasm = fs.readFileSync(path.join(path.dirname(require.resolve("sql.js")), "sql-wasm.wasm"));
  return initSqlJs({
    wasmBinary: wasm.buffer.slice(wasm.byteOffset, wasm.byteOffset + wasm.byteLength) as ArrayBuffer,
  });
};

describe("MDBFileTypeAdapter atomic table mutation (real sql.js boundary)", () => {
  let SQL: SqlJsStatic;

  beforeAll(async () => {
    SQL = await loadRealSqlJS();
  }, 60000);

  it("preserves concurrent row appends and field deltas for a non-default schema", async () => {
    const dbPath = "Space/.notidian/context.mdb";
    const files = new Map<string, ArrayBuffer>();
    const db = new SQL.Database();
    replaceDB(db, {
      m_schema: {
        uniques: ["id"],
        cols: ["id", "name", "type", "def", "predicate", "primary"],
        rows: [{ id: "alternate", name: "Alternate", type: "db", def: "", predicate: "", primary: "" }],
      },
      m_fields: {
        uniques: ["name,schemaId"],
        cols: ["name", "schemaId", "type", "value", "hidden", "attrs", "unique", "primary"],
        rows: [{ name: PathPropertyName, schemaId: "alternate", type: "file" }],
      },
      alternate: {
        uniques: [],
        cols: [PathPropertyName],
        rows: [{ [PathPropertyName]: "Base.md" }],
      },
    });
    files.set(dbPath, db.export().buffer as ArrayBuffer);
    db.close();

    const middleware = {
      fileExists: async (candidate: string) => files.has(candidate),
      readBinaryToFile: async (candidate: string) => files.get(candidate) ?? null,
      writeBinaryToFile: async (candidate: string, bytes: ArrayBuffer) => { files.set(candidate, bytes); },
      createFolder: async (): Promise<void> => undefined,
      renameFile: async (from: string, to: string) => {
        const bytes = files.get(from);
        if (bytes) { files.set(to, bytes); files.delete(from); }
        return to;
      },
      deleteFile: async (candidate: string): Promise<void> => { files.delete(candidate); },
    };
    const adapter = new MDBFileTypeAdapter({ superstate: { ui: { error: jest.fn() } } } as any);
    adapter.middleware = middleware as any;
    adapter.sqlJS = async () => SQL;
    const file = { path: dbPath, extension: "mdb" } as any;

    await Promise.all([
      adapter.saveContent(file, "mdbTable", "alternate", current => ({
        ...current,
        cols: [...current.cols, { name: "Alpha", schemaId: "alternate", type: "text", source: "notidian" }],
        rows: [...current.rows, { [PathPropertyName]: "Alpha.md", Alpha: "a" }],
      })),
      adapter.saveContent(file, "mdbTable", "alternate", current => ({
        ...current,
        cols: [...current.cols, { name: "Beta", schemaId: "alternate", type: "text", source: "notidian" }],
        rows: [...current.rows, { [PathPropertyName]: "Beta.md", Beta: "b" }],
      })),
    ]);

    const persisted = await getMDBTable(adapter, dbPath, "alternate");
    expect(persisted.rows.map(row => row[PathPropertyName])).toEqual(["Base.md", "Alpha.md", "Beta.md"]);
    expect(persisted.cols.map(col => col.name)).toEqual([PathPropertyName, "Alpha", "Beta"]);
  });

  it("repairs partially missing physical fields for every schema before a queued mutation", async () => {
    const dbPath = "Space/.notidian/missing-fields.mdb";
    const files = new Map<string, ArrayBuffer>();
    const db = new SQL.Database();
    replaceDB(db, {
      m_schema: {
        uniques: ["id"],
        cols: ["id", "name", "type", "def", "predicate", "primary"],
        rows: [
          { id: "alternate", name: "Alternate", type: "db", def: "", predicate: "", primary: "" },
          { id: "sibling", name: "Sibling", type: "db", def: "", predicate: "", primary: "" },
        ],
      },
      m_fields: {
        uniques: ["name,schemaId"],
        cols: ["name", "schemaId", "type", "value", "source", "attrs", "hidden", "unique", "primary"],
        rows: [
          {
            name: "Owner", schemaId: "alternate", type: "number", value: "7",
            source: "notidian", attrs: "owner-attrs", hidden: "true",
          },
          { name: PathPropertyName, schemaId: "alternate", type: "file", source: "" },
          {
            name: "Stage", schemaId: "sibling", type: "text", value: "todo",
            source: "notidian", attrs: "stage-attrs",
          },
          { name: PathPropertyName, schemaId: "sibling", type: "file", source: "" },
          // Physical `Priority` and `Due` intentionally have no metadata rows.
        ],
      },
      alternate: {
        uniques: [],
        cols: [PathPropertyName, "Priority", "Owner"],
        rows: [
          { [PathPropertyName]: "Alpha.md", Priority: "high", Owner: "Ada" },
          { [PathPropertyName]: "Beta.md", Priority: "low", Owner: "Ben" },
        ],
      },
      sibling: {
        uniques: [],
        cols: [PathPropertyName, "Stage", "Due"],
        rows: [
          { [PathPropertyName]: "Gamma.md", Stage: "todo", Due: "2026-08-01" },
          { [PathPropertyName]: "Delta.md", Stage: "done", Due: "2026-08-02" },
        ],
      },
    });
    files.set(dbPath, db.export().buffer as ArrayBuffer);
    db.close();
    const middleware = {
      fileExists: async (candidate: string) => files.has(candidate),
      readBinaryToFile: async (candidate: string) => files.get(candidate) ?? null,
      writeBinaryToFile: async (candidate: string, bytes: ArrayBuffer) => { files.set(candidate, bytes); },
      createFolder: async (): Promise<void> => undefined,
      renameFile: async (from: string, to: string) => {
        const bytes = files.get(from);
        if (bytes) { files.set(to, bytes); files.delete(from); }
        return to;
      },
      deleteFile: async (candidate: string): Promise<void> => { files.delete(candidate); },
    };
    const adapter = new MDBFileTypeAdapter({ superstate: { ui: { error: jest.fn() } } } as any);
    adapter.middleware = middleware as any;
    adapter.sqlJS = async () => SQL;
    let colsSeenByTransform: Array<{ name: string; schemaId?: string; type: string; source?: string }> = [];

    await expect(adapter.saveContent(
      { path: dbPath, extension: "mdb" } as any,
      "mdbTable",
      "alternate",
      current => {
        colsSeenByTransform = current.cols.map(({ name, schemaId, type, source }: SpaceProperty) => ({ name, schemaId, type, source }));
        return {
          ...current,
          cols: [
            ...current.cols,
            { name: "Status", schemaId: "alternate", type: "text", source: "notidian" },
          ],
          rows: [...current.rows, { [PathPropertyName]: "Added.md", Priority: "medium", Owner: "Cia", Status: "open" }],
        };
      },
    )).resolves.toBe(true);

    expect(colsSeenByTransform).toEqual([
      { name: "Owner", schemaId: "alternate", type: "number", source: "notidian" },
      { name: PathPropertyName, schemaId: "alternate", type: "file", source: "" },
      { name: "Priority", schemaId: "alternate", type: "text", source: "notidian" },
    ]);

    const target = await getMDBTable(adapter, dbPath, "alternate");
    const sibling = await getMDBTable(adapter, dbPath, "sibling");
    expect(target.cols.map(({ name, schemaId, type, source }) => ({ name, schemaId, type, source }))).toEqual([
      { name: "Owner", schemaId: "alternate", type: "number", source: "notidian" },
      { name: PathPropertyName, schemaId: "alternate", type: "file", source: "" },
      { name: "Priority", schemaId: "alternate", type: "text", source: "notidian" },
      { name: "Status", schemaId: "alternate", type: "text", source: "notidian" },
    ]);
    expect(target.cols.find(({ name }) => name === "Owner")).toMatchObject({
      value: "7", attrs: "owner-attrs", hidden: "true",
    });
    expect(target.rows).toEqual([
      { [PathPropertyName]: "Alpha.md", Priority: "high", Owner: "Ada", Status: "" },
      { [PathPropertyName]: "Beta.md", Priority: "low", Owner: "Ben", Status: "" },
      { [PathPropertyName]: "Added.md", Priority: "medium", Owner: "Cia", Status: "open" },
    ]);
    expect(sibling.cols.map(({ name, schemaId, type, source }) => ({ name, schemaId, type, source }))).toEqual([
      { name: "Stage", schemaId: "sibling", type: "text", source: "notidian" },
      { name: PathPropertyName, schemaId: "sibling", type: "file", source: "" },
      { name: "Due", schemaId: "sibling", type: "text", source: "notidian" },
    ]);
    expect(sibling.cols.find(({ name }) => name === "Stage")).toMatchObject({
      value: "todo", attrs: "stage-attrs",
    });
    expect(sibling.rows).toEqual([
      { [PathPropertyName]: "Gamma.md", Stage: "todo", Due: "2026-08-01" },
      { [PathPropertyName]: "Delta.md", Stage: "done", Due: "2026-08-02" },
    ]);

    const persistedDB = new SQL.Database(new Uint8Array(files.get(dbPath)!));
    const columns = (table: string) => persistedDB.exec(`PRAGMA table_info("${table}")`)[0].values.map(row => row[1]);
    const fieldOrder = persistedDB.exec(`SELECT "schemaId", "name" FROM "m_fields" ORDER BY rowid`)[0].values;
    expect(columns("alternate")).toEqual(["Owner", PathPropertyName, "Priority", "Status"]);
    expect(columns("sibling")).toEqual([PathPropertyName, "Stage", "Due"]);
    expect(fieldOrder).toEqual([
      ["sibling", "Stage"],
      ["sibling", PathPropertyName],
      ["sibling", "Due"],
      ["alternate", "Owner"],
      ["alternate", PathPropertyName],
      ["alternate", "Priority"],
      ["alternate", "Status"],
    ]);
    persistedDB.close();
  });
});
