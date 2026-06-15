export const meta = {
  name: 'autonomous-beads',
  description: 'Quadrant-triaged autonomous Notidian implementation with Claude Opus subagents (max reasoning): classify each bead by verifiability x design-closure, implement the safe quadrant, flag-gate the unverifiable (capped), turn design-open work into decision ADRs (never blind builds), drain leftover quota into test/hardening depth. Diverse-lens adversarial review + gates + per-bead commit.',
  whenToUse: 'Owner-authorized autonomous implementation drive on the autonomous/notion-parity branch (AGENTS.md "Autonomous Implementation Mode"). Converts quota into durable, mergeable value + cheap decisions, not speculative blind features.',
  phases: [
    { title: 'Plan', detail: 'classify ready/roadmap beads into Q1..Q4 with a route' },
    { title: 'Implement', detail: 'Q1: implement+gate+commit; Q3: flag-gate+test (capped)' },
    { title: 'Decide', detail: 'Q4/design-open: produce a decision ADR + review-queue entry, no blind build' },
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

// TRIAGE MODEL — two axes decide the route:
//   VERIFIABILITY: can correctness be proven offline by gates (test/tsc/build)?
//   DESIGN-CLOSURE: is the right thing to build already decided (ADR/owner intent)?
//   Q1 verifiable + decided      -> route "implement" (the bulk of quota; low risk)
//   Q3 unverifiable + decided    -> route "flag-gate" (default-OFF + tests; CAPPED)
//   Q2/Q4 design-open (either)   -> route "decision" (ADR + options; NEVER blind-built)
// When uncertain about design-closure, default to "decision" (cheap to review).

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
          route: { type: 'string', enum: ['implement', 'flag-gate', 'decision'] },
          plan: { type: 'string', description: 'implementation approach, flag-gate+test plan, or the decision question + options' },
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

Classify the next batch of work by two axes and assign a route:
- VERIFIABILITY: can correctness be proven OFFLINE by gates (npm test/tsc/build) with no live UI?
- DESIGN-CLOSURE: is the right thing to build already decided (an ADR / clear owner intent / a pure bug-fix)?
Routes: Q1 verifiable+decided -> "implement"; Q3 unverifiable+decided (core render-path) -> "flag-gate" (default-OFF + offline tests); Q2/Q4 design-OPEN -> "decision" (write an ADR with options + recommendation; do NOT build blind). When unsure about design-closure, choose "decision".

Steps:
1. \`bd ready\` + \`bd show <id>\`. EXCLUDE already-attempted ids: ${JSON.stringify(attempted)}.
2. ${capReached ? 'The un-live-verified CAP is reached: do NOT propose any "flag-gate" beads this round; prefer "implement" and "decision".' : 'Flag-gate beads are allowed but scarce — prefer "implement" and "decision".'}
3. If fresh "implement" (Q1) work is thin, FIRST prefer DEPTH beads that are pure Q1 and a safe infinite quota sink: expand test coverage / add adversarial+property tests (esp. on authority + sanitize.ts surfaces), and small correctness/refactor hardening — create them via \`bd create\` if needed. Only THEN, decompose the Notion-parity roadmap \`bd show Notidian-2w0\` — but route those product features to "decision" (ADR), NOT blind "implement".
4. Return at most 4 beads. Return beads:[] and exhausted:true only if there is genuinely nothing left to implement, test-harden, or decide.`

const implPrompt = (b) => `Implement Notidian bead ${b.id}: "${b.title}" (quadrant ${b.quadrant}, route ${b.route}). Approach: ${b.plan}
${b.route === 'flag-gate' ? `THIS IS A FLAG-GATE (Q3) BEAD — a core render-path / not-offline-verifiable change. You MUST: gate it behind a NEW default-OFF setting so it cannot affect the owner's current vault; cover it with comprehensive unit/jsdom tests; and APPEND an entry to ${QUEUE} (what to live-verify, how to enable). Never ship an untested core-render change that is not flag-gated.` : 'THIS IS A Q1 BEAD — fully offline-verifiable and design-closed.'}

${REASON}

Working dir is the Notidian repo. Steps: (1) \`bd update ${b.id} --claim\`. (2) Read AGENTS.md, relevant code, ADRs, and \`bd memories <keyword>\`; respect the authority model (file/frontmatter canonical; durable MDB ownership needs explicit source:"notidian") and route any vault-content innerHTML/SVG/iframe sink through src/shared/utils/sanitize.ts. (3) Implement the most optimal solution + tests. (4) GATES must be green — fix until so: \`npm test -- --runInBand\`, \`npx tsc -noEmit -skipLibCheck\`, \`npm run build\`. (5) Commit \`type(scope): summary — ${b.id}\` (NOTE: ${b.id} already includes the \`Notidian-\` prefix — do NOT add another) + body + \`Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>\`; \`git push\`. (6) \`bd close ${b.id}\` with evidence; \`bd remember\` insights; \`bd create\` follow-ups.
If you cannot complete it safely, set committed=false with notes and leave the working tree CLEAN (revert). Return {beadId, committed, commitSha, gatesPassed, flagGated, summary, notes}.`

const decisionPrompt = (b) => `Bead ${b.id}: "${b.title}" is DESIGN-OPEN (quadrant ${b.quadrant}) — building it blind would gamble quota on possibly-wrong product direction. Do NOT implement it. Instead produce a cheap-to-review DECISION for the owner. ${REASON}

Decision question / scope: ${b.plan}

Working dir is the Notidian repo. Steps: (1) \`bd update ${b.id} --claim\`. (2) Investigate the relevant code/ADRs/vault reality to ground the options. (3) Write a focused ADR in docs/adr/ (next number; Status: Proposed) capturing: the question, 2-3 concrete options with trade-offs, a clear recommendation (one-line why), and ruled-out alternatives. Optionally implement a MINIMAL spike behind a default-OFF flag if it materially de-risks the decision. (4) APPEND an entry to ${QUEUE} (the ADR link + the one decision you need from the owner). (5) Commit \`docs(adr): scope <topic> (Proposed) — ${b.id}\` (NOTE: ${b.id} already includes the \`Notidian-\` prefix — do NOT add another) + Co-Authored-By footer; \`git push\`. (6) \`bd update ${b.id}\` with a note that it awaits an owner decision (do NOT close it). Return as much as fits {beadId, committed, commitSha, summary, notes}.`

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
    log(`Round ${round}: nothing left to implement/harden/decide — ending. (impl=${implemented}, decisions=${decided}, unverified=${unverified}.)`)
    break
  }

  for (const bead of todo) {
    attempted.push(bead.id)
    if (budget.total && budget.remaining() < STOP_BUFFER) break

    if (bead.route === 'decision') {
      phase('Decide')
      await agent(decisionPrompt(bead), { model: MODEL, label: `decide:${bead.id}`, phase: 'Decide' })
      decided++
      log(`${bead.id}: decision ADR produced (awaiting owner).`)
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
