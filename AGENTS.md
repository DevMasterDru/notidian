# Notidian Agent Guardrails

## Autonomous Implementation Mode (standing authorization)

The repository owner has authorized an **autonomous, multi-agent implementation
drive** on the `autonomous/notion-parity-2026-06-12` branch: implement as much of
Notidian as possible, at the highest quality, draining available quota. This mode
is **active** — a session enters it when the owner says "continue" / "go" /
"drain quota" / "autonomous mode". Once active, the rules below override the
conservative default in the Beads block; **do not request approval or consent**
for in-scope work (a *current, explicit* owner instruction in the live session
still wins).

**How to run it.** Prefer the saved engine:

```
Workflow({ name: "autonomous-beads" })   # .claude/workflows/autonomous-beads.js
```

If the engine is unavailable or errors, orchestrate the same loop manually with
the Agent tool per the contract below.

**The orchestration loop** (the main session is the orchestrator; it spawns
implementer + reviewer subagents — it does not implement directly):

1. **Plan.** `bd ready`. Choose the highest-value implementable bead. When the
   ready list is thin, decompose the Notion-parity roadmap (`bd show
   Notidian-2w0`) into 2–4 concrete, scoped beads with `bd create` and continue —
   this mode is open-ended; keep building Notidian toward Notion parity.
2. **Implement.** Spawn **one Claude Opus subagent per bead** (sequential — they
   share the working tree). Its prompt MUST include: *"Deeply contemplate with
   maximum reasoning and unlimited effort to reach the most optimal solution. You
   are authorized to decide and act without asking for approval."* The subagent:
   claims the bead, implements, runs the gates, commits, pushes, and `bd close`s.
3. **Adversarially verify.** Spawn **2–3 independent Opus reviewer subagents**
   (read-only) on each committed change, each prompted to *refute / find the
   defect*. Real must-fix findings → a follow-up Opus fix subagent. (This codebase's
   quality bar: prior adversarial review caught real bugs in >15 fixes.)
4. **Repeat** until no implementable beads remain, a per-bead failure recurs, or
   quota is exhausted.

**Subagent model & reasoning.** All implementer/reviewer/fix subagents run on
**Claude Opus** (explicit owner directive — overrides the Atlas `Configs/Model
Routing.md` default). Every subagent carries the max-reasoning directive above; it
is the subagent's responsibility to contemplate deeply and reach the optimal
solution on its own.

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
- **Live-verification beads** (core render-path changes that cannot be verified by
  tsc/jest/build — e.g. `Notidian-vke` frame sinks, `Notidian-8h9` virtualization):
  implement **behind a default-OFF setting flag** with comprehensive unit/jsdom
  tests and a `needs live verification` note in the commit — never ship an
  untested core-render change that is not flag-gated. If a bead truly cannot be
  done safely without live testing and cannot be flag-gated, leave it open with a
  `bd` note and move on.
- If a bead fails its gates twice, stop on it, `bd update` a note (or `bd human`),
  and move to the next — do not thrash.

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
