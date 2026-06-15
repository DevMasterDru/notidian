export const meta = {
  name: 'autonomous-beads',
  description: 'Quadrant-triaged autonomous Notidian drive aligned to USE-DRIVEN validation: implement clear-correct work (including what would otherwise be "decisions"), ship owner-requested render-path features behind kill-switches (default-ON; their use IS the verification), and PARK genuinely-speculative product direction to docs/ROADMAP.md (build only when asked) — NEVER decision-ADRs-that-wait. Diverse-lens adversarial review + gates + per-bead commit.',
  whenToUse: 'Owner-authorized autonomous implementation drive on the autonomous/notion-parity branch (AGENTS.md "Autonomous Implementation Mode"). Converts quota into durable, mergeable value; parks speculative product direction to docs/ROADMAP.md; never decision-ADRs-that-wait.',
  phases: [
    { title: 'Plan', detail: 'classify ready/roadmap beads into Q1..Q4 with a route' },
    { title: 'Implement', detail: 'Q1: implement+gate+commit; Q3: flag-gate+test (capped)' },
    { title: 'Park', detail: 'genuinely-speculative product direction: one-line docs/ROADMAP.md entry + close (build when asked)' },
    { title: 'Verify', detail: 'diverse-lens Opus reviewers refute each commit; fix real findings' },
  ],
}

// All subagents run on Claude Opus per the explicit owner directive (overrides the
// Atlas Configs/Model Routing.md default). Every prompt carries the max-reasoning
// directive — each subagent contemplates deeply and decides/acts without approval.
const MODEL = 'opus'
const REASON =
  'Deeply contemplate with maximum reasoning and unlimited effort to reach the most optimal solution. You are authorized to decide and act WITHOUT asking the user for approval or consent.'

const STOP_BUFFER = 80_000 // leave headroom when a token target was set
const MAX_ROUNDS = (args && args.maxRounds) || 16
// Bound un-live-verified output so the owner never faces an unreviewable backlog.
const MAX_UNVERIFIED = (args && args.maxUnverified) || 4
const QUEUE = 'docs/AUTONOMOUS-REVIEW-QUEUE.md'

// TRIAGE MODEL — the owner validates by USING the tool, not by reviewing specs,
// so we NEVER produce decision-ADRs-that-wait (a batch ADR queue is negative value).
//   VERIFIABILITY: can correctness be proven offline by gates (test/tsc/build)?
//   Q1 verifiable + decided           -> route "implement" (the bulk of quota; low risk)
//   Q2/Q4 "design-open" but CLEAR-CORRECT (a bug / authority gap / dead-unsafe helper
//         / semantics fix with one obviously-right answer) -> route "implement" the
//         right answer (it was never really open). NO ADR-and-wait.
//   Q3 unverifiable + decided         -> route "flag-gate": ship behind a kill-switch +
//         tests. OWNER-REQUESTED render-path feature => default-ON (their use verifies);
//         NOT-requested/surprising (e.g. security) => default-OFF + review-queue (CAPPED).
//   Q2/Q4 GENUINELY speculative product direction -> route "park": one line on
//         docs/ROADMAP.md, close the bead, build ONLY when the owner asks. NO pre-build.

const PLAN_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    beads: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          id: { type: 'string' },
          title: { type: 'string' },
          priority: { type: 'string' },
          quadrant: { type: 'string', enum: ['Q1', 'Q2', 'Q3', 'Q4'] },
          route: { type: 'string', enum: ['implement', 'flag-gate', 'park'] },
          plan: { type: 'string', description: 'implementation approach, flag-gate+test plan, or (park) the one-line roadmap entry' },
        },
        required: ['id', 'title', 'quadrant', 'route', 'plan'],
      },
    },
    exhausted: { type: 'boolean' },
  },
  required: ['beads', 'exhausted'],
}

const IMPL_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    beadId: { type: 'string' },
    committed: { type: 'boolean' },
    commitSha: { type: 'string' },
    gatesPassed: { type: 'boolean' },
    flagGated: { type: 'boolean' },
    summary: { type: 'string' },
    notes: { type: 'string' },
  },
  required: ['beadId', 'committed'],
}

const REVIEW_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          severity: { type: 'string' },
          title: { type: 'string' },
          detail: { type: 'string' },
          mustFix: { type: 'boolean' },
        },
        required: ['title', 'mustFix'],
      },
    },
  },
  required: ['findings'],
}

const planPrompt = (attempted, capReached) => `You are the PLANNER + TRIAGE for an autonomous Notidian drive. Read AGENTS.md ("Autonomous Implementation Mode") first. ${REASON}

The owner validates by USING Notidian, not by reviewing specs — so NEVER route work to a decision-ADR-that-waits. Assign each bead a route:
- "implement" — Q1 (offline-verifiable + decided) OR Q2/Q4 that is CLEAR-CORRECT (a bug, an authority/consistency gap, a dead/unsafe helper, a semantics fix with one obviously-right answer). It was never really design-open: build the right answer (tested + reviewed).
- "flag-gate" — Q3 (correct core render-path change you can't live-test): ship behind a kill-switch + offline tests. Owner-requested => default-ON (their use verifies it); not-requested/surprising (e.g. security) => default-OFF + review-queue.
- "park" — GENUINELY speculative product direction (no clear-correct answer, owner has not asked): a one-line docs/ROADMAP.md entry, then close the bead; build only when asked. Do NOT write an ADR, do NOT pre-build.

Steps:
1. \`bd ready\` + \`bd show <id>\`. EXCLUDE already-attempted ids: ${JSON.stringify(attempted)}.
2. ${capReached ? 'The un-live-verified CAP is reached: do NOT propose any default-OFF "flag-gate" beads this round; prefer "implement" and "park".' : 'Flag-gate beads are allowed but scarce — prefer "implement" and "park".'}
3. If fresh "implement" work is thin, FIRST prefer DEPTH beads that are pure Q1 and a safe infinite quota sink: expand test coverage / add adversarial+property tests (esp. on authority + sanitize.ts surfaces), and small correctness/refactor hardening — create them via \`bd create\` if needed. Only THEN consider the Notion-parity roadmap \`bd show Notidian-2w0\` — route any clear-correct piece to "implement", the rest to "park" (NEVER "decision").
4. Return at most 4 beads. Return beads:[] and exhausted:true only if there is genuinely nothing left to implement or test-harden (parking is not "work left" — park aggressively).`

const implPrompt = (b) => `Implement Notidian bead ${b.id}: "${b.title}" (quadrant ${b.quadrant}, route ${b.route}). Approach: ${b.plan}
${b.route === 'flag-gate' ? `THIS IS A FLAG-GATE (Q3) BEAD — a core render-path / not-offline-verifiable change. You MUST: gate it behind a NEW default-OFF setting so it cannot affect the owner's current vault; cover it with comprehensive unit/jsdom tests; and APPEND an entry to ${QUEUE} (what to live-verify, how to enable). Never ship an untested core-render change that is not flag-gated.` : 'THIS IS A Q1 BEAD — fully offline-verifiable and design-closed.'}

${REASON}

Working dir is the Notidian repo. Steps: (1) \`bd update ${b.id} --claim\`. (2) Read AGENTS.md, relevant code, ADRs, and \`bd memories <keyword>\`; respect the authority model (file/frontmatter canonical; durable MDB ownership needs explicit source:"notidian") and route any vault-content innerHTML/SVG/iframe sink through src/shared/utils/sanitize.ts. (3) Implement the most optimal solution + tests. (4) GATES must be green — fix until so: \`npm test -- --runInBand\`, \`npx tsc -noEmit -skipLibCheck\`, \`npm run build\`. (5) Commit \`type(scope): summary — ${b.id}\` (NOTE: ${b.id} already includes the \`Notidian-\` prefix — do NOT add another) + body + \`Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>\`; \`git push\`. (6) \`bd close ${b.id}\` with evidence; \`bd remember\` insights; \`bd create\` follow-ups.
If you cannot complete it safely, set committed=false with notes and leave the working tree CLEAN (revert). Return {beadId, committed, commitSha, gatesPassed, flagGated, summary, notes}.`

const parkPrompt = (b) => `Bead ${b.id}: "${b.title}" is GENUINELY speculative product direction (quadrant ${b.quadrant}) — the owner has NOT asked for it and there is no single clear-correct answer. Building it (or writing a decision-ADR-that-waits) is negative value: the owner validates by USING the tool, not by reviewing specs. So PARK it. ${REASON}

Scope: ${b.plan}

Working dir is the Notidian repo. Steps: (1) \`bd update ${b.id} --claim\`. (2) Append ONE concise line to docs/ROADMAP.md (create it with a "# Notidian Roadmap (pull when wanted)" header + a "## Parked — build when the owner asks" section if missing): the feature name + a one-line scope + a grounding pointer (file/ADR). NO options, NO recommendation, NO essay. (3) If a stale Proposed ADR for this already exists in docs/adr/, leave it as reference — do NOT write a new one. (4) Commit \`docs(roadmap): park <topic> — ${b.id}\` (NOTE: ${b.id} already includes the \`Notidian-\` prefix — do NOT add another) + Co-Authored-By footer; \`git push\`. (5) \`bd close ${b.id}\` with reason "parked to docs/ROADMAP.md — build when owner asks". Return {beadId, committed, commitSha, summary, notes}.`

// Diverse-lens review compensates for the absence of cross-model (Codex) critique.
const LENSES = [
  { key: 'correctness', focus: 'Correctness & logic: edge cases, off-by-one, async/await ordering and timing, error paths, null/undefined, data-integrity and round-trip fidelity.' },
  { key: 'authority-security', focus: 'Authority & security model: file/frontmatter canonical, durable MDB ownership needs explicit source:"notidian" (ADR 0001/0014/0017); every vault-content innerHTML/SVG/iframe sink routed through src/shared/utils/sanitize.ts. Hunt for authority leaks, silent MDB persistence, injection bypasses.' },
  { key: 'regression-tests', focus: 'Regression & test adequacy: breaks existing behavior; gates genuinely green; tests meaningful (not asserting buggy behavior, not over-mocked, audit tests flipped to assert correct behavior); coverage adequate; flag-gate truly default-OFF.' },
]

const reviewPrompt = (b, impl, lens) => `Adversarially review commit ${impl.commitSha || 'HEAD'} implementing Notidian bead ${b.id} ("${b.title}"). ${REASON}

YOUR LENS — ${lens.key}: ${lens.focus}
Cross-model review is unavailable, so own this lens rigorously and independently. Default to refuted: assume there IS a defect within your lens and try to prove it. Inspect \`git show ${impl.commitSha || 'HEAD'}\` and the surrounding code; you MAY run \`npm test -- --runInBand\` and \`npx tsc -noEmit -skipLibCheck\` (do NOT build, do NOT modify files). Set mustFix=true ONLY for a genuine defect you can back with evidence; if sound within your lens, return findings:[].`

const fixPrompt = (b, impl, findings) => `Independent reviewers flagged must-fix issues in Notidian bead ${b.id} (commit ${impl.commitSha || 'HEAD'}):\n${JSON.stringify(findings, null, 2)}\n\n${REASON}\n\nWorking dir is the Notidian repo. Verify each finding is real (note false positives + why); fix the real ones; re-run ALL gates green (\`npm test -- --runInBand\`, \`npx tsc -noEmit -skipLibCheck\`, \`npm run build\`); amend or add \`fix(...): ... — ${b.id}\` (NOTE: ${b.id} already includes the \`Notidian-\` prefix — do NOT add another) + the Co-Authored-By footer; \`git push\`.`

// ---- Triaged orchestration loop ----------------------------------------------

const attempted = []
let round = 0
let implemented = 0
let decided = 0
let unverified = 0

while (round < MAX_ROUNDS) {
  round++
  if (budget.total && budget.remaining() < STOP_BUFFER) {
    log(`Budget buffer reached (${Math.round(budget.remaining() / 1000)}k left) — stopping.`)
    break
  }

  phase('Plan')
  const capReached = unverified >= MAX_UNVERIFIED
  const plan = await agent(planPrompt(attempted, capReached), { model: MODEL, schema: PLAN_SCHEMA, label: `plan:round-${round}` })
  let todo = (plan && plan.beads ? plan.beads : []).filter((b) => b && b.id && !attempted.includes(b.id))
  if (capReached) todo = todo.filter((b) => b.route !== 'flag-gate')
  if (!todo.length || (plan && plan.exhausted)) {
    log(`Round ${round}: nothing left to implement/harden — ending. (impl=${implemented}, parked=${decided}, unverified=${unverified}.)`)
    break
  }

  for (const bead of todo) {
    attempted.push(bead.id)
    if (budget.total && budget.remaining() < STOP_BUFFER) break

    if (bead.route === 'park') {
      phase('Park')
      await agent(parkPrompt(bead), { model: MODEL, label: `park:${bead.id}`, phase: 'Park' })
      decided++
      log(`${bead.id}: parked to docs/ROADMAP.md (closed; build when asked).`)
      continue
    }

    if (bead.route === 'flag-gate' && unverified >= MAX_UNVERIFIED) {
      log(`${bead.id}: un-live-verified cap (${MAX_UNVERIFIED}) reached — deferring; left open for the owner.`)
      continue
    }

    phase('Implement')
    const impl = await agent(implPrompt(bead), { model: MODEL, schema: IMPL_SCHEMA, label: `impl:${bead.id}` })
    if (!impl || !impl.committed) {
      log(`${bead.id}: not committed${impl && impl.notes ? ` — ${impl.notes}` : ''}. Flagged; moving on.`)
      continue
    }
    implemented++
    if (bead.route === 'flag-gate' || impl.flagGated) unverified++
    log(`${bead.id}: committed ${impl.commitSha || ''}${bead.route === 'flag-gate' ? ' (flag-gated; +1 review-queue)' : ''} — ${impl.summary || ''}`)

    phase('Verify')
    const reviews = await parallel(
      LENSES.map((lens) => () =>
        agent(reviewPrompt(bead, impl, lens), { model: MODEL, schema: REVIEW_SCHEMA, label: `review:${bead.id}:${lens.key}`, phase: 'Verify' })
      )
    )
    const mustFix = reviews.filter(Boolean).flatMap((r) => r.findings || []).filter((f) => f && f.mustFix)
    if (mustFix.length) {
      log(`${bead.id}: ${mustFix.length} must-fix finding(s) — dispatching fix agent.`)
      await agent(fixPrompt(bead, impl, mustFix), { model: MODEL, label: `fix:${bead.id}` })
    }
  }
}

return { rounds: round, implemented, decided, unverified, attempted }
