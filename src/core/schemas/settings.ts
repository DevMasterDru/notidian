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
  // Default-ON frame-execution hardening as of the owner live-verify 2026-06-20
  // (ADR 0018 / Notidian-vke). Routes frame text through sanitizeFrameText and
  // withholds $api from non-default-kit frames (and enables the jsonWithUnquoted
  // tolerant tokenizer, ADR 0026). The flag is RETAINED as a KILL-SWITCH: set it
  // false to restore byte-for-byte legacy frame execution.
  hardenFrameExecution: true,
  // Default-ON list-view per-item display-property picker (bd Notidian-543 /
  // ADR 0016) — an owner-requested ("very important") Notion-'Properties'
  // parity feature; the owner verifies it by USE. The flag is RETAINED as a
  // KILL-SWITCH: set it false to fully disable the feature. When OFF, the
  // render chokepoint (`applyListItemVisibleProperties`) returns the visible
  // columns UNCHANGED (same array reference) at every call site, so the
  // per-item field set is byte-for-byte today's, regardless of any stored
  // `visibleProperties`.
  listItemPropertyPicker: true,
  // Default-ON table row virtualization (bd Notidian-8h9 / ADR 0049) — an
  // owner-requested core render-path change backed by fresh live evidence
  // (2026-06-20: full-vault assemble-before-paginate + no row virtualization is
  // visibly slow), so per AGENTS.md it ships ON and the owner verifies the perf
  // win by USE. The flag is RETAINED as a KILL-SWITCH: set it false to restore
  // byte-for-byte legacy rendering — the table reverts to its
  // getPaginationRowModel page window + the Load More / Load All tfoot, with no
  // spacer rows. The window math (computeVirtualWindow, Notidian-mnuk) and the
  // activation decision (tableVirtualization.ts) are pure and unit-tested; the
  // render wiring is covered by jsdom tests.
  rowVirtualization: true,
  // Default-ON sub-items setup front-door (bd Notidian-xqxc) — surfaces the
  // shipped-but-dormant sub-items tree engine. When ON, the FilterBar "Sub-items"
  // submenu offers a one-click "Turn on sub-items" option whenever no eligible
  // self-relation column exists, creating a frontmatter-backed parent-link column
  // AND setting predicate.subItems.field in one action (owner verifies by USE).
  // The flag is RETAINED as a KILL-SWITCH: set it false to restore the
  // byte-for-byte legacy submenu (None + the eligible-column list only) — the
  // create option is never offered and no column is auto-created via this path.
  // The shipped tree engine and the manual eligible-column pick are untouched.
  subItemsSetup: true,
  // Default-ON Notion-style "+ New sub-item" row (bd Notidian-gr8t) — an
  // expanded parent shows a faint "+ New sub-item" affordance after its last
  // visible child (owner verifies by USE). KILL-SWITCH: false renders the tree
  // with no add-rows (and restores row virtualization on those views).
  subItemAddRow: true,
  // Default-ON view-settings inline bar IA (bd Notidian-vrmf) — an
  // owner-requested (2026-06-21) FilterBar render-path UX standardization, so it
  // ships ON and the owner verifies it by USE. Two halves, both on this flag:
  // (1) DE-DUP — the 3-knobs ("view options") menu no longer re-lists Filter or
  // Sort; their single home is the inline toolbar trio (Group-By already moved
  // inline-only via Notidian-nmr). (2) ACTIVE-STATE — the inline controls derive
  // their active indicator from the pure deriveInlineControlActiveState helper
  // (Notidian-vrmf), so each shows whether its setting is applied at a glance.
  // The flag is RETAINED as a KILL-SWITCH: set it false to restore the
  // byte-for-byte legacy IA — the inline buttons revert to their prior inline
  // `predicate?.x.length > 0` expressions AND Filter/Sort reappear in the
  // 3-knobs menu (the prior inside/outside duplication). The decision logic
  // (active-state derivation + single-home invariant) is pure and unit-tested
  // (viewSettings.test.ts); the render + de-dup wiring is jsdom-tested
  // (FilterBar.viewSettings.dom.test.tsx).
  viewSettingsInlineBar: true,
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
