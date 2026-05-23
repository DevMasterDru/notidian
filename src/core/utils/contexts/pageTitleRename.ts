import { Superstate } from "makemd-core";
import { PathPropertyName } from "shared/types/context";
import { DBRow } from "shared/types/mdb";
import { buildPageTitleRename } from "./pageTitle";

export type RenamePageTitleParams = {
  row: DBRow;
  value: string;
  contextPath: string;
  superstate: Superstate;
  settleDelayMs?: number;
};

const notifyRenameFailure = (superstate: Superstate, message: string) => {
  superstate.ui?.notify?.(message);
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

  const currentIndex = table.rows.findIndex(
    (row) => row[PathPropertyName] == path
  );
  if (currentIndex < 0 || currentIndex == targetIndex) return;

  const rows = [...table.rows];
  const [row] = rows.splice(currentIndex, 1);
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

export const renamePageTitleForRow = async ({
  row,
  value,
  contextPath,
  superstate,
  settleDelayMs = 500,
}: RenamePageTitleParams): Promise<string | null> => {
  const oldPath = row?.[PathPropertyName];
  if (!oldPath) {
    notifyRenameFailure(superstate, "Cannot rename a row without a file path.");
    return null;
  }

  let rename;
  try {
    rename = buildPageTitleRename(oldPath, value);
  } catch (error) {
    notifyRenameFailure(superstate, "Enter a valid file name.");
    return null;
  }

  if (rename.newPath == rename.oldPath) {
    return rename.oldPath;
  }

  const originalIndex = rowIndexForPath(superstate, contextPath, rename.oldPath);
  const targetExists = await superstate.spaceManager.pathExists(rename.newPath);
  const isCaseOnlyRename =
    rename.newPath.toLowerCase() == rename.oldPath.toLowerCase();

  if (targetExists && !isCaseOnlyRename) {
    notifyRenameFailure(superstate, "A file with that name already exists.");
    return null;
  }

  const renamedPath = await superstate.spaceManager.renamePath(
    rename.oldPath,
    rename.newPath
  );

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

  return renamedPath ?? rename.newPath;
};
