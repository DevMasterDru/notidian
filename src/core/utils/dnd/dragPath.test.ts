import {
  getDragDepth,
  getMultiProjection,
  getProjection,
  DragProjection,
} from "./dragPath";
import { TreeNode } from "../../superstate/utils/spaces";
import { DropModifiers } from "../../react/components/Navigator/SpaceTree/SpaceTreeItem";

// ===========================================================================
// DEPTH (Notidian-79hh) — pure-projection characterization net for the
// navigator drag placement math in src/core/utils/dnd/dragPath.ts. This module
// had ZERO coverage yet it is the SOLE authority for WHERE a dragged path lands
// in the space tree: how deep (depth clamp) and under which parent (the
// getParentId ladder). SpaceTreeView.tsx feeds getDragDepth/getProjection on
// every drag move; dropPath.ts then mutates ranks/parents off the result.
//
// These functions are pure: TreeNode[] in, a DragProjection (or null) out — no
// Superstate, no DOM, no async. So we lock the placement INVARIANTS directly:
//
//   1. DEPTH CLAMP — the returned depth never escapes [minDepth, maxDepth]:
//        getMaxDepth(prev,dirDown): null=>0; item.type=='space' && !collapsed
//          && dirDown => prev.depth+1; else prev.depth.
//        getMinDepth(prev): null=>0; else max(0, prev.depth-1).
//        activeItem.depth==0 (a top-level space being dragged) FORCES maxDepth 0
//          => such a drag can only ever land at the root.
//   2. PARENT RESOLUTION — getParentId() picks a parentId CONSISTENT with the
//        chosen depth, walking the previous item / a reverse-slice search.
//   3. getDragDepth is pure rounding (offset / indentationWidth).
//   4. getMultiProjection (paths.length>1) drops the whole selection under the
//        hovered container: a file hover resolves to its parent container; a
//        non-file hover is the container itself; a hover whose container is a
//        file => null (cannot drop a multi-selection onto a leaf file).
//
// NOTE on the two "type" fields TreeNode carries: getMaxDepth and the
// getParentId ladder read `node.item.type` (the underlying PathState kind,
// e.g. 'space'); the `insert`/`droppable`/getMultiProjection logic reads the
// TreeNode `type` ('file' | 'space' | ...). The fixtures set BOTH deliberately
// so the tests pin the real, distinct reads.
// ===========================================================================

// ---- minimal fixtures ----------------------------------------------------
// Only the fields the pure fns actually read are meaningful; the rest satisfy
// the TreeNode shape. A `node()` helper keeps each test's intent legible.

type NodeOpts = {
  id: string;
  depth: number;
  parentId?: string;
  type?: TreeNode["type"];
  itemType?: string; // underlying PathState .item.type
  collapsed?: boolean;
  sortable?: boolean;
  rank?: number;
};

const node = (o: NodeOpts): TreeNode =>
  ({
    id: o.id,
    parentId: o.parentId ?? null,
    depth: o.depth,
    index: 0,
    space: "root",
    sortable: o.sortable ?? false,
    type: o.type ?? "space",
    path: o.id,
    childrenCount: 0,
    collapsed: o.collapsed ?? false,
    rank: o.rank ?? 0,
    item: { type: o.itemType ?? o.type ?? "space" } as TreeNode["item"],
  } as TreeNode);

const MOVE: DropModifiers = "move";

// =========================================================================
// getDragDepth — pure rounding
// =========================================================================
describe("getDragDepth — offset / indentationWidth rounding", () => {
  const W = 24;

  it("rounds an exact multiple to that depth", () => {
    expect(getDragDepth(0, W)).toBe(0);
    expect(getDragDepth(24, W)).toBe(1);
    expect(getDragDepth(48, W)).toBe(2);
    expect(getDragDepth(72, W)).toBe(3);
  });

  it("rounds to the NEAREST indentation step (round-half-up)", () => {
    expect(getDragDepth(11, W)).toBe(0); // 0.458 -> 0
    expect(getDragDepth(12, W)).toBe(1); // 0.5  -> 1 (Math.round half-up)
    expect(getDragDepth(13, W)).toBe(1); // 0.541 -> 1
    expect(getDragDepth(35, W)).toBe(1); // 1.458 -> 1
    expect(getDragDepth(36, W)).toBe(2); // 1.5  -> 2
  });

  it("rounds negative offsets per Math.round (note: -0.5 rounds to -0, not -1)", () => {
    expect(getDragDepth(-11, W)).toBeCloseTo(0); // -0.458 -> -0
    expect(getDragDepth(-12, W)).toBeCloseTo(0); // -0.5 -> -0 (Math.round half-up)
    expect(getDragDepth(-13, W)).toBe(-1); // -0.541 -> -1
    expect(getDragDepth(-36, W)).toBe(-1); // -1.5 -> -1 (Math.round rounds toward +inf)
    expect(getDragDepth(-37, W)).toBe(-2); // -1.541 -> -2
  });

  it("is pure: identical inputs give identical output", () => {
    expect(getDragDepth(37, W)).toBe(getDragDepth(37, W));
  });
});

// Math.round(-0.5) is -0 in JS, not -1 — pin the exact platform behavior so the
// clamp (which later floors negatives to minDepth>=0) is understood end to end.
describe("getDragDepth — Math.round(-0.5) platform quirk", () => {
  it("Math.round(-0.5) === -0 (so -12/24 rounds to -0, which is == 0)", () => {
    expect(Object.is(getDragDepth(-12, 24), -0)).toBe(true);
    expect(getDragDepth(-12, 24)).toBeCloseTo(0);
    expect(getDragDepth(-12, 24) === 0).toBe(true); // -0 === 0 is true
  });
});

// =========================================================================
// getProjection — degenerate / guard paths
// =========================================================================
describe("getProjection — empty / missing guards", () => {
  it("returns null when no paths are being dragged", () => {
    const items = [node({ id: "a", depth: 0 })];
    expect(
      getProjection(items[0], items, [], 0, 0, 0, true, MOVE, "root")
    ).toBeNull();
  });

  it("returns undefined when the over index has no previous item", () => {
    const items = [node({ id: "a", depth: 0 })];
    // overItemIndex out of range => previousItem undefined => early return
    const r = getProjection(
      items[0],
      items,
      ["a"],
      5,
      0,
      0,
      true,
      MOVE,
      "root"
    );
    expect(r).toBeUndefined();
  });
});

// =========================================================================
// getProjection — DEPTH CLAMP invariants (single-path drags)
// =========================================================================
describe("getProjection — depth clamp to [minDepth, maxDepth]", () => {
  // A flat list of leaf files at depth 1 under a single space. previousItem is
  // a depth-1 file: maxDepth=1 (not a space), minDepth=max(0,1-1)=0.
  const items: TreeNode[] = [
    node({ id: "s", depth: 0, type: "space", itemType: "space" }),
    node({
      id: "s/a",
      depth: 1,
      parentId: "s",
      type: "file",
      itemType: "file",
      sortable: true,
    }),
    node({
      id: "s/b",
      depth: 1,
      parentId: "s",
      type: "file",
      itemType: "file",
      sortable: true,
    }),
  ];
  const active = node({ id: "drag", depth: 1, type: "file", itemType: "file" });

  it("a too-deep dragDepth is clamped DOWN to maxDepth", () => {
    // over the first file (index 1); requested depth 9 -> clamps to maxDepth=1
    const p = getProjection(active, items, ["drag"], 1, 9, 0, true, MOVE, "s");
    expect(p.depth).toBe(1);
    expect(p.depth).toBeLessThanOrEqual(1);
  });

  it("a negative dragDepth is clamped UP to minDepth", () => {
    const p = getProjection(active, items, ["drag"], 1, -5, 0, true, MOVE, "s");
    expect(p.depth).toBe(0);
    expect(p.depth).toBeGreaterThanOrEqual(0);
  });

  it("an in-range dragDepth passes through unchanged", () => {
    const p = getProjection(active, items, ["drag"], 1, 0, 0, true, MOVE, "s");
    expect(p.depth).toBe(0); // 0 is within [0,1]
  });

  // INVARIANT SWEEP: across every requested depth, the result stays in range.
  it("INVARIANT: depth never escapes [minDepth, maxDepth] for any request", () => {
    for (let req = -4; req <= 8; req++) {
      const p = getProjection(
        active,
        items,
        ["drag"],
        1,
        req,
        0,
        true,
        MOVE,
        "s"
      );
      // minDepth=0, maxDepth=1 here
      expect(p.depth).toBeGreaterThanOrEqual(0);
      expect(p.depth).toBeLessThanOrEqual(1);
    }
  });
});

describe("getProjection — maxDepth grows by 1 over an open space when dragging DOWN", () => {
  // previousItem is an expanded (not collapsed) space; dirDown => maxDepth = depth+1.
  const items: TreeNode[] = [
    node({
      id: "open",
      depth: 0,
      type: "space",
      itemType: "space",
      collapsed: false,
    }),
    node({
      id: "open/child",
      depth: 1,
      parentId: "open",
      type: "file",
      itemType: "file",
      sortable: true,
    }),
  ];
  const active = node({ id: "drag", depth: 1, type: "file", itemType: "file" });

  it("dragging DOWN onto an open space allows depth = space.depth + 1 (nest inside)", () => {
    const p = getProjection(active, items, ["drag"], 0, 5, 0, true, MOVE, "open");
    expect(p.depth).toBe(1); // maxDepth = 0 + 1
    // and the parent becomes the space itself (nesting)
    expect(p.parentId).toBe("open");
  });

  it("dragging UP onto the same open space caps maxDepth at the space's own depth", () => {
    // dirDown=false => getMaxDepth returns previousItem.depth (0), no +1
    const p = getProjection(
      active,
      items,
      ["drag"],
      0,
      5,
      0,
      false,
      MOVE,
      "open"
    );
    expect(p.depth).toBe(0);
  });

  it("over a COLLAPSED space, even dragging down does NOT add a nesting level", () => {
    const collapsedItems: TreeNode[] = [
      node({
        id: "shut",
        depth: 0,
        type: "space",
        itemType: "space",
        collapsed: true,
        sortable: true,
      }),
    ];
    const p = getProjection(
      active,
      collapsedItems,
      ["drag"],
      0,
      5,
      0,
      true,
      MOVE,
      "shut"
    );
    expect(p.depth).toBe(0); // maxDepth = previousItem.depth (no +1 when collapsed)
  });
});

describe("getProjection — a depth-0 active item is pinned to the root (maxDepth forced 0)", () => {
  // When the dragged item is itself a top-level space (depth 0), maxDepth is
  // hard-forced to 0 regardless of what's under the cursor: it can only land at
  // the root, never nested.
  const items: TreeNode[] = [
    node({
      id: "open",
      depth: 0,
      type: "space",
      itemType: "space",
      collapsed: false,
      sortable: true,
    }),
    node({
      id: "open/child",
      depth: 1,
      parentId: "open",
      type: "file",
      itemType: "file",
      sortable: true,
    }),
  ];
  const activeTopLevel = node({
    id: "drag",
    depth: 0,
    type: "space",
    itemType: "space",
  });

  it("forces depth 0 even over an open space and a deep dragDepth", () => {
    const p = getProjection(
      activeTopLevel,
      items,
      ["drag"],
      0,
      9,
      0,
      true,
      MOVE,
      "root"
    );
    expect(p.depth).toBe(0);
    expect(p.parentId).toBeNull(); // depth 0 => getParentId returns null
  });
});

// =========================================================================
// getProjection — PARENT RESOLUTION (getParentId ladder)
// =========================================================================
describe("getProjection — getParentId ladder consistency with chosen depth", () => {
  it("depth 0 always yields a null parent (root placement)", () => {
    // overItem.sortable=true short-circuits the `sortable` `||` so the missing
    // nextItem is never read (see the last-droppable-row guard test below, where
    // the nextItem read is now null-safe via `nextItem?.sortable ?? false`).
    const items: TreeNode[] = [
      node({
        id: "s",
        depth: 0,
        type: "space",
        itemType: "space",
        sortable: true,
      }),
    ];
    const active = node({ id: "drag", depth: 1, type: "file", itemType: "file" });
    const p = getProjection(active, items, ["drag"], 0, 0, 0, true, MOVE, "root");
    expect(p.depth).toBe(0);
    expect(p.parentId).toBeNull();
  });

  it("hovering the last droppable row (no nextItem, non-sortable, no insert) is null-safe and returns sortable:false (Notidian-h5fi)", () => {
    // overItem/previousItem is a non-sortable, non-collapsed space at the END of
    // the list, so previousItemDroppable && !insert is true and the `sortable`
    // expression reaches the trailing `nextItem.sortable` read — but nextItem
    // (items[overItemIndex+1]) is undefined. This USED to throw a TypeError
    // mid-drag, aborting the projection useEffect. The guard
    // `nextItem?.sortable ?? false` makes the read null-safe, so we now get a
    // real projection (sortable resolves to false) instead of a crash.
    const items: TreeNode[] = [
      node({
        id: "s",
        depth: 0,
        type: "space",
        itemType: "space",
        sortable: false,
        collapsed: false,
      }),
    ];
    const active = node({ id: "drag", depth: 1, type: "file", itemType: "file" });
    const p = getProjection(active, items, ["drag"], 0, 0, 0, true, MOVE, "root");
    // No throw: the missing nextItem no longer aborts the projection.
    expect(p).not.toBeNull();
    // previousItemDroppable && !insert && (nextItem?.sortable ?? false)
    //   => true && true && false => sortable is false (overItem.sortable is also false).
    expect(p.sortable).toBe(false);
    // depth-0 root placement: depth clamps to 0, parent is null (getParentId).
    expect(p.depth).toBe(0);
    expect(p.parentId).toBeNull();
    // overItem.collapsed=false => insert is false.
    expect(p.insert).toBe(false);
  });

  it("depth == previousItem.depth => SIBLING: inherits previousItem.parentId", () => {
    // previousItem is a depth-1 file under 's'; landing at depth 1 makes the
    // dragged item a sibling => same parent 's'.
    const items: TreeNode[] = [
      node({ id: "s", depth: 0, type: "space", itemType: "space" }),
      node({
        id: "s/a",
        depth: 1,
        parentId: "s",
        type: "file",
        itemType: "file",
        sortable: true,
      }),
      node({
        id: "s/b",
        depth: 1,
        parentId: "s",
        type: "file",
        itemType: "file",
        sortable: true,
      }),
    ];
    const active = node({ id: "drag", depth: 1, type: "file", itemType: "file" });
    const p = getProjection(active, items, ["drag"], 1, 1, 0, true, MOVE, "s");
    expect(p.depth).toBe(1);
    expect(p.parentId).toBe("s"); // sibling of s/a => parent is s
  });

  it("depth > previousItem.depth over an OPEN SPACE => NEST: parent becomes previousItem.id", () => {
    const items: TreeNode[] = [
      node({
        id: "open",
        depth: 0,
        type: "space",
        itemType: "space",
        collapsed: false,
      }),
      node({
        id: "open/child",
        depth: 1,
        parentId: "open",
        type: "file",
        itemType: "file",
        sortable: true,
      }),
    ];
    const active = node({ id: "drag", depth: 1, type: "file", itemType: "file" });
    // dragging down, requested deep => depth clamps to 1 (= open.depth+1) > prev.depth(0)
    // and prev.item.type=='space' => the "depth>prev.depth" branch => parent = prev.id
    const p = getProjection(active, items, ["drag"], 0, 5, 0, true, MOVE, "open");
    expect(p.depth).toBe(1);
    expect(p.parentId).toBe("open");
  });

  it("depth > previousItem.depth but previousItem is NOT a space => inherits previousItem.parentId", () => {
    // previousItem is a depth-1 file. getMaxDepth(file)=1 so depth can't exceed
    // prev.depth here; to exercise the "prev not space" branch we need a case
    // where depth > prev.depth is still reachable — it is not via the clamp when
    // prev is a leaf file (maxDepth == prev.depth). So the reachable consistent
    // outcome over a leaf file is the SIBLING branch (depth==prev.depth).
    const items: TreeNode[] = [
      node({ id: "s", depth: 0, type: "space", itemType: "space" }),
      node({
        id: "s/a",
        depth: 1,
        parentId: "s",
        type: "file",
        itemType: "file",
        sortable: true,
      }),
      node({
        id: "s/b",
        depth: 1,
        parentId: "s",
        type: "file",
        itemType: "file",
        sortable: true,
      }),
    ];
    const active = node({ id: "drag", depth: 1, type: "file", itemType: "file" });
    const p = getProjection(active, items, ["drag"], 1, 9, 0, true, MOVE, "s");
    expect(p.depth).toBe(1);
    expect(p.parentId).toBe("s");
  });

  it("reverse-slice search: depth between prev levels resolves to a matching ancestor's parent", () => {
    // Tree (flattened, indices in []):
    //   [0] root space   depth 0
    //   [1] A (file)     depth 1  parent=root
    //   [2] B (open spc) depth 1  parent=root
    //   [3] B/c (file)   depth 2  parent=B
    // Hover over index 3 (B/c, depth 2). previousItem = B/c.
    //   maxDepth: B/c is a file => 2. minDepth: max(0,2-1)=1.
    // Request depth 1 (between): not 0; depth != prev.depth(2); not > prev.depth;
    // => reverse-slice over items[0..3) for depth==1 => first match scanning back
    //   is B (index 2, parentId=root) => parentId = root.
    const items: TreeNode[] = [
      node({ id: "root", depth: 0, type: "space", itemType: "space" }),
      node({
        id: "root/A",
        depth: 1,
        parentId: "root",
        type: "file",
        itemType: "file",
        sortable: true,
      }),
      node({
        id: "root/B",
        depth: 1,
        parentId: "root",
        type: "space",
        itemType: "space",
        collapsed: false,
        sortable: true,
      }),
      node({
        id: "root/B/c",
        depth: 2,
        parentId: "root/B",
        type: "file",
        itemType: "file",
        sortable: true,
      }),
    ];
    const active = node({ id: "drag", depth: 2, type: "file", itemType: "file" });
    const p = getProjection(active, items, ["drag"], 3, 1, 0, false, MOVE, "root");
    expect(p.depth).toBe(1);
    // chosen depth 1 => the parent must be a node whose children sit at depth 1,
    // i.e. the root-level container. Reverse search finds B's parentId = "root".
    expect(p.parentId).toBe("root");
  });

  it("INVARIANT: across all requested depths, parentId stays consistent with the resolved depth", () => {
    const items: TreeNode[] = [
      node({ id: "root", depth: 0, type: "space", itemType: "space" }),
      node({
        id: "root/A",
        depth: 1,
        parentId: "root",
        type: "file",
        itemType: "file",
        sortable: true,
      }),
      node({
        id: "root/B",
        depth: 1,
        parentId: "root",
        type: "space",
        itemType: "space",
        collapsed: false,
        sortable: true,
      }),
      node({
        id: "root/B/c",
        depth: 2,
        parentId: "root/B",
        type: "file",
        itemType: "file",
        sortable: true,
      }),
    ];
    const active = node({ id: "drag", depth: 2, type: "file", itemType: "file" });
    const byId = new Map(items.map((i) => [i.id, i]));
    for (let req = -3; req <= 6; req++) {
      const p = getProjection(
        active,
        items,
        ["drag"],
        3,
        req,
        0,
        false,
        MOVE,
        "root"
      );
      // depth-0 placement has a null parent; any non-null parent must exist in
      // the tree and (if it does) sit exactly one level above the chosen depth.
      if (p.depth === 0) {
        expect(p.parentId).toBeNull();
      } else if (p.parentId !== null) {
        const parent = byId.get(p.parentId);
        expect(parent).toBeDefined();
        // a child placed at depth d hangs off a parent at depth d-1
        expect(parent!.depth).toBe(p.depth - 1);
      }
    }
  });
});

// =========================================================================
// getProjection — derived flags: overId, copy, insert, droppable, reorder
// =========================================================================
describe("getProjection — derived projection fields", () => {
  const baseItems = (): TreeNode[] => [
    node({ id: "s", depth: 0, type: "space", itemType: "space" }),
    node({
      id: "s/a",
      depth: 1,
      parentId: "s",
      type: "file",
      itemType: "file",
      sortable: true,
    }),
    node({
      id: "s/b",
      depth: 1,
      parentId: "s",
      type: "file",
      itemType: "file",
      sortable: true,
    }),
  ];

  it("overId is the previousItem's id (the hovered row)", () => {
    const items = baseItems();
    const active = node({ id: "drag", depth: 1, type: "file", itemType: "file" });
    const p = getProjection(active, items, ["drag"], 1, 1, 0, true, MOVE, "s");
    expect(p.overId).toBe("s/a");
  });

  it("copy is true for 'link' or 'copy' modifiers, false for 'move'", () => {
    const items = baseItems();
    const active = node({ id: "drag", depth: 1, type: "file", itemType: "file" });
    const mk = (m: DropModifiers) =>
      getProjection(active, items, ["drag"], 1, 1, 0, true, m, "s");
    expect(mk("move").copy).toBe(false);
    expect(mk("link").copy).toBe(true);
    expect(mk("copy").copy).toBe(true);
  });

  it("insert is false when over a non-collapsed file row (sortable reorder, not nest)", () => {
    const items = baseItems();
    const active = node({ id: "drag", depth: 1, type: "file", itemType: "file" });
    const p = getProjection(active, items, ["drag"], 1, 1, 0, true, MOVE, "s");
    // over s/a (a file, not collapsed) => insert false
    expect(p.insert).toBe(false);
    expect(p.sortable).toBe(true); // overItem.sortable
  });

  it("insert is true when hovering a COLLAPSED droppable space with a depth>0 active item", () => {
    // previousItem = collapsed space (droppable, not a file). insert needs:
    //   activeItem.depth>0 && overItem.collapsed && previousItemDroppable &&
    //   (!overItem.sortable || dirDown && yOffset<=13 || !dirDown && yOffset>=13)
    // Use a NON-sortable collapsed space so the first disjunct (!sortable) holds.
    const items: TreeNode[] = [
      node({
        id: "shut",
        depth: 0,
        type: "space",
        itemType: "space",
        collapsed: true,
        sortable: false,
      }),
    ];
    const active = node({ id: "drag", depth: 1, type: "file", itemType: "file" });
    const p = getProjection(active, items, ["drag"], 0, 0, 0, true, MOVE, "shut");
    expect(p.insert).toBe(true);
    // insert => reorder reflects whether active already lived under overItem
    expect(p.reorder).toBe(false); // active.parentId (null) != overItem.id ('shut')
  });

  it("insert reorder=true when the dragged item already belonged to the collapsed target", () => {
    const items: TreeNode[] = [
      node({
        id: "shut",
        depth: 0,
        type: "space",
        itemType: "space",
        collapsed: true,
        sortable: false,
      }),
    ];
    // active.parentId == overItem.id ('shut') => reorder true on insert
    const active = node({
      id: "drag",
      depth: 1,
      parentId: "shut",
      type: "file",
      itemType: "file",
    });
    const p = getProjection(active, items, ["drag"], 0, 0, 0, true, MOVE, "shut");
    expect(p.insert).toBe(true);
    expect(p.reorder).toBe(true);
  });

  it("droppable is false when the resolved parent is a file", () => {
    // Construct a tree where the resolved parent ends up being a file node.
    // previousItem is a file 's/a' at depth1; sibling placement => parent 's'
    // which is a space => droppable true. To force a FILE parent we make the
    // container itself a file via item lookup: parent id 's' points to a file.
    const items: TreeNode[] = [
      node({ id: "s", depth: 0, type: "file", itemType: "file" }), // parent is a FILE
      node({
        id: "s/a",
        depth: 1,
        parentId: "s",
        type: "file",
        itemType: "file",
        sortable: true,
      }),
      node({
        id: "s/b",
        depth: 1,
        parentId: "s",
        type: "file",
        itemType: "file",
        sortable: true,
      }),
    ];
    const active = node({ id: "drag", depth: 1, type: "file", itemType: "file" });
    const p = getProjection(active, items, ["drag"], 1, 1, 0, true, MOVE, "s");
    expect(p.parentId).toBe("s");
    expect(p.droppable).toBe(false); // parent 's' has type 'file'
  });

  it("reorder (non-insert) true when active already shares the resolved parent", () => {
    const items = baseItems();
    // active.parentId == resolved parent 's' => reorder true (sibling reorder)
    const active = node({
      id: "drag",
      depth: 1,
      parentId: "s",
      type: "file",
      itemType: "file",
    });
    const p = getProjection(active, items, ["drag"], 1, 1, 0, true, MOVE, "s");
    expect(p.insert).toBe(false);
    expect(p.reorder).toBe(true);
  });

  it("reorder (non-insert) true when active's parent equals the activeSpaceID", () => {
    const items = baseItems();
    const active = node({
      id: "drag",
      depth: 1,
      parentId: "someSpace",
      type: "file",
      itemType: "file",
    });
    // parent resolves to 's', active.parentId('someSpace') != 's', but
    // activeSpaceID == active.parentId => reorder true
    const p = getProjection(
      active,
      items,
      ["drag"],
      1,
      1,
      0,
      true,
      MOVE,
      "someSpace"
    );
    expect(p.reorder).toBe(true);
  });
});

// =========================================================================
// getProjection — routes to getMultiProjection when more than one path drags
// =========================================================================
describe("getProjection — multi-select delegates to getMultiProjection", () => {
  const items: TreeNode[] = [
    node({
      id: "space",
      depth: 0,
      type: "space",
      itemType: "space",
      collapsed: false,
    }),
    node({
      id: "space/file",
      depth: 1,
      parentId: "space",
      type: "file",
      itemType: "file",
      sortable: true,
    }),
  ];

  it("with paths.length>1 it returns the getMultiProjection result, not the single-path math", () => {
    const active = node({ id: "d1", depth: 1, type: "file", itemType: "file" });
    const viaProjection = getProjection(
      active,
      items,
      ["d1", "d2"],
      0,
      0,
      0,
      true,
      MOVE,
      "space"
    );
    const direct = getMultiProjection(items, ["d1", "d2"], 0, MOVE);
    expect(viaProjection).toEqual(direct);
  });
});

// =========================================================================
// getMultiProjection — multi-path placement
// =========================================================================
describe("getMultiProjection — multi-path drop placement", () => {
  const tree: TreeNode[] = [
    node({
      id: "space",
      depth: 0,
      type: "space",
      itemType: "space",
      collapsed: false,
    }),
    node({
      id: "space/child",
      depth: 1,
      parentId: "space",
      type: "file",
      itemType: "file",
      sortable: true,
    }),
    node({
      id: "lonelyFile",
      depth: 0,
      parentId: null,
      type: "file",
      itemType: "file",
    }),
  ];

  it("returns undefined when overIndex points at no item", () => {
    expect(getMultiProjection(tree, ["a", "b"], 99, MOVE)).toBeUndefined();
  });

  it("dropping onto a CONTAINER (space) nests the whole selection under it", () => {
    const p = getMultiProjection(tree, ["a", "b"], 0, MOVE) as DragProjection;
    expect(p).not.toBeNull();
    expect(p.parentId).toBe("space"); // the space itself is the drop target
    expect(p.overId).toBe("space");
    expect(p.depth).toBe(0); // overItem.depth
    expect(p.droppable).toBe(true);
    expect(p.sortable).toBe(false);
    expect(p.reorder).toBe(false);
    expect(p.insert).toBe(false); // space is not collapsed
  });

  it("insert mirrors the target container's collapsed state", () => {
    const collapsedTree: TreeNode[] = [
      node({
        id: "space",
        depth: 0,
        type: "space",
        itemType: "space",
        collapsed: true,
      }),
    ];
    const p = getMultiProjection(
      collapsedTree,
      ["a", "b"],
      0,
      MOVE
    ) as DragProjection;
    expect(p.insert).toBe(true); // dropTarget.collapsed
  });

  it("dropping onto a FILE resolves to that file's PARENT container", () => {
    // over index 1 = 'space/child' (a file). dropTarget = its parent 'space'.
    const p = getMultiProjection(tree, ["a", "b"], 1, MOVE) as DragProjection;
    expect(p).not.toBeNull();
    expect(p.parentId).toBe("space"); // file's parent container
    expect(p.overId).toBe("space/child"); // overId stays the hovered file
    expect(p.depth).toBe(1); // overItem.depth (the file's depth)
  });

  it("returns null when the hovered file's parent is ALSO a file (no valid container)", () => {
    // 'lonelyFile' is a top-level file with parentId null => find returns
    // undefined => dropTarget falsy => null.
    const p = getMultiProjection(tree, ["a", "b"], 2, MOVE);
    expect(p).toBeNull();
  });

  it("returns null when a file's resolved parent is itself a file", () => {
    const fileUnderFile: TreeNode[] = [
      node({ id: "f", depth: 0, type: "file", itemType: "file" }),
      node({
        id: "f/g",
        depth: 1,
        parentId: "f",
        type: "file",
        itemType: "file",
      }),
    ];
    // over the nested file f/g; parent f is type 'file' => dropTarget.type=='file' => null
    const p = getMultiProjection(fileUnderFile, ["a", "b"], 1, MOVE);
    expect(p).toBeNull();
  });

  it("copy flag honors link/copy modifiers on a container drop", () => {
    const mk = (m: DropModifiers) =>
      getMultiProjection(tree, ["a", "b"], 0, m) as DragProjection;
    expect(mk("move").copy).toBe(false);
    expect(mk("link").copy).toBe(true);
    expect(mk("copy").copy).toBe(true);
  });
});

// =========================================================================
// getProjection — FILTERED navigator tree: non-contiguous, ancestor-only
// flattenedTree (Notidian-21l4)
// =========================================================================
// The navigator text-filter feature (Notidian-nrjb) renders a flattenedTree
// that OMITS every non-matching sibling branch wholesale while force-including
// every ancestor of a match (marked sortable:false — a filtered ancestor row
// is a pure navigation breadcrumb, not a real reorder target). At the time
// this bead was filed, nrjb's shipped commits (e2cc88d / 330986e / 65399f4)
// had already been reverted from this branch's history — `bd show
// Notidian-nrjb` carries the note "Reverted: failed verification/review after
// fix attempts. Left open for re-attempt" — so no navigator-filter code exists
// in this tree today; there is nothing filter-specific left to exercise live.
//
// getProjection is a general-purpose, id-driven pure function regardless of
// where its TreeNode[] came from: nothing in it is filter-specific. So this
// suite builds the exact SHAPE a filtered tree would produce — an entirely
// omitted non-matching branch, ancestor-only sortable:false rows, and a
// non-contiguous parent/depth chain — directly, and pins that getParentId's
// reverse-slice resolves the TRUE real parent (never the filtered array's
// neighbor position). This is the executable contract any future filter
// re-implementation (or any other feature producing a sparse tree) must
// satisfy.
describe("getProjection — FILTERED tree: omitted sibling branch + ancestor-only rows (Notidian-21l4)", () => {
  // Real tree (conceptual) — only what filterTreeByQuery-shaped output would
  // include is present in `items`; everything else is a matching-comment only:
  //
  //   root (d0, space)
  //     FolderA (d1, space)         -- non-matching; entirely OMITTED w/ subtree
  //     FolderB (d1, space, sortable:false -- forced-visible ancestor of Match1)
  //       Match1 (d2, file, sortable:true)
  //     Sub (d1, space, sortable:false -- forced-visible ancestor of FolderC)
  //       FolderC (d2, space, sortable:false -- forced-visible ancestor of Match2)
  //         Match2 (d3, file, sortable:true)
  //
  // flattenedTree actually rendered: [root, FolderB, Match1, Sub, FolderC, Match2]
  const items: TreeNode[] = [
    node({ id: "root", depth: 0, type: "space", itemType: "space", sortable: true, collapsed: false }),
    node({ id: "root/FolderB", depth: 1, parentId: "root", type: "space", itemType: "space", sortable: false, collapsed: false, rank: 1 }),
    node({ id: "root/FolderB/Match1", depth: 2, parentId: "root/FolderB", type: "file", itemType: "file", sortable: true, rank: 4 }),
    node({ id: "root/Sub", depth: 1, parentId: "root", type: "space", itemType: "space", sortable: false, collapsed: false, rank: 3 }),
    node({ id: "root/Sub/FolderC", depth: 2, parentId: "root/Sub", type: "space", itemType: "space", sortable: false, collapsed: false, rank: 0 }),
    node({ id: "root/Sub/FolderC/Match2", depth: 3, parentId: "root/Sub/FolderC", type: "file", itemType: "file", sortable: true, rank: 2 }),
  ];
  const active = node({ id: "drag", depth: 3, type: "file", itemType: "file" });

  it("reverse-slice parent resolution lands on the TRUE nearer ancestor (Sub), not the root, despite an omitted sibling branch and an intervening matched subtree", () => {
    // Hover over Match2 (index 5, depth 3); request depth 2 (sibling of
    // FolderC, i.e. directly under Sub). Two depth-2 candidates precede the
    // hover point in array order: Match1 (idx2, parentId "root/FolderB" —
    // WRONG if picked) and FolderC (idx4, parentId "root/Sub" — correct,
    // nearest). A position-driven (rather than id/field-driven) resolution,
    // or one that got confused by FolderA's total omission, could plausibly
    // land on the wrong one or on "root" itself.
    const p = getProjection(active, items, ["drag"], 5, 2, 0, false, MOVE, "root");
    expect(p.depth).toBe(2);
    expect(p.parentId).toBe("root/Sub");
    expect(p.parentId).not.toBe("root/FolderB");
    expect(p.parentId).not.toBe("root");
  });

  it("sortable:false on a filtered ancestor-only row still yields sortable:true via the next-item fallback (hovering the breadcrumb row itself)", () => {
    // Hover directly on FolderB (idx1, sortable:false, an ancestor-only
    // filter breadcrumb), requesting its own depth (1) — a sibling landing.
    // previousItemDroppable (type 'space') && !insert && nextItem(Match1).sortable
    // => the OR-fallback makes the projection sortable even though the
    // hovered row's own `sortable` flag is false.
    const p = getProjection(active, items, ["drag"], 1, 1, 0, false, MOVE, "root");
    expect(p.depth).toBe(1);
    expect(p.parentId).toBe("root");
    expect(p.sortable).toBe(true);
  });
});
