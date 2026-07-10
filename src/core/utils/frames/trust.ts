// bd Notidian-vke — frame-execution trust provenance (the SOUND signal).
//
// The frame-execution trust boundary (runner.ts) decides whether a node keeps
// $api (full vault write access) during the always-on prop/style render. The
// ONLY sound basis for that decision is genuine PROVENANCE: did this node's code
// originate from a plugin-shipped kit entry resolved at expansion time
// (superstate.kit.find -> rootToFrame in ast.ts), or is it stored frame content
// (user-authored views.mdb rows, .mkit-imported rows) that an attacker controls?
//
// The earlier implementation derived trust from node.ref.startsWith(
// "spaces://$kit/"). That was UNSOUND: `ref` is a persisted DBRow column
// (frameToNode spreads it verbatim, nodeToFrame writes it back), so it is fully
// attacker-controllable and freely forgeable — any stored row could set
// ref:"spaces://$kit/#*x" and silently regain $api on every render even with the
// boundary ON. Worse, legitimate user frames that embed default-kit elements
// ALSO persist spaces://$kit/... refs, so the "trusted" string and a forged
// string are byte-identical in the same column — ref cannot distinguish plugin
// code from stored content even in principle.
//
// The fix: trust is a NON-PERSISTED runtime marker, stamped exactly once, only
// on nodes whose code came out of a resolved superstate.kit entry during
// expansion. It is a non-enumerable, Symbol-keyed own property:
//   - Symbol-keyed: a DBRow is Record<string,string>; neither frameToNode's
//     spread of a stored row nor JSON deserialization can ever produce a Symbol
//     key, so stored/imported data can never carry it. Unforgeable by design.
//   - non-enumerable: it never appears in {...spread} copies of the node, so it
//     can never accidentally ride into nodeToFrame / persistence, and it must be
//     re-stamped explicitly by trusted code — silence defaults to UNTRUSTED.
//
// Because non-enumerable props are dropped by object spread, expansion re-stamps
// the marker on the materialized executable subtree after the link/build
// transforms (see stampKitProvenanceTree), rather than relying on it surviving
// every intermediate {...node} copy.

import { FrameNode } from "shared/types/mframe";
import { FrameTreeNode } from "shared/types/frameExec";

// Module-private Symbol — not exported, not registered in the global symbol
// registry (Symbol(), not Symbol.for(...)), so it cannot be reconstructed or
// referenced from outside this module / from deserialized data.
const KIT_PROVENANCE = Symbol("notidian.frame.kitProvenance");

type Stampable = { [KIT_PROVENANCE]?: true };

// Stamp a single FrameNode as kit-provenanced. Idempotent. The property is
// non-enumerable + non-configurable + non-writable so it is invisible to spreads
// and JSON, and cannot be silently flipped off once set.
export const stampKitProvenance = (node: FrameNode): FrameNode => {
  if (!node) return node;
  if ((node as Stampable)[KIT_PROVENANCE] === true) return node;
  Object.defineProperty(node, KIT_PROVENANCE, {
    value: true,
    enumerable: false,
    configurable: false,
    writable: false,
  });
  return node;
};

// True only if this exact node object was stamped by trusted expansion code.
// Stored/imported data can never satisfy this (no Symbol key survives the DB).
export const hasKitProvenance = (node: FrameNode | undefined | null): boolean => {
  return !!node && (node as Stampable)[KIT_PROVENANCE] === true;
};

// Re-stamp kit provenance across a materialized tree node and all of its
// descendants. Used by expandNode after a $kit ref resolves: the link/build
// transforms spread node objects (dropping the non-enumerable marker), so the
// authoritative re-stamp happens on the final FrameTreeNode the boundary sees.
export const stampKitProvenanceTree = (tree: FrameTreeNode): FrameTreeNode => {
  if (!tree) return tree;
  stampKitProvenance(tree.node);
  (tree.children ?? []).forEach((child) => stampKitProvenanceTree(child));
  return tree;
};

// bd Notidian-214 — provenance-preserving clone support.
//
// The render path deep-clones the frame tree before execution
// (FrameInstanceContext.runRoot: _.cloneDeep(root)). By the SAME mechanism that
// makes the marker unforgeable — a non-enumerable Symbol never rides a copy —
// cloneDeep DROPS the marker, so a cloned kit subtree (or a user tree the owner
// blessed IN MEMORY) would lose $api under hardenFrameExecution even though its
// ORIGIN is genuinely trusted. This walks a freshly-cloned tree in parallel with
// its SOURCE and re-applies provenance node-by-node.
//
// SECURITY: trust still derives ONLY from the source object's genuine provenance
// (set by kit resolution in ast.ts, or by an explicit in-memory user bless). A
// source node that is not itself provenanced NEVER confers trust on its clone —
// no persisted/attacker-controllable value (ref, mdb, frontmatter, data.json) is
// consulted here. cloneDeep preserves child order/count, so the structural
// walk is exact; length-mismatched/missing children are tolerated.
export const reStampProvenanceFromSource = (
  clone: FrameTreeNode | undefined | null,
  source: FrameTreeNode | undefined | null
): void => {
  if (!clone || !source) return;
  if (hasKitProvenance(source.node)) stampKitProvenance(clone.node);
  const cloneChildren = clone.children ?? [];
  const sourceChildren = source.children ?? [];
  const childCount = Math.min(cloneChildren.length, sourceChildren.length);
  for (let i = 0; i < childCount; i++) {
    reStampProvenanceFromSource(cloneChildren[i], sourceChildren[i]);
  }
  // bd Notidian-214: a `list` node caches its item template in
  // execPropsOptions.template; the runner rebuilds one materialized item per row
  // FROM that template (executable.ts / runner.ts), spreading the template node
  // (which drops the marker). Re-stamp the CLONED template from the source
  // template so a kit list's generated items inherit genuine provenance — else a
  // default kit list would lose $api AND spuriously trip the withhold diagnostic.
  const cloneTemplate = (clone as { execPropsOptions?: { template?: FrameTreeNode[] } })
    .execPropsOptions?.template;
  const sourceTemplate = (source as { execPropsOptions?: { template?: FrameTreeNode[] } })
    .execPropsOptions?.template;
  if (cloneTemplate && sourceTemplate) {
    const templateCount = Math.min(cloneTemplate.length, sourceTemplate.length);
    for (let i = 0; i < templateCount; i++) {
      reStampProvenanceFromSource(cloneTemplate[i], sourceTemplate[i]);
    }
  }
};
