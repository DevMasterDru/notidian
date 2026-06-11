# Audit characterization tests

These tests were produced by the 2026-06-11 optimality audit
(`docs/audits/notidian-optimality-audit.md`). Each one reproduces a CONFIRMED
bug using the **real** call wiring (the actual `executeTableValueWrites`,
`createTableUndoEntry`, `pageTitleRename`, `links`, `parseValue`, etc.).

They are **characterization tests**: they assert the *current, incorrect*
behavior and PASS today. When you fix the corresponding bug, flip the
assertion (the intended behavior is described in each test's comments) so the
test then locks in the fix and guards against regression.

| File | bd issue | Bug |
| --- | --- | --- |
| c1-undo-stale-overwrite.audit.test.ts | Notidian-29g | Undo/redo overwrites newer external frontmatter |
| c2-undo-wrong-row.audit.test.ts | Notidian-sck | Undo after row reorder writes the wrong file |
| codex-c3-concurrent-snapshot-loss.audit.test.ts | Notidian-lg1 | Concurrent context-owned edits lose writes |
| b-rename.audit.test.ts | Notidian-lrf, Notidian-79s | Rename reports success on failure; bulk partial failure |
| a1-sync-leak.audit.test.ts | Notidian-gjc | syncContextRow persists YAML into MDB (mixed contexts) |
| codex-yaml-fidelity.audit.test.ts | Notidian-5tl, c37, 7qb, dnx | Link rename / tags / deleteProperty / clear-cell |

Run: `npx jest src/core/utils/contexts/__audit__/ --runInBand`
