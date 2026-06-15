# ADR 0022: Frame-Execution Settings Toggle + Vault-Trusted-Frame Allowlist

## Status

Proposed. Awaiting owner direction (bd Notidian-214). This ADR refuses to build
the toggle + allowlist blind: the work is gated on a prior live-verify decision
(see Context) and the allowlist mechanism is a genuine design choice with a hard
security invariant. It frames the options and recommends one; nothing in the
runtime render path changes here.

## Date

2026-06-15

## Context

[ADR 0018](0018-makemd-fork-debt-scope-and-frame-trust-boundary.md) kept the
frames runtime (load-bearing for core view rendering) and hardened its RCE sink
behind a **default-OFF** setting, `hardenFrameExecution` (bd Notidian-vke). When
that flag is ON:

1. The `new Function` prop/style evaluator (`src/core/utils/frames/runner.ts`)
   withholds `$api` from **user/imported** frame nodes — only nodes whose code was
   resolved from a `superstate.kit` entry at expansion time keep `$api`.
2. Frame text is routed through `sanitizeFrameText`
   (`src/shared/utils/sanitize.ts`).

The trust decision rests on a **non-persisted provenance marker**
(`src/core/utils/frames/trust.ts`): a module-private, non-enumerable,
Symbol-keyed own property stamped only by trusted expansion code
(`ast.ts` → `stampKitProvenanceTree` on the `$kit` resolution branch). Trust is
explicitly **not** derived from `node.ref` — `ref` is a persisted, attacker-
controllable `DBRow` column, so a forged `spaces://$kit/` prefix on a stored or
`.mkit`-imported row would silently regain `$api` on every render. That earlier
`ref.startsWith(...)` check was the silent-on-render RCE; the provenance marker
is the fix. (Verified: `list`/`calendar`/`ui` kits call `$api.path.*`/`$api.date.*`
in props **and** styles — `src/schemas/kits/{list,calendar,ui}.ts` — so a blanket
gate would break default rendering; kit-provenanced nodes must keep `$api`.)

Today there is **no settings-UI toggle** for `hardenFrameExecution`; it lives only
in the settings type/`DEFAULT_SETTINGS` (`src/shared/types/settings.ts:104`,
`src/core/schemas/settings.ts:92`) and is set via `data.json`. bd Notidian-214
asks for two follow-ups: (1) a settings-UI toggle; (2) a **vault-trusted-frame
allowlist** so a legitimate user-authored dynamic frame that relies on `$api` in a
prop/style is not permanently no-op'd by the boundary.

### Why this is a decision, not a build

1. **It is gated on a prior owner decision.** Notidian-vke is still **Pending —
   flag-gated** in `docs/AUTONOMOUS-REVIEW-QUEUE.md`: the owner must first enable
   `hardenFrameExecution`, live-verify in the vault, and **decide to keep it on**.
   Building the toggle + allowlist ahead of that gambles quota on a boundary the
   owner may tune or reject. The allowlist's very existence is conditional on the
   live-verify finding a real user frame that the boundary breaks (review-queue
   item: "If this breaks a frame the owner actually uses, that is the signal to
   refine the trust model").
2. **The allowlist is a genuine design choice with a hard invariant.** How does a
   user mark a specific frame as trusted **without** reintroducing an attacker-
   controllable trust signal? The whole point of `trust.ts` is that trust is
   non-persisted and unforgeable. A persisted allowlist (a column, a frontmatter
   field, a stored marker) is, by construction, editable by the same AI-writes-to-
   vault threat actor the boundary defends against — it would **reopen the exact
   vke RCE**. So "just add an allowlist" is not a settled design; it is the
   question.

## Decision 1 — Settings-UI toggle for `hardenFrameExecution`

The settings tab (`src/adapters/obsidian/settings.ts`) is declarative: a
`SettingObject[]` keyed by setting name, grouped by `category`/`subCategory`, with
the label/description pulled from localization keys and a toggle auto-generated for
`type: 'boolean'`. Adding the toggle is a small, declarative change:

- Add `{ name: 'hardenFrameExecution', category: 'advanced', type: 'boolean' }`
  to the settings list, plus a localization entry (name + a description that names
  the tradeoff: "may disable `$api` in custom user frames").
- No `onChange` side effect is needed — the existing handler writes the setting and
  calls `saveSettings()`; the render path reads `settings.hardenFrameExecution` live
  on next render.

**Options for placement/wording:**

- **(1a) `advanced` category, security-framed wording (recommended).** Lives next
  to `enhancedLogs`/other advanced toggles. Wording surfaces it as a security
  hardening switch with an explicit cost: "Harden frame execution — withhold write
  access (`$api`) from custom/imported frames and sanitize frame text. Protects
  against malicious frame code; may disable dynamic expressions in frames you
  authored yourself." Keeps it out of the way of everyday settings while being
  discoverable, and the wording tells the user *why their custom frame stopped
  working* — which is the support question this toggle creates.
- **(1b) `space` category.** More topically adjacent to frames, but mixes a
  security switch into appearance/context settings and risks casual toggling
  without understanding the render-path cost.
- **(1c) No category change, but add an inline "what breaks" note + link.** Same as
  1a plus a one-line pointer to the trusted-frame story (Decision 2). Fold this
  into 1a once Decision 2 lands; standalone it over-promises a feature that may not
  exist yet.

## Decision 2 — Vault-trusted-frame allowlist

**Invariant (non-negotiable):** trust must remain a **non-persisted,
non-attacker-controllable** signal (`trust.ts`). Any design that stores "this
frame is trusted" in a place the vault-writer threat actor can edit (an `.mdb`
column, a frontmatter field, a `data.json` list of paths) is attacker-editable and
**reopens the vke RCE**. The allowlist must turn into the *same* runtime provenance
stamp the kit path already uses, gated by a signal the attacker cannot forge.

**Options:**

- **(2a) Per-space "trusted" marker stored in `.notidian` context / frontmatter.**
  A flag on the space (e.g. a `frameTrusted` context field) that
  `stampKitProvenanceTree` honours for that space's `main` frame.
  *Rejected:* `.notidian` context MDB rows and frontmatter are exactly the
  persisted, AI-writable surface the boundary defends; an attacker who can write a
  malicious frame can also write `frameTrusted: true` next to it. This is the
  forgeable-`ref` mistake in a new column. Violates the invariant.

- **(2b) A `data.json` settings list of trusted space paths
  (`trustedFramePaths: string[]`), checked at expansion time.** A path-based
  allowlist the user manages in settings; expansion stamps provenance on frames
  whose space path is in the list.
  *Weaker but still risky:* `data.json` is less likely to be written by an
  in-vault AI agent than vault files, **but** the elevated threat model
  (ADR 0018 — AI agents write to the vault) does not categorically exclude plugin
  config, and a path-match grants trust to *whatever content currently lives at
  that path*, so an attacker who later overwrites a trusted-path frame inherits
  `$api`. Trust would attach to a **location**, not to **code the user actually
  reviewed**. It also degrades trust from "provenance of this exact code" to "this
  path is blessed forever," which is a real downgrade of the invariant even if the
  config surface is harder to reach. Acceptable only with eyes-open owner consent
  and a re-confirm-on-change affordance.

- **(2c) Extend genuine provenance to a user-blessed frame via an explicit,
  session-scoped, non-persisted "bless this frame" action (recommended).** Keep
  trust exactly where `trust.ts` puts it — a runtime, non-persisted stamp — and add
  a deliberate, user-initiated gesture (e.g. a "Trust this frame's code for this
  session" command/button shown when the boundary no-ops an `$api` expression) that
  calls `stampKitProvenanceTree` on that materialized frame **in memory only**.
  Trust is granted to the **code the user just looked at**, never persisted, and
  re-confirmed after any reload or edit — which is precisely the property that makes
  the kit path sound. The cost (re-bless after reload) is the *feature*: it means a
  silently-rewritten frame loses trust automatically.
  - Optional persistence-with-integrity refinement (only if re-blessing proves too
    annoying in live use): persist a **content hash** of the blessed frame's code
    (not the path, not a boolean) in `data.json`; on expansion, stamp provenance
    only if the current frame code hashes to a blessed value. Trust then tracks the
    *exact reviewed bytes*; any rewrite (the attack) changes the hash and drops
    trust. This keeps the invariant ("trust the reviewed code, not a forgeable
    flag") while surviving reloads. Defer until 2c-base shows it is needed.

## Recommendation

**Decision 1: adopt (1a)** — `advanced`-category toggle with security-framed,
tradeoff-naming wording: it is the smallest discoverable surface that also answers
the support question ("why did my custom frame stop working?") the boundary creates.

**Decision 2: adopt (2c)** — a non-persisted, user-blessed, session-scoped
provenance stamp (optionally upgraded to a content-hash allowlist if re-blessing is
too noisy): it is the only option that adds user-controllable trust **without**
making trust attacker-controllable, so it preserves the `trust.ts` invariant and
does not reopen the vke RCE. (One line: trust the code the user actually reviewed,
in memory only — never a persisted, forgeable "trusted" flag.)

## Alternatives Considered / Ruled Out

- **2a — persisted per-space/frontmatter "trusted" marker.** Rejected:
  attacker-editable; structurally identical to the forgeable-`ref` RCE the vke fix
  closed.
- **2b — `data.json` trusted-paths list.** Not recommended (kept as a fallback if
  the owner explicitly accepts the downgrade): trust attaches to a location, not to
  reviewed code, so overwriting a blessed-path frame inherits `$api`; weaker than
  2c on the invariant.
- **Blanket "run all user frame code when toggle is off / never harden."**
  Rejected — that is just not enabling the boundary; it is not an allowlist and
  leaves the RCE open under the elevated threat model.
- **Auto-trust frames the user has edited / opened.** Rejected: "opened" and
  "edited" are not review; an AI agent writes then the user opens, granting trust to
  unreviewed code.

## Default-OFF spike path (optional, de-risks Decision 2 without committing)

If the owner wants concrete evidence before committing: land **only** Decision 1
(the toggle) plus a **read-only diagnostic** — when the boundary no-ops an `$api`
expression on a user frame, log/notify *which* frame and expression were withheld
(behind the same default-OFF flag). This costs almost nothing, changes no trust
logic, and turns the live-verify into a precise list of "frames that actually need
blessing," which tells the owner whether 2c is even necessary and what the blessing
UX must cover — before any allowlist code is written. The 2c "bless this frame"
action is then a follow-up bead, built against real data.

## Consequences

- Decision 1 makes the boundary user-discoverable and self-explaining (no more
  data.json editing); zero render-path risk.
- Decision 2 (2c) keeps the security invariant intact: there is no persisted,
  forgeable trust signal, so enabling the boundary plus user-blessed frames cannot
  reopen the RCE. The tradeoff is re-blessing after reload/edit (mitigable by the
  optional content-hash refinement).
- This ADR changes **no runtime render path**. Nothing ships until the owner (a)
  keeps `hardenFrameExecution` on after live-verify and (b) picks a Decision 2
  direction.
