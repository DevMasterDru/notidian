// Co-located adversarial + characterization net for src/core/utils/frames/runner.ts
// (bd Notidian-ovd0 / Notidian-vke / ADR 0017 / ADR 0018).
//
// runner.ts is the module that OWNS the per-node $api trust gate the
// hardenFrameExecution kill-switch (Notidian-vke) actually flips:
//
//   isTrustedFrameNode(executable)            -> delegates to hasKitProvenance(node)
//   frameNodeMayUseApiInProps(executable, h)  -> the boundary callers pass `harden`
//                                                through; decides whether the node's
//                                                prop/style code keeps $api (full
//                                                vault-write access) during the
//                                                always-on render.
//
// trust.ts (hasKitProvenance) is adversarially pinned by trust.test.ts, and the
// END-TO-END $api flow through executeNode is pinned by trustBoundary.test.ts.
// runner.ts itself, however, was NOTEST: the two predicate functions that CONSUME
// the provenance signal — the exact gate the owner toggles — had no co-located
// suite, and the pure kit-vs-node style merge (styleAstsForNode) that the render
// path applies on every node had none at all.
//
// This suite closes both gaps as cheap, offline, deterministic logic tests:
//
//   A. frameNodeMayUseApiInProps / isTrustedFrameNode as PURE PREDICATES, hammered
//      with the adversarial inputs that matter for a security gate:
//        - harden falsy (false / undefined) => ALWAYS allow (legacy, byte-for-byte);
//        - harden true => allow ONLY kit-provenanced nodes;
//        - a FORGED persisted spaces://$kit/ ref with NO provenance marker is NOT
//          trusted (the core invariant: trust is NEVER read from node.ref);
//        - null / undefined executable, and an executable whose .node is missing,
//          DEFAULT-DENY when harden is on (and stay allowed only because the flag
//          is off) — never throw;
//        - cross-node isolation: stamping one node never confers trust on a sibling.
//   B. styleAstsForNode kit-vs-node merge precedence + background / hover conflict
//      resolution, pinned as CHARACTERIZATION (locks current behaviour, not a
//      desired spec) so a future refactor cannot silently change the render output.
//
// No new sinks, no render-path mutation — pure predicate + pure merge logic.
import { FrameExecutable, StyleAst } from "shared/types/frameExec";
import { FrameNode, FrameTreeProp } from "shared/types/mframe";
import {
  frameNodeMayUseApiInProps,
  isTrustedFrameNode,
  styleAstsForNode,
} from "./runner";
import { stampKitProvenance } from "./trust";

// The legacy (forgeable) "trusted" ref prefix. ref is a persisted,
// attacker-controllable DBRow column — used here ONLY to prove it confers no trust.
const FORGED_KIT_REF_PREFIX = "spaces://$kit/";

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

// A minimal FrameExecutable carrying a node. `trusted` stamps genuine,
// non-persisted kit provenance — the ONLY sound basis for trust. `ref` is
// independent stored data and must never grant trust.
const execFor = (node: FrameNode | undefined, trusted = false): FrameExecutable => {
  if (node && trusted) stampKitProvenance(node);
  return { node } as unknown as FrameExecutable;
};

describe("isTrustedFrameNode: trust comes ONLY from genuine provenance (Notidian-ovd0)", () => {
  it("is TRUE for a node stamped with genuine kit provenance", () => {
    expect(isTrustedFrameNode(execFor(plainNode(), true))).toBe(true);
  });

  it("is FALSE for a plain stored node (no provenance, no ref)", () => {
    expect(isTrustedFrameNode(execFor(plainNode()))).toBe(false);
  });

  it("is FALSE for a node whose ref FORGES the $kit prefix but has no provenance (trust is never read from node.ref)", () => {
    const forged = plainNode({ ref: `${FORGED_KIT_REF_PREFIX}#*listItem` });
    expect(isTrustedFrameNode(execFor(forged))).toBe(false);
  });

  it("a forged $kit ref does not become trusted even with a stored string 'kitProvenance' field", () => {
    // A persisted DBRow is Record<string,string>: the best an attacker can do is
    // set string-named columns. None are the module-private Symbol marker.
    const forged = plainNode({
      ref: `${FORGED_KIT_REF_PREFIX}#*spoofed`,
    }) as FrameNode & Record<string, unknown>;
    forged["kitProvenance"] = "true";
    forged["notidian.frame.kitProvenance"] = "true";
    expect(isTrustedFrameNode(execFor(forged as FrameNode))).toBe(false);
  });

  it("is FALSE (no throw) for an executable with a MISSING node", () => {
    expect(isTrustedFrameNode(execFor(undefined))).toBe(false);
  });

  it("is FALSE (no throw) for a null / undefined executable", () => {
    expect(isTrustedFrameNode(null as unknown as FrameExecutable)).toBe(false);
    expect(isTrustedFrameNode(undefined as unknown as FrameExecutable)).toBe(false);
  });

  it("does not leak trust to a sibling built from the same shape", () => {
    const trustedNode = plainNode({ id: "a" });
    const sibling = plainNode({ id: "b" });
    stampKitProvenance(trustedNode);
    expect(isTrustedFrameNode(execFor(trustedNode))).toBe(true);
    expect(isTrustedFrameNode(execFor(sibling))).toBe(false);
  });
});

describe("frameNodeMayUseApiInProps: the gate the kill-switch flips (Notidian-ovd0)", () => {
  const trusted = () => execFor(plainNode({ id: "k" }), true);
  const forgedRef = () =>
    execFor(plainNode({ id: "u", ref: `${FORGED_KIT_REF_PREFIX}#*x` }));
  const plainUser = () => execFor(plainNode({ id: "p" }));

  it("harden=false ALWAYS allows $api (legacy, byte-for-byte) — trusted, forged-ref, and plain alike", () => {
    expect(frameNodeMayUseApiInProps(trusted(), false)).toBe(true);
    expect(frameNodeMayUseApiInProps(forgedRef(), false)).toBe(true);
    expect(frameNodeMayUseApiInProps(plainUser(), false)).toBe(true);
  });

  it("harden=undefined ALWAYS allows $api (flag absent == off == legacy)", () => {
    expect(frameNodeMayUseApiInProps(trusted(), undefined)).toBe(true);
    expect(frameNodeMayUseApiInProps(forgedRef(), undefined)).toBe(true);
    expect(frameNodeMayUseApiInProps(plainUser(), undefined)).toBe(true);
  });

  it("harden=true allows $api ONLY for genuinely kit-provenanced nodes", () => {
    expect(frameNodeMayUseApiInProps(trusted(), true)).toBe(true);
    expect(frameNodeMayUseApiInProps(plainUser(), true)).toBe(false);
  });

  it("harden=true: a FORGED $kit ref (no provenance) is DENIED $api — the silent-on-render RCE the boundary closes", () => {
    expect(frameNodeMayUseApiInProps(forgedRef(), true)).toBe(false);
  });

  it("harden=true: null / undefined executable and a missing-node executable DEFAULT-DENY (no throw)", () => {
    expect(frameNodeMayUseApiInProps(null as unknown as FrameExecutable, true)).toBe(false);
    expect(frameNodeMayUseApiInProps(undefined as unknown as FrameExecutable, true)).toBe(false);
    expect(frameNodeMayUseApiInProps(execFor(undefined), true)).toBe(false);
  });

  it("harden=false: null / undefined executable still allowed by the flag-off short-circuit (predicate never inspects the node)", () => {
    // The harden short-circuit returns true BEFORE touching the executable, so the
    // legacy path is total even for degenerate inputs — and never throws.
    expect(frameNodeMayUseApiInProps(null as unknown as FrameExecutable, false)).toBe(true);
    expect(frameNodeMayUseApiInProps(undefined as unknown as FrameExecutable, undefined)).toBe(true);
  });

  it("cross-node isolation: stamping one node never grants $api to an unstamped sibling under harden=true", () => {
    const a = execFor(plainNode({ id: "a" }), true);
    const b = execFor(plainNode({ id: "b" }));
    expect(frameNodeMayUseApiInProps(a, true)).toBe(true);
    expect(frameNodeMayUseApiInProps(b, true)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// styleAstsForNode characterization. Locks the CURRENT pure-merge behaviour.
//
// Contract observed from the implementation:
//   * styleAsts falsy  -> returns null (caller skips the merge entirely).
//   * matched = styleAsts whose .sem === style.sem; their .styles fold into
//     `kitStyles` (later matches override earlier on shared keys), and their
//     .children are appended to the returned newStyleAsts (alongside the
//     originals).
//   * nodeOnlyStyles = style entries whose KEY is not present in kitStyles.
//   * PRECEDENCE: for a key in BOTH kit and node, the kit value wins (the node
//     value was filtered out of nodeOnlyStyles); node-only keys are preserved.
//   * background conflict: node background/backgroundImage drops kit backgroundColor.
//   * hover conflict: a kit `hover:backgroundColor*` key is renamed to
//     `hover:background` when the node sets background/backgroundImage.
// ---------------------------------------------------------------------------
const styleAst = (overrides: Partial<StyleAst> = {}): StyleAst => ({
  sem: "default",
  type: "",
  selector: "",
  styles: {},
  children: [],
  ...overrides,
});

describe("styleAstsForNode: returns null when there are no styleAsts (Notidian-ovd0)", () => {
  it("undefined styleAsts -> null", () => {
    expect(styleAstsForNode({ sem: "x", color: "red" } as FrameTreeProp, undefined)).toBeNull();
  });
});

describe("styleAstsForNode: kit-vs-node merge precedence (Notidian-ovd0)", () => {
  it("kit styles WIN for keys they define; node-only keys are preserved", () => {
    const style: FrameTreeProp = { sem: "card", color: "node-red", padding: "8px" };
    const kit = styleAst({ sem: "card", styles: { color: "kit-blue", margin: "4px" } });

    const [merged] = styleAstsForNode(style, [kit])!;

    // shared key (color): kit precedence
    expect(merged.color).toBe("kit-blue");
    // kit-only key carried in
    expect(merged.margin).toBe("4px");
    // node-only key preserved
    expect(merged.padding).toBe("8px");
  });

  it("a non-matching sem contributes no kit styles: the node styles pass through unchanged", () => {
    const style: FrameTreeProp = { sem: "list", color: "node-red" };
    const kit = styleAst({ sem: "card", styles: { color: "kit-blue" } });

    const [merged] = styleAstsForNode(style, [kit])!;

    // sem mismatch => kitStyles empty => node color survives, and `sem` itself is
    // a node-only key (not in kit) so it is retained.
    expect(merged.color).toBe("node-red");
    expect(merged.sem).toBe("list");
  });

  it("multiple matched StyleAsts fold together; a later match overrides an earlier one on a shared key", () => {
    const style: FrameTreeProp = { sem: "card", border: "node-border" };
    const first = styleAst({ sem: "card", styles: { color: "first", radius: "2px" } });
    const second = styleAst({ sem: "card", styles: { color: "second" } });

    const [merged] = styleAstsForNode(style, [first, second])!;

    expect(merged.color).toBe("second"); // later match wins in the kitStyles fold
    expect(merged.radius).toBe("2px"); // only-in-first key retained
    expect(merged.border).toBe("node-border"); // node-only key preserved
  });

  it("appends matched StyleAsts' children to the returned styleAst list (originals kept)", () => {
    const childA = styleAst({ sem: "child-a" });
    const childB = styleAst({ sem: "child-b" });
    const kit = styleAst({ sem: "card", children: [childA, childB] });
    const unrelated = styleAst({ sem: "other" });

    const [, returnedAsts] = styleAstsForNode({ sem: "card" } as FrameTreeProp, [
      kit,
      unrelated,
    ])!;

    // both original StyleAsts remain, plus the matched kit's two children
    expect(returnedAsts).toContain(kit);
    expect(returnedAsts).toContain(unrelated);
    expect(returnedAsts).toContain(childA);
    expect(returnedAsts).toContain(childB);
    expect(returnedAsts).toHaveLength(4);
  });

  it("does not mutate the passed-in styleAsts array (push targets a fresh copy)", () => {
    const kit = styleAst({ sem: "card", children: [styleAst({ sem: "c1" })] });
    const input = [kit];
    styleAstsForNode({ sem: "card" } as FrameTreeProp, input);
    expect(input).toHaveLength(1); // the original array is untouched
  });
});

describe("styleAstsForNode: background / backgroundColor conflict resolution (Notidian-ovd0)", () => {
  it("node `background` drops kit `backgroundColor` (so the node gradient/image is not overpainted)", () => {
    const style: FrameTreeProp = { sem: "card", background: "linear-gradient(...)" };
    const kit = styleAst({ sem: "card", styles: { backgroundColor: "#fff", color: "kit" } });

    const [merged] = styleAstsForNode(style, [kit])!;

    expect("backgroundColor" in merged).toBe(false);
    expect(merged.background).toBe("linear-gradient(...)");
    expect(merged.color).toBe("kit");
  });

  it("node `backgroundImage` also drops kit `backgroundColor`", () => {
    const style: FrameTreeProp = { sem: "card", backgroundImage: "url(x.png)" };
    const kit = styleAst({ sem: "card", styles: { backgroundColor: "#fff" } });

    const [merged] = styleAstsForNode(style, [kit])!;

    expect("backgroundColor" in merged).toBe(false);
    expect(merged.backgroundImage).toBe("url(x.png)");
  });

  it("with NO node background, kit `backgroundColor` is retained", () => {
    const style: FrameTreeProp = { sem: "card", color: "node" };
    const kit = styleAst({ sem: "card", styles: { backgroundColor: "#fff" } });

    const [merged] = styleAstsForNode(style, [kit])!;

    expect(merged.backgroundColor).toBe("#fff");
  });
});

describe("styleAstsForNode: hover:backgroundColor conflict resolution (Notidian-ovd0)", () => {
  it("renames kit `hover:backgroundColor` to `hover:background` when the node sets `background`", () => {
    const style: FrameTreeProp = { sem: "card", background: "linear-gradient(...)" };
    const kit = styleAst({
      sem: "card",
      styles: { "hover:backgroundColor": "#eee" },
    });

    const [merged] = styleAstsForNode(style, [kit])!;

    expect("hover:backgroundColor" in merged).toBe(false);
    expect(merged["hover:background"]).toBe("#eee");
  });

  it("leaves kit `hover:backgroundColor` intact when the node has no background", () => {
    const style: FrameTreeProp = { sem: "card", color: "node" };
    const kit = styleAst({
      sem: "card",
      styles: { "hover:backgroundColor": "#eee" },
    });

    const [merged] = styleAstsForNode(style, [kit])!;

    expect(merged["hover:backgroundColor"]).toBe("#eee");
    expect("hover:background" in merged).toBe(false);
  });
});
