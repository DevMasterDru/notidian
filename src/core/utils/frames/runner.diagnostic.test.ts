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
  reStampProvenanceFromSource,
  stampKitProvenance,
  stampKitProvenanceTree,
} from "./trust";

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
