# Notidian Project Instructions

Notidian has no repository-wide task tracker. Use the current owner request,
`docs/current-state.md`, and accepted ADRs; historical issue identifiers are
provenance only.

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
