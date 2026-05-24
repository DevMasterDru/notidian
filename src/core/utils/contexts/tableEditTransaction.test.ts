import { defaultContextSchemaID } from "shared/schemas/context";
import { PathPropertyName } from "shared/types/context";
import { SpaceTable, SpaceTables } from "shared/types/mdb";
import {
  applyTableEditPathOverrides,
  executeTableValueWrites,
  TableCellWrite,
} from "./tableEditTransaction";

const rootTable = (): SpaceTable => ({
  schema: { id: defaultContextSchemaID, name: "Context", type: "context" },
  cols: [
    { name: PathPropertyName, type: "file" },
    { name: "status", type: "text", source: "frontmatter" },
    { name: "rating", type: "number", source: "frontmatter" },
    { name: "local", type: "text" },
  ],
  rows: [
    { [PathPropertyName]: "Relays & Devices/A.md", status: "old" },
    { [PathPropertyName]: "Relays & Devices/B.md", status: "old" },
  ],
});

const contextTables = (): SpaceTables => ({
  "contexts/projects": {
    schema: { id: "projects", name: "Projects", type: "context" },
    cols: [
      { name: PathPropertyName, type: "file" },
      { name: "phase", type: "text" },
    ],
    rows: [
      { [PathPropertyName]: "Relays & Devices/A.md", phase: "old" },
      { [PathPropertyName]: "Relays & Devices/B.md", phase: "old" },
    ],
  },
});

const execute = async ({
  writes,
  table = rootTable(),
  contexts = {},
  frontmatterOk = true,
}: {
  writes: TableCellWrite[];
  table?: SpaceTable;
  contexts?: SpaceTables;
  frontmatterOk?: boolean;
}) => {
  const savedFrontmatter: { path: string; properties: Record<string, unknown> }[] =
    [];
  const savedTables: SpaceTable[] = [];
  const savedContexts: { key: string; table: SpaceTable }[] = [];

  const result = await executeTableValueWrites({
    writes,
    tableData: table,
    contextTable: contexts,
    dbSchemaId: defaultContextSchemaID,
    contextPath: "Relays & Devices",
    saveAllContextToFrontmatter: false,
    resolvePath: (path, contextPath) => `${contextPath}/${path}`,
    shouldWritePropertyToFrontmatter: (column) =>
      column.source == "frontmatter",
    parseValue: (column, value) =>
      column.type == "number" ? Number(value) : value,
    saveFrontmatterProperties: async ({ path, properties }) => {
      savedFrontmatter.push({ path, properties });
      return frontmatterOk ? { ok: true } : { ok: false };
    },
    saveDB: async (nextTable) => {
      savedTables.push(nextTable);
    },
    saveContextDB: async (nextTable, key) => {
      savedContexts.push({ key, table: nextTable });
    },
    contextKeyForTable: (tableName) => `contexts/${tableName}`,
  });

  return {
    result,
    savedFrontmatter,
    savedTables,
    savedContexts,
  };
};

describe("executeTableValueWrites", () => {
  it("applies row path overrides to writes after mixed file rename transactions", () => {
    expect(
      applyTableEditPathOverrides(
        [
          {
            rowId: "0",
            columnName: "status",
            table: "",
            value: "active",
          },
          {
            rowId: "1",
            columnName: "status",
            table: "",
            value: "paused",
          },
        ],
        new Map([["0", "Relays & Devices/Renamed.md"]])
      )
    ).toEqual([
      {
        rowId: "0",
        columnName: "status",
        table: "",
        value: "active",
        path: "Relays & Devices/Renamed.md",
      },
      {
        rowId: "1",
        columnName: "status",
        table: "",
        value: "paused",
      },
    ]);
  });

  it("groups frontmatter writes by resolved row path and applies one root table snapshot", async () => {
    const { result, savedFrontmatter, savedTables } = await execute({
      writes: [
        {
          rowId: "0",
          columnName: "status",
          table: "",
          value: "active",
          path: "",
        },
        {
          rowId: "0",
          columnName: "rating",
          table: "",
          value: "5",
        },
      ],
    });

    expect(result).toMatchObject({ ok: true, applied: 2 });
    expect(savedFrontmatter).toEqual([
      {
        path: "Relays & Devices/Relays & Devices/A.md",
        properties: { status: "active", rating: 5 },
      },
    ]);
    expect(savedTables).toHaveLength(1);
    expect(savedTables[0].rows[0]).toMatchObject({
      status: "active",
      rating: "5",
    });
  });

  it("does not save table snapshots when a canonical frontmatter write fails", async () => {
    const { result, savedTables, savedContexts } = await execute({
      writes: [
        {
          rowId: "0",
          columnName: "status",
          table: "",
          value: "active",
        },
      ],
      frontmatterOk: false,
    });

    expect(result.ok).toBe(false);
    expect(result.failed).toHaveLength(1);
    expect(savedTables).toEqual([]);
    expect(savedContexts).toEqual([]);
  });

  it("applies linked context writes to the matching row path", async () => {
    const { result, savedContexts } = await execute({
      contexts: contextTables(),
      writes: [
        {
          rowId: "1",
          columnName: "phase",
          table: "projects",
          value: "build",
        },
      ],
    });

    expect(result).toMatchObject({ ok: true, applied: 1 });
    expect(savedContexts).toHaveLength(1);
    expect(savedContexts[0].key).toBe("contexts/projects");
    expect(savedContexts[0].table.rows[1]).toMatchObject({ phase: "build" });
  });

  it("reports missing linked context tables as skipped writes", async () => {
    const { result, savedContexts } = await execute({
      writes: [
        {
          rowId: "0",
          columnName: "phase",
          table: "projects",
          value: "build",
        },
      ],
    });

    expect(result).toMatchObject({ ok: true, applied: 0 });
    expect(result.skipped).toEqual([
      expect.objectContaining({ reason: "missing-context-table" }),
    ]);
    expect(savedContexts).toEqual([]);
  });

  it("stores field option updates in the same saved table snapshot as the value", async () => {
    const { savedTables } = await execute({
      writes: [
        {
          rowId: "1",
          columnName: "local",
          table: "",
          value: "manual",
          fieldValue: "manual,auto",
        },
      ],
    });

    expect(savedTables).toHaveLength(1);
    expect(savedTables[0].cols.find((col) => col.name == "local")).toMatchObject(
      { value: "manual,auto" }
    );
    expect(savedTables[0].rows[1]).toMatchObject({ local: "manual" });
  });
});
