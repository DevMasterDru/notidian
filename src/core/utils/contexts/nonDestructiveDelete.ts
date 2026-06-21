import { deletePath } from "core/superstate/utils/path";
import { Superstate } from "makemd-core";
import React from "react";
import { collectSubtreePaths } from "core/utils/contexts/tableRowTree";
import { PathPropertyName } from "shared/types/context";
import i18n from "shared/i18n";
import { SubItemDeleteModal } from "core/react/components/UI/Modals/SubItemDeleteModal";

// Non-destructive parent-delete config (Notidian-5ond.8). When sub-items is
// active the menu caller threads the VISIBLE row set + the tree's parent key and
// resolver here so the delete handler can compute (with the SAME ancestry
// resolution buildRowTree uses) whether the deleted row has descendants — and, if
// so, show the 3-way prompt instead of a silent recursive delete. Absent / leaf
// rows stay a silent, unprompted delete (never a regression for childless rows).
export type SubItemsDeleteConfig = {
  // The tree READ key (= name+table, what buildRowTree's parentKey uses).
  parentKey: string;
  // The VISIBLE filteredSortedData rows (the same set the tree is built from).
  rows: Record<string, any>[];
  // The live link resolver (makeRelationLinkResolver) so bare/aliased parent
  // links canonicalize to row paths exactly as the rendered tree does.
  resolveLink?: (link: string, sourcePath: string) => string;
};

// Non-destructive parent-delete decision (Notidian-5ond.8, ADR 0050). Shared by
// the MDB row menu (rowContextMenu) and the path menu (pathContextMenu) so the
// "deleting a parent with sub-items must never silently nuke the subtree" rule
// lives in ONE place and the two menus can never diverge.
//
//   - LEAF rows (no visible descendants) -> `deleteSelf()` runs immediately,
//     unprompted. This preserves the legacy silent delete for childless rows
//     (never a regression).
//   - PARENT rows (>= 1 visible descendant) -> the 3-way SubItemDeleteModal:
//       (1) delete this item only / promote children -> `deleteSelf()` only.
//           NO child rewrite: orphaned children surface as roots next render.
//       (2) delete this + all N sub-items -> `deleteSelf()` for the parent, then
//           deletePath() over every descendant path (order matters — see below).
//       (3) cancel -> no-op.
//
// `deleteSelf` is supplied by the caller because the parent's own removal differs
// per surface (deleteRowInTable for an MDB row vs deletePath for a folder/primary
// row), but descendant removal is always path-based (deletePath) — descendants are
// real vault files regardless of the table they were surfaced in.
export const requestRowDeleteWithSubItems = (params: {
  superstate: Superstate;
  // Resolved path of the row being deleted (its PathPropertyName value).
  rootPath: string;
  // The tree READ key + visible rows + resolver, or undefined when sub-items is
  // off — in which case this degrades to an immediate `deleteSelf()` (silent).
  subItemsDelete?: SubItemsDeleteConfig;
  // Removes JUST the parent row (surface-specific). Children are never rewritten.
  deleteSelf: () => void | Promise<void>;
  // The window the modal should open in.
  win: Window;
}): void => {
  const { superstate, rootPath, subItemsDelete, deleteSelf, win } = params;

  const subtree =
    subItemsDelete && rootPath
      ? collectSubtreePaths(
          subItemsDelete.rows,
          subItemsDelete.parentKey,
          PathPropertyName,
          subItemsDelete.resolveLink,
          rootPath
        )
      : [];

  // Leaf row (or sub-items off): keep the silent, unprompted delete.
  if (subtree.length === 0) {
    void deleteSelf();
    return;
  }

  // Parent row: force an explicit, non-destructive-by-default choice.
  superstate.ui.openModal(
    i18n.menu.deleteRow,
    React.createElement(SubItemDeleteModal, {
      subItemCount: subtree.length,
      // (1) Default: delete only this item; children promote to roots.
      deleteOnly: () => {
        void deleteSelf();
      },
      // (2) Delete this item AND every descendant path.
      deleteRecursive: () => {
        void (async () => {
          // Remove the parent FIRST, then the descendant files. Order matters for
          // the MDB surface: deleteSelf there is deleteRowInTable(index), and
          // deleting a descendant FILE first (deletePath) re-indexes the table —
          // a stale index would then nuke the WRONG row. The parent index is only
          // valid right now, so spend it before any descendant delete shifts it.
          // For the path surface (deletePath by path) the order is immaterial.
          await deleteSelf();
          for (const path of subtree) {
            await deletePath(superstate, path);
          }
        })();
      },
    }),
    win
  );
};
