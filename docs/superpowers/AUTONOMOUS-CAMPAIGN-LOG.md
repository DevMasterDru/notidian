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

### drv — Per-database new-row defaults (Type Profile templates) — DONE

- **Scope (builds on egz):** when a new row is created in a folder-backed database whose hub note declares a Type Profile, seed the new file's frontmatter with each field's declared `value` default (e.g. a new Infrastructure row gets `database: infrastructure`). The richer body-template path already exists (`newTemplateInSpace` copies `space.metadata.template`) and is complementary — defaults apply to the plain "new note" path.
- **Units:** pure `newRowFrontmatterFromProfile(profile)` (2 tests) + `applyNewRowTypeProfileDefaults(superstate, contextPath, filePath)` (resolves hub profile, writes defaults via `saveFrontmatterProperties`, never seeds the hub note). Wired in `newPathInSpace` (the menu/`+` chokepoint you use — `contextCreateUseModal: false`) and the modal path (defaults first, user input overrides).
- **Gates:** 431/431 Jest (+2), tsc clean, build clean.
- **Codex review (~389k tokens):** confirmed no wrong-target / overwrite / timing / re-entrancy bug on the wired paths. 2 REAL completeness gaps (other create paths) —
  1. `newTemplateInSpace` (template-copy path) skips defaults. → **decision, documented:** a configured body template is the authored scaffold; layering schema defaults could overwrite the user's template values, so the template wins.
  2. NoteView + basics UINote force-create paths skip defaults. → **NoteView force-create now wired**; basics UINote (off-core fork debt, Notidian-409, divergent enactor API) documented as a deferred gap.
- **Gates after fixes:** 431/431 Jest, tsc clean, build clean.
- **Live-verify on waking:** add a new row to the Infrastructure database (or any profiled DB) → the new note should open with the schema's default frontmatter (e.g. `database: infrastructure`) already set.

### 7gg — CSV export + CSV core — DONE (import execution split to Notidian-84u)

- **Scope decision (autonomous safety):** shipped CSV **export** (additive single-file write, safe) + the fully-tested CSV **core** (RFC 4180 serialize/parse + `tableToCsv` + `parseCsvToRecords`). The file-creating **import execution** (creates N row files on your real vault) is split to **Notidian-84u** — it needs a preview UI + your live verification before running blind. The import parser is already tested, so 84u is wiring only.
- **Units:** `tableCsv.ts` (pure, 13 tests: quoting, embedded commas/quotes/newlines, CRLF, round-trip, empty rows) + an `Export to CSV` view-options menu item → writes `<db> export.csv` in the space folder from visible columns + filtered rows.
- **Gates:** 427/427 Jest (+13), tsc clean, build clean.
- **Codex review (~210k tokens):** 6 REAL findings, all fixed —
  1. *HIGH:* `createItemAtPath(…, "csv", …)` had no adapter → silently wrote nothing while reporting success. → switched to `spaceManager.writeToPath(path, csv)` (→ `writeTextToFile`), the correct API (verified by reading the adapter).
  2. *MED:* virtual `spaces://` paths (tag/builtin spaces) aren't real folders. → export gated to folder-backed databases.
  3. *MED:* used raw `cols` + only `colsHidden`. → now respects `colsOrder` (display order) and `colsHidden`; name sanitized for path safety.
  4. *MED:* parser silently corrupted malformed quotes. → bare mid-field quotes kept literal; unterminated quote recovered at EOF (+2 tests).
  5. *MED:* `[['']]` round-trips to no data. → documented as intended (export always has a header; import skips empty rows).
  6. *LOW:* no CSV formula-injection mitigation. → documented as an accepted non-mitigation (trusted single-user vault; escaping would corrupt the user's own values).
- **Gates after fixes:** 429/429 Jest, tsc clean, build clean.
- **Live-verify on waking:** open a folder-backed DB → view-options (⋯) → Export to CSV → a `.csv` appears in the folder with the visible columns + filtered rows; reopen it in a spreadsheet to confirm quoting.

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

### amx / ddk — DEFERRED to your live testing

- These are UI-**interaction** bugs/features (drag-select clear semantics; inline sort/filter chips) whose correctness needs live reproduction in Obsidian — a poor fit for autonomous work where I can't verify the fix by interacting. Left for you. (For amx I confirmed `selectCell`→`selectItem` already clears row selection on a normal cell click, so the real defect is in the marquee/outside-click path — needs live repro.)

### egz — Type Profile v2: kind_fields per-kind sub-schemas — DONE

- **Grounded in your real `Atlas Vault/Infrastructure.md`:** common `fields:` + a `kind:` select discriminator + `kind_fields:` mapping each kind value (network-device, daemon, network, mcp-server, credential-reference) to its own sub-schema (e.g. `credential-reference.secret: {kind: password}`).
- **Behavior:** the table shares one column set, so columns = **union** of common fields + every kind's fields, deduped by lowercased name (common wins, then kinds in declaration order). Per-kind groups preserved in `profile.kindFields` for future per-kind templates/validation. New kind mappings: `multi_select`→option-multi, `relation`→link (full rollups land with 9ln), `path`→text. `typeProfileKindForType` now round-trips `option-multi`→`multi_select` (was lossy `select`).
- **Conservative mirror choice (documented):** table→hub mirror still writes to the top-level common `fields:` only; kind-specific schema edits stay hub-authored (the write-back kind would be ambiguous). No duplication/data-loss because materialized columns don't trigger the mirror.
- **Gates:** 406/406 Jest (+7), tsc clean, build clean.
- **Codex review (2 rounds, ~340k tokens):** 3 REAL findings, all fixed —
  1. *HIGH:* mirror wasn't kind_fields-aware → renaming a kind-owned column re-materialized a duplicate on reload. → new `planTypeProfileMirror` routes rename/add-option to the owning map (common `fields` or the specific `kind_fields[kind]`); mirror writes both maps; serializer threads `{fields, kindFields}`.
  2. *MED:* malformed (non-object) `kind_fields` silently dropped. → records an `invalid-field` issue.
  3. *MED:* a name present in BOTH `fields` and a kind only renamed the common copy → stale kind copy resurfaced as a duplicate. → rename now updates every map holding the name.
  Codex confirmed union/dedupe ordering, relation→link, option-multi→multi_select, the collision guard, and the burst-threading are all correct.
- **Gates after fixes:** 414/414 Jest (+15 over v1), tsc clean, build clean.
- **Live-verify on waking:** open the Infrastructure database — columns for every kind's fields (hostname, secret as masked password, aliases as multi-select, etc.) should be present.
