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
  // Notidian-8sl (default OFF, flag-gated core render-path change): when on, the
  // folder/hub note body shown above a space's database becomes collapsible (a
  // chevron in its header) and shrink-to-fit when expanded (sized to its text,
  // not a fixed full-height block). Per-space collapsed state persists in the
  // SpaceDefinition (noteBodyCollapsed). OFF == byte-identical legacy rendering.
  collapsibleNoteBody: boolean;
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
  // DEFAULT-ON after the owner's live-verify 2026-06-20 (ADR 0018 / Notidian-vke).
  // The flag remains a KILL-SWITCH: set it false to restore byte-for-byte legacy
  // frame execution (TextNodeView raw sink + $api on every frame). Existing saved
  // settings are not mutated; only fresh/unset state now defaults to true.
  hardenFrameExecution: boolean;
  // List view per-item display-property picker (Notion "Properties" parity) —
  // bd Notidian-543 / ADR 0016. When true, the list kit's per-item field set
  // (`fieldsView`, fed by the `_properties` context array) is filtered to the
  // allowlist stored in `predicate.listItemProps.visibleProperties`; when an
  // allowlist is set, only those properties render per item, in that order.
  //   true (default): the allowlist (chosen via the FilterBar "Item Properties"
  //     menu) is applied to the per-item field set. With no allowlist stored,
  //     every non-hidden property renders per item exactly as before.
  //   false: feature fully disabled — `_properties` is unchanged and the
  //     per-item field set is byte-for-byte legacy, regardless of any stored
  //     visibleProperties.
  // DEFAULT-ON / KILL-SWITCH: this is an owner-requested ("very important")
  // Notion-'Properties' parity feature; validation is use-driven (the owner
  // verifies by USE), so the default ships ON. The flag is RETAINED as a true
  // kill-switch: set it false to fully disable. When OFF, the render chokepoint
  // (`applyListItemVisibleProperties`) returns the visible columns UNCHANGED
  // (same array reference) at every call site, so the per-item field set is
  // byte-for-byte today's. The model + menu + persistence half is pure and
  // fully unit-tested.
  listItemPropertyPicker: boolean;
  basicsSettings: MakeBasicsSettings;
  notesPreview: boolean;
  editStickerInSidebar: boolean;
  overrideNativeMenu: boolean;
  onboardingCompleted: boolean;
  contextCreateUseModal: boolean;
  homepagePath: string;
  mobileMakeHeader: boolean;
}
