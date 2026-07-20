// Notidian-4gjx: the disjoint halves proving the physical-delete chain are
// filesystem.delete-invalidation.test.ts (real ObsidianFileSystem -> real
// FilesystemMiddleware.onDelete) and
// core/spaceManager/filesystemAdapter/filesystemAdapter.test.ts:77-92
// (middleware.onDelete manually dispatched -> real FilesystemSpaceAdapter ->
// spaceManager.onPathDeleted, with spaceManager itself stubbed). Neither
// proves the FULL chain: a real vault "delete" callback reaching
// Superstate.onPathDeleted through the real ObsidianFileSystem, the real
// FilesystemMiddleware, the real FilesystemSpaceAdapter, and the real
// (thin, pass-through) SpaceManager. This suite wires all four for real and
// spies only on the terminal superstate.onPathDeleted call.
jest.mock("adapters/obsidian/utils/tags", () => ({}));
jest.mock("main", () => ({}));
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
jest.mock("../filetypes/frontmatter/fm", () => ({
  getAllFrontmatterKeys: jest.fn((): string[] => []),
}));
jest.mock("../utils/file", () => ({
  getAbstractFileAtPath: jest.fn(),
  getAllAbstractFilesInVault: jest.fn((): unknown[] => []),
  tFileToAFile: jest.fn((file: any) => file ? ({
    ctime: file.stat?.ctime ?? 0,
    extension: file.extension,
    filename: file.name,
    isFolder: false,
    name: file.basename,
    parent: file.parent?.path ?? "/",
    path: file.path,
  }) : null),
}));
jest.mock("shared/pluginIdentity", () => ({
  pluginDataPath: (...parts: string[]) => parts.join("/"),
  pluginDisplayName: "Notidian",
}));
jest.mock("utils/hide", () => ({
  excludePathPredicate: jest.fn(() => false),
}));

// Deliberately NOT mocked: "core/spaceManager/filesystemAdapter/filesystemAdapter"
// (the real FilesystemSpaceAdapter is exactly what this suite proves is wired
// up) and "core/spaceManager/spaceManager" (the real, thin pass-through
// SpaceManager whose own onPathDeleted forwards straight to
// this.superstate.onPathDeleted -- the call this suite spies on).
import { FilesystemMiddleware } from "core/middleware/filesystem";
import { FilesystemSpaceAdapter } from "core/spaceManager/filesystemAdapter/filesystemAdapter";
import { SpaceManager } from "core/spaceManager/spaceManager";
import { ObsidianFileSystem } from "./filesystem";

const flushUntil = async (predicate: () => boolean, turns = 20) => {
  for (let turn = 0; turn < turns && !predicate(); turn += 1) {
    await Promise.resolve();
  }
};

const file = (basename = "Race", path = "Race.md") => ({
  basename,
  extension: "md",
  name: path.split("/").pop() ?? `${basename}.md`,
  parent: { path: "/" },
  path,
  stat: { ctime: 10, mtime: 20 },
});

const harness = () => {
  const deletedFile = file();
  const plugin = {
    app: {
      metadataCache: {},
      fileManager: { renameFile: jest.fn(async (): Promise<void> => undefined) },
      vault: {
        getAbstractFileByPath: jest.fn(() => deletedFile),
        delete: jest.fn(async (): Promise<void> => undefined),
        trash: jest.fn(async (): Promise<void> => undefined),
      },
    },
    mdbFileAdapter: {},
    superstate: { settings: { deleteFileOption: "permanent" } },
  } as any;

  const middleware = FilesystemMiddleware.create();
  const filesystem = new ObsidianFileSystem(plugin, middleware, ".notidian");
  filesystem.persister = {
    remove: jest.fn().mockResolvedValue(undefined),
    store: jest.fn().mockResolvedValue(undefined),
  } as any;
  middleware.initiateFileSystemAdapter(filesystem, true);

  // Real FilesystemSpaceAdapter, wired onto the same middleware event bus
  // ObsidianFileSystem publishes onto -- production's exact composition
  // (see FilesystemSpaceAdapter's constructor, filesystemAdapter.ts:48-56).
  const adapter = new FilesystemSpaceAdapter(middleware, ".notidian");

  // Real SpaceManager: production's onPathDeleted is a one-line
  // pass-through to `this.superstate.onPathDeleted` (spaceManager.ts:81-83).
  // Only `superstate` itself is a stub, so the spy below is on the exact
  // production call, not a hand-rolled substitute for it.
  const spaceManager = new SpaceManager();
  const onPathDeleted = jest.fn().mockResolvedValue(undefined);
  spaceManager.superstate = {
    onPathDeleted,
    // FilesystemSpaceAdapter.onPathInvalidated (filesystemAdapter.ts:59-62)
    // forwards the parallel invalidation dispatch here; stub it so that
    // independent path is clean rather than incidentally failing.
    invalidatePath: jest.fn(),
  } as any;
  adapter.initiateAdapter(spaceManager);

  return { adapter, deletedFile, filesystem, middleware, onPathDeleted, plugin };
};

describe("Full physical-delete chain (ObsidianFileSystem -> FilesystemMiddleware -> FilesystemSpaceAdapter -> SpaceManager -> superstate.onPathDeleted)", () => {
  it("reaches superstate.onPathDeleted when the real vault-delete callback fires for a real file", async () => {
    const { deletedFile, filesystem, onPathDeleted } = harness();

    // onVaultDelete is the literal callback Obsidian registers against the
    // real vault "delete" event (filesystem.ts:226:
    // `this.plugin.app.vault.on("delete", this.onVaultDelete)`), so invoking
    // it directly is a physically-triggered vault delete event, not a
    // synthetic shortcut into some other layer.
    filesystem.onVaultDelete(deletedFile as any);
    await flushUntil(() => onPathDeleted.mock.calls.length > 0);

    expect(onPathDeleted).toHaveBeenCalledTimes(1);
    expect(onPathDeleted).toHaveBeenCalledWith("Race.md");
    // Confirms the real ObsidianFileSystem's own cleanup ran too, not just a
    // pass-through stub standing in for it.
    expect(filesystem.persister.remove).toHaveBeenCalledWith("Race.md", "file");
  });
});
