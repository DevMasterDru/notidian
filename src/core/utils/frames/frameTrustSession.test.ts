// bd Notidian-214 / ADR 0022 Decision 2c — session-scoped frame-trust registry.
//
// Pins the NON-PERSISTED discovery + bless bookkeeping the read-only diagnostic
// and the "Trust dynamic frame code for this session" command depend on. Hard
// invariants under test:
//   - notice de-dup is keyed on FRAME IDENTITY (path), NOT per row instance, so a
//     multi-row list notifies ONCE, not once per visible row (finding 2);
//   - unmount does NOT re-arm the notice (else remount/pagination re-spams);
//   - blessing is PER FRAME (blessFrameById) — there is deliberately no "bless
//     everything", so one command gesture can never trust a frame the user did not
//     choose (finding 3, confused deputy);
//   - a blessed frame whose code changes (withholds $api again) re-arms its notice;
//   - reset (what a plugin RELOAD does for free) drops every trust bit;
//   - bd Notidian-kcgt: a bless is SESSION-scoped, not MOUNT-scoped — the bless
//     records an in-memory code fingerprint, and a freshly rebuilt tree regains
//     the stamp iff its code-bearing fields are byte-identical
//     (restampSessionBless). An EDIT changes the fingerprint and a RELOAD clears
//     the registry, so both still drop trust by design;
//   - bd Notidian-kcgt: the trust command NEVER auto-blesses, even with exactly
//     one pending frame — the pending set is time-varying (instances unregister
//     on unmount), so "one pending" does not imply "the frame whose notice the
//     user saw". dispatchFrameTrust always routes to a NAMED picker.
import { FrameTreeNode } from "shared/types/frameExec";
import { FrameNode } from "shared/types/mframe";
import {
  blessFrameById,
  dispatchFrameTrust,
  fingerprintFrameTree,
  isSoundFrameId,
  pendingBlessCount,
  pendingBlessFrameIds,
  registerFrameBless,
  resetFrameTrustSession,
  restampSessionBless,
  sessionBlessFingerprint,
  shouldNotifyApiWithheld,
  unregisterFrame,
} from "./frameTrustSession";
import { hasKitProvenance, stampKitProvenanceTree } from "./trust";

// A minimal materialized tree with code-bearing fields, as the render path holds
// it (FrameTreeNode). Rebuilding with the same parts models a REMOUNT (fresh
// objects, identical code); changing any code-bearing part models an EDIT.
const makeTree = (
  id: string,
  parts: {
    props?: Record<string, string>;
    styles?: Record<string, string>;
    actions?: Record<string, string>;
    types?: Record<string, string>;
    type?: string;
  } = {},
  children: FrameTreeNode[] = []
): FrameTreeNode => {
  const node: FrameNode = {
    id,
    schemaId: "s1",
    name: id,
    type: parts.type ?? "text",
    rank: 0,
    props: parts.props ?? {},
    styles: parts.styles ?? {},
    actions: parts.actions ?? {},
    types: parts.types ?? {},
  } as FrameNode;
  return {
    id,
    node,
    isRef: false,
    children,
    editorProps: { editMode: 0 },
    parent: null,
  } as FrameTreeNode;
};

beforeEach(() => resetFrameTrustSession());

describe("shouldNotifyApiWithheld: once per FRAME IDENTITY per session", () => {
  it("returns true the FIRST time a frame identity withholds, false thereafter", () => {
    expect(shouldNotifyApiWithheld("spaces://A")).toBe(true);
    expect(shouldNotifyApiWithheld("spaces://A")).toBe(false);
    expect(shouldNotifyApiWithheld("spaces://A")).toBe(false);
  });

  it("de-dupes per identity: distinct frames each notify once", () => {
    expect(shouldNotifyApiWithheld("spaces://A")).toBe(true);
    expect(shouldNotifyApiWithheld("spaces://B")).toBe(true);
    expect(shouldNotifyApiWithheld("spaces://A")).toBe(false);
    expect(shouldNotifyApiWithheld("spaces://B")).toBe(false);
  });

  it("a 50-row list (same frame identity) notifies ONCE, not once per row (finding 2)", () => {
    const frameId = "spaces://$kit/#*userItem";
    let notices = 0;
    for (let row = 0; row < 50; row++) {
      registerFrameBless(frameId, `${frameId}::row${row}`, () => undefined);
      if (shouldNotifyApiWithheld(frameId)) notices++;
    }
    expect(notices).toBe(1);
    expect(pendingBlessCount()).toBe(50); // one bless callback per row instance
    expect(pendingBlessFrameIds()).toEqual([frameId]); // ONE logical frame
  });

  it("RELOAD/reset re-arms the notice (models a fresh plugin load)", () => {
    expect(shouldNotifyApiWithheld("spaces://A")).toBe(true);
    expect(shouldNotifyApiWithheld("spaces://A")).toBe(false);
    resetFrameTrustSession();
    expect(shouldNotifyApiWithheld("spaces://A")).toBe(true);
  });
});

describe("unmount does NOT re-arm the frame-identity notice (finding 2)", () => {
  it("unregistering one instance leaves the shared notice de-duped", () => {
    const frameId = "spaces://A";
    registerFrameBless(frameId, `${frameId}::r0`, () => undefined);
    registerFrameBless(frameId, `${frameId}::r1`, () => undefined);
    expect(shouldNotifyApiWithheld(frameId)).toBe(true);
    unregisterFrame(`${frameId}::r0`);
    // remount of that row must NOT re-notify
    expect(shouldNotifyApiWithheld(frameId)).toBe(false);
  });

  it("unregistering ALL instances still does not re-arm (only reload does)", () => {
    const frameId = "spaces://A";
    registerFrameBless(frameId, `${frameId}::r0`, () => undefined);
    expect(shouldNotifyApiWithheld(frameId)).toBe(true);
    unregisterFrame(`${frameId}::r0`);
    expect(pendingBlessCount()).toBe(0);
    // finding 2: pagination re-opening the space must not re-arm the toast
    expect(shouldNotifyApiWithheld(frameId)).toBe(false);
    resetFrameTrustSession();
    expect(shouldNotifyApiWithheld(frameId)).toBe(true);
  });
});

describe("bless registry: per-frame bless, never blanket (finding 3)", () => {
  it("blessFrameById runs EVERY instance of that frame and returns the count", () => {
    const calls: string[] = [];
    const frameId = "spaces://A";
    registerFrameBless(frameId, `${frameId}::r0`, () => calls.push("A0"));
    registerFrameBless(frameId, `${frameId}::r1`, () => calls.push("A1"));
    expect(blessFrameById(frameId)).toBe(2);
    expect(calls.sort()).toEqual(["A0", "A1"]);
  });

  it("blessing frame A NEVER touches frame B (confused-deputy closed)", () => {
    const calls: string[] = [];
    registerFrameBless("spaces://A", "spaces://A::r0", () => calls.push("A"));
    registerFrameBless("spaces://B", "spaces://B::r0", () => calls.push("B"));
    const n = blessFrameById("spaces://A");
    expect(n).toBe(1);
    expect(calls).toEqual(["A"]); // B (a possibly-attacker frame) is untouched
  });

  it("blessFrameById on an unknown frame blesses nothing", () => {
    const calls: string[] = [];
    registerFrameBless("spaces://A", "spaces://A::r0", () => calls.push("A"));
    expect(blessFrameById("spaces://ghost")).toBe(0);
    expect(calls).toEqual([]);
  });

  it("re-registering the same instance REPLACES the callback (latest tree wins)", () => {
    const calls: string[] = [];
    const frameId = "spaces://A";
    registerFrameBless(frameId, `${frameId}::r0`, () => calls.push("stale"));
    registerFrameBless(frameId, `${frameId}::r0`, () => calls.push("fresh"));
    expect(pendingBlessCount()).toBe(1);
    blessFrameById(frameId);
    expect(calls).toEqual(["fresh"]);
  });

  it("a throwing bless callback does not abort the others (best-effort)", () => {
    const calls: string[] = [];
    const frameId = "spaces://A";
    registerFrameBless(frameId, `${frameId}::r0`, () => {
      throw new Error("dead frame instance");
    });
    registerFrameBless(frameId, `${frameId}::r1`, () => calls.push("r1"));
    expect(() => blessFrameById(frameId)).not.toThrow();
    expect(calls).toEqual(["r1"]);
  });

  it("a blessed frame is no longer offered by pendingBlessFrameIds", () => {
    registerFrameBless("spaces://A", "spaces://A::r0", () => undefined);
    registerFrameBless("spaces://B", "spaces://B::r0", () => undefined);
    expect(pendingBlessFrameIds().sort()).toEqual(["spaces://A", "spaces://B"]);
    blessFrameById("spaces://A");
    expect(pendingBlessFrameIds()).toEqual(["spaces://B"]);
  });
});

describe("re-arm after a blessed frame's code changes (finding 3, part 3)", () => {
  it("a blessed frame withholding $api again re-arms its notice + re-offers it", () => {
    const frameId = "spaces://A";
    // discover + notify
    registerFrameBless(frameId, `${frameId}::r0`, () => undefined);
    expect(shouldNotifyApiWithheld(frameId)).toBe(true);
    // user blesses it
    expect(blessFrameById(frameId)).toBe(1);
    expect(pendingBlessFrameIds()).toEqual([]); // trusted, not offered

    // attacker/edit rewrites the frame: it withholds $api AGAIN (a stamped tree
    // would keep $api, so this can only mean the code changed) -> re-registers and
    // MUST re-notify + become offer-able again for a fresh, informed bless.
    registerFrameBless(frameId, `${frameId}::r0`, () => undefined);
    expect(shouldNotifyApiWithheld(frameId)).toBe(true); // re-armed
    expect(pendingBlessFrameIds()).toEqual([frameId]); // offer-able again
  });

  it("a blessed frame re-rendering with the SAME (trusted) code never re-fires", () => {
    const frameId = "spaces://A";
    registerFrameBless(frameId, `${frameId}::r0`, () => undefined);
    shouldNotifyApiWithheld(frameId);
    blessFrameById(frameId);
    // A trusted frame does not call the diagnostic at all; but even if queried,
    // it must stay de-duped until a real code change re-registers a withhold.
    expect(pendingBlessFrameIds()).toEqual([]);
  });
});

// bd Notidian-kcgt (milestone-gate must-fix): the former "exactly 1 pending ->
// bless it directly" route was UNSOUND because the pending set is time-varying:
// instances unregister on unmount, so between the notice the user saw (frame X)
// and the command gesture, X may have unmounted and a DIFFERENT frame Y (possibly
// AI/attacker-authored, ADR 0018) may have flagged itself — pendingBlessFrameIds()
// == [Y] would then auto-bless Y and re-run its $api code on a gesture the user
// meant for X. The invariant ("one gesture must never trust a frame the user did
// not choose") therefore requires a NAMED pick for ANY pending count >= 1.
describe("dispatchFrameTrust: ALWAYS a named pick, never an auto-bless (Notidian-kcgt)", () => {
  it("0 pending -> onEmpty only", () => {
    const seen: string[] = [];
    dispatchFrameTrust([], {
      onEmpty: () => seen.push("empty"),
      onPick: () => seen.push("pick"),
    });
    expect(seen).toEqual(["empty"]);
  });

  it("INVARIANT: exactly 1 pending STILL routes to the named picker (time-shifted pending set)", () => {
    const seen: string[] = [];
    // The user saw frame X's notice; X unmounted; attacker frame Y flagged itself.
    // The one-pending gesture must present Y BY NAME, never bless it unconfirmed.
    dispatchFrameTrust(["spaces://Y-attacker"], {
      onEmpty: () => seen.push("empty"),
      onPick: (fs) => seen.push(`pick:${fs.join(",")}`),
    });
    expect(seen).toEqual(["pick:spaces://Y-attacker"]);
  });

  it("INVARIANT: >1 pending -> onPick (a picker), NEVER an auto-bless", () => {
    const seen: string[] = [];
    dispatchFrameTrust(["spaces://A", "spaces://B"], {
      onEmpty: () => seen.push("empty"),
      onPick: (fs) => seen.push(`pick:${fs.join(",")}`),
    });
    expect(seen).toEqual(["pick:spaces://A,spaces://B"]);
  });
});

// bd Notidian-pg6g (milestone-gate regression on Notidian-214): the render path
// used to fall back to the SHARED identity "?" whenever no FrameRootContext was
// mounted — which was EVERY editable space main frame. Two different spaces'
// frames (the user's own and an AI/attacker-planted one) then aliased to ONE
// identity, so pendingBlessFrameIds() returned exactly one id, the command
// auto-blessed it WITHOUT a picker, and blessFrameById("?") stamped whichever
// frame registered LAST — full session $api for a frame the user never reviewed.
// The registry must therefore REFUSE unsound identities at every entry point:
// they can be neither registered, offered, picked, nor blessed.
describe("unsound frame identities ('?' / empty / null) are never trustable (Notidian-pg6g)", () => {
  it("isSoundFrameId: null / undefined / '' / '?' are unsound; real paths are sound", () => {
    expect(isSoundFrameId(null)).toBe(false);
    expect(isSoundFrameId(undefined)).toBe(false);
    expect(isSoundFrameId("")).toBe(false);
    expect(isSoundFrameId("?")).toBe(false);
    expect(isSoundFrameId("spaces://A")).toBe(true);
    expect(isSoundFrameId("Projects/Notes#*main")).toBe(true);
  });

  it("registerFrameBless REFUSES the '?' fallback identity — nothing becomes pending", () => {
    registerFrameBless("?", "?::", () => undefined);
    expect(pendingBlessCount()).toBe(0);
    expect(pendingBlessFrameIds()).toEqual([]);
  });

  it("registerFrameBless refuses empty/null identities too", () => {
    registerFrameBless("", "::r0", () => undefined);
    registerFrameBless(null as unknown as string, "null::r0", () => undefined);
    expect(pendingBlessCount()).toBe(0);
    expect(pendingBlessFrameIds()).toEqual([]);
  });

  it("REGRESSION: two DIFFERENT frames aliased to '?' can never ride one bless gesture", () => {
    const calls: string[] = [];
    // space X's frame (the one the user saw the notice for)...
    registerFrameBless("?", "?::", () => calls.push("user-frame"));
    // ...then space Y's frame (attacker-planted) registers under the SAME
    // aliased key, replacing X's callback in the old code.
    registerFrameBless("?", "?::", () => calls.push("attacker-frame"));
    // The single-pending auto-bless route must see NOTHING pending...
    expect(pendingBlessFrameIds()).toEqual([]);
    // ...and a direct bless of the aliased identity must stamp NOTHING.
    expect(blessFrameById("?")).toBe(0);
    expect(calls).toEqual([]);
  });

  it("blessFrameById refuses unsound identities outright", () => {
    expect(blessFrameById("?")).toBe(0);
    expect(blessFrameById("")).toBe(0);
    expect(blessFrameById(null as unknown as string)).toBe(0);
  });

  it("dispatchFrameTrust NEVER offers an unidentified frame: ['?'] -> onEmpty", () => {
    const seen: string[] = [];
    dispatchFrameTrust(["?"], {
      onEmpty: () => seen.push("empty"),
      onPick: (fs) => seen.push(`pick:${fs.join(",")}`),
    });
    expect(seen).toEqual(["empty"]);
  });

  it("dispatchFrameTrust filters unsound ids before routing to the picker", () => {
    const seen: string[] = [];
    dispatchFrameTrust(["?", "spaces://A"], {
      onEmpty: () => seen.push("empty"),
      onPick: (fs) => seen.push(`pick:${fs.join(",")}`),
    });
    // "?" is never pickable: only the sound, named frame is offered.
    expect(seen).toEqual(["pick:spaces://A"]);
  });

  it("dispatchFrameTrust with several sound ids + an unsound one pickers ONLY the sound ones", () => {
    const seen: string[] = [];
    dispatchFrameTrust(["spaces://A", "?", "spaces://B"], {
      onEmpty: () => seen.push("empty"),
      onPick: (fs) => seen.push(`pick:${fs.join(",")}`),
    });
    expect(seen).toEqual(["pick:spaces://A,spaces://B"]);
  });

  it("sound frames registered ALONGSIDE an unsound one stay independently blessable", () => {
    const calls: string[] = [];
    registerFrameBless("?", "?::", () => calls.push("aliased"));
    registerFrameBless("spaces://A", "spaces://A::r0", () => calls.push("A"));
    expect(pendingBlessFrameIds()).toEqual(["spaces://A"]);
    expect(blessFrameById("spaces://A")).toBe(1);
    expect(calls).toEqual(["A"]);
  });
});

describe("RELOAD/reset drops ALL session state (trust must be re-granted)", () => {
  it("clears pending, offers, notices, blessed set, and fingerprints", () => {
    registerFrameBless("spaces://A", "spaces://A::r0", () => undefined);
    registerFrameBless("spaces://B", "spaces://B::r0", () => undefined, "fp-B");
    shouldNotifyApiWithheld("spaces://A");
    blessFrameById("spaces://B");
    expect(pendingBlessCount()).toBe(2);
    expect(sessionBlessFingerprint("spaces://B")).toBe("fp-B");
    resetFrameTrustSession();
    expect(pendingBlessCount()).toBe(0);
    expect(pendingBlessFrameIds()).toEqual([]);
    expect(blessFrameById("spaces://A")).toBe(0);
    expect(sessionBlessFingerprint("spaces://B")).toBeUndefined();
    expect(shouldNotifyApiWithheld("spaces://A")).toBe(true);
  });
});

// bd Notidian-kcgt — the code fingerprint that makes the bless SESSION-scoped.
// It must be a pure function of the tree's CODE-BEARING fields (id, type, props,
// types, styles, actions, child order), independent of object identity and key
// insertion order — a remount rebuilds fresh objects from the same stored code
// and must fingerprint identically, while ANY code edit must change it.
describe("fingerprintFrameTree: deterministic over code, blind to object identity (Notidian-kcgt)", () => {
  it("two independently built trees with identical code fingerprint identically", () => {
    const a = makeTree("u1", { props: { value: "$api.path.label(x)" } }, [
      makeTree("c1", { styles: { color: "'red'" } }),
    ]);
    const b = makeTree("u1", { props: { value: "$api.path.label(x)" } }, [
      makeTree("c1", { styles: { color: "'red'" } }),
    ]);
    expect(a).not.toBe(b);
    expect(fingerprintFrameTree(a)).toBe(fingerprintFrameTree(b));
  });

  it("is insensitive to prop-key insertion order (same code, different build order)", () => {
    const a = makeTree("u1", { props: { alpha: "1", beta: "2" } });
    const b = makeTree("u1", {});
    // rebuild b's props in the opposite insertion order
    b.node.props = { beta: "2", alpha: "1" };
    expect(fingerprintFrameTree(a)).toBe(fingerprintFrameTree(b));
  });

  it.each([
    ["prop code", (t: FrameTreeNode) => (t.node.props.value = "$api.other()")],
    ["style code", (t: FrameTreeNode) => (t.node.styles.background = "$api.x()")],
    ["action code", (t: FrameTreeNode) => (t.node.actions.onClick = "$api.y()")],
    ["node type", (t: FrameTreeNode) => (t.node.type = "flow")],
    ["prop type (affects codegen)", (t: FrameTreeNode) => (t.node.types.value = "object")],
  ])("changes when %s changes (an edit ALWAYS drops the match)", (_what, mutate) => {
    const base = () => makeTree("u1", { props: { value: "$api.path.label(x)" } });
    const edited = base();
    mutate(edited);
    expect(fingerprintFrameTree(base())).not.toBe(fingerprintFrameTree(edited));
  });

  it("changes when a CHILD's code changes (whole-tree coverage)", () => {
    const a = makeTree("u1", {}, [makeTree("c1", { props: { value: "1" } })]);
    const b = makeTree("u1", {}, [makeTree("c1", { props: { value: "2" } })]);
    expect(fingerprintFrameTree(a)).not.toBe(fingerprintFrameTree(b));
  });

  it("empty / null trees fingerprint to '' (never blessable)", () => {
    expect(fingerprintFrameTree(null)).toBe("");
    expect(fingerprintFrameTree(undefined)).toBe("");
  });

  // bd Notidian-sy30 — RENDER-TOPOLOGY INDEPENDENCE. Both render paths converge
  // on buildRoot -> linkProps (ast.ts), which folds each context-column field
  // into the ROOT node's props (value ALWAYS "") and types (the column type),
  // mutating root.node ONLY (children are byte-identical across paths). The
  // editable space view passes fields = [...tableData.cols, ...props.cols]; the
  // read surface passes frame.cols only. The SAME stored code must therefore
  // fingerprint IDENTICALLY however many context columns the path injected — else
  // a session bless self-destructs when the frame renders via the other topology
  // and a false "code changed" notice mis-fires (Notidian-pg6g unified identity).
  describe("is independent of linkProps-injected context columns (Notidian-sy30)", () => {
    const HERO = "$api.path.label($contexts.$space.note)";
    // stored code shared by both topologies: one code-bearing root prop + a child.
    const child = () =>
      makeTree("c1", { props: { value: "'card'" }, styles: { color: "'red'" } });
    // read path: frame.cols only (1 context column injected as "" + its type).
    const readTopology = (hero = HERO) =>
      makeTree(
        "main",
        { props: { Status: "", hero }, types: { Status: "text" } },
        [child()]
      );
    // editable path: [...tableData.cols, ...props.cols] (3 context columns).
    const editableTopology = (hero = HERO) =>
      makeTree(
        "main",
        {
          props: { Status: "", Priority: "", Tags: "", hero },
          types: { Status: "text", Priority: "number", Tags: "tags" },
        },
        [child()]
      );

    it("editable and read topologies of identical stored code fingerprint EQUAL", () => {
      expect(fingerprintFrameTree(editableTopology())).toBe(
        fingerprintFrameTree(readTopology())
      );
    });

    it("a real stored-code edit (ROOT prop) makes them UNEQUAL (edit still drops trust)", () => {
      // the guard the bead calls out: edit-drops-trust must hold for ROOT props,
      // not only children — a changed code-bearing root prop flips the print.
      expect(
        fingerprintFrameTree(editableTopology("$api.evil()"))
      ).not.toBe(fingerprintFrameTree(readTopology()));
    });

    it("ADDING a non-empty root prop flips the fingerprint (nothing smuggled past the canonicalizer)", () => {
      const withExtra = makeTree(
        "main",
        {
          props: { Status: "", hero: HERO, danger: "$api.write()" },
          types: { Status: "text" },
        },
        [child()]
      );
      expect(fingerprintFrameTree(withExtra)).not.toBe(
        fingerprintFrameTree(readTopology())
      );
    });

    it("SOUNDNESS: an empty-valued root prop (even WITH a type) is canonicalized out", () => {
      // executable.ts generateCodeForProp compiles an empty value to
      // () => undefined regardless of its type (`type` only flips a branch reached
      // when the value is multi-line), so an empty prop carries NO executable code
      // and must not perturb the fingerprint — an attacker can neither smuggle
      // behaviour nor evade a code-change through an empty-valued, typed root prop.
      const withEmptyTyped = makeTree(
        "main",
        {
          props: { Status: "", hero: HERO, ghost: "" },
          types: { Status: "text", ghost: "object" },
        },
        [child()]
      );
      expect(fingerprintFrameTree(withEmptyTyped)).toBe(
        fingerprintFrameTree(readTopology())
      );
    });

    it("canonicalization is ROOT-only: an empty prop on a CHILD is still fingerprinted", () => {
      // linkProps never mutates children, so they keep FULL serialization — an
      // empty child prop stays in the print (a spurious drop-trust is fail-safe;
      // a missed code change is not). This pins that the fix does NOT recurse.
      const a = makeTree("main", {}, [makeTree("c1", { props: { x: "" } })]);
      const b = makeTree("main", {}, [makeTree("c1", { props: {} })]);
      expect(fingerprintFrameTree(a)).not.toBe(fingerprintFrameTree(b));
    });
  });
});

// bd Notidian-kcgt (milestone-gate must-fix): the bless was MOUNT-scoped — the
// stamp lived only on the in-memory tree, which every view remount rebuilds
// unstamped, so clicking away and back silently dropped trust and mis-fired the
// "code changed" re-arm. restampSessionBless is the fix: at run time a freshly
// materialized tree regains the stamp IFF (identity, code) both match what the
// user blessed THIS SESSION. Edit => fingerprint mismatch => refuse (and the
// withhold path re-arms); reload => registry reset => refuse. Never persisted.
describe("restampSessionBless: session-scoped, not mount-scoped (Notidian-kcgt)", () => {
  const frameId = "spaces://My Space/#*main";
  const CODE = "$api.probe.ping('user-frame')";
  const buildFresh = (code: string = CODE) =>
    makeTree("u1", { props: { value: code } }, [
      makeTree("c1", { styles: { color: "'red'" } }),
    ]);

  const blessLikeTheCommand = (tree: FrameTreeNode) => {
    // what onApiWithheld + the command do: register with the tree's fingerprint,
    // then the user blesses the named frame (stamping the live tree).
    registerFrameBless(
      frameId,
      `${frameId}::r0`,
      () => stampKitProvenanceTree(tree),
      fingerprintFrameTree(tree)
    );
    expect(blessFrameById(frameId)).toBe(1);
    expect(hasKitProvenance(tree.node)).toBe(true);
  };

  it("REMOUNT with identical code: the fresh tree is restamped (trust survives the session)", () => {
    blessLikeTheCommand(buildFresh());
    // remount: a brand-new, unstamped tree built from the SAME stored code
    const remounted = buildFresh();
    expect(hasKitProvenance(remounted.node)).toBe(false);
    expect(restampSessionBless(frameId, remounted)).toBe(true);
    expect(hasKitProvenance(remounted.node)).toBe(true);
    // children are stamped too (whole-tree bless, list templates included by ref)
    expect(hasKitProvenance(remounted.children[0].node)).toBe(true);
    // and the bless bookkeeping is untouched — no spurious "code changed" re-arm
    expect(sessionBlessFingerprint(frameId)).toBe(fingerprintFrameTree(remounted));
    expect(pendingBlessFrameIds()).toEqual([]);
  });

  it("EDITED code on remount: refuses the stamp (the withhold path then re-arms the notice)", () => {
    blessLikeTheCommand(buildFresh());
    const edited = buildFresh("$api.probe.ping('REWRITTEN')");
    expect(restampSessionBless(frameId, edited)).toBe(false);
    expect(hasKitProvenance(edited.node)).toBe(false);
    // the edited frame withholds $api -> shouldNotifyApiWithheld drops the stale
    // bless and re-arms, so the user is re-warned about the NEW code
    expect(shouldNotifyApiWithheld(frameId)).toBe(true);
    expect(sessionBlessFingerprint(frameId)).toBeUndefined();
  });

  it("RELOAD (registry reset) drops the fingerprint: identical code is NOT restamped", () => {
    blessLikeTheCommand(buildFresh());
    resetFrameTrustSession();
    const afterReload = buildFresh();
    expect(restampSessionBless(frameId, afterReload)).toBe(false);
    expect(hasKitProvenance(afterReload.node)).toBe(false);
  });

  it("ADVERSARIAL: a DIFFERENT frame identity with byte-identical code never inherits the bless", () => {
    blessLikeTheCommand(buildFresh());
    const impostor = buildFresh(); // same code, planted at another path
    expect(restampSessionBless("spaces://Attacker/#*main", impostor)).toBe(false);
    expect(hasKitProvenance(impostor.node)).toBe(false);
  });

  it("never restamps for an unsound identity, an unblessed frame, or a missing tree", () => {
    expect(restampSessionBless("?", buildFresh())).toBe(false);
    expect(restampSessionBless(null, buildFresh())).toBe(false);
    expect(restampSessionBless("spaces://never-blessed", buildFresh())).toBe(false);
    blessLikeTheCommand(buildFresh());
    expect(restampSessionBless(frameId, null)).toBe(false);
  });

  it("a bless registered WITHOUT a fingerprint stays mount-scoped (fail-safe), but still re-arms on withhold", () => {
    const tree = buildFresh();
    registerFrameBless(frameId, `${frameId}::r0`, () =>
      stampKitProvenanceTree(tree)
    ); // legacy 3-arg call: no fingerprint
    expect(blessFrameById(frameId)).toBe(1);
    // no fingerprint recorded -> a remount can never silently restamp...
    expect(restampSessionBless(frameId, buildFresh())).toBe(false);
    // ...but the blessed bit still exists, so a later withhold re-arms honestly
    expect(shouldNotifyApiWithheld(frameId)).toBe(true);
  });

  it("bless records the fingerprint of the instance it actually stamped", () => {
    const tree = buildFresh();
    const fp = fingerprintFrameTree(tree);
    registerFrameBless(frameId, `${frameId}::r0`, () => undefined, fp);
    blessFrameById(frameId);
    expect(sessionBlessFingerprint(frameId)).toBe(fp);
  });
});
