import { openPathFixer } from "adapters/obsidian/fileSystemPathFixer";
import { registerNotidianEmbedCommands } from "adapters/obsidian/utils/notidianEmbedCommands";
import { FILE_CONTEXT_VIEW_TYPE } from "adapters/obsidian/ui/explorer/ContextExplorerLeafView";
import { showWarningsModal } from "core/react/components/Navigator/SyncWarnings";
import {
  defaultAddAction,
  newSpaceModal,
} from "core/react/components/UI/Menus/navigator/showSpaceAddMenu";
import { HiddenPaths } from "core/react/components/UI/Modals/HiddenFiles";
import { openTypeProfileAdoptionModalForActivePath } from "core/react/components/UI/Modals/typeProfileAdoptionAction";
import { addPathToSpaceAtIndex } from "core/superstate/utils/spaces";
import {
  blessFrameById,
  dispatchFrameTrust,
  pendingBlessFrameIds,
} from "core/utils/frames/frameTrustSession";
import { defaultMenu } from "core/react/components/UI/Menus/menu/SelectionMenu";
import { eventTypes } from "core/types/types";
import { isPhone } from "core/utils/ui/screen";
import MakeMDPlugin from "main";
import i18n from "shared/i18n";
import React from "react";
import { BlinkMode } from "shared/types/blink";
import { windowFromDocument } from "shared/utils/dom";

export const attachCommands = (plugin: MakeMDPlugin) => {
  if (!isPhone(plugin.superstate.ui))
    plugin.addCommand({
      id: "open-ever-view",
      name: i18n.buttons.openOverview,
      callback: () => {
        plugin.openEverView();
      },
    });
  plugin.addCommand({
    id: "open-hidden",
    name: i18n.labels.manageHiddenFiles,
    callback: () => {
      plugin.superstate.ui.openModal(
        i18n.labels.hiddenFiles,
        <HiddenPaths superstate={plugin.superstate}></HiddenPaths>,
        windowFromDocument(
          plugin.app.workspace.getLeaf()?.containerEl.ownerDocument
        )
      );
    },
  });
  plugin.addCommand({
    id: "new-note",
    name: i18n.buttons.newNote,
    callback: () => {
      defaultAddAction(plugin.superstate, null, window, false);
    },
  });
  plugin.addCommand({
    id: "show-warnings",
    name: i18n.menu.showWarnings,
    callback: () => {
      showWarningsModal(plugin.superstate, window);
    },
  });
  plugin.addCommand({
    id: "logs",
    name: i18n.commandPalette.toggleEnhancedLogs,
    callback: () => {
      plugin.superstate.settings.enhancedLogs =
        !plugin.superstate.settings.enhancedLogs;
      plugin.saveSettings();
    },
  });
  // bd Notidian-214 / ADR 0022 Decision 2c — user-initiated, session-scoped bless.
  // Trusts (in memory only) a frame the hardening boundary flagged as having $api
  // withheld this session, restoring its dynamic expressions until reload/edit.
  // Nothing is persisted — re-run after reload by design.
  //
  // The consent surface is PER FRAME, never blanket: with one flagged frame it
  // blesses that named frame; with several it opens a picker so the user trusts
  // exactly the frame they chose. This closes the confused-deputy hole where a
  // single gesture would grant session-$api to every flagged frame (including an
  // AI-planted one the user never reviewed), which ADR 0022 explicitly rules out.
  plugin.addCommand({
    id: "notidian-trust-frame-session",
    name: i18n.commandPalette.trustFrameForSession,
    callback: () => {
      const ui = plugin.superstate.ui;
      const blessOne = (frameId: string) => {
        const n = blessFrameById(frameId);
        ui.notify(
          n > 0
            ? `Trusted the frame "${frameId}" for this session (${n} instance${
                n === 1 ? "" : "s"
              }). Reload or edit drops this trust.`
            : `The frame "${frameId}" is no longer active — nothing was trusted.`
        );
      };
      dispatchFrameTrust(pendingBlessFrameIds(), {
        onEmpty: () =>
          ui.notify(
            "No frames are currently waiting to be trusted. Open a frame whose dynamic content was disabled, then run this command."
          ),
        onSingle: blessOne,
        onMultiple: (frameIds) => {
          // Several frames flagged: NEVER auto-bless all of them. Present a picker
          // naming each so the user trusts exactly one reviewed frame.
          const container = plugin.app.workspace.getLeaf()?.containerEl;
          const win = windowFromDocument(container?.ownerDocument ?? document);
          const rect = container?.getBoundingClientRect() ?? {
            x: 100,
            y: 100,
            width: 0,
            height: 0,
          };
          const options = frameIds.map((frameId) => ({
            name: frameId,
            icon: "ui//shield-check",
            onClick: () => blessOne(frameId),
          }));
          ui.openMenu(rect, defaultMenu(ui, options), win, "top");
        },
      });
    },
  });
  plugin.addCommand({
    id: "notidian-adopt-schema",
    name: "Adopt schema for this database",
    callback: () => {
      openTypeProfileAdoptionModalForActivePath(
        plugin.superstate,
        plugin.superstate.ui.activePath,
        windowFromDocument(
          plugin.app.workspace.getLeaf()?.containerEl.ownerDocument
        )
      );
    },
  });
  plugin.addCommand({
    id: "path-fixer",
    name: i18n.commandPalette.fixPathCharacters,
    callback: () => {
      openPathFixer(plugin);
    },
  });
  registerNotidianEmbedCommands(plugin);
  // The move-space-folder command was removed to lock runtime storage to
  // `.notidian` (ADR 0017/0018; bd Notidian-409). spaceSubFolder is normalized
  // to the plugin storage root on load (main.ts), so allowing it to be relocated
  // off `.notidian` was governance debt with no Notidian-only use case.
  if (plugin.superstate.settings.spacesEnabled) {
    plugin.addCommand({
      id: "mk-new-space",
      name: i18n.buttons.createFolder,
      callback: () => {
        newSpaceModal(plugin.superstate);
      },
    });

    plugin.addCommand({
      id: "mk-debug-close-tabs",
      name: i18n.commandPalette.closeExtraFileTabs,
      callback: () => {
        plugin.closeExtraFileTabs();
      },
    });

    plugin.addCommand({
      id: "mk-expand-folders",
      name: i18n.menu.expandAllSections,
      callback: () => {
        const spaces =
          plugin.superstate.focuses[plugin.superstate.settings.currentWaypoint]
            .paths;
        const newSections = spaces;
        plugin.superstate.settings.expandedSpaces = newSections;
        plugin.superstate.saveSettings();
      },
    });

    plugin.addCommand({
      id: "mk-collapse-folders",
      name: i18n.menu.collapseAllFolders,
      callback: () => {
        plugin.superstate.settings.expandedSpaces = [];
        plugin.saveSettings();
      },
    });
    plugin.addCommand({
      id: "mk-release-notes",
      name: i18n.commandPalette.releaseNotes,
      callback: () => {
        plugin.releaseTheNotes();
      },
    });
    plugin.addCommand({
      id: "mk-get-started",
      name: i18n.commandPalette.getStarted,
      callback: () => {
        plugin.getStarted();
      },
    });
    plugin.addCommand({
      id: "mk-reveal-file",
      name: i18n.commandPalette.revealFile,
      callback: () => {
        const file = plugin.superstate.ui.activePath;
        if (!file) return;
        const evt = new CustomEvent(eventTypes.revealPath, {
          detail: { path: file },
        });
        window.dispatchEvent(evt);
      },
    });

    plugin.addCommand({
      id: "mk-pin-active",
      name: i18n.commandPalette.pinActiveFileToSpace,
      callback: () => {
        const file = plugin.superstate.ui.activePath;
        if (!file) return;
        const pathState = plugin.superstate.pathsIndex.get(file);
        if (!pathState) return;
        plugin.quickOpen(plugin.superstate, BlinkMode.OpenSpaces, (space) => {
          const spaceCache = plugin.superstate.spacesIndex.get(space);
          if (spaceCache)
            addPathToSpaceAtIndex(plugin.superstate, spaceCache, file, -1);
        });
      },
    });

    plugin.addCommand({
      id: "mk-spaces",
      name: i18n.commandPalette.openSpaces,
      callback: () => plugin.openFileTreeLeaf(true),
    });
  }
  if (plugin.superstate.settings.enableFolderNote) {
    plugin.addCommand({
      id: "mk-convert-folder-note",
      name: i18n.commandPalette.convertPathToSpace,
      callback: () => plugin.convertPathToSpace(),
    });
  }
  if (plugin.superstate.settings.contextEnabled) {
    plugin.addCommand({
      id: "mk-open-file-context",
      name: i18n.commandPalette.openFileContext,
      callback: () => plugin.openFileContextLeaf(FILE_CONTEXT_VIEW_TYPE, true),
    });
  }
  if (plugin.superstate.settings.inlineBacklinks) {
    plugin.addCommand({
      id: "mk-toggle-backlinks",
      name: i18n.commandPalette.toggleBacklinks,
      callback: () => {
        const evt = new CustomEvent(eventTypes.toggleBacklinks);
        window.dispatchEvent(evt);
      },
    });
  }

  if (plugin.superstate.settings.blinkEnabled) {
    plugin.addCommand({
      id: "mk-blink",
      name: i18n.commandPalette.blink,
      callback: () => plugin.quickOpen(plugin.superstate, BlinkMode.Blink),
      hotkeys: [
        {
          modifiers: ["Mod"],
          key: "o",
        },
      ],
    });
  }

  plugin.addCommand({
    id: "mk-set-homepage",
    name: "Set Current Space/Path as Homepage",
    callback: () => {
      const currentPath = plugin.superstate.ui.activePath;
      if (currentPath) {
        plugin.superstate.settings.homepagePath = currentPath;
        plugin.saveSettings();
        plugin.superstate.ui.notify(`Homepage set to: ${currentPath}`);
      } else {
        plugin.superstate.ui.notify("No active path to set as homepage");
      }
    },
  });
};
