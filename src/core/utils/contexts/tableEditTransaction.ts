import { defaultContextSchemaID } from "shared/schemas/context";
import { PathPropertyName } from "shared/types/context";
import {
  DBRow,
  SpaceProperty,
  SpaceTable,
  SpaceTables,
} from "shared/types/mdb";

export type TableCellWrite = {
  rowId: string;
  columnName: string;
  table: string;
  value: string;
  path?: string;
  fieldValue?: string;
};

export type TableEditSkipReason =
  | "missing-row"
  | "missing-path"
  | "missing-context-table"
  | "missing-context-row";

export type TableEditFailureReason =
  | "missing-path"
  | "frontmatter-write-failed";

export type TableEditIssue = {
  write: TableCellWrite;
  reason: TableEditSkipReason | TableEditFailureReason;
};

export type TableEditTransactionResult = {
  ok: boolean;
  applied: number;
  skipped: TableEditIssue[];
  failed: TableEditIssue[];
};

export type ExecuteTableValueWritesParams = {
  writes: TableCellWrite[];
  tableData: SpaceTable;
  contextTable: SpaceTables;
  dbSchemaId?: string;
  contextPath?: string;
  saveAllContextToFrontmatter: boolean;
  resolvePath: (path: string, contextPath?: string) => string;
  shouldWritePropertyToFrontmatter: (
    column: SpaceProperty,
    saveAllContextToFrontmatter: boolean
  ) => boolean;
  parseValue: (column: SpaceProperty, value: string) => unknown;
  saveFrontmatterProperties: (params: {
    path: string;
    properties: Record<string, unknown>;
  }) => Promise<{ ok: boolean }>;
  saveDB: (table: SpaceTable) => Promise<void> | void;
  saveContextDB: (table: SpaceTable, contextKey: string) => Promise<void> | void;
  contextKeyForTable: (table: string) => string;
};

type FrontmatterGroup = {
  properties: Record<string, unknown>;
  writes: TableCellWrite[];
};

export const resolveTableEditPath = (
  explicitPath: string | null | undefined,
  rowPath: string | undefined
): string | undefined =>
  explicitPath && explicitPath.trim().length > 0 ? explicitPath : rowPath;

export const applyTableEditPathOverrides = <T extends TableCellWrite>(
  writes: T[],
  pathByRowId: Map<string, string>
): T[] =>
  writes.map((write) =>
    pathByRowId.has(write.rowId)
      ? { ...write, path: pathByRowId.get(write.rowId) }
      : write
  );

const rowForWrite = (rows: DBRow[], write: TableCellWrite): DBRow | undefined =>
  rows[parseInt(write.rowId)];

const columnForWrite = (
  tableData: SpaceTable,
  contextTable: SpaceTables,
  contextKeyForTable: (table: string) => string,
  write: TableCellWrite
): SpaceProperty | undefined => {
  if (write.table == "") {
    return tableData.cols.find((col) => col.name == write.columnName);
  }

  const contextKey = contextKeyForTable(write.table);
  return contextTable[contextKey]?.cols.find(
    (col) => col.name == write.columnName
  );
};

const applyColumnFieldValues = (
  cols: SpaceProperty[],
  writes: TableCellWrite[]
): SpaceProperty[] =>
  cols.map((col) => {
    const fieldWrite = writes.find(
      (write) =>
        write.columnName == col.name && write.fieldValue !== undefined
    );
    return fieldWrite ? { ...col, value: fieldWrite.fieldValue } : col;
  });

const applyRootWrites = (
  tableData: SpaceTable,
  writes: TableCellWrite[]
): SpaceTable => ({
  ...tableData,
  cols: applyColumnFieldValues(tableData.cols, writes),
  rows: tableData.rows.map((row, index) => {
    const rowWrites = writes.filter((write) => parseInt(write.rowId) == index);
    if (rowWrites.length == 0) return row;

    return rowWrites.reduce(
      (nextRow, write) => ({
        ...nextRow,
        [write.columnName]: write.value,
      }),
      row
    );
  }),
});

const applyContextWrites = (
  table: SpaceTable,
  writesWithPaths: { write: TableCellWrite; path: string }[]
): SpaceTable => ({
  ...table,
  cols: applyColumnFieldValues(
    table.cols,
    writesWithPaths.map(({ write }) => write)
  ),
  rows: table.rows.map((row) => {
    const rowWrites = writesWithPaths
      .filter(({ path }) => row[PathPropertyName] == path)
      .map(({ write }) => write);
    if (rowWrites.length == 0) return row;

    return rowWrites.reduce(
      (nextRow, write) => ({
        ...nextRow,
        [write.columnName]: write.value,
      }),
      row
    );
  }),
});

export const executeTableValueWrites = async ({
  writes,
  tableData,
  contextTable,
  dbSchemaId,
  contextPath,
  saveAllContextToFrontmatter,
  resolvePath,
  shouldWritePropertyToFrontmatter,
  parseValue,
  saveFrontmatterProperties,
  saveDB,
  saveContextDB,
  contextKeyForTable,
}: ExecuteTableValueWritesParams): Promise<TableEditTransactionResult> => {
  const skipped: TableEditIssue[] = [];
  const failed: TableEditIssue[] = [];
  const acceptedWrites: TableCellWrite[] = [];
  const frontmatterChangesByPath = new Map<string, FrontmatterGroup>();

  for (const write of writes) {
    const row = rowForWrite(tableData.rows, write);
    if (!row) {
      skipped.push({ write, reason: "missing-row" });
      continue;
    }

    const column = columnForWrite(
      tableData,
      contextTable,
      contextKeyForTable,
      write
    );
    const targetPath = resolveTableEditPath(
      write.path,
      row[PathPropertyName]
    );
    const writesFrontmatter =
      dbSchemaId == defaultContextSchemaID &&
      column &&
      shouldWritePropertyToFrontmatter(
        column,
        saveAllContextToFrontmatter
      );

    if (writesFrontmatter) {
      if (!targetPath) {
        failed.push({ write, reason: "missing-path" });
        continue;
      }

      const resolvedPath = resolvePath(targetPath, contextPath);
      frontmatterChangesByPath.set(resolvedPath, {
        properties: {
          ...(frontmatterChangesByPath.get(resolvedPath)?.properties ?? {}),
          [write.columnName]: parseValue(column, write.value),
        },
        writes: [
          ...(frontmatterChangesByPath.get(resolvedPath)?.writes ?? []),
          write,
        ],
      });
    }

    acceptedWrites.push(write);
  }

  if (failed.length > 0) {
    return { ok: false, applied: 0, skipped, failed };
  }

  for (const [path, group] of frontmatterChangesByPath.entries()) {
    const writeResult = await saveFrontmatterProperties({
      path,
      properties: group.properties,
    });
    if (!writeResult.ok) {
      return {
        ok: false,
        applied: 0,
        skipped,
        failed: group.writes.map((write) => ({
          write,
          reason: "frontmatter-write-failed",
        })),
      };
    }
  }

  const rootWrites = acceptedWrites.filter((write) => write.table == "");
  if (rootWrites.length > 0) {
    await saveDB(applyRootWrites(tableData, rootWrites));
  }

  let appliedContextWrites = 0;
  const contextTables = new Set(
    acceptedWrites
      .filter((write) => write.table != "")
      .map((write) => write.table)
  );

  for (const table of contextTables) {
    const contextKey = contextKeyForTable(table);
    const sourceTable = contextTable[contextKey];
    const tableWrites = acceptedWrites.filter((write) => write.table == table);
    if (!sourceTable) {
      skipped.push(
        ...tableWrites.map((write) => ({
          write,
          reason: "missing-context-table" as const,
        }))
      );
      continue;
    }

    const writesWithPaths = tableWrites.flatMap((write) => {
      const row = rowForWrite(tableData.rows, write);
      const path = resolveTableEditPath(write.path, row?.[PathPropertyName]);
      if (!path) {
        skipped.push({ write, reason: "missing-path" });
        return [];
      }
      if (
        !sourceTable.rows.some(
          (contextRow) => contextRow[PathPropertyName] == path
        )
      ) {
        skipped.push({ write, reason: "missing-context-row" });
        return [];
      }
      return [{ write, path }];
    });

    if (writesWithPaths.length == 0) continue;

    appliedContextWrites += writesWithPaths.length;
    await saveContextDB(
      applyContextWrites(sourceTable, writesWithPaths),
      contextKey
    );
  }

  return {
    ok: true,
    applied: rootWrites.length + appliedContextWrites,
    skipped,
    failed: [],
  };
};
