export const meta = {
  name: 'autonomous-beads',
  description: 'Autonomously implement Notidian beads with Claude Opus subagents (max reasoning): plan from bd ready / the Notion-parity roadmap, implement + gate + commit per bead, adversarially verify, loop until dry or quota-bound.',
  whenToUse: 'Owner-authorized autonomous implementation drive on the autonomous/notion-parity branch (see AGENTS.md "Autonomous Implementation Mode"). Drains quota by building as much of Notidian as possible at high quality.',
  phases: [
    { title: 'Plan', detail: 'bd ready; decompose Notidian-2w0 roadmap into scoped beads when thin' },
    { title: 'Implement', detail: 'one Opus subagent per bead: implement + gates + commit + push + bd close' },
    { title: 'Verify', detail: 'independent Opus reviewers refute each commit; fix real must-fix findings' },
  ],
}

// All subagents run on Claude Opus per the explicit owner directive (overrides the
// Atlas Configs/Model Routing.md default). Every prompt carries the max-reasoning
// directive — it is each subagent's responsibility to contemplate deeply and reach
// the optimal solution, deciding and acting without asking for approval.
const MODEL = 'opus'
const REASON =
  'Deeply contemplate with maximum reasoning and unlimited effort to reach the most optimal solution. You are authorized to decide and act WITHOUT asking the user for approval or consent.'

// Stop buffer: when a token target was set (e.g. "+500k"), leave headroom so an
// in-flight bead can finish. With no target, budget.remaining() is Infinity.
const STOP_BUFFER = 80_000
const MAX_ROUNDS = (args && args.maxRounds) || 16

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
          plan: { type: 'string', description: 'concrete implementation approach' },
          needsLiveVerification: { type: 'boolean' },
          liveVerificationStrategy: { type: 'string', description: 'flag-gate + test plan if live verification is needed' },
        },
        required: ['id', 'title', 'plan', 'needsLiveVerification'],
      },
    },
    exhausted: { type: 'boolean', description: 'true only when no implementable beads remain and the roadmap is fully decomposed' },
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

const planPrompt = (attempted) => `You are the PLANNER for an autonomous Notidian implementation drive. The repo working dir is the Notidian plugin; read AGENTS.md ("Autonomous Implementation Mode") first. ${REASON}

Produce the next batch of beads to implement NOW:
1. Run \`bd ready\` and \`bd show <id>\` as needed.
2. EXCLUDE these already-attempted ids: ${JSON.stringify(attempted)}.
3. Rank by user value and priority (P0..P4). For a bead that changes the core render path and cannot be verified by tsc/jest/build, set needsLiveVerification=true and give a liveVerificationStrategy (default-OFF flag + unit/jsdom tests).
4. If FEWER THAN 2 fresh implementable beads remain, decompose the Notion-parity roadmap — \`bd show Notidian-2w0\` — into 2-4 concrete, scoped, file/frontmatter-authority-respecting beads via \`bd create\` (type=feature/task, priority set), and INCLUDE the new ids. This drive is open-ended: keep building Notidian toward Notion parity.
5. Only if there is genuinely nothing left to implement or create, return beads:[] and exhausted:true.

Return at most 4 beads.`

const implPrompt = (b) => `Implement bead ${b.id}: "${b.title}". Approach: ${b.plan}${b.needsLiveVerification ? `\nLIVE-VERIFICATION BEAD — implement behind a default-OFF setting flag with comprehensive unit/jsdom tests; strategy: ${b.liveVerificationStrategy || 'flag-gate + tests'}. Never ship an untested core-render change that is not flag-gated.` : ''}

${REASON}

Working dir is the Notidian repo. Steps:
1. \`bd update ${b.id} --claim\`.
2. Read AGENTS.md, the relevant code, ADRs (docs/adr), and \`bd memories <keyword>\` for the area. Respect the authority-partitioned model (file+frontmatter canonical; durable MDB ownership requires explicit source:"notidian") and route any new vault-content innerHTML/SVG/iframe sink through src/shared/utils/sanitize.ts.
3. Implement the most optimal solution; add/extend tests (jsdom via the /** @jest-environment jsdom */ docblock when DOM is needed).
4. GATES must all pass — fix until green: \`npm test -- --runInBand\`, \`npx tsc -noEmit -skipLibCheck\`, \`npm run build\`.
5. Commit per bead: \`type(scope): summary — Notidian-${b.id}\`, body explaining why + evidence, ending with \`Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>\`. Then \`git push\`.
6. \`bd close ${b.id}\` with an evidence-bearing reason; \`bd remember\` durable insights; \`bd create\` follow-ups for discovered work.

If you cannot complete it safely, set committed=false with notes and ensure the working tree is CLEAN (revert your changes) so the next bead starts fresh. Return {beadId, committed, commitSha, gatesPassed, summary, notes}.`

const reviewPrompt = (b, impl, idx) => `Adversarially review the latest commit (${impl.commitSha || 'HEAD'}) implementing Notidian bead ${b.id} ("${b.title}"). You are skeptic #${idx + 1}. ${REASON}

Default to refuted: actively hunt for a real correctness bug, an authority/security-model violation (ADR 0001/0014/0017; sanitize.ts sinks), a broken or skipped gate, a missing test, or a regression. Inspect the diff with \`git show ${impl.commitSha || 'HEAD'}\` and read the surrounding code; you MAY run \`npm test -- --runInBand\` and \`npx tsc -noEmit -skipLibCheck\` (do NOT run the build and do NOT modify files). Report findings; set mustFix=true ONLY for a genuine defect you can back with evidence. If the change is sound, return findings:[].`

const fixPrompt = (b, impl, findings) => `Independent reviewers flagged must-fix issues in Notidian bead ${b.id} (commit ${impl.commitSha || 'HEAD'}):\n${JSON.stringify(findings, null, 2)}\n\n${REASON}\n\nWorking dir is the Notidian repo. For each finding: verify it is real (a false positive needs no code change — note why). Fix the real ones, re-run ALL gates green (\`npm test -- --runInBand\`, \`npx tsc -noEmit -skipLibCheck\`, \`npm run build\`), then amend or add a commit (\`fix(...): ... — Notidian-${b.id}\` + the Co-Authored-By footer) and \`git push\`.`

// ---- Orchestration loop -------------------------------------------------------

const attempted = []
let round = 0
let implemented = 0

while (round < MAX_ROUNDS) {
  round++
  if (budget.total && budget.remaining() < STOP_BUFFER) {
    log(`Budget buffer reached (${Math.round(budget.remaining() / 1000)}k left) — stopping.`)
    break
  }

  phase('Plan')
  const plan = await agent(planPrompt(attempted), { model: MODEL, schema: PLAN_SCHEMA, label: `plan:round-${round}` })
  const todo = (plan && plan.beads ? plan.beads : []).filter((b) => b && b.id && !attempted.includes(b.id))
  if (!todo.length || (plan && plan.exhausted)) {
    log(`Round ${round}: no fresh implementable beads — ending drive. (${implemented} bead(s) implemented total.)`)
    break
  }

  for (const bead of todo) {
    attempted.push(bead.id)
    if (budget.total && budget.remaining() < STOP_BUFFER) break

    phase('Implement')
    const impl = await agent(implPrompt(bead), { model: MODEL, schema: IMPL_SCHEMA, label: `impl:${bead.id}` })
    if (!impl || !impl.committed) {
      log(`${bead.id}: not committed${impl && impl.notes ? ` — ${impl.notes}` : ''}. Flagged; moving on.`)
      continue
    }
    implemented++
    log(`${bead.id}: committed ${impl.commitSha || ''} — ${impl.summary || ''}`)

    phase('Verify')
    const reviews = await parallel(
      [0, 1, 2].map((i) => () =>
        agent(reviewPrompt(bead, impl, i), { model: MODEL, schema: REVIEW_SCHEMA, label: `review:${bead.id}:${i}`, phase: 'Verify' })
      )
    )
    const mustFix = reviews
      .filter(Boolean)
      .flatMap((r) => r.findings || [])
      .filter((f) => f && f.mustFix)
    if (mustFix.length) {
      log(`${bead.id}: ${mustFix.length} must-fix finding(s) — dispatching fix agent.`)
      await agent(fixPrompt(bead, impl, mustFix), { model: MODEL, label: `fix:${bead.id}` })
    }
  }
}

return { rounds: round, attempted, implemented }
