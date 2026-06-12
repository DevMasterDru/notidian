// Pure logic for in-table quick find (Notidian-r20): highlight + navigate
// matches without hiding rows (the filter-search keeps that job). View-layer
// only — never reads/writes frontmatter, files, or context MDB.

export type QuickFindColumn = { key: string; type: string };
export type QuickFindMatch = { rowIndex: number; colKey: string };

const isPasswordColumn = (type: string): boolean =>
  type == "password" || type.startsWith("password-");

const cellText = (value: unknown): string => {
  if (value == null) return "";
  if (typeof value == "string") return value;
  if (typeof value == "number" || typeof value == "boolean")
    return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return "";
  }
};

// Ordered list of matching cells across ALL given (filtered) rows, row-major
// then column order, so next/prev navigation moves top-to-bottom, left-to-right.
// password columns are excluded so quick find can never become an oracle that
// confirms substrings of a masked secret; hidden columns are excluded because
// they have no visible cell to highlight.
export const computeQuickFindMatches = (params: {
  rows: Record<string, unknown>[];
  columns: QuickFindColumn[];
  hiddenColumnIds?: string[];
  query: string;
}): QuickFindMatch[] => {
  const needle = params.query.trim().toLowerCase();
  if (needle.length == 0) return [];
  const hidden = new Set(params.hiddenColumnIds ?? []);
  const searchable = params.columns.filter(
    (col) => !isPasswordColumn(col.type) && !hidden.has(col.key)
  );
  if (searchable.length == 0) return [];

  const matches: QuickFindMatch[] = [];
  params.rows.forEach((row, rowIndex) => {
    for (const col of searchable) {
      if (cellText(row[col.key]).toLowerCase().includes(needle))
        matches.push({ rowIndex, colKey: col.key });
    }
  });
  return matches;
};

// Wrap-around navigation. Returns -1 when there is nothing to navigate; from the
// unset state (-1) a forward step lands on the first match.
export const stepMatchIndex = (
  count: number,
  current: number,
  dir: 1 | -1
): number => {
  if (count <= 0) return -1;
  return (((current + dir) % count) + count) % count;
};

// The page size the table needs so the filtered row at `rowIndex` is rendered
// (rows render as slice(0, currentPageSize)). Rounds up to the next whole page
// for clean pagination and never shrinks below the current page size.
export const pageSizeToRevealRow = (
  rowIndex: number,
  pageSize: number,
  currentPageSize: number
): number => {
  const safePage = Math.max(1, pageSize);
  const needed = Math.ceil((rowIndex + 1) / safePage) * safePage;
  return Math.max(currentPageSize, needed);
};
