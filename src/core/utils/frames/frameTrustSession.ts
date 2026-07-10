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
//   3. bd Notidian-kcgt: remembers, per blessed frame identity, an in-memory
//      FINGERPRINT of the code the user blessed, so a freshly REBUILT tree (every
//      view remount rebuilds the root unstamped) can regain the stamp IFF its
//      code-bearing fields are byte-identical (restampSessionBless). Without
//      this, the bless was MOUNT-scoped, not session-scoped: clicking away and
//      back silently dropped trust and mis-fired the "code changed" re-arm. The
//      fingerprint is module memory only — an EDIT changes it (trust drops, the
//      notice re-arms) and a RELOAD clears it, exactly the ADR 0022 2c contract.

import { FrameTreeNode } from "shared/types/frameExec";
import { hasKitProvenance, stampKitProvenanceTree } from "./trust";

type BlessFn = () => void;

// bd Notidian-pg6g: a frame identity is SOUND only when it is a real, non-empty
// path. "?" was the legacy render-path fallback used whenever no FrameRootContext
// was mounted — which was EVERY editable space's main frame — so DIFFERENT frames
// aliased to one shared identity and a single bless gesture could trust a frame
// the user never reviewed (the exact ADR 0022 2c confused deputy). Unsound
// identities are refused at every entry point below: they can be neither
// registered, offered, picked, nor blessed.
export const isSoundFrameId = (
  frameId: string | null | undefined
): frameId is string =>
  typeof frameId === "string" && frameId.length > 0 && frameId !== "?";

// bd Notidian-kcgt — deterministic serialization of a value with SORTED object
// keys, so the fingerprint is a pure function of content, never of key insertion
// order (two builds of the same stored frame must fingerprint identically).
const stableSerialize = (v: unknown): string => {
  if (v === null || v === undefined) return "null";
  if (typeof v !== "object") return JSON.stringify(v) ?? "null";
  if (Array.isArray(v)) return `[${v.map(stableSerialize).join(",")}]`;
  const record = v as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stableSerialize(record[k])}`)
    .join(",")}}`;
};

// bd Notidian-kcgt — fingerprint of a materialized frame tree's CODE-BEARING
// fields: per node [id, type, props, types, styles, actions], children in order.
// (`types` is included because generateCodeForProp keys codegen off it.) A `list`
// node's item template is `execPropsOptions.template === children` BY REFERENCE
// on a source tree (executable.ts), so walking children covers templates too.
// The FULL serialized string is the fingerprint — exact equality, no hash, so
// there is no collision surface for an attacker to aim at.
export const fingerprintFrameTree = (
  tree: FrameTreeNode | null | undefined
): string => {
  if (!tree?.node) return "";
  const n = tree.node;
  const self = [
    JSON.stringify(n.id ?? ""),
    JSON.stringify(n.type ?? ""),
    stableSerialize(n.props ?? {}),
    stableSerialize(n.types ?? {}),
    stableSerialize(n.styles ?? {}),
    stableSerialize(n.actions ?? {}),
  ].join("|");
  const children = (tree.children ?? []).map(fingerprintFrameTree).join(",");
  return `${self}(${children})`;
};

// Notice de-dup, keyed on FRAME IDENTITY (path). It intentionally SURVIVES
// instance unmount / remount / pagination — clearing it on unmount would re-arm
// the toast on every re-open of a multi-row view. It re-arms ONLY on reload
// (resetFrameTrustSession) or when a blessed frame's code changes (see
// shouldNotifyApiWithheld).
const notifiedFrames = new Set<string>();

// Bless callbacks, keyed per INSTANCE (path::id::uid). A 50-row list registers 50.
const pendingBless = new Map<string, BlessFn>();

// instanceKey -> frame identity (path), so callbacks can be grouped and blessed by
// the specific frame the user chose.
const instanceFrameId = new Map<string, string>();

// bd Notidian-kcgt: instanceKey -> code fingerprint of the tree that instance
// registered with, so blessFrameById can record WHICH code the user blessed.
const instanceFingerprint = new Map<string, string>();

// Frame identities the user blessed this session -> the fingerprint of the code
// they blessed ("" when the registering seam supplied none — then the bless stays
// mount-scoped, fail-safe). A blessed frame is stamped trusted and keeps $api;
// restampSessionBless re-extends the stamp to a REBUILT tree only on an exact
// fingerprint match, so if a blessed identity still withholds $api its code must
// have been replaced (edit / attacker rewrite) — that is the ONE signal used to
// re-arm its notice and re-offer it for a fresh, informed bless. Never persisted.
const blessedFrames = new Map<string, string>();

// Register (or refresh) the bless callback for an INSTANCE that just withheld
// $api, tagged with its frame identity and the fingerprint of its current code.
// Call BEFORE shouldNotifyApiWithheld.
export const registerFrameBless = (
  frameId: string,
  instanceKey: string,
  bless: BlessFn,
  codeFingerprint = ""
): void => {
  // Notidian-pg6g: an unsound identity is un-attributable — registering it would
  // let frames from different sources alias into one blessable entry.
  if (!isSoundFrameId(frameId)) return;
  pendingBless.set(instanceKey, bless);
  instanceFrameId.set(instanceKey, frameId);
  instanceFingerprint.set(instanceKey, codeFingerprint);
};

// Decide whether to surface the once-per-frame notice for this frame identity.
// If the frame was previously blessed yet is withholding $api again, its code
// changed since the bless (a stamped tree keeps $api, and restampSessionBless
// re-extends the stamp to identical rebuilt code, so only DIFFERENT code can
// still withhold) — drop the stale trust bookkeeping and re-arm the notice so
// the user is re-warned about the NEW code before re-trusting it.
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
// Deliberately does NOT touch the frame-identity notice flag or the blessed
// fingerprint: the notice and the bless are per FRAME, so clearing them here
// would re-arm the toast / drop session trust on every remount or pagination.
// They reset only on reload (resetFrameTrustSession) or a blessed frame's code
// change (shouldNotifyApiWithheld).
export const unregisterFrame = (instanceKey: string): void => {
  pendingBless.delete(instanceKey);
  instanceFrameId.delete(instanceKey);
  instanceFingerprint.delete(instanceKey);
};

// Distinct frame identities currently awaiting a bless. Excludes already-blessed
// frames so the picker never re-offers a frame the user already trusted (unless it
// re-flagged after a code change, which clears its blessed bit).
export const pendingBlessFrameIds = (): string[] => {
  const ids = new Set<string>();
  for (const frameId of instanceFrameId.values()) {
    // Notidian-pg6g: defense in depth — an unsound identity must never be
    // offered even if one somehow entered the registry.
    if (!isSoundFrameId(frameId)) continue;
    if (!blessedFrames.has(frameId)) ids.add(frameId);
  }
  return [...ids];
};

export const pendingBlessCount = (): number => pendingBless.size;

// Bless EXACTLY ONE frame identity: run every registered instance callback that
// belongs to it (all rows of a list), mark it blessed, and record the fingerprint
// of the code that was stamped (bd Notidian-kcgt — this is what lets an identical
// rebuild regain the stamp for the rest of the session). Returns how many
// instances were re-run. A stale/dead instance throwing must not abort the rest.
// This is the ONLY bless entry point — there is deliberately no "bless everything",
// so a single user gesture can never trust a frame the user did not choose.
export const blessFrameById = (frameId: string): number => {
  // Notidian-pg6g: never stamp trust on an un-attributable identity — under the
  // legacy "?" alias this blessed whichever frame registered LAST, i.e. possibly
  // one the user never reviewed.
  if (!isSoundFrameId(frameId)) return 0;
  let blessed = 0;
  let fingerprint = "";
  for (const [instanceKey, id] of instanceFrameId.entries()) {
    if (id !== frameId) continue;
    const fn = pendingBless.get(instanceKey);
    if (!fn) continue;
    try {
      fn();
      blessed++;
      if (!fingerprint)
        fingerprint = instanceFingerprint.get(instanceKey) ?? "";
    } catch (e) {
      // best-effort: one dead frame instance must not block the others
    }
  }
  if (blessed > 0) blessedFrames.set(frameId, fingerprint);
  return blessed;
};

// bd Notidian-kcgt — the fingerprint recorded for a blessed frame identity this
// session, or undefined when it was never blessed (or its bless was dropped).
export const sessionBlessFingerprint = (frameId: string): string | undefined =>
  blessedFrames.get(frameId);

// bd Notidian-kcgt — re-extend a SESSION bless to a freshly materialized tree.
// Every view remount rebuilds the frame root UNSTAMPED (buildRootFromMDBFrame /
// buildRoot), which made the bless mount-scoped. Called by runRoot before
// execution: stamps the tree IFF (a) the identity is sound, (b) the user blessed
// that identity this session, and (c) the tree's code-bearing fields fingerprint
// EXACTLY to the code the user blessed. Trust therefore still attaches to the
// reviewed code + identity pair, in memory only — an attacker cannot mint a
// registry entry (only blessFrameById writes one, from the user command), a
// rewritten frame fingerprints differently (refused, and the withhold path then
// re-arms the notice), a same-code frame planted at another path has no entry,
// and a reload clears everything. Returns true when the stamp was applied.
export const restampSessionBless = (
  frameId: string | null | undefined,
  tree: FrameTreeNode | null | undefined
): boolean => {
  if (!tree?.node || !isSoundFrameId(frameId)) return false;
  if (hasKitProvenance(tree.node)) return false; // already trusted
  const blessedFp = blessedFrames.get(frameId);
  if (!blessedFp) return false; // never blessed, or bless without a fingerprint
  if (fingerprintFrameTree(tree) !== blessedFp) return false; // code changed
  stampKitProvenanceTree(tree);
  return true;
};

// Pure routing for the "Trust dynamic frame code" command: 0 pending -> nothing;
// otherwise ALWAYS hand the sound, named identities to a picker so the user
// trusts ONE named frame per click. bd Notidian-kcgt: there is deliberately NO
// single-pending auto-bless — the pending set is TIME-VARYING (instances
// unregister on unmount), so "exactly one pending" does not imply "the frame
// whose notice the user saw": between the notice and the gesture that frame may
// have unmounted and a different (possibly AI/attacker-authored, ADR 0018) frame
// may have flagged itself. The named click IS the attributed consent. Isolated
// here so the confused-deputy-prevention routing is unit-testable independent of
// the menu UI.
export const dispatchFrameTrust = (
  frameIds: string[],
  handlers: {
    onEmpty: () => void;
    onPick: (frameIds: string[]) => void;
  }
): void => {
  // Notidian-pg6g: an unidentified frame is never blessable and never pickable —
  // filter unsound ids BEFORE routing so "?" can never appear in the picker.
  const ids = frameIds.filter(isSoundFrameId);
  if (ids.length === 0) {
    handlers.onEmpty();
  } else {
    handlers.onPick(ids);
  }
};

// Reload model / test reset: drop ALL session discovery + bless state. In
// production this is what a plugin reload does for free (fresh module) — exposed
// so tests can prove the "reload drops trust" invariant deterministically.
export const resetFrameTrustSession = (): void => {
  notifiedFrames.clear();
  pendingBless.clear();
  instanceFrameId.clear();
  instanceFingerprint.clear();
  blessedFrames.clear();
};
