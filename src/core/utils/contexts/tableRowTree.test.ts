import { buildRowTree } from "core/utils/contexts/tableRowTree";

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
});
