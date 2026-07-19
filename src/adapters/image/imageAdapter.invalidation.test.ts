jest.mock("main", () => ({}));
jest.mock("obsidian", () => ({ Platform: { isMobile: false } }), { virtual: true });
jest.mock("pica", () => ({
  __esModule: true,
  default: jest.fn(() => ({})),
}));

import { hashCode } from "core/utils/hash";
import { ImageFileTypeAdapter } from "./imageAdapter";

describe("ImageFileTypeAdapter deletion invalidation", () => {
  it("purges its cache and only requests deletion of the derived thumbnail", () => {
    const adapter = new ImageFileTypeAdapter({} as any);
    const deleteDerivedCacheFile = jest.fn().mockResolvedValue(undefined);
    adapter.initiate({ deleteDerivedCacheFile } as any);
    adapter.cache.set("Photos/Race.png", { stale: true } as any);

    adapter.invalidatePath("Photos/Race.png");

    expect(adapter.cache.has("Photos/Race.png")).toBe(false);
    expect(deleteDerivedCacheFile).toHaveBeenCalledWith(
      `.notidian/thumbnails/${hashCode("Photos/Race.png")}.png`,
    );
  });

  it("regenerates after failed derived deletion even when the stale thumbnail still exists", async () => {
    const adapter = new ImageFileTypeAdapter({
      superstate: { settings: { imageThumbnails: true } },
    } as any);
    const middleware = {
      capturePathGeneration: jest.fn(() => 1),
      derivedCacheFileExists: jest.fn().mockResolvedValue(true),
      deleteDerivedCacheFile: jest.fn().mockRejectedValue(new Error("delete failed")),
      isPathGenerationCurrent: jest.fn(() => true),
      getFileCache: jest.fn(() => ({ label: { sticker: "", color: "" } })),
      updateFileCache: jest.fn(),
    };
    adapter.initiate(middleware as any);
    adapter.generateThumbnail = jest.fn().mockResolvedValue(true);
    const error = jest.spyOn(console, "error").mockImplementation(() => undefined);

    adapter.invalidatePath("Photos/Race.png");
    await adapter.parseCache({ path: "Photos/Race.png", name: "Race", extension: "png" } as any, true, 1);

    expect(adapter.generateThumbnail).toHaveBeenCalled();
    error.mockRestore();
  });

  it("regenerates an extant path-hashed thumbnail after restart before publishing it", async () => {
    const adapter = new ImageFileTypeAdapter({
      superstate: { settings: { imageThumbnails: true } },
    } as any);
    const middleware = {
      capturePathGeneration: jest.fn(() => 1),
      derivedCacheFileExists: jest.fn().mockResolvedValue(true),
      isPathGenerationCurrent: jest.fn(() => true),
      getFileCache: jest.fn(() => ({ label: { sticker: "", color: "" } })),
      updateFileCache: jest.fn(),
    };
    adapter.initiate(middleware as any);
    adapter.generateThumbnail = jest.fn().mockResolvedValue(true);

    await adapter.parseCache({ path: "Photos/Race.png", name: "Race", extension: "png" } as any, true, 1);

    expect(adapter.generateThumbnail).toHaveBeenCalledTimes(1);
    expect(middleware.updateFileCache).toHaveBeenCalledWith(
      "Photos/Race.png",
      expect.objectContaining({ preview: { thumbnail: `.notidian/thumbnails/${hashCode("Photos/Race.png")}.png` } }),
      true,
      1,
    );
  });
});
