/**
 * Regression test for bd Notidian-29g: undo/redo replay silently overwrote newer
 * external frontmatter because it compared canonical against the freshly-reloaded
 * row value instead of the value the original edit produced.
 *
 * The fix bakes `expectedCurrentValue` into undo/redo writes. These tests pass the
 * real undo/redo write objects (carrying that field) into the real
 * executeTableValueWrites and assert the replay is skipped as a frontmatter
 * conflict when canonical changed, and still applies when it did not.
 */
import { defaultContextSchemaID } from "shared/schemas/context";
import { PathPropertyName } from "shared/types/context";
import { SpaceTable } from "shared/types/mdb";
import {
  executeTableValueWrites,
  TableCellWrite,
} from "../tableEditTransaction";
import {
  createTableUndoEntry,
  filterTableUndoEntryForResult,
  tableUndoWriteForDirectEdit,
} from "../tableUndoJournal";

const statusColumn = {
  name: "status",
  type: "text",
  source: "frontmatter",
  table: "",
};

const tableWithStatus = (status: string): SpaceTable => ({
  schema: { id: defaultContextSchemaID, name: "Context", type: "context" },
  cols: [{ name: PathPropertyName, type: "file" }, statusColumn],
  rows: [{ [PathPropertyName]: "Folder/Note.md", status }],
});

const replayWrite = async ({
  table,
  canonicalStatus,
  write,
}: {
  table: SpaceTable;
  canonicalStatus: string;
  write: TableCellWrite;
}) => {
  const savedFrontmatter: { path: string; properties: Record<string, unknown> }[] =
    [];
  const savedTables: SpaceTable[] = [];

  const result = await executeTableValueWrites({
    writes: [write],
    tableData: table,
    contextTable: {},
    dbSchemaId: defaultContextSchemaID,
    contextPath: "Folder",
    resolvePath: (path) => path,
    shouldWritePropertyToFrontmatter: (column) =>
      column.source == "frontmatter",
    parseValue: (_column, nextValue) => nextValue,
    currentFrontmatterValue: ({ column }) =>
      column.name == "status" ? canonicalStatus : undefined,
    saveFrontmatterProperties: async ({ path, properties }) => {
      savedFrontmatter.push({ path, properties });
      return { ok: true };
    },
    saveDB: async (nextTable) => {
      savedTables.push(nextTable);
    },
    saveContextDB: jest.fn(),
    contextKeyForTable: (tableName) => tableName,
  });

  return { result, savedFrontmatter, savedTables };
};

// Forward edit took the cell A -> B; build the resulting undo entry.
const undoEntryForForwardEdit = () =>
  filterTableUndoEntryForResult(
    createTableUndoEntry({
      label: "Edit cell",
      rows: tableWithStatus("A").rows,
      writes: [
        tableUndoWriteForDirectEdit({
          rowId: "0",
          column: statusColumn,
          value: "B",
        })!,
      ],
    }),
    { ok: true, applied: 1, skipped: [], failed: [] }
  );

describe("audit c1 (FIXED): undo/redo does not overwrite newer external frontmatter", () => {
  it("skips undo with a frontmatter-conflict when canonical changed externally", async () => {
    const undoWrite = undoEntryForForwardEdit().writes[0];
    // Sanity: the undo write carries the expected post-edit value B.
    expect(undoWrite.expectedCurrentValue).toBe("B");

    // External edit changed the file B -> C and the table reloaded to C.
    const { result, savedFrontmatter } = await replayWrite({
      table: tableWithStatus("C"),
      canonicalStatus: "C",
      write: undoWrite,
    });

    expect(result.applied).toBe(0);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0].reason).toBe("frontmatter-conflict");
    // Canonical C is preserved: no stale "A" was written.
    expect(savedFrontmatter).toEqual([]);
  });

  it("skips redo with a frontmatter-conflict when canonical changed externally", async () => {
    const redoWrite = undoEntryForForwardEdit().redoWrites[0];
    expect(redoWrite.expectedCurrentValue).toBe("A");

    const { result, savedFrontmatter } = await replayWrite({
      table: tableWithStatus("C"),
      canonicalStatus: "C",
      write: redoWrite,
    });

    expect(result.applied).toBe(0);
    expect(result.skipped[0].reason).toBe("frontmatter-conflict");
    expect(savedFrontmatter).toEqual([]);
  });

  it("still applies undo normally when canonical is unchanged (positive control)", async () => {
    const undoWrite = undoEntryForForwardEdit().writes[0];

    // No external change: canonical is still B (what the forward edit produced).
    const { result, savedFrontmatter } = await replayWrite({
      table: tableWithStatus("B"),
      canonicalStatus: "B",
      write: undoWrite,
    });

    expect(result.applied).toBe(1);
    expect(result.skipped).toEqual([]);
    expect(savedFrontmatter).toEqual([
      { path: "Folder/Note.md", properties: { status: "A" } },
    ]);
  });
});
