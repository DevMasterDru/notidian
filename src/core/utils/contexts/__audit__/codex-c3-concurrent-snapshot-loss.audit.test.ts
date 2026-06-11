import { defaultContextSchemaID } from "shared/schemas/context";
import { PathPropertyName } from "shared/types/context";
import { SpaceTable } from "shared/types/mdb";
import { executeTableValueWrites, TableCellWrite } from "../tableEditTransaction";

const baseContextTable = (): SpaceTable => ({
  schema: { id: defaultContextSchemaID, name: "Context", type: "context" },
  cols: [
    { name: PathPropertyName, type: "file" },
    { name: "local", type: "text" },
  ],
  rows: [
    { [PathPropertyName]: "Relays & Devices/A.md", local: "old-a" },
    { [PathPropertyName]: "Relays & Devices/B.md", local: "old-b" },
  ],
});

describe("audit c3-concurrent-snapshot-loss", () => {
  it("reproduces last-write-wins loss for two root context-owned writes sharing one captured table snapshot", async () => {
    const tableData = baseContextTable();
    let persisted = tableData;
    const savedSnapshots: SpaceTable[] = [];

    const runContextEditorValueWrite = (write: TableCellWrite) =>
      executeTableValueWrites({
        writes: [write],
        tableData,
        contextTable: {},
        dbSchemaId: defaultContextSchemaID,
        contextPath: "Relays & Devices",
        resolvePath: (path) => path,
        shouldWritePropertyToFrontmatter: () => false,
        parseValue: (_column, value) => value,
        saveFrontmatterProperties: async () => ({ ok: true }),
        saveDB: async (nextTable) => {
          savedSnapshots.push(nextTable);
          persisted = nextTable;
        },
        saveContextDB: async () => {
          throw new Error("linked context save should not be used");
        },
        contextKeyForTable: (table) => table,
      });

    await Promise.all([
      runContextEditorValueWrite({
        rowId: "0",
        columnId: "local",
        columnName: "local",
        table: "",
        value: "first-edit",
      }),
      runContextEditorValueWrite({
        rowId: "1",
        columnId: "local",
        columnName: "local",
        table: "",
        value: "second-edit",
      }),
    ]);

    expect(savedSnapshots).toHaveLength(2);
    expect(savedSnapshots[0].rows[0].local).toBe("first-edit");

    // Correct behavior would serialize or merge against the latest persisted
    // table, so the second save and final persisted table would keep first-edit.
    expect(savedSnapshots[1].rows[0].local).toBe("old-a");
    expect(savedSnapshots[1].rows[1].local).toBe("second-edit");
    expect(persisted.rows[0].local).toBe("old-a");
    expect(persisted.rows[1].local).toBe("second-edit");
  });
});
