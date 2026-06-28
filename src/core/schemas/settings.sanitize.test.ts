import { sanitizeNotidianSettings } from "./settings";

describe("sanitizeNotidianSettings", () => {
  it("forces saved cacheIndex=true off so cold startup cannot enter the warm-cache crash path", () => {
    const settings = sanitizeNotidianSettings({
      cacheIndex: true,
      spaceSubFolder: ".notidian",
    });

    expect(settings.cacheIndex).toBe(false);
  });

  it("normalizes retired storage roots while preserving ordinary saved settings", () => {
    const settings = sanitizeNotidianSettings({
      cacheIndex: true,
      navigatorEnabled: false,
      spaceSubFolder: ".space",
    });

    expect(settings.navigatorEnabled).toBe(false);
    expect(settings.spaceSubFolder).toBe(".notidian");
    expect(settings.cacheIndex).toBe(false);
  });
});
