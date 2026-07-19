import { ConfirmationModal } from "core/react/components/UI/Modals/ConfirmationModal";
import { retrieveAllRecursiveChildren } from "core/spaceManager/filesystemAdapter/spaces";
import MakeMDPlugin from "main";
import i18n from "shared/i18n";
import React from "react";
import { FilesystemSpaceInfo } from "shared/types/spaceInfo";
import { runBulkAsync } from "shared/utils/asyncContracts";
import { windowFromDocument } from "shared/utils/dom";

export const moveSpaceFiles = async (
  plugin: MakeMDPlugin,
  oldString: string,
  newString: string
) => {
  const allChildren = plugin.superstate.allSpaces();
  plugin.superstate.settings.spaceSubFolder = newString;
  plugin.superstate.saveSettings();
  for (const f of allChildren) {
    if (
      await plugin.superstate.spaceManager.pathExists(
        (f.space as FilesystemSpaceInfo)?.folderPath + "/" + oldString
      )
    ) {
      const renamed = await plugin.superstate.spaceManager.renamePath(
        (f.space as FilesystemSpaceInfo)?.folderPath + "/" + oldString,
        (f.space as FilesystemSpaceInfo)?.folderPath + "/" + newString
      );
      if (!renamed) return;
    }
  }
  if (await plugin.superstate.spaceManager.pathExists(oldString)) {
    const renamed = await plugin.superstate.spaceManager.renamePath(
      oldString,
      newString
    );
    if (!renamed) return;
  }
  await plugin.superstate.initializeSpaces();
  plugin.superstate.ui.notify("All space files have been move.");
};

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
