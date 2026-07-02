# Stream packet — Correctness-audit fixes

Slim orientation index for the 2026-07-02 correctness-audit fix program. Status
lives in beads; decisions in ADRs — this file is pointers only.

## Scope

Fix the 16 verified bugs found by the full correctness audit (analysis epic
`Notidian-u9ao`). Analysis-only until the owner closes the approval gate
(`Notidian-vonm.1`); fixes then proceed session-by-session.

## Links

- Fix epic: `bd show Notidian-vonm` (sessions S0–S5 = `Notidian-vonm.1`–`.6`)
- Audit (discovery) epic: `bd show Notidian-u9ao` — closed with evidence
- All bug issues: `bd list -l correctness-audit-2026-07-02`
- Repo rules + quality gates: `AGENTS.md` (root) — gate suite + deploy & live-verify contract
- Architecture ground truth: `docs/current-state.md` (Guarantees section is the falsification target)
- Runner routing: Atlas Vault `Configs/Model Routing.md` (resolve live)

## Key facts (stable, cited)

- 19 raw findings → 18 unique → 16 verified (2 refuted). 5 of 16 were
  live-reproduced against the running vault (evidence in each bug issue body);
  11 are code-confirmed by adversarial refute-by-default skeptics.
- Bug issue bodies carry root cause, verified failure scenario, live evidence,
  and suggested fix — session briefs point at them via `bd show`, never copy.
- Branch: `autonomous/notion-parity-2026-06-12`. Session order: S1/S2/S3
  independent after S0; S5 blocked by S4 (shared files).
