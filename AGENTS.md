# Notidian Agent Guardrails

## Current Architecture

Use [docs/current-state.md](docs/current-state.md) and [ADR 0014](docs/adr/0014-notidian-only-personal-database-engine.md) as the current source of truth.

- Notidian is the intended Obsidian database engine/interface for this fork.
- Markdown files own row identity.
- Markdown file paths and basenames own page titles.
- Markdown frontmatter owns ordinary editable properties.
- Notidian context MDB stores view state, explicit Notidian-owned fields, legacy state, and advanced Notidian behavior.
- Native Obsidian Bases and `.base` files are not active runtime targets, compatibility pillars, or roadmap assumptions.

## Historical Material

Historical ADRs and `docs/superpowers` records can explain how the system got here, but they do not override ADR 0014 or `docs/current-state.md`.

## Local Data Hygiene

- Do not inspect or summarize `.worktrees/` unless the user explicitly asks. It contains ignored local worktree snapshots and may not represent active source.
- Do not treat `.trash`, `.base`, `.makemd`, or legacy Make.md artifacts in a vault as active Notidian database targets. They are migration clues only.
- New root runtime cache writes should target `.notidian`, not `.makemd`.
- `.space` remains the active per-folder compatibility store for context MDB view state until a dedicated migration changes it. Do not treat `.space` as ordinary row data, and do not delete or migrate it opportunistically.
- Do not treat internal `MakeMD*`, `makemd-core`, `mk-*`, `spaces://`, or `.mkit` names as current architecture by themselves. They are fork-lineage or compatibility names unless code also reaches a legacy path, remote host, or data store.

## Verification

Before claiming plugin health, run:

```bash
npm test -- --runInBand
npx tsc -noEmit -skipLibCheck
npm run build
npm run health:audit -- --live
```
