import { PathPropertyName } from "shared/types/context";
import { DBRow } from "shared/types/mdb";
import { buildPageTitleRename, pageTitleFromPath } from "./pageTitle";
import { TablePasteWrite } from "./tablePastePlan";

export type TableUndoEntry = {
  label: string;
  writes: TablePasteWrite[];
};

export type CreateTableUndoEntryParams = {
  label: string;
  rows: DBRow[];
  writes: TablePasteWrite[];
};

const undoKeyForWrite = (write: TablePasteWrite): string =>
  `${write.rowId}::${write.columnId}`;

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
      {
        ...write,
        path: currentPathAfterWrite(row, write),
        value: currentValue,
      },
    ];
  }, []);

  return {
    label,
    writes: inverseWrites,
  };
};

export const pushTableUndoEntry = (
  stack: TableUndoEntry[],
  entry: TableUndoEntry,
  maxEntries = 20
): TableUndoEntry[] => [...stack, entry].slice(-maxEntries);
