import React, { useEffect } from "react";
import i18n from "shared/i18n";

// Non-destructive parent-delete prompt (Notidian-5ond.8, ADR 0050). Shown ONLY
// when deleting a row that has visible sub-items — leaf rows keep their silent
// delete and never reach this modal. It removes the silent-recursive-delete
// data-loss footgun by making the user choose between three explicit outcomes:
//
//   (1) Delete this item only / promote children  [DEFAULT — autofocused]
//       Deletes just the parent row. NO child rewrite: the children's parent
//       link now points at a missing row, so buildRowTree surfaces them as roots
//       on the next render — promotion is automatic, the children's files are
//       never touched (one-way invariant, ADR 0050).
//   (2) Delete this item and all N sub-items       [destructive, counted]
//       Removes the parent AND every descendant (subtreePathsFromTree over the
//       FULL buildRowTree output), matching the parent surface's authority —
//       file-delete on the primary files schema, un-list on a non-primary MDB row.
//   (3) Cancel — a no-op.
//
// The component is pure UI: the two actions are supplied by the caller, and the
// modal framework injects `hide` (see adapters/obsidian/ui/modal.tsx). Enter
// confirms the DEFAULT (promote) action — the safe, non-destructive choice.
export const SubItemDeleteModal = (props: {
  hide?: () => void;
  // (1) Delete only this row; children promote to roots (no rewrite). Default.
  deleteOnly: () => void;
  // (2) Delete this row and its entire visible subtree.
  deleteRecursive: () => void;
  // Number of descendant rows the recursive option will remove (for the count).
  subItemCount: number;
}) => {
  const { hide, deleteOnly, deleteRecursive, subItemCount } = props;
  const runDeleteOnly = () => {
    deleteOnly();
    hide && hide();
  };
  const runDeleteRecursive = () => {
    deleteRecursive();
    hide && hide();
  };
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Enter") {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        // Enter = the safe, non-destructive default (promote children).
        runDeleteOnly();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, []);
  return (
    <div className="mk-modal-contents mk-subitem-delete-modal">
      <div className="mk-modal-message">
        {i18n.descriptions.deleteRowWithSubItems.replace(
          "${1}",
          subItemCount.toString()
        )}
      </div>
      <div className="mk-button-group">
        <button onClick={() => runDeleteOnly()} tabIndex={0} autoFocus>
          {i18n.buttons.deletePromoteChildren}
        </button>
        <button
          onClick={() => runDeleteRecursive()}
          tabIndex={0}
          className="mod-warning"
        >
          {i18n.buttons.deleteWithSubItems.replace(
            "${1}",
            subItemCount.toString()
          )}
        </button>
        <button onClick={() => hide && hide()} tabIndex={0}>
          {i18n.buttons.cancel}
        </button>
      </div>
    </div>
  );
};
