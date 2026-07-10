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
//   1. de-dupes the read-only "$api withheld" diagnostic to once per FRAME
//      IDENTITY (its path) per session. The identity is NOT the per-row instance:
//      a list renders one FrameInstance PER ROW that all share one item-frame
//      path, so keying the notice on the instance would stack ~one Notice per
//      visible row (a 50-card view => 50 toasts). One logical frame => one notice.
//   2. remembers a user-facing bless CALLBACK PER INSTANCE (so blessing a chosen
//      frame re-runs ALL its rows), grouped by frame identity so the command can
//      bless EXACTLY ONE user-chosen frame. There is deliberately no "bless
//      everything" entry point: one gesture must never trust a frame the user did
//      not choose (a confused deputy — an AI-planted frame flagged alongside the
//      user's own would ride a single grant to full vault-write $api). The actual
//      trust STAMP is applied by trust.ts, on the in-memory materialized tree only.

type BlessFn = () => void;

// Notice de-dup, keyed on FRAME IDENTITY (path). It intentionally SURVIVES
// instance unmount / remount / pagination — clearing it on unmount would re-arm
// the toast on every re-open of a multi-row view. It re-arms ONLY on reload
// (resetFrameTrustSession) or when a blessed frame's code changes (see
// shouldNotifyApiWithheld).
const notifiedFrames = new Set<string>();

// Bless callbacks, keyed per INSTANCE (path::id). A 50-row list registers 50.
const pendingBless = new Map<string, BlessFn>();

// instanceKey -> frame identity (path), so callbacks can be grouped and blessed by
// the specific frame the user chose.
const instanceFrameId = new Map<string, string>();

// Frame identities the user blessed this session. A blessed frame is stamped
// trusted and keeps $api, so if it withholds $api AGAIN its code must have been
// replaced (edit / attacker rewrite) — that is the ONE signal used to re-arm its
// notice and re-offer it for a fresh, informed bless. Never persisted.
const blessedFrames = new Set<string>();

// Register (or refresh) the bless callback for an INSTANCE that just withheld
// $api, tagged with its frame identity. Call BEFORE shouldNotifyApiWithheld.
export const registerFrameBless = (
  frameId: string,
  instanceKey: string,
  bless: BlessFn
): void => {
  pendingBless.set(instanceKey, bless);
  instanceFrameId.set(instanceKey, frameId);
};

// Decide whether to surface the once-per-frame notice for this frame identity.
// If the frame was previously blessed yet is withholding $api again, its code
// changed since the bless (a stamped tree keeps $api) — drop the stale trust
// bookkeeping and re-arm the notice so the user is re-warned about the NEW code
// before re-trusting it.
export const shouldNotifyApiWithheld = (frameId: string): boolean => {
  if (blessedFrames.has(frameId)) {
    blessedFrames.delete(frameId);
    notifiedFrames.delete(frameId);
  }
  if (notifiedFrames.has(frameId)) return false;
  notifiedFrames.add(frameId);
  return true;
};

// Drop ONE instance's bless callback on unmount (so callbacks do not leak).
// Deliberately does NOT touch the frame-identity notice flag: the notice is per
// frame, so clearing it here would re-arm on every remount/pagination and spam a
// multi-row view. It resets only on reload (resetFrameTrustSession) or a blessed
// frame's code change.
export const unregisterFrame = (instanceKey: string): void => {
  pendingBless.delete(instanceKey);
  instanceFrameId.delete(instanceKey);
};

// Distinct frame identities currently awaiting a bless. Excludes already-blessed
// frames so the picker never re-offers a frame the user already trusted (unless it
// re-flagged after a code change, which clears its blessed bit).
export const pendingBlessFrameIds = (): string[] => {
  const ids = new Set<string>();
  for (const frameId of instanceFrameId.values()) {
    if (!blessedFrames.has(frameId)) ids.add(frameId);
  }
  return [...ids];
};

export const pendingBlessCount = (): number => pendingBless.size;

// Bless EXACTLY ONE frame identity: run every registered instance callback that
// belongs to it (all rows of a list) and mark it blessed. Returns how many
// instances were re-run. A stale/dead instance throwing must not abort the rest.
// This is the ONLY bless entry point — there is deliberately no "bless everything",
// so a single user gesture can never trust a frame the user did not choose.
export const blessFrameById = (frameId: string): number => {
  let blessed = 0;
  for (const [instanceKey, id] of instanceFrameId.entries()) {
    if (id !== frameId) continue;
    const fn = pendingBless.get(instanceKey);
    if (!fn) continue;
    try {
      fn();
      blessed++;
    } catch (e) {
      // best-effort: one dead frame instance must not block the others
    }
  }
  if (blessed > 0) blessedFrames.add(frameId);
  return blessed;
};

// Pure routing for the "Trust dynamic frame code" command: 0 pending -> nothing;
// exactly 1 -> bless it directly (the user saw its single, named notice); >1 ->
// hand off to a picker so the user trusts ONE named frame, never all of them at
// once. Isolated here so the confused-deputy-prevention branch is unit-testable
// independent of the menu UI.
export const dispatchFrameTrust = (
  frameIds: string[],
  handlers: {
    onEmpty: () => void;
    onSingle: (frameId: string) => void;
    onMultiple: (frameIds: string[]) => void;
  }
): void => {
  if (frameIds.length === 0) {
    handlers.onEmpty();
  } else if (frameIds.length === 1) {
    handlers.onSingle(frameIds[0]);
  } else {
    handlers.onMultiple(frameIds);
  }
};

// Reload model / test reset: drop ALL session discovery + bless state. In
// production this is what a plugin reload does for free (fresh module) — exposed
// so tests can prove the "reload drops trust" invariant deterministically.
export const resetFrameTrustSession = (): void => {
  notifiedFrames.clear();
  pendingBless.clear();
  instanceFrameId.clear();
  blessedFrames.clear();
};
