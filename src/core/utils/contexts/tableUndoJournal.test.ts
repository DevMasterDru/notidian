import { PathPropertyName } from "shared/types/context";
import {
  createTableUndoEntry,
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
        { label: "A", writes: [] },
        { label: "B", writes: [] },
      ],
      { label: "C", writes: [] },
      2
    );

    expect(stack).toEqual([
      { label: "B", writes: [] },
      { label: "C", writes: [] },
    ]);
  });
});
