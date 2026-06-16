import i18n from "shared/i18n";

import { BasicDefaultSettings } from "../../basics/schemas/settings";
import { MakeMDSettings } from "../../shared/types/settings";



export const DEFAULT_SETTINGS: MakeMDSettings = {
  newNotePlaceholder: i18n.settings.untitled,
  defaultInitialization: false,
  navigatorEnabled: true,
  filePreviewOnHover: false,
  blinkEnabled: true,
  datePickerTime: false,
  imageThumbnails: false,
  noteThumbnails: false,
  spacesMDBInHidden: true,
  cacheIndex: true,
  spacesRightSplit: false,
  contextEnabled: true,
  spaceViewEnabled: true,
  autoImportObsidianPropertiesToContexts: true,
  autoOpenFileContext: false,
  activeView: "/",
  hideFrontmatter: true,
  activeSpace: "",
  defaultDateFormat: "MMM dd yyyy",
  defaultTimeFormat: "h:mm a",
  spacesEnabled: true,
  spacesPerformance: false,
  currentWaypoint: 0,
  enableFolderNote: true,
  spaceViewShowNoteBody: true,
  // Notidian-8sl: default ON — the owner explicitly requested a collapsible +
  // shrink-to-fit space-note body, so it ships enabled; the owner verifies it by
  // USE. The flag is RETAINED as a KILL-SWITCH: set it false to fully disable the
  // feature. When OFF, SpaceNoteBody takes the legacy branch (no header, no
  // chevron, no `mk-space-note--collapsible` class) and the scoped CSS override
  // never matches, so the rendered region is byte-identical to the pre-feature
  // behavior — the kill switch truly restores legacy rendering.
  collapsibleNoteBody: true,
  folderIndentationLines: true,
  revealActiveFile: false,
  spacesStickers: true,
  spaceRowHeight: 29,
  mobileSpaceRowHeight: 40,
  bannerHeight: 200,
  spacesDisablePatch: false,
  folderNoteInsideFolder: true,
  folderNoteName: "",
  sidebarTabs: true,
  showRibbon: true,
  vaultSelector: true,
  deleteFileOption: "trash",
  expandedSpaces: ["/"],
  expandFolderOnClick: true,
  spacesFolder: i18n.settings.tags,
  suppressedWarnings: [],
  spaceSubFolder: ".notidian",
  hiddenFiles: [],
  hiddenExtensions: [".mdb", '_assets', '_blocks'],
  newFileLocation: "root",
  newFileFolderPath: "",
  inlineBacklinks: false,
  inlineContext: true,
  inlineBacklinksExpanded: false,
  inlineContextExpanded: true,
  inlineContextProperties: true,
  inlineContextSectionsExpanded: true,
  banners: true,
  inlineContextNameLayout: "vertical",
  spacesUseAlias: false,
  fmKeyAlias: 'aliases',
  fmKeyBanner: 'banner',
  fmKeyColor: 'color',
  fmKeyBannerOffset: 'banner_y',
  fmKeySticker: 'sticker',
  
  openSpacesOnLaunch: true,
  indexSVG: false,
  readableLineWidth: true,
  autoAddContextsToSubtags: true,
  releaseNotesPrompt: 0.8,
  enableDefaultSpaces: true,
  showSpacePinIcon: true,
  experimental: false,
  systemName: i18n.settings.vault,
  defaultSpaceTemplate: "",
  selectedKit: "default",
  actionMaxSteps: 100,
  contextPagination: 25,
  skipFolders: [],
  skipFolderNames: [],
  enhancedLogs: false,
  basics: true,
  // Default-OFF frame-execution hardening (bd Notidian-vke / ADR 0018). Core
  // render-path change; needs live vault verification before the owner enables
  // it (docs/AUTONOMOUS-REVIEW-QUEUE.md).
  hardenFrameExecution: false,
  // Default-OFF dead-MKit-preview-runtime removal (bd Notidian-bnb / ADR 0018).
  // Core render-path change; file deletion is behavior-preserving, but the
  // branch short-circuit needs live vault verification before the owner enables
  // it (docs/AUTONOMOUS-REVIEW-QUEUE.md).
  removeMKitPreviewRuntime: false,
  // Default-ON list-view per-item display-property picker (bd Notidian-543 /
  // ADR 0016) — an owner-requested ("very important") Notion-'Properties'
  // parity feature; the owner verifies it by USE. The flag is RETAINED as a
  // KILL-SWITCH: set it false to fully disable the feature. When OFF, the
  // render chokepoint (`applyListItemVisibleProperties`) returns the visible
  // columns UNCHANGED (same array reference) at every call site, so the
  // per-item field set is byte-for-byte today's, regardless of any stored
  // `visibleProperties`.
  listItemPropertyPicker: true,
  basicsSettings: BasicDefaultSettings,
  firstLaunch: false,
  notesPreview: false,
  editStickerInSidebar: true,
  overrideNativeMenu: false,
  onboardingCompleted: false,
  contextCreateUseModal: false,
  homepagePath: '',
  mobileMakeHeader: false,
};
