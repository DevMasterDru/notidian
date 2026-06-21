// ===========================================================================
// REGRESSION (Notidian-ehfz) — the REAL case-fold WRITE SINKS in
// src/adapters/obsidian/utils/tags.ts.
//
// WHY THIS SUITE EXISTS. The Notidian-ehfz fold fix (src/utils/tags.ts) folds
// the incoming tag once and feeds the LOWERCASED fold to every downstream
// surface, including the per-file write sink
// `spaceManager.renameTag(path, folded, newTag)`. The unit tests in
// src/utils/tags.test.ts drive renameTag against a RECORDING fake whose
// spaceManager.renameTag is a pure {path,tag,newTag} recorder — it never
// reaches the live filesystemAdapter -> renameTagForFile ->
// renameTagInMarkdownFile chain, so the two CASE-SENSITIVE sinks the fold
// newly exposes were untested:
//   1. editTagInProperties matched the old tag case-SENSITIVELY, so a folded
//      '#foo' no longer matched a file's case-preserving frontmatter 'Foo' —
//      it fell through to the else branch and APPENDED the new tag while
//      ORPHANING the old one (silent property-store corruption / partial
//      rename). Reviewer findings 1 & 3, both high.
//   2. editTagInFileBody spliced by `oldTag.length`, which for a length-
//      CHANGING Unicode fold (Turkish dotted capital 'İ' U+0130 lowercases to
//      two code units) differs from the raw in-file occupancy, eating an
//      adjacent byte (the trailing space). Reviewer finding 2, medium.
//
// These tests drive the REAL renameTagInMarkdownFile (exported) so both sinks
// execute end-to-end, reproducing each reviewer regression and pinning the fix.
// ===========================================================================

jest.mock("obsidian", () => ({ getAllTags: jest.fn() }), { virtual: true });
jest.mock("main", () => ({ __esModule: true, default: jest.fn() }));
jest.mock("adapters/obsidian/utils/file", () => ({
  getAbstractFileAtPath: jest.fn(),
}));

import { renameTagInMarkdownFile } from "adapters/obsidian/utils/tags";

// ---------------------------------------------------------------------------
// FRONTMATTER sink: build a plugin/manager whose tag lives ONLY in the
// case-preserving frontmatter `tags:` property (no inline body tag), so
// renameTagInMarkdownFile routes through editTagInProperties.
// ---------------------------------------------------------------------------
const makeFrontmatterPlugin = (frontmatter: Record<string, any>) => {
  const file = { path: "Rows/A.md", extension: "md" } as any;
  // No body tags -> positionsForTag returns [] -> editTagInProperties branch.
  const getFileCache = jest.fn(
    () => ({ frontmatter, tags: undefined } as any)
  );
  const app = {
    metadataCache: { getFileCache },
    vault: { getAbstractFileByPath: jest.fn(() => file) },
  };
  const saveProperties = jest.fn(
    async (_path: string, _props: Record<string, any>) => true
  );
  const manager = {
    readProperties: jest.fn(async () => frontmatter),
    saveProperties,
    primarySpaceAdapter: {
      fileSystem: { primary: { plugin: { app } } },
    },
  };
  const plugin = {
    app,
    superstate: { spaceManager: manager },
  } as any;
  return { plugin, file, saveProperties };
};

const waitForSave = async (saveProperties: jest.Mock) => {
  for (let i = 0; i < 20 && saveProperties.mock.calls.length === 0; i += 1) {
    await Promise.resolve();
  }
};

describe("renameTag frontmatter sink — case-fold (Notidian-ehfz findings 1 & 3)", () => {
  it("renames a MIXED-CASE frontmatter array tag against a FOLDED oldTag (no orphan, no duplicate)", async () => {
    // The exact regression: stored 'Foo', renameTag feeds folded '#foo'.
    // Pre-fix: 'foo' != 'Foo' -> else branch -> APPENDED 'renamed' leaving 'Foo'.
    const { plugin, file, saveProperties } = makeFrontmatterPlugin({
      tags: ["Foo"],
    });

    await renameTagInMarkdownFile(plugin, "#foo", "#renamed", file as any);
    await waitForSave(saveProperties);

    // The old mixed-case 'Foo' is REPLACED in place — not orphaned, not doubled.
    expect(saveProperties).toHaveBeenCalledWith("Rows/A.md", {
      tags: ["renamed"],
    });
    // It must NOT have appended a duplicate while keeping the old tag.
    const savedTags = (saveProperties.mock.calls[0]?.[1] as any)?.tags;
    expect(savedTags).not.toContain("Foo");
    expect(savedTags).toHaveLength(1);
  });

  it("renames a mixed-case tag alongside siblings, preserving the array shape and other tags", async () => {
    const { plugin, file, saveProperties } = makeFrontmatterPlugin({
      tags: ["Foo", "bar"],
    });

    await renameTagInMarkdownFile(plugin, "#foo", "#renamed", file as any);
    await waitForSave(saveProperties);

    expect(saveProperties).toHaveBeenCalledWith("Rows/A.md", {
      tags: ["renamed", "bar"],
    });
  });

  it("still renames an already-lowercase frontmatter tag (no regression for the common case)", async () => {
    const { plugin, file, saveProperties } = makeFrontmatterPlugin({
      tags: ["foo", "bar"],
    });

    await renameTagInMarkdownFile(plugin, "#foo", "#renamed", file as any);
    await waitForSave(saveProperties);

    expect(saveProperties).toHaveBeenCalledWith("Rows/A.md", {
      tags: ["renamed", "bar"],
    });
  });
});

// ---------------------------------------------------------------------------
// BODY sink: build a plugin whose tag lives as an INLINE body occurrence, so
// renameTagInMarkdownFile routes through editTagInFileBody. positionsForTag
// reads currentCache.tags (raw in-file casing + offsets); the splice must use
// the real in-file span, not oldTag.length.
// ---------------------------------------------------------------------------
const makeBodyPlugin = (body: string, rawInFileTag: string) => {
  const file = { path: "Rows/B.md", extension: "md" } as any;
  const start = body.indexOf(rawInFileTag);
  const end = start + rawInFileTag.length;
  const tagPosition = {
    tag: rawInFileTag,
    position: { start: { offset: start }, end: { offset: end } },
  };
  const getFileCache = jest.fn(() => ({ tags: [tagPosition] }));
  const app = {
    metadataCache: { getFileCache },
    vault: { getAbstractFileByPath: jest.fn(() => file) },
  };
  let written: string | null = null;
  const files = {
    readTextFromFile: jest.fn(async () => body),
    writeTextToFile: jest.fn(async (_path: string, text: string) => {
      written = text;
    }),
  };
  const plugin = {
    app,
    files,
    superstate: { spaceManager: {} },
  } as any;
  return { plugin, file, files, getWritten: () => written };
};

describe("renameTag body sink — length-changing fold (Notidian-ehfz finding 2)", () => {
  it("splices over the REAL in-file span for a length-changing Unicode fold (no eaten byte)", async () => {
    // U+0130 dotted capital 'İ': raw '#İstanbul'.length is 9 but the folded
    // '#i̇stanbul'.length is 10. Pre-fix, splicing by oldTag.length (10) ate the
    // trailing space -> 'tag #cityrocks'. The fix splices over [start,end).
    const rawTag = "#İstanbul"; // '#İstanbul'
    const folded = rawTag.toLowerCase(); // '#i̇stanbul' (length 10)
    expect(folded.length).not.toBe(rawTag.length); // length actually changes
    const body = `tag ${rawTag} rocks`;
    const { plugin, file, getWritten } = makeBodyPlugin(body, rawTag);

    // renameTag feeds the FOLDED tag as oldTag.
    await renameTagInMarkdownFile(plugin, folded, "#city", file as any);

    expect(getWritten()).toBe("tag #city rocks");
  });

  it("renames a mixed-case ASCII body tag against a folded oldTag", async () => {
    const body = "see #Foo here";
    const { plugin, file, getWritten } = makeBodyPlugin(body, "#Foo");

    await renameTagInMarkdownFile(plugin, "#foo", "#bar", file as any);

    expect(getWritten()).toBe("see #bar here");
  });
});
