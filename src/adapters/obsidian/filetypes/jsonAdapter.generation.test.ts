jest.mock("main", () => ({}));
jest.mock("obsidian", () => ({}), { virtual: true });

import { FilesystemMiddleware } from "core/middleware/filesystem";
import { JSONFiletypeAdapter } from "./jsonAdapter";

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
};

const deferred = <T,>(): Deferred<T> => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

describe("JSONFiletypeAdapter generation capture", () => {
  it("captures an omitted generation before awaiting text", async () => {
    const readGate = deferred<string>();
    const updateFileCache = jest.fn();
    const primary = {
      cache: new Map(),
      getFileCache: jest.fn(() => ({ label: {} })),
      initiate: jest.fn(),
      readTextFromFile: jest.fn(() => readGate.promise),
      updateFileCache,
    } as any;
    const middleware = FilesystemMiddleware.create();
    middleware.initiateFileSystemAdapter(primary, true);
    const adapter = new JSONFiletypeAdapter({
      superstate: { settings: { spaceSubFolder: ".notidian" } },
    } as any);
    middleware.initiateFiletypeAdapter(adapter);
    const file = {
      extension: "json",
      isFolder: false,
      name: "Race",
      parent: "/",
      path: "Race.json",
    } as any;

    const parse = adapter.parseCache(file, true);
    expect(primary.readTextFromFile).toHaveBeenCalledWith("Race.json");
    middleware.invalidatePath("Race.json");
    readGate.resolve('{"label":{"name":"stale"}}');
    await parse;

    expect(adapter.cache.has("Race.json")).toBe(false);
    expect(updateFileCache).not.toHaveBeenCalled();
  });

  it("refuses to route source files through the derived-cache deletion API", async () => {
    const deleteFile = jest.fn();
    const middleware = FilesystemMiddleware.create();
    middleware.initiateFileSystemAdapter({ initiate: jest.fn(), deleteFile } as any, true);

    await expect(middleware.deleteDerivedCacheFile("Notes/Source.md")).rejects.toThrow(
      "Refusing to delete non-thumbnail cache path",
    );
    expect(deleteFile).not.toHaveBeenCalled();
  });

  it.each([
    ".notidian/thumbnails/../../Notes/Source.md",
    "/.notidian/thumbnails/thumb.jpeg",
    "//.notidian/thumbnails/thumb.jpeg",
    ".notidian//thumbnails/thumb.jpeg",
    ".notidian/thumbnails//thumb.jpeg",
    ".notidian/thumbnails/./thumb.jpeg",
    ".notidian/thumbnails/../thumb.jpeg",
    ".notidian/thumbnails/thumb\\evil.jpeg",
    ".notidian/thumbnails/thumb\0evil.jpeg",
    "C:/.notidian/thumbnails/thumb.jpeg",
  ])("refuses unsafe derived-cache path %p", async (path) => {
    const deleteFile = jest.fn();
    const middleware = FilesystemMiddleware.create();
    middleware.initiateFileSystemAdapter({ initiate: jest.fn(), deleteFile } as any, true);

    await expect(middleware.deleteDerivedCacheFile(path)).rejects.toThrow(
      "Refusing to delete non-thumbnail cache path",
    );
    expect(deleteFile).not.toHaveBeenCalled();
  });

  it("passes only a validated canonical derived path to the adapter", async () => {
    const deleteFile = jest.fn().mockResolvedValue(undefined);
    const middleware = FilesystemMiddleware.create();
    middleware.initiateFileSystemAdapter({ initiate: jest.fn(), deleteFile } as any, true);

    await middleware.deleteDerivedCacheFile(".notidian/thumbnails/thumb.jpeg");

    expect(deleteFile).toHaveBeenCalledWith(".notidian/thumbnails/thumb.jpeg");
  });
});
