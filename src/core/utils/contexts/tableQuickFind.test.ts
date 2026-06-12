import {
  computeQuickFindMatches,
  pageSizeToRevealRow,
  stepMatchIndex,
} from "core/utils/contexts/tableQuickFind";

const cols = [
  { key: "Name", type: "text" },
  { key: "Status", type: "option" },
  { key: "Secret", type: "password" },
];

const rows = [
  { Name: "Alpha review", Status: "approved", Secret: "hunter2" },
  { Name: "Beta", Status: "Approved pending", Secret: "approved-key" },
  { Name: "gamma", Status: "resolved", Secret: "xyz" },
];

describe("computeQuickFindMatches", () => {
  it("returns nothing for an empty or whitespace query", () => {
    expect(
      computeQuickFindMatches({ rows, columns: cols, query: "" })
    ).toEqual([]);
    expect(
      computeQuickFindMatches({ rows, columns: cols, query: "   " })
    ).toEqual([]);
  });

  it("matches case-insensitive substrings across visible columns", () => {
    const matches = computeQuickFindMatches({
      rows,
      columns: cols,
      query: "approved",
    });
    // Row 0 Status "approved", Row 1 Status "Approved pending".
    // Secret column is excluded (password) so the row-1 "approved-key" does NOT
    // produce a match.
    expect(matches).toEqual([
      { rowIndex: 0, colKey: "Status" },
      { rowIndex: 1, colKey: "Status" },
    ]);
  });

  it("orders matches row-major, then by column order", () => {
    const matches = computeQuickFindMatches({
      rows: [{ Name: "aa", Status: "aa" }],
      columns: [
        { key: "Name", type: "text" },
        { key: "Status", type: "text" },
      ],
      query: "aa",
    });
    expect(matches).toEqual([
      { rowIndex: 0, colKey: "Name" },
      { rowIndex: 0, colKey: "Status" },
    ]);
  });

  it("never matches password columns (no oracle on masked secrets)", () => {
    const matches = computeQuickFindMatches({
      rows,
      columns: cols,
      query: "hunter2",
    });
    expect(matches).toEqual([]);
  });

  it("excludes hidden columns", () => {
    const matches = computeQuickFindMatches({
      rows: [{ Name: "find me", Status: "find me" }],
      columns: [
        { key: "Name", type: "text" },
        { key: "Status", type: "text" },
      ],
      hiddenColumnIds: ["Status"],
      query: "find me",
    });
    expect(matches).toEqual([{ rowIndex: 0, colKey: "Name" }]);
  });

  it("stringifies non-string values safely and skips null/undefined", () => {
    const matches = computeQuickFindMatches({
      rows: [
        { Name: 42, Status: null },
        { Name: undefined, Status: "42 items" },
      ],
      columns: [
        { key: "Name", type: "number" },
        { key: "Status", type: "text" },
      ],
      query: "42",
    });
    expect(matches).toEqual([
      { rowIndex: 0, colKey: "Name" },
      { rowIndex: 1, colKey: "Status" },
    ]);
  });
});

describe("stepMatchIndex", () => {
  it("returns -1 when there are no matches", () => {
    expect(stepMatchIndex(0, -1, 1)).toBe(-1);
    expect(stepMatchIndex(0, 5, -1)).toBe(-1);
  });

  it("advances from the unset (-1) state to the first match", () => {
    expect(stepMatchIndex(3, -1, 1)).toBe(0);
  });

  it("wraps forward and backward", () => {
    expect(stepMatchIndex(3, 2, 1)).toBe(0);
    expect(stepMatchIndex(3, 0, -1)).toBe(2);
    expect(stepMatchIndex(3, 1, 1)).toBe(2);
  });
});

describe("pageSizeToRevealRow", () => {
  it("leaves the page size unchanged when the row is already rendered", () => {
    // pageSize 25, currentPageSize 25 renders rows 0..24; row 10 is visible.
    expect(pageSizeToRevealRow(10, 25, 25)).toBe(25);
  });

  it("grows to the next page multiple to reveal an off-screen row", () => {
    // row index 30 needs currentPageSize >= 31 -> ceil(31/25)*25 = 50.
    expect(pageSizeToRevealRow(30, 25, 25)).toBe(50);
    // row index 60 -> ceil(61/25)*25 = 75.
    expect(pageSizeToRevealRow(60, 25, 25)).toBe(75);
  });

  it("never shrinks below the current page size", () => {
    expect(pageSizeToRevealRow(3, 25, 100)).toBe(100);
  });
});
