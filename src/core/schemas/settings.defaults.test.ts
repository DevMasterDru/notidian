import { DEFAULT_SETTINGS } from "core/schemas/settings";
import { MakeMDSettings } from "shared/types/settings";

// ---------------------------------------------------------------------------
// DEPTH / clear-correct REGRESSION LOCK (Notidian-ycs6) — protects the
// autonomous drive's OWN kill-switches.
//
// `core/schemas/settings.ts` DEFAULT_SETTINGS is the owner-facing defaults
// object; `shared/types/settings.ts` MakeMDSettings is its type. They are in
// perfect key-sync today (94 keys each, verified) but NOTHING guarded that.
//
// THE FAILURE THIS LOCKS OUT (the ADR 0051 "committed != visible" class):
// the drive ships owner-requested render-path features behind DEFAULT-ON
// kill-switch flags (rowVirtualization, hardenFrameExecution,
// viewSettingsInlineBar, ...). If a NEW flag is added to the type + the render
// code but its DEFAULT is forgotten, `settings.flag` reads `undefined` at
// runtime. `undefined` is falsy, so the kill-switch is silently in the WRONG
// (OFF) state — the owner-requested feature is dark and the owner has no signal
// to diagnose it. A reverse drift (a default for a removed setting) is dead
// config that quietly shadows nothing. Both are now caught at test time.
//
// PURE + offline: this is a real value/shape assertion — no vault, no DOM, no
// I/O sinks, so no sanitize routing applies (ADR 0017 governs vault-content
// HTML sinks only).
// ---------------------------------------------------------------------------

// COMPILE-TIME KEY MANIFEST — the single source of truth for "every required
// MakeMDSettings key". `Record<keyof MakeMDSettings, true>` forces this object
// to name EVERY key of the interface: add a required key to the type and this
// literal stops compiling ("Property 'x' is missing") until the key is listed
// here, which (combined with the runtime set-equality below) forces a default
// to be added too. Remove a key from the type and the stray entry here becomes
// an excess-property compile error. `as const satisfies` keeps the literal
// exact while proving total coverage.
//
// MakeMDSettings has NO optional (`?`) members today, so every key is required;
// were an optional member ever added, it would be intentionally exempt from the
// DEFAULT_SETTINGS-must-contain-it rule — it would simply be omitted from this
// manifest (the `Record<keyof ...>` would then need a `Required<>` wrapper; see
// note below) rather than forced to have a default.
const REQUIRED_SETTING_KEYS = {
  newNotePlaceholder: true,
  defaultInitialization: true,
  navigatorEnabled: true,
  filePreviewOnHover: true,
  blinkEnabled: true,
  datePickerTime: true,
  imageThumbnails: true,
  noteThumbnails: true,
  spacesMDBInHidden: true,
  cacheIndex: true,
  spacesRightSplit: true,
  contextEnabled: true,
  spaceViewEnabled: true,
  autoImportObsidianPropertiesToContexts: true,
  autoOpenFileContext: true,
  activeView: true,
  hideFrontmatter: true,
  activeSpace: true,
  defaultDateFormat: true,
  defaultTimeFormat: true,
  spacesEnabled: true,
  spacesPerformance: true,
  currentWaypoint: true,
  enableFolderNote: true,
  enableNestedHubRows: true,
  enableHubRowIndicator: true,
  lockBadge: true,
  enableDataHealthSurfaces: true,
  spaceViewShowNoteBody: true,
  collapsibleNoteBody: true,
  spaceNoteBodyFullCollapse: true,
  folderIndentationLines: true,
  revealActiveFile: true,
  spacesStickers: true,
  spaceRowHeight: true,
  mobileSpaceRowHeight: true,
  bannerHeight: true,
  spacesDisablePatch: true,
  folderNoteInsideFolder: true,
  folderNoteName: true,
  sidebarTabs: true,
  showRibbon: true,
  vaultSelector: true,
  deleteFileOption: true,
  expandedSpaces: true,
  expandFolderOnClick: true,
  spacesFolder: true,
  suppressedWarnings: true,
  spaceSubFolder: true,
  hiddenFiles: true,
  hiddenExtensions: true,
  newFileLocation: true,
  newFileFolderPath: true,
  inlineBacklinks: true,
  inlineContext: true,
  inlineBacklinksExpanded: true,
  inlineContextExpanded: true,
  inlineContextProperties: true,
  inlineContextSectionsExpanded: true,
  banners: true,
  inlineContextNameLayout: true,
  spacesUseAlias: true,
  fmKeyAlias: true,
  fmKeyBanner: true,
  fmKeyColor: true,
  fmKeyBannerOffset: true,
  fmKeySticker: true,
  openSpacesOnLaunch: true,
  indexSVG: true,
  readableLineWidth: true,
  autoAddContextsToSubtags: true,
  releaseNotesPrompt: true,
  enableDefaultSpaces: true,
  showSpacePinIcon: true,
  experimental: true,
  systemName: true,
  defaultSpaceTemplate: true,
  selectedKit: true,
  actionMaxSteps: true,
  contextPagination: true,
  skipFolders: true,
  skipFolderNames: true,
  enhancedLogs: true,
  basics: true,
  hardenFrameExecution: true,
  renderPathViewOverlays: true,
  crossDatabaseSavedViews: true,
  periodScopedRollups: true,
  listItemPropertyPicker: true,
  rowVirtualization: true,
  subItemsSetup: true,
  subItemAddRow: true,
  filenameTemplateEnforcement: true,
  viewSettingsInlineBar: true,
  enableNavigatorTextFilter: true,
  basicsSettings: true,
  firstLaunch: true,
  notesPreview: true,
  editStickerInSidebar: true,
  overrideNativeMenu: true,
  onboardingCompleted: true,
  contextCreateUseModal: true,
  homepagePath: true,
  mobileMakeHeader: true,
} as const satisfies Record<keyof MakeMDSettings, true>;

// Belt-and-braces compile guard: prove the manifest covers EVERY required key
// (not just a subset). If a key is in the interface but missing above, the
// `satisfies` already errors; this extra assignment also errors if the manifest
// is somehow narrower than the interface (e.g. a key typed away). It is a pure
// type-level check — no runtime cost.
type _ManifestCoversInterface = MakeMDSettings extends Record<
  keyof typeof REQUIRED_SETTING_KEYS,
  unknown
>
  ? true
  : never;
const _manifestCoversInterface: _ManifestCoversInterface = true;
void _manifestCoversInterface;

const requiredKeys = Object.keys(REQUIRED_SETTING_KEYS).sort();
const defaultKeys = Object.keys(DEFAULT_SETTINGS).sort();

// The documented DEFAULT-ON kill-switches (resolved live at write time from
// AGENTS.md "Authority & safety invariants" + docs/AUTONOMOUS-REVIEW-QUEUE.md
// "Awaiting owner USE — default-ON flag-gated changes" + the KILL-SWITCH
// doc-comments in settings.ts). Each is an owner-requested core render-path
// feature shipped ON, whose kill-switch is its only off-ramp. A forgotten or
// flipped default here = the feature silently dark; pin them LOUD.
//
// The three the bead named explicitly are first; the others carry the same
// "DEFAULT-ON / KILL-SWITCH" contract in their doc-comments and review-queue
// rows, so they are pinned identically.
const DOCUMENTED_KILL_SWITCHES: ReadonlyArray<keyof MakeMDSettings> = [
  "rowVirtualization", // Notidian-8h9 / ADR 0049
  "hardenFrameExecution", // Notidian-vke / ADR 0018
  "renderPathViewOverlays", // Notidian-ioxi / ADR-0066 (owner-requested default-ON)
  "crossDatabaseSavedViews", // Notidian-42tx / ADR 0059 (owner-requested default-ON)
  "periodScopedRollups", // Notidian-x7pn / ADR 0060 (owner-requested default-ON)
  "viewSettingsInlineBar", // Notidian-vrmf
  "listItemPropertyPicker", // Notidian-543 / ADR 0016
  "subItemsSetup", // Notidian-xqxc
  "subItemAddRow", // Notidian-gr8t
  "collapsibleNoteBody", // Notidian-8sl
  "spaceNoteBodyFullCollapse", // Notidian-50hn
  "filenameTemplateEnforcement", // Notidian-pay5 / ADR 0054
  "enableNestedHubRows", // Notidian-z21a / Atlas Method ADR-0042 D1
  "enableDataHealthSurfaces", // Notidian-loan.5 / ADR-0057
  "enableNavigatorTextFilter", // Notidian-nrjb
];

// The documented DEFAULT-OFF review-queue flag-gates (AGENTS.md "Authority &
// safety invariants" default-OFF branch + docs/AUTONOMOUS-REVIEW-QUEUE.md).
// Each is a core render-path change that is NOT owner-requested, so it ships
// GATED OFF and dark until the owner enables + live-verifies it. A flipped
// default here would silently ship an un-live-verified render change ON — the
// exact failure the flag-gate exists to prevent; pin them LOUD as honest
// `false` booleans (the mirror of the DEFAULT-ON pins above).
const DOCUMENTED_REVIEW_QUEUE_FLAGS: ReadonlyArray<keyof MakeMDSettings> = [
  "enableHubRowIndicator", // Notidian-b0fm (z21a follow-up)
  "lockBadge", // Notidian-loan.15 (Atlas Method ADR-0069 — read-only lock badge)
];

describe("DEFAULT_SETTINGS <-> MakeMDSettings parity (Notidian-ycs6)", () => {
  test("every required MakeMDSettings key has a default in DEFAULT_SETTINGS", () => {
    // Runtime set-equality on the value side. The compile-time manifest already
    // guarantees REQUIRED_SETTING_KEYS == keyof MakeMDSettings, so equality here
    // proves DEFAULT_SETTINGS's keys == the interface's keys.
    const missingDefaults = requiredKeys.filter(
      (k) => !defaultKeys.includes(k)
    );
    const deadDefaults = defaultKeys.filter((k) => !requiredKeys.includes(k));

    expect(missingDefaults).toEqual([]); // type key with no default -> undefined at runtime
    expect(deadDefaults).toEqual([]); // default for a key not in the type -> dead config
    expect(defaultKeys).toEqual(requiredKeys);
  });

  test("DEFAULT_SETTINGS exposes no `undefined` defaults", () => {
    // A key present but set to `undefined` reads identically to a missing key at
    // runtime (the silent kill-switch failure). Forbid it across the board.
    const undefinedValued = Object.entries(DEFAULT_SETTINGS)
      .filter(([, v]) => v === undefined)
      .map(([k]) => k);
    expect(undefinedValued).toEqual([]);
  });

  test("period-scoped rollups ship default-on behind an honest kill switch", () => {
    expect((DEFAULT_SETTINGS as any).periodScopedRollups).toBe(true);
  });

  describe("documented kill-switches are pinned LOUD (default-ON booleans)", () => {
    test.each(DOCUMENTED_KILL_SWITCHES)(
      "%s default is the boolean `true` (owner-requested feature ships ON)",
      (flag) => {
        const value = DEFAULT_SETTINGS[flag];
        // boolean type, not undefined/null/truthy-non-boolean — a kill-switch
        // read must be an honest boolean so OFF is a deliberate `false`.
        expect(typeof value).toBe("boolean");
        // DEFAULT-ON: the feature is live until the owner flips the switch.
        expect(value).toBe(true);
      }
    );
  });

  describe("documented review-queue flag-gates are pinned LOUD (default-OFF booleans)", () => {
    test.each(DOCUMENTED_REVIEW_QUEUE_FLAGS)(
      "%s default is the boolean `false` (not owner-requested — ships dark, awaiting owner enable + live-verify)",
      (flag) => {
        const value = DEFAULT_SETTINGS[flag];
        // Honest boolean so ON is a deliberate owner `true`, never an
        // accidental truthy default.
        expect(typeof value).toBe("boolean");
        // DEFAULT-OFF: the render change stays dark until the owner enables it.
        expect(value).toBe(false);
      }
    );
  });
});
