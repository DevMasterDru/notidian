// ===========================================================================
// DEPTH (Long Autonomous Mode, Notidian-1l7p) — async build/expand + the
// kit-provenance STAMP through a real Superstate seam.
//
// WHAT THIS PINS. ast.treeOps.test.ts pinned the PURE tree-surgery helpers.
// trustBoundary.test.ts pinned the runner $api gate end-to-end and the two
// headline provenance facts (a real kit resolution stamps the resolved subtree;
// a forged $kit ref pointing at NO kit entry is never stamped). This file pins
// the parts of the async build/expand path those two do NOT cover — the
// module-PRIVATE getFrameNodesByPath / expandNode / expandFrame functions,
// reachable only through the exported buildFrameTree:
//
//   (a) the readFrame branch is fromKit:FALSE even when the stored ref FORGES the
//       "$kit" prefix — superstate.kit is never consulted, so the materialized
//       subtree carries NO kit provenance (the Notidian-vke trust boundary: trust
//       is genuine resolution, never the attacker-controllable ref string);
//   (b) a REAL $kit resolution stamps the kit subtree (stampKitProvenanceTree,
//       ast.ts:174) AND the re-stamped root (stampKitProvenance, ast.ts:180), but
//       NOT the user's original children — insertFrameChildren rebuilds them via
//       a {...f.node} spread (ast.ts:125) that drops the non-enumerable marker, so
//       a USER child dropped into a kit content slot can never inherit trust;
//   (c) the schemaId-match short-circuit (ast.ts:143) returns the treeNode
//       unchanged (no expansion, no stamp) when the ref's id already equals the
//       referencing node's schemaId — the self-reference guard;
//   (d) the empty-rows / missing-mdbFrame short-circuit (ast.ts:145) returns the
//       treeNode unchanged when readFrame yields nothing or zero rows;
//   (e) the dontExpand short-circuit in buildFrameTree (ast.ts:312) returns the
//       wired-but-UNexpanded tree (frame nodes stay frames; no Superstate read);
//   (f) the id-to-node map + rank sort + parentId wiring (ast.ts:293-311): a flat
//       FrameNode[] becomes a parent/child tree, siblings ordered by node.rank,
//       each child's .parent back-link set.
//
// WHY IT MATTERS. (a)/(b) ARE the safety-critical kit-provenance trust boundary:
// a regression that stamped the readFrame branch, or let the {...f.node} insert
// spread carry the marker onto user children, would silently re-grant $api (full
// vault write) to attacker-controlled stored/imported frame content on every
// render. (c)-(f) are the structural contract the render path depends on to build
// a correct, ordered tree without an extra recursion or a dropped child.
//
// METHOD (AGENTS.md Long Autonomous Mode). Drive the REAL pipeline through the
// exported buildFrameTree, stubbing Superstate exactly like trustBoundary.test.ts
// (spaceManager.uriByString + readFrame + kit, cast `as unknown as Superstate`) —
// the private async functions get exercised in production shape, not mocked. Each
// assertion is the LIVE behavior witnessed via probe, asserted AS the contract.
//
// No new sinks (ADR 0017): imports and exercises existing functions only.
// ===========================================================================

import { Superstate } from "makemd-core";
import { buildFrameTree } from "./ast";
import { FrameTreeNode } from "shared/types/frameExec";
import { FrameNode, FrameRoot, MDBFrame } from "shared/types/mframe";
import { hasKitProvenance } from "./trust";

// The legacy, forgeable "$kit" prefix — used here ONLY to prove a stored ref that
// forges it never confers trust, never to confer it.
const FORGED_KIT_REF_PREFIX = "spaces://$kit/#*";

// ---------------------------------------------------------------------------
// Superstate seam (mirrors trustBoundary.test.ts::makeSuperstate). Only the
// surface ast.ts touches during expansion: spaceManager.uriByString +
// spaceManager.readFrame + kit.find.
//   - "spaces://$kit/#*<id>"  -> authority '$kit', ref '<id>'  (kit branch)
//   - any other "spaces://…"  -> a user space, resolved via readFrame
// ---------------------------------------------------------------------------
const makeSuperstate = (
  kit: FrameRoot[],
  readFrameRet?: MDBFrame
): Superstate =>
  ({
    kit,
    spaceManager: {
      uriByString: (ref: string) => {
        if (ref?.startsWith(FORGED_KIT_REF_PREFIX)) {
          return {
            authority: "$kit",
            ref: ref.replace(FORGED_KIT_REF_PREFIX, ""),
            basePath: "$kit",
            scheme: "spaces",
            fullPath: ref,
          };
        }
        if (ref?.startsWith("spaces://")) {
          return {
            authority: "My Space",
            ref: "main",
            basePath: "My Space",
            scheme: "spaces",
            fullPath: ref,
          };
        }
        return null;
      },
      // user-space frames resolve here; the test supplies the MDBFrame (or
      // undefined to model "no such frame").
      readFrame: async (): Promise<MDBFrame | undefined> => readFrameRet,
    },
  } as unknown as Superstate);

// A genuine kit entry: a single text node that uses $api in its prop. Its
// schema.id (via rootToFrame) is its node.id, "secProbeItem".
const kitTextItem = (): FrameRoot => ({
  def: { id: "secProbeItem" },
  node: {
    id: "secProbeItem",
    schemaId: "secProbeItem",
    parentId: "",
    name: "secProbeItem",
    rank: 0,
    type: "text",
    props: { value: "$api.probe.ping('REAL-KIT')" },
    types: { value: "text" },
    styles: {},
    actions: {},
  },
});

// A genuine kit entry that HAS a content slot: a group root with a kit text
// child AND a content node. When a user frame references this kit and itself has
// children, expandNode drops the user children into the content slot — the
// scenario that exercises the {...f.node} marker-strip on insert.
const kitGroupWithContent = (): FrameRoot => ({
  def: { id: "kitGroup" },
  node: {
    id: "kitGroup",
    schemaId: "kitGroup",
    parentId: "",
    name: "kitGroup",
    rank: 0,
    type: "group",
    props: {},
    types: {},
    styles: {},
    actions: {},
  },
  children: [
    {
      def: { id: "kittext" },
      node: {
        id: "kittext",
        schemaId: "kitGroup",
        parentId: "kitGroup",
        name: "kittext",
        rank: 0,
        type: "text",
        props: { value: "$api.probe.ping('KIT-CHILD')" },
        types: { value: "text" },
        styles: {},
        actions: {},
      },
    },
    {
      def: { id: "kitcontent" },
      node: {
        id: "kitcontent",
        schemaId: "kitGroup",
        parentId: "kitGroup",
        name: "kitcontent",
        rank: 1,
        type: "content",
        props: {},
        types: {},
        styles: {},
        actions: {},
      },
    },
  ],
});

const frameNode = (over: Partial<FrameNode> & Pick<FrameNode, "id">): FrameNode => ({
  schemaId: "root",
  name: over.id,
  rank: 0,
  type: "group",
  props: {},
  styles: {},
  actions: {},
  ...over,
});

const collect = (
  node: FrameTreeNode,
  out: FrameTreeNode[] = []
): FrameTreeNode[] => {
  out.push(node);
  (node.children ?? []).forEach((c) => collect(c, out));
  return out;
};

// ===========================================================================
// (a) readFrame branch — fromKit:FALSE even when the stored ref forges "$kit"
// ===========================================================================
describe("getFrameNodesByPath readFrame branch is never fromKit (Notidian-1l7p / vke)", () => {
  it("a forged $kit ref that resolves via readFrame (no real kit entry) is NOT provenanced", async () => {
    // The id "forgedNoKit" is NOT in the (empty) kit, so the $kit branch's
    // kit.find returns nothing and getFrameNodesByPath returns undefined — but
    // even the structurally-similar readFrame path below proves the rule. Here we
    // model an attacker that forged the $kit prefix but the kit has no such entry.
    const superstate = makeSuperstate([]);
    const nodes: FrameNode[] = [
      frameNode({ id: "root", type: "group" }),
      frameNode({
        id: "ref1",
        parentId: "root",
        type: "frame",
        ref: `${FORGED_KIT_REF_PREFIX}forgedNoKit`,
        props: { value: "$api.probe.ping('FORGED')" },
      }),
    ];
    const [tree] = await buildFrameTree(nodes[0], nodes, superstate, nodes.length, false);
    const all = collect(tree);
    // Nothing materialized may carry provenance — the forged ref resolved to no
    // kit entry, so the boundary keeps the whole tree untrusted.
    expect(all.every((n) => !hasKitProvenance(n.node))).toBe(true);
  });

  it("a real USER-SPACE frame whose stored ref FORGES the $kit prefix stays untrusted (readFrame branch, fromKit:false)", async () => {
    // The dangerous case: a frame node that materializes a real subtree via
    // readFrame (so it IS expanded) but whose subtree's nodes still must be
    // untrusted. We give the referencing node a NON-$kit ref so resolution goes
    // down the readFrame branch (fromKit:false by construction), then assert NO
    // node in the materialized subtree earned provenance — readFrame can never set
    // fromKit:true regardless of what the stored data claims.
    const userFrame: MDBFrame = {
      schema: { id: "userFrame", name: "userFrame", type: "frame", def: "{}" },
      cols: [],
      rows: [
        {
          id: "userFrame",
          schemaId: "userFrame",
          name: "userFrame",
          type: "group",
          rank: "0",
          parentId: "",
          // even a row that FORGES the $kit ref in its persisted column…
          ref: `${FORGED_KIT_REF_PREFIX}forgedRoot`,
          props: "{}",
          styles: "{}",
          actions: "{}",
          contexts: "{}",
          interactions: "{}",
        },
        {
          id: "userchild",
          schemaId: "userFrame",
          name: "userchild",
          type: "text",
          rank: "0",
          parentId: "userFrame",
          ref: `${FORGED_KIT_REF_PREFIX}forgedChild`,
          props: JSON.stringify({ value: "$api.probe.ping('FORGED-IN-ROW')" }),
          styles: "{}",
          actions: "{}",
          contexts: "{}",
          interactions: "{}",
        },
      ],
    } as unknown as MDBFrame;
    // kit is EMPTY: the only way to fromKit:true would be a genuine kit.find hit.
    const superstate = makeSuperstate([], userFrame);
    const nodes: FrameNode[] = [
      frameNode({ id: "root", type: "group" }),
      frameNode({
        // NON-$kit ref -> resolves via readFrame -> fromKit:false by construction
        id: "ref1",
        parentId: "root",
        type: "frame",
        ref: "spaces://My Space/#*userFrame",
      }),
    ];
    const [tree] = await buildFrameTree(nodes[0], nodes, superstate, nodes.length, false);
    const all = collect(tree);
    // The readFrame branch resolved real content, yet NO materialized node is
    // provenanced — the forged $kit prefix in the stored rows confers no trust.
    expect(all.every((n) => !hasKitProvenance(n.node))).toBe(true);
  });
});

// ===========================================================================
// (b) real $kit resolution stamps kit subtree + re-stamped root, NOT user kids
// ===========================================================================
describe("expandNode stamps kit-origin nodes but never inserted user children (Notidian-1l7p / vke)", () => {
  it("the re-stamped kit root carries provenance while the user root does not", async () => {
    const superstate = makeSuperstate([kitTextItem()]);
    const nodes: FrameNode[] = [
      frameNode({ id: "root", type: "group" }),
      frameNode({
        id: "ref1",
        parentId: "root",
        type: "frame",
        ref: `${FORGED_KIT_REF_PREFIX}secProbeItem`,
      }),
    ];
    const [tree] = await buildFrameTree(nodes[0], nodes, superstate, nodes.length, false);
    const all = collect(tree);
    // The user root is stored content -> untrusted.
    const root = all.find((n) => n.id === "root")!;
    expect(hasKitProvenance(root.node)).toBe(false);
    // The kit-resolved root (rebuilt via spread then explicitly re-stamped at
    // ast.ts:180) IS provenanced.
    const kitRoot = all.find((n) => n.id === "ref1")!;
    expect(hasKitProvenance(kitRoot.node)).toBe(true);
    // And at least one provenanced node exists overall (sanity on the stamp).
    expect(all.some((n) => hasKitProvenance(n.node))).toBe(true);
  });

  it("a user child dropped into a kit content slot is NOT provenanced; the kit-origin nodes around it ARE", async () => {
    const superstate = makeSuperstate([kitGroupWithContent()]);
    const nodes: FrameNode[] = [
      frameNode({ id: "root", type: "group" }),
      frameNode({
        id: "ref1",
        parentId: "root",
        type: "frame",
        ref: `${FORGED_KIT_REF_PREFIX}kitGroup`,
      }),
      // a USER-authored child of the referencing frame — expandNode inserts it
      // into the kit's content slot via insertFrameChildren's {...f.node} spread.
      frameNode({
        id: "userkid",
        parentId: "ref1",
        type: "text",
        name: "USERCHILD",
        props: { value: "$api.probe.ping('USER-EVIL')" },
      }),
    ];
    const [tree] = await buildFrameTree(nodes[0], nodes, superstate, nodes.length, false);
    const all = collect(tree);

    // The user's original child is present in the materialized tree…
    const userChild = all.find((n) => n.node.name === "USERCHILD");
    expect(userChild).toBeDefined();
    // …and it is NOT provenanced: insertFrameChildren rebuilt it via {...f.node}
    // (ast.ts:125), which drops the non-enumerable marker. THIS is the boundary —
    // stored/imported content can never inherit trust by riding into a kit slot.
    expect(hasKitProvenance(userChild!.node)).toBe(false);

    // The kit-origin nodes (the resolved subtree from stampKitProvenanceTree at
    // ast.ts:174, plus the re-stamped root at ast.ts:180) ARE provenanced. We
    // identify them by their kit-origin names rather than generated ids.
    const kitText = all.find((n) => n.node.name === "kittext");
    const kitContent = all.find((n) => n.node.name === "kitcontent");
    const kitRoot = all.find((n) => n.id === "ref1");
    expect(kitText && hasKitProvenance(kitText.node)).toBe(true);
    expect(kitContent && hasKitProvenance(kitContent.node)).toBe(true);
    expect(kitRoot && hasKitProvenance(kitRoot.node)).toBe(true);

    // EXACTLY the kit-origin nodes are trusted: the only un-provenanced nodes are
    // the user root and the inserted user child.
    const unprovenanced = all.filter((n) => !hasKitProvenance(n.node)).map((n) => n.node.name);
    expect(unprovenanced.sort()).toEqual(["USERCHILD", "root"].sort());
  });
});

// ===========================================================================
// (c) schemaId-match short-circuit (ast.ts:143)
// ===========================================================================
describe("expandNode schemaId-match short-circuit (Notidian-1l7p)", () => {
  it("a frame whose schemaId equals the resolved kit's schema.id is returned unchanged (no expansion, no stamp)", async () => {
    const superstate = makeSuperstate([kitTextItem()]);
    const nodes: FrameNode[] = [
      frameNode({ id: "root", type: "group" }),
      frameNode({
        id: "ref1",
        // schemaId == the kit's schema.id ("secProbeItem") -> self-reference guard
        // at ast.ts:143 returns [treeNode, id] BEFORE any link/build/stamp.
        schemaId: "secProbeItem",
        parentId: "root",
        type: "frame",
        ref: `${FORGED_KIT_REF_PREFIX}secProbeItem`,
      }),
    ];
    const [tree] = await buildFrameTree(nodes[0], nodes, superstate, nodes.length, false);
    const all = collect(tree);
    // The frame stayed a bare frame: only root + ref1, no expanded kit subtree.
    expect(all.map((n) => n.id).sort()).toEqual(["ref1", "root"].sort());
    // Nothing was stamped (the short-circuit returns before the stamp lines).
    expect(all.every((n) => !hasKitProvenance(n.node))).toBe(true);
    // The referencing node is still type "frame" (un-expanded).
    expect(all.find((n) => n.id === "ref1")!.node.type).toBe("frame");
  });
});

// ===========================================================================
// (d) empty-rows / missing-mdbFrame short-circuit (ast.ts:145)
// ===========================================================================
describe("expandNode empty/missing-frame short-circuit (Notidian-1l7p)", () => {
  it("a frame ref whose readFrame returns undefined is returned unchanged", async () => {
    // readFrame -> undefined => resolved is undefined => mdbFrame undefined =>
    // ast.ts:145 short-circuit.
    const superstate = makeSuperstate([], undefined);
    const nodes: FrameNode[] = [
      frameNode({ id: "root", type: "group" }),
      frameNode({ id: "ref1", parentId: "root", type: "frame", ref: "spaces://My Space/#*missing" }),
    ];
    const [tree] = await buildFrameTree(nodes[0], nodes, superstate, nodes.length, false);
    const all = collect(tree);
    expect(all.map((n) => n.id).sort()).toEqual(["ref1", "root"].sort());
    expect(all.find((n) => n.id === "ref1")!.node.type).toBe("frame");
  });

  it("a frame ref whose readFrame returns a frame with ZERO rows is returned unchanged", async () => {
    const emptyFrame: MDBFrame = {
      schema: { id: "empty", name: "empty", type: "frame", def: "{}" },
      cols: [],
      rows: [],
    } as unknown as MDBFrame;
    const superstate = makeSuperstate([], emptyFrame);
    const nodes: FrameNode[] = [
      frameNode({ id: "root", type: "group" }),
      frameNode({ id: "ref1", parentId: "root", type: "frame", ref: "spaces://My Space/#*empty" }),
    ];
    const [tree] = await buildFrameTree(nodes[0], nodes, superstate, nodes.length, false);
    const all = collect(tree);
    expect(all.map((n) => n.id).sort()).toEqual(["ref1", "root"].sort());
    expect(all.find((n) => n.id === "ref1")!.node.type).toBe("frame");
  });
});

// ===========================================================================
// (e) dontExpand short-circuit in buildFrameTree (ast.ts:312)
// ===========================================================================
describe("buildFrameTree dontExpand short-circuit (Notidian-1l7p)", () => {
  it("returns the wired-but-UNexpanded tree: frame nodes stay frames, no kit subtree, no Superstate read", async () => {
    // A throwing superstate proves dontExpand never touches it (no expansion).
    const throwingSuperstate = {
      kit: [kitTextItem()],
      spaceManager: {
        uriByString: () => {
          throw new Error("dontExpand must not resolve refs");
        },
        readFrame: async () => {
          throw new Error("dontExpand must not read frames");
        },
      },
    } as unknown as Superstate;
    const nodes: FrameNode[] = [
      frameNode({ id: "root", type: "group" }),
      frameNode({
        id: "ref1",
        parentId: "root",
        type: "frame",
        ref: `${FORGED_KIT_REF_PREFIX}secProbeItem`,
      }),
    ];
    const [tree, returnedID] = await buildFrameTree(
      nodes[0],
      nodes,
      throwingSuperstate,
      nodes.length,
      false,
      undefined,
      true // dontExpand
    );
    const all = collect(tree);
    // The frame node is still a frame (not expanded into the kit subtree)…
    expect(all.find((n) => n.id === "ref1")!.node.type).toBe("frame");
    // …and the tree is just root + ref1 (no materialized kit children).
    expect(all.map((n) => n.id).sort()).toEqual(["ref1", "root"].sort());
    // No stamping happened (the expand path that stamps was skipped).
    expect(all.every((n) => !hasKitProvenance(n.node))).toBe(true);
    // dontExpand returns the SAME uniqueID it was handed (no IDs allocated).
    expect(returnedID).toBe(nodes.length);
  });
});

// ===========================================================================
// (f) id-to-node map + rank sort + parentId wiring (ast.ts:293-311)
// ===========================================================================
describe("buildFrameTree id-to-node map, rank sort & parent wiring (Notidian-1l7p)", () => {
  it("builds a parent/child tree from a flat FrameNode[], orders siblings by rank, and back-links each child's .parent", async () => {
    const superstate = makeSuperstate([], {
      schema: { id: "x", name: "x", type: "frame", def: "{}" },
      cols: [],
      rows: [],
    } as unknown as MDBFrame);
    // Deliberately out of rank order in the flat input: b(2), a(1), c(0).
    const nodes: FrameNode[] = [
      frameNode({ id: "root", type: "group" }),
      frameNode({ id: "b", parentId: "root", type: "text", rank: 2 }),
      frameNode({ id: "a", parentId: "root", type: "text", rank: 1 }),
      frameNode({ id: "c", parentId: "root", type: "text", rank: 0 }),
    ];
    // dontExpand to isolate the wiring step from any expansion side-effects.
    const [tree] = await buildFrameTree(
      nodes[0],
      nodes,
      superstate,
      nodes.length,
      false,
      undefined,
      true
    );
    // Children present and ORDERED BY RANK (c:0, a:1, b:2) despite input order.
    expect(tree.children.map((c) => c.id)).toEqual(["c", "a", "b"]);
    // Each child's .parent is back-linked to the root tree node.
    for (const child of tree.children) {
      expect(child.parent?.id).toBe("root");
    }
    // No grandchildren were invented; each child is a leaf.
    for (const child of tree.children) {
      expect(child.children).toEqual([]);
    }
  });

  it("nests grandchildren via the id-to-node parentId map (multi-level)", async () => {
    const superstate = makeSuperstate([], {
      schema: { id: "x", name: "x", type: "frame", def: "{}" },
      cols: [],
      rows: [],
    } as unknown as MDBFrame);
    const nodes: FrameNode[] = [
      frameNode({ id: "root", type: "group" }),
      frameNode({ id: "mid", parentId: "root", type: "group", rank: 0 }),
      frameNode({ id: "leaf", parentId: "mid", type: "text", rank: 0 }),
    ];
    const [tree] = await buildFrameTree(
      nodes[0],
      nodes,
      superstate,
      nodes.length,
      false,
      undefined,
      true
    );
    expect(tree.children.map((c) => c.id)).toEqual(["mid"]);
    const mid = tree.children[0];
    expect(mid.children.map((c) => c.id)).toEqual(["leaf"]);
    expect(mid.children[0].parent?.id).toBe("mid");
  });
});
