export const nextTableLoadMorePageSize = ({
  currentPageSize,
  increment,
  totalRows,
}: {
  currentPageSize: number;
  increment: number;
  totalRows: number;
}): number => {
  const safeCurrentPageSize = Math.max(1, currentPageSize);
  const safeIncrement = Math.max(1, increment);
  const nextPageSize = safeCurrentPageSize + safeIncrement;

  return totalRows > 0 ? Math.min(nextPageSize, totalRows) : nextPageSize;
};

export const tableLoadAllPageSize = (totalRows: number): number =>
  Math.max(1, totalRows);

export const tableLoadedRowCount = ({
  currentPageSize,
  totalRows,
}: {
  currentPageSize: number;
  totalRows: number;
}): number => {
  if (totalRows <= 0) return 0;

  return Math.min(Math.max(0, currentPageSize), totalRows);
};
