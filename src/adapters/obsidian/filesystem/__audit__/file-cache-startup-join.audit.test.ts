jest.mock("adapters/obsidian/utils/tags", () => ({
  addTagToProperties: jest.fn(),
  getAllFilesForTag: jest.fn(),
  loadTags: jest.fn(),
  removeTagFromMarkdownFile: jest.fn(),
  renameTagInMarkdownFile: jest.fn(),
}));

jest.mock("main", () => ({}));

jest.mock("makemd-core", () => ({}));

jest.mock("obsidian", () => {
  class TFile {
    constructor(fields: Record<string, unknown>) {
      Object.assign(this, fields);
    }
  }

  class TFolder {
    constructor(fields: Record<string, unknown>) {
      Object.assign(this, { children: [], ...fields });
    }
  }

  return {
    Platform: { isMobile: false },
    TFile,
    TFolder,
    normalizePath: (path: string) => path,
  };
}, { virtual: true });

jest.mock("adapters/mdb/localCache/localCache", () => ({
  LocalStorageCache: jest.fn().mockImplementation(() => ({
    initialize: jest.fn(),
    loadAll: jest.fn(),
    store: jest.fn(),
  })),
}));

jest.mock("adapters/mdb/localCache/localCacheMobile", () => ({
  MobileCachePersister: jest.fn(),
}));

jest.mock("core/schemas/settings", () => ({
  DEFAULT_SETTINGS: {},
}));

jest.mock("core/spaceManager/filesystemAdapter/filesystemAdapter", () => ({
  defaultFocusFile: "focus.md",
}));

jest.mock("core/utils/superstate/parser", () => ({
  parsePathState: (cache: string) => JSON.parse(cache),
}));

jest.mock("shared/pluginIdentity", () => ({
  pluginDataPath: (...parts: string[]) => parts.join("/"),
  pluginDisplayName: "Notidian",
}));

jest.mock("utils/hide", () => ({
  excludePathPredicate: jest.fn(() => false),
}));

jest.mock("../../utils/file", () => ({
  getAbstractFileAtPath: jest.fn(),
  getAllAbstractFilesInVault: jest.fn(),
  tFileToAFile: jest.fn((file: any) =>
    file
      ? {
          isFolder: Boolean(file.isFolder),
          name: file.isFolder ? file.name : file.basename,
          filename: file.name,
          path: file.path,
          parent: file.parent?.path,
          extension: file.extension,
          ...file.stat,
        }
      : null
  ),
}));

import { ObsidianFileSystem } from "../filesystem";

const obsidian = jest.requireMock("obsidian");
const fileUtils = jest.requireMock("../../utils/file");

describe("ObsidianFileSystem.loadCacheFromObsidianCache startup join", () => {
  it("merges persisted file cache by path without using repeated Array.find lookups", async () => {
    const parent = new obsidian.TFolder({
      isFolder: true,
      name: "Folder",
      path: "Folder",
    });
    const file = new obsidian.TFile({
      basename: "a",
      extension: "md",
      isFolder: false,
      name: "a.md",
      parent,
      path: "Folder/a.md",
      stat: { ctime: 20, mtime: 30 },
    });
    const persistedRows = [
      {
        path: "Folder/a.md",
        cache: JSON.stringify({
          ctime: 10,
          label: {
            color: "green",
            sticker: "emoji//seedling",
            thumbnail: "thumb.png",
          },
          metadata: { persisted: true },
          tags: ["hardware"],
        }),
      },
    ] as any[];
    persistedRows.find = jest.fn(() => {
      throw new Error("startup cache join should not call Array.find");
    }) as any;

    fileUtils.getAllAbstractFilesInVault.mockReturnValue([file]);
    fileUtils.getAbstractFileAtPath.mockReturnValue(file);

    const plugin = {
      app: {
        vault: {
          configDir: ".obsidian",
          on: jest.fn(),
        },
      },
      mdbFileAdapter: {},
      registerEvent: jest.fn(),
      superstate: {
        initialize: jest.fn(),
        settings: {},
        ui: { notify: jest.fn() },
      },
    } as any;
    const middleware = {
      createFileCache: jest.fn().mockResolvedValue(undefined),
      eventDispatch: { dispatchEvent: jest.fn() },
    } as any;
    const filesystem = new ObsidianFileSystem(plugin, middleware, ".notidian");
    filesystem.persister = {
      initialize: jest.fn(),
      loadAll: jest.fn().mockResolvedValue(persistedRows),
      store: jest.fn(),
    } as any;

    await filesystem.loadCacheFromObsidianCache();

    expect(persistedRows.find).not.toHaveBeenCalled();
    expect(filesystem.cache.get("Folder/a.md")).toEqual(
      expect.objectContaining({
        ctime: 10,
        metadata: { persisted: true },
        tags: ["hardware"],
        label: expect.objectContaining({
          color: "green",
          name: "a",
          sticker: "emoji//seedling",
          thumbnail: "thumb.png",
        }),
      })
    );
    expect(middleware.createFileCache).toHaveBeenCalledWith("Folder/a.md");
  });
});
