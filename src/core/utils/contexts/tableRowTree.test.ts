import {
  buildRowTree,
  flattenVisibleTree,
} from "core/utils/contexts/tableRowTree";

const tree = (rows: Record<string, any>[]) =>
  buildRowTree({ rows, parentKey: "parent", pathKey: "File" }).map((n) => ({
    path: n.row.File,
    depth: n.depth,
    hasChildren: n.hasChildren,
  }));

describe("buildRowTree", () => {
  it("nests children under parents, siblings in input order, depth increasing", () => {
    const rows = [
      { File: "A", parent: "" },
      { File: "B", parent: "[[A]]" },
      { File: "C", parent: "[[A]]" },
      { File: "D", parent: "[[B]]" },
    ];
    expect(tree(rows)).toEqual([
      { path: "A", depth: 0, hasChildren: true },
      { path: "B", depth: 1, hasChildren: true },
      { path: "D", depth: 2, hasChildren: false },
      { path: "C", depth: 1, hasChildren: false },
    ]);
  });

  it("treats a parent outside the row set as a root (orphan)", () => {
    const rows = [
      { File: "A", parent: "[[Missing]]" },
      { File: "B", parent: "[[A]]" },
    ];
    expect(tree(rows)).toEqual([
      { path: "A", depth: 0, hasChildren: true },
      { path: "B", depth: 1, hasChildren: false },
    ]);
  });

  it("handles a self-parent as a root", () => {
    expect(tree([{ File: "A", parent: "[[A]]" }])).toEqual([
      { path: "A", depth: 0, hasChildren: false },
    ]);
  });

  it("breaks cycles without infinite recursion (each row emitted once)", () => {
    const rows = [
      { File: "A", parent: "[[B]]" },
      { File: "B", parent: "[[A]]" },
    ];
    const result = tree(rows);
    expect(result.map((n) => n.path).sort()).toEqual(["A", "B"]);
    expect(result).toHaveLength(2);
  });

  it("attaches to the first parent link that resolves (skips a stale link)", () => {
    const rows = [
      { File: "A", parent: "" },
      { File: "B", parent: "[[Missing]], [[A]]" },
    ];
    expect(tree(rows)).toEqual([
      { path: "A", depth: 0, hasChildren: true },
      { path: "B", depth: 1, hasChildren: false },
    ]);
  });

  it("with no parents, all rows are roots in order", () => {
    expect(tree([{ File: "A" }, { File: "B" }])).toEqual([
      { path: "A", depth: 0, hasChildren: false },
      { path: "B", depth: 0, hasChildren: false },
    ]);
  });

  it("resolves a parent path that includes folders/aliases", () => {
    const rows = [
      { File: "Tasks/A", parent: "" },
      { File: "Tasks/B", parent: "[[Tasks/A|A]]" },
    ];
    expect(tree(rows)).toEqual([
      { path: "Tasks/A", depth: 0, hasChildren: true },
      { path: "Tasks/B", depth: 1, hasChildren: false },
    ]);
  });

  it("applies resolveLink so a bare link matches the resolved row path", () => {
    // Live shape: parent value is a bare basename, row paths are full paths.
    const rows = [
      { File: "Tasks/A.md", parent: "" },
      { File: "Tasks/B.md", parent: "[[A]]" },
    ];
    const resolveLink = (link: string) => `Tasks/${link}.md`;
    const result = buildRowTree({
      rows,
      parentKey: "parent",
      pathKey: "File",
      resolveLink,
    }).map((n) => ({ path: n.row.File, depth: n.depth }));
    expect(result).toEqual([
      { path: "Tasks/A.md", depth: 0 },
      { path: "Tasks/B.md", depth: 1 },
    ]);
  });

  it("resolveLink receives the row's own path as the source", () => {
    const seen: Array<[string, string]> = [];
    buildRowTree({
      rows: [{ File: "A", parent: "[[X]]" }],
      parentKey: "parent",
      pathKey: "File",
      resolveLink: (link, sourcePath) => {
        seen.push([link, sourcePath]);
        return link;
      },
    });
    expect(seen).toEqual([["X", "A"]]);
  });
});

describe("flattenVisibleTree", () => {
  const nodes = buildRowTree({
    rows: [
      { File: "A", parent: "" },
      { File: "B", parent: "[[A]]" },
      { File: "D", parent: "[[B]]" },
      { File: "C", parent: "[[A]]" },
      { File: "E", parent: "" },
    ],
    parentKey: "parent",
    pathKey: "File",
  });
  // Tree order: A, B, D, C, E (A>{B>{D}, C}, E root)
  const flatten = (collapsed: string[]) =>
    flattenVisibleTree(nodes, new Set(collapsed), "File").map((n) => n.row.File);

  it("shows the whole tree when nothing is collapsed", () => {
    expect(flatten([])).toEqual(["A", "B", "D", "C", "E"]);
  });

  it("hides all descendants of a collapsed node but keeps the node", () => {
    expect(flatten(["A"])).toEqual(["A", "E"]);
  });

  it("collapses a mid-tree node without affecting its siblings", () => {
    // Collapsing B hides D; A, C, E stay.
    expect(flatten(["B"])).toEqual(["A", "B", "C", "E"]);
  });

  it("handles multiple collapsed nodes", () => {
    expect(flatten(["B", "A"])).toEqual(["A", "E"]);
  });

  it("ignores a collapsed path with no children (leaf)", () => {
    expect(flatten(["E"])).toEqual(["A", "B", "D", "C", "E"]);
  });
});
