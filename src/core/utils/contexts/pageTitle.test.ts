import {
  buildPageTitleRename,
  pageTitleFromPath,
  validatePageTitle,
} from "./pageTitle";

describe("page title utilities", () => {
  it("uses the file basename without extension as the display title", () => {
    expect(pageTitleFromPath("Relays & Devices/Veg - Mix Pump.md")).toBe(
      "Veg - Mix Pump"
    );
  });

  it("builds a same-folder target path and preserves the extension", () => {
    expect(
      buildPageTitleRename(
        "Relays & Devices/Veg - Mix Pump.md",
        "Veg - Main Pump"
      )
    ).toEqual({
      oldPath: "Relays & Devices/Veg - Mix Pump.md",
      newPath: "Relays & Devices/Veg - Main Pump.md",
      title: "Veg - Main Pump",
    });
  });

  it("trims page title edits before building the target path", () => {
    expect(buildPageTitleRename("Root Note.md", "  Root Note 2  ")).toEqual({
      oldPath: "Root Note.md",
      newPath: "Root Note 2.md",
      title: "Root Note 2",
    });
  });

  it("rejects empty and path-like titles", () => {
    expect(validatePageTitle("").ok).toBe(false);
    expect(validatePageTitle("   ").ok).toBe(false);
    expect(validatePageTitle("Other/Name").ok).toBe(false);
  });
});
