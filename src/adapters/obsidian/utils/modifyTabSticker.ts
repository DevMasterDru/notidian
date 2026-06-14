import { SpaceViewContainer } from "adapters/obsidian/SpaceViewContainer";
import MakeMDPlugin from "main";
import { MarkdownView } from "obsidian";
import { parseStickerString } from "shared/utils/stickers";
import { stickerFromString } from "../ui/sticker";

// Notidian-ebz: build the <img> via DOM so a sticker image path containing a
// quote can't break out of the src attribute — raw `<img src="${path}">` template
// interpolation (path is derived from the vault sticker label) was injectable.
const setTabImageSticker = (el: HTMLElement, path: string) => {
  el.innerHTML = "";
  const img = document.createElement("img");
  img.src = path;
  el.appendChild(img);
};

export const modifyTabSticker = (plugin: MakeMDPlugin) => {
  if (!plugin.superstate.settings.spacesStickers) return;
  let leaf = plugin.app.workspace.getActiveViewOfType(MarkdownView)?.leaf;
  if (leaf) {
    const file = plugin.app.workspace.getActiveFile();
    if (!file) return;
    const pathCache = plugin.superstate.pathsIndex.get(file.path);
    if (pathCache?.label.sticker && leaf.tabHeaderInnerIconEl) {
      const [stickerType, stickerPath] = parseStickerString(pathCache.label.sticker);
      if (stickerType == "image") {
        const path = plugin.superstate.ui.getUIPath(plugin.superstate.imagesCache.get(stickerPath));
        if (path) setTabImageSticker(leaf.tabHeaderInnerIconEl, path);
      } else {
        const icon = stickerFromString(pathCache.label.sticker, plugin);
        leaf.tabHeaderInnerIconEl.innerHTML = icon;
      }
      
    }
    return;
  } else {
    leaf = plugin.app.workspace.getActiveViewOfType(SpaceViewContainer)?.leaf;
    if (leaf) {
      const spacePath = leaf.view.getState().path as string;

      const fileCache = plugin.superstate.pathsIndex.get(spacePath);
      if (fileCache?.label?.sticker && leaf.tabHeaderInnerIconEl) {
        const [stickerType, stickerPath] = parseStickerString(fileCache.label.sticker);
      if (stickerType == "image") {
        const path = plugin.superstate.ui.getUIPath(plugin.superstate.imagesCache.get(stickerPath));
        if (!path)
         return path;
        setTabImageSticker(leaf.tabHeaderInnerIconEl, path);
      } else {
        const icon = stickerFromString(fileCache.label.sticker, plugin);
        leaf.tabHeaderInnerIconEl.innerHTML = icon;
      }
        
      }
      return;
    }
  }


};
