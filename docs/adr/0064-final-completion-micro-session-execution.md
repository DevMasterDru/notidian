# ADR 0064: Final Completion Uses Direct Dependency-Critical Micro-Sessions

## Status

**Accepted — owner-directed 2026-07-18; recovery-first amendment accepted
2026-07-19.** The owner stopped Run 21 and asked for an optimality
re-evaluation followed by realignment of the remaining Notidian completion
process, then requested a second stop and re-evaluation after observing the
direct process. The exact model split remains unchanged:
`gpt-5.6-sol` at `xhigh` owns orchestration and gates; `gpt-5.6-sol` at
`medium` owns implementation and code fixes.

## Date

2026-07-18

## 2026-07-19 Evidence

The direct design produced five accepted local checkpoints after this ADR,
including bounded filter, reminder, calendar, and CSV units. It therefore
fixed the old transport problem: implementation workers were reached and useful
work was committed.

It did not constrain scope strongly enough once a small stale-index bug exposed
cross-cutting lifecycle defects. The resulting recovery patch reached 60 tracked
and 22 untracked source or test files, with roughly 2,100 tracked additions and
3,700 lines in new source or test files. Two independent reviews reduced the
remaining defects to three bounded findings, but the patch remained dirty and
made the shared checkout's full suite fail on its unfinished test doubles.

The review lane also repeatedly attempted Jest inside a read-only sandbox. Jest
could not create its haste-map or temporary files, so those reviews could inspect
code and run TypeScript but could not supply executable test evidence. Finally,
three Beads remained `in_progress` even though two were fully implemented and
waiting for live approval and the third had not started, making cold-start
selection ambiguous.

## Recovery-First Amendment

### Admit a session before dispatch

The controller admits a normal implementation micro-session only when its
binding brief owns one primary invariant, at most two coupled seams, and an
expected working set of no more than twelve source and test files. The complete
focused test plus repository-gate path must fit one worker context with
headroom. These are stop triggers, not targets: if grounding shows a broader
working set, the controller sessionizes the bead before dispatch.

If a worker's actual diff crosses a third subsystem, exceeds the admitted file
set by more than half, or discovers that the Definition of Done requires a new
architectural prerequisite, it stops and reports the evidence. The controller
does not silently widen the brief.

### Recover a failed dirty patch before unrelated work

Two failed gate or correction cycles still stop that loop. If the bead owns no
uncommitted changes, the controller may select another safe leaf. If it owns a
dirty patch, that patch becomes the repository's recovery lane and blocks
unrelated shared-worktree implementation.

The controller freezes the accepted surface, converts each remaining review
finding into a bounded dependency-ordered recovery session, and runs one
Sol-medium writer per session. A final integrated judgment session reviews the
whole patch, runs the full pre-commit chain, and creates the local commit. The
recovery sessions may share that final commit when splitting the already-coupled
patch into independent green commits would itself add risk. No per-run branch is
created; detached temporary worktrees may be used only for clean verification.

### Make review executable and overlap read-only gates

After the implementation worker stops, the root full-gate run and the
independent Sol-medium adversarial review may run concurrently because neither
is a product writer. The reviewer receives either a clean detached verification
worktree or a workspace-writable sandbox with an explicit no-source-edit rule,
so Jest and its temporary cache can run. A read-only sandbox failure is no
longer treated as test evidence.

The worker runs focused RED/GREEN tests, TypeScript, and diff checks. The root
runs the full repository pre-commit chain once on the candidate. The reviewer
runs the targeted suites or mutations needed to refute the candidate rather
than duplicating the entire full suite.

### Separate implementation, owner decisions, and live verification

Beads in active code work use `in_progress`. Fully implemented work awaiting a
fresh deploy approval is blocked by an explicit live-verification tranche.
Owner-value choices are blocked by an explicit decision tranche with a concrete
recommendation. Neither class remains `in_progress`.

Graph selection discounts a dependency edge whose next node cannot run without
owner authority. It still prepares that path, but it does not call the path an
offline unlock or repeatedly interrupt the owner. Ready live checks are batched
into the smallest safe deploy tranche; independent offline work continues after
the shared worktree is clean.

## Context

The prior Long Autonomous Mode launch shape repeatedly spent orchestration
capacity without reaching implementation:

- Runs 18, 19, and 20 recorded 10, 19, and 2 xhigh Plan Gate role events,
  respectively, and no Build role event.
- Runs 18 and 19 tried to plan broad manifests before implementation. Run 20
  reduced the manifest to five unrelated ready Beads, but its plan transport
  still failed before Build.
- Run 21 failed Setup because known pre-existing local runtime directories made
  a prior-run branch look dirty. The failed setup left a stale mission lock,
  even though no product work or commit existed.
- The outer launcher still used hcom plus a Claude Workflow transport. The live
  model-routing registry retires hcom in favor of direct headless sessions, so
  this added a non-canonical identity, polling, and failure layer.
- The Beads graph contains independent work and several long dependency chains.
  A heterogeneous five-Bead batch does not share a useful working set and does
  not reliably advance the critical path.

The product graph and briefs are already durable in Beads. A second monolithic
planning manifest is therefore duplicate state, not useful context.

## Decision

### One controller and one writer

The active Codex root is the continuous controller. It operates on
`autonomous/notion-parity-2026-06-12` with one implementation worker at a time.
It does not create per-run branches, merge queues, nested orchestrators, or a
second planning manifest.

Before each unit, the controller verifies the branch, tracked diff, active
Bead, and absence of a live mission lock or worker. Known pre-existing local
runtime paths are baseline state rather than an automatic setup failure; any
new or changed path is investigated before work proceeds.

### One Bead per implementation micro-session

Each cycle resolves the live Beads graph, resumes an in-progress
`stream:final-completion` leaf if one exists, or claims one dependency-ready
leaf. Selection favors the leaf that unlocks the highest-priority downstream
chain; raw ready-list order and unrelated batching do not override dependency
criticality.

The xhigh controller reads and strengthens only that Bead's binding brief. It
then launches one direct headless `gpt-5.6-sol` medium worker with the Bead id,
exact scope, repository guardrails, and required evidence. There is no Claude
or hcom proxy and no separate detached Plan Gate. Model invocation details are
resolved live from the Atlas Vault Model Routing registry at every dispatch.

The medium worker changes code and runs focused tests but does not push,
deploy, or expand scope. The xhigh controller reviews the diff, dispatches any
code fix back to a medium worker, runs the repository gates, records evidence,
commits locally, and closes the Bead. Two failed gate/fix cycles trigger a Bead
note and a move to the next safe ready unit rather than thrashing.

### Checkpoint and continuation

Every closed Bead plus its local commit is a restartable checkpoint. Automatic
continuation re-resolves in-progress and ready work from Beads after each
checkpoint; it never replays a static wave list. A transport failure leaves the
Bead and worktree recoverable and does not substitute another model for the
owner-ratified Sol routing.

Cold start now distinguishes active implementation from gates: resume only an
`in_progress` implementation or recovery session. Approval-gated and
owner-decision items resolve through their tranche Beads. If a dirty recovery
lane exists, its first unblocked remediation session outranks every unrelated
ready leaf.

### Offline, live, and cross-repo lanes

Offline-provable implementation continues without a vault deploy. A render or
vault-sensitive Bead may reach `implemented, awaiting live verification`, stay
open with exact evidence and an owner ask, and stop blocking unrelated offline
work. Live-required checks are consolidated into an explicit owner-approved
verification tranche; ADR 0051 still governs what counts as shipped.

Cross-repo leaves execute from their owning repository and return commit and
gate evidence to the Notidian dependency Bead. They are never implemented by
writing across repository boundaries from a Notidian worker.

After all implementation leaves are resolved, the xhigh controller runs the
whole-program review, full repository gates, required live verification, and
the final current-state audit. No push, remote sync, pull request, or live
deployment occurs without the corresponding explicit owner authority.

## Rejected Options

- **Repair and relaunch the broad Workflow mission.** It has repeatedly failed
  before Build, duplicates the Beads graph, and keeps xhigh work ahead of any
  product checkpoint.
- **Keep the five-Bead wave but repair only its transport.** The batch mixes
  unrelated bugs, documentation, and optional harness work. A transport fix
  would not correct its working-set or critical-path inefficiency.
- **Retain hcom as the outer lifecycle wrapper.** The live routing registry has
  retired it, and Run 21 exposed identity ambiguity between the wrapper name
  and the actual Claude process.
- **Require the owner to restart every session manually.** This is durable but
  does not satisfy the commissioned autonomous completion process.

## Consequences

- The first successful unit reaches a medium implementation worker immediately
  after one local xhigh brief check.
- Failures lose at most one Bead-sized unit and cannot invalidate a broad plan.
- The Beads graph, git history, and stream packet remain the only durable state;
  launcher state is disposable.
- Whole-program consistency is checked after incremental gates rather than used
  as a reason to defer all implementation.
- Live-verification authority remains explicit and cannot be hidden by an
  offline green build.
- A broad dirty patch is now an explicit recovery phase, not background noise
  contaminating unrelated tests and commits.
- Reviewer independence no longer implies an environment that prevents the
  reviewer from executing the focused tests it cites.

## Related

- Epic `Notidian-4qjx` and its live dependency graph.
- [Notidian Final Completion](../streams/Notidian%20Final%20Completion.md).
- [ADR 0051](0051-deploy-and-live-verify-contract.md) — deploy and live-verify
  contract.
- Root `AGENTS.md` — safety, model routing, gates, and Beads workflow.
