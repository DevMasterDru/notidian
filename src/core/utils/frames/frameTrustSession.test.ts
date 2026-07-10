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
//   - reset (what a plugin RELOAD does for free) drops every trust bit.
import {
  blessFrameById,
  dispatchFrameTrust,
  isSoundFrameId,
  pendingBlessCount,
  pendingBlessFrameIds,
  registerFrameBless,
  resetFrameTrustSession,
  shouldNotifyApiWithheld,
  unregisterFrame,
} from "./frameTrustSession";

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

describe("dispatchFrameTrust: 0 / 1 / many routing (the security branch)", () => {
  it("0 pending -> onEmpty only", () => {
    const seen: string[] = [];
    dispatchFrameTrust([], {
      onEmpty: () => seen.push("empty"),
      onSingle: () => seen.push("single"),
      onMultiple: () => seen.push("multi"),
    });
    expect(seen).toEqual(["empty"]);
  });

  it("exactly 1 pending -> onSingle(frame), never onMultiple", () => {
    const seen: string[] = [];
    dispatchFrameTrust(["spaces://A"], {
      onEmpty: () => seen.push("empty"),
      onSingle: (f) => seen.push(`single:${f}`),
      onMultiple: () => seen.push("multi"),
    });
    expect(seen).toEqual(["single:spaces://A"]);
  });

  it("INVARIANT: >1 pending -> onMultiple (a picker), NEVER an auto-bless", () => {
    const seen: string[] = [];
    let singleCalled = false;
    dispatchFrameTrust(["spaces://A", "spaces://B"], {
      onEmpty: () => seen.push("empty"),
      onSingle: () => (singleCalled = true),
      onMultiple: (fs) => seen.push(`multi:${fs.join(",")}`),
    });
    expect(seen).toEqual(["multi:spaces://A,spaces://B"]);
    expect(singleCalled).toBe(false); // never blesses directly when ambiguous
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

  it("dispatchFrameTrust NEVER auto-blesses an unidentified frame: ['?'] -> onEmpty", () => {
    const seen: string[] = [];
    dispatchFrameTrust(["?"], {
      onEmpty: () => seen.push("empty"),
      onSingle: (f) => seen.push(`single:${f}`),
      onMultiple: (fs) => seen.push(`multi:${fs.join(",")}`),
    });
    expect(seen).toEqual(["empty"]);
  });

  it("dispatchFrameTrust filters unsound ids before 0/1/many routing", () => {
    const seen: string[] = [];
    dispatchFrameTrust(["?", "spaces://A"], {
      onEmpty: () => seen.push("empty"),
      onSingle: (f) => seen.push(`single:${f}`),
      onMultiple: (fs) => seen.push(`multi:${fs.join(",")}`),
    });
    // "?" must not force the ambiguous->picker route (nor ever be pickable):
    // only the ONE sound, named frame is offered, via the single route.
    expect(seen).toEqual(["single:spaces://A"]);
  });

  it("dispatchFrameTrust with several sound ids + an unsound one pickers ONLY the sound ones", () => {
    const seen: string[] = [];
    dispatchFrameTrust(["spaces://A", "?", "spaces://B"], {
      onEmpty: () => seen.push("empty"),
      onSingle: (f) => seen.push(`single:${f}`),
      onMultiple: (fs) => seen.push(`multi:${fs.join(",")}`),
    });
    expect(seen).toEqual(["multi:spaces://A,spaces://B"]);
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
  it("clears pending, offers, notices, and blessed set", () => {
    registerFrameBless("spaces://A", "spaces://A::r0", () => undefined);
    registerFrameBless("spaces://B", "spaces://B::r0", () => undefined);
    shouldNotifyApiWithheld("spaces://A");
    blessFrameById("spaces://B");
    expect(pendingBlessCount()).toBe(2);
    resetFrameTrustSession();
    expect(pendingBlessCount()).toBe(0);
    expect(pendingBlessFrameIds()).toEqual([]);
    expect(blessFrameById("spaces://A")).toBe(0);
    expect(shouldNotifyApiWithheld("spaces://A")).toBe(true);
  });
});
