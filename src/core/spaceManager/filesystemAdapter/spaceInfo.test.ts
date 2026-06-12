import {
  fileSystemSpaceInfoFromFolder,
  noteParentPath,
} from "core/spaceManager/filesystemAdapter/spaceInfo";
import { SpaceManager } from "core/spaceManager/spaceManager";

const managerWithSettings = (settings: Record<string, any>) =>
  ({
    superstate: {
      settings: {
        spaceSubFolder: ".notidian",
        spacesMDBInHidden: true,
        systemName: "Vault",
        folderNoteName: "",
        folderNoteInsideFolder: true,
        enableFolderNote: true,
        ...settings,
      },
    },
  } as unknown as SpaceManager);

describe("fileSystemSpaceInfoFromFolder notePath", () => {
  it("inside mode: note lives inside the folder", () => {
    const info = fileSystemSpaceInfoFromFolder(
      managerWithSettings({ folderNoteInsideFolder: true }),
      "Reviews"
    );
    expect(info.notePath).toBe("Reviews/Reviews.md");
  });

  it("inside mode: respects a custom folder note name", () => {
    const info = fileSystemSpaceInfoFromFolder(
      managerWithSettings({
        folderNoteInsideFolder: true,
        folderNoteName: "index",
      }),
      "Reviews"
    );
    expect(info.notePath).toBe("Reviews/index.md");
  });

  it("adjacent mode: vault-root folder note sits beside the folder", () => {
    const info = fileSystemSpaceInfoFromFolder(
      managerWithSettings({ folderNoteInsideFolder: false }),
      "Reviews"
    );
    expect(info.notePath).toBe("Reviews.md");
  });

  it("adjacent mode: nested folder note sits in the parent folder", () => {
    const info = fileSystemSpaceInfoFromFolder(
      managerWithSettings({ folderNoteInsideFolder: false }),
      "Gidi/Hardware/Sensor Registry"
    );
    expect(info.notePath).toBe("Gidi/Hardware/Sensor Registry.md");
  });

  it("adjacent mode: ignores custom folder note name to avoid sibling collisions", () => {
    const info = fileSystemSpaceInfoFromFolder(
      managerWithSettings({
        folderNoteInsideFolder: false,
        folderNoteName: "index",
      }),
      "Reviews"
    );
    expect(info.notePath).toBe("Reviews.md");
  });

  it("vault root space keeps its named note", () => {
    const info = fileSystemSpaceInfoFromFolder(
      managerWithSettings({ folderNoteInsideFolder: false }),
      "/"
    );
    expect(info.notePath).toBe("Vault.md");
  });
});

describe("noteParentPath", () => {
  it("returns the containing folder for inside-mode notes", () => {
    expect(noteParentPath({ notePath: "Reviews/Reviews.md" })).toBe("Reviews");
  });

  it("returns the folder's parent for adjacent nested notes", () => {
    expect(
      noteParentPath({ notePath: "Gidi/Hardware/Sensor Registry.md" })
    ).toBe("Gidi/Hardware");
  });

  it("returns / for vault-root notes", () => {
    expect(noteParentPath({ notePath: "Reviews.md" })).toBe("/");
  });
});
