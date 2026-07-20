import { ConfirmationModal } from "core/react/components/UI/Modals/ConfirmationModal";
import { retrieveAllRecursiveChildren } from "core/spaceManager/filesystemAdapter/spaces";
import MakeMDPlugin from "main";
import i18n from "shared/i18n";
import React from "react";
import { runBulkAsync } from "shared/utils/asyncContracts";
import { windowFromDocument } from "shared/utils/dom";

export const deleteSpaceFiles = async (plugin: MakeMDPlugin, doc: Document) => {
  plugin.superstate.ui.openModal(
    "Delete Space Files",

    <ConfirmationModal
      reportError={(error) => plugin.superstate.ui.notify(String(error))}
      confirmAction={async () => {
        const settings = plugin.superstate.settings;
        const spaceSubFolder = settings.spaceSubFolder;

        const allChildren = retrieveAllRecursiveChildren(
          plugin.obsidianAdapter.vaultDBCache,
          settings,
          settings.spacesFolder
        );
        await runBulkAsync(
          allChildren.filter(
            (f) => f.name == spaceSubFolder && f.folder == "true"
          ),
          (file) => plugin.superstate.spaceManager.deletePath(file.path)
        );
        plugin.superstate.ui.notify("All space files have been deleted.");
      }}
      confirmLabel={i18n.buttons.delete}
      message={
        "Are you sure you want to delete all space files? Warning: if you have a custom space folder name, all folders with that name will be deleted."
      }
    ></ConfirmationModal>,
    windowFromDocument(doc)
  );
};
