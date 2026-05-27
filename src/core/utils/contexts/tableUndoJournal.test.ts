import { PathPropertyName } from "shared/types/context";
import {
  createTableUndoEntry,
  filterTableUndoEntryForResult,
  pushTableUndoEntry,
} from "./tableUndoJournal";

const rows = [
  {
    _index: "0",
    [PathPropertyName]: "Relays & Devices/Relay A.md",
    status: "old",
    manual: "kept",
  },
  {
    _index: "1",
    [PathPropertyName]: "Relays & Devices/Relay B.md",
    status: "paused",
    manual: "",
  },
];

describe("tableUndoJournal", () => {
  it("captures inverse property writes from current row data", () => {
    expect(
      createTableUndoEntry({
        label: "Paste cells",
        rows,
        writes: [
          {
            rowId: "0",
            columnId: "status",
            columnName: "status",
            table: "",
            value: "active",
            authority: "frontmatter",
          },
          {
            rowId: "1",
            columnId: "manual",
            columnName: "manual",
            table: "",
            value: "new",
            authority: "notidian",
          },
        ],
      })
    ).toEqual({
      label: "Paste cells",
      redoWrites: [
        {
          rowId: "0",
          columnId: "status",
          columnName: "status",
          table: "",
          value: "active",
          authority: "frontmatter",
        },
        {
          rowId: "1",
          columnId: "manual",
          columnName: "manual",
          table: "",
          value: "new",
          authority: "notidian",
        },
      ],
      writes: [
        {
          rowId: "0",
          columnId: "status",
          columnName: "status",
          table: "",
          value: "old",
          authority: "frontmatter",
        },
        {
          rowId: "1",
          columnId: "manual",
          columnName: "manual",
          table: "",
          value: "",
          authority: "notidian",
        },
      ],
    });
  });

  it("captures inverse file writes as old page titles", () => {
    expect(
      createTableUndoEntry({
        label: "Rename files",
        rows,
        writes: [
          {
            rowId: "0",
            columnId: PathPropertyName,
            columnName: PathPropertyName,
            table: "",
            value: "Renamed Relay A",
            authority: "file",
          },
        ],
      })
    ).toEqual({
      label: "Rename files",
      redoWrites: [
        {
          rowId: "0",
          columnId: PathPropertyName,
          columnName: PathPropertyName,
          table: "",
          value: "Renamed Relay A",
          authority: "file",
        },
      ],
      writes: [
        {
          rowId: "0",
          columnId: PathPropertyName,
          columnName: PathPropertyName,
          table: "",
          path: "Relays & Devices/Renamed Relay A.md",
          value: "Relay A",
          authority: "file",
        },
      ],
    });
  });

  it("deduplicates repeated target cells and skips unchanged writes", () => {
    expect(
      createTableUndoEntry({
        label: "Paste cells",
        rows,
        writes: [
          {
            rowId: "0",
            columnId: "status",
            columnName: "status",
            table: "",
            value: "active",
            authority: "frontmatter",
          },
          {
            rowId: "0",
            columnId: "status",
            columnName: "status",
            table: "",
            value: "newer",
            authority: "frontmatter",
          },
          {
            rowId: "1",
            columnId: "status",
            columnName: "status",
            table: "",
            value: "paused",
            authority: "frontmatter",
          },
        ],
      })
    ).toEqual({
      label: "Paste cells",
      redoWrites: [
        {
          rowId: "0",
          columnId: "status",
          columnName: "status",
          table: "",
          value: "active",
          authority: "frontmatter",
        },
        {
          rowId: "0",
          columnId: "status",
          columnName: "status",
          table: "",
          value: "newer",
          authority: "frontmatter",
        },
        {
          rowId: "1",
          columnId: "status",
          columnName: "status",
          table: "",
          value: "paused",
          authority: "frontmatter",
        },
      ],
      writes: [
        {
          rowId: "0",
          columnId: "status",
          columnName: "status",
          table: "",
          value: "old",
          authority: "frontmatter",
        },
      ],
    });
  });

  it("caps the in-memory undo stack", () => {
    const stack = pushTableUndoEntry(
      [
        { label: "A", writes: [], redoWrites: [] },
        { label: "B", writes: [], redoWrites: [] },
      ],
      { label: "C", writes: [], redoWrites: [] },
      2
    );

    expect(stack).toEqual([
      { label: "B", writes: [], redoWrites: [] },
      { label: "C", writes: [], redoWrites: [] },
    ]);
  });

  it("stores redo writes without reusable forced conflict flags", () => {
    const entry = createTableUndoEntry({
      label: "Apply conflict",
      rows,
      writes: [
        {
          rowId: "0",
          columnId: "status",
          columnName: "status",
          table: "",
          value: "forced",
          authority: "frontmatter",
          forceFrontmatterWrite: true,
        } as any,
      ],
    });

    expect(entry.redoWrites).toEqual([
      {
        rowId: "0",
        columnId: "status",
        columnName: "status",
        table: "",
        value: "forced",
        authority: "frontmatter",
      },
    ]);
  });

  it("removes skipped and failed targets from undo and redo history", () => {
    const entry = createTableUndoEntry({
      label: "Paste cells",
      rows,
      writes: [
        {
          rowId: "0",
          columnId: "status",
          columnName: "status",
          table: "",
          value: "active",
          authority: "frontmatter",
        },
        {
          rowId: "1",
          columnId: "manual",
          columnName: "manual",
          table: "",
          value: "new",
          authority: "notidian",
        },
      ],
    });

    expect(
      filterTableUndoEntryForResult(entry, {
        ok: true,
        applied: 1,
        skipped: [
          {
            write: {
              rowId: "0",
              columnId: "status",
              columnName: "status",
              table: "",
              value: "active",
            },
            reason: "frontmatter-conflict",
          },
        ],
        failed: [],
      })
    ).toEqual({
      label: "Paste cells",
      redoWrites: [
        {
          rowId: "1",
          columnId: "manual",
          columnName: "manual",
          table: "",
          value: "new",
          authority: "notidian",
        },
      ],
      writes: [
        {
          rowId: "1",
          columnId: "manual",
          columnName: "manual",
          table: "",
          value: "",
          authority: "notidian",
        },
      ],
    });
  });
});
