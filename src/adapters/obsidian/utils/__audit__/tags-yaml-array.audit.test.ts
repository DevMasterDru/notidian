jest.mock("obsidian", () => ({ getAllTags: jest.fn() }), { virtual: true });
jest.mock("main", () => ({ __esModule: true, default: jest.fn() }));
jest.mock("adapters/obsidian/utils/file", () => ({
  getAbstractFileAtPath: jest.fn(),
}));

import {
  addTagToProperties,
  removeTagFromMarkdownFile,
} from "adapters/obsidian/utils/tags";

const makeManager = (frontmatter: Record<string, any>) => {
  const file = { path: "Rows/A.md", extension: "md" };
  const getFileCache = jest.fn(() => ({ frontmatter }));
  const app = {
    metadataCache: { getFileCache },
    vault: { getAbstractFileByPath: jest.fn(() => file) },
  };
  const saveProperties = jest.fn(async () => true);
  const manager = {
    readProperties: jest.fn(async () => ({
      tags: JSON.stringify(frontmatter.tags),
    })),
    saveProperties,
    primarySpaceAdapter: {
      fileSystem: {
        primary: { plugin: { app } },
      },
    },
  };

  return { app, file, manager, saveProperties };
};

const waitForSave = async (saveProperties: jest.Mock) => {
  for (let i = 0; i < 10 && saveProperties.mock.calls.length === 0; i += 1) {
    await Promise.resolve();
  }
};

describe("Obsidian tag property YAML array fidelity", () => {
  it("adds a tag without converting a native YAML tags array into a string", async () => {
    const { manager, saveProperties } = makeManager({ tags: ["foo", "bar"] });

    addTagToProperties(manager as any, "baz", "Rows/A.md");
    await waitForSave(saveProperties);

    expect(saveProperties).toHaveBeenCalledWith("Rows/A.md", {
      tags: ["foo", "bar", "baz"],
    });
  });

  it("removes a tag without converting a native YAML tags array into a string", async () => {
    const { app, file, manager, saveProperties } = makeManager({
      tags: ["foo", "bar"],
    });
    const plugin = {
      app,
      files: {},
      superstate: { spaceManager: manager },
    };

    removeTagFromMarkdownFile(plugin as any, "foo", file as any);
    await waitForSave(saveProperties);

    expect(saveProperties).toHaveBeenCalledWith("Rows/A.md", {
      tags: ["bar"],
    });
  });
});
