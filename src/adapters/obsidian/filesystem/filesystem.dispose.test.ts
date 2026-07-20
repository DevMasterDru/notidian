// ===========================================================================
// Notidian-043x -- the LocalStorageCache persister ObsidianFileSystem
// constructs at filesystem.ts:111 (".notidian/fileCache.mdc") was never
// disposed on plugin unload: main.ts's onunload() tore down other
// subsystems (settings listeners, reminder delivery, reconciler,
// this.superstate.persister) but never touched this.obsidianAdapter's own
// persister. A stale instance's debounced flush then kept firing after
// plugin:reload, racing the freshly reloaded instance's writes to the same
// path.
//
// ObsidianFileSystem.unload() is the wiring point: it must call
// this.persister.unload() so the plugin's onunload -> obsidianAdapter.unload()
// chain reaches the persister's dispose logic.
// ===========================================================================

jest.mock("adapters/obsidian/utils/tags", () => ({}));
jest.mock("main", () => ({}));
jest.mock("makemd-core", () => ({}));
jest.mock("obsidian", () => ({
  Platform: { isMobile: false },
  TFile: class {},
  TFolder: class {},
  normalizePath: (path: string) => path,
}), { virtual: true });
jest.mock("adapters/mdb/localCache/localCache", () => ({
  LocalStorageCache: jest.fn().mockImplementation(() => ({ unload: jest.fn() })),
}));
jest.mock("adapters/mdb/localCache/localCacheMobile", () => ({
  MobileCachePersister: jest.fn().mockImplementation(() => ({ unload: jest.fn() })),
}));
jest.mock("core/spaceManager/filesystemAdapter/filesystemAdapter", () => ({
  defaultFocusFile: "focus.md",
}));
jest.mock("../filetypes/frontmatter/fm", () => ({
  getAllFrontmatterKeys: jest.fn((): string[] => []),
}));
jest.mock("../utils/file", () => ({
  getAbstractFileAtPath: jest.fn(),
  getAllAbstractFilesInVault: jest.fn((): unknown[] => []),
  tFileToAFile: jest.fn(),
}));
jest.mock("shared/pluginIdentity", () => ({
  isLegacyStorageRoot: jest.fn(() => false),
  pluginDataPath: (...parts: string[]) => parts.join("/"),
  pluginDisplayName: "Notidian",
  pluginStorageRoot: ".notidian",
}));

import { ObsidianFileSystem } from "./filesystem";

const makePlugin = () =>
  ({
    app: {
      vault: {
        adapter: {
          stat: jest.fn().mockResolvedValue({ mtime: 10 }),
        },
        configDir: ".obsidian",
      },
    },
    loadData: jest.fn().mockResolvedValue({}),
    mdbFileAdapter: {},
    superstate: {
      settings: { spaceSubFolder: ".notidian" },
      dispatchEvent: jest.fn(),
    },
  } as any);

describe("Notidian-043x: ObsidianFileSystem.unload disposes its persister", () => {
  it("calls persister.unload() exactly once", () => {
    const filesystem = new ObsidianFileSystem(
      makePlugin(),
      { eventDispatch: { dispatchEvent: jest.fn() } } as any,
      ".notidian",
    );

    filesystem.unload();

    expect(filesystem.persister.unload).toHaveBeenCalledTimes(1);
  });
});
