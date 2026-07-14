import i18n from "shared/i18n";
import { isLegacyStorageRoot, pluginStorageRoot } from "shared/pluginIdentity";

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
  // Disabled after Notidian-3gx2: the warm superstate.mdc startup cache is only
  // a performance optimization, and the owner's vault reproduced a native
  // Obsidian renderer crash only when saved cacheIndex=true was used during
  // cold startup. Notidian can rebuild from canonical files/frontmatter and
  // context MDBs without this cache.
  cacheIndex: false,
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
  // Notidian-z21a: default ON — the owner explicitly seeded a live consumer
  // (vault Knowledge root hub, 2026-07-05) whose domain rows are meant to be
  // hubs of their own child unit databases (ADR-0042 D1); the owner verifies
  // it by USE. RETAINED as a kill-switch: set false to fully disable the
  // row-op cascade + discovery-exclusion behavior and restore legacy
  // (pre-feature) handling of a row whose file happens to have a same-named
  // sibling folder.
  enableNestedHubRows: true,
  // Notidian-b0fm: default OFF — review-queue flag-gate. Wires the standalone
  // HubRowIndicator into the TableView row gutter for a hub row (a row whose
  // file is the configured note of a same-named sibling folder). Core
  // render-path change with no offline-provable placement and no live hub row
  // to verify against, so it ships GATED OFF for the owner to enable +
  // live-verify (docs/AUTONOMOUS-REVIEW-QUEUE.md). OFF == the pre-feature
  // gutter, independent of enableNestedHubRows.
  enableHubRowIndicator: false,
  // Notidian-loan.15: default OFF — review-queue flag-gate (Atlas Method
  // ADR-0069). Wires the standalone, READ-ONLY LockBadge into the TableView row
  // gutter for a row whose reserved `locked` system field resolves truthy.
  // Core render-path change with no offline-provable placement, so it ships
  // GATED OFF for the owner to enable + live-verify (docs/AUTONOMOUS-REVIEW-QUEUE.md).
  // Display-only: NO click-to-unlock, NO write, NO lock enforcement (ADR-0069 D2
  // scopes prevention to the MCP write path; the owner owns the direct-UI path).
  // OFF == the pre-feature gutter (no badge).
  lockBadge: false,
  // Notidian-loan.5: default ON — owner-ratified Data Integrity Program
  // (ADR-0057). KILL-SWITCH: set false to hide every health-surfaces UI
  // element (row badges + repair menu, mk-row-broken tint, the FilterBar
  // Database Health chip, and the Database Health panel) and unsubscribe them
  // from the reconciler; the reconciler itself (Notidian-loan.4) keeps
  // detecting in the background either way -- this flag only gates the UI.
  enableDataHealthSurfaces: true,
  spaceViewShowNoteBody: true,
  // Notidian-8sl: default ON — the owner explicitly requested a collapsible +
  // shrink-to-fit space-note body, so it ships enabled; the owner verifies it by
  // USE. The flag is RETAINED as a KILL-SWITCH: set it false to fully disable the
  // feature. When OFF, SpaceNoteBody takes the legacy branch (no header, no
  // chevron, no `mk-space-note--collapsible` class) and the scoped CSS override
  // never matches, so the rendered region is byte-identical to the pre-feature
  // behavior — the kill switch truly restores legacy rendering.
  collapsibleNoteBody: true,
  // Notidian-50hn: default ON — owner directive (2026-07-10): collapsing a
  // space's folder-note region must hide ALL note text, leaving a database-only
  // view. ON UNMOUNTS the whole note subtree on collapse (no callout/heading/
  // dataview remnant). KILL-SWITCH: set false to keep the body MOUNTED but
  // CSS-hidden on collapse (non-destructive fallback that preserves the embedded
  // editor's state) — the note nodes then remain in the DOM, hidden. The
  // per-space collapsed flag persists independently as noteBodyCollapsed.
  spaceNoteBodyFullCollapse: true,
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
  // Default-ON render-path declared-view overlays on notidian embeds (ADR-0066
  // Topic Hub v1 view mechanism / Notidian-ioxi) — an owner-requested change;
  // the owner verifies it by USE. The overlay (`where:` clauses / a frame node's
  // predicate prop) narrows the referenced base view at RENDER time, READ-PATH
  // ONLY, and is NEVER persisted (Wave-3 write firewall). RETAINED as a
  // KILL-SWITCH: set it false and the merge seam ignores the overlay so the base
  // view renders unfiltered — byte-for-byte legacy behavior.
  renderPathViewOverlays: true,
  // Default-ON cross-database saved-view projection (Notidian-42tx / ADR 0059).
  // Owner-requested F1; retained as a kill-switch. OFF ignores def.sources and
  // restores the singular context/database read path byte-for-byte.
  crossDatabaseSavedViews: true,
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
  // Default-ON filename template auto-enforcement (Notidian-pay5 / ADR 0054) —
  // an owner-requested feature; the owner verifies by USE. KILL-SWITCH: set
  // false to disable all template-driven auto-renaming.
  filenameTemplateEnforcement: true,
  // Default-ON view-settings inline bar IA (bd Notidian-vrmf) — an
  // owner-requested (2026-06-21) FilterBar render-path UX standardization, so it
  // ships ON and the owner verifies it by USE. Two halves, both on this flag:
  // (1) DE-DUP — the 3-knobs ("view options") menu no longer re-lists Filter or
  // Sort; their single home is the inline toolbar trio (Group-By already moved
  // inline-only via Notidian-nmr). (2) ACTIVE-STATE — the inline controls derive
  // their active indicator from the pure deriveInlineControlActiveState helper
  // (Notidian-vrmf), so each shows whether its setting is applied at a glance.
  // The flag is RETAINED as a KILL-SWITCH: set it false to restore the
  // byte-for-byte legacy IA — the trio reverts to bare .mk-toolbar-button
  // direct children of .mk-view-options (no .mk-view-settings-bar wrapper, no
  // .mk-view-setting* classes, no data-mk-* / aria-pressed, no accent-underline
  // CSS, which is scoped to data-mk-inline-bar="on") with their prior inline
  // `predicate?.x.length > 0` active expressions, AND Filter/Sort reappear in
  // the 3-knobs menu (the prior inside/outside duplication). The decision logic
  // (active-state derivation + single-home invariant) is pure and unit-tested
  // (viewSettings.test.ts); the render + de-dup + OFF-revert wiring is
  // jsdom-tested (FilterBar.viewSettings.dom.test.tsx).
  viewSettingsInlineBar: true,
  // Vault file-tree text filter (Notidian-nrjb). See MakeMDSettings doc-comment
  // (shared/types/settings.ts) for the full DEFAULT-ON / KILL-SWITCH contract.
  enableNavigatorTextFilter: true,
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

export const sanitizeNotidianSettings = (data: unknown): MakeMDSettings => {
  const settings = Object.assign(
    {},
    DEFAULT_SETTINGS,
    data && typeof data === "object" ? data : {}
  ) as Record<string, unknown>;

  const retiredSyncSettingKeys = [
    ["saveAllContext", "ToFrontmatter"].join(""),
    ["syncFormula", "ToFrontmatter"].join(""),
  ];
  for (const key of retiredSyncSettingKeys) {
    delete settings[key];
  }

  if (isLegacyStorageRoot(settings.spaceSubFolder)) {
    settings.spaceSubFolder = pluginStorageRoot;
  }

  // Notidian-3gx2: force existing saved values out of the crash path too. A
  // default change alone would not help vaults that already persisted true.
  settings.cacheIndex = false;

  return settings as unknown as MakeMDSettings;
};
