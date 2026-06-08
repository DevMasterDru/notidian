import {
  defaultDescriptorForTarget,
  insertTextIntoEditorSelection,
} from "./notidianEmbedCommands";

describe("Notidian embed command helpers", () => {
  it("builds a default files view descriptor for command-palette insertion", () => {
    expect(defaultDescriptorForTarget("Projects")).toEqual({
      target: "Projects",
      kind: "view",
      id: "filesView",
      title: true,
      editable: false,
    });
  });

  it("inserts text into an editor selection", () => {
    const replaceRange = jest.fn();
    const editor = {
      getCursor: () => ({ line: 2, ch: 4 }),
      replaceRange,
    };

    insertTextIntoEditorSelection(editor as any, "```notidian\n```");

    expect(replaceRange).toHaveBeenCalledWith("```notidian\n```", {
      line: 2,
      ch: 4,
    });
  });
});
