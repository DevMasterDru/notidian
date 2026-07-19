import { deletePath } from "core/superstate/utils/path";
import { Superstate } from "makemd-core";
import React from "react";
import {
  RowTreeNode,
  subtreePathsFromTree,
} from "core/utils/contexts/tableRowTree";
import { PathPropertyName } from "shared/types/context";
import i18n from "shared/i18n";
import { SubItemDeleteModal } from "core/react/components/UI/Modals/SubItemDeleteModal";

// Non-destructive parent-delete config (Notidian-5ond.8, hardened in review).
// When sub-items is active the menu caller threads the FULL buildRowTree output
// here so the delete handler resolves descendants over the SAME object the tree
// rendered — never a collapsed / limited / parents-only PROJECTION of it.
//
// CRITICAL: this must be the FULL tree (subItemsFullTree — collapse-,
// predicate.limit-, and display-mode-independent), NOT filteredData. filteredData
// is the visible projection: under a collapsed parent it omits the hidden
// descendants, in parents-only it is roots-only, and predicate.limit truncates it.
// Resolving the subtree over that projection made a parent with hidden descendants
// look like a LEAF, so the 3-way prompt never opened and the parent was deleted
// SILENTLY while its files were orphaned — the exact footgun this bead removes
// (5ond.8 review findings 1/2/3). Feeding the full tree keeps the count and the
// silent-vs-prompt decision tied to what actually exists beneath the row.
export type SubItemsDeleteConfig = {
  // The FULL depth-first tree nodes from buildRowTree (subItemsFullTree). The
  // descendant set is sliced straight out of this list's depth window, so the
  // delete set is provably the rendered tree (cycle-correct; see
  // subtreePathsFromTree).
  treeNodes: RowTreeNode[];
  // True when the row being deleted lives in the PRIMARY files schema, whose
  // removal is a real vault-file delete (deletePath). On a NON-PRIMARY MDB row
  // surface the parent's own removal is list-membership only (deleteRowInTable),
  // so descendant removal must match that authority — un-listing, not file delete
  // — to avoid destroying child .md files the parent surface never owned (5ond.8
  // review finding 4). The caller supplies a surface-matched un-lister via
  // removeFromSurface when this is false.
  isPrimarySurface: boolean;
  // Surface-matched un-lister for a descendant path on a NON-PRIMARY MDB row
  // surface (remove the descendant's row from THIS context's MDB only — never its
  // file). Required when isPrimarySurface is false; ignored otherwise.
  removeFromSurface?: (path: string) => void | Promise<void>;
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
// row). Descendant removal MATCHES the parent's surface authority (5ond.8 review
// finding 4): on the primary/path surface descendants are real vault files removed
// by deletePath; on a NON-PRIMARY MDB row surface — where deleteSelf only un-lists
// the parent (deleteRowInTable, the parent's .md file survives) — descendants are
// un-listed too (removeFromSurface), never file-deleted. This keeps the recursive
// branch from escalating to a HIGHER authority for children (destroying child .md
// files) than the surface used for the parent.
export const requestRowDeleteWithSubItems = (params: {
  superstate: Superstate;
  // Resolved path of the row being deleted (its PathPropertyName value).
  rootPath: string;
  // The FULL tree + surface authority, or undefined when sub-items is off — in
  // which case this degrades to an immediate `deleteSelf()` (silent).
  subItemsDelete?: SubItemsDeleteConfig;
  // Removes JUST the parent row (surface-specific). Children are never rewritten.
  deleteSelf: () => void | Promise<void>;
  // Optional surface adapter for the single user-facing reporting boundary.
  // When omitted, the request reports through the Superstate UI directly.
  reportError?: (message: string) => void;
  // The window the modal should open in.
  win: Window;
}): void => {
  const {
    superstate,
    rootPath,
    subItemsDelete,
    deleteSelf,
    reportError,
    win,
  } = params;

  const reportFailure = (error: unknown) => {
    const detail =
      error instanceof AggregateError
        ? `${error.errors.length} operations failed: ${error.errors
            .map((failure) =>
              failure instanceof Error ? failure.message : String(failure)
            )
            .join("; ")}`
        : error instanceof Error
        ? error.message
        : String(error);
    const message = `Could not delete "${rootPath}": ${detail}`;
    if (reportError) {
      reportError(message);
    } else {
      superstate.ui.notify(message);
    }
  };

  // Descendants are sliced from the FULL buildRowTree output (collapse-/limit-/
  // display-independent), so a parent with hidden descendants is never mistaken
  // for a leaf and silently deleted (5ond.8 review findings 1/2/3), and the set is
  // provably the rendered tree, not a re-walk that could escape into a cycle
  // partner (finding 5).
  const subtree =
    subItemsDelete && rootPath
      ? subtreePathsFromTree(
          subItemsDelete.treeNodes,
          PathPropertyName,
          rootPath
        )
      : [];

  // Leaf row (or sub-items off): keep the silent, unprompted delete.
  if (subtree.length === 0) {
    try {
      void Promise.resolve(deleteSelf()).catch(reportFailure);
    } catch (error) {
      reportFailure(error);
    }
    return;
  }

  // Descendant removal authority must match the parent surface (finding 4).
  const removeDescendant = async (path: string) => {
    if (subItemsDelete?.isPrimarySurface === false) {
      // Non-primary MDB row surface: un-list only (parent was un-listed too); the
      // descendant's .md file is never destroyed. removeFromSurface is required in
      // this branch (the wiring always supplies it); fall back to a no-op rather
      // than escalate to a file delete if it is somehow absent.
      if (subItemsDelete.removeFromSurface) {
        await subItemsDelete.removeFromSurface(path);
      }
      return;
    }
    await deletePath(superstate, path);
  };

  // Parent row: force an explicit, non-destructive-by-default choice.
  superstate.ui.openModal(
    i18n.menu.deleteRow,
    React.createElement(SubItemDeleteModal, {
      subItemCount: subtree.length,
      reportError: reportFailure,
      // (1) Default: delete only this item; children promote to roots.
      deleteOnly: deleteSelf,
      // (2) Delete this item AND every descendant.
      deleteRecursive: () => {
        return (async () => {
          // Remove the parent FIRST, then the descendants. Order matters for the
          // MDB surface: deleteSelf there is deleteRowInTable(index), and removing
          // a descendant first re-indexes the table — a stale index would then nuke
          // the WRONG row. The parent index is only valid right now, so spend it
          // before any descendant removal shifts it. For the path surface the order
          // is immaterial.
          const failures: unknown[] = [];
          try {
            await deleteSelf();
          } catch (error) {
            failures.push(error);
          }
          for (const path of subtree) {
            try {
              await removeDescendant(path);
            } catch (error) {
              failures.push(error);
            }
          }
          if (failures.length > 0) {
            throw new AggregateError(
              failures,
              "Could not delete every requested item."
            );
          }
        })();
      },
    }),
    win
  );
};
