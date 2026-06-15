import { deleteRowInTable } from "core/utils/contexts/context";
import { SelectOption, Superstate } from "makemd-core";
import i18n from "shared/i18n";
import React from "react";
import { PathPropertyName } from "shared/types/context";
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
  index: number
) => {
  e.preventDefault();

  // Capture the anchor rect and owning window SYNCHRONOUSLY, before the first
  // await below. After an await, React has returned from the handler and
  // e.currentTarget is null; reading it then would throw. We anchor to the bound
  // row (currentTarget) — not whichever child the click landed on — so the menu
  // stays anchored to the row regardless of where inside it the pointer hit
  // (Notidian-74n). e.currentTarget is the element the handler is bound to (the
  // row); e.target was the clicked descendant. We fall back to e.target only if
  // currentTarget is somehow unavailable.
  const anchorEl = (e.currentTarget ?? e.target) as HTMLElement;
  const anchorRect = anchorEl.getBoundingClientRect();
  const anchorWindow = windowFromDocument(
    e.view?.document ?? anchorEl.ownerDocument
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

  if (dbSchema.primary == "true") {
    const row = rows[index];
    if (row) {

      showPathContextMenu(
        superstate,
        row[PathPropertyName],
        contextPath,
        anchorRect,
        anchorWindow
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
      await deleteRowInTable(
        superstate.spaceManager,
        spaceInfo,
        schema,
        index
      );
    },
  });
  superstate.ui.openMenu(
    anchorRect,
    defaultMenu(superstate.ui, menuOptions),
    anchorWindow
  );
};
