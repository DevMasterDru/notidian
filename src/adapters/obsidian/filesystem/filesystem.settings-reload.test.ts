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
  LocalStorageCache: jest.fn().mockImplementation(() => ({})),
}));
jest.mock("adapters/mdb/localCache/localCacheMobile", () => ({
  MobileCachePersister: jest.fn(),
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

describe("ObsidianFileSystem external settings reload", () => {
  it("sanitizes a corrupt truthy dateReminders value before dispatch", async () => {
    const dispatchEvent = jest.fn();
    const plugin = {
      app: {
        vault: {
          adapter: {
            stat: jest.fn().mockResolvedValue({ mtime: 10 }),
          },
          configDir: ".obsidian",
        },
      },
      loadData: jest.fn().mockResolvedValue({ dateReminders: "true" }),
      mdbFileAdapter: {},
      superstate: {
        settings: { spaceSubFolder: ".notidian", dateReminders: false },
        dispatchEvent,
      },
    } as any;
    const filesystem = new ObsidianFileSystem(
      plugin,
      { eventDispatch: { dispatchEvent: jest.fn() } } as any,
      ".notidian",
    );

    await filesystem.onRaw(".obsidian/data.json");

    expect(plugin.superstate.settings.dateReminders).toBe(false);
    expect(dispatchEvent).toHaveBeenCalledWith("settingsChanged", null);
  });
});
