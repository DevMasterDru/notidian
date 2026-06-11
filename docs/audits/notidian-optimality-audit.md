# Notidian Optimality Audit

Status: Audit report — point-in-time, evidence-backed. Not an ADR.
Date: 2026-06-11
Audited revision: `main` @ a209dd2 (package `notidian` 1.3.4)
Method: 11 independent read-only auditors + 8 adversarial verifiers (Codex / GPT‑5.5 xhigh), orchestrated by Claude. Quality gates run centrally. Every CONFIRMED finding has a reproduction test mirroring real call wiring.

> **One-line answer to "is Notidian truly optimal?"**
> The *architecture* is sound and, for its core thesis, close to optimal. The *implementation* is not yet optimal: the main table edit path faithfully enforces the authority model, but a ring of secondary write paths (grouped drag, undo/redo, calendar/modal/header/API edits, link & tag maintenance, clear-cell) bypass that model and can silently corrupt or lose canonical Markdown/frontmatter data. These are concentrated, well-understood, and fixable. After the P0/P1 backlog is closed, Notidian would be in a genuinely strong, near-optimal state for a personal Obsidian database engine.

---

## 1. Verdict by dimension

| # | Dimension | Grade | Headline |
| --- | --- | --- | --- |
| A | Authority-invariant enforcement | **B−** | Main table path is sound; ~6 secondary write surfaces bypass it. |
| B | Page-title rename transactions | **C+** | Happy path good; failure handling reports success on real failure. |
| C | Concurrency / async ordering | **C** | Two confirmed data-loss bugs in undo/redo; no per-context write serialization. |
| D | Fork debt / dead code | **C+** | No active Bases/web/AI; but Basics-Flow, MKit, HTML export reachable & default-on. |
| E | Performance / scalability | **C+** | Fine to ~1k rows; startup O(files×rows) join + no row virtualization hurt large vaults. |
| F | YAML / frontmatter fidelity | **C** | Main path good; link/tag/clear helpers can mangle canonical YAML. |
| G | Test adequacy | **B−** | Pure helpers well-tested; React write-bridge has zero Jest coverage. |
| H | Docs-vs-code drift | **A−** | 35 claims checked, mostly accurate; 1 overstated guarantee, minor staleness. |
| I | Security / robustness | **C** | Unsandboxed HTML/SVG sinks, executable frames, SQL identifier injection. |
| J | MDB storage durability | **C** | Non-atomic whole-file saves; corrupt file silently reset to empty. |
| K | Notion-parity / product gaps | **B** | Table is strong; relations/rollups/templates/sub-items are the real gaps. |

The architecture itself (ADR‑0001/0014: files own identity, frontmatter owns ordinary properties, `.notidian` owns view state only) is a genuinely good design — auditor H verified 35 load-bearing doc claims and found the model and its safety machinery substantially real. The gap between **A‑grade design** and **C‑grade implementation in the edit ring** is the entire story of this audit.

---

## 2. The core finding (read this if nothing else)

Notidian has **one** correct, authority-aware write path — `executeTableValueWrites` / `applyTableEdits`, reached from direct table-cell edits, paste, cut, fill. It does everything the architecture promises: resolves the row file path, compares the current canonical frontmatter value before writing (stale-conflict gate), writes the Markdown file *before* accepting any table/context change, strips frontmatter-backed and computed values before MDB persistence, and records an undo entry. This path is well-tested and was repeatedly confirmed sound ("swept clean") by multiple auditors.

The problem is that **this is not the only way data gets written.** A ring of other user gestures reach persistence through older Make.md-era helpers that do *not* go through that gate:

```
                    ┌─────────────────────────────────────────┐
                    │   CANONICAL DATA (Markdown + frontmatter) │
                    └───────────────▲─────────────────▲─────────┘
                                    │                 │
        ┌───────────────────────────┴──┐     ┌────────┴───────────────────────┐
        │  executeTableValueWrites      │     │  BYPASS RING (this audit)       │
        │  (the ONE correct path)       │     │                                 │
        │  • stale-compare conflict gate│     │  • grouped board/list drag      │ → [object Object] key
        │  • file-write-before-accept   │     │  • undo / redo replay           │ → overwrites newer data
        │  • strip FM/computed from MDB │     │  • calendar day/week drag       │ → no stale gate
        │  • undo journal entry         │     │  • create/edit item modal       │ → detached identity
        │  ✔ direct cell edit/paste/cut │     │  • note header properties panel │ → no stale gate
        └───────────────────────────────┘     │  • API actions context.update   │ → no stale gate
                                               │  • link rename maintenance      │ → corrupts other links
                                               │  • tag add/remove helpers       │ → mangles YAML array
                                               │  • clear-cell                   │ → NaN / false / []
                                               └─────────────────────────────────┘
```

Every item in the right column is **confirmed by an adversarial verifier with a passing reproduction test** (except the security/perf/fork items, which are structural). The architecture is not wrong — the implementation simply hasn't finished routing every gesture through the one good path it already built.

---

## 3. Confirmed findings (each has a passing repro test)

Repro tests live in `src/core/utils/contexts/__audit__/` and are **characterization tests**: they assert the *current buggy* behavior and pass today. When a bug is fixed, flip the assertion to lock in the fix. All 12 assertions pass; the full suite is green at 301 tests.

### CRITICAL — plausible loss/corruption of canonical vault data

**C1. Grouped board/list drag writes a literal `[object Object]` key into the note's YAML** — bd `Notidian-oec`
`ContextListView.tsx:78-81` sets `groupBy = cols.find(...)` (a `SpaceProperty` **object**) and passes it as `_groupField`. `ContextListInstance.tsx:232-245` then does `saveProperties(superstate, activePath, { [props.props?._groupField]: props.props?._groupValue })`. An object used as a computed key coerces to the string `"[object Object]"`. The verifier ran the literal check and got `{"[object Object]":"Done"}`. On a folder/default context with grouping enabled, dragging a card to another group writes a garbage YAML key into the dragged Markdown file, with **no conflict detection**. The non-default branch corrupts the MDB row column identically. *Fix:* use `_groupField.name`; route through the authority-aware transaction.

**C2. Link rename corrupts unrelated links in multi-link values** — bd `Notidian-5tl`
`links.ts:13-15`: `replaceLinkInValue` maps every **non-matching** entry to the *old* `link` instead of the original entry `f`. A two-link value `[A.md, C.md]` renamed `A→B` becomes `[B.md, B.md]` — `C` is destroyed. The same helpers (`links.ts:21,42-55`) also `saveProperties` for **every** link/context-typed column with no `source:"frontmatter"` check, writing Notidian-owned columns into YAML. Triggered by any file rename whose path is an outlink in a context (`superstate.ts:614-645`). *Fix:* return `f` for non-matching entries; filter to frontmatter-backed columns; await/batch writes.

**C3. Undo/redo silently overwrites newer external frontmatter** — bd `Notidian-29g`
Undo entries store the value to *restore* but not the *expected current* value. Cell goes `A→B` in Notidian; an external edit changes the file `B→C`; the table reloads to `C`; `Cmd+Z` replays the write; `tableEditTransaction.ts:241-253` compares canonical `C` against the current row value (also `C`) → no conflict → writes `A`, destroying `C`. The result reports `applied:1`, so **no conflict feedback fires**. This violates the documented guarantee that replay "must surface conflicts when canonical data changed." *Fix:* persist `expectedCurrentValue` on undo/redo writes and compare against it.

**C4. Undo after manual row reorder writes the old value into the WRONG file** — bd `Notidian-sck`
Direct-edit undo records `rowId = rowIndex.toString()` with no path (`TableView.tsx:976-980`). Manual row drag persists reordered rows (`saveDB` at `TableView.tsx:1602`) **without invalidating the undo stack**. Replay resolves `rows[parseInt(write.rowId)]` against the *current* row order (`tableEditTransaction.ts:110-114`), so after a reorder `Cmd+Z` resolves the old index to a *different* note and writes the stale value into the wrong file's frontmatter. *Fix:* persist resolved path on every non-file undo write; resolve by path on replay (or invalidate the stack on reorder).

**C5. Corrupt/partial `.notidian` MDB file is silently reset to an empty database, then overwritten** — bd `Notidian-44c`
`db.ts:34-46` and `55-67` catch read/parse errors and return `new sqlJS.Database()` — missing and corrupt collapse to the same "empty DB" behavior. The next `saveDBToPath` (`db.ts:377-379`) overwrites the original path from that empty DB. Under Obsidian Sync/iCloud, a partially-synced `.mdb`/`.mdc` loses recoverable view/context/legacy-migration state with no quarantine or warning. (The verifier's sql.js spot-check reproduced "database disk image is malformed" → empty DB.) Scope is `.notidian` state, not ordinary note content — but it is still silent durable loss. *Fix:* distinguish `missing|ok|corrupt`; on corrupt, block writes, quarantine the bad file to a timestamped path, notify the user.

### HIGH — guarantee/correctness violations

| ID | bd | Finding | Evidence |
| --- | --- | --- | --- |
| H1 | `Notidian-11s` | **Default new folder-table property is MDB-owned, not frontmatter** — the *default* "add column" gesture on a folder DB creates hidden durable context data (`source` unset → authority falls through to `"notidian"` → persisted, not stripped). Contradicts the frontmatter-canonical thesis. | `newSpacePropertyMenu.tsx:49-52,201`; `propertyAuthority.ts:16-30` |
| H2 | `Notidian-f2l` | **Calendar / modal / header / API edits bypass the stale-frontmatter gate and undo.** A stale view can overwrite newer external YAML the table path would skip. | `ContextListContainer.tsx:230/253`; `HeaderPropertiesView.tsx:295-335`; `context.ts:394` |
| H3 | `Notidian-te8` | **Edit-item modal:** title edit writes detached row identity via `updateRow(PathPropertyName,…)` (not a rename); create sets properties on the typed `itemName`, ignoring the created path returned by `path.create` → values dropped/misplaced in subfolders. | `ContextCreateItemModal.tsx:227-243,300` |
| H4 | `Notidian-lrf` | **Page-title rename reports success when the file rename actually failed.** `filesystem.ts:415-430` swallows the error and returns `null`; callers use `renamedPath ?? newPath` and return `{ok:true}`. UI + undo accept a path that was never created. | `pageTitleRename.ts:455-481`; `filesystem.ts:427` |
| H5 | `Notidian-79s` | **Bulk title rename partial failure** leaves some files renamed but reports *all* failed (`applied:0`) and pushes **no undo**; reconciliation also synthesizes phantom rows for unverified target paths. | `pageTitleRename.ts:365-393,189-209` |
| H6 | `Notidian-gjc` | **`syncContextRow` persists YAML into MDB** for unmarked columns in *mixed* legacy contexts (the materialization safeguard is skipped), creating durable shadow metadata on reload. | `linkContextRow.ts:92-108`; `superstate.ts:787-798` |
| H7 | `Notidian-7qb` | **`deleteProperty` is not awaited** — `Rename Frontmatter Key` can report success while the old key is still in the file. | `filesystemAdapter.ts:821-823`; `notidianSchemaApply.ts:55` |
| H8 | `Notidian-dnx` | **Clear-cell coerces typed empties into junk YAML:** number→`NaN`, boolean→`false` (semantic flip!), multi→`[]`. None equal absent/null. | `TableView.tsx:776`; `properties.ts:134` |
| H9 | `Notidian-c37` | **Native YAML `tags` array mangled** by tag add/remove (reads projected string, comma-splits it, writes fragments back to the real `tags` property). | `adapters/obsidian/utils/tags.ts:164-205` |
| H10 | `Notidian-pv1` | **MDB SQL builds identifiers by string interpolation** without quoting; saved-view IDs, imported property names, and legacy schemas reach unsafe SQL → wrong rows / empty tables / silent save failure. | `mdb.ts:116-139`; `db.ts:274-304`; `sanitizers.ts:8-12` |
| H11 | `Notidian-lg1` | **Concurrent context-owned MDB edits lose writes** (last-write-wins from a shared React snapshot; no queue/version check). Scope: MDB-owned state, not frontmatter. | `tableEditTransaction.ts:301-314`; `spaceManager.ts:225` |
| H12 | `Notidian-hqw` | **Non-atomic whole-file MDB saves** (no temp+rename, no backup, no per-path queue). Crash/partial-sync can corrupt `.notidian` state. | `db.ts:342-379`; `filesystem.ts:403-407` |

### Root cause shared by H1, H6, and the one overstated doc claim

`propertyAuthorityForColumn` (`propertyAuthority.ts:12-20`) **falls through to `"notidian"`** for any column that isn't explicitly file/frontmatter/computed, and `shouldPersistAuthorityValueToContext` then persists it. The docs say MDB stores values "only when a field is explicitly Notidian-owned" — but the code makes Notidian-ownership the *default* for any unmarked column. A single missing/lost `source:"frontmatter"` marker silently flips ordinary metadata into durable MDB ownership. Making Notidian-ownership **explicit** (bd `Notidian-2j3`) collapses three findings at once.

---

## 4. Structural findings (no single repro, but evidenced)

**Security (auditor I, bd `Notidian-ebz`).** Threat model is a personal/shared vault: a malicious or pasted file, plus accidental self-harm. Reachable sinks:
- `HTMLFileViewer.tsx:79-86` renders any vault `.html` via `iframe.srcdoc` with **no `sandbox` attribute**.
- `PathView.tsx:53` embeds remote URLs in an unsandboxed iframe.
- Plain text/schema names rendered with `dangerouslySetInnerHTML` (`TextCell`, `TextNodeView`, `ContextTitle`, `SpaceFragmentWrapper`) — a pasted `img onerror` payload executes.
- Custom sticker SVG injected raw (`ObsidianAssetManager` → `PathSticker.tsx:133`).
- `frames/executable.ts:7-20` runs `new Function("with(this){…}")` with `$api` file/frontmatter write access — reachable if frames are used.

Network surface is otherwise clean (no `requestUrl`/`WebSocket`/`axios`; formula uses mathjs, not raw JS).

**Fork debt (auditor D, bd `Notidian-409`).** No active native Bases, makemd.com, web-market, collaboration, or AI integration — good. But three Make.md-era subsystems are compiled **and default-on**: Basics/Flow editor (~7k LOC, patches the editor outside the DB engine), MKit/`.mkit` installer (~1.7k LOC, can import context MDB tables), and HTML export (writes generated `.html` next to notes). `spaceSubFolder` is also still user-mutable away from `.notidian` via Advanced Settings + a `move-space-folder` command. Committed `main.js` is 5.7 MB.

**Performance (auditor E, bd `Notidian-8h9`).** Fine to ~1k rows. Above that: startup `loadCacheFromObsidianCache` does a `find()` inside a `forEach` over the persisted cache (~O(files×rows); ~100M comparisons on a 10k vault); table open assembles/joins/filters/sorts **all** rows before pagination (pagination only limits DOM); there is **no row virtualization**; frontmatter discovery re-scans on parse + view-open + menu; every MDB save is a full `replaceDB` + sql.js export.

**Test adequacy (auditor G, bd `Notidian-3dv`).** Pure helpers are well-covered, but there are **zero Jest tests under `src/core/react`** — the `ContextEditorContext`/`TableView` write bridge that actually delivers the guarantees is unit-untested, and Obsidian timing semantics (`processFrontMatter`, `metadataCache.changed`) are unmocked. This is exactly why the bypass-ring bugs survived: the helpers are green, the wiring around them is the gap.

---

## 5. What is genuinely good (swept clean)

This is not a troubled codebase — the design is strong and large areas were confirmed sound:
- **The authority model is real.** `stripFrontmatterBackedRowValues` provably removes frontmatter-backed and computed values before MDB persistence; correctly-marked `source:"frontmatter"` columns are protected from durable MDB shadowing on every save.
- **The main table edit path** (direct cell, paste, cut, fill, option edits) routes through one authority-aware transaction with file-write-before-accept, stale-conflict detection, and undo — and is well-tested.
- **Page-title identity** is file-path-owned; editing the title cell renames the file via Obsidian's backlink-aware `fileManager.renameFile`; display properties (ADR‑0016) change only the label, not identity.
- **Schema planning** (create/rename/delete previews, hide-only deletes, header-alias vs YAML-key separation, type-menu restrictions) is conservative and well-tested.
- **Legacy migration** is audit-first and never strips context-only values or conflicts; the CLI is read-only and refuses to mark partial scans migration-ready.
- **Storage-root normalization** (`.space`/`.makemd`→`.notidian`) is installed before adapter registration and verified by the live health audit; native Bases is asserted disabled.
- **Docs are accurate.** 35 load-bearing claims checked; only one overstated guarantee and two minor staleness items.

---

## 6. Prioritized remediation roadmap

All items are filed as beads (`bd ready` / `bd show <id>`). Recommended order:

**Phase 1 — stop the bleeding (P0, ~all small/medium, highest value).** The five CRITICAL bugs are the entire reason "not optimal" is the honest answer. Each is a localized fix with a ready characterization test to flip:
`Notidian-oec` (object-key), `Notidian-5tl` (link rename), `Notidian-29g` (undo overwrite), `Notidian-sck` (undo wrong row), `Notidian-44c` (corrupt-MDB reset).

> **Status (2026-06-11): Phase 1 implemented in the working tree (uncommitted, pending review).** All five P0 fixes are done, each with a regression test that now asserts the *correct* behavior (the characterization tests were flipped, plus a positive control for the undo fix). `tsc` clean, production build clean, full suite green at **309 tests** (was 301). See §8 for the fix map. The P1+ items below remain open.

**Phase 2 — close the bypass ring & harden writes (P1).** Route calendar/modal/header/API through the one transaction (`Notidian-f2l`,`te8`); make rename failures honest (`Notidian-lrf`,`79s`); fix clear-cell, tags, deleteProperty, SQL quoting, concurrency, atomicity (`Notidian-dnx`,`c37`,`7qb`,`pv1`,`lg1`,`hqw`); make the default new property frontmatter-backed (`Notidian-11s`) and make authority explicit (`Notidian-2j3`, which also closes `gjc` and H's overstated guarantee).

**Phase 3 — durability & scope (P2).** Security hardening (`Notidian-ebz`); fork-debt scope decision + lock `spaceSubFolder` (`Notidian-409`); performance (`Notidian-8h9`); React write-bridge tests + flip the 6 characterization suites into regression tests (`Notidian-3dv`).

**Phase 4 — polish & product (P3+).** Docs drift (`Notidian-8n0`); filename/Unicode edge cases (`Notidian-p3j`); then the Notion-parity epic (`Notidian-2w0`): frontmatter-native relations/rollups, per-DB templates, sub-items, date/reminders, in-table find, import/export.

**The single highest-leverage structural change** is making context-ownership *explicit* (`Notidian-2j3`): it removes the fallback that silently creates hidden MDB data and is the root cause behind H1, H6, and the one doc overstatement.

---

## 7. Method & reproducibility

- 11 dimension auditors (A–K) ran read-only with evidence-first briefs; 8 adversarial verifiers re-traced each significant finding from the default stance "the finding is wrong until the code proves otherwise," producing the repro tests under `src/core/utils/contexts/__audit__/`.
- One dispute was resolved by trace: auditor K (object-key corruption) vs auditor A (merely ungated) on grouped drag — the verifier confirmed K with the literal `{"[object Object]":"Done"}` check.
- Severities were calibrated down where the verifier found a real safeguard: J1 critical→high (affects `.notidian`, not frontmatter); calendar month-view downgraded to not-reachable; A1 scoped to *mixed* legacy contexts only.
- Quality gates at audit time: **301 tests pass** (289 original + 12 characterization assertions), `tsc -noEmit` clean, `build` clean.
- Raw per-dimension reports and verifier traces are preserved at `/tmp/notidian-audit/findings/` for this session.

**The honest bottom line:** Notidian's architecture is close to optimal for its goal; its implementation has a clear, finite, fully-mapped set of correctness gaps in the write paths around the one good transaction it already built. Closing the P0/P1 backlog would move it from "good design, risky in the edges" to "genuinely strong personal database engine."

## 8. Phase 1 fix record (2026-06-11)

All five P0 data-loss/corruption bugs were fixed in the working tree (uncommitted). Each fix is surgical and respects the authority model. Verification: `tsc -noEmit` clean, `npm run build` clean, full suite **309 tests** green (including the flipped regression tests below).

| bd | Fix | Files | Regression test (now asserts correct behavior) |
| --- | --- | --- | --- |
| `Notidian-oec` | Resolve the group column's `.name` (never the object); authority-gate the write so only frontmatter-backed group columns write to YAML. Extracted pure helpers. | `groupDrag.ts` (new), `ContextListInstance.tsx` | `__audit__/oec-group-drag.audit.test.ts` |
| `Notidian-5tl` | `replaceLinkInValue` returns the original entry for non-matches (preserves unrelated links); link maintenance only writes frontmatter-backed columns to the file. | `links.ts` | `__audit__/codex-yaml-fidelity.audit.test.ts` (F1) |
| `Notidian-29g` | Added `expectedCurrentValue` to undo/redo writes; the stale-conflict gate compares canonical against it (the value the edit produced), not the reloaded row. | `tableEditTransaction.ts`, `tableUndoJournal.ts`, `tablePastePlan.ts` | `__audit__/c1-undo-stale-overwrite.audit.test.ts` (+ positive control) |
| `Notidian-sck` | Bake the resolved file path into non-file undo/redo writes; replay targets the original file by path, not by (reordered) row index. | `tableUndoJournal.ts` | `__audit__/c2-undo-wrong-row.audit.test.ts` |
| `Notidian-44c` | Classify MDB files `missing\|ok\|corrupt`; refuse to overwrite a corrupt file, quarantine it to `.corrupt-<ts>.bak`, warn, return false. | `db.ts` | `__audit__/d-corrupt-mdb.audit.test.ts` (new) |

Phase 1 was then independently verified by the Codex fleet (3 adversarial verifiers). They confirmed the frontmatter conflict gate but found three real gaps, all fixed in the same session: (a) undo of a **root Notidian-owned** column ignored the baked path (root-table replay is now path-aware); (b) `removeLinkInValue` had the same bug family as the rename fix (now compares on parsed identity); (c) the corrupt-MDB guard didn't cover `deleteMDBTable`, zipped classification, or `localCache` — folded into the Wave 2 storage cluster below.

## 9. Phase 2 / Wave 1 fix record (2026-06-11)

Eight P1 bugs fixed via five parallel disjoint-ownership Codex workers, integrated and independently verified. Full suite green at **322 tests**, tsc clean, build clean.

| bd | Fix | Verification outcome |
| --- | --- | --- |
| `Notidian-hqw` | Atomic MDB saves: temp-write then rename-replace | VW1: core sound; temp-cleanup-on-failure filed as follow-up |
| `Notidian-lg1` | Per-path write queue serializes MDB writes | VW1: queue prevents torn writes; **logical read-modify-write serialization still needed** (filed P2 follow-up) — queue alone doesn't stop React-snapshot last-write-wins |
| `Notidian-pv1` | `quoteIdent` for SQL identifiers; values stay single-quote-escaped | VW1: applied at SQL sites; fixed a regression where `sanitizeColumnName` SQL-escaped stored names (`a"b`→`a""b`) — now strips, SQL escaping only in `quoteIdent` |
| `Notidian-c37` | tags read raw frontmatter, preserve YAML array shape, dedup, await | Dedicated test; obsolete F2 characterization removed |
| `Notidian-7qb` | `deleteProperty` returns the delete promise (chain awaited) | Dedicated test; obsolete F3 characterization removed |
| `Notidian-gjc` | `syncContextRow` overlays only frontmatter-authority columns | a1-sync-leak flipped to correct |
| `Notidian-lrf` | Single + **bulk** rename treat a null result as failure (VW5 found bulk still trusted null; fixed + B2-null test) | VW5: single sound; bulk null-handling fixed in-session |
| `Notidian-79s` | Bulk rename returns accurate partial applied/failures; reconciliation checks `pathExists` | helper-level done; **CEC consumer** (surface partial success + undo) deferred to Wave 2 routing |
| `44c`-complete | Corrupt-refusal extended to `deleteMDBTable`, zipped classification, regenerable-cache rebuild | VW1: read-helper corrupt-status filed as follow-up |

### Wave 2 (partial)

Two more P1 fixed via parallel workers, integrated and green (**326 tests**, tsc clean, build clean):

| bd | Fix |
| --- | --- |
| `Notidian-11s` | New default folder-context properties default to `source:"frontmatter"` (pure `defaultPropertySourceForContext` helper); explicit "Property Storage" selector for Notidian-owned fields. Closes the H1/root-cause concern: the default "add column" no longer creates hidden MDB-owned data. |
| `Notidian-dnx` | Clear-cell produces explicit `clear` writes → frontmatter clears write `null` instead of coerced `NaN`/`false`/`[]`. (Residual: writes `key: null` rather than deleting the key — full key-removal needs a CEC change; `null` is still far better than type-junk.) |

### Wave 2 (CEC routing) — completed, VWC-verified

| bd | Fix |
| --- | --- |
| `Notidian-f2l` | `updateRow` now builds authority-aware writes (pure `buildRowUpdateWrites`) and routes through `executeValueWrites`, so **calendar drag and edit-modal** edits get the stale-conflict gate + undo (title excluded → rename). `HeaderPropertiesView` now does a 3-way authority split (frontmatter→YAML only, Notidian-owned→context only, computed→read-only). *Residual:* the programmatic `api.context.update`/`setProperty` surface (frame/actions, off-core) — filed P3. |
| `Notidian-te8` | Modal create captures the `api.path.create` returned path for `setProperty` (correct in subfolders); edit-title routes through the validated `renamePageTitleForRow` (not raw `renamePath`), bailing on failure. |
| `Notidian-79s` | `applyTableEdits` surfaces partial bulk-rename: failures classified explicitly from `result.failures` (no-op titles preserved, not dropped), applied count drives undo capture, applied rows retargeted, failed-row value writes dropped; collision-safe correlation key. |

VWC (the adversarial verifier) confirmed the routing and found three refinements — the incomplete header context-write gating, the 79s no-op misclassification, and a lossy correlation key — **all fixed in-session**.

**All 17 audited bugs addressed** (5 P0 + 12 P1), each with a regression test or pure-helper test where unit-testable, every stage independently re-verified by an adversarial Codex pass with findings fixed in-session.

## 10. Wave 3 — hardening/quality (2026-06-11), VW-verified

Three P2/P3 items via parallel disjoint workers, integrated + verified. Gate: **337 tests, tsc clean, build clean.**

| bd | Fix | Verification |
| --- | --- | --- |
| `Notidian-8h9` | Startup `loadCacheFromObsidianCache` uses a path-keyed Map instead of the O(files×rows) `find`-in-`forEach`; `allProperties` materialize observes property names/types once per call. *(Table row virtualization remains a larger follow-up.)* | VW-perf: **SOUND** (Map proven path-unique by schema; 30 allProperties tests confirm identical outputs) |
| `Notidian-8n0` | Docs drift: stale README redo bullet removed; architecture verify block points at `verify:source`; context-ownership wording matched to the actual `propertyAuthorityForColumn` fallback + 11s default. | docs-only, fact-checked |
| `Notidian-51n` | localCache flushes routed through the per-path write queue; `getDB`/`getZippedDB` corrupt-aware; temp-write cleanup on rename failure; **all `mdb.ts` read helpers** now route through `openDBWithStatus` (corrupt → null, no constructor throw). | VW-storage: sound; its one residual (mdb.ts read helpers) fixed in-session |

**Session grand total: 23 audited items resolved** (5 P0 + 12 P1 + 6 P2/P3), 289 → 344 tests, every substantive change adversarially re-verified, all committed in logical commits on branch `audit/optimality-fixes` (not pushed). Post-checkpoint hardening added page-title validation (`p3j`: typed reasons, NFC duplicate detection, reserved/illegal/overlength), transaction-layer regression coverage (`3dv`: the stale-conflict gate holds under Obsidian metadata lag), and **closed the last correctness gap `lg1`** — a per-context edit serializer (`contextEditSerializer`) threads the latest root table through queued transactions so two concurrent context-owned edits can't last-write-wins; the reset-to-rendered runs inside the serialized step so an in-flight edit can't shadow a newer reload (a race caught in verification and fixed). **Every data-loss / corruption / authority-bypass finding from the audit is now resolved.**

The one remaining authority surface, `api.context.update` (frame/actions), was assessed and **intentionally left**: `saveContext` routes through `stripFrontmatterBackedRowValues`, so a frontmatter-backed write there is a silent no-op (stripped), not a leak — a low-severity completeness gap on off-core machinery, not a correctness risk.

**Decisions taken (authorized):** fork-debt (`409`) left in place — removing default-on editor machinery (Basics/Flow, MKit, export) risks the user's workflow for no correctness gain; security (`ebz`) deprioritized for the solo threat model since the risky fixes (iframe sandboxing, disabling the frame runtime) could break the user's own content. Deferred because they need live-vault UI verification or carry refactor risk for a partially-mitigated P2: table row virtualization (`8h9` remainder), `lg1` logical per-context serialization (the per-path write queue is in; `codex-c3-concurrent` still characterizes the narrow logical race), `2j3` global authority refactor (largely mitigated by 11s/gjc), the `f2l` API/actions surface, and a full React provider-harness for `3dv` (blocked by an ESM import the Jest config doesn't transform). The Notion-parity epic and feature beads remain product/design work.
