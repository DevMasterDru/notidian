import { Superstate } from "makemd-core";
import { PathPropertyName } from "shared/types/context";
import { DBRow } from "shared/types/mdb";
import { buildPageTitleRename, validatePageTitle } from "./pageTitle";
import type { PageTitleValidationReason } from "./pageTitle";

export type RenamePageTitleParams = {
  row: DBRow;
  value: string;
  contextPath: string;
  superstate: Superstate;
  settleDelayMs?: number;
};

export type RenamePageTitleFailureReason =
  | "missing-path"
  | PageTitleValidationReason
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

export type BulkPageTitleRenameApplied = {
  row: DBRow;
  value: string;
  oldPath: string;
  newPath: string;
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
  | {
      ok: false;
      applied: BulkPageTitleRenameApplied[];
      failures: BulkPageTitleRenameFailure[];
      error?: unknown;
    };

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
    case "illegal-characters":
      return "File names cannot contain reserved filesystem characters.";
    case "reserved-name":
      return "Choose a file name that is not reserved by the filesystem.";
    case "trailing-dot-space":
      return "File names cannot end with a dot or space.";
    case "too-long":
      return "File names must be 255 characters or fewer.";
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

const normalizePathKey = (path: string): string =>
  path.normalize("NFC").toLowerCase();

const bulkRenameApplied = (rename: {
  row: DBRow;
  value: string;
  oldPath: string;
  newPath: string;
}): BulkPageTitleRenameApplied => ({
  row: rename.row,
  value: rename.value,
  oldPath: rename.oldPath,
  newPath: rename.newPath,
});

const bulkRenameFailure = (rename: {
  row: DBRow;
  value: string;
}): BulkPageTitleRenameFailure => ({
  row: rename.row,
  value: rename.value,
  reason: "rename-failed",
});

const bulkRenameResultKey = (row: DBRow, value: string): string =>
  `${row[PathPropertyName] ?? ""}\u0000${value}`;

const safePathExists = async (
  superstate: Superstate,
  path: string
): Promise<boolean> => {
  try {
    return await superstate.spaceManager.pathExists(path);
  } catch (_error) {
    return false;
  }
};

const tableRowsHaveSamePaths = (left: DBRow[], right: DBRow[]): boolean =>
  left.length == right.length &&
  left.every(
    (row, index) => row[PathPropertyName] == right[index]?.[PathPropertyName]
  );

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
  renames: BulkPageTitleRenameApplied[],
  originalRows: DBRow[]
): Promise<BulkPageTitleRenameFailure[]> => {
  if (!contextPath || renames.length == 0) return [];

  const context = superstate.contextsIndex?.get(contextPath);
  const table = context?.contextTable;
  if (!table) return [];

  const renameMap = new Map(
    renames.map((rename) => [rename.oldPath, rename])
  );
  const oldPathKeys = new Set(
    renames.map((rename) => normalizePathKey(rename.oldPath))
  );
  const usedRows = new Set<number>();
  const failures: BulkPageTitleRenameFailure[] = [];
  const rows: DBRow[] = [];

  for (const originalRow of originalRows) {
    const originalPath = originalRow[PathPropertyName];
    const rename = renameMap.get(originalPath);
    const targetPath = rename?.newPath ?? originalPath;
    const matchingIndex = table.rows.findIndex(
      (row, index) =>
        !usedRows.has(index) && row[PathPropertyName] == targetPath
    );

    if (matchingIndex >= 0) {
      usedRows.add(matchingIndex);
      rows.push(table.rows[matchingIndex]);
      continue;
    }

    if (targetPath && (await safePathExists(superstate, targetPath))) {
      rows.push({
        ...originalRow,
        [PathPropertyName]: targetPath,
      });
      continue;
    }

    if (rename) {
      failures.push(bulkRenameFailure(rename));
    }
  }

  for (let index = 0; index < table.rows.length; index++) {
    const row = table.rows[index];
    const rowPath = row[PathPropertyName];
    if (usedRows.has(index)) continue;
    if (rowPath && oldPathKeys.has(normalizePathKey(rowPath))) continue;
    if (rows.some((r) => r[PathPropertyName] == row[PathPropertyName])) {
      continue;
    }
    rows.push(row);
  }

  if (tableRowsHaveSamePaths(table.rows, rows)) {
    return failures;
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

  return failures;
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
    return { ok: false, applied: [], failures: plan.failures };
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
  const renameStates = tempRenames.map((rename) => ({
    ...rename,
    state: "old" as "old" | "temp" | "final",
  }));

  try {
    for (const rename of renameStates) {
      const renamedPath = await superstate.spaceManager.renamePath(
        rename.oldPath,
        rename.tempPath
      );
      // The Obsidian adapter resolves null on a failed rename instead of
      // throwing; treat a falsy result as failure so rollback/partial-result
      // handling runs. See bd Notidian-lrf / Notidian-79s.
      if (!renamedPath) {
        throw new Error(`rename-failed: ${rename.oldPath} -> ${rename.tempPath}`);
      }
      rename.state = "temp";
    }

    for (const rename of renameStates) {
      const renamedPath = await superstate.spaceManager.renamePath(
        rename.tempPath,
        rename.newPath
      );
      if (!renamedPath) {
        throw new Error(`rename-failed: ${rename.tempPath} -> ${rename.newPath}`);
      }
      rename.state = "final";
    }
  } catch (error) {
    for (const rename of renameStates.slice().reverse()) {
      if (rename.state != "temp") continue;
      try {
        const rolledBackPath = await superstate.spaceManager.renamePath(
          rename.tempPath,
          rename.oldPath
        );
        // Only consider the file restored if the rollback actually moved it.
        if (rolledBackPath) rename.state = "old";
      } catch (_rollbackError) {}
    }

    let applied = renameStates
      .filter((rename) => rename.state == "final")
      .map(bulkRenameApplied);
    let failures = renameStates
      .filter((rename) => rename.state != "final")
      .map(bulkRenameFailure);

    if (contextPath && applied.length > 0) {
      if (settleDelayMs > 0) await sleep(settleDelayMs);
      await waitForContextStateQueue(superstate);
      await superstate.reloadContextByPath?.(contextPath, {
        force: true,
        calculate: true,
      });
      const reconciliationFailures = await reconcileBulkContextRows(
        superstate,
        contextPath,
        applied,
        originalRows
      );
      const reconciliationFailureKeys = new Set(
        reconciliationFailures.map(
          (failure) => bulkRenameResultKey(failure.row, failure.value)
        )
      );
      applied = applied.filter(
        (rename) =>
          !reconciliationFailureKeys.has(
            bulkRenameResultKey(rename.row, rename.value)
          )
      );
      failures = [...failures, ...reconciliationFailures];
    }

    notifyBulkRenameFailure(superstate);
    return {
      ok: false,
      applied,
      failures,
      error,
    };
  }

  const applied = changedRenames.map(bulkRenameApplied);
  if (contextPath) {
    if (settleDelayMs > 0) await sleep(settleDelayMs);
    await waitForContextStateQueue(superstate);
    await superstate.reloadContextByPath?.(contextPath, {
      force: true,
      calculate: true,
    });
    const reconciliationFailures = await reconcileBulkContextRows(
      superstate,
      contextPath,
      applied,
      originalRows
    );
    if (reconciliationFailures.length > 0) {
      const reconciliationFailureKeys = new Set(
        reconciliationFailures.map(
          (failure) => bulkRenameResultKey(failure.row, failure.value)
        )
      );
      notifyBulkRenameFailure(superstate);
      return {
        ok: false,
        applied: applied.filter(
          (rename) =>
            !reconciliationFailureKeys.has(
              bulkRenameResultKey(rename.row, rename.value)
            )
        ),
        failures: reconciliationFailures,
      };
    }
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

  let renamedPath: string | null | undefined;
  try {
    renamedPath = await superstate.spaceManager.renamePath(
      rename.oldPath,
      rename.newPath
    );
  } catch (error) {
    notifyRenameFailure(superstate, "rename-failed");
    return { ok: false, reason: "rename-failed", error };
  }
  if (!renamedPath) {
    notifyRenameFailure(superstate, "rename-failed");
    return { ok: false, reason: "rename-failed" };
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
