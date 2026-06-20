# Audit regression tests

These tests originated in the 2026-06-11 optimality audit
(`docs/audits/notidian-optimality-audit.md`). Each one reproduces a CONFIRMED
bug using the **real** call wiring (the actual `executeTableValueWrites`,
`createTableUndoEntry`, `executeBulkPageTitleRename`, `links`, `parseValue`,
etc.) — no mocked-away internals.

They began as **characterization tests** asserting the *current, incorrect*
behavior. **Every listed bug is now fixed**, so each test has been flipped to
assert the *intended* behavior and now locks in the fix and guards against
regression. (If a future audit adds a test for a bug that is not yet fixed,
keep it as a characterization test asserting the current behavior, with a clear
comment and the intended behavior described, until the fix lands — then flip it.)

| File | bd issue | Bug (now FIXED → regression-guarded) |
| --- | --- | --- |
| c1-undo-stale-overwrite.audit.test.ts | Notidian-29g | Undo/redo overwrote newer external frontmatter |
| c2-undo-wrong-row.audit.test.ts | Notidian-sck | Undo after row reorder wrote the wrong file |
| codex-c3-concurrent-snapshot-loss.audit.test.ts | Notidian-lg1 | Concurrent context-owned edits lost writes |
| b-rename.audit.test.ts | Notidian-lrf, Notidian-79s | Rename reported success on failure; bulk partial failure |
| a1-sync-leak.audit.test.ts | Notidian-gjc, Notidian-2j3 | syncContextRow persisted YAML into MDB (mixed contexts) |
| codex-yaml-fidelity.audit.test.ts | Notidian-5tl, c37, 7qb, dnx | Link rename / tags / deleteProperty / clear-cell |
| w-write-path-timing.audit.test.ts | Notidian-3dv (w-write-path-timing) | Conflict gate under metadata lag; undo replay; mixed paste retarget |
| write-bridge.audit.test.ts | Notidian-3dv | `applyTableEdits` composition (rename + value + retarget) under metadata lag |

## Write-bridge layer (`Notidian-3dv`)

The pure transaction layer and the rename engine each have focused coverage; the
piece that was previously untested is the **bridge** the React provider's
`applyTableEdits` performs — composing a bulk page-title rename with the
value-write transaction, retargeting value writes onto the renamed paths,
classifying partial-rename failures, and threading the canonical read through
Obsidian's *lagged* metadata cache. A React provider cannot mount under jest's
`node` environment (the bead's NOTES: a transitive ESM `matchers.js` import), so:

- `__fakes__/fakeObsidianMetadataAdapter.ts` — a narrow fake Obsidian adapter
  modeling **processFrontMatter timing** (file writes now, the cache the bridge
  reads back lags by N `settle()` ticks), **metadataCache.changed ordering**
  (external edits are immediately visible; a lagged save settles over them), and
  **rename side effects** (file moves now, cache + context-row path keys lag;
  configurable rename-failure set modeling the adapter's resolve-null mode). It
  is self-tested in `__fakes__/fakeObsidianMetadataAdapter.test.ts`.
- `__fakes__/applyTableEditsBridge.ts` — a node-runnable extract of the provider's
  `applyTableEdits` that reproduces the exact composition against any
  `superstate`-shaped collaborator, so `write-bridge.audit.test.ts` exercises the
  real bridge code path (real `executeBulkPageTitleRename`,
  `applyTableEditPathOverrides`, `executeTableValueWrites`,
  `runSerializedContextEdit`) without React.

Run: `npx jest src/core/utils/contexts/__audit__/ --runInBand`
