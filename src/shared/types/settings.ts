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
  // Notidian-50hn (default ON, flag-gated core render-path change — owner
  // directive 2026-07-10): the collapse control on a space's folder-note region
  // must hide 100% of the note text (callout + headings + dataview) so the page
  // becomes a database-only view. ON UNMOUNTS the entire note subtree on collapse
  // (zero note nodes). OFF is a non-destructive kill-switch: the body stays
  // MOUNTED but CSS-hidden (keeps the embedded editor/scroll state alive) — use
  // it only if a live remount ever misbehaves. Collapse state itself keeps
  // persisting as noteBodyCollapsed (Notidian view state, ADR 0001/0014).
  spaceNoteBodyFullCollapse: boolean;
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
  // Notidian-z21a (default ON, kill-switch): a database row whose file has a
  // same-named sibling folder is itself the hub of a nested child database
  // (row-as-child-hub, depth 1 — Atlas Method ADR-0042 D1; the adjacent
  // hub-note resolution this builds on is folderNoteInsideFolder=false, ADR
  // 0008, and already works unconditionally). When ON: renaming/moving/
  // deleting such a row cascades to its child folder instead of orphaning
  // it, and the Type Profile structural keys (schema_type/fields/kind_fields/
  // invariants) a nested hub-row declares for ITS OWN child database are
  // excluded from the PARENT database's frontmatter column discovery. A
  // standalone, tested HubRowIndicator component exists
  // (core/react/components/UI/Toggles/HubRowIndicator.tsx) for a future
  // row-rendering integration (not yet wired into any row surface — no live
  // hub row exists in the vault yet to verify placement against). OFF ==
  // byte-identical legacy behavior (no cascade, no discovery exclusion).
  enableNestedHubRows: boolean;
  // Notidian-b0fm (default OFF, review-queue flag-gate): opt-in render-surface
  // affordance that wires the standalone HubRowIndicator
  // (core/react/components/UI/Toggles/HubRowIndicator.tsx) into the TableView
  // row gutter (alongside RowHealthBadge). When ON *and* enableNestedHubRows is
  // ON, a row whose file is the configured hub note of a same-named sibling
  // folder (isHubRowPath) gets a small button that opens that nested child
  // database. DEFAULT OFF: this is a core render-path change whose live
  // placement/behavior can't be proven by tsc/jest/build, and no live hub row
  // existed in the vault to verify against — it ships gated OFF for the owner
  // to enable + live-verify (docs/AUTONOMOUS-REVIEW-QUEUE.md). OFF ==
  // byte-identical legacy gutter (no indicator, whatever enableNestedHubRows
  // is set to).
  enableHubRowIndicator: boolean;
  // Notidian-loan.15 (default OFF, review-queue flag-gate, Atlas Method ADR-0069):
  // opt-in READ-ONLY lock affordance in the TableView row gutter. When ON, a data
  // row whose reserved `locked` system field resolves truthy gets a small,
  // NON-INTERACTIVE `.mk-lock-badge` span (no click, no unlock, no write) beside
  // RowHealthBadge. DEFAULT OFF: this is a core render-path change whose live
  // placement can't be proven by tsc/jest/build, so it ships gated OFF for the
  // owner to enable + live-verify (docs/AUTONOMOUS-REVIEW-QUEUE.md). The badge is
  // display-only — lock ENFORCEMENT/PREVENTION is out of scope (ADR-0069 D2 scopes
  // it to the MCP write path; the owner is the authority on the direct-UI path).
  // OFF == byte-identical legacy gutter (no badge).
  lockBadge: boolean;
  // Notidian-loan.5 (default ON, kill-switch, ADR-0057): master gate for the
  // Data Integrity Program's health-surfaces UI -- the row gutter's
  // RowHealthBadge (+ its repair menu), the broken-row `mk-row-broken` tint,
  // the FilterBar header chip, and the Database Health panel. The underlying
  // Reconciler (Notidian-loan.4) keeps detecting/revalidating regardless (it
  // is a separate, always-on read-only engine); this flag ONLY gates whether
  // any of that state is ever rendered or subscribed to. OFF == every one of
  // these surfaces renders nothing and subscribes to nothing (byte-identical
  // to pre-S5 rendering).
  enableDataHealthSurfaces: boolean;
  // Notidian-tluq.2 / ADR 0019 (default ON, kill-switch): show the Comment
  // action in the non-empty-selection inline styler and permit file-canonical
  // CommentV1 authoring. OFF removes the action entirely and performs no
  // comment/anchor writes, restoring the pre-feature popup.
  selectToComment: boolean;
  // ADR 0020 / Notidian-tluq.7: opt-in reminder delivery. When true, the
  // candidate-indexed delivery service scans file-canonical due/repeat/reminder
  // metadata while Obsidian is open. Default OFF; authoring is independent.
  dateReminders: boolean;
  // ADR 0020 / Notidian-tluq.8 (default ON, kill-switch): strict
  // frontmatter-canonical due/repeat/reminder authoring and shared calendar
  // recurrence expansion. OFF restores the complete legacy JSON-object editor
  // and duplicated Day/Month recurrence render paths.
  dateScheduleAuthoring: boolean;
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
  // Render-path declared-view overlays on notidian embeds (ADR-0066 Topic Hub
  // v1 view mechanism / Notidian-ioxi). When true, a notidian embed block's
  // `where:` clauses (and a frame node's forwarded predicate prop) apply a
  // conjunctive filter overlay at RENDER time over the referenced base view —
  // READ-PATH ONLY, never written back to the view schema / views.mdb (the
  // Wave-3 write firewall). DEFAULT-ON at the owner's explicit request (their
  // use IS the verification). The flag is RETAINED as a KILL-SWITCH: set it
  // false and the overlay is ignored at the merge seam so the base view renders
  // UNFILTERED — exact legacy behavior, byte-for-byte. Persisting is unaffected
  // either way: the overlay is merged only inside the row-visibility matcher and
  // never enters savePredicate/saveSchema, so toggling this flag can never touch
  // stored data.
  renderPathViewOverlays: boolean;
  // Tabbed hub views (ADR 0065 / Atlas ADR-0096 H1). When true (default), a
  // folder note declaring a structurally valid frontmatter `tabs:` list
  // renders the space as a persistent tab bar over authored composition
  // pages. False is the kill-switch: every space renders the legacy page
  // regardless of declarations, byte-for-byte.
  hubTabbedViews: boolean;
  // Cross-database saved views (Notidian-42tx / ADR 0059). When true, a saved
  // frame whose def.sources contains at least two database sources renders the
  // pure mapped union of those source rows. F1 is deliberately read-only: the
  // projection may filter/sort/group/export, but row/schema writes stay in each
  // canonical source database. DEFAULT-ON because the owner commissioned F1;
  // false is the kill-switch and restores the singular def.context/def.db read
  // path without interpreting def.sources.
  crossDatabaseSavedViews: boolean;
  // F2 period-scoped relation rollups (Notidian-x7pn / ADR 0060). When true,
  // rollup/backlink period scopes materialize only on ephemeral render rows so
  // native filters and sort can consume them. False ignores period scopes and
  // restores the legacy cell-only, unscoped computation path.
  periodScopedRollups: boolean;
  // F3 recurrence-aware occurrence filters (Notidian-1ceb / ADR 0061).
  // When true, cadence/recurrence fields expose native value-free "occurs
  // today" and "occurs this ISO week" predicates evaluated from each row's
  // cadence, days, and times_per_week frontmatter. False ignores those stored
  // predicates (fail-open) and restores the legacy generic filter surface.
  recurrenceAwareFilters: boolean;
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
  // Table row virtualization (bd Notidian-8h9 / ADR 0049). When true, an opened
  // database table assembles ALL filtered/sorted rows up front (the proven
  // tableAssembly seam, Notidian-yjg3) and then renders ONLY the rows inside the
  // current scroll window (the pure computeVirtualWindow seam, Notidian-mnuk),
  // with top/bottom spacer rows holding the scrollbar at full content height. The
  // legacy "Load More / Load All" pagination tfoot is hidden because every row is
  // reachable by scrolling. Memoized row/cell keep re-render cost flat.
  //   true (default): the table virtualizes — only the windowed <tr> rows mount,
  //     so a 10k-row context renders a constant ~viewport-worth of DOM instead of
  //     every row+cell. The owner verifies the live perf win by USE.
  //   false (kill-switch): byte-for-byte legacy — the table keeps its
  //     getPaginationRowModel page window and the Load More / Load All tfoot, and
  //     every loaded row is rendered with no spacers. Restores the exact
  //     pre-feature render path.
  // DEFAULT-ON / KILL-SWITCH: this is an OWNER-REQUESTED core render-path change
  // (fresh live evidence 2026-06-20: full-vault assemble-before-paginate + no
  // virtualization is visibly slow), so per AGENTS.md it ships ON and the owner's
  // USE is the live-verification; the flag is RETAINED as a true kill-switch. The
  // window math (computeVirtualWindow) and the activation decision
  // (tableVirtualization.ts) are pure and fully unit-tested; only the wiring is
  // unverifiable offline and is covered by jsdom tests (OFF byte-identical, ON
  // window membership == pure-seam output).
  rowVirtualization: boolean;
  // Sub-items setup front-door (bd Notidian-xqxc). DEFAULT-ON / KILL-SWITCH.
  // When true, the FilterBar "Sub-items" submenu offers a one-click "Turn on
  // sub-items" option (primary files schema only) when no eligible self-relation
  // column exists, creating a frontmatter-backed parent-link column + setting
  // predicate.subItems.field in one action. Set false to restore the
  // byte-for-byte legacy submenu (None + eligible list only); the option is not
  // offered and no column is auto-created.
  // SCOPE: this gates only the SETUP affordance (the menu option), NOT the
  // dormant sub-items render path. A view that already has predicate.subItems.field
  // (designated manually, or set before the flag was flipped off) keeps rendering
  // its tree regardless of this flag — flip it off to hide the front-door, clear
  // the predicate field to flatten an already-on view.
  subItemsSetup: boolean;
  // Notion-style "+ New sub-item" row (Notidian-gr8t). DEFAULT-ON / KILL-SWITCH.
  // When true, an expanded parent shows a faint "+ New sub-item" affordance after
  // its last visible child (table + list views) that creates a child of that
  // parent. Set false to render the prior tree with no add-rows.
  subItemAddRow: boolean;
  // Filename template auto-enforcement (Notidian-pay5 / ADR 0054). When true,
  // files in databases with a configured _filenameTemplate are auto-renamed on
  // frontmatter change to match the template. DEFAULT-ON (owner-requested);
  // KILL-SWITCH: set false to disable all template-driven renaming.
  filenameTemplateEnforcement: boolean;
  // View-settings inline bar IA (Notidian-vrmf). DEFAULT-ON / KILL-SWITCH.
  // When true, the FilterBar wraps the Filter/Sort/Group-By trio in a
  // .mk-view-settings-bar with per-control active indicators (mk-active +
  // accent underline) derived from a shared pure helper, AND the 3-knobs
  // ("view options") menu stops re-listing Filter/Sort (single home: inline).
  // Set false to restore byte-for-byte legacy IA: the trio reverts to bare
  // .mk-toolbar-button direct children of .mk-view-options (no wrapper, no
  // .mk-view-setting* classes, no data-mk-* / aria-pressed, no accent
  // underline) with their prior inline active expressions, and the 3-knobs
  // menu re-lists Filter/Sort (the prior duplication).
  viewSettingsInlineBar: boolean;
  // Vault file-tree text filter (Notidian-nrjb + ADR 0063). When true,
  // MainList renders a filter above SpaceTreeComponent. Name/path matches stay
  // synchronous; a session-ephemeral worker adds Markdown body matches after a
  // 150 ms debounce, force-showing every ancestor of either match
  // (walked via PathState.parent) regardless of the persisted
  // settings.expandedSpaces collapse state -- the pure filterTreeByQuery
  // helper computes the path-only tree from already-loaded caches. Querying
  // performs no vault reads; bodies remain canonical in Markdown and are never
  // persisted into PathState, frontmatter, MDB, or .notidian.
  //   true (default): the filter box renders; the tree recomputes byte-for-byte
  //     the normal expandedSpaces-driven flattened tree when the query is blank,
  //     and switches to filterTreeByQuery's result set otherwise.
  //   false (kill-switch): no filter/status renders, no content worker is
  //     created, no bodies are read, and the complete pre-filter tree path is
  //     restored.
  // DEFAULT-ON / KILL-SWITCH: owner-requested 2026-07-03 ("the vault has grown
  // large enough that finding files by browsing is slow"); the owner's live USE
  // is the verification (core render-path change, not fully tsc/jest/build
  // verifiable offline — ADR 0051). Pure, adapter, and jsdom seams are tested;
  // final owner-visible behavior remains covered by the deploy/live contract.
  enableNavigatorTextFilter: boolean;
  basicsSettings: MakeBasicsSettings;
  notesPreview: boolean;
  editStickerInSidebar: boolean;
  overrideNativeMenu: boolean;
  onboardingCompleted: boolean;
  contextCreateUseModal: boolean;
  homepagePath: string;
  mobileMakeHeader: boolean;
}
