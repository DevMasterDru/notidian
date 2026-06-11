/**
 * Regression test for bd Notidian-f2l: calendar/modal/header edits called
 * updateRow, which wrote frontmatter directly, bypassing the stale-conflict gate
 * and undo. updateRow now builds authority-aware writes via buildRowUpdateWrites
 * and routes them through executeValueWrites. These tests pin the write-building.
 */
import { PathPropertyName } from "shared/types/context";
import { SpaceTableColumn } from "shared/types/mdb";
import { buildRowUpdateWrites } from "../rowUpdateWrites";

const cols: SpaceTableColumn[] = [
  { name: PathPropertyName, type: "file", table: "" },
  { name: "status", type: "text", source: "frontmatter", table: "" },
  { name: "manual", type: "text", table: "" }, // notidian-owned (no source)
  { name: "Created", type: "fileprop", table: "" }, // computed, read-only
];

const currentData = {
  [PathPropertyName]: "Folder/A.md",
  status: "old",
  manual: "keep",
  Created: "2026-01-01",
};

describe("f2l: buildRowUpdateWrites", () => {
  it("builds authority-aware writes only for changed, writable, non-title columns", () => {
    const writes = buildRowUpdateWrites(
      {
        ...currentData,
        status: "new", // frontmatter change
        manual: "changed", // notidian-owned change
      },
      currentData,
      cols,
      3
    );

    expect(writes).toEqual([
      {
        rowId: "3",
        columnId: "status",
        columnName: "status",
        table: "",
        value: "new",
        path: "Folder/A.md",
      },
      {
        rowId: "3",
        columnId: "manual",
        columnName: "manual",
        table: "",
        value: "changed",
        path: "Folder/A.md",
      },
    ]);
  });

  it("excludes the page title (PathPropertyName) — title changes use rename, not updateRow", () => {
    const writes = buildRowUpdateWrites(
      { ...currentData, [PathPropertyName]: "Folder/Renamed.md" },
      currentData,
      cols,
      0
    );
    expect(writes).toEqual([]);
  });

  it("excludes read-only computed columns", () => {
    const writes = buildRowUpdateWrites(
      { ...currentData, Created: "2027-09-09" },
      currentData,
      cols,
      0
    );
    expect(writes).toEqual([]);
  });

  it("bakes the original file path so replay resolves by identity, and emits nothing for a no-op", () => {
    expect(buildRowUpdateWrites(currentData, currentData, cols, 0)).toEqual([]);

    const writes = buildRowUpdateWrites(
      { ...currentData, status: "x" },
      currentData,
      cols,
      5
    );
    expect(writes[0].path).toBe("Folder/A.md");
  });
});
