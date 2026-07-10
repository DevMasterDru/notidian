// bd Notidian-214 / ADR 0022 Decision 2c — session-scoped frame-trust registry.
//
// Pins the NON-PERSISTED, once-per-frame-per-session discovery + bless bookkeeping
// that the read-only diagnostic and the "Trust this frame's code for this session"
// command depend on. The hard invariant under test: all state is module-level and
// a reset (what a plugin RELOAD does for free) drops every trust discovery + bless
// callback, so trust must be re-granted after reload/edit BY DESIGN.
import {
  blessAllSessionFrames,
  pendingBlessCount,
  registerFrameBless,
  resetFrameTrustSession,
  shouldNotifyApiWithheld,
  unregisterFrame,
} from "./frameTrustSession";

beforeEach(() => resetFrameTrustSession());

describe("shouldNotifyApiWithheld: once per frame per session", () => {
  it("returns true the FIRST time a frame key withholds, false thereafter", () => {
    expect(shouldNotifyApiWithheld("space://A")).toBe(true);
    expect(shouldNotifyApiWithheld("space://A")).toBe(false);
    expect(shouldNotifyApiWithheld("space://A")).toBe(false);
  });

  it("de-dupes per key: distinct frames each notify once", () => {
    expect(shouldNotifyApiWithheld("space://A")).toBe(true);
    expect(shouldNotifyApiWithheld("space://B")).toBe(true);
    expect(shouldNotifyApiWithheld("space://A")).toBe(false);
    expect(shouldNotifyApiWithheld("space://B")).toBe(false);
  });

  it("RELOAD/reset re-arms the notice (models a fresh plugin load)", () => {
    expect(shouldNotifyApiWithheld("space://A")).toBe(true);
    expect(shouldNotifyApiWithheld("space://A")).toBe(false);
    resetFrameTrustSession();
    expect(shouldNotifyApiWithheld("space://A")).toBe(true);
  });
});

describe("bless registry: register / bless-all / unregister", () => {
  it("blessAllSessionFrames invokes every registered bless callback and returns the count", () => {
    const calls: string[] = [];
    registerFrameBless("A", () => calls.push("A"));
    registerFrameBless("B", () => calls.push("B"));
    expect(pendingBlessCount()).toBe(2);
    const n = blessAllSessionFrames();
    expect(n).toBe(2);
    expect(calls.sort()).toEqual(["A", "B"]);
  });

  it("re-registering the same key REPLACES the callback (latest materialized tree wins)", () => {
    const calls: string[] = [];
    registerFrameBless("A", () => calls.push("stale"));
    registerFrameBless("A", () => calls.push("fresh"));
    expect(pendingBlessCount()).toBe(1);
    blessAllSessionFrames();
    expect(calls).toEqual(["fresh"]);
  });

  it("a throwing bless callback does not abort the others (best-effort)", () => {
    const calls: string[] = [];
    registerFrameBless("A", () => {
      throw new Error("dead frame instance");
    });
    registerFrameBless("B", () => calls.push("B"));
    expect(() => blessAllSessionFrames()).not.toThrow();
    expect(calls).toEqual(["B"]);
  });

  it("unregisterFrame drops the callback and re-arms its notice (unmount)", () => {
    const calls: string[] = [];
    shouldNotifyApiWithheld("A");
    registerFrameBless("A", () => calls.push("A"));
    unregisterFrame("A");
    expect(pendingBlessCount()).toBe(0);
    blessAllSessionFrames();
    expect(calls).toEqual([]);
    // notice re-armed after unmount
    expect(shouldNotifyApiWithheld("A")).toBe(true);
  });

  it("RELOAD/reset drops ALL pending bless callbacks (trust must be re-granted)", () => {
    registerFrameBless("A", () => undefined);
    registerFrameBless("B", () => undefined);
    expect(pendingBlessCount()).toBe(2);
    resetFrameTrustSession();
    expect(pendingBlessCount()).toBe(0);
    expect(blessAllSessionFrames()).toBe(0);
  });
});
