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
  rowDelete?: TableRowDeleteUndo;
  pathDelete?: TablePathDeleteUndo;
};

export type TableRowDeleteSnapshot = {
  index: number;
  row: DBRow;
};

export type TableRowDeleteUndo = {
  rows: TableRowDeleteSnapshot[];
  redoIndices: number[];
};

export type TablePathDeleteSnapshot = {
  path: string;
  content: string;
};

export type TablePathDeleteUndo = {
  paths: TablePathDeleteSnapshot[];
};

export type CreateTableUndoEntryParams = {
  label: string;
  rows: DBRow[];
  writes: TablePasteWrite[];
  columns?: DirectEditColumn[];
};

export type CreateTableRowDeleteUndoEntryParams = {
  label: string;
  rows: DBRow[];
  rowIds: string[];
};

export type CreateTablePathDeleteUndoEntryParams = {
  label: string;
  paths: TablePathDeleteSnapshot[];
};

export type DirectEditColumn = Pick<
  SpaceProperty,
  "name" | "source" | "type" | "value" | "attrs"
> & {
  table?: string;
};

export type TableUndoWriteForDirectEditParams = {
  rowId: string;
  column: DirectEditColumn;
  value: string;
  path?: string;
  fieldValue?: string;
  fieldAttrs?: string | null;
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
  fieldAttrs,
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
      fieldAttrs,
      authority,
    }).filter(([, entryValue]) => entryValue !== undefined)
  ) as unknown as TablePasteWrite;
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
  // For non-file writes, bake the row's resolved path so replay targets the
  // original file by path, not by (possibly reordered) row index. See
  // bd Notidian-sck.
  if (write.authority != "file") return write.path ?? row?.[PathPropertyName];

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
  // Group writes per target cell, preserving first-seen order. The net forward
  // value for a cell is its last write, so undo/redo operate on net effect (one
  // write per cell) rather than replaying an intermediate sequence. This keeps
  // expectedCurrentValue meaningful for replay-conflict detection.
  const order: string[] = [];
  const byKey = new Map<string, { first: TablePasteWrite; net: TablePasteWrite }>();
  for (const write of writes) {
    const key = undoKeyForWrite(write);
    const existing = byKey.get(key);
    if (!existing) {
      order.push(key);
      byKey.set(key, { first: write, net: write });
    } else {
      existing.net = write;
    }
  }

  const inverseWrites: TablePasteWrite[] = [];
  const redoWrites: TablePasteWrite[] = [];

  for (const key of order) {
    const { first, net } = byKey.get(key)!;
    const row = rowForWrite(rows, first);
    if (!row) continue;

    // Pre-edit value of the cell (what undo restores).
    const currentValue = currentValueForWrite(row, first);
    if (currentValue == net.value) continue;

    const bakedPath = currentPathAfterWrite(row, net);
    // expectedCurrentValue gates replay against newer external changes (only for
    // non-file value writes, which flow through executeTableValueWrites).
    const isFile = net.authority == "file";

    // Pre-edit column configuration (option list / attrs) captured at entry-build
    // time. Undefined for writes that carry no field-config change. bd
    // Notidian-o8op.
    const columnForNet = columnForWrite(columns, net);
    const preEditFieldValue =
      net.fieldValue !== undefined ? columnForNet?.value ?? "" : undefined;

    // Undo restores the pre-edit value; valid only if canonical still equals the
    // net value the forward edit produced.
    inverseWrites.push(
      sanitizeHistoryWrite({
        ...net,
        path: bakedPath,
        value: currentValue,
        expectedCurrentValue: isFile ? undefined : net.value,
        fieldValue: preEditFieldValue,
        fieldAttrs:
          net.fieldAttrs !== undefined ? columnForNet?.attrs ?? null : undefined,
        // Undo restores the pre-edit option list only if the column still holds
        // the list the forward edit produced (net.fieldValue); otherwise the
        // whole snapshot is left alone so options added since are preserved. bd
        // Notidian-o8op.
        expectedFieldValue:
          net.fieldValue !== undefined ? net.fieldValue : undefined,
      })
    );

    // Redo re-applies the net forward value; valid only if canonical still equals
    // the value undo restored (currentValue). File writes flow through the rename
    // path, not executeTableValueWrites.
    redoWrites.push(
      isFile
        ? sanitizeHistoryWrite({
            ...net,
            // Redo resolves the target by baked pre-edit file path (identity),
            // never the stale row index a reload/reorder would reassign. Paste
            // writes already carry net.path; the inline rename omits it, so fall
            // back to the row's pre-edit path. bd Notidian-5op7.
            path: net.path ?? (row?.[PathPropertyName] as string | undefined),
          })
        : sanitizeHistoryWrite({
            ...net,
            path: bakedPath,
            expectedCurrentValue: currentValue,
            // Redo re-applies the post-edit option list only if the column still
            // holds the list undo restored (the pre-edit list). bd Notidian-o8op.
            expectedFieldValue: preEditFieldValue,
          })
    );
  }

  return {
    label,
    writes: inverseWrites,
    redoWrites,
  };
};

export const createTableRowDeleteUndoEntry = ({
  label,
  rows,
  rowIds,
}: CreateTableRowDeleteUndoEntryParams): TableUndoEntry => {
  const snapshots = Array.from(new Set(rowIds))
    .map((rowId) => {
      const index = Number(rowId);
      if (!Number.isInteger(index) || index < 0) return null;
      const row = rows.find((candidate) => candidate._index == rowId) ?? rows[index];
      return row ? { index, row: { ...row } } : null;
    })
    .filter((snapshot): snapshot is TableRowDeleteSnapshot => !!snapshot)
    .sort((a, b) => a.index - b.index);

  return {
    label,
    writes: [],
    redoWrites: [],
    rowDelete: {
      rows: snapshots,
      redoIndices: snapshots.map((snapshot) => snapshot.index),
    },
  };
};

export const createTablePathDeleteUndoEntry = ({
  label,
  paths,
}: CreateTablePathDeleteUndoEntryParams): TableUndoEntry => {
  const snapshots = paths.filter(
    (snapshot) =>
      typeof snapshot.path == "string" &&
      snapshot.path.length > 0 &&
      typeof snapshot.content == "string"
  );

  return {
    label,
    writes: [],
    redoWrites: [],
    pathDelete: {
      paths: snapshots,
    },
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
