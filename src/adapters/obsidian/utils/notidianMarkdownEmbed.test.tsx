import { parseNotidianEmbedBlock } from "core/utils/embeds/notidianEmbed";

describe("Notidian markdown embed parser contract", () => {
  it("accepts the block shape used by the Obsidian code block processor", () => {
    expect(
      parseNotidianEmbedBlock("target: Projects\nkind: view\nid: active")
    ).toEqual({
      ok: true,
      descriptor: {
        target: "Projects",
        kind: "view",
        id: "active",
        title: true,
        editable: false,
      },
    });
  });
});
