# Stream packet — Data Integrity Program

Slim orientation index for the owner-ratified (2026-07-02) Data Integrity Program.
Status lives in beads; decisions in ADRs — this file is pointers only.

## Scope

Make invalid database states unrepresentable or immediately visible: schema-as-data
(Type Profile v3), write-time validation, an always-on reconciler ("the balance
light"), engine-owned derived fields, durable provenance, and a validated AI write
channel (Atlasidian `db.*`). Enforcement philosophy: guarded write paths where
possible, continuous reconciliation everywhere else.

## Links

- Program design (source of truth for content):
  `docs/superpowers/specs/2026-07-02-data-integrity-program-design.md`
- Ratified ADRs: 0056 (Type Profile v3 schema registry), 0057 (validation core +
  read-only reconciler/health surfaces), 0058 (derived-field authority class)
- Program epic: `bd show Notidian-loan` (sessions S1–S14 = `Notidian-loan.1`–`.14`;
  Wave 1 full briefs, Waves 2–5 skeletal until phase gates close)
- Wave-0 dependency: `bd show Notidian-vonm` (correctness-audit fix program — write-path
  waves gate on its last session)
- Wave-4 anchor: `bd show Notidian-v341` (ADR-0055 template sync — folds in under ADR-0058)
- Problem provenance (consumer side): Gidi repo
  `docs/audits/2026-07-02-notidian-database-governance-audit.md` + epic `Gidi-m1xl`
- Repo rules + quality gates: `AGENTS.md` (root) — gate suite + deploy & live-verify
  contract (ADR-0051)
- Runner routing: Atlas Vault `Configs/Model Routing.md` (resolve live)

## Key facts (stable, cited)

- Pilot/acceptance target: the 7 Gidi hardware registries in the Atlas Vault
  (`Gidi/Hardware/*`, `Gidi/Safety/Fault Registry`) — Wave 1 ends with a judgment
  session that adopts schemas for all 7 and records a go/rework verdict.
- Load-bearing existing machinery (verified 2026-07-02 capability scout): single
  write funnel `src/core/utils/contexts/tableEditTransaction.ts`
  (`executeTableValueWrites`); API authority gate `apiValueWrite.ts` +
  `propertyAuthority.ts` (`computedTypes` never-persisted gate); Type Profiles
  `typeProfile.ts` (+ bidirectional mirror); predicate DSL
  `src/shared/types/predicate.ts` + `predicate/filter.ts`; key-match FK resolver
  `keyMatchResolver.ts`; ADR-0015 schema planner `notidianSchema.ts`.
- Atlasidian currently bypasses all of it (raw `app.vault.modify`) — Wave 3 closes
  this; Atlasidian's MCP server runs in the same Obsidian process (in-process bridge,
  not RPC).
- YAML validity is guaranteed only on funnel-routed writes (`processFrontMatter`
  serializes from the JS object); Notidian does not own YAML text emission.
- Branch: `autonomous/notion-parity-2026-06-12`.
