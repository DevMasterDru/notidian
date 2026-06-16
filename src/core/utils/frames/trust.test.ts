/**
 * @jest-environment jsdom
 */
// Co-located adversarial unit suite for the frame-execution trust provenance
// signal (bd Notidian-vke / ADR 0018), the SOUND basis on which the always-on
// prop/style render boundary (runner.ts) decides whether a user/imported frame
// node keeps $api (full vault write access). trustBoundary.test.ts proves the
// boundary's END-TO-END behaviour through the runner/expansion pipeline; THIS
// suite proves the trust.ts primitives hold their security invariants BY
// CONSTRUCTION — the by-design properties an attacker would attack directly:
//
//   1. hasKitProvenance is FALSE for stored/serialized/spread-copied data
//      (the non-enumerable Symbol marker cannot survive a DBRow shape, a
//      JSON round-trip, or {...spread} — silence defaults to UNTRUSTED).
//   2. hasKitProvenance is TRUE only on the EXACT object stampKitProvenance ran
//      on, never on a sibling/copy.
//   3. the marker is non-writable + non-configurable: it cannot be flipped off,
//      redefined, deleted, or forged via a string 'kitProvenance' key or any
//      different Symbol; stamping is idempotent.
//   4. a forged ref:'spaces://$kit/...' column confers NO trust (ref is a
//      persisted, attacker-controllable column — never a provenance signal).
//   5. stampKitProvenanceTree re-stamps node + ALL descendants and tolerates
//      missing/empty children arrays.
//
// Pure logic, no render-path import. Runs under jsdom only to match the harness
// requested by the bead; it exercises no DOM.
import { FrameNode } from "shared/types/mframe";
import { FrameTreeNode } from "shared/types/frameExec";
import {
  hasKitProvenance,
  stampKitProvenance,
  stampKitProvenanceTree,
} from "./trust";

// The legacy (forgeable) "trusted" ref prefix. Used ONLY to prove it confers no
// trust — never to grant it.
const FORGED_KIT_REF_PREFIX = "spaces://$kit/";

// A plain, stored-shaped FrameNode exactly as frameToNode materializes a DBRow:
// only ordinary enumerable string/object fields, no Symbol keys.
const plainNode = (overrides: Partial<FrameNode> = {}): FrameNode => ({
  id: "n1",
  schemaId: "s1",
  name: "n1",
  type: "text",
  rank: 0,
  props: {},
  styles: {},
  actions: {},
  ...overrides,
});

const treeNode = (node: FrameNode, children: FrameTreeNode[] = []): FrameTreeNode => ({
  id: node.id,
  node,
  isRef: false,
  children,
  editorProps: { editMode: 0 },
  parent: null,
});

describe("hasKitProvenance: untrusted by default (stored/serialized/copied data)", () => {
  it("is FALSE for a plain stored DBRow-shaped node", () => {
    expect(hasKitProvenance(plainNode())).toBe(false);
  });

  it("is FALSE for a node whose ref forges the $kit prefix (ref is not a trust signal)", () => {
    const forged = plainNode({ ref: `${FORGED_KIT_REF_PREFIX}#*listItem` });
    expect(hasKitProvenance(forged)).toBe(false);
  });

  it("is FALSE after a JSON.parse(JSON.stringify(...)) round-trip of a STAMPED node", () => {
    // The marker is non-enumerable + Symbol-keyed, so JSON serialization cannot
    // observe it and deserialization cannot reconstruct it: persistence strips
    // trust, exactly as a views.mdb write/read would.
    const stamped = stampKitProvenance(plainNode());
    expect(hasKitProvenance(stamped)).toBe(true);
    const roundTripped = JSON.parse(JSON.stringify(stamped)) as FrameNode;
    expect(hasKitProvenance(roundTripped)).toBe(false);
  });

  it("is FALSE for a {...spread} copy of a STAMPED node (non-enumerable drops on spread)", () => {
    // nodeToFrame and the link/build transforms spread node objects; a
    // non-enumerable marker never rides along, so a copy is untrusted by design.
    const stamped = stampKitProvenance(plainNode());
    const copy: FrameNode = { ...stamped };
    expect(hasKitProvenance(stamped)).toBe(true);
    expect(hasKitProvenance(copy)).toBe(false);
  });

  it("is FALSE for an Object.assign({}, stamped) copy", () => {
    const stamped = stampKitProvenance(plainNode());
    const copy = Object.assign({}, stamped) as FrameNode;
    expect(hasKitProvenance(copy)).toBe(false);
  });

  it("is FALSE for undefined / null inputs (no throw)", () => {
    expect(hasKitProvenance(undefined)).toBe(false);
    expect(hasKitProvenance(null)).toBe(false);
  });
});

describe("stampKitProvenance: trust only on the exact stamped object", () => {
  it("makes hasKitProvenance TRUE only after stamping, on that exact object", () => {
    const node = plainNode();
    expect(hasKitProvenance(node)).toBe(false);
    const returned = stampKitProvenance(node);
    expect(returned).toBe(node); // returns the same reference, mutated in place
    expect(hasKitProvenance(node)).toBe(true);
  });

  it("does not leak trust to a sibling object built from the same shape", () => {
    const a = plainNode({ id: "a" });
    const b = plainNode({ id: "b" });
    stampKitProvenance(a);
    expect(hasKitProvenance(a)).toBe(true);
    expect(hasKitProvenance(b)).toBe(false);
  });

  it("tolerates a falsy node argument without throwing", () => {
    expect(() => stampKitProvenance(undefined as unknown as FrameNode)).not.toThrow();
    expect(stampKitProvenance(undefined as unknown as FrameNode)).toBeUndefined();
  });

  it("is idempotent: re-stamping keeps trust and does not throw despite non-configurable", () => {
    // A naive re-defineProperty on a non-configurable key would throw; the early
    // return on the already-stamped check must prevent that.
    const node = plainNode();
    stampKitProvenance(node);
    expect(() => stampKitProvenance(node)).not.toThrow();
    expect(() => stampKitProvenance(node)).not.toThrow();
    expect(hasKitProvenance(node)).toBe(true);
  });
});

describe("the marker is hardened: non-enumerable, non-writable, non-configurable", () => {
  // Locate the single Symbol key the module stamped so we can attack it
  // directly — without importing it (it is intentionally module-private).
  const provenanceSymbolOf = (node: FrameNode): symbol | undefined =>
    Object.getOwnPropertySymbols(node).find(
      (s) => (node as Record<symbol, unknown>)[s] === true
    );

  it("the stamped property is non-enumerable, non-writable, non-configurable", () => {
    const node = plainNode();
    stampKitProvenance(node);
    const sym = provenanceSymbolOf(node)!;
    expect(sym).toBeDefined();
    const desc = Object.getOwnPropertyDescriptor(node, sym)!;
    expect(desc.enumerable).toBe(false);
    expect(desc.writable).toBe(false);
    expect(desc.configurable).toBe(false);
    expect(desc.value).toBe(true);
  });

  it("cannot be flipped off by assignment (non-writable: throws in strict mode / no effect)", () => {
    "use strict";
    const node = plainNode();
    stampKitProvenance(node);
    const sym = provenanceSymbolOf(node)!;
    // ts-jest compiles modules in strict mode, so assignment to a non-writable
    // own property throws; either way the value must remain trusted.
    expect(() => {
      (node as Record<symbol, unknown>)[sym] = false;
    }).toThrow(TypeError);
    expect(hasKitProvenance(node)).toBe(true);
  });

  it("cannot be deleted (non-configurable: delete throws / fails)", () => {
    const node = plainNode();
    stampKitProvenance(node);
    const sym = provenanceSymbolOf(node)!;
    expect(() => {
      delete (node as Record<symbol, unknown>)[sym];
    }).toThrow(TypeError);
    expect(hasKitProvenance(node)).toBe(true);
  });

  it("cannot be redefined to false via defineProperty (non-configurable)", () => {
    const node = plainNode();
    stampKitProvenance(node);
    const sym = provenanceSymbolOf(node)!;
    expect(() =>
      Object.defineProperty(node, sym, { value: false })
    ).toThrow(TypeError);
    expect(hasKitProvenance(node)).toBe(true);
  });
});

describe("forgery is impossible from data: wrong key types confer no trust", () => {
  it("a string 'kitProvenance' key (and a stringified marker name) confers NO trust", () => {
    // A persisted DBRow is Record<string,string>; the closest an attacker can do
    // is set string-named fields. None are the module-private Symbol key.
    const forged = plainNode() as FrameNode & Record<string, unknown>;
    forged["kitProvenance"] = "true";
    forged["notidian.frame.kitProvenance"] = "true";
    forged["Symbol(notidian.frame.kitProvenance)"] = true;
    expect(hasKitProvenance(forged as FrameNode)).toBe(false);
  });

  it("a DIFFERENT Symbol key (including a same-description Symbol) confers NO trust", () => {
    const node = plainNode() as FrameNode & Record<symbol, unknown>;
    // Same human-readable description, but a distinct Symbol identity.
    node[Symbol("notidian.frame.kitProvenance")] = true;
    // A globally-registered Symbol of the same description — also distinct.
    node[Symbol.for("notidian.frame.kitProvenance")] = true;
    expect(hasKitProvenance(node as FrameNode)).toBe(false);
  });

  it("a forged ref:'spaces://$kit/...' column never upgrades a stored node to trusted", () => {
    const forged = plainNode({
      ref: `${FORGED_KIT_REF_PREFIX}#*spoofed`,
      props: { value: "$api.probe.ping('STORED-SPOOF')" },
    });
    expect(hasKitProvenance(forged)).toBe(false);
    // ...and remains untrusted even after a serialize round-trip (no marker to lose).
    const roundTripped = JSON.parse(JSON.stringify(forged)) as FrameNode;
    expect(hasKitProvenance(roundTripped)).toBe(false);
  });
});

describe("stampKitProvenanceTree: re-stamp node + all descendants", () => {
  it("stamps the root node and every descendant, returning the same tree", () => {
    const root = plainNode({ id: "root" });
    const childA = plainNode({ id: "a" });
    const grandchild = plainNode({ id: "a1" });
    const childB = plainNode({ id: "b" });
    const tree = treeNode(root, [
      treeNode(childA, [treeNode(grandchild)]),
      treeNode(childB),
    ]);

    // Nothing trusted before.
    expect(hasKitProvenance(root)).toBe(false);
    expect(hasKitProvenance(grandchild)).toBe(false);

    const returned = stampKitProvenanceTree(tree);
    expect(returned).toBe(tree);

    for (const node of [root, childA, grandchild, childB]) {
      expect(hasKitProvenance(node)).toBe(true);
    }
  });

  it("tolerates a node with NO children array (undefined children)", () => {
    const node = plainNode({ id: "lonely" });
    const tree = {
      id: node.id,
      node,
      isRef: false,
      // children intentionally omitted to model a partially-built tree node
      editorProps: { editMode: 0 },
      parent: null,
    } as unknown as FrameTreeNode;
    expect(() => stampKitProvenanceTree(tree)).not.toThrow();
    expect(hasKitProvenance(node)).toBe(true);
  });

  it("tolerates an empty children array", () => {
    const node = plainNode({ id: "leaf" });
    const tree = treeNode(node, []);
    expect(() => stampKitProvenanceTree(tree)).not.toThrow();
    expect(hasKitProvenance(node)).toBe(true);
  });

  it("tolerates a falsy tree argument without throwing", () => {
    expect(() =>
      stampKitProvenanceTree(undefined as unknown as FrameTreeNode)
    ).not.toThrow();
    expect(
      stampKitProvenanceTree(undefined as unknown as FrameTreeNode)
    ).toBeUndefined();
  });

  it("a spread copy of a tree-stamped node is untrusted (re-stamp is per-object, not inherited)", () => {
    // Proves WHY expansion must re-stamp on the FINAL materialized subtree: any
    // intermediate {...node} copy in the link/build transforms loses trust.
    const node = plainNode({ id: "x" });
    stampKitProvenanceTree(treeNode(node));
    expect(hasKitProvenance(node)).toBe(true);
    expect(hasKitProvenance({ ...node })).toBe(false);
  });
});
