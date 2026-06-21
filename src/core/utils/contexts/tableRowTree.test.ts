import {
  buildRowTree,
  flattenVisibleTree,
  subItemAddRowsAfter,
  nextCollapsedPaths,
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

describe("buildRowTree surfacedAsRoot (ADR 0024 C2)", () => {
  // Include the honesty flag so we can assert the passive cycle/orphan marker.
  const flagged = (rows: Record<string, any>[]) =>
    buildRowTree({ rows, parentKey: "parent", pathKey: "File" }).map((n) => ({
      path: n.row.File,
      depth: n.depth,
      surfacedAsRoot: n.surfacedAsRoot,
    }));

  it("is false for a genuine root (no parent value)", () => {
    expect(flagged([{ File: "A", parent: "" }])).toEqual([
      { path: "A", depth: 0, surfacedAsRoot: false },
    ]);
  });

  it("is false for a normally-nested child", () => {
    const rows = [
      { File: "A", parent: "" },
      { File: "B", parent: "[[A]]" },
    ];
    expect(flagged(rows)).toEqual([
      { path: "A", depth: 0, surfacedAsRoot: false },
      { path: "B", depth: 1, surfacedAsRoot: false },
    ]);
  });

  it("is true for a row whose parent link points outside the set (orphan)", () => {
    const rows = [
      { File: "A", parent: "[[Missing]]" },
      { File: "B", parent: "[[A]]" },
    ];
    expect(flagged(rows)).toEqual([
      // A names a parent that isn't visible -> surfaced honestly at top level.
      { path: "A", depth: 0, surfacedAsRoot: true },
      // B's parent (A) IS in the set, so B is a normal nested node.
      { path: "B", depth: 1, surfacedAsRoot: false },
    ]);
  });

  it("is true for a row only reachable through a cycle (leftover loop)", () => {
    const rows = [
      { File: "A", parent: "[[B]]" },
      { File: "B", parent: "[[A]]" },
    ];
    const result = flagged(rows);
    // Whichever node the cycle-leftover loop surfaces lands at depth 0 with the
    // flag set; both carry a parent value, so neither is a genuine root.
    const surfaced = result.filter((n) => n.depth === 0);
    expect(surfaced).toHaveLength(1);
    expect(surfaced[0].surfacedAsRoot).toBe(true);
  });

  it("is true for a self-parent (named a parent that can't form a tree)", () => {
    expect(flagged([{ File: "A", parent: "[[A]]" }])).toEqual([
      { path: "A", depth: 0, surfacedAsRoot: true },
    ]);
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

// Notidian-gr8t: pure insertion points for the Notion-style "+ New sub-item" row.
// Input is the flattenVisibleTree output (collapsed subtrees already removed).
const vnode = (path: string, depth: number, hasChildren: boolean) => ({
  row: { File: path },
  depth,
  hasChildren,
  childCount: hasChildren ? 1 : 0,
  surfacedAsRoot: false,
});
// Flatten the result Map to a comparable shape: { afterPath: [[parentPath, depth], ...] }
const addRows = (
  nodes: ReturnType<typeof vnode>[],
  collapsed: string[] = []
) => {
  const m = subItemAddRowsAfter(nodes, new Set(collapsed), "File");
  const out: Record<string, [string, number][]> = {};
  for (const [k, v] of m) out[k] = v.map((a) => [a.parentPath, a.depth]);
  return out;
};

describe("subItemAddRowsAfter (Notidian-gr8t)", () => {
  it("(a) an expanded parent with children -> one add-row after the LAST child, at child depth", () => {
    const nodes = [
      vnode("P", 0, true),
      vnode("C1", 1, false),
      vnode("C2", 1, false),
      vnode("Sib", 0, false),
    ];
    expect(addRows(nodes)).toEqual({ C2: [["P", 1]] });
  });

  it("(b/h) a collapsed parent (in collapsedPaths) gets NO add-row", () => {
    // Collapsed => children not in the visible nodes; the parent stays but is
    // marked collapsed, so no "+ New sub-item".
    const nodes = [vnode("P", 0, true), vnode("Sib", 0, false)];
    expect(addRows(nodes, ["P"])).toEqual({});
  });

  it("(c) a leaf / no expanded parents -> empty", () => {
    expect(addRows([vnode("A", 0, false), vnode("B", 0, false)])).toEqual({});
  });

  it("(d) nested A>B>C all expanded -> three add-rows after C, DEEPEST-FIRST", () => {
    const nodes = [
      vnode("A", 0, true),
      vnode("B", 1, true),
      vnode("C", 2, false),
      vnode("X", 0, false),
    ];
    // After C: child-of-B (depth 2), then child-of-B's-parent... i.e. B@2, A@1.
    expect(addRows(nodes)).toEqual({ C: [["B", 2], ["A", 1]] });
  });

  it("(e) two sibling expanded parents -> each its own add-row after its own last child", () => {
    const nodes = [
      vnode("A", 0, true),
      vnode("A1", 1, false),
      vnode("D", 0, true),
      vnode("D1", 1, false),
    ];
    expect(addRows(nodes)).toEqual({ A1: [["A", 1]], D1: [["D", 1]] });
  });

  it("(f) empty input -> empty map", () => {
    expect(addRows([])).toEqual({});
  });

  it("(g) parent whose only visible child is itself collapsed -> add-row after that child (last VISIBLE descendant)", () => {
    // P expanded; C is a child that hasChildren but is collapsed (grandkids hidden).
    const nodes = [vnode("P", 0, true), vnode("C", 1, true)];
    expect(addRows(nodes, ["C"])).toEqual({ C: [["P", 1]] });
  });

  it("trailing expanded parent at end of list drains correctly", () => {
    const nodes = [vnode("P", 0, true), vnode("C1", 1, false)];
    expect(addRows(nodes)).toEqual({ C1: [["P", 1]] });
  });

  it("deeply nested where only the OUTER parent is expanded shows a single add-row", () => {
    // A expanded, B is a visible child that is collapsed -> only A's add-row.
    const nodes = [vnode("A", 0, true), vnode("B", 1, true)];
    expect(addRows(nodes, ["B"])).toEqual({ B: [["A", 1]] });
  });
});

describe("nextCollapsedPaths (Notidian-5ond.3 collapse persistence)", () => {
  it("adds a path that isn't collapsed yet", () => {
    expect(nextCollapsedPaths(["A"], "B").sort()).toEqual(["A", "B"]);
  });
  it("removes a path that is already collapsed", () => {
    expect(nextCollapsedPaths(["A", "B"], "A")).toEqual(["B"]);
  });
  it("treats undefined current as empty", () => {
    expect(nextCollapsedPaths(undefined, "A")).toEqual(["A"]);
  });
  it("dedupes and drops empty entries", () => {
    expect(nextCollapsedPaths(["A", "A", ""], "B").sort()).toEqual(["A", "B"]);
  });
  it("ignores an empty toggle path", () => {
    expect(nextCollapsedPaths(["A"], "")).toEqual(["A"]);
  });
});

describe("buildRowTree childCount (Notidian-5ond.6)", () => {
  it("reports the number of DIRECT children per node (view-scoped)", () => {
    const rows = [
      { File: "A", parent: "" },
      { File: "B", parent: "[[A]]" },
      { File: "C", parent: "[[A]]" },
      { File: "D", parent: "[[B]]" }, // grandchild — not counted for A
    ];
    const counts = Object.fromEntries(
      buildRowTree({ rows, parentKey: "parent", pathKey: "File" }).map((n) => [
        n.row.File,
        n.childCount,
      ])
    );
    expect(counts).toEqual({ A: 2, B: 1, C: 0, D: 0 });
  });
});
