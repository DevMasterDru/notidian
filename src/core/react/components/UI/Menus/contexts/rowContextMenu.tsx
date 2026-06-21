import { deleteRowInTable } from "core/utils/contexts/context";
import { createSubItemRow } from "core/utils/contexts/subItemCreate";
import {
  requestRowDeleteWithSubItems,
  SubItemsDeleteConfig,
} from "core/utils/contexts/nonDestructiveDelete";
import { SelectOption, Superstate } from "makemd-core";
import i18n from "shared/i18n";
import React from "react";
import { PathPropertyName } from "shared/types/context";
import { Rect } from "shared/types/Pos";
import { windowFromDocument } from "shared/utils/dom";
import { defaultMenu } from "../menu/SelectionMenu";
import { showPathContextMenu } from "../navigator/pathContextMenu";

import { EditPropertiesSubmenu } from "./EditPropertyMenu";
import { openContextCreateItemModal } from "../../Modals/ContextCreateItemModal";

export const showRowContextMenu = async (
  e: React.MouseEvent | React.TouchEvent,
  superstate: Superstate,
  contextPath: string,
  schema: string,
  index: number,
  // Pre-captured anchor from the caller's TRUE synchronous boundary. Some
  // callers (api.table.contextMenu) are themselves async and await BEFORE
  // reaching this function, so by the time we run, e.currentTarget is already
  // null and reading it here would silently fall back to the clicked SVG child
  // (the very e.target anti-pattern this fixes — Notidian-74n). Those callers
  // capture the rect/window from e.currentTarget before their own await and pass
  // them in here. Synchronous callers (the direct TableView onContextMenu
  // handler) omit them and we capture from e.currentTarget below.
  anchorRectArg?: Rect,
  anchorWindowArg?: Window,
  // Sub-items (ADR 0024, Notidian-f0pj.1): the frontmatter key of the configured
  // parent-link column (= subItemsCol.name), or undefined when sub-items is off.
  // When set, an "Add sub-item" action is offered that creates a child row and
  // writes ONLY the child's parent link (one-way, B1) — the parent is untouched.
  subItemsField?: string,
  // Non-destructive parent-delete (Notidian-5ond.8): the visible row set + tree
  // resolution so deleting a row WITH sub-items opens the 3-way prompt instead of
  // a silent recursive delete. Undefined => leaf-style silent delete (legacy).
  subItemsDelete?: SubItemsDeleteConfig
) => {
  e.preventDefault();

  // Capture the anchor rect and owning window SYNCHRONOUSLY, before the first
  // await below. After an await, React has returned from the handler and
  // e.currentTarget is null; reading it then would throw. We anchor to the bound
  // row (currentTarget) — not whichever child the click landed on — so the menu
  // stays anchored to the row regardless of where inside it the pointer hit
  // (Notidian-74n). e.currentTarget is the element the handler is bound to (the
  // row); e.target was the clicked descendant.
  //
  // For ASYNC callers that already awaited upstream, e.currentTarget is null at
  // this point, so we cannot recover the row rect here at all — those callers
  // MUST pass anchorRectArg/anchorWindowArg captured at their own synchronous
  // boundary. We prefer those when present; otherwise (synchronous callers) we
  // capture from e.currentTarget, with e.target only as a last-ditch fallback.
  let anchorRect: Rect;
  if (anchorRectArg) {
    anchorRect = anchorRectArg;
  } else {
    const anchorEl = (e.currentTarget ?? e.target) as HTMLElement;
    anchorRect = anchorEl.getBoundingClientRect();
  }
  const anchorWindow =
    anchorWindowArg ??
    windowFromDocument(
      e.view?.document ??
        ((e.currentTarget ?? e.target) as HTMLElement).ownerDocument
    );

  // Validate index is a valid number
  if (isNaN(index) || index < 0) {
    console.warn("showRowContextMenu: Invalid index", index);
    return;
  }

  const context = await superstate.spaceManager.readTable(contextPath, schema);
  const dbSchema = context?.schema;
  const rows = context?.rows;
  if (!context || !rows) return;

  // Validate row exists at index
  if (index >= rows.length) {
    console.warn("showRowContextMenu: Index out of bounds", index, "rows:", rows.length);
    return;
  }

  // Sub-items (ADR 0024 B1/C2): a single "Add sub-item" action, shared by the
  // primary folder menu (below) and the MDB row menu. It re-reads the table for
  // a fresh parent row, creates a child in the same space (mirroring newRow),
  // and writes ONLY the child's parent link — the parent's file is never touched.
  const subItemOption: SelectOption | null = subItemsField
    ? {
        name: i18n.menu.addSubItem,
        icon: "ui//plus",
        // Delegates to the single shared one-way create path (ADR 0050) — the
        // same helper the inline "+" affordance calls.
        onClick: async () => {
          await createSubItemRow({
            superstate,
            contextPath,
            schema,
            index,
            subItemsField,
          });
        },
      }
    : null;

  if (dbSchema.primary == "true") {
    const row = rows[index];
    if (row) {

      showPathContextMenu(
        superstate,
        row[PathPropertyName],
        contextPath,
        anchorRect,
        anchorWindow,
        undefined,
        undefined,
        // Folder-context rows short-circuit here, so the sub-item action must be
        // injected into the path menu rather than the MDB options below.
        subItemOption ? [subItemOption] : undefined,
        // ...and the non-destructive-delete config (Notidian-5ond.8) so the path
        // menu's own Delete prompts the 3-way modal for a parent row too.
        subItemsDelete
      );
      return;
    }
  }
  const menuOptions: SelectOption[] = [];
  const propertiesProps = {
    superstate,
    pathState: superstate.pathsIndex.get(contextPath),
    path: contextPath,
    schema,
    index,
  };
  menuOptions.push({
    name: i18n.menu.editProperties,
    icon: "ui//list",
    onClick: async (e) => {
      // Re-read the table to get fresh data when action is executed
      const freshContext = await superstate.spaceManager.readTable(contextPath, schema);
      const freshRows = freshContext?.rows;

      // Validate row still exists
      if (!freshRows || index >= freshRows.length) {
        console.warn("Edit: Row no longer exists at index", index);
        return;
      }

      const rowData = freshRows[index];

      // Open the modal in edit mode with the row data
      openContextCreateItemModal(
        superstate,
        contextPath,
        schema,
        undefined, // frameSchema
        windowFromDocument(e.view?.document ?? (e.target as HTMLElement).ownerDocument),
        index, // Pass the actual row index (>= 0 for edit mode)
        rowData // Pass the initial data
      );
    },
  });
  menuOptions.push({
    name: i18n.menu.deleteRow,
    icon: "ui//trash",
    onClick: async (e) => {
      // Re-read the table to verify row exists before deleting
      const freshContext = await superstate.spaceManager.readTable(contextPath, schema);
      const freshRows = freshContext?.rows;

      // Validate row still exists
      if (!freshRows || index >= freshRows.length) {
        console.warn("Delete: Row no longer exists at index", index);
        return;
      }

      // Use spaceInfoForPath instead of spacesIndex lookup to properly handle folder notes
      const spaceInfo = superstate.spaceManager.spaceInfoForPath(contextPath);
      // Surface-specific removal of JUST this row (children are never rewritten).
      const deleteSelf = () =>
        deleteRowInTable(superstate.spaceManager, spaceInfo, schema, index);
      // Non-destructive parent-delete (Notidian-5ond.8): a leaf row deletes
      // silently; a row WITH visible sub-items opens the 3-way prompt instead of
      // the old silent recursive delete. The descendant resolution uses the same
      // ancestry the rendered tree does.
      requestRowDeleteWithSubItems({
        superstate,
        rootPath: String(freshRows[index]?.[PathPropertyName] ?? ""),
        subItemsDelete,
        deleteSelf,
        // Open the modal in the same window the menu lives in. The synchronous
        // caller's anchorWindow is always valid; the event-derived window is a
        // best-effort refinement when this onClick fires with a live event.
        win: e?.view?.document
          ? windowFromDocument(e.view.document)
          : anchorWindow,
      });
    },
  });
  if (subItemOption) {
    menuOptions.push(subItemOption);
  }
  superstate.ui.openMenu(
    anchorRect,
    defaultMenu(superstate.ui, menuOptions),
    anchorWindow
  );
};
