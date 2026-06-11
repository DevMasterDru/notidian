import { defaultContextSchemaID } from "shared/schemas/context";
import { PathPropertyName } from "shared/types/context";
import { SpaceTable } from "shared/types/mdb";
import {
  createTableUndoEntry,
  filterTableUndoEntryForResult,
  tableUndoWriteForDirectEdit,
} from "../tableUndoJournal";
import { executeTableValueWrites } from "../tableEditTransaction";

const statusColumn = {
  name: "status",
  type: "text",
  source: "frontmatter",
  table: "",
};

const renderedRowsForTable = (table: SpaceTable) =>
  table.rows.map((row, index) => ({
    _index: index.toString(),
    ...row,
  }));

describe("audit c2 (FIXED): undo targets the original file after manual row reorder", () => {
  it("replays a direct-edit undo to the originally-edited file by path, not by row index", async () => {
    const originalTable: SpaceTable = {
      schema: { id: defaultContextSchemaID, name: "Context", type: "context" },
      cols: [
        { name: PathPropertyName, type: "file" },
        { name: "status", type: "text", source: "frontmatter" },
      ],
      rows: [
        { [PathPropertyName]: "Relays & Devices/A.md", status: "old-a" },
        { [PathPropertyName]: "Relays & Devices/B.md", status: "old-b" },
      ],
    };

    const directEditWrite = tableUndoWriteForDirectEdit({
      // Mirrors TableView direct edit: rowId comes from data[index]._index,
      // and no path is supplied for ordinary frontmatter edits.
      rowId: "0",
      column: statusColumn,
      value: "new-a",
    });

    const undoEntry = filterTableUndoEntryForResult(
      createTableUndoEntry({
        label: "Edit cell",
        rows: renderedRowsForTable(originalTable),
        columns: [statusColumn],
        writes: [directEditWrite],
      }),
      { ok: true, applied: 1, skipped: [], failed: [] }
    );

    const reorderedAfterEdit: SpaceTable = {
      ...originalTable,
      rows: [
        { [PathPropertyName]: "Relays & Devices/B.md", status: "old-b" },
        { [PathPropertyName]: "Relays & Devices/A.md", status: "new-a" },
      ],
    };
    const savedFrontmatter: {
      path: string;
      properties: Record<string, unknown>;
    }[] = [];

    const result = await executeTableValueWrites({
      writes: undoEntry.writes,
      tableData: reorderedAfterEdit,
      contextTable: {},
      dbSchemaId: defaultContextSchemaID,
      contextPath: "Relays & Devices",
      resolvePath: (path) => path,
      shouldWritePropertyToFrontmatter: (column) =>
        column.source == "frontmatter",
      parseValue: (_column, value) => value,
      currentFrontmatterValue: ({ path, column }) =>
        path == "Relays & Devices/A.md" && column.name == "status"
          ? "new-a"
          : path == "Relays & Devices/B.md" && column.name == "status"
          ? "old-b"
          : undefined,
      saveFrontmatterProperties: async ({ path, properties }) => {
        savedFrontmatter.push({ path, properties });
        return { ok: true };
      },
      saveDB: async () => {},
      saveContextDB: async () => {},
      contextKeyForTable: (tableName) => tableName,
    });

    expect(result.ok).toBe(true);
    // Sanity: the undo write baked in the original file path.
    expect(undoEntry.writes[0].path).toBe("Relays & Devices/A.md");
    // The undo restores status "old-a" to A.md (the originally edited file),
    // regardless of the reorder that put B.md at row index 0.
    expect(savedFrontmatter).toEqual([
      {
        path: "Relays & Devices/A.md",
        properties: { status: "old-a" },
      },
    ]);
  });

  it("replays a ROOT Notidian-owned undo to the original file's row after reorder", async () => {
    // A source-less ("notidian"-authority) root column that persists into the
    // context MDB table (not frontmatter). Regression for the root-table replay
    // path that previously ignored the baked path (VF1 finding).
    const manualColumn = { name: "manual", type: "text", table: "" };
    const originalTable: SpaceTable = {
      schema: { id: defaultContextSchemaID, name: "Context", type: "context" },
      cols: [{ name: PathPropertyName, type: "file" }, manualColumn],
      rows: [
        { [PathPropertyName]: "Relays & Devices/A.md", manual: "old-a" },
        { [PathPropertyName]: "Relays & Devices/B.md", manual: "old-b" },
      ],
    };

    const undoEntry = filterTableUndoEntryForResult(
      createTableUndoEntry({
        label: "Edit cell",
        rows: renderedRowsForTable(originalTable),
        columns: [manualColumn],
        writes: [
          tableUndoWriteForDirectEdit({
            rowId: "0",
            column: manualColumn,
            value: "new-a",
          })!,
        ],
      }),
      { ok: true, applied: 1, skipped: [], failed: [] }
    );

    const reorderedAfterEdit: SpaceTable = {
      ...originalTable,
      rows: [
        { [PathPropertyName]: "Relays & Devices/B.md", manual: "old-b" },
        { [PathPropertyName]: "Relays & Devices/A.md", manual: "new-a" },
      ],
    };

    let savedTable: SpaceTable | undefined;
    await executeTableValueWrites({
      writes: undoEntry.writes,
      tableData: reorderedAfterEdit,
      contextTable: {},
      dbSchemaId: defaultContextSchemaID,
      contextPath: "Relays & Devices",
      resolvePath: (path) => path,
      shouldWritePropertyToFrontmatter: () => false,
      parseValue: (_column, value) => value,
      saveFrontmatterProperties: async () => ({ ok: true }),
      saveDB: async (table) => {
        savedTable = table;
      },
      saveContextDB: async () => {},
      contextKeyForTable: (tableName) => tableName,
    });

    const rowFor = (path: string) =>
      savedTable?.rows.find((r) => r[PathPropertyName] == path);
    // The undo value "old-a" lands on A.md (originally edited), and B.md is left
    // untouched — not corrupted by the stale row index.
    expect(rowFor("Relays & Devices/A.md")?.manual).toBe("old-a");
    expect(rowFor("Relays & Devices/B.md")?.manual).toBe("old-b");
  });
});
