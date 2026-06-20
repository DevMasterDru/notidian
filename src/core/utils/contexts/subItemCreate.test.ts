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
    // exactly one write, to the CHILD, with only the basename parent link
    expect(saveFrontmatterProperties).toHaveBeenCalledTimes(1);
    const arg = saveFrontmatterProperties.mock.calls[0][0];
    expect(arg.path).toBe(CHILD_PATH);
    expect(arg.properties).toEqual({ parent: "[[Parent]]" });
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

  it("derives parentTitle as the basename of a nested path", async () => {
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
    expect(saveFrontmatterProperties.mock.calls[0][0].properties).toEqual({
      parent: "[[Deep Parent]]",
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
});
