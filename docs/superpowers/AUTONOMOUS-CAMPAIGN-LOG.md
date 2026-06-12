# Autonomous Notion-Parity Campaign — Log

**Started:** 2026-06-12 (overnight autonomous run)
**Branch:** `autonomous/notion-parity-2026-06-12` (off `main`)
**Driver:** Claude (Opus 4.8), adversarial verification by Codex (`codex exec`)
**Mandate:** Improve Notidian toward Notion-parity, highest quality, fully autonomous, maximize Codex verification spend.

## Operating contract (what I will and won't do)

- All work on this branch, pushed regularly. **No auto-merge to `main`. No auto-install to the live vault.** Left merge-ready for your review + live-verify.
- **Green gates before every commit:** `npx jest` + `tsc -noEmit` + `npm run build` all pass. Never commit red.
- **Adversarial verification each feature** via `codex exec -s read-only` (independent review) + Claude review; only commit after addressing real findings.
- Small atomic commits, one per feature. bd issue per feature (`Notidian-2w0` epic).
- For any UX fork hit while you sleep: pick the **Notion-canonical default**, document it here.

## Your 10-minute review on waking

1. `git log --oneline main..autonomous/notion-parity-2026-06-12` — see every feature commit.
2. Read this log top-to-bottom for decisions + Codex findings.
3. `npm run build && npm run install:vault -- --vault-path="/Users/druker/Atlas Vault" --allow-write` then reload the plugin and live-verify the new features in the Atlas Vault.
4. Merge to `main` when satisfied (your established branch→verify→merge pattern).

## Feature backlog (priority order)

| bd | Feature | Effort | Status |
| --- | --- | --- | --- |
| r20 | Quick find (Ctrl+F highlight + navigate) | S | in progress |
| drv | Per-DB templates on row create | M | queued |
| egz | Type Profile v2 (kind_fields sub-schemas) | M | queued |
| ddk | Inline sort/filter controls in the bar | S | queued |
| 4j7 | Charts / simple data viz | M | queued |
| e6v | Richer date UX + reminders + recurring | M | queued |
| gg9 | Sub-items (frontmatter parent link) | M | queued |
| 7gg | CSV / Markdown import-export | M | queued |
| 9ln | Frontmatter-link relations + rollups | L | queued (sub-epic; cache design first) |
| amx | Bug: drag-select stuck green | S | queued |

Market grounding (2026-06-12 research): Notion's most-requested DB features are row-level permissions, offline, **charts**, and **forms** — of which charts and (loosely) forms apply to a single-user vault; the rest (permissions/offline) are already moot for a local file-backed DB. Relations/rollups/templates/sub-items remain the core parity gap.

## Run log

(Each feature appends: decisions, gates result, Codex findings + resolution, commit hash.)

### r20 — Quick find (Ctrl+F highlight + navigate) — DONE

- **Decisions (you chose, before sleep):** augment (keep filter-search, add find); trigger = Ctrl/Cmd+F + filter-bar `⌕` button; scope = all filtered rows with off-screen reveal; password + hidden columns excluded (no oracle on masked secrets).
- **Units:** `tableQuickFind.ts` (pure, 12 tests) · `QuickFindBar.tsx` · `TableView.tsx` wiring · `FilterBar.tsx` button · `ContextEditorContext` `findOpen` toggle · `TableView.css`.
- **Gates:** 399/399 Jest (+12), tsc clean, build clean.
- **Codex adversarial review (107k tokens):** 4 REAL findings, all fixed before commit —
  1. *HIGH:* find-input keystrokes bubbled into the table shortcut handler (Enter/Backspace/Delete/Cmd+V triggered table actions). → `onKeyDown` stopPropagation on the bar.
  2. *MED:* grouped-table reveal used flat index → group headers desync scroll. → when grouping is active, load all rows so the active cell always renders; +3-frame scroll retry.
  3. *LOW:* nav stepped from the raw (unclamped) index → ordinal/wrap could diverge after edits. → step from the clamped index.
  4. *LOW:* Ctrl/Cmd+F guard caught Shift/Alt variants. → exclude shift/alt.
  Codex confirmed the password/hidden exclusion is sound end-to-end.
- **Commit:** see `git log` (next entry).
- **Live-verify on waking:** open a DB table, Ctrl+F, type → cells highlight, `n/m` + ↑/↓ navigate, off-screen match scrolls into view, password columns never highlight.
