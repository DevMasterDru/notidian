// One-way contract for the shared sub-item create helper (ADR 0050 / ADR 0024
// B1). createSubItemRow must write ONLY the child's parent link and never touch
// the parent's file. Mocks the create + frontmatter-write collaborators so the
// write semantics are asserted in isolation (mirrors the rowContextMenu dom test).
jest.mock("core/superstate/utils/spaces", () => ({
  newPathInSpace: jest.fn(),
}));
jest.mock("core/utils/properties/frontmatterWrite", () => ({
  saveFrontmatterProperties: jest.fn(),
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { newPathInSpace } = require("core/superstate/utils/spaces");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const {
  saveFrontmatterProperties,
} = require("core/utils/properties/frontmatterWrite");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { createSubItemRow } = require("./subItemCreate");
// parseRelationLinks is the read-side that resolves a written parent link back
// to its target row path (buildRowTree / rollups). PART B round-trips the
// writer's output through it to pin the path-qualification limits (Notidian-xsau).
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { parseRelationLinks } = require("./tableRollup");

const PARENT_PATH = "Folder/Parent.md";
const CHILD_PATH = "Folder/Untitled.md";
const SPACE = { path: "Folder", name: "Folder", type: "folder" };

const makeSuperstate = (over: any = {}): any => ({
  spaceManager: {
    readTable: jest.fn(async () => ({
      schema: { id: "files", primary: "true" },
      rows: [{ File: PARENT_PATH }],
    })),
  },
  spacesIndex: new Map([["Folder", SPACE]]),
  ...over,
});

beforeEach(() => {
  newPathInSpace.mockReset();
  newPathInSpace.mockResolvedValue(CHILD_PATH);
  saveFrontmatterProperties.mockReset();
  saveFrontmatterProperties.mockResolvedValue({ ok: true });
});

describe("createSubItemRow (ADR 0050, one-way)", () => {
  it("creates the child and writes ONLY the child's parent link (parent untouched)", async () => {
    const superstate = makeSuperstate();
    const result = await createSubItemRow({
      superstate,
      contextPath: "Folder",
      schema: "files",
      index: 0,
      subItemsField: "parent",
    });

    expect(result).toBe(CHILD_PATH);
    // child created in the same space, empty title, dontOpen=true (mirrors newRow)
    expect(newPathInSpace).toHaveBeenCalledTimes(1);
    expect(newPathInSpace).toHaveBeenCalledWith(
      superstate,
      SPACE,
      "md",
      "",
      true
    );
    // exactly one write, to the CHILD, with a PATH-QUALIFIED parent link
    // (Notidian-kg81): full parent path (minus .md) as the target so it resolves
    // back to THIS parent row, with the clean basename as the display alias. A
    // bare [[Parent]] would resolve to the first same-named file vault-wide.
    expect(saveFrontmatterProperties).toHaveBeenCalledTimes(1);
    const arg = saveFrontmatterProperties.mock.calls[0][0];
    expect(arg.path).toBe(CHILD_PATH);
    expect(arg.properties).toEqual({ parent: "[[Folder/Parent|Parent]]" });
    // one-way: the parent path is never a write target
    for (const call of saveFrontmatterProperties.mock.calls) {
      expect(call[0].path).not.toBe(PARENT_PATH);
    }
  });

  it("re-reads the table for a fresh parent before resolving", async () => {
    const superstate = makeSuperstate();
    await createSubItemRow({
      superstate,
      contextPath: "Folder",
      schema: "files",
      index: 0,
      subItemsField: "parent",
    });
    expect(superstate.spaceManager.readTable).toHaveBeenCalledWith(
      "Folder",
      "files"
    );
  });

  it("writes the full nested path as the link target with the basename as alias (Notidian-kg81)", async () => {
    const superstate = makeSuperstate({
      spaceManager: {
        readTable: async () => ({
          rows: [{ File: "A/B/C/Deep Parent.md" }],
        }),
      },
    });
    await createSubItemRow({
      superstate,
      contextPath: "Folder",
      schema: "files",
      index: 0,
      subItemsField: "parent",
    });
    // The target carries the FULL path so it resolves unambiguously to this row;
    // the alias is the clean basename for display.
    expect(saveFrontmatterProperties.mock.calls[0][0].properties).toEqual({
      parent: "[[A/B/C/Deep Parent|Deep Parent]]",
    });
  });

  it("path-qualifies a folder/sub-space parent (no .md) so it still resolves to the row (Notidian-kg81)", async () => {
    // A folder-row parent (sub-space) has a path with no .md extension. The
    // link target must keep the full folder path so a vault-wide basename
    // collision (e.g. another file with the same basename) can't capture it.
    const superstate = makeSuperstate({
      spaceManager: {
        readTable: async () => ({
          rows: [{ File: "Sandbox/Atlasidian" }],
        }),
      },
    });
    await createSubItemRow({
      superstate,
      contextPath: "Folder",
      schema: "files",
      index: 0,
      subItemsField: "parent",
    });
    expect(saveFrontmatterProperties.mock.calls[0][0].properties).toEqual({
      parent: "[[Sandbox/Atlasidian|Atlasidian]]",
    });
  });

  it("uses parentPath directly (no table re-read) when supplied — Notidian-gr8t", async () => {
    const superstate = makeSuperstate();
    const result = await createSubItemRow({
      superstate,
      contextPath: "Folder",
      schema: "files",
      subItemsField: "parent",
      parentPath: "Folder/Other Parent.md",
    });
    expect(result).toBe(CHILD_PATH);
    // The "+ New sub-item" affordance already holds the parent path, so the
    // index->table lookup is skipped entirely.
    expect(superstate.spaceManager.readTable).not.toHaveBeenCalled();
    expect(saveFrontmatterProperties.mock.calls[0][0].properties).toEqual({
      parent: "[[Folder/Other Parent|Other Parent]]",
    });
  });

  it("parentPath wins over index when both are given", async () => {
    const superstate = makeSuperstate();
    await createSubItemRow({
      superstate,
      contextPath: "Folder",
      schema: "files",
      index: 0,
      subItemsField: "parent",
      parentPath: "Folder/Picked.md",
    });
    expect(superstate.spaceManager.readTable).not.toHaveBeenCalled();
    expect(saveFrontmatterProperties.mock.calls[0][0].properties).toEqual({
      parent: "[[Folder/Picked|Picked]]",
    });
  });

  it("returns null and writes nothing when subItemsField is empty", async () => {
    const superstate = makeSuperstate();
    expect(
      await createSubItemRow({
        superstate,
        contextPath: "Folder",
        schema: "files",
        index: 0,
        subItemsField: null,
      })
    ).toBeNull();
    expect(newPathInSpace).not.toHaveBeenCalled();
    expect(saveFrontmatterProperties).not.toHaveBeenCalled();
  });

  it.each([
    ["index out of bounds", { index: 9 }],
    ["empty parent path", { rows: [{ File: "" }] }],
    ["space not found", { noSpace: true }],
  ])("returns null without creating a child: %s", async (_label, cfg: any) => {
    const superstate = makeSuperstate(
      cfg.noSpace ? { spacesIndex: new Map() } : {}
    );
    if (cfg.rows) {
      superstate.spaceManager.readTable = async () => ({ rows: cfg.rows });
    }
    const result = await createSubItemRow({
      superstate,
      contextPath: "Folder",
      schema: "files",
      index: cfg.index ?? 0,
      subItemsField: "parent",
    });
    expect(result).toBeNull();
    expect(saveFrontmatterProperties).not.toHaveBeenCalled();
  });

  it("returns null and does not write when child creation fails", async () => {
    newPathInSpace.mockResolvedValue("");
    const superstate = makeSuperstate();
    const result = await createSubItemRow({
      superstate,
      contextPath: "Folder",
      schema: "files",
      index: 0,
      subItemsField: "parent",
    });
    expect(result).toBeNull();
    expect(saveFrontmatterProperties).not.toHaveBeenCalled();
  });

  // bd Notidian-8k9b: off the primary files schema the parent link never
  // materializes into the row (filesystemAdapter syncContextRow runs only for
  // schema == defaultContextSchemaID), so a created child would be an orphaned
  // non-nesting dead write. The single shared create path must refuse it
  // regardless of how it is reached (row menu or inline "+").
  it.each([
    ["custom db table", "custom-db"],
    ["empty schema", ""],
    ["another view id", "MyView"],
  ])(
    "returns null and writes NOTHING off the primary schema: %s",
    async (_label, schema) => {
      const superstate = makeSuperstate();
      // Even with parentPath supplied (the inline "+" path, which skips the
      // table re-read), nothing is created or written off-primary.
      const result = await createSubItemRow({
        superstate,
        contextPath: "Folder",
        schema,
        subItemsField: "parent",
        parentPath: "Folder/Other Parent.md",
      });
      expect(result).toBeNull();
      expect(newPathInSpace).not.toHaveBeenCalled();
      expect(saveFrontmatterProperties).not.toHaveBeenCalled();
    }
  );
});

// PART B (Notidian-xsau) — PIN the path-qualification limits of the kg81
// parent-link writer as DOCUMENTED-UNSUPPORTED, not blockers. The writer emits
// `[[<target>|<basename>]]`; the read side (parseRelationLinks, tableRollup.ts)
// strips the alias on `|` and any fragment on `#`. Where a parent BASENAME itself
// contains `#`, `]`, or `|`, the round-trip is lossy and the child is orphaned
// (no disclosure triangle). These tests assert the CURRENT behavior so a future
// change is a conscious decision, and serve as executable documentation of the
// limits. No safe linkpath encoding exists for `#` in Obsidian wikilink targets,
// so this is genuinely unsupported rather than a quick fix.
const writtenParentLink = async (parentFile: string): Promise<string> => {
  saveFrontmatterProperties.mockClear();
  newPathInSpace.mockResolvedValue(CHILD_PATH);
  const superstate = makeSuperstate({
    spaceManager: {
      readTable: async () => ({ rows: [{ File: parentFile }] }),
    },
  });
  await createSubItemRow({
    superstate,
    contextPath: "Folder",
    schema: "files",
    index: 0,
    subItemsField: "parent",
  });
  return saveFrontmatterProperties.mock.calls[0][0].properties.parent;
};

describe("createSubItemRow path-qualification limits (Notidian-xsau, documented unsupported)", () => {
  it("UNSUPPORTED: '#' in a parent basename orphans the child (Obsidian heading sigil)", async () => {
    // Obsidian treats '#' as a heading/fragment sigil; getFirstLinkpathDest and
    // parseRelationLinks (tableRollup.ts split('#')) both cut the target there.
    // There is NO safe wikilink encoding for a literal '#' in a linkpath target,
    // so a parent like "Issue #5" can never round-trip. Documented unsupported.
    const link = await writtenParentLink("Folder/Issue #5.md");
    // The writer faithfully embeds the basename (lossless on the write side)...
    expect(link).toBe("[[Folder/Issue #5|Issue #5]]");
    // ...but the read side truncates at '#', resolving to the WRONG (nonexistent)
    // target — the child is silently orphaned from "Folder/Issue #5".
    expect(parseRelationLinks(link)).toEqual(["Folder/Issue"]);
    expect(parseRelationLinks(link)).not.toContain("Folder/Issue #5");
  });

  it("UNSUPPORTED: ']' in a parent basename breaks the wikilink (no extracted target)", async () => {
    // A ']' inside the basename closes the wikilink early; the read-side regex
    // (/\[\[([^\]]+)\]\]/) then fails to match, extracting NO target at all. Rare
    // (']' is outside Notidian's recommended naming charset). Documented limit.
    const link = await writtenParentLink("Folder/Done] task.md");
    expect(link).toBe("[[Folder/Done] task|Done] task]]");
    // The wikilink regex fails to match (']' closes the brackets early), so the
    // whole raw string is taken verbatim as the "target" — never a real path, so
    // the child is orphaned from "Folder/Done] task".
    expect(parseRelationLinks(link)).toEqual([
      "[[Folder/Done] task|Done] task]]",
    ]);
    expect(parseRelationLinks(link)).not.toContain("Folder/Done] task");
  });

  it("UNSUPPORTED: '|' in a parent basename collides with the alias separator", async () => {
    // '|' is the wikilink alias separator; a '|' in the basename makes the
    // target/alias boundary ambiguous and the read side takes only the segment
    // before the first '|', resolving to the wrong target. Rare; documented.
    const link = await writtenParentLink("Folder/A|B name.md");
    expect(link).toBe("[[Folder/A|B name|A|B name]]");
    // split('|')[0] keeps only "Folder/A" → wrong target, child orphaned.
    expect(parseRelationLinks(link)).toEqual(["Folder/A"]);
    expect(parseRelationLinks(link)).not.toContain("Folder/A|B name");
  });

  it("LIMIT: a vault-ROOT parent degrades to a bare basename target (same-dir proximity, not collision-immune)", async () => {
    // A parent at the vault root has path "Parent.md" → target "Parent" with no
    // qualifying folder. Obsidian resolves a bare "[[Parent]]" by same-directory
    // proximity first, so it works for a same-folder child but is NOT immune to a
    // vault-wide basename collision the way a folder-qualified target is. The
    // round-trip is still correct (resolves to "Parent"); the limit is the
    // weaker collision guarantee, which is documented, not fixed here.
    const link = await writtenParentLink("Parent.md");
    expect(link).toBe("[[Parent|Parent]]");
    expect(parseRelationLinks(link)).toEqual(["Parent"]);
  });

  it("CONTROL: an ordinary folder-qualified parent round-trips losslessly", async () => {
    // The supported case: a safe-charset basename in a folder resolves back to
    // the exact parent row path — the contrast that makes the limits above clear.
    const link = await writtenParentLink("Folder/Parent.md");
    expect(link).toBe("[[Folder/Parent|Parent]]");
    expect(parseRelationLinks(link)).toEqual(["Folder/Parent"]);
  });
});
