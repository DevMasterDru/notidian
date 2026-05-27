# Notidian-Only Personal Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Return Notidian to a personal, Notidian-only database architecture while preserving canonical file/frontmatter safety work.

**Architecture:** Notidian is the only database engine/interface. Markdown files are rows, file paths/basenames own titles, frontmatter owns ordinary properties, and context MDB owns view state plus explicit Notidian/legacy state. Native Bases is not a runtime dependency, compatibility pillar, or roadmap target.

**Tech Stack:** TypeScript, React, Obsidian plugin APIs, Markdown/frontmatter, Make.md context MDB infrastructure, Jest, Obsidian CLI, Notidian real-vault harness.

---

## Phase 0: Bases Runtime Removal

- [x] Add a regression test that fails while Notidian registers or advertises active Bases runtime surfaces.
- [x] Remove custom Bases view registration from `src/main.ts`.
- [x] Remove the `.base` export command from `src/commands.tsx`.
- [x] Delete the `.base` adapter, export modal, custom Bases view source, and their tests.
- [x] Remove `--base-export` and `--base-view` from the real-vault harness interface.
- [x] Remove base-specific real-vault harness tests.

## Phase 1: Architecture Lock

- [x] Add [ADR 0014](../../adr/0014-notidian-only-personal-database-engine.md).
- [x] Mark ADR 0013 as superseded by ADR 0014.
- [x] Update [Current State](../../current-state.md) to describe Notidian-only personal architecture.
- [x] Update [Notidian System Architecture](../../notidian-system-architecture.md) to remove Bases as a system layer.
- [x] Update [ADR README](../../adr/README.md) and [Docs README](../../README.md).
- [x] Mark the previous Notidian-first/Bases-compatible plan as superseded.

## Phase 2: Skill Lock

- [x] Update `/Users/druker/.agents/skills/obsidian-skills/notidian/SKILL.md` so Notidian does not auto-pair with `obsidian-bases`.
- [x] Update `/Users/druker/.agents/skills/obsidian-skills/obsidian-bases/SKILL.md` so it is explicit `.base` work only and not a default Notidian companion.
- [x] Update `/Users/druker/.agents/skills/obsidian-skills/notidian/agents/openai.yaml`.

## Phase 3: Verification

- [x] Run automated verification:

  ```bash
  npm test -- --runInBand scripts/notidianPersonalCore.test.js scripts/notidianRealVaultHarness.test.js
  npm test -- --runInBand
  npx tsc -noEmit -skipLibCheck
  npm run build
  perl -pi -e 's/[ \t]+$//' main.js
  git diff --check
  ```

  Result: focused Notidian-only/harness regression passed, full Jest passed
  (`20` suites, `122` tests), TypeScript passed, production build passed, and
  `git diff --check` reported no whitespace errors.

- [x] If installing into Atlas Vault, run:

  ```bash
  npm run install:vault -- --vault-path="/Users/druker/Atlas Vault" --allow-write
  npm run test:real-vault -- vault="Atlas Vault" --allow-write
  obsidian vault="Atlas Vault" dev:errors
  ```

  Result: installed `manifest.json`, `main.js`, and `styles.css` to the Atlas
  Vault Notidian plugin directory; real-vault smoke passed and cleaned up its
  fixture folder; Obsidian reported `No errors captured.`

## Future Implementation Priority

- [ ] Context-backed table redo.
- [ ] Schema create/rename/delete with frontmatter previews.
- [ ] Row create/delete/move transactions.
- [ ] Richer conflict merge UI.
- [ ] Legacy Make.md write migration.
- [ ] Performance profiling for Atlas Vault folders.
