# ADR 0051: Deploy And Live-Verify Contract For Owner-Facing Render-Path Changes

## Status

**Accepted — owner-directed 2026-06-20.** Shipping an owner-facing render-path
change is **incomplete** until the freshly built plugin is **deployed + reloaded +
live-verified** in the owner's running Obsidian. The recipe is one falsifiable
command — `npm run deploy:vault` (`scripts/notidianDeployToVault.js`). The repo
parts of the fix (this ADR, the `deploy:vault` script, the `AGENTS.md` "Deploy &
live-verify" subsection) are landed; the global tool-resolution rule (Atlas Vault
`Standards.md`) and an optional enforcement hook are proposed to the owner
separately.

## Date

2026-06-20

## Context

Render-path / owner-facing features were repeatedly committed and gate-marked green
(`npm test`, `tsc -noEmit`, `npm run build`) while the build **never landed in the
owner's running Obsidian**, so the owner saw none of the work. This surfaced
concretely: after a session that shipped sub-items parity behind passing gates, the
owner reported "I don't see it" — the installed plugin was a build from *before the
work began*. The pattern also shows as lagging catch-up commits ("mark X
live-verified") trailing their feature commits.

**Structural root cause (verified live):** `npm run build` writes
`manifest.json`/`main.js`/`styles.css` to the **repo root only**; it never touches
the vault plugin dir (`<vault>/.obsidian/plugins/notidian/`). Landing a build in the
running Obsidian took two further **separate, skip-prone** manual acts —
`node scripts/notidianInstallToVault.js --allow-write` then a plugin reload — with
no chained command. Under autonomous pressure both were skipped, so **"gates pass"
was structurally mistaken for "the owner can see it."** `AGENTS.md` reinforced this:
its verification section stopped at build-provable gates, and its one relevant line
stated the philosophy passively ("their use is the live-verification") as a property
of the world rather than an **action the agent must take**.

A second, correlated failure mode (the wrong-binary-name guess) is addressed by the
global Atlas Standards tool-resolution rule, proposed separately; this ADR owns the
**deploy/verify** half.

## Decision

- **"Committed + gates-green" ≠ "deployed + reloaded + owner-can-see."** For any
  owner-facing render-path change, shipping is incomplete until the build is live in
  the running Obsidian and the change is observed.
- Encode the whole recipe as **one falsifiable command**, `npm run deploy:vault`
  (`scripts/notidianDeployToVault.js`): `npm run build` → reuse the exported
  `installPluginToVault({ allowWrite: true })` (forced, so the deploy can never
  silently no-op) → `obsidian plugin:reload id=notidian` → **assert installed
  `main.js`/`styles.css`/`manifest.json` byte-hash == freshly built byte-hash (fail
  loud)** → `obsidian dev:errors`. A `--verify-only` mode runs the parity gate alone
  (no writes), so the gate is independently falsifiable and usable as a "is the vault
  stale?" check.
- **Byte-hash parity, not version-string parity.** This catches a content change
  with **no manifest version bump** and a deploy that silently no-op'd — both of
  which the existing `health:audit --live` version-string check (`notidianHealthAudit.js`)
  misses. The resolved vault path is **printed before any write** (default
  `/Users/druker/Atlas Vault`, overridable via `NOTIDIAN_VAULT_PATH` or
  `--vault-path`) so a wrong-vault clobber can't happen silently; the command exits
  non-zero (clearly) when Obsidian is closed.
- **The CLI binary is literally `obsidian`** (not `obsidian-cli`; that is a *skill*
  title). It exposes the live-verify verbs `dev:dom`, `dev:errors`,
  `dev:screenshot`, `dev:console`. `AGENTS.md`'s Verification section gains a
  "Deploy & live-verify" subsection naming the binary and the command, and the
  passive line-62 clause is rewritten to an active deploy MUST.

## Rejected Options

- **Rely on `npm run health:audit -- --live` alone** — it asserts only
  version-string parity (`notidianHealthAudit.js`), is framed as a skippable health
  claim, and performs no deploy: it can flag a stale deploy on a version bump but
  never lands the build and misses same-version content changes.
- **Put the rule only in `AGENTS.md` / `Standards.md` with no one-command deploy** —
  read-discipline alone did not fix the recurrence (the verified skill-non-invocation
  + three-manual-acts friction is what failed); structural friction removal (one
  command) + a fail-loud gate is load-bearing.
- **Edit the upstream marketplace obsidian-cli skill** (`kepano/obsidian-skills`) as
  the durable home — clobbered on update, and not the copy the harness loads.

## Consequences

- A never-landed **or** stale-content build now fails loud at deploy time via
  byte-hash parity, instead of passing silently — even with no version bump.
- Three skip-prone manual acts (build / install / reload) collapse into one
  falsifiable command, removing the friction that produced the lagging catch-up
  commits.
- The literal binary name `obsidian` and the live-verify verbs are recorded in a
  read-at-need surface (`AGENTS.md`), inoculating the wrong-name guess even before
  the proposed global Standards rule / enforcement hook land.
- `deploy:vault` requires Obsidian open for the reload/verify legs; with it closed
  the install still happens and the command exits non-zero with a clear message
  (the build loads on next Obsidian start).

## Related

- `scripts/notidianDeployToVault.js`, `package.json` `deploy:vault`, `AGENTS.md`
  "Deploy & live-verify".
- Atlas Vault `Agent Context/Standards.md` — the global "resolve a capability
  through its skill, never guess the binary from the skill's name" rule (proposed
  separately; the sibling of the wrong-name failure mode).
- [ADR 0017](0017-explicit-notidian-ownership.md) — authority/ownership context.
