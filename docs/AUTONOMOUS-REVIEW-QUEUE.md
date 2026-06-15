# Autonomous Review Queue

This file is the owner's review surface for the autonomous implementation drive
(see [AGENTS.md](../AGENTS.md) → "Autonomous Implementation Mode"). The autonomous
loop appends here so nothing it could not fully verify itself drifts unseen.

Two kinds of entries, both **awaiting the owner**:

- **Flag-gated change** — a core render-path / not-offline-verifiable change that
  shipped behind a **default-OFF** setting. It needs the owner to enable the flag
  and live-verify in the vault before it counts as done.
- **Decision (ADR)** — a design-open feature the loop refused to build blind;
  instead it produced a Proposed ADR with options + a recommendation. It needs the
  owner to pick a direction; then the loop (or a session) implements it.

The loop bounds outstanding flag-gated changes (default cap: 4) before it stops
queueing more and pivots to safe work — so this list stays reviewable.

---

## Pending — flag-gated (enable + live-verify)

### Notidian-vke — Frame-execution sink hardening (trust boundary + frame-text sanitization)

- **Setting:** `hardenFrameExecution` (default `false`) — `src/shared/types/settings.ts`,
  defaulted in `src/core/schemas/settings.ts`.
- **Why gated:** both sinks are on the core render path — `SpaceOuter` *always*
  frame-renders every space (ADR 0018 / `frames-runtime-is-load-bearing` memory),
  so correctness cannot be proven by tsc/jest/build alone. Shipped OFF so the
  owner's current vault is byte-for-byte unchanged until enabled.
- **What it does when ON:**
  1. **Frame-text sanitization** — `TextNodeView`'s `dangerouslySetInnerHTML` of
     frame text is routed through the new `sanitizeFrameText` (`src/shared/utils/sanitize.ts`),
     a DOM-based sanitizer that strips `script`/`on*`/dangerous-URL/fetch elements
     but **keeps formatting tags** (it cannot use `escapeHtml`: `onBlur` reads
     `e.target.innerHTML`, so escaping would double-escape and break formatting).
  2. **`new Function` trust boundary** — the prop/style evaluator
     (`src/core/utils/frames/runner.ts`) withholds `$api` from **user/imported**
     frame nodes. Trust is decided by genuine, **non-persisted provenance**
     (`src/core/utils/frames/trust.ts`): a node keeps `$api` only if its code was
     resolved from a `superstate.kit` entry at expansion time (`ast.ts`
     `getFrameNodesByPath` `$kit` branch) and stamped with a module-private,
     non-enumerable, Symbol-keyed marker. Trust is **not** derived from
     `node.ref` — that is a persisted, attacker-controllable column, so a forged
     `spaces://$kit/` ref on a stored/imported row does **not** confer trust (the
     fix for the silent-on-render RCE the ref-based check left open). Plugin-shipped
     kit frames keep `$api` (they require it — `list`/`calendar`/`ui` kits call
     `$api.path.label`/`$api.date.*` in **props and styles**, so the bead's "no
     default prop/style needs $api" assumption was *refuted*; a blanket gate would
     break default rendering). User-triggered **actions** keep `$api` regardless
     (they are not part of the always-on render).
- **How to enable:** set `hardenFrameExecution: true` in the plugin's data.json
  (Notidian settings) or via the settings UI once a toggle is added.
- **What to live-verify in the vault (the part gates can't cover):**
  - Open several spaces (list view, card/column view, calendar view, detail
    view) with the flag ON — default rendering must be **unchanged** (covers/
    stickers/colors/dates still resolve, since default-kit nodes keep `$api`).
  - Edit a frame **text** node (type, bold/italic, paste formatted text), blur,
    reopen — formatting must round-trip losslessly (sanitizer keeps formatting).
  - Confirm a user-authored dynamic frame that relies on `$api` in a prop/style
    now no-ops that expression (expected: the trust-boundary tradeoff per ADR
    0018 — such frames must be re-classified as trusted or use actions). If this
    breaks a frame the owner actually uses, that is the signal to refine the
    trust model (e.g. an allowlist of vault-trusted frames) before enabling.
- **Offline evidence already in place:** `src/shared/utils/sanitizeFrameText.dom.test.ts`
  (jsdom, formatting-kept + dangerous-stripped + idempotent round-trip) and
  `src/core/utils/frames/trustBoundary.test.ts` (flag OFF = legacy; flag ON =
  `$api` withheld from untrusted props/styles, kept for trusted nodes + actions;
  cross-node isolation). Full suite + tsc + build green.
- **Primary import vector already closed:** the `.mkit` installer is disabled by
  default (Notidian-409 / ADR 0018), so untrusted frame *delivery* is already
  blocked; this bead hardens the *execution* sink as defence-in-depth.

## Pending — decisions (pick a direction)

_(none yet)_

## Cleared

_(none yet)_
