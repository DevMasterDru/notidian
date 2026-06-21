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
