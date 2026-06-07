import {
  buildNotidianWrapperNote,
  insertNotidianCanvasFileNode,
  safeNotidianEmbedFileStem,
  wrapperPathForNotidianEmbed,
} from "./notidianCanvasEmbed";

const descriptor = {
  target: "Projects/Launch Work",
  kind: "view" as const,
  id: "active tasks",
  height: 480,
  title: true,
  editable: false,
};

describe("Notidian Canvas embed utilities", () => {
  it("builds a safe wrapper note path under the preferred storage root", () => {
    expect(safeNotidianEmbedFileStem(descriptor)).toBe(
      "Projects-Launch-Work-view-active-tasks"
    );
    expect(wrapperPathForNotidianEmbed(descriptor)).toBe(
      ".notidian/embeds/Projects-Launch-Work-view-active-tasks.md"
    );
  });

  it("builds wrapper note content containing the canonical notidian block", () => {
    expect(buildNotidianWrapperNote(descriptor)).toContain("```notidian");
    expect(buildNotidianWrapperNote(descriptor)).toContain(
      "target: Projects/Launch Work"
    );
    expect(buildNotidianWrapperNote(descriptor)).toContain("kind: view");
    expect(buildNotidianWrapperNote(descriptor)).toContain("id: active tasks");
  });

  it("inserts a JSON Canvas file node without touching existing edges", () => {
    const canvas = {
      nodes: [
        {
          id: "aaaaaaaaaaaaaaaa",
          type: "text",
          x: 0,
          y: 0,
          width: 300,
          height: 200,
          text: "Existing",
        },
      ],
      edges: [
        {
          id: "bbbbbbbbbbbbbbbb",
          fromNode: "aaaaaaaaaaaaaaaa",
          toNode: "aaaaaaaaaaaaaaaa",
        },
      ],
    };

    expect(
      insertNotidianCanvasFileNode(canvas, {
        file: ".notidian/embeds/projects-view-active.md",
        idFactory: () => "cccccccccccccccc",
      })
    ).toEqual({
      canvas: {
        nodes: [
          canvas.nodes[0],
          {
            id: "cccccccccccccccc",
            type: "file",
            x: 380,
            y: 0,
            width: 760,
            height: 480,
            file: ".notidian/embeds/projects-view-active.md",
          },
        ],
        edges: canvas.edges,
      },
      nodeId: "cccccccccccccccc",
    });
  });

  it("uses explicit insertion coordinates when provided", () => {
    expect(
      insertNotidianCanvasFileNode(
        { nodes: [], edges: [] },
        {
          file: "Notidian Embeds/projects.md",
          idFactory: () => "dddddddddddddddd",
          x: 40,
          y: 80,
          width: 640,
          height: 360,
        }
      ).canvas.nodes[0]
    ).toMatchObject({
      x: 40,
      y: 80,
      width: 640,
      height: 360,
    });
  });
});
