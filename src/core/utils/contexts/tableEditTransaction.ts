import { PropertyAuthority } from "core/utils/properties/propertyAuthority";
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
  columnId?: string;
  columnName: string;
  table: string;
  value: string;
  path?: string;
  fieldValue?: string;
  fieldAttrs?: string | null;
  forceFrontmatterWrite?: boolean;
  clear?: true;
  // Only set on undo/redo replay writes: the value canonical frontmatter is
  // expected to hold at replay time (the value the original edit produced). Used
  // instead of the current row value for stale-conflict detection so a replay
  // cannot silently overwrite a newer external change. See bd Notidian-29g.
  expectedCurrentValue?: string;
  // Only set on undo/redo replay writes that restore a field/option
  // configuration: the column `value` this replay expects the column to still
  // hold. If the option list changed since the edit was journaled, the whole
  // snapshot is NOT re-applied (it would clobber the newer options). See bd
  // Notidian-o8op.
  expectedFieldValue?: string;
  // Carried by replay (undo/redo) writes so a write whose column was deleted can
  // be routed by its original authority instead of falling through to the MDB
  // write path. Ordinary forward edits leave this undefined. See bd Notidian-8xzy.
  authority?: Exclude<PropertyAuthority, "computed">;
};

export type TableEditSkipReason =
  | "missing-row"
  | "missing-path"
  | "missing-context-table"
  | "missing-context-row"
  | "frontmatter-conflict"
  | "schema-changed";

export type TableEditFailureReason =
  | "missing-path"
  | "file-rename-failed"
  | "frontmatter-write-failed";

export type TableEditIssue = {
  write: TableCellWrite;
  reason: TableEditSkipReason | TableEditFailureReason;
  currentValue?: string;
  baseValue?: string;
  attemptedValue?: string;
};

export type TableEditTransactionResult = {
  ok: boolean;
  applied: number;
  skipped: TableEditIssue[];
  failed: TableEditIssue[];
};

export const emptyTableEditTransactionResult =
  (): TableEditTransactionResult => ({
    ok: true,
    applied: 0,
    skipped: [],
    failed: [],
  });

// True when every outstanding issue on a transaction result is a permanent
// schema-changed skip (the write's column was deleted from the schema) and
// nothing failed outright. Used by undo/redo replay to tell "this entry can
// never succeed, drop it" apart from a transient frontmatter-conflict skip,
// where the column still exists and a later retry (after a reload) can still
// land — that entry must stay on the stack. bd Notidian-0ykh.
export const isOnlySchemaChangedSkip = (
  result: TableEditTransactionResult
): boolean =>
  result.failed.length == 0 &&
  result.skipped.length > 0 &&
  result.skipped.every((issue) => issue.reason == "schema-changed");

export const combineTableEditTransactionResults = (
  ...results: TableEditTransactionResult[]
): TableEditTransactionResult => ({
  ok: results.every((result) => result.ok),
  applied: results.reduce((total, result) => total + result.applied, 0),
  skipped: results.flatMap((result) => result.skipped),
  failed: results.flatMap((result) => result.failed),
});

export type ExecuteTableValueWritesParams = {
  writes: TableCellWrite[];
  tableData: SpaceTable;
  contextTable: SpaceTables;
  dbSchemaId?: string;
  contextPath?: string;
  resolvePath: (path: string, contextPath?: string) => string;
  shouldWritePropertyToFrontmatter: (column: SpaceProperty) => boolean;
  parseValue: (column: SpaceProperty, value: string) => unknown;
  currentFrontmatterValue?: (params: {
    path: string;
    column: SpaceProperty;
    row: DBRow;
    write: TableCellWrite;
  }) => string | undefined;
  saveFrontmatterProperties: (params: {
    path: string;
    properties: Record<string, unknown>;
  }) => Promise<{ ok: boolean }>;
  saveDB: (table: SpaceTable) => Promise<void> | void;
  saveContextDB: (table: SpaceTable, contextKey: string) => Promise<void> | void;
  contextKeyForTable: (table: string) => string;
  // Bulk operations such as option-value rename must never commit a new field
  // configuration while a stale/conflicting row retains the old value. Ordinary
  // cell/paste edits keep their existing best-effort partial-apply behaviour.
  allOrNothing?: boolean;
  // Per-edit-session record of (resolvedPath, column) cells this serializer
  // session has already written. The stale-conflict gate uses it to tell its
  // OWN pathsIndex lag apart from a genuine external change: pathsIndex settles
  // a beat after we write, so a second edit to a cell we just wrote sees
  // canonicalValue (lagging, pre-edit) != baseValue (our optimistic value) and
  // would FALSE-skip. We relax the gate only for cells in this set, so a
  // first-touch external change is still protected (bd Notidian-29g) while a
  // rapid re-paste no longer silently drops (bd Notidian-2kf7). Threaded by the
  // edit serializer and reset whenever the rendered table reloads.
  sessionEditedKeys?: Set<string>;
};

const frontmatterEditKey = (resolvedPath: string, columnName: string): string =>
  `${resolvedPath}\0${columnName}`;

type FrontmatterGroup = {
  properties: Record<string, unknown>;
  writes: TableCellWrite[];
};

const frontmatterValueForWrite = (
  column: SpaceProperty,
  write: TableCellWrite,
  parseValue: ExecuteTableValueWritesParams["parseValue"]
): unknown => (write.clear ? null : parseValue(column, write.value));

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

const rowForWrite = (rows: DBRow[], write: TableCellWrite): DBRow | undefined => {
  // Replay writes (undo/redo) carry a baked path; resolve by file identity so a
  // row reorder between edit and replay cannot retarget a different row. Falls
  // back to row index for ordinary (non-replay) writes that have no path.
  if (write.path && write.path.trim().length > 0) {
    const byPath = rows.find((row) => row[PathPropertyName] == write.path);
    if (byPath) return byPath;
  }
  return rows[parseInt(write.rowId)];
};

const rowValueForWrite = (row: DBRow, write: TableCellWrite): string =>
  String(row?.[write.columnId] ?? row?.[write.columnName] ?? "");

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
        write.columnName == col.name &&
        (write.fieldValue !== undefined || write.fieldAttrs !== undefined)
    );
    if (!fieldWrite) return col;
    // A replay (undo/redo) field-config write carries the option-list snapshot it
    // expects the column to still hold. If the column's configuration changed
    // since the edit was journaled (e.g. another option added through the column
    // config menu), re-applying the whole snapshot would silently clobber that
    // change, so leave the column's configuration untouched. bd Notidian-o8op.
    if (
      fieldWrite.expectedFieldValue !== undefined &&
      String(col.value ?? "") != fieldWrite.expectedFieldValue
    ) {
      return col;
    }
    return {
      ...col,
      ...(fieldWrite.fieldValue !== undefined
        ? { value: fieldWrite.fieldValue }
        : {}),
      ...(fieldWrite.fieldAttrs !== undefined
        ? { attrs: fieldWrite.fieldAttrs ?? undefined }
        : {}),
    };
  });

const applyRootWrites = (
  tableData: SpaceTable,
  writes: TableCellWrite[]
): SpaceTable => {
  // Resolve each write to a target row index by baked path when present (replay
  // of a possibly-reordered table), else by row index. Keeps root Notidian-owned
  // writes aligned to the originally-edited file, matching the frontmatter and
  // linked-context paths.
  const indexByPath = new Map<string, number>();
  tableData.rows.forEach((row, index) => {
    const path = row[PathPropertyName];
    if (path != null && !indexByPath.has(String(path))) {
      indexByPath.set(String(path), index);
    }
  });
  const targetIndexForWrite = (write: TableCellWrite): number =>
    write.path && indexByPath.has(write.path)
      ? (indexByPath.get(write.path) as number)
      : parseInt(write.rowId);

  return {
    ...tableData,
    cols: applyColumnFieldValues(tableData.cols, writes),
    rows: tableData.rows.map((row, index) => {
      const rowWrites = writes.filter(
        (write) => targetIndexForWrite(write) == index
      );
      if (rowWrites.length == 0) return row;

      return rowWrites.reduce(
        (nextRow, write) => ({
          ...nextRow,
          [write.columnName]: write.value,
        }),
        row
      );
    }),
  };
};

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
  resolvePath,
  shouldWritePropertyToFrontmatter,
  parseValue,
  currentFrontmatterValue,
  saveFrontmatterProperties,
  saveDB,
  saveContextDB,
  contextKeyForTable,
  sessionEditedKeys,
  allOrNothing = false,
}: ExecuteTableValueWritesParams): Promise<TableEditTransactionResult> => {
  const skipped: TableEditIssue[] = [];
  const failed: TableEditIssue[] = [];
  const acceptedWrites: TableCellWrite[] = [];
  const fieldConfigWrites: TableCellWrite[] = [];
  const frontmatterChangesByPath = new Map<string, FrontmatterGroup>();

  // Snapshot of sessionEditedKeys membership as it stood BEFORE this call's
  // classification loop runs. Any editKey already present here was earned by
  // an earlier, separately-committed call and must never be rolled back by
  // THIS call's failures — only marks this call itself speculatively
  // introduces are ours to revoke. Without this distinction, a later,
  // unrelated commit failure for the same (path, column) would delete a
  // legitimate mark protecting an already-landed write, reintroducing the
  // pathsIndex-lag false-conflict bug (Notidian-2kf7) sessionEditedKeys exists
  // to prevent. bd Notidian-cytg.
  const editKeysPresentBeforeThisCall = sessionEditedKeys
    ? new Set(sessionEditedKeys)
    : undefined;
  const editKeysNewlyMarkedThisCall = new Set<string>();

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

    // A replay write for a frontmatter/file-canonical value whose column has
    // since been deleted must NOT fall through to the context-MDB write path:
    // that would make the hidden MDB the durable owner of a frontmatter-backed
    // value (ADR 0001/0017 authority violation). Skip it as schema-changed with
    // feedback instead. Only replay writes carry an authority marker; ordinary
    // forward edits (authority undefined) keep their existing behaviour. bd
    // Notidian-8xzy.
    if (
      !column &&
      (write.authority == "frontmatter" || write.authority == "file")
    ) {
      skipped.push({ write, reason: "schema-changed" });
      continue;
    }

    const targetPath = resolveTableEditPath(
      write.path,
      row[PathPropertyName]
    );
    const writesFrontmatter =
      dbSchemaId == defaultContextSchemaID &&
      column &&
      shouldWritePropertyToFrontmatter(column);
    if (
      column &&
      (write.fieldValue !== undefined || write.fieldAttrs !== undefined)
    ) {
      fieldConfigWrites.push(write);
    }

    if (writesFrontmatter) {
      if (!targetPath) {
        failed.push({ write, reason: "missing-path" });
        continue;
      }

      const resolvedPath = resolvePath(targetPath, contextPath);
      const canonicalValue = currentFrontmatterValue?.({
        path: resolvedPath,
        column,
        row,
        write,
      });
      // For a context write whose column exists ONLY in the linked context (it
      // is not also a root column), the value the user saw — and therefore the
      // stale-conflict base — lives in the linked-context row, not the root row.
      // Reading it from the root row (which lacks the column) yields "" and
      // false-skips the edit as a frontmatter-conflict. Resolve baseValue from
      // the matching contextTable row by path in that case; keep root-row
      // resolution otherwise. bd Notidian-jwfr.
      const rootColumn = tableData.cols.find(
        (col) => col.name == write.columnName
      );
      const baseValueRow =
        write.table != "" && !rootColumn
          ? contextTable[contextKeyForTable(write.table)]?.rows.find(
              (contextRow) => contextRow[PathPropertyName] == targetPath
            ) ?? row
          : row;
      const baseValue =
        write.expectedCurrentValue ?? rowValueForWrite(baseValueRow, write);
      const editKey = frontmatterEditKey(resolvedPath, write.columnName);
      const selfEditedThisSession = sessionEditedKeys?.has(editKey) ?? false;
      if (
        !write.forceFrontmatterWrite &&
        !selfEditedThisSession &&
        canonicalValue !== undefined &&
        canonicalValue != baseValue
      ) {
        skipped.push({
          write,
          reason: "frontmatter-conflict",
          currentValue: canonicalValue,
          baseValue,
          attemptedValue: write.value,
        });
        continue;
      }

      sessionEditedKeys?.add(editKey);
      if (sessionEditedKeys && !editKeysPresentBeforeThisCall?.has(editKey)) {
        editKeysNewlyMarkedThisCall.add(editKey);
      }
      frontmatterChangesByPath.set(resolvedPath, {
        properties: {
          ...(frontmatterChangesByPath.get(resolvedPath)?.properties ?? {}),
          [write.columnName]: frontmatterValueForWrite(
            column,
            write,
            parseValue
          ),
        },
        writes: [
          ...(frontmatterChangesByPath.get(resolvedPath)?.writes ?? []),
          write,
        ],
      });
    }

    acceptedWrites.push(write);
  }

  if (failed.length > 0 || (allOrNothing && skipped.length > 0)) {
    // The whole batch is aborting here, BEFORE the per-path commit loop below
    // ever runs a single saveFrontmatterProperties call — so nothing this
    // call marked as self-edited actually committed to disk. Roll back every
    // mark this call newly introduced (leaving any pre-existing mark from an
    // earlier, already-committed call untouched); otherwise a later, unrelated
    // edit to the same (path, column) would see selfEditedThisSession=true and
    // skip the stale-conflict gate for a write that never landed. bd
    // Notidian-cytg.
    for (const editKey of editKeysNewlyMarkedThisCall) {
      sessionEditedKeys?.delete(editKey);
    }
    return { ok: false, applied: 0, skipped, failed };
  }

  const rootFieldConfigWrites = fieldConfigWrites.filter(
    (write) => write.table == ""
  );
  const preSavedRootFieldConfigWrites = rootFieldConfigWrites.filter(
    (write) => {
      const column = columnForWrite(
        tableData,
        contextTable,
        contextKeyForTable,
        write
      );
      return (
        dbSchemaId == defaultContextSchemaID &&
        column &&
        shouldWritePropertyToFrontmatter(column)
      );
    }
  );
  const preSavedRootFieldConfigWriteSet = new Set(
    preSavedRootFieldConfigWrites
  );
  let rootTableWithPreSavedFieldConfig: SpaceTable | null = null;
  if (preSavedRootFieldConfigWrites.length > 0) {
    rootTableWithPreSavedFieldConfig = {
      ...tableData,
      cols: applyColumnFieldValues(
        tableData.cols,
        preSavedRootFieldConfigWrites
      ),
    };
    await saveDB(rootTableWithPreSavedFieldConfig);
  }

  // Commit frontmatter one path at a time. A mid-batch failure must NOT discard
  // the paths already written to disk, nor abandon the paths not yet attempted.
  // The previous early-return reported applied:0 — so the caller pushed no undo
  // entry for the files it HAD already committed (Ctrl+Z could not revert them)
  // — and silently dropped every path after the first failure (neither applied
  // nor failed). Instead attempt every path and mark only the failed path's
  // writes as failed: they are then excluded from the root/context snapshot
  // updates and the applied count, while the caller keeps an undo entry for the
  // writes that actually committed and surfaces a Notice for the failures. bd
  // Notidian-9oxo.
  const failedFrontmatterWrites = new Set<TableCellWrite>();
  for (const [path, group] of frontmatterChangesByPath.entries()) {
    const writeResult = await saveFrontmatterProperties({
      path,
      properties: group.properties,
    });
    if (!writeResult.ok) {
      for (const write of group.writes) {
        failedFrontmatterWrites.add(write);
        failed.push({ write, reason: "frontmatter-write-failed" });
        // The pre-commit classification loop above speculatively marked this
        // (path, column) as self-edited-this-session BEFORE knowing whether the
        // frontmatter write would actually land. It didn't: roll the mark back
        // so a retry sees this path/column as NOT self-edited and the
        // stale-conflict gate runs normally instead of being relaxed for an
        // edit that never made it to disk. But only if THIS call is the one
        // that speculatively added the mark — if it was already present before
        // this call started (an earlier, separately-committed write to the
        // same cell legitimately marked it), leave it alone: deleting it here
        // would erase protection for that earlier, already-landed write and
        // reintroduce the pathsIndex-lag false-conflict bug (Notidian-2kf7)
        // sessionEditedKeys exists to prevent. bd Notidian-cytg.
        const editKey = frontmatterEditKey(path, write.columnName);
        if (editKeysNewlyMarkedThisCall.has(editKey)) {
          sessionEditedKeys?.delete(editKey);
        }
      }
    }
  }

  const rootWrites = acceptedWrites.filter(
    (write) => write.table == "" && !failedFrontmatterWrites.has(write)
  );

  const hasUnpreSavedRootFieldConfigWrites = rootFieldConfigWrites.some(
    (write) => !preSavedRootFieldConfigWriteSet.has(write)
  );
  if (rootWrites.length > 0 || hasUnpreSavedRootFieldConfigWrites) {
    const rootBaseTable = rootTableWithPreSavedFieldConfig ?? tableData;
    const tableWithRootWrites =
      rootWrites.length > 0 ? applyRootWrites(rootBaseTable, rootWrites) : rootBaseTable;
    await saveDB({
      ...tableWithRootWrites,
      cols: applyColumnFieldValues(
        tableWithRootWrites.cols,
        rootFieldConfigWrites
      ),
    });
  }

  let appliedContextWrites = 0;
  const contextTables = new Set(
    [...acceptedWrites, ...fieldConfigWrites]
      .filter((write) => write.table != "")
      .map((write) => write.table)
  );

  for (const table of contextTables) {
    const contextKey = contextKeyForTable(table);
    const sourceTable = contextTable[contextKey];
    const tableWrites = acceptedWrites.filter(
      (write) => write.table == table && !failedFrontmatterWrites.has(write)
    );
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

    appliedContextWrites += writesWithPaths.length;
    const tableWithRowWrites =
      writesWithPaths.length > 0
        ? applyContextWrites(sourceTable, writesWithPaths)
        : sourceTable;
    const fieldValueWrites = fieldConfigWrites.filter(
      (write) => write.table == table
    );
    const tableWithFieldValues =
      fieldValueWrites.length > 0
        ? {
            ...tableWithRowWrites,
            cols: applyColumnFieldValues(
              tableWithRowWrites.cols,
              fieldValueWrites
            ),
          }
        : tableWithRowWrites;

    if (writesWithPaths.length == 0 && fieldValueWrites.length == 0) continue;

    await saveContextDB(tableWithFieldValues, contextKey);
  }

  return {
    // A mid-batch frontmatter failure leaves applied>0 (the committed paths) but
    // ok:false so the caller surfaces the failure while still keeping an undo
    // entry for the writes that landed. bd Notidian-9oxo.
    ok: failed.length == 0,
    applied: rootWrites.length + appliedContextWrites,
    skipped,
    failed,
  };
};
