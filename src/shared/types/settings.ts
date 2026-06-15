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
  // Off-thesis Make.md-era .mkit installer (imports untrusted kits: frame defs,
  // context MDB tables, spaces). Disabled by default — it is an untrusted-input
  // surface feeding the frame execution sink and unused in a Notidian-only,
  // folder-backed engine (ADR 0018; bd Notidian-409).
  mkitInstallerEnabled: boolean;
  basicsSettings: MakeBasicsSettings;
  notesPreview: boolean;
  editStickerInSidebar: boolean;
  overrideNativeMenu: boolean;
  onboardingCompleted: boolean;
  contextCreateUseModal: boolean;
  homepagePath: string;
  mobileMakeHeader: boolean;
}
