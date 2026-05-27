import { PathPropertyName } from "shared/types/context";
import { DBRow } from "shared/types/mdb";
import { buildPageTitleRename, pageTitleFromPath } from "./pageTitle";
import type { TableEditTransactionResult } from "./tableEditTransaction";
import { TablePasteWrite } from "./tablePastePlan";

export type TableUndoEntry = {
  label: string;
  writes: TablePasteWrite[];
  redoWrites: TablePasteWrite[];
};

export type CreateTableUndoEntryParams = {
  label: string;
  rows: DBRow[];
  writes: TablePasteWrite[];
};

const undoKeyForWrite = (write: TablePasteWrite): string =>
  `${write.rowId}::${write.columnId}`;

const targetKeyForWrite = (write: {
  rowId: string;
  columnId?: string;
  columnName: string;
  table: string;
}): string =>
  `${write.rowId}::${write.columnId ?? write.columnName}::${write.columnName}::${
    write.table
  }`;

const rowForWrite = (rows: DBRow[], write: TablePasteWrite): DBRow =>
  rows.find((row) => row._index == write.rowId) ?? rows[parseInt(write.rowId)];

const currentValueForWrite = (
  row: DBRow,
  write: TablePasteWrite
): string => {
  if (write.authority == "file") {
    return pageTitleFromPath(row?.[PathPropertyName] ?? "");
  }

  return String(row?.[write.columnId] ?? row?.[write.columnName] ?? "");
};

const currentPathAfterWrite = (
  row: DBRow,
  write: TablePasteWrite
): string | undefined => {
  if (write.authority != "file") return write.path;

  const oldPath = row?.[PathPropertyName];
  return oldPath
    ? buildPageTitleRename(oldPath, write.value).newPath
    : write.path;
};

const sanitizeHistoryWrite = (write: TablePasteWrite): TablePasteWrite => {
  const { forceFrontmatterWrite: _forceFrontmatterWrite, ...historyWrite } =
    write as TablePasteWrite & { forceFrontmatterWrite?: boolean };

  return Object.fromEntries(
    Object.entries(historyWrite).filter(([, value]) => value !== undefined)
  ) as TablePasteWrite;
};

export const createTableUndoEntry = ({
  label,
  rows,
  writes,
}: CreateTableUndoEntryParams): TableUndoEntry => {
  const seen = new Set<string>();
  const inverseWrites = writes.reduce<TablePasteWrite[]>((entryWrites, write) => {
    const key = undoKeyForWrite(write);
    if (seen.has(key)) return entryWrites;
    seen.add(key);

    const row = rowForWrite(rows, write);
    if (!row) return entryWrites;

    const currentValue = currentValueForWrite(row, write);
    if (currentValue == write.value) return entryWrites;

    return [
      ...entryWrites,
      sanitizeHistoryWrite({
        ...write,
        path: currentPathAfterWrite(row, write),
        value: currentValue,
      }),
    ];
  }, []);

  return {
    label,
    writes: inverseWrites,
    redoWrites: writes.map(sanitizeHistoryWrite),
  };
};

export const pushTableUndoEntry = (
  stack: TableUndoEntry[],
  entry: TableUndoEntry,
  maxEntries = 20
): TableUndoEntry[] => [...stack, entry].slice(-maxEntries);

export const filterTableUndoEntryForResult = (
  entry: TableUndoEntry,
  result: TableEditTransactionResult
): TableUndoEntry => {
  const rejectedTargets = new Set(
    [...result.skipped, ...result.failed].map((issue) =>
      targetKeyForWrite(issue.write)
    )
  );
  const wasAccepted = (write: TablePasteWrite): boolean =>
    !rejectedTargets.has(targetKeyForWrite(write));

  return {
    ...entry,
    writes: entry.writes.filter(wasAccepted),
    redoWrites: entry.redoWrites.filter(wasAccepted),
  };
};
