import { BaseExportPreviewModal } from "core/react/components/Bases/BaseExportPreviewModal";
import { defaultContextSchemaID } from "shared/schemas/context";
import {
  buildBaseExportPreview,
  uniqueBaseExportPathForFolder,
} from "core/utils/bases/baseExportWorkflow";
import { materializeFrontmatterBackedContextTable } from "core/utils/properties/allProperties";
import MakeMDPlugin from "main";
import { TFile, TFolder } from "obsidian";
import React from "react";
import { windowFromDocument } from "shared/utils/dom";

const folderName = (folderPath: string): string => {
  const cleaned = folderPath.replace(/\/+$/, "");
  const slash = cleaned.lastIndexOf("/");
  return slash === -1 ? cleaned : cleaned.slice(slash + 1);
};

const activeFolderPath = (plugin: MakeMDPlugin): string | null => {
  const activePath = plugin.superstate.ui.activePath;
  if (!activePath) return null;

  const activeFile = plugin.app.vault.getAbstractFileByPath(activePath);
  if (activeFile instanceof TFolder) return activeFile.path;
  if (activeFile instanceof TFile && activeFile.parent?.path !== "/") {
    return activeFile.parent.path;
  }

  return null;
};

export const openBaseExportPreview = async (plugin: MakeMDPlugin) => {
  const folderPath = activeFolderPath(plugin);
  if (!folderPath) {
    plugin.superstate.ui.notify("Open a folder or a note inside a folder before exporting a Base.");
    return;
  }

  const rawTable = await plugin.superstate.spaceManager.readTable(
    folderPath,
    defaultContextSchemaID
  );
  const paths = plugin.superstate
    .getSpaceItems(folderPath)
    .map((item) => item.path);
  const { table } = materializeFrontmatterBackedContextTable(
    rawTable,
    plugin.superstate.pathsIndex,
    paths,
    plugin.superstate.settings,
    true
  );
  const outputPath = await uniqueBaseExportPathForFolder(
    folderPath,
    (path) => plugin.files.fileExists(path)
  );
  const preview = buildBaseExportPreview({
    folderPath,
    outputPath,
    table,
    viewName: folderName(folderPath) || table.schema.name,
  });

  const win = windowFromDocument(
    plugin.app.workspace.getLeaf()?.containerEl.ownerDocument
  );
  plugin.superstate.ui.openModal(
    "Export Obsidian Base",
    <BaseExportPreviewModal
      preview={preview}
      exportAction={async () => {
        if (await plugin.files.fileExists(preview.outputPath)) {
          throw new Error(
            `${preview.outputPath} already exists. Reopen export preview to choose a new path.`
          );
        }
        await plugin.files.writeTextToFile(preview.outputPath, preview.yaml);
        plugin.superstate.ui.notify(`Exported ${preview.outputPath}`);
      }}
    />,
    win
  );
};
