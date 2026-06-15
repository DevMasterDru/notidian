import { MakeBasicsSettings } from "basics/types/settings";

export type DeleteFileOption = "trash" | "permanent" | "system-trash";
export type InlineContextLayout = "horizontal" | "vertical";

export interface MakeMDSettings {
  defaultInitialization: boolean;
  filePreviewOnHover: boolean;
  blinkEnabled: boolean;
  datePickerTime: boolean;
  spacesEnabled: boolean;
  navigatorEnabled: boolean;
  spacesDisablePatch: boolean;
  spacesPerformance: boolean;
  spaceRowHeight: number;
  mobileSpaceRowHeight: number;
  spacesStickers: boolean;
  banners: boolean;
  bannerHeight: number;
  spaceViewEnabled: boolean;
  spaceViewShowNoteBody: boolean;
  sidebarTabs: boolean;
  vaultSelector: boolean;
  showRibbon: boolean;
  deleteFileOption: DeleteFileOption;
  autoOpenFileContext: boolean;
  expandFolderOnClick: boolean;
  expandedSpaces: string[];
  contextEnabled: boolean;
  autoImportObsidianPropertiesToContexts: boolean;
  activeView: string;
  currentWaypoint: number;
  activeSpace: string;
  hideFrontmatter: boolean;
  spacesFolder: string;
  spacesMDBInHidden: boolean;
  autoAddContextsToSubtags: boolean;
  folderNoteInsideFolder: boolean;
  folderNoteName: string;
  enableFolderNote: boolean;
  folderIndentationLines: boolean;
  revealActiveFile: boolean;
  hiddenFiles: string[];
  skipFolders: string[];
  skipFolderNames: string[];
  hiddenExtensions: string[];
  newFileLocation: string;
  newFileFolderPath: string;
  inlineContext: boolean;
  inlineContextProperties: boolean;
  imageThumbnails: boolean;
  noteThumbnails: boolean;
  inlineBacklinks: boolean;
  defaultDateFormat: string;
  defaultTimeFormat: string;
  inlineBacklinksExpanded: boolean;
  inlineContextExpanded: boolean;
  inlineContextSectionsExpanded: boolean;
  inlineContextNameLayout: InlineContextLayout;
  spacesUseAlias: boolean,
  spaceSubFolder: string,
  suppressedWarnings: string[],
  fmKeyAlias: string;
  fmKeyBanner: string;
  fmKeyBannerOffset: string;
  fmKeyColor: string;
  fmKeySticker: string;
  openSpacesOnLaunch: boolean;
  spacesRightSplit: boolean;
  indexSVG: boolean;
  readableLineWidth: boolean;
  releaseNotesPrompt: number;
  firstLaunch: boolean;
  enableDefaultSpaces: boolean;
  showSpacePinIcon: boolean;
  experimental: boolean;
  systemName: string;
  defaultSpaceTemplate: string;
  selectedKit: string;
  actionMaxSteps: number;
  contextPagination: number;
  newNotePlaceholder: string;
  cacheIndex: boolean;
  enhancedLogs: boolean;
  basics: boolean;
  // Frame-execution trust boundary + frame-text sanitization (bd Notidian-vke,
  // deferred from the ebz sweep / ADR 0018). When true:
  //  (1) the TextNodeView frame-text dangerouslySetInnerHTML sink is routed
  //      through sanitizeFrameText (strips script/on*/dangerous-URLs, keeps
  //      formatting), and
  //  (2) the new Function prop/style evaluator withholds $api from
  //      user/imported (non-default-kit) frames, so only plugin-shipped default
  //      frames and user-triggered actions get API write access.
  // DEFAULT-OFF: this is a core render-path change that cannot be verified
  // offline (SpaceOuter always frame-renders). It ships gated so the owner's
  // current vault is untouched until they enable it and live-verify in the
  // vault (see docs/AUTONOMOUS-REVIEW-QUEUE.md). Existing saved settings are not
  // mutated; only fresh/unset state defaults to false.
  hardenFrameExecution: boolean;
  basicsSettings: MakeBasicsSettings;
  notesPreview: boolean;
  editStickerInSidebar: boolean;
  overrideNativeMenu: boolean;
  onboardingCompleted: boolean;
  contextCreateUseModal: boolean;
  homepagePath: string;
  mobileMakeHeader: boolean;
}
