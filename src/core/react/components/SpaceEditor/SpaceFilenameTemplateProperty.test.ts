import { renameFilesForTemplate } from "./filenameTemplateBulkRename";

describe("filename template bulk rename", () => {
  it("processes every row and rejects every falsy rename result as a partial failure", async () => {
    const renamePath = jest.fn(async (oldPath: string): Promise<string | null | false | undefined> => {
      if (oldPath === "One.md") return "One New.md";
      if (oldPath === "Two.md") return null;
      if (oldPath === "Folder/Three.md") return false;
      if (oldPath === "Four.md") return undefined;
      return "";
    });

    const rename = renameFilesForTemplate([
      { path: "One.md", newName: "One New" },
      { path: "Two.md", newName: "Two New" },
      { path: "Folder/Three.md", newName: "Three New" },
      { path: "Four.md", newName: "Four New" },
      { path: "Five.md", newName: "Five New" },
    ], renamePath);

    await expect(rename).rejects.toEqual(expect.objectContaining({
      name: "AggregateError",
      message: "Renamed 1 file (4 failed).",
      errors: [
        expect.objectContaining({ message: "Rename returned no destination for Two.md" }),
        expect.objectContaining({ message: "Rename returned no destination for Folder/Three.md" }),
        expect.objectContaining({ message: "Rename returned no destination for Four.md" }),
        expect.objectContaining({ message: "Rename returned no destination for Five.md" }),
      ],
    }));
    expect(renamePath.mock.calls).toEqual([
      ["One.md", "One New.md"],
      ["Two.md", "Two New.md"],
      ["Folder/Three.md", "Folder/Three New.md"],
      ["Four.md", "Four New.md"],
      ["Five.md", "Five New.md"],
    ]);
  });
});
