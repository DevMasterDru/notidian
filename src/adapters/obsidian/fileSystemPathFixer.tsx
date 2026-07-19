import {
  getAbstractFileAtPath,
  renameFile,
} from "adapters/obsidian/utils/file";
import { ConfirmationModal } from "core/react/components/UI/Modals/ConfirmationModal";
import { updatePrimaryAlias } from "core/superstate/utils/label";
import MakeMDPlugin from "main";
import { TFile } from "obsidian";
import React from "react";
import { sanitizeFileName } from "shared/utils/sanitizers";

export const openPathFixer = (plugin: MakeMDPlugin) => {
  const superstate = plugin.superstate;
  const currentIssueFiles = [...plugin.obsidianAdapter.fileNameWarnings];
  const message = `The following files have issues with their names. Would you like to fix them? \n ${currentIssueFiles.join(
    "\n"
  )}`;
  superstate.ui.openModal(
    "Path Fixer",
    <ConfirmationModal
      message={message}
      confirmLabel="Rename"
      reportError={(error) => superstate.ui.notify(String(error))}
      confirmAction={async () => {
        for (const file of currentIssueFiles) {
          const currentFile = getAbstractFileAtPath(plugin.app, file);
          if (!currentFile) throw new Error(`Could not find ${file}.`);
          const currentName =
            currentFile instanceof TFile
              ? (currentFile as TFile)?.basename
              : currentFile.name;
          const aliases = plugin.superstate.pathsIndex.get(file)?.metadata
            ?.property?.aliases;
          const renamedPath = await renameFile(
            plugin,
            currentFile,
            sanitizeFileName(currentName)
          );
          if (!renamedPath) throw new Error(`Could not rename ${file}.`);
          await updatePrimaryAlias(
            plugin.superstate,
            renamedPath,
            aliases,
            currentName
          );
        }
        plugin.obsidianAdapter.fileNameWarnings = new Set();
      }}
    ></ConfirmationModal>,
    window
  );
};
