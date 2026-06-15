// Frame-execution trust boundary (bd Notidian-vke / ADR 0018).
//
// Offline coverage for the new Function $api gate. Frame node props/styles are
// compiled to JS and run with $api (full vault write access). Default-kit frames
// REQUIRE $api in their props/styles, so a blanket gate would break default
// rendering — the boundary is per-node by SOURCE.
//
// SECURITY (the fix these tests now enforce): trust is derived from genuine,
// NON-PERSISTED provenance — a node's code keeps $api only if it was resolved
// from a plugin-shipped kit entry (superstate.kit) at expansion time and stamped
// by trusted expansion code (trust.ts). Trust is NOT derived from node.ref:
// `ref` is a persisted, attacker-controllable DBRow column, so a stored/imported
// row that forges the "spaces://$kit/" prefix MUST stay untrusted. These tests
// prove:
//   1. trust classification by provenance marker (not by ref string),
//   2. a forged $kit ref on stored content is NOT trusted (the headline fix),
//   3. the gate is a no-op when the flag is OFF (legacy behaviour preserved),
//   4. with the flag ON, $api is withheld from untrusted props/styles but kept
//      for genuinely kit-provenanced nodes,
//   5. actions always keep $api (they are user-triggered, not part of render),
//   6. END-TO-END through buildFrameTree/expandNode: a real kit resolution gets
//      provenance + $api, while a forged-ref stored frame does not.
//
// Runs in the default node env (no DOM) — pure execution-environment logic.
import { API, Superstate } from "makemd-core";
import { buildFrameTree } from "./ast";
import { FrameExecutable, FrameTreeNode } from "shared/types/frameExec";
import { FrameNode, FrameRoot, MDBFrame } from "shared/types/mframe";
import { buildExecutable } from "./executable";
import { frameToNode } from "./nodes";
import {
  executeNode,
  frameNodeMayUseApiInProps,
  isTrustedFrameNode,
  ResultStore,
} from "./runner";
import { hasKitProvenance, stampKitProvenance } from "./trust";

// The legacy (forgeable) "trusted" prefix — used ONLY to prove it no longer
// confers trust, never to confer it.
const FORGED_KIT_REF_PREFIX = "spaces://$kit/";

// A spy API: every call records that $api was reachable from the eval scope.
const makeSpyApi = () => {
  const calls: string[] = [];
  const api = {
    probe: {
      ping: (tag: string) => {
        calls.push(tag);
        return `pong:${tag}`;
      },
    },
  } as unknown as API;
  return { api, calls };
};

// Build a single-node FrameExecutable tree from raw prop/style/action strings.
// `trusted` stamps genuine (non-persisted) kit provenance — the ONLY way to be
// trusted now. `ref` is independent: it is stored data and must never grant trust.
const makeNode = (
  id: string,
  ref: string | undefined,
  parts: { props?: Record<string, string>; styles?: Record<string, string>; actions?: Record<string, string> },
  trusted = false
): FrameExecutable => {
  const node: FrameNode = {
    id,
    schemaId: "s1",
    name: id,
    type: "text",
    rank: 0,
    ref,
    props: parts.props ?? {},
    styles: parts.styles ?? {},
    actions: parts.actions ?? {},
  };
  if (trusted) stampKitProvenance(node);
  const tree: FrameTreeNode = {
    id,
    node,
    isRef: false,
    children: [],
    editorProps: { editMode: 0 },
    parent: null,
  };
  return buildExecutable(tree);
};

const freshStore = (): ResultStore => ({
  state: {},
  newState: {},
  slides: {},
  prevState: {},
});

describe("trust classification (Notidian-vke)", () => {
  it("treats a node stamped with genuine kit provenance as trusted", () => {
    const node = makeNode("k1", `${FORGED_KIT_REF_PREFIX}#*listItem`, {}, true);
    expect(isTrustedFrameNode(node)).toBe(true);
  });

  it("a forged $kit ref WITHOUT genuine provenance is UNTRUSTED (the fix)", () => {
    // Byte-identical ref to a real default-kit node, but stored/imported content:
    // no provenance marker => must be untrusted.
    const forged = makeNode("spoof", `${FORGED_KIT_REF_PREFIX}#*listItem`, {}, false);
    expect(isTrustedFrameNode(forged)).toBe(false);
  });

  it("forged provenance is unforgeable from stored data: frameToNode of a row that even tries to carry a marker stays untrusted", () => {
    // A persisted DBRow is Record<string,string>; it can never carry the Symbol
    // marker. Even a row that tries to set a string field named like the marker
    // is just data and confers no trust.
    const storedRow = {
      id: "spoof",
      schemaId: "main",
      name: "spoof",
      type: "text",
      rank: "0",
      ref: `${FORGED_KIT_REF_PREFIX}#*spoofed`,
      props: JSON.stringify({ value: "$api.probe.ping('STORED-SPOOF')" }),
      styles: "{}",
      actions: "{}",
      interactions: "{}",
      contexts: "{}",
      // attacker attempt to smuggle a trust field via raw column:
      kitProvenance: "true",
      "notidian.frame.kitProvenance": "true",
    } as any;
    const node = frameToNode(storedRow);
    expect(hasKitProvenance(node)).toBe(false);
    const exec = buildExecutable({
      id: node.id,
      node,
      isRef: false,
      children: [],
      editorProps: { editMode: 0 },
      parent: null,
    });
    expect(isTrustedFrameNode(exec)).toBe(false);
  });

  it("treats a user/imported frame (non-$kit ref or no ref) as untrusted", () => {
    expect(isTrustedFrameNode(makeNode("u1", "spaces://My Space/#*main", {}))).toBe(
      false
    );
    expect(isTrustedFrameNode(makeNode("u2", undefined, {}))).toBe(false);
    expect(isTrustedFrameNode(makeNode("u3", "", {}))).toBe(false);
  });

  it("frameNodeMayUseApiInProps: flag OFF always allows; flag ON allows only genuinely-provenanced", () => {
    const trusted = makeNode("t", undefined, {}, true);
    const forgedRef = makeNode("u", `${FORGED_KIT_REF_PREFIX}#*x`, {}, false);
    // OFF -> both allowed (legacy)
    expect(frameNodeMayUseApiInProps(trusted, false)).toBe(true);
    expect(frameNodeMayUseApiInProps(forgedRef, false)).toBe(true);
    expect(frameNodeMayUseApiInProps(forgedRef, undefined)).toBe(true);
    // ON -> only genuine provenance; forged ref is denied
    expect(frameNodeMayUseApiInProps(trusted, true)).toBe(true);
    expect(frameNodeMayUseApiInProps(forgedRef, true)).toBe(false);
  });
});

describe("prop $api gate (Notidian-vke)", () => {
  it("flag OFF: an untrusted node's prop CAN reach $api (legacy behaviour intact)", async () => {
    const { api, calls } = makeSpyApi();
    const node = makeNode("u1", "spaces://My Space/#*main", {
      props: { value: "$api.probe.ping('off-untrusted')" },
    });
    const out = await executeNode(node, freshStore(), {}, api, false);
    expect(calls).toContain("off-untrusted");
    expect(out.state["u1"].props.value).toBe("pong:off-untrusted");
  });

  it("flag ON: an untrusted node's prop CANNOT reach $api ($api.* throws, caught)", async () => {
    const { api, calls } = makeSpyApi();
    const node = makeNode("u1", "spaces://My Space/#*main", {
      props: { value: "$api.probe.ping('on-untrusted')" },
    });
    const out = await executeNode(node, freshStore(), {}, api, true);
    expect(calls).not.toContain("on-untrusted");
    // the throwing prop is swallowed per-key, so the value is not set
    expect(out.state["u1"].props.value).toBeUndefined();
  });

  it("flag ON: a FORGED $kit ref (no provenance) CANNOT reach $api (the headline RCE is closed)", async () => {
    const { api, calls } = makeSpyApi();
    const node = makeNode("spoof", `${FORGED_KIT_REF_PREFIX}#*spoofed`, {
      props: { value: "$api.probe.ping('STORED-SPOOF')" },
    });
    const out = await executeNode(node, freshStore(), {}, api, true);
    expect(calls).not.toContain("STORED-SPOOF");
    expect(out.state["spoof"].props.value).toBeUndefined();
  });

  it("flag ON: a genuinely kit-provenanced node's prop STILL reaches $api (render not broken)", async () => {
    const { api, calls } = makeSpyApi();
    const node = makeNode("k1", undefined, {
      props: { value: "$api.probe.ping('on-trusted')" },
    }, true);
    const out = await executeNode(node, freshStore(), {}, api, true);
    expect(calls).toContain("on-trusted");
    expect(out.state["k1"].props.value).toBe("pong:on-trusted");
  });

  it("flag ON: a const prop (no $api) on an untrusted node still evaluates", async () => {
    const { api } = makeSpyApi();
    const node = makeNode("u1", "spaces://My Space/#*main", {
      props: { value: "'plain text'" },
    });
    const out = await executeNode(node, freshStore(), {}, api, true);
    expect(out.state["u1"].props.value).toBe("plain text");
  });
});

describe("style $api gate (Notidian-vke)", () => {
  it("flag ON: an untrusted node's style CANNOT reach $api", async () => {
    const { api, calls } = makeSpyApi();
    const node = makeNode("u1", "spaces://My Space/#*main", {
      styles: { background: "$api.probe.ping('on-untrusted-style')" },
    });
    const out = await executeNode(node, freshStore(), {}, api, true);
    expect(calls).not.toContain("on-untrusted-style");
    expect(out.state["u1"].styles.background).toBeUndefined();
  });

  it("flag ON: a forged $kit ref style (no provenance) CANNOT reach $api", async () => {
    const { api, calls } = makeSpyApi();
    const node = makeNode("spoof", `${FORGED_KIT_REF_PREFIX}#*spoofed`, {
      styles: { background: "$api.probe.ping('forged-style')" },
    });
    const out = await executeNode(node, freshStore(), {}, api, true);
    expect(calls).not.toContain("forged-style");
    expect(out.state["spoof"].styles.background).toBeUndefined();
  });

  it("flag ON: a genuinely kit-provenanced node's style STILL reaches $api", async () => {
    const { api, calls } = makeSpyApi();
    const node = makeNode("k1", undefined, {
      styles: { background: "$api.probe.ping('on-trusted-style')" },
    }, true);
    const out = await executeNode(node, freshStore(), {}, api, true);
    expect(calls).toContain("on-trusted-style");
    expect(out.state["k1"].styles.background).toBe("pong:on-trusted-style");
  });

  it("flag OFF: an untrusted node's style reaches $api (legacy)", async () => {
    const { api, calls } = makeSpyApi();
    const node = makeNode("u1", "spaces://My Space/#*main", {
      styles: { background: "$api.probe.ping('off-untrusted-style')" },
    });
    const out = await executeNode(node, freshStore(), {}, api, false);
    expect(calls).toContain("off-untrusted-style");
    expect(out.state["u1"].styles.background).toBe("pong:off-untrusted-style");
  });
});

describe("actions always keep $api (Notidian-vke)", () => {
  // Actions are user-triggered (onClick/onChange), not part of the always-on
  // render, so the boundary keeps $api for them regardless of trust/flag. Action
  // code blocks compile to closures ($event,$value,$state,$saveState,$api) => {...},
  // so $api arrives as a closure parameter rather than from the with(this) scope.
  it("flag ON: an untrusted node's action closure receives $api as a parameter", async () => {
    const { api, calls } = makeSpyApi();
    const node = makeNode("u1", "spaces://My Space/#*main", {
      actions: { onClick: "$api.probe.ping('action-untrusted')" },
    });
    const out = await executeNode(node, freshStore(), {}, api, true);
    const onClick = out.state["u1"].actions.onClick as (
      ...args: unknown[]
    ) => void;
    expect(typeof onClick).toBe("function");
    // Invoke the compiled action closure with the real api in the $api slot.
    const noop: () => void = () => undefined;
    onClick(null, null, {}, noop, api);
    expect(calls).toContain("action-untrusted");
  });
});

describe("isolation across nodes in one render (Notidian-vke)", () => {
  it("flag ON: an untrusted node clearing $api does not break a later trusted node", async () => {
    const { api, calls } = makeSpyApi();
    const store = freshStore();
    const untrusted = makeNode("u1", "spaces://My Space/#*main", {
      props: { value: "$api.probe.ping('untrusted-first')" },
    });
    const trusted = makeNode("k1", undefined, {
      props: { value: "$api.probe.ping('trusted-second')" },
    }, true);
    await executeNode(untrusted, store, {}, api, true);
    await executeNode(trusted, store, {}, api, true);
    expect(calls).not.toContain("untrusted-first");
    expect(calls).toContain("trusted-second");
  });
});

// End-to-end: drive the REAL expansion pipeline (buildFrameTree -> expandFrame ->
// expandNode -> getFrameNodesByPath) so provenance is stamped exactly where it is
// in production. This is the test the earlier ref-based boundary could not pass:
// a forged $kit ref pointing at NO real kit entry must not become trusted.
describe("end-to-end provenance via buildFrameTree (Notidian-vke)", () => {
  // A genuine kit entry: a single text node that uses $api in its prop.
  const kitListItem = (): FrameRoot => ({
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

  // Minimal Superstate stub: only the surface ast.ts touches during expansion.
  const makeSuperstate = (kit: FrameRoot[]): Superstate =>
    ({
      kit,
      spaceManager: {
        uriByString: (ref: string) => {
          // model "spaces://$kit/#*<id>" -> { authority:'$kit', ref:'<id>' }
          if (ref?.startsWith("spaces://$kit/#*")) {
            return { authority: "$kit", ref: ref.replace("spaces://$kit/#*", ""), basePath: "$kit", scheme: "spaces", fullPath: ref };
          }
          if (ref?.startsWith("spaces://")) {
            return { authority: "My Space", ref: "main", basePath: "My Space", scheme: "spaces", fullPath: ref };
          }
          return null;
        },
        // user frames resolve here; return nothing so unrelated refs no-op.
        readFrame: async (): Promise<MDBFrame | undefined> => undefined,
      },
    } as unknown as Superstate);

  const collect = (node: FrameTreeNode, out: FrameTreeNode[] = []): FrameTreeNode[] => {
    out.push(node);
    (node.children ?? []).forEach((c) => collect(c, out));
    return out;
  };

  it("a REAL kit resolution stamps non-persisted provenance on the resolved subtree", async () => {
    const superstate = makeSuperstate([kitListItem()]);
    // A user frame whose child references the real kit entry.
    const nodes: FrameNode[] = [
      { id: "root", schemaId: "root", name: "root", rank: 0, type: "group", props: {}, styles: {}, actions: {} },
      {
        id: "ref1",
        schemaId: "root",
        parentId: "root",
        name: "ref1",
        rank: 0,
        type: "frame",
        ref: "spaces://$kit/#*secProbeItem",
        props: {},
        styles: {},
        actions: {},
      },
    ];
    const [tree] = await buildFrameTree(nodes[0], nodes, superstate, nodes.length, false);
    const all = collect(tree);
    // At least one materialized node carries genuine provenance, and it is the
    // kit-resolved code (value prop references $api).
    const provenanced = all.filter((n) => hasKitProvenance(n.node));
    expect(provenanced.length).toBeGreaterThan(0);
    // The user root must NOT be provenanced (it is stored content).
    const root = all.find((n) => n.id === "root");
    expect(hasKitProvenance(root!.node)).toBe(false);
  });

  it("a forged $kit ref pointing at NO real kit entry is NOT provenanced", async () => {
    // Empty kit: superstate.kit.find returns nothing for the forged id.
    const superstate = makeSuperstate([]);
    const nodes: FrameNode[] = [
      { id: "root", schemaId: "root", name: "root", rank: 0, type: "group", props: {}, styles: {}, actions: {} },
      {
        id: "spoof",
        schemaId: "root",
        parentId: "root",
        name: "spoof",
        rank: 0,
        type: "frame",
        ref: "spaces://$kit/#*doesNotExist",
        props: { value: "$api.probe.ping('FORGED')" },
        styles: {},
        actions: {},
      },
    ];
    const [tree] = await buildFrameTree(nodes[0], nodes, superstate, nodes.length, false);
    const all = collect(tree);
    // No node may be provenanced — the forged ref resolved to nothing.
    expect(all.every((n) => !hasKitProvenance(n.node))).toBe(true);
  });
});
