import { InputModal } from "core/react/components/UI/Modals/InputModal";
import { savePathColor } from "core/superstate/utils/label";
import {
  convertPathToSpace,
  hidePath,
  hidePaths,
  renamePathByName,
} from "core/superstate/utils/path";
import {
  TreeNode,
  removePathsFromSpace,
  saveSpaceTemplate,
} from "core/superstate/utils/spaces";
import { dropPathsInSpaceAtIndex } from "core/utils/dnd/dropPath";
import {
  removePathIcon,
  saveColorForPaths,
  saveIconsForPaths,
  savePathIcon,
} from "core/utils/emoji";
import React from "react";
import StickerModal from "shared/components/StickerModal";
import { default as i18n } from "shared/i18n";
import { removeIconsForPaths } from "shared/utils/sticker";

import { deletePath, movePathToSpace } from "core/superstate/utils/path";
import {
  requestRowDeleteWithSubItems,
  SubItemsDeleteConfig,
} from "core/utils/contexts/nonDestructiveDelete";
import { isTouchScreen } from "core/utils/ui/screen";
import { SelectOption, SelectOptionType, Superstate } from "makemd-core";
import { Anchors, Rect } from "shared/types/Pos";
import { windowFromDocument } from "shared/utils/dom";
import { movePath } from "shared/utils/uri";
import { runBulkAsync } from "shared/utils/asyncContracts";
import { ConfirmationModal } from "../../Modals/ConfirmationModal";
import { defaultMenu, menuSeparator } from "../menu/SelectionMenu";
import { showColorPickerMenu } from "../properties/colorPickerMenu";
import { showSpacesMenu } from "../properties/selectSpaceMenu";
import { showSpaceContextMenu } from "./spaceContextMenu";

export const triggerMultiPathMenu = (
  superstate: Superstate,
  selectedPaths: TreeNode[],
  e: React.MouseEvent | React.TouchEvent
) => {
  const paths = selectedPaths.map((s) => s.item.path);
  const menuOptions: SelectOption[] = [];

  // Open in a New Pane
  menuOptions.push({
    name: i18n.menu.openFilePane,
    icon: "ui//go-to-file",
    onClick: (e) => {
      paths.forEach((path) => superstate.ui.openPath(path, true));
    },
  });

  if (superstate.settings.spacesStickers) {
    menuOptions.push(menuSeparator);
    // Rename Item
    menuOptions.push({
      name: i18n.menu.changeColor,
      icon: "ui//palette",
      type: SelectOptionType.Submenu,
      onSubmenu: (offset) => {
        return showColorPickerMenu(
          superstate,
          offset,
          windowFromDocument(e.view.document),
          "",
          (value) => saveColorForPaths(superstate, paths, value),
          false,
          true
        );
      },
    });

    menuOptions.push({
      name: i18n.buttons.changeIcon,
      icon: "ui//sticker",
      onClick: (e) => {
        superstate.ui.openPalette(
          <StickerModal
            ui={superstate.ui}
            selectedSticker={(emoji) =>
              saveIconsForPaths(superstate, paths, emoji)
            }
          />,
          windowFromDocument(e.view.document)
        );
      },
    });
    menuOptions.push({
      name: i18n.buttons.removeIcon,
      icon: "ui//file-minus",
      onClick: (e) => {
        removeIconsForPaths(superstate, paths);
      },
    });
  }

  menuOptions.push(menuSeparator);

  // Move Item
  menuOptions.push({
    name: i18n.menu.moveFile,
    icon: "ui//paper-plane",
    onClick: (e) => {
      // Anchor the submenu to the bound menu row (currentTarget), not the clicked
      // SVG icon child within it (Notidian-3txp). Synchronous read.
      const offset = e.currentTarget.getBoundingClientRect();
      showSpacesMenu(
        offset,
        windowFromDocument(e.view.document),
        superstate,
        (link) => {
          paths.forEach((f) => {
            movePathToSpace(superstate, f, link);
          });
        }
      );
    },
  });

  menuOptions.push({
    name: i18n.buttons.addToSpace,
    icon: "ui//pin",
    onClick: (e) => {
      // Anchor the submenu to the bound menu row (currentTarget), not the clicked
      // SVG icon child within it (Notidian-3txp). Synchronous read.
      const offset = e.currentTarget.getBoundingClientRect();
      showSpacesMenu(
        offset,
        windowFromDocument(e.view.document),
        superstate,
        (link) => {
          dropPathsInSpaceAtIndex(
            superstate,
            selectedPaths.map((f) => f.path),
            link,
            -1,
            "link"
          );
        },
        true
      );
    },
  });

  menuOptions.push(menuSeparator);

  menuOptions.push({
    name: i18n.menu.hide,
    icon: "ui//eye-off",
    onClick: (e) => {
      hidePaths(superstate, paths);
    },
  });

  // Delete Item
  menuOptions.push({
    name: i18n.menu.delete,
    icon: "ui//trash",
    onClick: (e) => {
      superstate.ui.openModal(
        i18n.labels.deleteFiles,
        <ConfirmationModal
          reportError={(error) => {
            console.error("Failed to delete selected paths:", error);
            superstate.ui.notify(error instanceof Error ? error.message : String(error));
          }}
          confirmAction={() => runBulkAsync(
            paths,
            path => deletePath(superstate, path),
          )}
          confirmLabel={i18n.buttons.delete}
          message={i18n.descriptions.deleteFiles.replace(
            "${1}",
            paths.length.toString()
          )}
        ></ConfirmationModal>,
        windowFromDocument(e.view.document)
      );
    },
  });

  // INTENTIONAL e.target (Notidian-3txp): triggerMultiPathMenu receives the
  // right-click event from a full-width tree row (handleRightClick). e.target is
  // the element under the cursor, giving native "menu where I clicked" placement;
  // e.currentTarget would be the whole row. Left as-is.
  superstate.ui.openMenu(
    (e.target as HTMLElement).getBoundingClientRect(),
    defaultMenu(superstate.ui, menuOptions),
    windowFromDocument(e.view.document)
  );

  return false;
};

export const showPathContextMenu = (
  superstate: Superstate,
  path: string,
  space: string,
  rect: Rect,
  win: Window,
  anchor?: Anchors,
  onClose?: () => void,
  // Caller-supplied options prepended to the file menu (Notidian-f0pj.1): the
  // row context menu injects "Add sub-item" here for the primary folder context,
  // whose rows short-circuit to this menu rather than the MDB row options.
  extraOptions?: SelectOption[],
  // Non-destructive parent-delete config (Notidian-5ond.8): when the primary
  // folder row routes here, its visible row set + tree resolution come along so
  // this menu's own Delete shows the 3-way prompt for a parent (vs a silent
  // recursive delete). Undefined => the legacy single-path delete.
  subItemsDelete?: SubItemsDeleteConfig
) => {
  const cache = superstate.pathsIndex.get(path);
   
  if (cache.type == 'space') {
    // A row that is itself a folder/sub-space short-circuits here; forward the
    // injected "Add sub-item" (Notidian-kg81) so it isn't dropped for such rows.
    showSpaceContextMenu(superstate, cache, rect, win, space, onClose, extraOptions)
    return
  }
  if (!cache) return;
  const menuOptions: SelectOption[] = [];

  menuOptions.push({
    name: i18n.menu.openFilePane,
    icon: "ui//go-to-file",
    onClick: (e) => {
      superstate.ui.openPath(path, true);
    },
  });
  menuOptions.push(menuSeparator);

  if (extraOptions && extraOptions.length > 0) {
    menuOptions.push(...extraOptions);
    menuOptions.push(menuSeparator);
  }

  if (superstate.settings.spacesStickers) {
    menuOptions.push(menuSeparator);
    // Rename Item
    menuOptions.push({
      name: i18n.menu.changeColor,
      icon: "ui//palette",
      type: SelectOptionType.Submenu,
      onSubmenu: (offset) => {
        return showColorPickerMenu(
          superstate,
          offset,
          win,
          "",
          (value) => savePathColor(superstate, path, value),
          false,
          true
        );
      },
    });

    menuOptions.push({
      name: i18n.buttons.changeIcon,
      icon: "ui//sticker",
      onClick: (e) => {
        superstate.ui.openPalette(
          <StickerModal
            ui={superstate.ui}
            selectedSticker={(emoji) => savePathIcon(superstate, path, emoji)}
          />,
          windowFromDocument(e.view.document)
        );
      },
    });
    menuOptions.push({
      name: i18n.buttons.removeIcon,
      icon: "ui//file-minus",
      onClick: (e) => {
        removePathIcon(superstate, path);
      },
    });
  }
  

  menuOptions.push(menuSeparator);

  if (cache.type == "file" && cache.subtype == "md")
    menuOptions.push({
      name: i18n.menu.changeToFolderNote,
      icon: "ui//file-plus-2",
      onClick: (e) => {
        convertPathToSpace(superstate, path, false);
      },
    });

  menuOptions.push({
    name: i18n.menu.rename,
    icon: "ui//edit",
    onClick: (e) => {
      superstate.ui.openModal(
        i18n.labels.rename,
        <InputModal
          saveLabel={i18n.buttons.rename}
          value={cache.name}
          saveValue={(v) => renamePathByName(superstate, path, v)}
        ></InputModal>,
        windowFromDocument(e.view.document)
      );
    },
  });

  menuOptions.push({
    name: i18n.buttons.addToSpace,
    icon: "ui//pin",
    onClick: (e) => {
      // Anchor the submenu to the bound menu row (currentTarget), not the clicked
      // SVG icon child within it (Notidian-3txp). Synchronous read.
      const offset = e.currentTarget.getBoundingClientRect();
      showSpacesMenu(
        offset,
        windowFromDocument(e.view.document),
        superstate,
        (link) => {
          dropPathsInSpaceAtIndex(superstate, [path], link, -1, "link");
        },
        true
      );
    },
  });

  menuOptions.push({
    name: i18n.menu.moveFile,
    icon: "ui//paper-plane",
    onClick: (e) => {
      // Anchor the submenu to the bound menu row (currentTarget), not the clicked
      // SVG icon child within it (Notidian-3txp). Synchronous read.
      const offset = e.currentTarget.getBoundingClientRect();
      showSpacesMenu(
        offset,
        windowFromDocument(e.view.document),
        superstate,
        (link) => {
          void superstate.spaceManager
            .renamePath(path, movePath(path, link))
            .then((renamed) => {
              if (!renamed) throw new Error("Could not move the file.");
            })
            .catch((error) => {
              superstate.ui.notify(
                error instanceof Error ? error.message : String(error)
              );
            });
        }
      );
    },
  });

  menuOptions.push({
    name: i18n.menu.duplicate,
    icon: "ui//documents",
    onClick: (e) => {
      superstate.spaceManager.copyPath(
        path,
        `${cache.parent}`,
        `${cache.name}`
      );
    },
  });

  menuOptions.push({
    name: i18n.buttons.saveTemplate,
    icon: "ui//clipboard-add",
    onClick: (e) => {
      saveSpaceTemplate(superstate, path, space);
    },
  });
  if (superstate.ui.hasNativePathMenu(path)) {
    menuOptions.push({
      name: i18n.menu.openNativeMenu,
      icon: "ui//options",
      onClick: (e) => {
        superstate.ui.nativePathMenu(e, path);
      },
    });
  }

  // Move Item

  menuOptions.push(menuSeparator);
  if (!isTouchScreen(superstate.ui)) {
    menuOptions.push({
      name:
        superstate.ui.getOS() == "mac"
          ? i18n.menu.revealInDefault
          : i18n.menu.revealInExplorer,
      icon: "ui//arrow-up-right",
      onClick: (e) => {
        superstate.ui.openPath(path, "system");
      },
    });
    menuOptions.push(menuSeparator);
  }

  
  if (onClose) {
    menuOptions.push({
      name: i18n.menu.closeSpace,
      icon: "ui//close",
      onClick: (e) => {
        onClose();
      },
    });
    
  }

  if (space && space != cache.parent) {
    const spaceCache = superstate.spacesIndex.get(space);
    if (spaceCache) {
      menuOptions.push({
        name: i18n.menu.removeFromSpace.replace("${1}", spaceCache.name),
        icon: "ui//pin-off",
        onClick: (e) => {
          removePathsFromSpace(superstate, spaceCache.path, [path]);
        },
      });
    }
  }


  menuOptions.push({
    name: i18n.menu.hide,
    icon: "ui//eye-off",
    onClick: (e) => {
      hidePath(superstate, path);
    },
  });

  menuOptions.push({
    name: i18n.menu.delete,
    icon: "ui//trash",
    onClick: (e) => {
      // Non-destructive parent-delete (Notidian-5ond.8): a leaf path deletes
      // silently (legacy); a path with visible sub-items opens the 3-way prompt
      // instead of a silent recursive delete. subItemsDelete is undefined for the
      // ordinary navigator file menu, so this stays a plain delete there.
      requestRowDeleteWithSubItems({
        superstate,
        rootPath: path,
        subItemsDelete,
        // Keep the lower operation raw: requestRowDeleteWithSubItems owns both
        // leaf and parent reporting, including recursive aggregation.
        deleteSelf: () => deletePath(superstate, path),
        reportError: (message) => superstate.ui.notify(message),
        win:
          e?.view?.document != null
            ? windowFromDocument(e.view.document)
            : win,
      });
    },
  });

  superstate.ui.openMenu(
    rect,
    defaultMenu(superstate.ui, menuOptions),
    win,
    anchor
  );

  return false;
};
