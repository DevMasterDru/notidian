// ===========================================================================
// DEPTH (Long Autonomous Mode, Notidian-nh4j) — pure frame-tree-surgery net
// for the offline-verifiable helpers in src/core/utils/frames/ast.ts.
//
// WHAT THEY ARE. ast.ts is NOTEST. It hosts the kit-provenance SOURCE (the
// private getFrameNodesByPath $kit branch — the trusted side of the
// Notidian-vke $api boundary, reachable only behind a Superstate seam) plus a
// cluster of PURE tree-surgery helpers the render path walks to build/mutate
// the FrameTreeNode tree:
//
//   replaceSubtree(tree, subtree)          — swap one subtree by matching id
//   flattenToFrameNodes(root, schemaId)    — tree -> flat FrameNode[] (+ schemaId stamp)
//   insertFrameChildren(root, newChildren) — drop children into the "content" slot
//   isAncestor(tree, targetId)             — walk UP via .parent
//   findParent(tree, targetId)             — walk DOWN, return the parent node
//   findNode(tree, targetId)               — walk DOWN, return the node itself
//   schemaToRoot / schemaToFrame           — FrameSchema -> seed FrameNode
//   propertiesForNode(node)                — derive SpaceProperty[] from node.types
//
// WHY IT MATTERS. A subtree-replace, parent/ancestor miswalk, dropped/dup
// child on insert, or a missed schemaId stamp on flatten silently corrupts a
// persisted frame definition — there was ZERO direct coverage. These functions
// are PURE and offline-verifiable, so they are pinned here against their LIVE
// behavior; the async build/expand path and the provenance-STAMP path
// (getFrameNodesByPath / buildFrameTree / expandFrame) need a Superstate seam
// and are filed as a follow-up.
//
// METHOD (AGENTS.md Long Autonomous Mode). Pure offline characterization with
// small FrameTreeNode fixtures. Where the observed behavior is the CORRECT
// contract (find at root/leaf/missing; transitive ancestry; sibling/order
// preservation on replace; schemaId on every flattened node; no drop/dup on
// insert) it is asserted AS the contract. Where the behavior is a sharp edge
// worth witnessing (replaceSubtree MUTATES its input — the non-mutating
// guarantee lives at the call site via lodash cloneDeep, not in the function;
// insertFrameChildren targets EVERY "content" node, not just the first) it is
// pinned with an explanatory comment so a regression trips here.
//
// No new sinks (ADR 0017): this file imports and exercises existing pure
// helpers only.
// ===========================================================================

import _ from "lodash";
import {
  findNode,
  findParent,
  flattenToFrameNodes,
  insertFrameChildren,
  isAncestor,
  propertiesForNode,
  replaceSubtree,
  schemaToFrame,
  schemaToRoot,
} from "core/utils/frames/ast";
import { FrameTreeNode } from "shared/types/frameExec";
import { FrameNode, FrameSchema } from "shared/types/mframe";

// --------------------------------------------------------------------------
// Fixture builders. A FrameTreeNode mirrors a FrameNode plus tree wiring
// (children[], parent, isRef, editorProps). We build with explicit ids/types
// and wire `parent` back-references the way buildFrameTree does, because
// isAncestor walks UP through `.parent`.
// --------------------------------------------------------------------------

const node = (id: string, extra: Partial<FrameNode> = {}): FrameNode => ({
  id,
  type: "group",
  rank: 0,
  ...extra,
});

const treeNode = (
  n: FrameNode,
  children: FrameTreeNode[] = []
): FrameTreeNode => ({
  id: n.id,
  node: n,
  isRef: false,
  children,
  editorProps: { editMode: 0 },
  parent: null,
});

// Wire each child's .parent to its parent node, recursively — the UP-link
// isAncestor relies on. Returns the same (mutated) root for convenience.
const wireParents = (root: FrameTreeNode): FrameTreeNode => {
  for (const child of root.children) {
    child.parent = root;
    wireParents(child);
  }
  return root;
};

// A small, deterministic tree:
//   root
//   ├── a
//   │   ├── a1
//   │   └── a2
//   └── b
//       └── b1
const buildTree = (): FrameTreeNode => {
  const a1 = treeNode(node("a1", { rank: 0 }));
  const a2 = treeNode(node("a2", { rank: 1 }));
  const b1 = treeNode(node("b1", { rank: 0 }));
  const a = treeNode(node("a", { rank: 0 }), [a1, a2]);
  const b = treeNode(node("b", { rank: 1 }), [b1]);
  const root = treeNode(node("root"), [a, b]);
  return wireParents(root);
};

// ==========================================================================
// findNode — walk DOWN, return the matching node itself (never the root,
// even if the root id matches: the search only inspects descendants).
// ==========================================================================
describe("findNode (down-walk, returns the node)", () => {
  it("returns a first-level child at the matching id", () => {
    const root = buildTree();
    expect(findNode(root, "a")?.id).toBe("a");
    expect(findNode(root, "b")?.id).toBe("b");
  });

  it("returns a deep leaf at the matching id", () => {
    const root = buildTree();
    expect(findNode(root, "a1")?.id).toBe("a1");
    expect(findNode(root, "a2")?.id).toBe("a2");
    expect(findNode(root, "b1")?.id).toBe("b1");
  });

  it("returns null for a missing id without throwing", () => {
    const root = buildTree();
    expect(findNode(root, "does-not-exist")).toBeNull();
  });

  it("does NOT match the root id — it only searches descendants", () => {
    // findNode never inspects `tree` itself, only its children subtrees, so
    // the root id is unreachable through it. This is the load-bearing reason
    // callers pass the parent/whole tree, never the node they're looking for.
    const root = buildTree();
    expect(findNode(root, "root")).toBeNull();
  });

  it("returns the SAME object reference held in the tree (identity, not copy)", () => {
    const root = buildTree();
    const a1Direct = root.children[0].children[0];
    expect(findNode(root, "a1")).toBe(a1Direct);
  });
});

// ==========================================================================
// findParent — walk DOWN, return the PARENT of the matching id.
// ==========================================================================
describe("findParent (down-walk, returns the parent)", () => {
  it("returns the root as parent of a first-level child", () => {
    const root = buildTree();
    expect(findParent(root, "a")?.id).toBe("root");
    expect(findParent(root, "b")?.id).toBe("root");
  });

  it("returns the immediate parent of a deep leaf", () => {
    const root = buildTree();
    expect(findParent(root, "a1")?.id).toBe("a");
    expect(findParent(root, "a2")?.id).toBe("a");
    expect(findParent(root, "b1")?.id).toBe("b");
  });

  it("returns null for a missing id without throwing", () => {
    const root = buildTree();
    expect(findParent(root, "nope")).toBeNull();
  });

  it("returns null for the root id (the root has no parent in this tree)", () => {
    const root = buildTree();
    expect(findParent(root, "root")).toBeNull();
  });

  it("returns the SAME parent object reference held in the tree", () => {
    const root = buildTree();
    const aDirect = root.children[0];
    expect(findParent(root, "a1")).toBe(aDirect);
  });
});

// ==========================================================================
// isAncestor — walk UP via .parent. True iff some strict ancestor's id
// matches targetId. False for self and unrelated ids.
// ==========================================================================
describe("isAncestor (up-walk via .parent)", () => {
  it("is TRUE for an immediate parent", () => {
    const root = buildTree();
    const a1 = findNode(root, "a1")!;
    expect(isAncestor(a1, "a")).toBe(true);
  });

  it("is TRUE transitively for a grandparent (the root)", () => {
    const root = buildTree();
    const a1 = findNode(root, "a1")!;
    expect(isAncestor(a1, "root")).toBe(true);
  });

  it("is FALSE for self (a node is not its own ancestor)", () => {
    const root = buildTree();
    const a1 = findNode(root, "a1")!;
    expect(isAncestor(a1, "a1")).toBe(false);
  });

  it("is FALSE for an unrelated node in a different branch", () => {
    const root = buildTree();
    const a1 = findNode(root, "a1")!;
    // b / b1 are in the sibling branch, never on a1's parent chain.
    expect(isAncestor(a1, "b")).toBe(false);
    expect(isAncestor(a1, "b1")).toBe(false);
  });

  it("is FALSE for a DESCENDANT (ancestry is strictly upward)", () => {
    const root = buildTree();
    const a = findNode(root, "a")!;
    expect(isAncestor(a, "a1")).toBe(false);
  });

  it("is FALSE from the root (no parent link to walk)", () => {
    const root = buildTree();
    expect(isAncestor(root, "anything")).toBe(false);
  });
});

// ==========================================================================
// replaceSubtree — swap the subtree whose id matches `subtree.id`.
// CONTRACT: the swap happens by id; siblings and ordering are preserved.
// SHARP EDGE: the function MUTATES its input tree's children arrays in place
// (tree.children[i] = ...). The non-mutating guarantee callers rely on lives
// at the CALL SITE via lodash cloneDeep, not inside this function. Both are
// pinned below.
// ==========================================================================
describe("replaceSubtree (swap by id, preserve siblings + order)", () => {
  it("returns the replacement directly when the root id matches", () => {
    const root = buildTree();
    const replacement = treeNode(node("root", { name: "new-root" }));
    expect(replaceSubtree(root, replacement)).toBe(replacement);
  });

  it("swaps only the matching deep subtree and leaves siblings intact", () => {
    const root = buildTree();
    const replacement = treeNode(node("a1", { name: "replaced-a1" }));

    const result = replaceSubtree(root, replacement);

    // a1 is now the replacement object...
    const newA1 = result.children[0].children[0];
    expect(newA1).toBe(replacement);
    expect(newA1.node.name).toBe("replaced-a1");
    // ...and its sibling a2 is untouched, in the same slot/order.
    expect(result.children[0].children[1].id).toBe("a2");
    expect(result.children[0].children.map((c) => c.id)).toEqual(["a1", "a2"]);
    // The unrelated b-branch is fully intact.
    expect(result.children[1].id).toBe("b");
    expect(result.children[1].children[0].id).toBe("b1");
  });

  it("preserves first-level sibling ordering when swapping a first-level node", () => {
    const root = buildTree();
    const replacement = treeNode(node("b", { name: "replaced-b" }), [
      treeNode(node("b1")),
    ]);
    const result = replaceSubtree(root, replacement);
    expect(result.children.map((c) => c.id)).toEqual(["a", "b"]);
    expect(result.children[1]).toBe(replacement);
  });

  it("is a no-op (structurally) when no id matches", () => {
    const root = buildTree();
    const before = _.cloneDeep(_.omit(root, "parent")); // omit cyclic parent
    const replacement = treeNode(node("ghost", { name: "unused" }));
    const result = replaceSubtree(root, replacement);
    expect(_.omit(result, "parent")).toEqual(before);
  });

  it("MUTATES the input tree in place (cloneDeep is the caller's job)", () => {
    // Witness the sharp edge: replaceSubtree writes tree.children[i] = ...,
    // so the ORIGINAL tree observably changes. Callers that need immutability
    // must lodash-cloneDeep before calling — this test locks that contract so
    // a future "make it pure" refactor is a conscious, reviewed change.
    const root = buildTree();
    const originalA1 = root.children[0].children[0];
    const replacement = treeNode(node("a1", { name: "mutated" }));

    replaceSubtree(root, replacement);

    expect(root.children[0].children[0]).toBe(replacement);
    expect(root.children[0].children[0]).not.toBe(originalA1);
  });

  it("a cloneDeep'd input shields the original (the documented safe pattern)", () => {
    const root = buildTree();
    const snapshotIds = root.children[0].children.map((c) => c.id);
    // Clone without the cyclic parent links, mirroring how callers prep input.
    const working = _.cloneDeep(_.omit(root, "parent")) as FrameTreeNode;
    const replacement = treeNode(node("a1", { name: "safe" }));

    replaceSubtree(working, replacement);

    // Original untouched because we mutated the clone, not the source.
    expect(root.children[0].children.map((c) => c.id)).toEqual(snapshotIds);
    expect(root.children[0].children[0].node.name).toBeUndefined();
  });
});

// ==========================================================================
// flattenToFrameNodes — tree -> flat FrameNode[]. Stamps schemaId on EVERY
// node, rewrites parentId to the (possibly de-duplicated) parent id, and
// preserves pre-order child ordering. Root gets parentId "".
// ==========================================================================
describe("flattenToFrameNodes (tree -> flat nodes, schemaId stamp)", () => {
  it("stamps the given schemaId on every emitted node", () => {
    const flat = flattenToFrameNodes(buildTree(), "SCHEMA-X");
    expect(flat.length).toBe(6); // root, a, a1, a2, b, b1
    for (const n of flat) {
      expect(n.schemaId).toBe("SCHEMA-X");
    }
  });

  it("emits nodes in pre-order, preserving child order", () => {
    const flat = flattenToFrameNodes(buildTree(), "S");
    expect(flat.map((n) => n.id)).toEqual(["root", "a", "a1", "a2", "b", "b1"]);
  });

  it("rewrites parentId to the parent's id; the root gets empty-string parentId", () => {
    const flat = flattenToFrameNodes(buildTree(), "S");
    const byId = Object.fromEntries(flat.map((n) => [n.id, n]));
    expect(byId["root"].parentId).toBe("");
    expect(byId["a"].parentId).toBe("root");
    expect(byId["a1"].parentId).toBe("a");
    expect(byId["a2"].parentId).toBe("a");
    expect(byId["b"].parentId).toBe("root");
    expect(byId["b1"].parentId).toBe("b");
  });

  it("de-duplicates colliding ids and re-points children at the new unique id", () => {
    // Two distinct subtrees both named "dup". uniqueNameFromString renames the
    // SECOND occurrence to "dup1"; the second dup's child must follow its
    // parent's NEW id, not the original — otherwise the flat list is corrupt.
    const dupA = treeNode(node("dup"), [treeNode(node("childA"))]);
    const dupB = treeNode(node("dup"), [treeNode(node("childB"))]);
    const root = wireParents(treeNode(node("root"), [dupA, dupB]));

    const flat = flattenToFrameNodes(root, "S");
    const ids = flat.map((n) => n.id);
    expect(ids).toEqual(["root", "dup", "childA", "dup1", "childB"]);

    const byId = Object.fromEntries(flat.map((n) => [n.id, n]));
    expect(byId["childA"].parentId).toBe("dup");
    // childB re-pointed to the renamed parent "dup1".
    expect(byId["childB"].parentId).toBe("dup1");
  });

  it("carries the original node's other fields through unchanged", () => {
    const root = wireParents(
      treeNode(node("root"), [
        treeNode(node("a", { name: "Alpha", type: "text", rank: 7 })),
      ])
    );
    const flat = flattenToFrameNodes(root, "S");
    const a = flat.find((n) => n.id === "a")!;
    expect(a.name).toBe("Alpha");
    expect(a.type).toBe("text");
    expect(a.rank).toBe(7);
  });

  it("does not mutate the source node objects (spreads into fresh nodes)", () => {
    const root = buildTree();
    const originalRootNode = root.node;
    flattenToFrameNodes(root, "S");
    // The source root node never had a schemaId; flatten must not have stamped
    // it onto the original (it spreads {...node.node} into a new object).
    expect(originalRootNode.schemaId).toBeUndefined();
    expect(originalRootNode.parentId).toBeUndefined();
  });
});

// ==========================================================================
// insertFrameChildren — replace the children of EVERY "content"-type node
// with newChildren, re-parenting each inserted child to that content node's
// id. Non-content nodes recurse. No drop/dup of the supplied children.
// ==========================================================================
describe("insertFrameChildren (drop children into the content slot)", () => {
  // root(group) -> mid(group) -> slot(content)
  const buildWithContentSlot = (): FrameTreeNode => {
    const slot = treeNode(node("slot", { type: "content" }));
    const mid = treeNode(node("mid", { type: "group" }), [slot]);
    return wireParents(treeNode(node("root", { type: "group" }), [mid]));
  };

  const newKids = (): FrameTreeNode[] => [
    treeNode(node("k0")),
    treeNode(node("k1")),
    treeNode(node("k2")),
  ];

  it("inserts all supplied children into the content node, in order, no drop/dup", () => {
    const result = insertFrameChildren(buildWithContentSlot(), newKids());
    const slot = result.children[0].children[0];
    expect(slot.node.type).toBe("content");
    expect(slot.children.map((c) => c.id)).toEqual(["k0", "k1", "k2"]);
    // exactly the supplied set, no duplication.
    expect(slot.children.length).toBe(3);
  });

  it("re-parents each inserted child's node.parentId to the content node's id", () => {
    const result = insertFrameChildren(buildWithContentSlot(), newKids());
    const slot = result.children[0].children[0];
    for (const child of slot.children) {
      expect(child.node.parentId).toBe("slot");
    }
  });

  it("leaves non-content nodes' existing children untouched when no content matches", () => {
    // No content node anywhere -> tree returns with original structure, kids
    // are never inserted (and never lost into a non-existent slot).
    const noContent = wireParents(
      treeNode(node("root", { type: "group" }), [
        treeNode(node("only", { type: "group" })),
      ])
    );
    const result = insertFrameChildren(noContent, newKids());
    expect(result.children.map((c) => c.id)).toEqual(["only"]);
    expect(result.children[0].children).toEqual([]);
  });

  it("inserts into EVERY content node (the loop targets all matches, not the first)", () => {
    // Two content slots under root. The current contract fills BOTH with the
    // same newChildren — pinned so a future "first slot only" change is caught.
    const slot1 = treeNode(node("slot1", { type: "content" }));
    const slot2 = treeNode(node("slot2", { type: "content" }));
    const root = wireParents(
      treeNode(node("root", { type: "group" }), [slot1, slot2])
    );
    const result = insertFrameChildren(root, newKids());
    expect(result.children[0].children.map((c) => c.id)).toEqual([
      "k0",
      "k1",
      "k2",
    ]);
    expect(result.children[1].children.map((c) => c.id)).toEqual([
      "k0",
      "k1",
      "k2",
    ]);
  });

  it("with an empty newChildren set, a content node keeps its own children (no wipe)", () => {
    // The content branch only fires when newChildren.length > 0; with an empty
    // set the node recurses normally and its existing children survive.
    const existing = treeNode(node("existing-child"));
    const slot = treeNode(node("slot", { type: "content" }), [existing]);
    const root = wireParents(
      treeNode(node("root", { type: "group" }), [slot])
    );
    const result = insertFrameChildren(root, []);
    expect(result.children[0].children.map((c) => c.id)).toEqual([
      "existing-child",
    ]);
  });

  it("returns a fresh tree without mutating the input root reference", () => {
    const input = buildWithContentSlot();
    const result = insertFrameChildren(input, newKids());
    expect(result).not.toBe(input);
    // The original content slot still has no inserted kids.
    expect(input.children[0].children[0].children).toEqual([]);
  });
});

// ==========================================================================
// schemaToRoot / schemaToFrame — seed a FrameNode from a FrameSchema. Same
// shape except `type` ("group" vs "frame"). id == schema.id, rank 0, name ==
// schema.id, schemaId == schema.id.
// ==========================================================================
describe("schemaToRoot / schemaToFrame (schema -> seed node shape)", () => {
  const schema: FrameSchema = { id: "sch-1", name: "Schema One", type: "frame" };

  it("schemaToRoot produces a group node keyed entirely off schema.id", () => {
    expect(schemaToRoot(schema)).toEqual({
      schemaId: "sch-1",
      id: "sch-1",
      type: "group",
      rank: 0,
      name: "sch-1",
    });
  });

  it("schemaToFrame produces a frame node keyed entirely off schema.id", () => {
    expect(schemaToFrame(schema)).toEqual({
      schemaId: "sch-1",
      id: "sch-1",
      type: "frame",
      rank: 0,
      name: "sch-1",
    });
  });

  it("the two differ ONLY in `type`", () => {
    const { type: rootType, ...rootRest } = schemaToRoot(schema);
    const { type: frameType, ...frameRest } = schemaToFrame(schema);
    expect(rootType).toBe("group");
    expect(frameType).toBe("frame");
    expect(rootRest).toEqual(frameRest);
  });

  it("uses schema.id (not schema.name) for name — name field is ignored", () => {
    expect(schemaToRoot(schema).name).toBe("sch-1");
    expect(schemaToFrame(schema).name).toBe("sch-1");
  });
});

// ==========================================================================
// propertiesForNode — derive SpaceProperty[] from node.types, pulling
// value/attrs from propsValue/propsAttrs by the same key. schemaId == key.
// ==========================================================================
describe("propertiesForNode (node.types -> SpaceProperty[])", () => {
  it("maps each type key to a property with type/name/schemaId/value/attrs", () => {
    const n = node("n", {
      types: { title: "text", count: "number" },
      propsValue: { title: "Hello", count: "0" },
      propsAttrs: { title: "attrT", count: "attrC" },
    });
    const props = propertiesForNode(n);
    expect(props).toEqual([
      { type: "text", name: "title", schemaId: "title", value: "Hello", attrs: "attrT" },
      { type: "number", name: "count", schemaId: "count", value: "0", attrs: "attrC" },
    ]);
  });

  it("leaves value/attrs undefined when propsValue/propsAttrs are absent", () => {
    const n = node("n", { types: { only: "text" } });
    const props = propertiesForNode(n);
    expect(props).toEqual([
      { type: "text", name: "only", schemaId: "only", value: undefined, attrs: undefined },
    ]);
  });

  it("returns an empty array for an empty types object", () => {
    const n = node("n", { types: {} });
    expect(propertiesForNode(n)).toEqual([]);
  });

  it("preserves the key order of node.types", () => {
    const n = node("n", { types: { z: "text", a: "text", m: "number" } });
    expect(propertiesForNode(n).map((p) => p.name)).toEqual(["z", "a", "m"]);
  });
});
