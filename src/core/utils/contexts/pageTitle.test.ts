import { PathPropertyName } from "shared/types/context";
import {
  buildPageTitleRename,
  pageTitleFromPath,
  validatePageTitle,
} from "./pageTitle";
import { planBulkPageTitleRename } from "./pageTitleRename";

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

  it("trims valid page title edits before building the target path", () => {
    expect(buildPageTitleRename("Root Note.md", "  Root Note 2")).toEqual({
      oldPath: "Root Note.md",
      newPath: "Root Note 2.md",
      title: "Root Note 2",
    });
  });

  it("rejects unsafe filesystem titles with typed reasons", () => {
    expect(validatePageTitle("")).toEqual({ ok: false, reason: "empty" });
    expect(validatePageTitle("   ")).toEqual({ ok: false, reason: "empty" });
    expect(validatePageTitle("Other/Name")).toEqual({
      ok: false,
      reason: "slash",
    });
    expect(validatePageTitle("a:b")).toEqual({
      ok: false,
      reason: "illegal-characters",
    });
    expect(validatePageTitle("a\\b")).toEqual({
      ok: false,
      reason: "illegal-characters",
    });
    expect(validatePageTitle("a<b")).toEqual({
      ok: false,
      reason: "illegal-characters",
    });
    expect(validatePageTitle("a\u0001b")).toEqual({
      ok: false,
      reason: "illegal-characters",
    });
    expect(validatePageTitle(".")).toEqual({
      ok: false,
      reason: "reserved-name",
    });
    expect(validatePageTitle("..")).toEqual({
      ok: false,
      reason: "reserved-name",
    });
    expect(validatePageTitle("CON")).toEqual({
      ok: false,
      reason: "reserved-name",
    });
    expect(validatePageTitle("PRN")).toEqual({
      ok: false,
      reason: "reserved-name",
    });
    expect(validatePageTitle("NUL")).toEqual({
      ok: false,
      reason: "reserved-name",
    });
    expect(validatePageTitle("trailing.")).toEqual({
      ok: false,
      reason: "trailing-dot-space",
    });
    // A trailing space is forgiven (trimmed), not rejected; a trailing dot is not.
    expect(validatePageTitle("trailing ")).toEqual({
      ok: true,
      title: "trailing",
    });
    expect(validatePageTitle("a".repeat(256))).toEqual({
      ok: false,
      reason: "too-long",
    });
  });

  it("accepts legal unicode and long page titles", () => {
    expect(validatePageTitle("שלום")).toEqual({ ok: true, title: "שלום" });
    expect(validatePageTitle("בדיקה עברית")).toEqual({
      ok: true,
      title: "בדיקה עברית",
    });
    expect(validatePageTitle("Project 🚀")).toEqual({
      ok: true,
      title: "Project 🚀",
    });
    expect(validatePageTitle("a".repeat(255))).toEqual({
      ok: true,
      title: "a".repeat(255),
    });
  });

  it("detects NFC and NFD duplicate target paths inside the same rename batch", async () => {
    const composed = "Café";
    const decomposed = "Cafe\u0301";

    const result = await planBulkPageTitleRename({
      items: [
        { row: { [PathPropertyName]: "Notes/A.md" }, value: composed },
        { row: { [PathPropertyName]: "Notes/B.md" }, value: decomposed },
      ],
      contextPath: "Notes",
      superstate: {
        spaceManager: {
          pathExists: jest.fn(async (): Promise<boolean> => false),
        },
        ui: { notify: jest.fn() },
      } as any,
    });

    expect(result).toEqual({
      ok: false,
      failures: [
        {
          row: { [PathPropertyName]: "Notes/B.md" },
          value: decomposed,
          reason: "internal-duplicate",
        },
      ],
    });
  });
});
