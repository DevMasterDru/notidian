export type GuardedRowDeleteHandlers = {
  // The MDB delete write (deleteRowsInTable). May reject on a locked file,
  // concurrent save, or I/O error.
  deleteRows: () => Promise<void>;
  // Commit the delete's UI side effects — push the undo entry and clear the
  // selection — ONLY after the write actually succeeds.
  onDeleted: () => void;
  // Surface the failure to the user; the optimistic UI (selection) is left
  // intact so the delete can be retried.
  onError: () => void;
};

// Await a whole-row delete write and only commit its UI side effects when it
// succeeds; notify on rejection. This replaces a floating
// `void deleteRowsInTable(...).then(() => { pushUndo; clearSelection })` whose
// missing .catch swallowed write failures — the rows silently persisted (and
// reappeared on reload), no Notice was shown, and the rejection surfaced only as
// an unhandled promise rejection in devtools. Mirrors deletePrimarySelectedRows'
// try/catch. bd Notidian-1lkz.
export const runGuardedRowDelete = async (
  handlers: GuardedRowDeleteHandlers
): Promise<boolean> => {
  try {
    await handlers.deleteRows();
    handlers.onDeleted();
    return true;
  } catch (error) {
    handlers.onError();
    return false;
  }
};
