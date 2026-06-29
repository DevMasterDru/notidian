# Notidian Agent Guardrails

## Long Autonomous Mode (standing authorization)

The repository owner has authorized an **autonomous, multi-agent implementation
drive** on the `autonomous/notion-parity-2026-06-12` branch — the **Long Autonomous
Mode**. It is **active**: a session enters it when the owner says "long autonomous
mode" / "autonomous mode" / "drain quota" / "go" / "continue". Once active, the
rules here override the conservative default in the Beads block; **do not request
approval or consent** for in-scope work (a *current, explicit* owner instruction in
the live session still wins).

**Doctrine lives canonically, not here** (resolve live, never copy) — the practice
(the three routes implement-clear-correct · kill-switch-ship · park-speculative;
use-driven validation; the diverse-lens review loop; *never* decision-ADRs-that-wait)
is the **Long Autonomous Mode** method:

- Method note: Atlas Vault `Agent Context/Methods/Long Autonomous Mode.md`
- Decision + rationale: Atlas Method repo `docs/decisions/0022-long-autonomous-mode-use-driven.md`
- Engine + how-to: the global `long-autonomous-mode` skill (`~/.agents/skills/long-autonomous-mode/`)

**How to run it (this repo).** Use the global, self-configuring engine — it reads
the binding below and is the **sole** path (the former local
`.claude/workflows/autonomous-beads.js` predecessor was retired once the global
engine was validated on Notidian — bead `Notidian-wj6b`):

```
Workflow({ scriptPath: "~/.claude/skills/long-autonomous-mode/engine.js", args: { model: "opus" } })
```

**This repo's binding (the specifics the engine consumes):**

- **Branch:** `autonomous/notion-parity-2026-06-12` (branch-first if ever on `main`).
- **Model override:** all implementer/reviewer/fix subagents run on **Claude Opus**
  (explicit owner directive — overrides Atlas `Configs/Model Routing.md`), each
  carrying the max-reasoning directive *"deeply contemplate with maximum reasoning
  and unlimited effort… decide and act without asking for approval."*
- **Surfaces:** review-queue `docs/AUTONOMOUS-REVIEW-QUEUE.md`; roadmap `docs/ROADMAP.md`.

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

- **Notion-parity UX** (owner-pulled 2026-06-20) — epic `Notidian-f0pj`, packet
  [docs/streams/notion-parity-ux.md](docs/streams/notion-parity-ux.md): two binding,
  independent session issues (`Notidian-f0pj.1` sub-items creation UX · ADR 0024;
  `Notidian-f0pj.2` rollup partial indicator · ADR 0029 D2), both `runner:sonnet`.
  A fresh session: `bd ready` → claim the top stream issue → read its body + the
  packet → execute within scope → verify → `bd close` with evidence → commit.

- **Filename template mirror** (sessionized 2026-06-30) — epic `Notidian-pay5.1`,
  packet [docs/streams/filename-template-mirror.md](docs/streams/filename-template-mirror.md):
  three dependency-chained sessions (`Notidian-pay5.1.1` template engine + ADR;
  `Notidian-pay5.1.2` auto-rename watcher; `Notidian-pay5.1.3` config UI + first-time
  adoption), all `runner:opus`. Unblocks `Notidian-mx0k` (key-match FK relations).

Status is never copied here — `bd ready`/`bd show <id>` is the live source.

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
