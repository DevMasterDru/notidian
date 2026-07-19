# Notidian Project Instructions

## Final Completion Program

For the owner-commissioned all-product completion mission, load
`docs/streams/Notidian Final Completion.md` and epic `Notidian-4qjx` before
selecting work. The explicit mission routing and no-push boundary live on the
epic and its launch packet.

ADR 0064 recovery mode is binding when a failed bead owns uncommitted changes:
decompose and clear or safely isolate that patch before unrelated implementation
resumes. Approval-gated live and owner-decision items are not active
implementation sessions; resolve their explicit gate tranche from Beads.

<!-- BEGIN BEADS INTEGRATION v:1 profile:minimal hash:6cd5cc61 -->
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
   git push
   git status
   ```
5. **Hand off** - Summarize changes, validation, issue status, and any blocked sync/commit/push step

**Critical rules:**
- Explicit user or orchestrator instructions override this Beads block.
- Do not commit or push without clear authority from the active profile or the current user request.
- If a required sync or push is blocked, stop and report the exact command and error.
<!-- END BEADS INTEGRATION -->


## Build & Test

```bash
npm run build                # typecheck + bundle
npm run deploy:vault         # build + install to Atlas Vault + reload
npm test                     # run test suite
```

## Architecture Overview

Notidian is an Obsidian plugin (forked from Make.md) that adds database-style
views to folders via frontmatter. It runs inside Obsidian's Electron renderer
process as a single bundled `main.js` file.

## Build Constraints (CRITICAL)

### Obsidian's `require()` can only resolve host-provided modules

Obsidian plugins run in an Electron renderer whose module paths point to
`/Applications/Obsidian.app/...`, NOT the plugin directory. Any npm package
listed in esbuild's `external` array will emit a bare `require("pkg")` that
fails at runtime with `Cannot find module`.

**Rule:** Only these may appear in `external`:
`obsidian`, `electron`, `@codemirror/*`, and Node.js builtins.

Everything else (mathjs, lodash, date-fns, etc.) MUST be bundled.

The `requireAuditPlugin` in `esbuild.config.mjs` enforces this — the build
fails if an unsafe external `require()` is detected.

### mathjs must be lazy-loaded, not eagerly imported

mathjs is large (~700KB bundled). Eager top-level initialization overwhelms
V8's JIT compiler during plugin load, especially on resource-constrained
startup. Use `import type * as math from 'mathjs'` for types and
`require('mathjs')` inside functions/getters for runtime access. esbuild wraps
bundled modules lazily in CJS format, so the code is present but not executed
until the first `require()` call.

### All indexing runs on the main thread

Web Worker-based indexing was removed (commit cc5d9b9) because structured clone
serialization of large Maps caused renderer crashes. The `Indexer` class now
runs directly on the main thread with a serial drain queue.

## Vault Constraints

### No directory symlinks inside the vault

Obsidian follows symlinks during its initial file crawl, indexing every file
recursively. A symlink to a git repo with node_modules can add tens of
thousands of files and hundreds of MB, causing V8 OOM (heap limit ~4GB).
`userIgnoreFilters` in `app.json` does NOT prevent this — the crawl happens
before filters apply.

**Use stub `.md` files instead of symlinks** to reference external projects.

### OOM recovery

If Obsidian crashes on startup with "last resort" GC messages:
1. Check for symlinks: `find "<vault>" -type l`
2. Clear stale caches: `rm -rf ~/Library/Application\ Support/obsidian/IndexedDB`
3. The vault data is on the filesystem — IndexedDB is only Obsidian's internal cache.
