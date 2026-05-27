import { PathPropertyName } from "shared/types/context";
import { DBRow, SpaceProperty } from "shared/types/mdb";
import {
  propertyAuthorityForColumn,
} from "../properties/propertyAuthority";
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
  columns?: DirectEditColumn[];
};

export type DirectEditColumn = Pick<
  SpaceProperty,
  "name" | "source" | "type" | "value"
> & {
  table?: string;
};

export type TableUndoWriteForDirectEditParams = {
  rowId: string;
  column: DirectEditColumn;
  value: string;
  path?: string;
  fieldValue?: string;
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

const columnIdForDirectColumn = (column: DirectEditColumn): string =>
  column.name + (column.table ?? "");

export const tableUndoWriteForDirectEdit = ({
  rowId,
  column,
  value,
  path,
  fieldValue,
}: TableUndoWriteForDirectEditParams): TablePasteWrite | null => {
  const authority = propertyAuthorityForColumn(column);
  if (authority == "computed") return null;

  return Object.fromEntries(
    Object.entries({
      rowId,
      columnId: columnIdForDirectColumn(column),
      columnName: column.name,
      table: column.table ?? "",
      value,
      path,
      fieldValue,
      authority,
    }).filter(([, entryValue]) => entryValue !== undefined)
  ) as TablePasteWrite;
};

const rowForWrite = (rows: DBRow[], write: TablePasteWrite): DBRow =>
  rows.find((row) => row._index == write.rowId) ?? rows[parseInt(write.rowId)];

const columnForWrite = (
  columns: DirectEditColumn[] | undefined,
  write: TablePasteWrite
): DirectEditColumn | undefined =>
  columns?.find(
    (column) =>
      column.name == write.columnName &&
      (column.table ?? "") == write.table &&
      columnIdForDirectColumn(column) == write.columnId
  ) ??
  columns?.find(
    (column) =>
      column.name == write.columnName && (column.table ?? "") == write.table
  );

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
  columns,
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
        fieldValue:
          write.fieldValue !== undefined
            ? columnForWrite(columns, write)?.value ?? ""
            : undefined,
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
