import { NotidianEmbedPickerModal } from "core/react/components/NotidianEmbed/NotidianEmbedPickerModal";
import {
  serializeNotidianEmbedBlock,
} from "core/utils/embeds/notidianEmbed";
import type { NotidianEmbedDescriptor } from "core/utils/embeds/notidianEmbed";
import {
  buildNotidianWrapperNote,
  insertNotidianCanvasFileNode,
  wrapperPathForNotidianEmbed,
} from "core/utils/embeds/notidianCanvasEmbed";
import type MakeMDPlugin from "main";
import type { Editor } from "obsidian";
import React from "react";
import i18n from "shared/i18n";
import { safelyParseJSON } from "shared/utils/json";
import { windowFromDocument } from "shared/utils/dom";

export const defaultDescriptorForTarget = (
  target: string
): NotidianEmbedDescriptor => ({
  target,
  kind: "view",
  id: "filesView",
  title: true,
  editable: false,
});

export const insertTextIntoEditorSelection = (editor: Editor, text: string) => {
  editor.replaceRange(text, editor.getCursor());
};

const normalizeEmbedVaultPath = (path: string): string =>
  path
    .replace(/\\/gu, "/")
    .replace(/\/+/gu, "/")
    .replace(/^\/+|\/+$/gu, "");

const createNotidianCanvasNodeId = (): string => {
  const cryptoApi = globalThis.crypto;
  if (cryptoApi?.randomUUID) {
    return cryptoApi.randomUUID().replace(/-/gu, "");
  }
  return `notidianembed${Date.now().toString(36)}${Math.random()
    .toString(36)
    .slice(2, 10)}`;
};

const ensureVaultFolder = async (plugin: MakeMDPlugin, folderPath: string) => {
  const parts = normalizeEmbedVaultPath(folderPath).split("/").filter(Boolean);
  let current = "";
  for (const part of parts) {
    current = current ? `${current}/${part}` : part;
    if (!plugin.app.vault.getAbstractFileByPath(current)) {
      await plugin.app.vault.createFolder(current);
    }
  }
};

export const insertDescriptorIntoActiveMarkdown = (
  plugin: MakeMDPlugin,
  descriptor: NotidianEmbedDescriptor
) => {
  const activeView = (plugin.app.workspace as any).activeLeaf?.view;
  const editor = activeView?.editor as Editor | undefined;
  if (!editor) {
    plugin.superstate.ui.notify(
      "Open a Markdown editor before inserting a Notidian embed."
    );
    return false;
  }

  insertTextIntoEditorSelection(
    editor,
    `${serializeNotidianEmbedBlock(descriptor)}\n`
  );
  return true;
};

export const copyDescriptorToClipboard = async (
  descriptor: NotidianEmbedDescriptor
) => navigator.clipboard.writeText(serializeNotidianEmbedBlock(descriptor));

export const openNotidianEmbedPicker = (
  plugin: MakeMDPlugin,
  onChoose: (descriptor: NotidianEmbedDescriptor) => unknown | Promise<unknown>,
  saveLabel: string
) => {
  const menu = plugin.superstate.ui.openModal(
    "Notidian Embed",
    <NotidianEmbedPickerModal
      superstate={plugin.superstate}
      saveLabel={saveLabel}
      onChoose={(descriptor) => {
        Promise.resolve(onChoose(descriptor)).finally(() => menu?.hide());
      }}
    />,
    windowFromDocument(plugin.app.workspace.getLeaf()?.containerEl.ownerDocument)
  );
};

export const insertDescriptorIntoActiveCanvas = async (
  plugin: MakeMDPlugin,
  descriptor: NotidianEmbedDescriptor
) => {
  const file = plugin.app.workspace.getActiveFile();
  if (!file || file.extension != "canvas") {
    plugin.superstate.ui.notify(
      "Open a Canvas file before inserting a Notidian embed."
    );
    return false;
  }

  const wrapperPath = normalizeEmbedVaultPath(
    wrapperPathForNotidianEmbed(descriptor)
  );
  const wrapperContent = buildNotidianWrapperNote(descriptor);
  const wrapperParentPath = wrapperPath.slice(0, wrapperPath.lastIndexOf("/"));
  if (wrapperParentPath) {
    await ensureVaultFolder(plugin, wrapperParentPath);
  }

  const existingWrapper = plugin.app.vault.getAbstractFileByPath(
    wrapperPath
  ) as any;
  if (existingWrapper?.extension == "md") {
    await plugin.app.vault.modify(existingWrapper, wrapperContent);
  } else {
    await plugin.app.vault.create(wrapperPath, wrapperContent);
  }

  const canvasText = await plugin.app.vault.read(file);
  const parsedCanvas = safelyParseJSON(canvasText);
  const { canvas } = insertNotidianCanvasFileNode(
    parsedCanvas && typeof parsedCanvas == "object" ? parsedCanvas : {},
    {
      file: wrapperPath,
      idFactory: createNotidianCanvasNodeId,
    }
  );
  await plugin.app.vault.modify(file, JSON.stringify(canvas, null, 2));
  return true;
};

export const registerNotidianEmbedCommands = (plugin: MakeMDPlugin) => {
  plugin.addCommand({
    id: "notidian-insert-database-embed",
    name: i18n.commandPalette.insertNotidianDatabaseEmbed,
    callback: () =>
      openNotidianEmbedPicker(
        plugin,
        (descriptor) => insertDescriptorIntoActiveMarkdown(plugin, descriptor),
        i18n.buttons.insert
      ),
  });

  plugin.addCommand({
    id: "notidian-copy-database-embed",
    name: i18n.commandPalette.copyNotidianDatabaseEmbed,
    callback: () =>
      openNotidianEmbedPicker(
        plugin,
        (descriptor) => copyDescriptorToClipboard(descriptor),
        i18n.buttons.copy
      ),
  });

  plugin.addCommand({
    id: "notidian-insert-database-embed-into-canvas",
    name: i18n.commandPalette.insertNotidianDatabaseEmbedIntoCanvas,
    callback: () =>
      openNotidianEmbedPicker(
        plugin,
        (descriptor) => insertDescriptorIntoActiveCanvas(plugin, descriptor),
        i18n.buttons.insert
      ),
  });
};
