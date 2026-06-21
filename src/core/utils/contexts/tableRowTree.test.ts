import {
  buildRowTree,
  collectSubtreePaths,
  subtreePathsFromTree,
  flattenVisibleTree,
  subItemAddRowsAfter,
  nextCollapsedPaths,
  rootDescendantCounts,
  scopeRowsByFilter,
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

describe("collectSubtreePaths (Notidian-5ond.8 non-destructive parent-delete)", () => {
  const collect = (
    rows: Record<string, any>[],
    rootPath: string,
    resolveLink?: (link: string, src: string) => string
  ) => collectSubtreePaths(rows, "parent", "File", resolveLink, rootPath);

  it("returns the single child of a parent (and the parent is excluded)", () => {
    const rows = [
      { File: "A", parent: "" },
      { File: "B", parent: "[[A]]" },
    ];
    expect(collect(rows, "A")).toEqual(["B"]);
  });

  it("leaf row returns an empty subtree (silent-delete path, no prompt)", () => {
    const rows = [
      { File: "A", parent: "" },
      { File: "B", parent: "[[A]]" },
    ];
    // B is a leaf (no children); deleting it never prompts.
    expect(collect(rows, "B")).toEqual([]);
  });

  it("a row absent from the set returns empty (no descendants resolvable)", () => {
    const rows = [{ File: "A", parent: "" }];
    expect(collect(rows, "Missing")).toEqual([]);
  });

  it("collects a DEEP chain (children, grandchildren, …) depth-first", () => {
    // A > B > C > D (single chain).
    const rows = [
      { File: "A", parent: "" },
      { File: "B", parent: "[[A]]" },
      { File: "C", parent: "[[B]]" },
      { File: "D", parent: "[[C]]" },
    ];
    expect(collect(rows, "A")).toEqual(["B", "C", "D"]);
    // From a mid-chain node, only what is beneath it.
    expect(collect(rows, "B")).toEqual(["C", "D"]);
  });

  it("collects a WIDE subtree (multiple branches), each branch depth-first", () => {
    // A > {B > D, C}.
    const rows = [
      { File: "A", parent: "" },
      { File: "B", parent: "[[A]]" },
      { File: "D", parent: "[[B]]" },
      { File: "C", parent: "[[A]]" },
    ];
    expect(collect(rows, "A")).toEqual(["B", "D", "C"]);
  });

  it("counts ONLY descendants of the target, not unrelated rows or siblings", () => {
    // A > B ; X > Y (separate tree). Deleting A must not pull X or Y.
    const rows = [
      { File: "A", parent: "" },
      { File: "B", parent: "[[A]]" },
      { File: "X", parent: "" },
      { File: "Y", parent: "[[X]]" },
    ];
    expect(collect(rows, "A")).toEqual(["B"]);
  });

  it("multi-parent surfaced-as-root: a child attaches to the FIRST resolving parent only", () => {
    // C names two parents; buildRowTree (and collectSubtreePaths) attach to the
    // first resolving link (A), so A's subtree includes C but B's does not.
    const rows = [
      { File: "A", parent: "" },
      { File: "B", parent: "" },
      { File: "C", parent: "[[A]], [[B]]" },
    ];
    expect(collect(rows, "A")).toEqual(["C"]);
    expect(collect(rows, "B")).toEqual([]);
  });

  it("is cycle-safe: a parent/child loop terminates and never re-emits the root", () => {
    const rows = [
      { File: "A", parent: "[[B]]" },
      { File: "B", parent: "[[A]]" },
    ];
    // From A: B is A's child via the loop; A must not re-appear, no infinite loop.
    const fromA = collect(rows, "A");
    expect(fromA).toEqual(["B"]);
    expect(fromA).not.toContain("A");
  });

  it("self-parent yields no subtree (cannot be its own descendant)", () => {
    expect(collect([{ File: "A", parent: "[[A]]" }], "A")).toEqual([]);
  });

  it("applies resolveLink so bare/aliased parent links match the resolved paths", () => {
    const rows = [
      { File: "Tasks/A.md", parent: "" },
      { File: "Tasks/B.md", parent: "[[A]]" },
      { File: "Tasks/C.md", parent: "[[B]]" },
    ];
    const resolveLink = (link: string) => `Tasks/${link}.md`;
    expect(collect(rows, "Tasks/A.md", resolveLink)).toEqual([
      "Tasks/B.md",
      "Tasks/C.md",
    ]);
  });

  it("empty rows -> empty subtree", () => {
    expect(collect([], "A")).toEqual([]);
  });
});

// subtreePathsFromTree (Notidian-5ond.8 review hardening). The live delete path
// slices descendants straight out of buildRowTree's OWN depth-first output, so the
// count, the rendered nesting, and the delete set are provably the same object —
// regardless of collapse / limit / display-mode projections of that tree, and
// correct for in-set parent cycles (which a second independent walk got wrong).
describe("subtreePathsFromTree (review: delete set == rendered tree)", () => {
  const treeOf = (rows: Record<string, any>[]) =>
    buildRowTree({ rows, parentKey: "parent", pathKey: "File" });
  const sub = (rows: Record<string, any>[], rootPath: string) =>
    subtreePathsFromTree(treeOf(rows), "File", rootPath);

  it("collects the full descendant window depth-first (parent excluded)", () => {
    const rows = [
      { File: "A", parent: "" },
      { File: "B", parent: "[[A]]" },
      { File: "C", parent: "[[B]]" },
      { File: "D", parent: "[[A]]" },
    ];
    expect(sub(rows, "A")).toEqual(["B", "C", "D"]);
    expect(sub(rows, "B")).toEqual(["C"]);
  });

  it("a leaf returns [] (silent-delete path, no prompt)", () => {
    const rows = [
      { File: "A", parent: "" },
      { File: "B", parent: "[[A]]" },
    ];
    expect(sub(rows, "B")).toEqual([]);
  });

  it("a path not in the tree returns []", () => {
    expect(sub([{ File: "A", parent: "" }], "Missing")).toEqual([]);
    expect(sub([{ File: "A", parent: "" }], "")).toEqual([]);
  });

  // ---- Review finding 5: cycle parity. buildRowTree picks ONE cycle member as
  // the rendered root; its partner renders as a nested leaf. The delete set for
  // the partner must be [] (it has nothing rendered beneath it) — it must NEVER
  // walk back into the cycle and report its rendered ANCESTOR / SIBLING.
  it("cycle: the non-root member is a rendered leaf -> [] (never destroys its ancestor/sibling)", () => {
    const rows = [
      { File: "A", parent: "[[B]]" },
      { File: "B", parent: "[[A]]" },
      { File: "X", parent: "[[A]]" },
    ];
    // buildRowTree renders A@0 (surfacedAsRoot) > B@1, X@1.
    const t = treeOf(rows);
    expect(t.map((n) => [String(n.row.File), n.depth])).toEqual([
      ["A", 0],
      ["B", 1],
      ["X", 1],
    ]);
    // A (the chosen root) owns the rendered subtree.
    expect(subtreePathsFromTree(t, "File", "A")).toEqual(["B", "X"]);
    // B (the partner, rendered as a depth-1 leaf) owns NOTHING — must not pull A
    // (its rendered parent) or X (its sibling). This is the regression fix.
    expect(subtreePathsFromTree(t, "File", "B")).toEqual([]);
    expect(subtreePathsFromTree(t, "File", "X")).toEqual([]);
  });

  it("self-parent renders as a root leaf -> []", () => {
    expect(sub([{ File: "A", parent: "[[A]]" }], "A")).toEqual([]);
  });

  // ---- Review findings 1/2/3: independence from the VISIBLE projection. The
  // delete set is derived from the FULL tree, so it is identical whether the
  // caller is looking at a collapsed parent, a parents-only view, or a
  // limit-truncated row set — none of which can hide descendants from the count.
  it("is IDENTICAL whether the parent is collapsed, parents-only, or limit-truncated", () => {
    const rows = [
      { File: "P", parent: "" },
      { File: "C1", parent: "[[P]]" },
      { File: "C2", parent: "[[P]]" },
      { File: "G", parent: "[[C1]]" },
    ];
    const full = treeOf(rows);
    const expected = ["C1", "G", "C2"];
    // The full tree (rendered, expanded) — the baseline.
    expect(subtreePathsFromTree(full, "File", "P")).toEqual(expected);
    // Finding 1: P collapsed — flattenVisibleTree would DROP C1/C2/G from the
    // visible rows, but the delete set comes from the FULL tree, so it is unchanged.
    const collapsed = flattenVisibleTree(full, new Set(["P"]), "File");
    expect(collapsed.map((n) => String(n.row.File))).toEqual(["P"]); // proves children hidden
    expect(subtreePathsFromTree(full, "File", "P")).toEqual(expected);
    // Finding 2: parents-only — the visible rows are roots-only, yet the FULL tree
    // still carries every descendant for the delete decision.
    const parentsOnly = full.filter((n) => n.depth === 0);
    expect(parentsOnly.map((n) => String(n.row.File))).toEqual(["P"]);
    expect(subtreePathsFromTree(full, "File", "P")).toEqual(expected);
    // Finding 3: limit truncation — the visible set may be sliced to [P], but the
    // FULL tree (un-sliced) still yields the complete, correctly-counted subtree.
    expect(subtreePathsFromTree(full, "File", "P")).toHaveLength(3);
  });

  it("a parent with hidden descendants is NEVER mistaken for a leaf (no silent delete)", () => {
    const rows = [
      { File: "P", parent: "" },
      { File: "C", parent: "[[P]]" },
    ];
    const full = treeOf(rows);
    // Even when the only rendered row is the collapsed parent, the FULL-tree
    // delete set is non-empty, so requestRowDeleteWithSubItems opens the prompt
    // instead of silently deleting P (the footgun this bead removes).
    expect(subtreePathsFromTree(full, "File", "P").length).toBeGreaterThan(0);
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

describe("rootDescendantCounts (Notidian-5ond.4 parents-only)", () => {
  const counts = (nodes: ReturnType<typeof vnode>[]) => {
    const m = rootDescendantCounts(nodes, "File");
    return Object.fromEntries(m);
  };
  it("counts ALL descendants per root (not just direct children)", () => {
    // A>{B>{D}, C}, E root. A has 3 descendants (B,D,C); E has 0.
    const nodes = [
      vnode("A", 0, true),
      vnode("B", 1, true),
      vnode("D", 2, false),
      vnode("C", 1, false),
      vnode("E", 0, false),
    ];
    expect(counts(nodes)).toEqual({ A: 3, E: 0 });
  });
  it("handles multiple roots", () => {
    const nodes = [
      vnode("R1", 0, true),
      vnode("c", 1, false),
      vnode("R2", 0, false),
    ];
    expect(counts(nodes)).toEqual({ R1: 1, R2: 0 });
  });
  it("empty input -> empty map", () => {
    expect(counts([])).toEqual({});
  });
});

describe("scopeRowsByFilter (Notidian-5ond.5 filter scopes)", () => {
  // Tree via bare parent links (identity resolveLink): A(root) > B, D ; B > C.
  const rows = [
    { File: "A", parent: "" },
    { File: "B", parent: "[[A]]" },
    { File: "C", parent: "[[B]]" },
    { File: "D", parent: "[[A]]" },
  ];
  const scope = (
    s: any,
    matchFiles: string[]
  ): string[] => {
    const set = new Set(matchFiles);
    return scopeRowsByFilter({
      rows,
      matches: (r) => set.has(r.File),
      parentKey: "parent",
      pathKey: "File",
      scope: s,
    }).map((r) => r.File);
  };

  it("parentsAndSubItems == today: exactly the matching rows, input order", () => {
    expect(scope("parentsAndSubItems", ["B", "D"])).toEqual(["B", "D"]);
    expect(scope("parentsAndSubItems", [])).toEqual([]);
  });

  it("empty filter (everything matches) -> all rows unchanged, every scope", () => {
    const all = ["A", "B", "C", "D"];
    for (const s of ["parentsAndSubItems", "parents", "subItems"] as const) {
      expect(scope(s, all)).toEqual(all);
    }
  });

  it("parents: a match keeps its ANCESTOR spine (B -> {A,B})", () => {
    expect(scope("parents", ["B"])).toEqual(["A", "B"]); // input order
  });

  it("parents: deep match pulls the full ancestor chain (C -> {A,B,C})", () => {
    expect(scope("parents", ["C"])).toEqual(["A", "B", "C"]);
  });

  it("parents: a matching parent does NOT pull non-matching children (A -> {A})", () => {
    expect(scope("parents", ["A"])).toEqual(["A"]);
  });

  it("subItems: a matching parent reveals its whole subtree (B -> {B,C})", () => {
    expect(scope("subItems", ["B"])).toEqual(["B", "C"]);
  });

  it("subItems: a matching parent pulls all descendants (A -> {A,B,C,D})", () => {
    expect(scope("subItems", ["A"])).toEqual(["A", "B", "C", "D"]);
  });

  it("subItems: a deep-only match shows just itself (C -> {C})", () => {
    expect(scope("subItems", ["C"])).toEqual(["C"]);
  });

  it("symmetry: default == parents ∩ subItems for match {B}", () => {
    const p = scope("parents", ["B"]); // {A,B}
    const s = scope("subItems", ["B"]); // {B,C}
    const d = scope("parentsAndSubItems", ["B"]); // {B}
    expect(d).toEqual(p.filter((x) => s.includes(x)));
  });

  it("resolveLink parity: a bare basename match resolves like buildRowTree", () => {
    const r2 = [
      { File: "Tasks/A.md", parent: "" },
      { File: "Tasks/B.md", parent: "[[A]]" },
    ];
    const out = scopeRowsByFilter({
      rows: r2,
      matches: (x) => x.File === "Tasks/B.md",
      parentKey: "parent",
      pathKey: "File",
      resolveLink: (link: string) => `Tasks/${link}.md`,
      scope: "parents",
    }).map((x) => x.File);
    expect(out).toEqual(["Tasks/A.md", "Tasks/B.md"]); // parent pulled via resolution
  });

  it("cycle: P<->Q, match P -> finite output (both scopes terminate)", () => {
    const cyc = [
      { File: "P", parent: "[[Q]]" },
      { File: "Q", parent: "[[P]]" },
    ];
    const run = (s: any) =>
      scopeRowsByFilter({
        rows: cyc,
        matches: (r) => r.File === "P",
        parentKey: "parent",
        pathKey: "File",
        scope: s,
      })
        .map((r) => r.File)
        .sort();
    expect(run("parents")).toEqual(["P", "Q"]);
    expect(run("subItems")).toEqual(["P", "Q"]);
  });
});
