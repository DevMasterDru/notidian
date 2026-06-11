# Notidian Audits

Point-in-time audit reports. These are **evidence**, not architecture: they describe the state of the code at a moment in time. Durable decisions belong in ADRs; tracked work belongs in `bd`.

## Reports

- [Optimality Audit — 2026-06-11](notidian-optimality-audit.md) — deep multi-agent audit (11 dimensions, adversarially verified) answering "is Notidian truly optimal?" Verdict: strong architecture, a finite and fully-mapped set of correctness gaps in the write paths around the main transaction. All findings filed as `bd` issues (P0/P1 are confirmed data-loss/corruption bugs with reproduction tests).
  - `evidence-2026-06-11/primary/` — raw per-dimension auditor reports (A–K).
  - `evidence-2026-06-11/verifiers/` — adversarial verifier traces and verdicts.

## Reproduction tests

Confirmed findings have characterization tests in `src/core/utils/contexts/__audit__/`. They assert the **current buggy behavior** and pass today; when a bug is fixed, flip the assertion to lock in the fix. Run them with:

```bash
npx jest src/core/utils/contexts/__audit__/ --runInBand
```
