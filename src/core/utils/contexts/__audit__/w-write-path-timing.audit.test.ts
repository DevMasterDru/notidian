import { defaultContextSchemaID } from "shared/schemas/context";
import { PathPropertyName } from "shared/types/context";
import { SpaceTable } from "shared/types/mdb";
import { shouldWriteAuthorityValueToFrontmatter } from "../../properties/propertyAuthority";
import {
  applyTableEditPathOverrides,
  executeTableValueWrites,
  TableCellWrite,
} from "../tableEditTransaction";

const statusColumn = {
  name: "status",
  type: "text",
  source: "frontmatter",
};

const tableWithStatus = (path: string, status: string): SpaceTable => ({
  schema: { id: defaultContextSchemaID, name: "Context", type: "context" },
  cols: [{ name: PathPropertyName, type: "file" }, statusColumn],
  rows: [{ [PathPropertyName]: path, status }],
});

type MetadataStore = Record<string, Record<string, string>>;
type FrontmatterStore = Record<string, Record<string, unknown>>;

const executeWithInjectedMetadata = async ({
  table,
  writes,
  metadata,
  frontmatter,
}: {
  table: SpaceTable;
  writes: TableCellWrite[];
  metadata: MetadataStore;
  frontmatter: FrontmatterStore;
}) => {
  const canonicalReads: { path: string; column: string; value?: string }[] = [];
  const metadataValuesDuringSave: (string | undefined)[] = [];
  const savedFrontmatter: {
    path: string;
    properties: Record<string, unknown>;
  }[] = [];
  const savedTables: SpaceTable[] = [];

  const result = await executeTableValueWrites({
    writes,
    tableData: table,
    contextTable: {},
    dbSchemaId: defaultContextSchemaID,
    resolvePath: (path) => path,
    shouldWritePropertyToFrontmatter: shouldWriteAuthorityValueToFrontmatter,
    parseValue: (_column, value) => value,
    currentFrontmatterValue: ({ path, column }) => {
      const value = metadata[path]?.[column.name];
      canonicalReads.push({ path, column: column.name, value });
      return value;
    },
    saveFrontmatterProperties: async ({ path, properties }) => {
      metadataValuesDuringSave.push(metadata[path]?.status);
      frontmatter[path] = {
        ...(frontmatter[path] ?? {}),
        ...properties,
      };
      savedFrontmatter.push({ path, properties });
      return { ok: true };
    },
    saveDB: async (nextTable) => {
      savedTables.push(nextTable);
    },
    saveContextDB: async () => {
      throw new Error("linked context writes are outside this audit");
    },
    contextKeyForTable: (tableName) => tableName,
  });

  return {
    result,
    canonicalReads,
    metadataValuesDuringSave,
    savedFrontmatter,
    savedTables,
  };
};

describe("audit w: write path timing and rename retargeting", () => {
  it("accepts a normal frontmatter edit even when metadata still shows the old value after save", async () => {
    const path = "Projects/Note.md";
    const metadata: MetadataStore = { [path]: { status: "todo" } };
    const frontmatter: FrontmatterStore = { [path]: { status: "todo" } };

    const { result, canonicalReads, metadataValuesDuringSave, savedFrontmatter, savedTables } =
      await executeWithInjectedMetadata({
        table: tableWithStatus(path, "todo"),
        metadata,
        frontmatter,
        writes: [
          {
            rowId: "0",
            columnId: "status",
            columnName: "status",
            table: "",
            value: "doing",
          },
        ],
      });

    expect(result).toMatchObject({ ok: true, applied: 1, skipped: [] });
    expect(canonicalReads).toEqual([
      { path, column: "status", value: "todo" },
    ]);
    expect(metadataValuesDuringSave).toEqual(["todo"]);
    expect(metadata[path].status).toBe("todo");
    expect(frontmatter[path].status).toBe("doing");
    expect(savedFrontmatter).toEqual([
      { path, properties: { status: "doing" } },
    ]);
    expect(savedTables[0].rows[0]).toMatchObject({ status: "doing" });
  });

  it("skips a stale edit when injected canonical metadata no longer matches the row base value", async () => {
    const path = "Projects/Note.md";
    const metadata: MetadataStore = { [path]: { status: "external" } };
    const frontmatter: FrontmatterStore = { [path]: { status: "external" } };

    const { result, savedFrontmatter, savedTables } =
      await executeWithInjectedMetadata({
        table: tableWithStatus(path, "todo"),
        metadata,
        frontmatter,
        writes: [
          {
            rowId: "0",
            columnId: "status",
            columnName: "status",
            table: "",
            value: "doing",
          },
        ],
      });

    expect(result).toEqual({
      ok: true,
      applied: 0,
      skipped: [
        {
          reason: "frontmatter-conflict",
          currentValue: "external",
          baseValue: "todo",
          attemptedValue: "doing",
          write: {
            rowId: "0",
            columnId: "status",
            columnName: "status",
            table: "",
            value: "doing",
          },
        },
      ],
      failed: [],
    });
    expect(savedFrontmatter).toEqual([]);
    expect(savedTables).toEqual([]);
    expect(frontmatter[path].status).toBe("external");
  });

  it("skips undo replay when metadata lag still shows the pre-edit value", async () => {
    const path = "Projects/Note.md";
    // processFrontMatter has written "doing", but metadataCache/table projection
    // still reflect the old "todo" value. Undo must not write "todo" over the
    // file unless canonical metadata can prove the forward value is current.
    const metadata: MetadataStore = { [path]: { status: "todo" } };
    const frontmatter: FrontmatterStore = { [path]: { status: "doing" } };

    const undoWrite: TableCellWrite = {
      rowId: "0",
      columnId: "status",
      columnName: "status",
      table: "",
      value: "todo",
      path,
      expectedCurrentValue: "doing",
    };
    const { result, savedFrontmatter, savedTables } =
      await executeWithInjectedMetadata({
        table: tableWithStatus(path, "todo"),
        metadata,
        frontmatter,
        writes: [undoWrite],
      });

    expect(result).toEqual({
      ok: true,
      applied: 0,
      skipped: [
        {
          reason: "frontmatter-conflict",
          currentValue: "todo",
          baseValue: "doing",
          attemptedValue: "todo",
          write: undoWrite,
        },
      ],
      failed: [],
    });
    expect(savedFrontmatter).toEqual([]);
    expect(savedTables).toEqual([]);
    expect(frontmatter[path].status).toBe("doing");
  });

  it("retargets a mixed title-and-property paste value write to the renamed path", async () => {
    const oldPath = "Projects/Old.md";
    const newPath = "Projects/New.md";
    const metadata: MetadataStore = {
      [oldPath]: { status: "todo" },
      [newPath]: { status: "todo" },
    };
    const frontmatter: FrontmatterStore = {
      [oldPath]: { status: "todo" },
      [newPath]: { status: "todo" },
    };
    const baseWrites: TableCellWrite[] = [
      {
        rowId: "0",
        columnId: "status",
        columnName: "status",
        table: "",
        value: "done",
      },
    ];
    const retargetedWrites = applyTableEditPathOverrides(
      baseWrites,
      new Map([["0", newPath]])
    );

    const { result, canonicalReads, savedFrontmatter, savedTables } =
      await executeWithInjectedMetadata({
        table: tableWithStatus(oldPath, "todo"),
        metadata,
        frontmatter,
        writes: retargetedWrites,
      });

    expect(retargetedWrites[0].path).toBe(newPath);
    expect(result).toMatchObject({ ok: true, applied: 1, skipped: [] });
    expect(canonicalReads).toEqual([
      { path: newPath, column: "status", value: "todo" },
    ]);
    expect(savedFrontmatter).toEqual([
      { path: newPath, properties: { status: "done" } },
    ]);
    expect(frontmatter[oldPath].status).toBe("todo");
    expect(frontmatter[newPath].status).toBe("done");
    expect(savedTables[0].rows[0]).toMatchObject({ status: "done" });
  });
});
