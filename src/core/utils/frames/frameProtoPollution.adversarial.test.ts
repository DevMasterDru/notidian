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
import { ownStringNodeType } from "./nodeTypeLookup";
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

// bd Notidian-jkxj — belt #3 (harden-the-consumer), BEYOND gz66's load-boundary
// scrub. generateCodeForProp (executable.ts) computes
//   const isObject = type?.startsWith('object') && objectIsConst(...)
// where type = treeNode.node.types?.[k], k being a props key. node.types is the
// DERIVED type map (nodeToTypes), NOT JSON-parsed, so gz66's frameToNode scrub
// never touches it. If a dunder/inherited props key k ('__proto__'/'constructor')
// ever reaches buildExecutable and node.types lacks an OWN entry for k, the bracket
// lookup returns Object.prototype ('__proto__' getter) or the Object constructor
// (inherited) — a truthy NON-STRING — and `.startsWith` throws TypeError. That line
// is OUTSIDE generateCodeForProp's new Function try/catch, so the TypeError escapes
// buildExecutable and crashes the ALWAYS-ON frame render (DoS). The fix is a typeof
// guard at the consumer so a non-string type can never coerce into .startsWith.
// This is defense-in-depth of gz66's defense-in-depth; it must NOT weaken the scrub.
describe("buildExecutable tolerates dunder/inherited prop keys in the type lookup (Notidian-jkxj)", () => {
  it.each(["__proto__", "constructor"] as const)(
    "does not throw when props key %s hits a non-own (non-string) node.types slot",
    (dunder) => {
      // Only JSON.parse revives an OWN '__proto__' data key (an object literal routes
      // it through the setter and leaves no own key); 'constructor' shadows the
      // inherited one via a JSON own key too. Both are enumerated by
      // applyFunctionToObject's for-in (own + hasOwnProperty-guarded) and feed k.
      const props = JSON.parse(`{"value":"1","${dunder}":"[1,2,3]"}`);
      expect(Object.prototype.hasOwnProperty.call(props, dunder)).toBe(true);
      // node.types is a plain, non-null object LACKING an OWN entry for the dunder
      // key, so types[dunder] resolves through the prototype: Object.prototype for
      // '__proto__', the Object constructor for 'constructor' — the exact non-string
      // that pre-fix reached .startsWith and threw.
      const node = {
        id: "n",
        schemaId: "s1",
        name: "n",
        type: "text",
        rank: 0,
        props,
        styles: {},
        actions: {},
        types: { value: "object-multi" },
      } as unknown as FrameNode;

      expect(() => buildExecutable(treeFromNode(node))).not.toThrow();
    }
  );

  it("still classifies a REAL 'object'/'object-multi' string type as const (unchanged)", () => {
    // A legitimate string type must behave exactly as before the guard: an
    // object-multi const literal compiles without being wrapped as a statement.
    const node = {
      id: "n",
      schemaId: "s1",
      name: "n",
      type: "text",
      rank: 0,
      props: { list: "[1,2,3]" },
      styles: {},
      actions: {},
      types: { list: "object-multi" },
    } as unknown as FrameNode;

    const exec = buildExecutable(treeFromNode(node));
    // the compiled prop returns the parsed literal — proof the string type path is intact.
    expect(exec.execProps.list.call({})).toEqual([1, 2, 3]);
  });
});

// bd Notidian-cd87 — belt #3 SIBLING to Notidian-jkxj (commit 65208c8d), same
// cross-object inherited-key-coercion family, different consumer.
// FrameSlidesEditor.tsx computes
//   const f = removeQuotes(selectedSlideParent.props?.value);
//   ... type: selectedNode.types[f] ...
// where `f` is derived from a PROPS VALUE, NOT from Object.keys(node.types).
// The three sibling lookups (ast.ts propertiesForNode, FilterBar,
// FrameNodeEditor) all iterate Object.keys(node.types), so their key is
// always own — provably safe, untouched by this bead. FrameSlidesEditor's `f`
// has no such guarantee: if it is literally '__proto__'/'constructor' and
// selectedNode.types lacks an OWN entry, a bare bracket read resolves through
// the prototype chain (Object.prototype / the Object constructor) instead of
// the expected string-or-undefined, and that non-string value would flow
// straight into selectedProperty.type. The fix — ownStringNodeType in
// ./nodeTypeLookup — requires an own key AND a string value.
describe("ownStringNodeType guards FrameSlidesEditor's props-value-derived type lookup (Notidian-cd87)", () => {
  const DUNDER_KEYS = ["__proto__", "constructor"] as const;

  it.each(DUNDER_KEYS)(
    "WITNESS: a bare types[%s] bracket read (the pre-fix behavior) resolves to a non-own, non-string value",
    (dunder) => {
      // A plain object literal with no own entry for the dunder key — exactly
      // the shape selectedNode.types has when the slide's selected property
      // name never matched an actual type key.
      const types: Record<string, unknown> = { value: "text" };
      expect(Object.prototype.hasOwnProperty.call(types, dunder)).toBe(false);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const raw = (types as any)[dunder];
      expect(typeof raw).not.toBe("string");
    }
  );

  it.each(DUNDER_KEYS)(
    "FIX: ownStringNodeType(types, %s) is undefined when types lacks an own entry",
    (dunder) => {
      const types: Record<string, unknown> = { value: "text" };
      expect(ownStringNodeType(types, dunder)).toBeUndefined();
    }
  );

  it("FIX: an own key whose value is a dunder-shadowed non-string is also rejected", () => {
    // Defense-in-depth: even if 'constructor' were ever an OWN key (e.g. via
    // JSON.parse reviving it) but held a non-string value, the guard must
    // still refuse it rather than assign a non-string into selectedProperty.type.
    const types: Record<string, unknown> = JSON.parse(
      '{"value":"text","constructor":123}'
    );
    expect(Object.prototype.hasOwnProperty.call(types, "constructor")).toBe(
      true
    );
    expect(ownStringNodeType(types, "constructor")).toBeUndefined();
  });

  it("UNCHANGED: a real own string type flows through exactly as the bare bracket read did", () => {
    const types: Record<string, unknown> = { value: "text", count: "number" };
    expect(ownStringNodeType(types, "count")).toBe("number");
    expect(ownStringNodeType(types, "count")).toBe(types.count);
  });
});
