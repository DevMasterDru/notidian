# Notidian Agent Guardrails

## Project Operation

Notidian has no repository-wide task tracker. Work is commissioned directly by
the owner; use the current request, `docs/current-state.md`, and accepted ADRs as
the source of truth. Load `docs/ROADMAP.md` only for broad product planning.

The retired Beads tracker and workbench are preserved outside this repository;
see [ADR 0066](docs/adr/0066-retire-beads-product-and-tracker.md). Do not load or
reconnect that archive unless the owner explicitly asks.

## Authority and Safety Invariants

- Respect the authority-partitioned model (ADR 0001/0014/0017): file + frontmatter
  are canonical; durable MDB ownership requires an explicit `source: "notidian"`.
- Route every new vault-content `innerHTML`/`dangerouslySetInnerHTML`/SVG/iframe
  sink through `src/shared/utils/sanitize.ts` (ADR 0017 memory).
- **Core render-path changes that cannot be verified by tsc/jest/build** (e.g.
  `Notidian-vke` frame sinks, `Notidian-8h9` virtualization) ship **behind a flag**
  with comprehensive unit/jsdom tests: default-**ON** with a kill-switch if the
  owner requested the feature (their *use* is the verification — but only after
  you `npm run deploy:vault`, since committed ≠ deployed; see Verification →
  Deploy & live-verify), default-**OFF** until the owner explicitly verifies an
  unrequested change. Never ship an untested core-render change that isn't
  flagged.
- If a change fails its gates twice, stop the correction loop and preserve the
  evidence in the handoff or governing design. Clear or safely isolate its patch
  before selecting unrelated work; never leave a failed broad patch in the shared
  worktree while unrelated implementation continues.

## Current Architecture

Use [docs/current-state.md](docs/current-state.md) and [ADR 0014](docs/adr/0014-notidian-only-personal-database-engine.md) as the current source of truth.

- Notidian is the intended Obsidian database engine/interface for this fork.
- Markdown files own row identity.
- Markdown file paths and basenames own row identity and default titles; a view may project a designated frontmatter property as the row label (ADR 0016).
- Markdown frontmatter owns ordinary editable properties.
- Notidian context MDB stores view state, explicit Notidian-owned fields, legacy state, and advanced Notidian behavior.
- Native Obsidian Bases and `.base` files are not active runtime targets, compatibility pillars, or roadmap assumptions.

## Historical Material

Historical ADRs and `docs/superpowers` records can explain how the system got here, but they do not override ADR 0014 or `docs/current-state.md`. Historical `Notidian-*` issue identifiers are provenance only; they are not an active queue.

## Local Data Hygiene

- Do not inspect or summarize `.worktrees/` unless the user explicitly asks. It contains ignored local worktree snapshots and may not represent active source.
- Do not treat `.trash`, `.base`, `.makemd`, `.space`, or legacy Make.md artifacts in a vault as active Notidian database targets. They are migration clues only unless an explicit migration/recovery task says otherwise.
- New Notidian runtime storage writes should target `.notidian`, not `.makemd` or `.space`.
- `.space` is retired compatibility storage. Use `npm run migrate:space-store -- --vault-path="<vault>"` for a dry-run inventory and `--allow-write` only after reviewing conflicts/backups.
- Runtime vault adapter operations normalize exact legacy storage path segments (`.space` and `.makemd`) to `.notidian`, which prevents detached stale listeners from recreating retired storage roots after plugin updates.
- Do not treat internal `MakeMD*`, `makemd-core`, `mk-*`, `spaces://`, or `.mkit` names as current architecture by themselves. They are fork-lineage or compatibility names unless code also reaches a legacy path, remote host, or data store.

## Verification

### Pre-commit chain

```bash
npm test -- --runInBand
npx tsc -noEmit -skipLibCheck
npm run build
```

### Plugin health

```bash
npm run health:audit -- --live
```

### Deploy & live-verify (owner-facing render-path changes)

**Committed + gates-green is NOT deployed + reloaded + owner-can-see.** `npm run
build` writes `main.js`/`styles.css`/`manifest.json` to the **repo root only** —
it never touches the vault plugin dir, so a feature can pass every gate and still
be invisible to the owner (the recurring "I don't see it" gap; ADR 0051). For any
render-path / owner-facing change, shipping is **incomplete** until the build is
live in the running Obsidian:

```bash
npm run deploy:vault          # build → install → byte-hash parity → reload → dev:errors
npm run deploy:vault -- --verify-only   # FAIL if the vault copy != current build (no writes)
```

The CLI binary is `obsidian`. Use it to confirm a render actually appears:

```bash
obsidian plugin:reload id=notidian      # reload after a manual install
obsidian dev:dom selector=".mk-subitem-add"   # assert an element renders
obsidian dev:errors                     # captured plugin errors
obsidian dev:screenshot path=/tmp/x.png # visual confirmation
```

Requires Obsidian open. See `docs/adr/0051-deploy-and-live-verify-contract.md`.
