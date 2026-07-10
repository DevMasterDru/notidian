// bd Notidian-214 / ADR 0022 Decision 2c — session-scoped, NON-PERSISTED frame
// trust discovery + bless registry.
//
// HARD SECURITY INVARIANT (adversarial panel must verify): nothing here is
// persisted, and nothing is derived from node.ref / an mdb column / frontmatter
// / data.json. All state is MODULE-LEVEL, so it resets to empty when the plugin
// reloads (a fresh module instance). Trust must therefore be re-granted after
// every reload/edit BY DESIGN — a silently-rewritten frame loses trust, which is
// precisely the property that keeps the vke boundary sound (persisting any trust
// signal would reopen the vke RCE).
//
// This module holds NO trust signal itself. It only:
//   1. de-dupes the read-only "$api withheld" diagnostic to once-per-frame-per-
//      session (so a re-rendering frame does not spam the owner), and
//   2. remembers a user-facing bless CALLBACK per flagged frame so a command can
//      invoke it. The actual trust STAMP is applied by trust.ts, on the in-memory
//      materialized tree only.

type BlessFn = () => void;

const notifiedFrames = new Set<string>();
const pendingBless = new Map<string, BlessFn>();

// True the FIRST time a frame key withholds $api this session; false thereafter
// (until reload / reset). Keeps the read-only diagnostic to one notice per frame.
export const shouldNotifyApiWithheld = (frameKey: string): boolean => {
  if (notifiedFrames.has(frameKey)) return false;
  notifiedFrames.add(frameKey);
  return true;
};

// Remember (or refresh) the bless callback for a frame that just withheld $api.
export const registerFrameBless = (frameKey: string, bless: BlessFn): void => {
  pendingBless.set(frameKey, bless);
};

// Drop a frame's session state (call on unmount so callbacks do not leak).
export const unregisterFrame = (frameKey: string): void => {
  pendingBless.delete(frameKey);
  notifiedFrames.delete(frameKey);
};

export const pendingBlessCount = (): number => pendingBless.size;

// User-initiated: bless EVERY frame flagged this session (each was announced by
// its own diagnostic, so the owner is opting into exactly the frames they saw).
// Idempotent; a stale/unmounted frame's bless throwing must not abort the rest.
// Returns how many frames were blessed.
export const blessAllSessionFrames = (): number => {
  const fns = [...pendingBless.values()];
  fns.forEach((f) => {
    try {
      f();
    } catch (e) {
      // best-effort: one dead frame instance must not block the others
    }
  });
  return fns.length;
};

// Reload model / test reset: drop all session discovery + bless state. In
// production this is what a plugin reload does for free (fresh module) — exposed
// so tests can prove the "reload drops trust" invariant deterministically.
export const resetFrameTrustSession = (): void => {
  notifiedFrames.clear();
  pendingBless.clear();
};
