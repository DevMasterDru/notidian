import { PathPropertyName } from "shared/types/context";
import {
  clampFrozenColumnCount,
  frozenColumnCountForColumn,
  frozenTableColumnIds,
  rowGutterWidthForRowCount,
  stickyOffsetsForFrozenColumns,
} from "./tableFreeze";

const columns = [
  { name: PathPropertyName, table: "", type: "file" },
  { name: "status", table: "", type: "option" },
  { name: "area", table: "", type: "text" },
  { name: "+", table: "", type: "text" },
] as any;

describe("tableFreeze", () => {
  it("freezes visible columns up to the selected column", () => {
    expect(
      frozenColumnCountForColumn({
        columns,
        hiddenColumnIds: [],
        columnId: "status",
      })
    ).toBe(2);
  });

  it("ignores hidden columns and the add-column control", () => {
    expect(
      frozenTableColumnIds({
        columns,
        hiddenColumnIds: ["status"],
        frozenColumnCount: 2,
      })
    ).toEqual([PathPropertyName, "area"]);

    expect(
      clampFrozenColumnCount({
        columns,
        hiddenColumnIds: ["status"],
        frozenColumnCount: 10,
      })
    ).toBe(2);
  });

  it("computes sticky offsets from the row gutter and column sizes", () => {
    expect(
      stickyOffsetsForFrozenColumns({
        columns,
        hiddenColumnIds: [],
        frozenColumnCount: 2,
        columnSizes: {
          [PathPropertyName]: 220,
          status: 90,
        },
        rowGutterWidth: 42,
      })
    ).toEqual({
      [PathPropertyName]: { left: 42, width: 220, isLast: false },
      status: { left: 262, width: 90, isLast: true },
    });
  });

  it("sizes the row gutter from the visible row-number digit count", () => {
    expect(rowGutterWidthForRowCount(0)).toBe(24);
    expect(rowGutterWidthForRowCount(9)).toBe(24);
    expect(rowGutterWidthForRowCount(10)).toBe(30);
    expect(rowGutterWidthForRowCount(99)).toBe(30);
    expect(rowGutterWidthForRowCount(100)).toBe(36);
    expect(rowGutterWidthForRowCount(999)).toBe(36);
    expect(rowGutterWidthForRowCount(1000)).toBe(42);
  });
});
