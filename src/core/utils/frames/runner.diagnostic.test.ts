// bd Notidian-214 / ADR 0022 — the read-only "$api withheld" diagnostic and the
// session-scoped bless, at the runner/trust seam (pure, no React).
//
// Two behaviours are pinned:
//   1. DIAGNOSTIC: when hardenFrameExecution withholds $api from an untrusted
//      node whose props/styles reference $api, the runner reports WHICH
//      expressions were no-op'd via onApiWithheld — and stays silent for trusted
//      nodes, for the flag-off legacy path, and for nodes that never use $api.
//   2. BLESS: stamping the SOURCE tree (the user gesture) + re-stamping the
//      render-path clone (reStampProvenanceFromSource, what runRoot now does)
//      RESTORES $api — while a forged $kit ref, even after the same re-stamp,
//      stays withheld (ref is never a trust signal).
import _ from "lodash";
import { API } from "makemd-core";
import { FrameExecutable, FrameTreeNode } from "shared/types/frameExec";
import { FrameNode } from "shared/types/mframe";
import { buildExecutable } from "./executable";
import {
  apiWithheldExpressions,
  executeNode,
  ResultStore,
} from "./runner";
import {
  hasKitProvenance,
  reStampProvenanceFromSource,
  stampKitProvenance,
  stampKitProvenanceTree,
} from "./trust";
import {
  blessFrameById,
  fingerprintFrameTree,
  pendingBlessFrameIds,
  registerFrameBless,
  resetFrameTrustSession,
  restampSessionBless,
  sessionBlessFingerprint,
  shouldNotifyApiWithheld,
  unregisterFrame,
} from "./frameTrustSession";

const FORGED_KIT_REF_PREFIX = "spaces://$kit/";

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

describe("apiWithheldExpressions: which render expressions reference $api", () => {
  it("lists prop and style keys that reference $api", () => {
    const node = makeNode("u1", "spaces://My Space/#*main", {
      props: { value: "$api.path.label($contexts.$space.note)", title: "'static'" },
      styles: { background: "$api.color.pick()", color: "'red'" },
    });
    expect(apiWithheldExpressions(node).sort()).toEqual(
      ["props.value", "styles.background"].sort()
    );
  });

  it("returns [] when the node uses no $api in props/styles (withhold is a true no-op)", () => {
    const node = makeNode("u1", "spaces://My Space/#*main", {
      props: { value: "'plain'" },
      styles: { color: "'red'" },
    });
    expect(apiWithheldExpressions(node)).toEqual([]);
  });

  it("ignores actions ($api is always kept for user-triggered actions)", () => {
    const node = makeNode("u1", "spaces://My Space/#*main", {
      actions: { onClick: "$api.probe.ping('x')" },
    });
    expect(apiWithheldExpressions(node)).toEqual([]);
  });

  it("does not match a substring like $apiary (word-boundary)", () => {
    const node = makeNode("u1", undefined, { props: { value: "$apiary + 1" } });
    expect(apiWithheldExpressions(node)).toEqual([]);
  });
});

describe("executeNode diagnostic: onApiWithheld fires only on a real withhold", () => {
  it("flag ON + untrusted + $api prop -> reports the no-op'd expression", async () => {
    const { api } = makeSpyApi();
    const seen: { nodeId: string; expressions: string[] }[] = [];
    const node = makeNode("u1", "spaces://My Space/#*main", {
      props: { value: "$api.probe.ping('on-untrusted')" },
    });
    await executeNode(node, freshStore(), {}, api, true, (info) => seen.push(info));
    expect(seen).toHaveLength(1);
    expect(seen[0].nodeId).toBe("u1");
    expect(seen[0].expressions).toContain("props.value");
  });

  it("flag ON + untrusted + $api STYLE -> reports styles.<key>", async () => {
    const { api } = makeSpyApi();
    const seen: { expressions: string[] }[] = [];
    const node = makeNode("u1", "spaces://My Space/#*main", {
      styles: { background: "$api.probe.ping('on-untrusted-style')" },
    });
    await executeNode(node, freshStore(), {}, api, true, (info) => seen.push(info));
    expect(seen).toHaveLength(1);
    expect(seen[0].expressions).toContain("styles.background");
  });

  it("flag ON + TRUSTED node -> no diagnostic (kept its $api)", async () => {
    const { api } = makeSpyApi();
    const seen: unknown[] = [];
    const node = makeNode("k1", undefined, {
      props: { value: "$api.probe.ping('on-trusted')" },
    }, true);
    await executeNode(node, freshStore(), {}, api, true, () => seen.push(1));
    expect(seen).toHaveLength(0);
  });

  it("flag OFF -> no diagnostic (legacy: everyone keeps $api)", async () => {
    const { api } = makeSpyApi();
    const seen: unknown[] = [];
    const node = makeNode("u1", "spaces://My Space/#*main", {
      props: { value: "$api.probe.ping('off')" },
    });
    await executeNode(node, freshStore(), {}, api, false, () => seen.push(1));
    expect(seen).toHaveLength(0);
  });

  it("flag ON + untrusted but NO $api usage -> no diagnostic (no false positive)", async () => {
    const { api } = makeSpyApi();
    const seen: unknown[] = [];
    const node = makeNode("u1", "spaces://My Space/#*main", {
      props: { value: "'plain text'" },
    });
    await executeNode(node, freshStore(), {}, api, true, () => seen.push(1));
    expect(seen).toHaveLength(0);
  });

  it("no onApiWithheld callback -> no throw (diagnostic is optional)", async () => {
    const { api } = makeSpyApi();
    const node = makeNode("u1", "spaces://My Space/#*main", {
      props: { value: "$api.probe.ping('x')" },
    });
    await expect(
      executeNode(node, freshStore(), {}, api, true)
    ).resolves.toBeDefined();
  });
});

// End-to-end bless: mirror FrameInstanceContext.runRoot exactly —
// clone the source executable, re-stamp provenance from source, then execute.
// Blessing = stamp the SOURCE tree in memory; the next run's clone inherits it.
describe("bless restores $api on the render-path clone (runRoot mirror)", () => {
  const runLikeRoot = async (
    source: FrameExecutable,
    api: API,
    onApiWithheld: (info: unknown) => void
  ) => {
    const clone = _.cloneDeep(source) as FrameExecutable;
    reStampProvenanceFromSource(clone, source); // what runRoot now does
    return executeNode(clone, freshStore(), {}, api, true, onApiWithheld as never);
  };

  it("pre-bless withholds $api; post-bless (source stamped) restores it", async () => {
    const { api, calls } = makeSpyApi();
    const source = makeNode("u1", "spaces://My Space/#*main", {
      props: { value: "$api.probe.ping('user-frame')" },
    });
    const seen: unknown[] = [];

    // Run 1: unblessed user frame -> withheld + diagnostic.
    const out1 = await runLikeRoot(source, api, (i) => seen.push(i));
    expect(calls).not.toContain("user-frame");
    expect(out1.state["u1"].props.value).toBeUndefined();
    expect(seen).toHaveLength(1);

    // BLESS: stamp the source tree in memory only (the user gesture).
    stampKitProvenanceTree(source);

    // Run 2: the clone re-inherits provenance from the blessed source -> $api restored.
    const out2 = await runLikeRoot(source, api, (i) => seen.push(i));
    expect(calls).toContain("user-frame");
    expect(out2.state["u1"].props.value).toBe("pong:user-frame");
    // no NEW diagnostic on the blessed run
    expect(seen).toHaveLength(1);
  });

  it("FORGED $kit ref stays withheld even through clone+re-stamp (ref is never trust)", async () => {
    const { api, calls } = makeSpyApi();
    // Stored content forging the kit prefix, but NEVER blessed / stamped.
    const forged = makeNode("spoof", `${FORGED_KIT_REF_PREFIX}#*listItem`, {
      props: { value: "$api.probe.ping('STORED-SPOOF')" },
    });
    const out = await runLikeRoot(forged, api, () => undefined);
    expect(calls).not.toContain("STORED-SPOOF");
    expect(out.state["spoof"].props.value).toBeUndefined();
  });
});

// bd Notidian-214 — the DIRECT kit render path (FrameRootContext renders
// superstate.kitFrames.get(ref) as the ROOT) skips ast.ts expandNode, so
// initializeKits is the only place that can stamp a built kit frame's OWN inline
// $api nodes. This pins that a kit executable stamped there keeps $api through the
// render-path clone+re-stamp — and does NOT trip the withhold diagnostic (the
// false-positive-per-row that the built-in cards/task/cover/... layouts hit).
describe("direct kit render path: a stamped kit executable keeps $api (Notidian-214)", () => {
  const runLikeRoot = async (
    source: FrameExecutable,
    api: API,
    onApiWithheld: (info: unknown) => void
  ) => {
    const clone = _.cloneDeep(source) as FrameExecutable;
    reStampProvenanceFromSource(clone, source);
    return executeNode(clone, freshStore(), {}, api, true, onApiWithheld as never);
  };

  it("kit listItem stamped in initializeKits keeps $api, no diagnostic", async () => {
    const { api, calls } = makeSpyApi();
    // A built kit listItem executable with an inline $api cover expression, as
    // shipped by src/schemas/kits/list.ts (cardsListItem imageNode value).
    const kitItem = makeNode("cardsCover", "spaces://$kit/#*cardsListItem", {
      props: { value: "$api.probe.ping('kit-cover')" },
      styles: { background: "$api.probe.ping('kit-color')" },
    });
    // initializeKits stamps the built kit executable tree (plugin provenance).
    stampKitProvenanceTree(kitItem);

    const seen: unknown[] = [];
    const out = await runLikeRoot(kitItem, api, () => seen.push(1));
    expect(calls).toContain("kit-cover");
    expect(out.state["cardsCover"].props.value).toBe("pong:kit-cover");
    expect(seen).toHaveLength(0); // no false-positive per-row diagnostic
  });

  it("WITHOUT the initializeKits stamp the same kit node false-positives + loses $api", async () => {
    const { api, calls } = makeSpyApi();
    // Same kit node, but NOT stamped (the pre-fix direct-kit-render behaviour).
    const unstamped = makeNode("cardsCover", "spaces://$kit/#*cardsListItem", {
      props: { value: "$api.probe.ping('kit-cover')" },
    });
    const seen: unknown[] = [];
    const out = await runLikeRoot(unstamped, api, () => seen.push(1));
    expect(calls).not.toContain("kit-cover"); // $api silently withheld
    expect(out.state["cardsCover"].props.value).toBeUndefined();
    expect(seen).toHaveLength(1); // the false-positive diagnostic this fix removes
  });
});

// bd Notidian-kcgt (milestone-gate must-fix on Notidian-214): the bless was
// MOUNT-scoped — the stamp lived only on the in-memory tree, and every view
// remount (click a note, click back) rebuilt a FRESH unstamped tree, so the
// "session" trust silently died and the module-level blessed bit mis-fired the
// "code changed" re-arm. This pins the full runner-level contract of the fix:
// runRoot now calls restampSessionBless(frameId, root) before executing, so a
// remounted tree whose code-bearing fields are byte-identical to the blessed
// code regains $api with NO withhold and NO re-toast — while an EDIT (different
// code) or a RELOAD (registry reset) still drops trust exactly as ADR 0022 2c
// promises. Nothing is persisted at any point.
describe("session bless survives a REMOUNT of identical code; edit/reload still drop it (Notidian-kcgt)", () => {
  const frameId = "spaces://My Space/#*main";

  beforeEach(() => resetFrameTrustSession());

  const runLikeRoot = async (
    source: FrameExecutable,
    api: API,
    onApiWithheld: (info: unknown) => void
  ) => {
    // what runRoot now does: re-extend a session bless to identical code FIRST,
    // then clone + re-stamp from source, then execute.
    restampSessionBless(frameId, source);
    const clone = _.cloneDeep(source) as FrameExecutable;
    reStampProvenanceFromSource(clone, source);
    return executeNode(clone, freshStore(), {}, api, true, onApiWithheld as never);
  };

  const buildFresh = (code: string) =>
    makeNode("u1", "spaces://My Space/#*main", { props: { value: code } });

  it("bless -> unmount -> REMOUNT (fresh tree, same code): $api works, no withhold, no re-toast", async () => {
    const { api, calls } = makeSpyApi();
    const CODE = "$api.probe.ping('user-frame')";

    // Mount 1: discover + notify + user blesses the named frame.
    const mount1 = buildFresh(CODE);
    const withholds1: unknown[] = [];
    await runLikeRoot(mount1, api, (i) => {
      registerFrameBless(
        frameId,
        `${frameId}::r0::m1`,
        () => stampKitProvenanceTree(mount1),
        fingerprintFrameTree(mount1)
      );
      withholds1.push(i);
    });
    expect(withholds1).toHaveLength(1);
    expect(shouldNotifyApiWithheld(frameId)).toBe(true); // the one notice
    expect(blessFrameById(frameId)).toBe(1);

    // Unmount (the row's callback is dropped; the bless bookkeeping survives).
    unregisterFrame(`${frameId}::r0::m1`);

    // Mount 2: a brand-new, unstamped tree built from the SAME stored code.
    const mount2 = buildFresh(CODE);
    const withholds2: unknown[] = [];
    const out = await runLikeRoot(mount2, api, (i) => withholds2.push(i));

    // Trust survived the remount: $api ran, nothing was withheld, and the
    // "code changed" heuristic did NOT mis-fire (bless intact, no re-offer).
    expect(calls).toContain("user-frame");
    expect(out.state["u1"].props.value).toBe("pong:user-frame");
    expect(withholds2).toHaveLength(0);
    expect(sessionBlessFingerprint(frameId)).toBeDefined();
    expect(pendingBlessFrameIds()).toEqual([]);
  });

  it("EDIT: a remounted tree with DIFFERENT code is withheld and the notice re-arms", async () => {
    const { api, calls } = makeSpyApi();

    // bless v1
    const v1 = buildFresh("$api.probe.ping('v1')");
    await runLikeRoot(v1, api, () => {
      registerFrameBless(
        frameId,
        `${frameId}::r0`,
        () => stampKitProvenanceTree(v1),
        fingerprintFrameTree(v1)
      );
    });
    shouldNotifyApiWithheld(frameId);
    blessFrameById(frameId);
    unregisterFrame(`${frameId}::r0`);

    // attacker/edit rewrites the frame; the rebuilt tree has different code
    const v2 = buildFresh("$api.probe.ping('REWRITTEN')");
    const withholds: unknown[] = [];
    const out = await runLikeRoot(v2, api, (i) => {
      registerFrameBless(
        frameId,
        `${frameId}::r0`,
        () => undefined,
        fingerprintFrameTree(v2)
      );
      withholds.push(i);
    });

    // the NEW code never ran with $api...
    expect(calls).not.toContain("REWRITTEN");
    expect(out.state["u1"].props.value).toBeUndefined();
    expect(withholds).toHaveLength(1);
    // ...and the user is re-warned + the frame is re-offered for an informed bless
    expect(shouldNotifyApiWithheld(frameId)).toBe(true);
    expect(pendingBlessFrameIds()).toEqual([frameId]);
  });

  it("RELOAD: after the registry resets, identical code is withheld again (re-bless required)", async () => {
    const { api, calls } = makeSpyApi();
    const CODE = "$api.probe.ping('after-reload')";
    const v1 = buildFresh(CODE);
    registerFrameBless(
      frameId,
      `${frameId}::r0`,
      () => stampKitProvenanceTree(v1),
      fingerprintFrameTree(v1)
    );
    blessFrameById(frameId);

    resetFrameTrustSession(); // the plugin reload (fresh module state)

    const remounted = buildFresh(CODE);
    const withholds: unknown[] = [];
    await runLikeRoot(remounted, api, (i) => withholds.push(i));
    expect(calls).not.toContain("after-reload");
    expect(withholds).toHaveLength(1); // trust must be re-granted by design
  });
});

// bd Notidian-sy30 (milestone-gate blocker on Notidian-kcgt): the session-bless
// fingerprint used to be render-topology-DEPENDENT. Both render paths converge on
// buildRoot -> linkProps (ast.ts), which folds each context-column field into the
// ROOT node's props ("") and types (col type); the editable space view injects
// [...tableData.cols, ...props.cols] while the read surface (buildRootFromMDBFrame
// / SpaceFragmentView note embed) injects frame.cols only. So the SAME stored
// frame identity (path, unified by Notidian-pg6g) materialized two ways produced
// two fingerprints — restampSessionBless refused the other topology and the
// withhold path then DELETED the bless and re-armed a FALSE "code changed" notice
// on the most common surface (space main frames, default-ON hardenFrameExecution).
// fingerprintFrameTree now canonicalizes those injected empty-valued ROOT bindings
// out, so a bless SURVIVES the editable<->read switch both directions, while a real
// stored-code edit, an impostor at another path, and a reload still drop it.
describe("session bless survives an editable<->read topology switch (Notidian-sy30)", () => {
  const frameId = "spaces://My Space/#*main";
  const STORED = "$api.probe.ping('user-frame')";

  beforeEach(() => resetFrameTrustSession());

  // Materialize a root the way a render path holds it AFTER linkProps: the stored,
  // code-bearing root prop `hero`, plus `cols` context columns injected as
  // empty-valued, typed root props/types (exactly what differs by topology). The
  // child subtree is byte-identical across paths (linkProps never mutates it).
  const materialize = (
    cols: Array<[string, string]>,
    code = STORED
  ): FrameTreeNode => {
    const props: Record<string, string> = { hero: code };
    const types: Record<string, string> = {};
    for (const [name, type] of cols) {
      props[name] = "";
      types[name] = type;
    }
    const node: FrameNode = {
      id: "main",
      schemaId: "s1",
      name: "main",
      type: "group",
      rank: 0,
      props,
      styles: {},
      actions: {},
      types,
    };
    const child: FrameTreeNode = {
      id: "c1",
      node: {
        id: "c1",
        schemaId: "s1",
        name: "c1",
        type: "text",
        rank: 0,
        props: { value: "'card'" },
        styles: {},
        actions: {},
        types: {},
      },
      isRef: false,
      children: [],
      editorProps: { editMode: 0 },
      parent: null,
    };
    return {
      id: "main",
      node,
      isRef: false,
      children: [child],
      editorProps: { editMode: 0 },
      parent: null,
    };
  };

  // the editable space view injects the full context table (many cols); the read
  // surface injects frame.cols only — the SAME stored `hero` code either way.
  const EDITABLE_COLS: Array<[string, string]> = [
    ["Status", "text"],
    ["Priority", "number"],
    ["Tags", "tags"],
  ];
  const READ_COLS: Array<[string, string]> = [["Status", "text"]];

  const blessTopology = (tree: FrameTreeNode) => {
    registerFrameBless(
      frameId,
      `${frameId}::r0`,
      () => stampKitProvenanceTree(tree),
      fingerprintFrameTree(tree)
    );
    expect(blessFrameById(frameId)).toBe(1);
    expect(hasKitProvenance(tree.node)).toBe(true);
  };

  it("bless on the EDITABLE topology -> the READ rebuild is restamped (bless survives)", () => {
    blessTopology(materialize(EDITABLE_COLS));
    const readRebuild = materialize(READ_COLS); // same stored code, read topology
    expect(hasKitProvenance(readRebuild.node)).toBe(false);
    expect(restampSessionBless(frameId, readRebuild)).toBe(true);
    expect(hasKitProvenance(readRebuild.node)).toBe(true);
  });

  it("bless on the READ topology -> the EDITABLE rebuild is restamped (both directions)", () => {
    blessTopology(materialize(READ_COLS));
    const editableRebuild = materialize(EDITABLE_COLS);
    expect(restampSessionBless(frameId, editableRebuild)).toBe(true);
    expect(hasKitProvenance(editableRebuild.node)).toBe(true);
  });

  it("a real stored-code EDIT still drops the bless across the switch + re-arms honestly", () => {
    blessTopology(materialize(EDITABLE_COLS));
    // same identity, read topology, but the code-bearing root prop was rewritten
    const editedRead = materialize(READ_COLS, "$api.probe.ping('REWRITTEN')");
    expect(restampSessionBless(frameId, editedRead)).toBe(false);
    expect(hasKitProvenance(editedRead.node)).toBe(false);
    // the withhold path then re-arms the notice + re-offers the frame for a fresh,
    // informed bless (honest "code changed").
    expect(shouldNotifyApiWithheld(frameId)).toBe(true);
    expect(sessionBlessFingerprint(frameId)).toBeUndefined();
    // trust dropped -> the frame is OFFER-able again for a fresh, informed bless
    expect(pendingBlessFrameIds()).toEqual([frameId]);
  });

  it("an identical-code impostor at ANOTHER path is still refused (identity keyed on path, pg6g)", () => {
    blessTopology(materialize(EDITABLE_COLS));
    const impostor = materialize(READ_COLS); // byte-identical stored code, other path
    expect(restampSessionBless("spaces://Attacker/#*main", impostor)).toBe(false);
    expect(hasKitProvenance(impostor.node)).toBe(false);
  });

  it("after a RELOAD (registry reset) the topology-switched rebuild is refused too", () => {
    blessTopology(materialize(EDITABLE_COLS));
    resetFrameTrustSession(); // the plugin reload (fresh module state)
    const readRebuild = materialize(READ_COLS);
    expect(restampSessionBless(frameId, readRebuild)).toBe(false);
    expect(hasKitProvenance(readRebuild.node)).toBe(false);
  });
});
