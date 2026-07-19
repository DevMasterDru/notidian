jest.mock("main", () => ({}));
jest.mock("makemd-core", () => ({}));
jest.mock("obsidian", () => ({
  Platform: { isMobile: false },
  TFile: class {},
  TFolder: class {},
}), { virtual: true });
jest.mock("core/export/styleAst/generateStyleAst", () => ({ generateStyleAst: jest.fn() }));
jest.mock("core/export/toHtml/spaceToHtml", () => ({ noteToHtml: jest.fn(), spaceToHtml: jest.fn() }));
jest.mock("core/export/treeToAst/treeToHast", () => ({ hyphenate: jest.fn() }));
jest.mock("./frontmatter/fm", () => ({ frontMatterForFile: jest.fn() }));
jest.mock("./frontmatter/frontMatterKeys", () => ({ frontMatterKeys: jest.fn() }));
jest.mock("../utils/file", () => ({ getAbstractFileAtPath: jest.fn(), tFileToAFile: jest.fn() }));

import { hashCode } from "core/utils/hash";
import { ObsidianMarkdownFiletypeAdapter } from "./markdownAdapter";

describe("ObsidianMarkdownFiletypeAdapter deletion invalidation", () => {
  it("purges link and freshness state and requests only its derived thumbnail deletion", () => {
    const adapter = new ObsidianMarkdownFiletypeAdapter({ app: {} } as any);
    const deleteDerivedCacheFile = jest.fn().mockResolvedValue(undefined);
    adapter.initiate({ deleteDerivedCacheFile } as any);
    adapter.cache.set("Notes/Race.md", { stale: true } as any);
    adapter.thumbnailFreshCache.set("Notes/Race.md", true);
    (adapter as any).linksMap.set("Notes/Race.md", new Set(["Target.md"]));

    adapter.invalidatePath("Notes/Race.md");

    expect(adapter.cache.has("Notes/Race.md")).toBe(false);
    expect(adapter.thumbnailFreshCache.has("Notes/Race.md")).toBe(false);
    expect((adapter as any).linksMap.get("Notes/Race.md").size).toBe(0);
    expect(deleteDerivedCacheFile).toHaveBeenCalledWith(
      `.notidian/thumbnails/${hashCode("Notes/Race.md")}.jpeg`,
    );
  });

  it("rejects lingering metadata for a deleted incarnation but accepts a real recreation", async () => {
    const DeletedFile = (jest.requireMock("obsidian") as any).TFile;
    const deleted = Object.assign(new DeletedFile(), { path: "Notes/Race.md" });
    const recreated = Object.assign(new DeletedFile(), { path: "Notes/Race.md" });
    (jest.requireMock("../utils/file") as any).tFileToAFile.mockImplementation(
      (candidate: any) => ({ path: candidate.path }),
    );
    let current: unknown = undefined;
    const adapter = new ObsidianMarkdownFiletypeAdapter({
      app: { vault: { getAbstractFileByPath: jest.fn(() => current) } },
    } as any);
    adapter.initiate({} as any);
    adapter.parseCache = jest.fn().mockResolvedValue(undefined);

    current = undefined;
    await adapter.metadataChange(deleted);
    current = recreated;
    await adapter.metadataChange(recreated);

    expect(adapter.parseCache).toHaveBeenCalledTimes(1);
    expect(adapter.parseCache).toHaveBeenCalledWith(expect.objectContaining({ path: "Notes/Race.md" }), true);
  });

  it("does not publish an extant path-hashed note thumbnail as fresh after restart", async () => {
    const updateFileCache = jest.fn();
    const adapter = new ObsidianMarkdownFiletypeAdapter({
      app: {
        metadataCache: {
          getCache: jest.fn(() => ({
            frontmatter: {},
            links: [] as Array<{ link: string }>,
            frontmatterLinks: [] as Array<{ link: string }>,
          })),
          resolvedLinks: {},
          getFirstLinkpathDest: jest.fn(),
        },
        vault: {},
      },
      superstate: {
        settings: {
          fmKeyBanner: "banner",
          fmKeySticker: "sticker",
          fmKeyColor: "color",
          noteThumbnails: true,
          notesPreview: false,
        },
      },
    } as any);
    adapter.initiate({
      capturePathGeneration: jest.fn(() => 1),
      isPathGenerationCurrent: jest.fn(() => true),
      derivedCacheFileExists: jest.fn().mockResolvedValue(true),
      updateFileCache,
    } as any);

    await adapter.parseCache({ path: "Notes/Race.md", name: "Race" } as any, true, 1);

    expect(updateFileCache.mock.calls[0][1].label.thumbnail).toBeUndefined();
    expect(adapter.thumbnailFreshCache.has("Notes/Race.md")).toBe(false);
  });

  it("refuses a frontmatter mutation when the exact source TFile was recreated at the same path", async () => {
    const SourceFile = (jest.requireMock("obsidian") as any).TFile;
    const original = Object.assign(new SourceFile(), { path: "Notes/Race.md" });
    const recreated = Object.assign(new SourceFile(), { path: "Notes/Race.md" });
    const processFrontMatter = jest.fn();
    const adapter = new ObsidianMarkdownFiletypeAdapter({
      app: {
        vault: { getAbstractFileByPath: jest.fn(() => recreated) },
        fileManager: { processFrontMatter },
      },
    } as any);

    await expect(adapter.saveContent(
      { path: "Notes/Race.md", obsidianFile: original } as any,
      "property",
      null as any,
      current => ({ ...current, relation: "[[New.md]]" }),
    )).resolves.toBe(false);

    expect(processFrontMatter).not.toHaveBeenCalled();
  });

  it("does not mutate a label when recreation occurs inside the frontmatter callback", async () => {
    const SourceFile = (jest.requireMock("obsidian") as any).TFile;
    const original = Object.assign(new SourceFile(), { path: "Notes/Race.md" });
    const recreated = Object.assign(new SourceFile(), { path: "Notes/Race.md" });
    let current = original;
    const frontmatter: Record<string, unknown> = {};
    const adapter = new ObsidianMarkdownFiletypeAdapter({
      app: {
        vault: { getAbstractFileByPath: jest.fn(() => current) },
        fileManager: { processFrontMatter: jest.fn(async (_file, callback) => {
          current = recreated;
          callback(frontmatter);
        }) },
      },
      superstate: { settings: { fmKeyAlias: "aliases" } },
    } as any);

    await expect(adapter.saveContent(
      { path: original.path, obsidianFile: original } as any,
      "label", "name", () => "Changed",
    )).resolves.toBe(false);
    expect(frontmatter).toEqual({});
  });

  it("reports a delete as stale when recreation occurs after its callback settles", async () => {
    const SourceFile = (jest.requireMock("obsidian") as any).TFile;
    const original = Object.assign(new SourceFile(), { path: "Notes/Race.md" });
    const recreated = Object.assign(new SourceFile(), { path: "Notes/Race.md" });
    let current = original;
    const originalFrontmatter: Record<string, unknown> = { relation: "old" };
    const recreatedFrontmatter: Record<string, unknown> = { relation: "new" };
    const adapter = new ObsidianMarkdownFiletypeAdapter({
      app: {
        vault: { getAbstractFileByPath: jest.fn(() => current) },
        fileManager: { processFrontMatter: jest.fn(async (_file, callback) => {
          callback(originalFrontmatter);
          current = recreated;
        }) },
      },
    } as any);

    await expect(adapter.deleteContent(
      { path: original.path, obsidianFile: original } as any, "property", "relation",
    )).resolves.toBe(false);
    expect(recreatedFrontmatter).toEqual({ relation: "new" });
  });
});
