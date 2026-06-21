// ===========================================================================
// DEPTH (Long Autonomous Mode, Notidian-9xba) — adversarial/characterization
// net for the frame-editor layout-mutation AUTHORITY,
// src/core/utils/frames/editor/dropFrame.ts.
//
// WHAT IT IS. dropFrame.ts is NOTEST. Its sole export
//
//   dropFrame(_activeNode, overNode, root, nodes, direction) -> [saveNodes, deleteNodes]
//
// is a PURE function (no superstate / IO / async) that decides EVERY layout
// mutation the frame editor commits when a node is dropped: it rewrites
// parentIds, recomputes ranks, splits elements into Notidian column/container
// structures, reorders siblings, and runs a delete/collapse cascade that tears
// down emptied columns and containers. A frame is a render-path surface named
// in the AGENTS.md safety invariants; a miscomputed rank, a dropped or
// duplicated node, a wrong parentId, or a botched collapse silently CORRUPTS a
// persisted frame definition. There was ZERO direct coverage.
//
// WHY HERE / DEPS. dropFrame is offline-verifiable and pure, so it is pinned
// against its LIVE behavior. Its dependencies are pure and unit-tested in
// isolation already — relinkProps (linker.test.ts), findParent
// (ast.treeOps.test.ts), uniqueNameFromString / insert (array.test.ts).
// newUniqueNode has no direct suite and is EXERCISED THROUGH dropFrame here
// (the column/container split builds its new nodes with it). The kit seeds
// columnsNode / columnNode (schemas/kits/base.ts) flow through verbatim.
//
// METHOD (AGENTS.md Long Autonomous Mode, ast.treeOps.test.ts convention).
// Pure offline characterization with small FrameTreeNode/FrameNode fixtures.
// Where the observed behavior is the CORRECT contract (id-unique relink,
// schemaId restamp, $root rewrite, inside-reparent, the column-split matrix,
// the sibling reorder reindex, the delete/collapse cascade) it is asserted AS
// the contract. Where the behavior is a witnessed sharp edge worth locking
// (collapse-reparented nodes all inherit the CONTAINER's rank with no reindex;
// the collapsed container node is emitted into BOTH saveNodes and deleteNodes;
// the self-drop guard compares the POST-relink id; relinkProps appends a
// trailing `;` to rewritten prop code) it is pinned with an explanatory comment
// so a regression trips HERE, where the corruption originates, not in the vault.
//
// No new sinks (ADR 0017): this file imports and exercises existing pure
// helpers only.
// ===========================================================================

import { dropFrame } from "core/utils/frames/editor/dropFrame";
import { FrameEditorMode, FrameTreeNode } from "shared/types/frameExec";
import { FrameNode } from "shared/types/mframe";
import { Edges } from "shared/types/Pos";

// --------------------------------------------------------------------------
// Fixture builders. A FrameNode is the flat persisted record; a FrameTreeNode
// wraps it with tree wiring (children[], editorProps) — dropFrame reads the
// TREE for structure (findParent walks children) and the FLAT `nodes` array
// for sibling/rank math, so fixtures keep the two consistent. We default a
// node's schemaId/parentId to "root" so the cross-schema relink branch (which
// fires only when activeNode.schemaId != root.id) stays OFF unless a test
// opts into it explicitly.
// --------------------------------------------------------------------------

const node = (id: string, extra: Partial<FrameNode> = {}): FrameNode => ({
  id,
  type: "group",
  rank: 0,
  schemaId: "root",
  parentId: "root",
  ...extra,
});

const treeNode = (
  n: FrameNode,
  children: FrameTreeNode[] = [],
  editMode: FrameEditorMode = FrameEditorMode.Read
): FrameTreeNode => ({
  id: n.id,
  node: n,
  isRef: false,
  children,
  editorProps: { editMode },
  parent: null,
});

// Wire each child's .parent back-reference, recursively (buildFrameTree does
// this; dropFrame's helpers do not rely on it, but we keep fixtures faithful).
const wireParents = (root: FrameTreeNode): FrameTreeNode => {
  for (const child of root.children) {
    child.parent = root;
    wireParents(child);
  }
  return root;
};

// Collect every flat FrameNode from a tree (pre-order) for the `nodes` arg.
const flatten = (t: FrameTreeNode): FrameNode[] => [
  t.node,
  ...t.children.flatMap(flatten),
];

// A root TreeNode whose own id is the schema id ("root"), so the cross-schema
// branch is off for same-schema active nodes.
const rootTree = (
  children: FrameTreeNode[],
  editMode: FrameEditorMode = FrameEditorMode.Read
): FrameTreeNode => {
  const root = treeNode(
    node("root", { parentId: "", schemaId: "root", rank: 0 }),
    children,
    editMode
  );
  return wireParents(root);
};

// Convenience: run a drop and project save/delete to compact shapes.
const drop = (
  active: FrameNode,
  over: FrameTreeNode,
  root: FrameTreeNode,
  nodes: FrameNode[],
  direction: Edges
) => {
  const [save, del] = dropFrame(active, over, root, nodes, direction) as [
    FrameNode[],
    FrameNode[]
  ];
  return { save, del };
};
const shape = (ns: FrameNode[]) =>
  ns.map((n) => ({ id: n.id, rank: n.rank, parentId: n.parentId }));
const ids = (ns: FrameNode[]) => ns.map((n) => n.id);

// ==========================================================================
// Self-drop guard. Dropping a node onto itself is a no-op: [[], []]. NOTE the
// guard compares activeNode.id == overNode.id AFTER the cross-schema relink,
// so it is the post-relink id that matters (a cross-schema clone can never
// equal the over id because it is freshly de-duplicated — exercised below).
// ==========================================================================
describe("dropFrame — self-drop guard", () => {
  it("returns [[], []] when active is dropped onto itself", () => {
    const a = treeNode(node("a", { rank: 0 }));
    const root = rootTree([a], FrameEditorMode.Frame);
    const { save, del } = drop(node("a"), a, root, flatten(root), "right");
    expect(save).toEqual([]);
    expect(del).toEqual([]);
  });

  it("returns [[], []] for every direction when over IS active", () => {
    const a = treeNode(node("a", { rank: 0 }));
    const root = rootTree([a], FrameEditorMode.Frame);
    for (const d of ["top", "bottom", "left", "right", "inside"] as Edges[]) {
      expect(dropFrame(node("a"), a, root, flatten(root), d)).toEqual([[], []]);
    }
  });
});

// ==========================================================================
// Missing over-parent guard. If the over node has no parent in the tree
// (e.g. the over id is unknown / is the root), findParent returns null and
// dropFrame bails out with [[], []] rather than mutating anything.
// ==========================================================================
describe("dropFrame — missing over-parent guard", () => {
  it("returns [[], []] when overNode has no parent in the tree", () => {
    const a = treeNode(node("a", { rank: 0 }));
    const root = rootTree([a], FrameEditorMode.Frame);
    // `over` is a detached node whose id is not a child of anything in root.
    const orphan = treeNode(node("orphan", { rank: 0 }));
    const { save, del } = drop(
      node("a"),
      orphan,
      root,
      flatten(root),
      "right"
    );
    expect(save).toEqual([]);
    expect(del).toEqual([]);
  });
});

// ==========================================================================
// (a) Cross-schema relink. When activeNode.schemaId != root.id, dropFrame:
//   1. rewrites the "$root" sentinel parent/refs/props to the real root.id,
//   2. de-duplicates the active id against existing `nodes` ids
//      (uniqueNameFromString), re-pointing the node's own props to the new id,
//   3. stamps schemaId = root.id.
// This is the rename-corruption-adjacent path (the frame bug class in the
// AGENTS.md invariants): a botched relink persists a node that references a
// foreign schema or a colliding id.
// ==========================================================================
describe("dropFrame — (a) cross-schema relink", () => {
  // Build a frame with an existing node "widget" so a foreign active node that
  // also calls itself "widget" is forced to a unique id.
  const buildCollisionTree = () => {
    const ex = treeNode(node("widget", { rank: 0 }));
    const over = treeNode(node("over", { rank: 1 }));
    return rootTree([ex, over], FrameEditorMode.Frame);
  };

  it("de-duplicates a colliding foreign id (widget -> widget1) and restamps schemaId", () => {
    const root = buildCollisionTree();
    const over = root.children[1];
    const foreign: FrameNode = {
      id: "widget",
      type: "group",
      rank: 0,
      schemaId: "other-schema",
      parentId: "$root",
    };
    const { save } = drop(foreign, over, root, flatten(root), "right");
    const moved = save.find((n) => n.id === "widget1");
    expect(moved).toBeDefined();
    // restamped onto THIS frame's schema...
    expect(moved!.schemaId).toBe("root");
    // ...and the pre-existing "widget" is untouched as a separate node.
    expect(save.some((n) => n.id === "widget")).toBe(true);
  });

  it("rewrites the $root parent sentinel to the real root.id", () => {
    const root = buildCollisionTree();
    const over = root.children[1];
    const foreign: FrameNode = {
      id: "unique-id",
      type: "group",
      rank: 0,
      schemaId: "other-schema",
      parentId: "$root",
    };
    const { save } = drop(foreign, over, root, flatten(root), "right");
    const moved = save.find((n) => n.id === "unique-id")!;
    // The reorder branch then re-parents it to over's parent (root); the point
    // is the $root sentinel never survives onto a persisted node.
    expect(moved.parentId).toBe("root");
    expect(save.every((n) => n.parentId !== "$root")).toBe(true);
  });

  it("rewrites $root inside prop code (sharp edge: relinkProps re-emits with a trailing ';')", () => {
    // relinkProps runs the prop strings through preprocessCode, which parses and
    // re-generates them — re-emitting "$root.foo" as "root.foo;" (the AST printer
    // adds the statement terminator). We PIN that exact form: a regression that
    // changes the re-emission (or fails to rewrite $root in props) trips here.
    const root = buildCollisionTree();
    const over = root.children[1];
    const foreign: FrameNode = {
      id: "calc",
      type: "group",
      rank: 0,
      schemaId: "other-schema",
      parentId: "$root",
      props: { value: "$root.foo" },
    };
    const { save } = drop(foreign, over, root, flatten(root), "right");
    const moved = save.find((n) => n.id === "calc")!;
    expect(moved.props!.value).toBe("root.foo;");
  });

  it("leaves a SAME-schema active node entirely unrelinked (branch stays off)", () => {
    // schemaId == root.id ("root") -> the whole relink block is skipped, so id,
    // schemaId, and props pass through untouched into the layout math.
    const a = treeNode(node("a", { rank: 0 }));
    const over = treeNode(node("over", { rank: 1 }));
    const root = rootTree([a, over], FrameEditorMode.Frame);
    const active = node("a", { props: { value: "$root.foo" } });
    const { save } = drop(active, over, root, flatten(root), "right");
    const moved = save.find((n) => n.id === "a")!;
    // not de-duplicated, schemaId unchanged, props NOT preprocessed.
    expect(moved.id).toBe("a");
    expect(moved.schemaId).toBe("root");
    expect(moved.props!.value).toBe("$root.foo");
  });
});

// ==========================================================================
// (b) direction == 'inside' reparent. The simplest branch: emit a single node
// that is the active node re-parented to the OVER node's id, with EVERY other
// field (rank included) carried through unchanged. No rank recompute, no
// sibling touch.
// ==========================================================================
describe("dropFrame — (b) direction='inside' reparent", () => {
  it("re-parents active under over, preserving its rank and other fields", () => {
    const box = treeNode(node("box", { rank: 0 }));
    const a = treeNode(node("a", { rank: 7, name: "Alpha" }));
    const root = rootTree([box, a], FrameEditorMode.Frame);
    const { save, del } = drop(
      node("a", { rank: 7, name: "Alpha" }),
      box,
      root,
      flatten(root),
      "inside"
    );
    expect(save.length).toBe(1);
    expect(save[0]).toMatchObject({
      id: "a",
      parentId: "box",
      rank: 7,
      name: "Alpha",
    });
    expect(del).toEqual([]);
  });

  it("emits exactly one node — siblings of over are not reindexed", () => {
    const box = treeNode(node("box", { rank: 0 }));
    const sib = treeNode(node("sib", { rank: 1 }));
    const a = treeNode(node("a", { rank: 2 }));
    const root = rootTree([box, sib, a], FrameEditorMode.Frame);
    const { save } = drop(node("a", { rank: 2 }), box, root, flatten(root), "inside");
    expect(save.map((n) => n.id)).toEqual(["a"]);
  });
});

// ==========================================================================
// (c) The column / container split matrix. Triggered when the over node is a
// column, OR (in Page editor mode) when the over node is a base-level child of
// the root being dropped left/right. The matrix splits on:
//   createColumnContainer = baseLevelNode && !containerType
//   insertColumn          = (baseLevelNode && containerType)
//                            || (columnType && columnContainerIsBaseLevel)
// ==========================================================================
describe("dropFrame — (c) column/container split matrix", () => {
  // --- createColumnContainer: drop a plain base-level element next to another
  // plain base-level element (Page mode, left/right). A brand-new container +
  // two columns are minted; over and active are tucked one per column. ---
  describe("createColumnContainer (base-level non-container, Page left/right)", () => {
    const buildPage = (overRank = 5) => {
      const a = treeNode(node("a", { rank: 0 }));
      const b = treeNode(node("b", { rank: overRank }));
      return rootTree([a, b], FrameEditorMode.Page);
    };

    it("mints container+2 columns; LEFT puts active's column at rank 0, over's at rank 1", () => {
      const root = buildPage();
      const over = root.children[1]; // b, rank 5
      const { save } = drop(node("a"), over, root, flatten(root), "left");
      const byId = Object.fromEntries(save.map((n) => [n.id, n]));
      // container inherits over's rank, parented to over's parent (root).
      expect(byId["container"]).toMatchObject({ parentId: "root", rank: 5 });
      // LEFT: column holding OVER gets rank 1, column holding ACTIVE gets rank 0.
      expect(byId["column"]).toMatchObject({ parentId: "container", rank: 1 });
      expect(byId["column1"]).toMatchObject({ parentId: "container", rank: 0 });
      // over goes into the rank-1 column ("column"), active into the rank-0 one.
      expect(byId["b"]).toMatchObject({ parentId: "column", rank: 0 });
      expect(byId["a"]).toMatchObject({ parentId: "column1", rank: 0 });
    });

    it("RIGHT flips the column ranks: active's column rank 1, over's rank 0", () => {
      const root = buildPage();
      const over = root.children[1];
      const { save } = drop(node("a"), over, root, flatten(root), "right");
      const byId = Object.fromEntries(save.map((n) => [n.id, n]));
      expect(byId["column"]).toMatchObject({ rank: 0 }); // holds over (b)
      expect(byId["column1"]).toMatchObject({ rank: 1 }); // holds active (a)
      expect(byId["b"]).toMatchObject({ parentId: "column", rank: 0 });
      expect(byId["a"]).toMatchObject({ parentId: "column1", rank: 0 });
    });

    it("emits exactly the 5 split nodes (container, 2 columns, over, active)", () => {
      const root = buildPage();
      const over = root.children[1];
      const { save, del } = drop(node("a"), over, root, flatten(root), "left");
      expect(save.map((n) => n.id).sort()).toEqual(
        ["a", "b", "column", "column1", "container"].sort()
      );
      expect(del).toEqual([]);
    });
  });

  // --- insertColumn: over is already a column whose container is base-level, OR
  // over is a base-level container. A single new column is minted beside it and
  // the active node is dropped into that new column. ---
  describe("insertColumn (existing container / column at base level)", () => {
    // root -> container c -> [col1->el1, col2->el2]
    const buildColumns = () => {
      const el1 = treeNode(node("el1", { rank: 0, parentId: "col1" }));
      const col1 = treeNode(
        node("col1", { type: "column", rank: 0, parentId: "c" }),
        [el1]
      );
      const el2 = treeNode(node("el2", { rank: 0, parentId: "col2" }));
      const col2 = treeNode(
        node("col2", { type: "column", rank: 1, parentId: "c" }),
        [el2]
      );
      const c = treeNode(
        node("c", { type: "container", rank: 0, parentId: "root" }),
        [col1, col2]
      );
      return rootTree([c], FrameEditorMode.Page);
    };

    it("dropping onto a COLUMN (right) inserts a new column at overRank+1 holding active", () => {
      const root = buildColumns();
      const col1 = root.children[0].children[0]; // rank 0
      const { save } = drop(
        node("act", { parentId: "elsewhere" }),
        col1,
        root,
        flatten(root),
        "right"
      );
      const byId = Object.fromEntries(save.map((n) => [n.id, n]));
      // new column parented to the CONTAINER, rank = overRank + 1.
      expect(byId["column"]).toMatchObject({ parentId: "c", rank: 1, type: "column" });
      expect(byId["act"]).toMatchObject({ parentId: "column" });
      // exactly the new column + the moved active node; nothing else.
      expect(save.map((n) => n.id).sort()).toEqual(["act", "column"].sort());
    });

    it("dropping onto a COLUMN (left) inserts at the column's own rank", () => {
      const root = buildColumns();
      const col2 = root.children[0].children[1]; // rank 1
      const { save } = drop(
        node("act", { parentId: "elsewhere" }),
        col2,
        root,
        flatten(root),
        "left"
      );
      const byId = Object.fromEntries(save.map((n) => [n.id, n]));
      expect(byId["column"]).toMatchObject({ parentId: "c", rank: 1 });
    });

    it("dropping onto the CONTAINER (right) appends a column at children.length", () => {
      const root = buildColumns();
      const c = root.children[0]; // container, 2 columns
      const { save } = drop(
        node("act", { parentId: "elsewhere" }),
        c,
        root,
        flatten(root),
        "right"
      );
      const byId = Object.fromEntries(save.map((n) => [n.id, n]));
      // append => rank == over.children.length == 2.
      expect(byId["column"]).toMatchObject({ parentId: "c", rank: 2 });
      expect(byId["act"]).toMatchObject({ parentId: "column" });
    });

    it("dropping onto the CONTAINER (left) prepends a column at rank 0", () => {
      const root = buildColumns();
      const c = root.children[0];
      const { save } = drop(
        node("act", { parentId: "elsewhere" }),
        c,
        root,
        flatten(root),
        "left"
      );
      const byId = Object.fromEntries(save.map((n) => [n.id, n]));
      expect(byId["column"]).toMatchObject({ parentId: "c", rank: 0 });
    });
  });
});

// ==========================================================================
// (d) The else-branch sibling reorder. When the drop is neither inside nor a
// column split, dropFrame reorders the over node's siblings: take all flat
// nodes whose parentId == overParent.id (minus the active node), sort by rank,
// reindex 0..n, find over's NEW rank, insert the active node at overRank
// (top/left) or overRank+1 (bottom/right), then reindex again. Active is
// re-parented to over's parentId.
// ==========================================================================
describe("dropFrame — (d) sibling reorder (filter/sort/reindex/insert)", () => {
  // Three same-level siblings x0,x1,x2 under root (Frame mode, no column split).
  const buildSiblings = () => {
    const x0 = treeNode(node("x0", { rank: 0 }));
    const x1 = treeNode(node("x1", { rank: 1 }));
    const x2 = treeNode(node("x2", { rank: 2 }));
    return rootTree([x0, x1, x2], FrameEditorMode.Frame);
  };

  it("moving x0 to the RIGHT of x1 yields contiguous ranks [x1=0, x0=1, x2=2]", () => {
    const root = buildSiblings();
    const x1 = root.children[1];
    const { save } = drop(node("x0"), x1, root, flatten(root), "right");
    expect(shape(save)).toEqual([
      { id: "x1", rank: 0, parentId: "root" },
      { id: "x0", rank: 1, parentId: "root" },
      { id: "x2", rank: 2, parentId: "root" },
    ]);
  });

  it("'bottom' behaves like 'right' (insert AFTER over)", () => {
    const root = buildSiblings();
    const x1 = root.children[1];
    const { save } = drop(node("x0"), x1, root, flatten(root), "bottom");
    expect(ids(save)).toEqual(["x1", "x0", "x2"]);
  });

  it("moving x2 to the LEFT of x0 puts it first: [x2=0, x0=1, x1=2]", () => {
    const root = buildSiblings();
    const x0 = root.children[0];
    const { save } = drop(node("x2"), x0, root, flatten(root), "left");
    expect(shape(save)).toEqual([
      { id: "x2", rank: 0, parentId: "root" },
      { id: "x0", rank: 1, parentId: "root" },
      { id: "x1", rank: 2, parentId: "root" },
    ]);
  });

  it("'top' behaves like 'left' (insert BEFORE over)", () => {
    const root = buildSiblings();
    const x0 = root.children[0];
    const { save } = drop(node("x2"), x0, root, flatten(root), "top");
    expect(ids(save)).toEqual(["x2", "x0", "x1"]);
  });

  it("reindexes to contiguous 0..n even when source ranks are sparse/duplicated", () => {
    // Sparse, duplicated input ranks must collapse to a clean 0..n ordering.
    const y0 = treeNode(node("y0", { rank: 10 }));
    const y1 = treeNode(node("y1", { rank: 10 }));
    const y2 = treeNode(node("y2", { rank: 50 }));
    const root = rootTree([y0, y1, y2], FrameEditorMode.Frame);
    const over = root.children[2]; // y2
    const { save } = drop(node("y0", { rank: 10 }), over, root, flatten(root), "left");
    // sorted-by-rank survivors are [y1, y2] -> reindex [y1=0, y2=1]; over (y2)
    // is at rank 1; left => insert active at rank 1; final reindex 0..2.
    expect(save.every((n) => Number.isInteger(n.rank))).toBe(true);
    expect(save.map((n) => n.rank).sort()).toEqual([0, 1, 2]);
    expect(new Set(save.map((n) => n.rank)).size).toBe(3); // no dup ranks
  });

  it("re-parents the active node to over's parentId during reorder", () => {
    // active currently lives under a different parent; reorder moves it to be a
    // sibling of over (root's child).
    const x0 = treeNode(node("x0", { rank: 0 }));
    const x1 = treeNode(node("x1", { rank: 1 }));
    const root = rootTree([x0, x1], FrameEditorMode.Frame);
    const foreign = node("foreign", { parentId: "some-other-parent" });
    const { save } = drop(foreign, x1, root, flatten(root), "right");
    const moved = save.find((n) => n.id === "foreign")!;
    expect(moved.parentId).toBe("root");
  });

  it("does not duplicate the active node into the reordered set", () => {
    const root = buildSiblings();
    const x1 = root.children[1];
    const { save } = drop(node("x0"), x1, root, flatten(root), "right");
    expect(save.filter((n) => n.id === "x0").length).toBe(1);
  });
});

// ==========================================================================
// (e) The delete / collapse cascade. After the move, if the active node's
// FORMER parent was a column with exactly one child (the active node), that
// column is emptied and torn down:
//   - shouldDeleteColumn(parent): column with 1 child -> delete the column.
//   - shouldDeleteColumnContainer(container): container with 1 child -> ALSO
//     delete the container.
//   - shouldCollapseColumnContainer(container): container with 2 children ->
//     collapse: delete the OTHER column + the container, and reparent the other
//     column's grandchildren up to the ROOT.
// ==========================================================================
describe("dropFrame — (e) delete/collapse cascade", () => {
  it("deletes the emptied single-child column (no container teardown when container has >2)", () => {
    // container c with THREE columns; moving the sole child of col1 out deletes
    // only col1 (container has 3 children -> neither delete nor collapse).
    const act = treeNode(node("act", { rank: 0, parentId: "col1" }));
    const col1 = treeNode(node("col1", { type: "column", rank: 0, parentId: "c" }), [act]);
    const col2 = treeNode(node("col2", { type: "column", rank: 1, parentId: "c" }), [
      treeNode(node("o2", { rank: 0, parentId: "col2" })),
    ]);
    const col3 = treeNode(node("col3", { type: "column", rank: 2, parentId: "c" }), [
      treeNode(node("o3", { rank: 0, parentId: "col3" })),
    ]);
    const c = treeNode(node("c", { type: "container", rank: 1, parentId: "root" }), [
      col1,
      col2,
      col3,
    ]);
    const sib = treeNode(node("sib", { rank: 0, parentId: "root" }));
    const root = rootTree([sib, c], FrameEditorMode.Frame);
    const { del } = drop(
      node("act", { parentId: "col1" }),
      sib,
      root,
      flatten(root),
      "bottom"
    );
    expect(ids(del)).toEqual(["col1"]);
  });

  it("delete cascade: single-child column inside a single-column container tears down both", () => {
    // container c has ONE column col1 whose sole child is active. Moving active
    // out => shouldDeleteColumn(col1) AND shouldDeleteColumnContainer(c).
    const act = treeNode(node("act", { rank: 0, parentId: "col1" }));
    const col1 = treeNode(node("col1", { type: "column", rank: 0, parentId: "c" }), [act]);
    const c = treeNode(node("c", { type: "container", rank: 1, parentId: "root" }), [col1]);
    const sib = treeNode(node("sib", { rank: 0, parentId: "root" }));
    const root = rootTree([sib, c], FrameEditorMode.Frame);
    const { save, del } = drop(
      node("act", { parentId: "col1" }),
      sib,
      root,
      flatten(root),
      "bottom"
    );
    expect(ids(del)).toEqual(["col1", "c"]);
    // active landed beside sib at top level; the torn-down ids are not in save.
    expect(save.some((n) => n.id === "act")).toBe(true);
    expect(save.some((n) => n.id === "col1")).toBe(false);
  });

  it("collapse cascade: 2-column container collapses; sibling column's children reparent to root", () => {
    // container c has col1 (sole child active) + col2 (children o1,o2). Moving
    // active out empties col1 -> shouldCollapseColumnContainer(c) (2 children):
    // delete col1, col2, AND c; reparent o1,o2 up to root.
    const act = treeNode(node("act", { rank: 0, parentId: "col1" }));
    const col1 = treeNode(node("col1", { type: "column", rank: 0, parentId: "c" }), [act]);
    const o1 = treeNode(node("o1", { rank: 0, parentId: "col2" }));
    const o2 = treeNode(node("o2", { rank: 1, parentId: "col2" }));
    const col2 = treeNode(node("col2", { type: "column", rank: 1, parentId: "c" }), [o1, o2]);
    const c = treeNode(node("c", { type: "container", rank: 3, parentId: "root" }), [
      col1,
      col2,
    ]);
    const sib = treeNode(node("sib", { rank: 0, parentId: "root" }));
    const root = rootTree([sib, c], FrameEditorMode.Frame);

    const { save, del } = drop(
      node("act", { parentId: "col1" }),
      sib,
      root,
      flatten(root),
      "bottom"
    );

    // teardown: the emptied column, the surviving column, AND the container.
    expect(ids(del).sort()).toEqual(["c", "col1", "col2"].sort());

    // the surviving column's children are reparented up to root.
    const movedO1 = save.find((n) => n.id === "o1")!;
    const movedO2 = save.find((n) => n.id === "o2")!;
    expect(movedO1.parentId).toBe("root");
    expect(movedO2.parentId).toBe("root");
  });

  it("SHARP EDGE: collapse-reparented children inherit the CONTAINER's rank with no reindex", () => {
    // Both o1 and o2 are stamped rank = container.rank (3) on reparent — they are
    // NOT renumbered against root's existing children, so two nodes share a rank.
    // This is a witnessed edge of the reconciliation (moveToParentNodes uses
    // columnParentNode.node.rank for every moved node); pinned so a future
    // proper-reindex fix is a conscious, reviewed change.
    const act = treeNode(node("act", { rank: 0, parentId: "col1" }));
    const col1 = treeNode(node("col1", { type: "column", rank: 0, parentId: "c" }), [act]);
    const o1 = treeNode(node("o1", { rank: 0, parentId: "col2" }));
    const o2 = treeNode(node("o2", { rank: 1, parentId: "col2" }));
    const col2 = treeNode(node("col2", { type: "column", rank: 1, parentId: "c" }), [o1, o2]);
    const c = treeNode(node("c", { type: "container", rank: 3, parentId: "root" }), [
      col1,
      col2,
    ]);
    const sib = treeNode(node("sib", { rank: 0, parentId: "root" }));
    const root = rootTree([sib, c], FrameEditorMode.Frame);

    const { save } = drop(
      node("act", { parentId: "col1" }),
      sib,
      root,
      flatten(root),
      "bottom"
    );
    const movedO1 = save.find((n) => n.id === "o1")!;
    const movedO2 = save.find((n) => n.id === "o2")!;
    expect(movedO1.rank).toBe(3);
    expect(movedO2.rank).toBe(3);
  });

  it("SHARP EDGE: the collapsed container is emitted into BOTH saveNodes and deleteNodes", () => {
    // During collapse the container node is reparented-to-root and left in
    // saveNodes (the moveToParentNodes reconciliation re-adds it) WHILE also
    // sitting in deleteNodes. The persistence layer applies deletes; this pins
    // that the container id appears on both lists so a dedup change is noticed.
    const act = treeNode(node("act", { rank: 0, parentId: "col1" }));
    const col1 = treeNode(node("col1", { type: "column", rank: 0, parentId: "c" }), [act]);
    const o1 = treeNode(node("o1", { rank: 0, parentId: "col2" }));
    const o2 = treeNode(node("o2", { rank: 1, parentId: "col2" }));
    const col2 = treeNode(node("col2", { type: "column", rank: 1, parentId: "c" }), [o1, o2]);
    const c = treeNode(node("c", { type: "container", rank: 3, parentId: "root" }), [
      col1,
      col2,
    ]);
    const sib = treeNode(node("sib", { rank: 0, parentId: "root" }));
    const root = rootTree([sib, c], FrameEditorMode.Frame);

    const { save, del } = drop(
      node("act", { parentId: "col1" }),
      sib,
      root,
      flatten(root),
      "bottom"
    );
    expect(del.some((n) => n.id === "c")).toBe(true);
    const savedC = save.find((n) => n.id === "c");
    expect(savedC).toBeDefined();
    expect(savedC!.parentId).toBe("root");
  });

  it("no cascade when the active node's former parent is NOT a column", () => {
    // active is a plain root child; moving it triggers no column teardown.
    const a = treeNode(node("a", { rank: 0 }));
    const b = treeNode(node("b", { rank: 1 }));
    const root = rootTree([a, b], FrameEditorMode.Frame);
    const { del } = drop(node("a"), b, root, flatten(root), "right");
    expect(del).toEqual([]);
  });

  it("no cascade when the emptied column still has another child", () => {
    // col1 has TWO children; moving one out leaves col1 with 1 -> NOT a delete
    // (shouldDeleteColumn checks children.length == 1, which is the count BEFORE
    // the move in the tree fixture; here the tree shows 2, so no teardown).
    const act = treeNode(node("act", { rank: 0, parentId: "col1" }));
    const keep = treeNode(node("keep", { rank: 1, parentId: "col1" }));
    const col1 = treeNode(node("col1", { type: "column", rank: 0, parentId: "c" }), [
      act,
      keep,
    ]);
    const col2 = treeNode(node("col2", { type: "column", rank: 1, parentId: "c" }), [
      treeNode(node("o2", { rank: 0, parentId: "col2" })),
    ]);
    const c = treeNode(node("c", { type: "container", rank: 1, parentId: "root" }), [
      col1,
      col2,
    ]);
    const sib = treeNode(node("sib", { rank: 0, parentId: "root" }));
    const root = rootTree([sib, c], FrameEditorMode.Frame);
    const { del } = drop(
      node("act", { parentId: "col1" }),
      sib,
      root,
      flatten(root),
      "bottom"
    );
    expect(del).toEqual([]);
  });
});
