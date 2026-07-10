# Notidian Agent Guardrails

## Long Autonomous Mode (standing authorization — mission-gated)

The repository owner has authorized **Mission-Gated Autonomous Development** on the
`autonomous/notion-parity-2026-06-12` branch. A session enters it when the owner
says "long autonomous mode" / "autonomous mode" / "run the mission" / "go" /
"continue" **and a commissioned mission exists** (owner-named scope: a bead list or
epic). Once active, the rules here override the conservative default in the Beads
block; **do not request approval or consent** for in-mission work (a *current,
explicit* owner instruction in the live session still wins). **The drive never
self-commissions**: no mission → ask the owner which mission to run. Quota-draining
/ self-generated tail work is retired (ADR-0065, owner ruling 2026-07-10).

**Doctrine lives canonically, not here** (resolve live, never copy):

- Decision + rationale: Atlas Method repo `docs/decisions/0065-mission-gated-autonomous-development.md` (amends `0022-long-autonomous-mode-use-driven.md` — use-driven validation + the route triage remain)
- Method note: Atlas Vault `Agent Context/Methods/Long Autonomous Mode.md`
- Engine + how-to: the global `long-autonomous-mode` skill (`~/.claude/skills/long-autonomous-mode/`; canonical source: Atlas Method repo `skills/`)

**How to run it (this repo):**

```
Workflow({ scriptPath: "~/.claude/skills/long-autonomous-mode/engine.js", args: {
  mission: { name: "<owner-named mission>", beads: ["Notidian-…"] /* or epicId */ },
  planModel: "opus", gateModel: "opus",     // plan + all gates/reviews (NEVER Fable — see tiering)
  implementModel: "sonnet",                 // T0/T1 worker tier
  t2ImplementModel: "opus",                 // T2: authority-boundary / data-loss / render-path
  securityReviewModel: "opus",              // authority-security lens
  // Codex fallback is default-ON (ADR-0067); set codexFallback:false to disable.
}})
```

**This repo's binding (the specifics the engine consumes):**

- **Branch:** `autonomous/notion-parity-2026-06-12` (branch-first if ever on `main`).
- **Model tiering (owner-ratified 2026-07-10):** **Fable is reserved for the
  interactive orchestrator session — never an engine knob.** Setting
  `planModel`/`gateModel` to Fable fans the flagship across the engine's ~10
  mechanical roles and exhausts its session limit (Model Routing hard-rule #1;
  it killed `run-6` at setup on 2026-07-10). Plan gate, all review lenses, the
  milestone gate, the authority-security lens, and **T2** (authority-boundary /
  data-loss / render-path) implementation run on **Opus**; **T0/T1
  implementation runs Sonnet** — resolved live against Atlas
  `Configs/Model Routing.md`. **Codex fallback (Atlas Method ADR-0067,
  default-ON):** any fallback-eligible verdict role (plan gate, review lenses,
  security lens, live-verify, secret scan, rollup) that returns null retries on
  Codex via a Haiku proxy (`fable`/`opus`→`gpt-5.6-sol`,
  `sonnet`/`haiku`→`gpt-5.6-luna`); disable with `codexFallback:false`. Every
  subagent carries the max-reasoning directive *"deeply contemplate with maximum
  reasoning and unlimited effort… decide and act without asking for approval."*
- **Live-verify harness (the milestone gate drives this):** `npm run deploy:vault`
  (build → install to the Atlas Vault → byte-hash parity → plugin reload →
  `dev:errors`), then the `obsidian` CLI dev commands (`dev:dom`, `dev:screenshot`,
  `dev:errors`, `eval`) to drive every affected user-visible flow in the running
  app with runtime evidence. Requires Obsidian open; unreachable ⇒ the flows become
  manual asks on the run's rollup bead. Committed ≠ deployed — never claim a render
  change verified without deploying first.
- **Surfaces:** review-queue `docs/AUTONOMOUS-REVIEW-QUEUE.md` (a renderer of
  rollup beads, never the record); roadmap `docs/ROADMAP.md`.

**Quality bar (non-negotiable, gate before every commit):**

```bash
npm test -- --runInBand        # all green
npx tsc -noEmit -skipLibCheck  # exit 0
npm run build                  # clean
```

- Commit **per bead**, message `type(scope): summary — Notidian-<id>`, ending with
  `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`; then push.
- `bd close` the bead with an evidence-bearing reason; `bd remember` durable
  insights; file follow-up beads for discovered work.

**Authority & safety invariants (never violate, even autonomously):**

- Respect the authority-partitioned model (ADR 0001/0014/0017): file + frontmatter
  are canonical; durable MDB ownership requires an explicit `source: "notidian"`.
- Route every new vault-content `innerHTML`/`dangerouslySetInnerHTML`/SVG/iframe
  sink through `src/shared/utils/sanitize.ts` (ADR 0017 memory).
- **Core render-path changes that can't be verified by tsc/jest/build** (e.g.
  `Notidian-vke` frame sinks, `Notidian-8h9` virtualization) ship **behind a flag**
  with comprehensive unit/jsdom tests: default-**ON** with a kill-switch if the
  owner requested the feature (their *use* is the verification — but only after
  you `npm run deploy:vault`, since committed ≠ deployed; see Verification →
  Deploy & live-verify), default-**OFF**
  + `docs/AUTONOMOUS-REVIEW-QUEUE.md` if not. Never ship an untested core-render
  change that isn't flagged. If a bead truly can't be done safely and can't be
  flagged, leave it open with a `bd` note and move on.
- If a bead fails its gates twice, stop on it, `bd update` a note (or `bd human`),
  and move to the next — do not thrash.

## Active work streams (resolve live — `bd ready`)

Work state is **never copied here** — which streams are active, which sessions are
open/blocked/closed, and who runs them all drift, so read them live: `bd ready` /
`bd show <id>` for the graph, and the slim orientation packets in
[docs/streams/](docs/streams/) for each stream's scope + typed pointers. A fresh
session: `bd ready` → claim the top ready issue → read its body + the matching
packet → execute within scope → verify → `bd close` with evidence → commit.

Stream packets on file (durable epic pointers only — open vs shipped lives in bd):

- [docs/streams/data-integrity-program.md](docs/streams/data-integrity-program.md) — epic `Notidian-loan`
- [docs/streams/correctness-audit-fixes.md](docs/streams/correctness-audit-fixes.md) — epic `Notidian-vonm`
- [docs/streams/notion-parity-ux.md](docs/streams/notion-parity-ux.md) — epic `Notidian-f0pj`
- [docs/streams/filename-template-mirror.md](docs/streams/filename-template-mirror.md) — epic `Notidian-pay5.1`

## Current Architecture

Use [docs/current-state.md](docs/current-state.md) and [ADR 0014](docs/adr/0014-notidian-only-personal-database-engine.md) as the current source of truth.

- Notidian is the intended Obsidian database engine/interface for this fork.
- Markdown files own row identity.
- Markdown file paths and basenames own row identity and default titles; a view may project a designated frontmatter property as the row label (ADR 0016).
- Markdown frontmatter owns ordinary editable properties.
- Notidian context MDB stores view state, explicit Notidian-owned fields, legacy state, and advanced Notidian behavior.
- Native Obsidian Bases and `.base` files are not active runtime targets, compatibility pillars, or roadmap assumptions.

## Historical Material

Historical ADRs and `docs/superpowers` records can explain how the system got here, but they do not override ADR 0014 or `docs/current-state.md`.

## Local Data Hygiene

- Do not inspect or summarize `.worktrees/` unless the user explicitly asks. It contains ignored local worktree snapshots and may not represent active source.
- Do not treat `.trash`, `.base`, `.makemd`, `.space`, or legacy Make.md artifacts in a vault as active Notidian database targets. They are migration clues only unless an explicit migration/recovery task says otherwise.
- New Notidian runtime storage writes should target `.notidian`, not `.makemd` or `.space`.
- `.space` is retired compatibility storage. Use `npm run migrate:space-store -- --vault-path="<vault>"` for a dry-run inventory and `--allow-write` only after reviewing conflicts/backups.
- Runtime vault adapter operations normalize exact legacy storage path segments (`.space` and `.makemd`) to `.notidian`, which prevents detached stale listeners from recreating retired storage roots after plugin updates.
- Do not treat internal `MakeMD*`, `makemd-core`, `mk-*`, `spaces://`, or `.mkit` names as current architecture by themselves. They are fork-lineage or compatibility names unless code also reaches a legacy path, remote host, or data store.

## Verification

Before claiming plugin health, run:

```bash
npm test -- --runInBand
npx tsc -noEmit -skipLibCheck
npm run build
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

The CLI is the binary **`obsidian`** (NOT `obsidian-cli` — that's a *skill* title;
a single empty `which obsidian-cli` is never proof it's absent; resolve a tool via
its skill — Atlas Standards). Use it to confirm a render actually appears:

```bash
obsidian plugin:reload id=notidian      # reload after a manual install
obsidian dev:dom selector=".mk-subitem-add"   # assert an element renders
obsidian dev:errors                     # captured plugin errors
obsidian dev:screenshot path=/tmp/x.png # visual confirmation
```

Requires Obsidian open. See `docs/adr/0051-deploy-and-live-verify-contract.md`.

<!-- BEGIN BEADS INTEGRATION v:1 profile:minimal hash:970c3bf2 -->
## Beads Issue Tracker

This project uses **bd (beads)** for issue tracking. Run `bd prime` to see full workflow context and commands.

### Quick Reference

```bash
bd ready              # Find available work
bd show <id>          # View issue details
bd update <id> --claim  # Claim work
bd close <id>         # Complete work
```

### Rules

- Use `bd` for ALL task tracking — do NOT use TodoWrite, TaskCreate, or markdown TODO lists
- Run `bd prime` for detailed command reference and session close protocol
- Use `bd remember` for persistent knowledge — do NOT use MEMORY.md files

**Architecture in one line:** issues live in a local Dolt DB; sync uses `refs/dolt/data` on your git remote; `.beads/issues.jsonl` is a passive export. See https://github.com/gastownhall/beads/blob/main/docs/SYNC_CONCEPTS.md for details and anti-patterns.

## Agent Context Profiles

The managed Beads block is task-tracking guidance, not permission to override repository, user, or orchestrator instructions.

- **Conservative (default)**: Use `bd` for task tracking. Do not run git commits, git pushes, or Dolt remote sync unless explicitly asked. At handoff, report changed files, validation, and suggested next commands.
- **Minimal**: Keep tool instruction files as pointers to `bd prime`; use the same conservative git policy unless active instructions say otherwise.
- **Team-maintainer**: Only when the repository explicitly opts in, agents may close beads, run quality gates, commit, and push as part of session close. A current "do not commit" or "do not push" instruction still wins.

## Session Completion

This protocol applies when ending a Beads implementation workflow. It is subordinate to explicit user, repository, and orchestrator instructions.

1. **File issues for remaining work** - Create beads for anything that needs follow-up
2. **Run quality gates** (if code changed) - Tests, linters, builds
3. **Update issue status** - Close finished work, update in-progress items
4. **Handle git/sync by active profile**:
   ```bash
   # Conservative/minimal/default: report status and proposed commands; wait for approval.
   git status

   # Team-maintainer opt-in only, unless current instructions forbid it:
   git pull --rebase
   bd dolt push
   git push
   git status
   ```
5. **Hand off** - Summarize changes, validation, issue status, and any blocked sync/commit/push step

**Critical rules:**
- Explicit user or orchestrator instructions override this Beads block.
- Do not commit or push without clear authority from the active profile or the current user request.
- If a required sync or push is blocked, stop and report the exact command and error.
<!-- END BEADS INTEGRATION -->

<!-- BEGIN BEADS CODEX SETUP: generated by bd setup codex -->
## Beads Issue Tracker

Use Beads (`bd`) for durable task tracking in repositories that include it. Use the `beads` skill at `.agents/skills/beads/SKILL.md` (project install) or `~/.agents/skills/beads/SKILL.md` (global install) for Beads workflow guidance, then use the `bd` CLI for issue operations.

### Quick Reference

```bash
bd ready                # Find available work
bd show <id>            # View issue details
bd update <id> --claim  # Claim work
bd close <id>           # Complete work
bd prime                # Refresh Beads context
```

### Rules

- Use `bd` for all task tracking; do not create markdown TODO lists.
- Run `bd prime` when Beads context is missing or stale. Codex 0.129.0+ can load Beads context automatically through native hooks; use `/hooks` to inspect or toggle them.
- Keep persistent project memory in Beads via `bd remember`; do not create ad hoc memory files.

**Architecture in one line:** issues live in a local Dolt DB; sync uses `refs/dolt/data` on your git remote; `.beads/issues.jsonl` is a passive export. See https://github.com/gastownhall/beads/blob/main/docs/SYNC_CONCEPTS.md for details and anti-patterns.
<!-- END BEADS CODEX SETUP -->
