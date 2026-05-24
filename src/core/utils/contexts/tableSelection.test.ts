import {
  CellSelection,
  cellSelectionBounds,
  cellSelectionRange,
  extendCellSelection,
  moveCellSelection,
  selectionContainsCell,
} from "./tableSelection";

const rows = ["r1", "r2", "r3"];
const columns = ["File", "status", "area"];

describe("tableSelection", () => {
  it("returns the rectangular range between anchor and focus", () => {
    const selection: CellSelection = {
      anchor: { rowId: "r1", columnId: "File" },
      focus: { rowId: "r2", columnId: "status" },
      active: { rowId: "r2", columnId: "status" },
    };

    expect(cellSelectionRange(selection, rows, columns)).toEqual([
      { rowId: "r1", columnId: "File" },
      { rowId: "r1", columnId: "status" },
      { rowId: "r2", columnId: "File" },
      { rowId: "r2", columnId: "status" },
    ]);
  });

  it("returns stable bounds regardless of drag direction", () => {
    const selection: CellSelection = {
      anchor: { rowId: "r3", columnId: "area" },
      focus: { rowId: "r1", columnId: "File" },
      active: { rowId: "r1", columnId: "File" },
    };

    expect(cellSelectionBounds(selection, rows, columns)).toEqual({
      minRow: 0,
      maxRow: 2,
      minColumn: 0,
      maxColumn: 2,
    });
  });

  it("moves the active cell without extending the selection", () => {
    const selection: CellSelection = {
      anchor: { rowId: "r1", columnId: "File" },
      focus: { rowId: "r1", columnId: "File" },
      active: { rowId: "r1", columnId: "File" },
    };

    expect(moveCellSelection(selection, rows, columns, "right")).toEqual({
      anchor: { rowId: "r1", columnId: "status" },
      focus: { rowId: "r1", columnId: "status" },
      active: { rowId: "r1", columnId: "status" },
    });
  });

  it("extends the range while keeping the original anchor", () => {
    const selection: CellSelection = {
      anchor: { rowId: "r1", columnId: "File" },
      focus: { rowId: "r1", columnId: "File" },
      active: { rowId: "r1", columnId: "File" },
    };

    expect(extendCellSelection(selection, rows, columns, "down")).toEqual({
      anchor: { rowId: "r1", columnId: "File" },
      focus: { rowId: "r2", columnId: "File" },
      active: { rowId: "r2", columnId: "File" },
    });
  });

  it("clamps movement to visible row and column bounds", () => {
    const selection: CellSelection = {
      anchor: { rowId: "r1", columnId: "File" },
      focus: { rowId: "r1", columnId: "File" },
      active: { rowId: "r1", columnId: "File" },
    };

    expect(moveCellSelection(selection, rows, columns, "up")).toEqual(
      selection
    );
    expect(moveCellSelection(selection, rows, columns, "left")).toEqual(
      selection
    );
  });

  it("checks whether a coordinate is inside the selected rectangle", () => {
    const selection: CellSelection = {
      anchor: { rowId: "r1", columnId: "File" },
      focus: { rowId: "r2", columnId: "status" },
      active: { rowId: "r2", columnId: "status" },
    };

    expect(
      selectionContainsCell(selection, rows, columns, {
        rowId: "r2",
        columnId: "status",
      })
    ).toBe(true);
    expect(
      selectionContainsCell(selection, rows, columns, {
        rowId: "r3",
        columnId: "area",
      })
    ).toBe(false);
  });
});
