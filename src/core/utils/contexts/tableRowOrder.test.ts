import { moveVisibleRows, rowDragSet } from "./tableRowOrder";

const rows = ["A", "B", "C", "D", "E", "F"].map((name) => ({ name }));

describe("tableRowOrder", () => {
  it("drags only the active row when it is not selected", () => {
    expect(rowDragSet(["0", "1", "2"], "1", ["0", "2"])).toEqual(["1"]);
  });

  it("drags selected visible rows as one block when the active row is selected", () => {
    expect(rowDragSet(["0", "1", "2", "3"], "2", ["1", "2"])).toEqual([
      "1",
      "2",
    ]);
  });

  it("moves a single row down using sortable-style target indexes", () => {
    const result = moveVisibleRows({
      rows,
      visibleRowOrder: ["0", "1", "2", "3", "4", "5"],
      activeRowId: "1",
      overRowId: "4",
      selectedRowIds: ["1"],
    });

    expect(result.changed).toBe(true);
    expect(result.rows.map((row) => row.name)).toEqual([
      "A",
      "C",
      "D",
      "E",
      "B",
      "F",
    ]);
    expect(result.selectedRowIds).toEqual(["4"]);
  });

  it("moves a selected row block while preserving block order", () => {
    const result = moveVisibleRows({
      rows,
      visibleRowOrder: ["0", "1", "2", "3", "4", "5"],
      activeRowId: "2",
      overRowId: "5",
      selectedRowIds: ["1", "2", "3"],
    });

    expect(result.rows.map((row) => row.name)).toEqual([
      "A",
      "E",
      "F",
      "B",
      "C",
      "D",
    ]);
    expect(result.selectedRowIds).toEqual(["3", "4", "5"]);
  });

  it("drops a downward row block after the hovered row, not at the end", () => {
    const result = moveVisibleRows({
      rows,
      visibleRowOrder: ["0", "1", "2", "3", "4", "5"],
      activeRowId: "2",
      overRowId: "4",
      selectedRowIds: ["1", "2", "3"],
    });

    expect(result.rows.map((row) => row.name)).toEqual([
      "A",
      "E",
      "B",
      "C",
      "D",
      "F",
    ]);
    expect(result.selectedRowIds).toEqual(["2", "3", "4"]);
  });

  it("moves a selected row block upward", () => {
    const result = moveVisibleRows({
      rows,
      visibleRowOrder: ["0", "1", "2", "3", "4", "5"],
      activeRowId: "4",
      overRowId: "1",
      selectedRowIds: ["4", "5"],
    });

    expect(result.rows.map((row) => row.name)).toEqual([
      "A",
      "E",
      "F",
      "B",
      "C",
      "D",
    ]);
    expect(result.selectedRowIds).toEqual(["1", "2"]);
  });

  it("preserves non-visible rows in their original slots", () => {
    const result = moveVisibleRows({
      rows,
      visibleRowOrder: ["0", "2", "4"],
      activeRowId: "0",
      overRowId: "4",
      selectedRowIds: ["0"],
    });

    expect(result.rows.map((row) => row.name)).toEqual([
      "C",
      "B",
      "E",
      "D",
      "A",
      "F",
    ]);
  });

  it("does not move rows when dropping onto a dragged row", () => {
    const result = moveVisibleRows({
      rows,
      visibleRowOrder: ["0", "1", "2", "3"],
      activeRowId: "1",
      overRowId: "2",
      selectedRowIds: ["1", "2"],
    });

    expect(result.changed).toBe(false);
    expect(result.rows).toBe(rows);
  });
});
