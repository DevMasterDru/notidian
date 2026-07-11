// bd Notidian-gz66 — defense-in-depth: a frame prop/style/action key literally
// named __proto__ / constructor / prototype must never enter a materialized frame
// node, and therefore can never reach buildExecutable or the runner's
// codeBlockStore[key]?.call(environment) sink (which executes compiled frame code
// with $api — full vault write authority — in scope).
//
// The key is BORN at the load boundary: frameToNode parses the persisted props/
// styles/actions/interactions/contexts columns with safelyParseJSON = JSON.parse,
// and JSON.parse revives "__proto__" as a REAL OWN enumerable data key (an object
// literal would route it through the prototype setter and leave no own key). The
// fix scrubs those keys in frameToNode. This file proves, end to end:
//   1. frameToNode drops the keys from every parsed frame map (no pollution);
//   2. the RAW (unscrubbed) parse WOULD fire $api.deleteVault through the runner —
//      a true witness that the vector is live, so the fix test is not vacuous;
//   3. the SAME stored payload routed through frameToNode never fires it, while the
//      benign sibling prop still evaluates.
//
// This is offline-verifiable (no flag): the assertion below IS the verification
// that the sink is closed. It does NOT touch frameTrustSession.ts and preserves
// ADR-0022 (trust stays in-memory/non-persisted; impostor-identical-code refused).
import { API } from "makemd-core";
import { FrameExecutable, FrameTreeNode } from "shared/types/frameExec";
import { FrameNode, MFrame } from "shared/types/mframe";
import { buildExecutable } from "./executable";
import { frameToNode } from "./nodes";
import { executeNode, ResultStore } from "./runner";

const DANGEROUS = ["__proto__", "constructor", "prototype"] as const;

const makeSpyApi = () => {
  const calls: string[] = [];
  const api = {
    probe: {
      ping: (tag: string) => {
        calls.push(`ping:${tag}`);
        return `pong:${tag}`;
      },
    },
    // the authority sink the exploit targets.
    deleteVault: (tag: string) => {
      calls.push(`deleteVault:${tag}`);
      return `deleted:${tag}`;
    },
  } as unknown as API;
  return { api, calls };
};

const freshStore = (): ResultStore => ({
  state: {},
  newState: {},
  slides: {},
  prevState: {},
});

// A stored frame row whose props JSON carries a benign prop plus three code-bearing
// prototype keys. Built as a raw JSON STRING because only JSON.parse revives an OWN
// __proto__ data key — an object literal would route __proto__ through the setter.
const EVIL_PROPS_JSON =
  '{"value":"$api.probe.ping(\'benign\')",' +
  '"__proto__":"$api.deleteVault(\'OWNED\')",' +
  '"constructor":"$api.deleteVault(\'CTOR\')",' +
  '"prototype":"$api.deleteVault(\'PROTO\')"}';

const baseFrame = (): MFrame => ({
  id: "evil-node",
  schemaId: "s1",
  name: "evil",
  type: "text",
  parentId: "p1",
  rank: "0",
  ref: "spaces://My Space/#*main",
  contexts: "{}",
  styles: "{}",
  actions: "{}",
  props: EVIL_PROPS_JSON,
  interactions: "{}",
});

const treeFromNode = (node: FrameNode): FrameTreeNode =>
  ({
    id: node.id,
    node,
    isRef: false,
    children: [],
    editorProps: { editMode: 0 },
    parent: null,
  } as FrameTreeNode);

// flag OFF = legacy render path: $api is present for every node (the residual
// exposure the bead names — with the boundary ON but untrusted, $api is withheld,
// but the prototype key still RUNS as code, which is the fragile invariant this
// hardening removes). If the runner ever .call()s a prototype key's compiled fn,
// $api.deleteVault fires.
const runProps = (node: FrameNode, api: API) => {
  const exec: FrameExecutable = buildExecutable(treeFromNode(node));
  return executeNode(exec, freshStore(), {}, api, false);
};

describe("frameToNode strips prototype keys from every parsed frame map (Notidian-gz66)", () => {
  it("drops __proto__/constructor/prototype from node.props, keeps the benign prop", () => {
    const node = frameToNode(baseFrame());
    for (const k of DANGEROUS) {
      expect(Object.prototype.hasOwnProperty.call(node.props, k)).toBe(false);
    }
    expect(node.props!.value).toBe("$api.probe.ping('benign')");
    // no pollution: props is an ordinary object with an untouched prototype.
    expect(Object.getPrototypeOf(node.props)).toBe(Object.prototype);
  });

  it.each(["styles", "actions", "interactions", "contexts"] as const)(
    "drops the keys from node.%s too",
    (field) => {
      const dangerousMap =
        '{"safe":"1","__proto__":"x","constructor":"y","prototype":"z"}';
      const node = frameToNode({ ...baseFrame(), [field]: dangerousMap });
      const map = node[field] as Record<string, unknown>;
      for (const k of DANGEROUS) {
        expect(Object.prototype.hasOwnProperty.call(map, k)).toBe(false);
      }
      expect(map.safe).toBe("1");
      expect(Object.getPrototypeOf(map)).toBe(Object.prototype);
    }
  );

  it("preserves the corrupt-JSON silent-undefined contract (scrub of undefined)", () => {
    const node = frameToNode({ ...baseFrame(), props: "{bad json" });
    expect(node.props).toBeUndefined();
  });
});

describe("end-to-end: the prototype-key exploit fires raw, but never through frameToNode (Notidian-gz66)", () => {
  it("WITNESS: raw JSON.parse'd props (own __proto__/constructor/prototype) DO fire $api.deleteVault", async () => {
    const { api, calls } = makeSpyApi();
    // Bypass frameToNode: feed the parsed map straight into buildExecutable, as the
    // pre-fix load path did. This proves the vector is LIVE (the fix test below is
    // therefore not a vacuous pass), and stays green after the fix because the fix
    // lives at the load boundary (frameToNode), not in buildExecutable/the runner.
    const rawProps = JSON.parse(EVIL_PROPS_JSON);
    expect(Object.prototype.hasOwnProperty.call(rawProps, "__proto__")).toBe(true);
    const node = {
      id: "evil-node",
      schemaId: "s1",
      name: "evil",
      type: "text",
      rank: 0,
      props: rawProps,
      styles: {},
      actions: {},
    } as FrameNode;

    await runProps(node, api);

    expect(calls).toContain("deleteVault:OWNED"); // __proto__ -> exec prototype -> getter -> .call()
    expect(calls).toContain("deleteVault:CTOR"); // constructor -> own shadowing key -> .call()
    expect(calls).toContain("deleteVault:PROTO"); // prototype -> own key -> .call()
  });

  it("FIX: the SAME stored payload routed through frameToNode never fires deleteVault (benign prop still runs)", async () => {
    const { api, calls } = makeSpyApi();
    const node = frameToNode(baseFrame()); // scrubbed at the load boundary

    await runProps(node, api);

    // the authority sink was never reached...
    expect(calls.some((c) => c.startsWith("deleteVault:"))).toBe(false);
    // ...while the legitimate sibling prop still evaluated normally.
    expect(calls).toContain("ping:benign");
  });

  it("FIX: a __proto__ prop in STYLES is likewise inert through frameToNode", async () => {
    const { api, calls } = makeSpyApi();
    const frame: MFrame = {
      ...baseFrame(),
      props: "{}",
      styles:
        '{"color":"$api.probe.ping(\'style\')","__proto__":"$api.deleteVault(\'STYLE\')"}',
    };
    const node = frameToNode(frame);
    await runProps(node, api);
    expect(calls.some((c) => c.startsWith("deleteVault:"))).toBe(false);
    expect(calls).toContain("ping:style");
  });
});
