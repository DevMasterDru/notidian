import {
  nextTableLoadMorePageSize,
  tableLoadedRowCount,
  tableLoadAllPageSize,
} from "./tablePagination";

describe("tablePagination", () => {
  it("loads one more configured page without exceeding the visible row count", () => {
    expect(
      nextTableLoadMorePageSize({
        currentPageSize: 25,
        increment: 25,
        totalRows: 60,
      })
    ).toBe(50);

    expect(
      nextTableLoadMorePageSize({
        currentPageSize: 50,
        increment: 25,
        totalRows: 60,
      })
    ).toBe(60);
  });

  it("loads all currently visible rows", () => {
    expect(tableLoadAllPageSize(158)).toBe(158);
  });

  it("keeps page sizes valid when there are no rows", () => {
    expect(tableLoadAllPageSize(0)).toBe(1);
  });

  it("reports how many rows are currently loaded", () => {
    expect(
      tableLoadedRowCount({
        currentPageSize: 25,
        totalRows: 158,
      })
    ).toBe(25);
    expect(
      tableLoadedRowCount({
        currentPageSize: 200,
        totalRows: 158,
      })
    ).toBe(158);
    expect(
      tableLoadedRowCount({
        currentPageSize: 25,
        totalRows: 0,
      })
    ).toBe(0);
  });
});
