jest.mock("main", () => ({}));
jest.mock("obsidian", () => ({ Platform: { isMobile: false } }), { virtual: true });
jest.mock("pica", () => ({
  __esModule: true,
  default: jest.fn(() => ({})),
}));

import { ImageFileTypeAdapter } from "adapters/image/imageAdapter";
import { hashCode } from "core/utils/hash";
import { FilesystemMiddleware } from "./filesystem";

type Deferred = {
  promise: Promise<void>;
  resolve: () => void;
};

const deferred = (): Deferred => {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
};

describe("FilesystemMiddleware derived thumbnail queue", () => {
  it("orders a stale image write, invalidation delete, existence check, and fresh write", async () => {
    const staleWrite = deferred();
    const deleteGate = deferred();
    const operations: string[] = [];
    const primary = {
      cache: new Map(),
      initiate: jest.fn(),
      writeBinaryToFile: jest.fn()
        .mockImplementationOnce(() => {
          operations.push("write-stale");
          return staleWrite.promise;
        })
        .mockImplementationOnce(() => {
          operations.push("write-fresh");
          return Promise.resolve();
        }),
      deleteFile: jest.fn(() => {
        operations.push("delete");
        return deleteGate.promise;
      }),
      fileExists: jest.fn(() => {
        operations.push("exists");
        return Promise.resolve(false);
      }),
    } as any;
    const middleware = FilesystemMiddleware.create();
    middleware.initiateFileSystemAdapter(primary, true);
    middleware.initiateFiletypeAdapter(new ImageFileTypeAdapter({} as any));
    const source = "Photos/Race.png";
    const derived = `.notidian/thumbnails/${hashCode(source)}.png`;
    const staleGeneration = middleware.beginPathGeneration(source);

    expect(middleware.writeDerivedCacheFile).toBeDefined();
    expect(middleware.derivedCacheFileExists).toBeDefined();
    const stale = middleware.writeDerivedCacheFile(
      derived,
      new ArrayBuffer(1),
      source,
      staleGeneration,
    );
    while (operations.length === 0) await Promise.resolve();
    expect(operations).toEqual(["write-stale"]);
    middleware.invalidatePath(source);
    const freshGeneration = middleware.beginPathGeneration(source);
    const fresh = (async () => {
      expect(await middleware.derivedCacheFileExists(derived)).toBe(false);
      await middleware.writeDerivedCacheFile(
        derived,
        new ArrayBuffer(2),
        source,
        freshGeneration,
      );
    })();

    staleWrite.resolve();
    await stale;
    while (!operations.includes("delete")) await Promise.resolve();
    expect(operations).toEqual(["write-stale", "delete"]);
    deleteGate.resolve();
    await fresh;

    expect(operations).toEqual(["write-stale", "delete", "exists", "write-fresh"]);
    expect(primary.deleteFile).toHaveBeenCalledWith(derived);
    expect(primary.writeBinaryToFile).toHaveBeenLastCalledWith(derived, expect.any(ArrayBuffer));
  });

  it("continues derived operations after a rejected queued write", async () => {
    const operations: string[] = [];
    const primary = {
      cache: new Map(),
      initiate: jest.fn(),
      writeBinaryToFile: jest.fn()
        .mockImplementationOnce(() => {
          operations.push("write-rejected");
          return Promise.reject(new Error("write failed"));
        })
        .mockImplementationOnce(() => {
          operations.push("write-fresh");
          return Promise.resolve();
        }),
      deleteFile: jest.fn(() => {
        operations.push("delete");
        return Promise.resolve();
      }),
    } as any;
    const middleware = FilesystemMiddleware.create();
    middleware.initiateFileSystemAdapter(primary, true);
    const derived = ".notidian/thumbnails/123.png";

    expect(middleware.writeDerivedCacheFile).toBeDefined();
    const rejected = middleware.writeDerivedCacheFile(derived, new ArrayBuffer(1));
    const deletion = middleware.deleteDerivedCacheFile(derived);
    const fresh = middleware.writeDerivedCacheFile(derived, new ArrayBuffer(2));

    await expect(rejected).rejects.toThrow("write failed");
    await expect(deletion).resolves.toBeUndefined();
    await expect(fresh).resolves.toBeUndefined();
    expect(operations).toEqual(["write-rejected", "delete", "write-fresh"]);
  });
});
