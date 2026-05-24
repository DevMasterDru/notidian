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
