import { Superstate } from "makemd-core";
import { PathPropertyName } from "shared/types/context";
import { DBRow } from "shared/types/mdb";
import { buildPageTitleRename, validatePageTitle } from "./pageTitle";

export type RenamePageTitleParams = {
  row: DBRow;
  value: string;
  contextPath: string;
  superstate: Superstate;
  settleDelayMs?: number;
};

export type RenamePageTitleFailureReason =
  | "missing-path"
  | "empty"
  | "slash"
  | "duplicate"
  | "rename-failed";

export type RenamePageTitleResult =
  | { ok: true; path: string; changed: boolean }
  | { ok: false; reason: RenamePageTitleFailureReason; error?: unknown };

export type BulkPageTitleRenameItem = {
  row: DBRow;
  value: string;
};

export type BulkPageTitleRenameFailureReason =
  | RenamePageTitleFailureReason
  | "internal-duplicate";

export type BulkPageTitleRenameFailure = {
  row: DBRow;
  value: string;
  reason: BulkPageTitleRenameFailureReason;
};

export type BulkPageTitleRenamePlan =
  | {
      ok: true;
      renames: {
        row: DBRow;
        value: string;
        oldPath: string;
        newPath: string;
        originalIndex: number;
        changed: boolean;
      }[];
    }
  | { ok: false; failures: BulkPageTitleRenameFailure[] };

export type BulkPageTitleRenameResult =
  | { ok: true; paths: string[] }
  | { ok: false; failures: BulkPageTitleRenameFailure[]; error?: unknown };

export type BulkPageTitleRenameParams = {
  items: BulkPageTitleRenameItem[];
  contextPath: string;
  superstate: Superstate;
  settleDelayMs?: number;
};

const renameFailureMessage = (reason: RenamePageTitleFailureReason): string => {
  switch (reason) {
    case "missing-path":
      return "Cannot rename a row without a file path.";
    case "empty":
      return "Enter a file name.";
    case "slash":
      return "Use the move command to change folders. File names cannot contain '/'.";
    case "duplicate":
      return "A file with that name already exists.";
    case "rename-failed":
      return "Could not rename the file.";
  }
};

const notifyRenameFailure = (
  superstate: Superstate,
  reason: RenamePageTitleFailureReason
) => {
  superstate.ui?.notify?.(renameFailureMessage(reason));
};

const sleep = (ms: number) =>
  new Promise((resolve) => window.setTimeout(resolve, ms));

const waitForContextStateQueue = async (superstate: Superstate) => {
  const queue = (superstate as unknown as { contextStateQueue?: Promise<unknown> })
    .contextStateQueue;
  if (queue) await queue;
};

const rowIndexForPath = (
  superstate: Superstate,
  contextPath: string,
  path: string
) =>
  superstate.contextsIndex
    ?.get(contextPath)
    ?.contextTable?.rows?.findIndex((row) => row[PathPropertyName] == path) ??
  -1;

const preserveContextRowPosition = async (
  superstate: Superstate,
  contextPath: string,
  path: string,
  targetIndex: number
) => {
  if (!contextPath || targetIndex < 0) return;

  const table = superstate.contextsIndex?.get(contextPath)?.contextTable;
  if (!table) return;

  const matchingRows = table.rows.filter(
    (row) => row[PathPropertyName] == path
  );
  if (matchingRows.length == 0) return;

  const currentIndex = table.rows.findIndex(
    (row) => row[PathPropertyName] == path
  );
  if (currentIndex == targetIndex && matchingRows.length == 1) return;

  const rows = table.rows.filter((row) => row[PathPropertyName] != path);
  const row = matchingRows[0];
  rows.splice(Math.min(targetIndex, rows.length), 0, row);

  await superstate.spaceManager.saveTable(
    contextPath,
    {
      ...table,
      rows,
    },
    true
  );
  await superstate.reloadContextByPath?.(contextPath, {
    force: true,
    calculate: true,
  });
};

const notifyBulkRenameFailure = (superstate: Superstate) => {
  superstate.ui?.notify?.("Could not rename all selected files.");
};

const normalizePathKey = (path: string): string => path.toLowerCase();

const extensionForPath = (path: string): string => {
  const fileName = path.split("/").pop() ?? path;
  const dotIndex = fileName.lastIndexOf(".");
  return dotIndex <= 0 ? "" : fileName.slice(dotIndex);
};

const folderForPath = (path: string): string => {
  const slashIndex = path.lastIndexOf("/");
  return slashIndex < 0 ? "" : path.slice(0, slashIndex);
};

const temporaryPathForRename = (
  path: string,
  operationId: string,
  index: number
): string => {
  const folder = folderForPath(path);
  const extension = extensionForPath(path);
  const tempName = `.notidian-renaming-${operationId}-${index}${extension}`;
  return folder ? `${folder}/${tempName}` : tempName;
};

const reconcileBulkContextRows = async (
  superstate: Superstate,
  contextPath: string,
  renames: { oldPath: string; newPath: string }[],
  originalRows: DBRow[]
) => {
  if (!contextPath || renames.length == 0) return;

  const context = superstate.contextsIndex?.get(contextPath);
  const table = context?.contextTable;
  if (!table) return;

  const renameMap = new Map(
    renames.map((rename) => [rename.oldPath, rename.newPath])
  );
  const usedRows = new Set<number>();
  const rows = originalRows.reduce<DBRow[]>((nextRows, originalRow) => {
    const targetPath =
      renameMap.get(originalRow[PathPropertyName]) ??
      originalRow[PathPropertyName];
    const matchingIndex = table.rows.findIndex(
      (row, index) =>
        !usedRows.has(index) && row[PathPropertyName] == targetPath
    );

    if (matchingIndex >= 0) {
      usedRows.add(matchingIndex);
      return [...nextRows, table.rows[matchingIndex]];
    }

    return [
      ...nextRows,
      {
        ...originalRow,
        [PathPropertyName]: targetPath,
      },
    ];
  }, []);

  for (let index = 0; index < table.rows.length; index++) {
    const row = table.rows[index];
    if (usedRows.has(index)) continue;
    if (rows.some((r) => r[PathPropertyName] == row[PathPropertyName])) {
      continue;
    }
    rows.push(row);
  }

  await superstate.spaceManager.saveTable(
    contextPath,
    {
      ...table,
      rows,
    },
    true
  );
  await superstate.reloadContextByPath?.(contextPath, {
    force: true,
    calculate: true,
  });
};

export const planBulkPageTitleRename = async ({
  items,
  contextPath,
  superstate,
}: BulkPageTitleRenameParams): Promise<BulkPageTitleRenamePlan> => {
  const failures: BulkPageTitleRenameFailure[] = [];
  const renames: Extract<BulkPageTitleRenamePlan, { ok: true }>["renames"] =
    [];
  const targetKeys = new Set<string>();

  for (const item of items) {
    const oldPath = item.row?.[PathPropertyName];
    if (!oldPath) {
      failures.push({
        row: item.row,
        value: item.value,
        reason: "missing-path",
      });
      continue;
    }

    const validation = validatePageTitle(item.value);
    if (validation.ok == false) {
      failures.push({
        row: item.row,
        value: item.value,
        reason: validation.reason,
      });
      continue;
    }

    const rename = buildPageTitleRename(oldPath, validation.title);
    const targetKey = normalizePathKey(rename.newPath);
    if (targetKeys.has(targetKey)) {
      failures.push({
        row: item.row,
        value: item.value,
        reason: "internal-duplicate",
      });
      continue;
    }
    targetKeys.add(targetKey);

    renames.push({
      row: item.row,
      value: item.value,
      oldPath: rename.oldPath,
      newPath: rename.newPath,
      originalIndex: rowIndexForPath(superstate, contextPath, rename.oldPath),
      changed: rename.oldPath != rename.newPath,
    });
  }

  if (failures.length > 0) return { ok: false, failures };

  const oldPathKeys = new Set(
    renames.map((rename) => normalizePathKey(rename.oldPath))
  );

  for (const rename of renames) {
    if (!rename.changed) continue;
    let targetExists: boolean;
    try {
      targetExists = await superstate.spaceManager.pathExists(rename.newPath);
    } catch (error) {
      return {
        ok: false,
        failures: [
          {
            row: rename.row,
            value: rename.value,
            reason: "rename-failed",
          },
        ],
      };
    }

    const isCaseOnlyRename =
      normalizePathKey(rename.oldPath) == normalizePathKey(rename.newPath);
    if (
      targetExists &&
      !isCaseOnlyRename &&
      !oldPathKeys.has(normalizePathKey(rename.newPath))
    ) {
      failures.push({
        row: rename.row,
        value: rename.value,
        reason: "duplicate",
      });
    }
  }

  return failures.length > 0 ? { ok: false, failures } : { ok: true, renames };
};

export const executeBulkPageTitleRename = async ({
  items,
  contextPath,
  superstate,
  settleDelayMs = 500,
}: BulkPageTitleRenameParams): Promise<BulkPageTitleRenameResult> => {
  const plan = await planBulkPageTitleRename({
    items,
    contextPath,
    superstate,
    settleDelayMs,
  });

  if (plan.ok == false) {
    notifyBulkRenameFailure(superstate);
    return plan;
  }

  const changedRenames = plan.renames.filter((rename) => rename.changed);
  if (changedRenames.length == 0) {
    return { ok: true, paths: plan.renames.map((rename) => rename.oldPath) };
  }

  const operationId = `${Date.now()}`;
  const tempRenames = changedRenames.map((rename, index) => ({
    ...rename,
    tempPath: temporaryPathForRename(rename.oldPath, operationId, index),
  }));
  const originalRows =
    superstate.contextsIndex
      ?.get(contextPath)
      ?.contextTable?.rows?.map((row) => ({ ...row })) ?? [];
  const movedToTemp: typeof tempRenames = [];
  const movedToFinal: typeof tempRenames = [];

  try {
    for (const rename of tempRenames) {
      await superstate.spaceManager.renamePath(rename.oldPath, rename.tempPath);
      movedToTemp.push(rename);
    }

    for (const rename of tempRenames) {
      await superstate.spaceManager.renamePath(rename.tempPath, rename.newPath);
      movedToFinal.push(rename);
    }
  } catch (error) {
    for (const rename of movedToTemp.slice().reverse()) {
      if (movedToFinal.some((moved) => moved.oldPath == rename.oldPath)) {
        continue;
      }
      try {
        await superstate.spaceManager.renamePath(rename.tempPath, rename.oldPath);
      } catch (_rollbackError) {}
    }
    notifyBulkRenameFailure(superstate);
    return {
      ok: false,
      failures: changedRenames.map((rename) => ({
        row: rename.row,
        value: rename.value,
        reason: "rename-failed",
      })),
      error,
    };
  }

  if (contextPath) {
    if (settleDelayMs > 0) await sleep(settleDelayMs);
    await waitForContextStateQueue(superstate);
    await superstate.reloadContextByPath?.(contextPath, {
      force: true,
      calculate: true,
    });
    await reconcileBulkContextRows(
      superstate,
      contextPath,
      changedRenames,
      originalRows
    );
  }

  return { ok: true, paths: plan.renames.map((rename) => rename.newPath) };
};

export const renamePageTitleForRowWithResult = async ({
  row,
  value,
  contextPath,
  superstate,
  settleDelayMs = 500,
}: RenamePageTitleParams): Promise<RenamePageTitleResult> => {
  const oldPath = row?.[PathPropertyName];
  if (!oldPath) {
    notifyRenameFailure(superstate, "missing-path");
    return { ok: false, reason: "missing-path" };
  }

  const validation = validatePageTitle(value);
  if (validation.ok == false) {
    notifyRenameFailure(superstate, validation.reason);
    return { ok: false, reason: validation.reason };
  }

  const rename = buildPageTitleRename(oldPath, validation.title);

  if (rename.newPath == rename.oldPath) {
    return { ok: true, path: rename.oldPath, changed: false };
  }

  const originalIndex = rowIndexForPath(superstate, contextPath, rename.oldPath);
  let targetExists: boolean;
  try {
    targetExists = await superstate.spaceManager.pathExists(rename.newPath);
  } catch (error) {
    notifyRenameFailure(superstate, "rename-failed");
    return { ok: false, reason: "rename-failed", error };
  }

  const isCaseOnlyRename =
    rename.newPath.toLowerCase() == rename.oldPath.toLowerCase();
  if (targetExists && !isCaseOnlyRename) {
    notifyRenameFailure(superstate, "duplicate");
    return { ok: false, reason: "duplicate" };
  }

  let renamedPath: string;
  try {
    renamedPath = await superstate.spaceManager.renamePath(
      rename.oldPath,
      rename.newPath
    );
  } catch (error) {
    notifyRenameFailure(superstate, "rename-failed");
    return { ok: false, reason: "rename-failed", error };
  }

  if (contextPath) {
    if (settleDelayMs > 0) await sleep(settleDelayMs);
    await waitForContextStateQueue(superstate);
    await superstate.reloadContextByPath?.(contextPath, {
      force: true,
      calculate: true,
    });
    await preserveContextRowPosition(
      superstate,
      contextPath,
      renamedPath ?? rename.newPath,
      originalIndex
    );
  }

  return { ok: true, path: renamedPath ?? rename.newPath, changed: true };
};

export const renamePageTitleForRow = async (
  params: RenamePageTitleParams
): Promise<string | null> => {
  const result = await renamePageTitleForRowWithResult(params);
  return result.ok ? result.path : null;
};
