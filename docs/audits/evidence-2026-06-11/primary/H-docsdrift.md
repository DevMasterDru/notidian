## Claim Table

| # | Claim checked | Verdict | Code evidence |
|---:|---|---|---|
| 1 | `.notidian` is the active runtime storage root and exact `.space` / `.makemd` path segments are normalized. | ACCURATE | `src/shared/pluginIdentity.ts:1-4` defines `pluginStorageRoot = ".notidian"`; `src/shared/pluginIdentity.ts:13-21` replaces legacy path segments; `src/adapters/obsidian/legacyStorageGuard.ts:27-40` wraps adapter file operations. |
| 2 | Existing retired `spaceSubFolder` settings are normalized during plugin load. | ACCURATE | `src/main.ts:169-180` deletes retired sync settings and rewrites legacy roots to `pluginStorageRoot`; `src/main.ts:580-583` applies that before installing the guard. |
| 3 | Migration tool is dry-run by default, copies missing `.space` files, refuses conflicts, rewrites JSON legacy segments, and moves originals to backup. | ACCURATE | `scripts/notidianSpaceStoreMigration.js:5-9`, `51-80`, `237-318`, `396-417` define roots, rewrite exact segments, refuse conflicts, copy with `COPYFILE_EXCL`, and only execute with `--allow-write`. |
| 4 | Plugin identity and plugin data dir are Notidian-owned, not Make.md plugin data. | ACCURATE | `src/shared/pluginIdentity.ts:24-28` builds `.obsidian/plugins/notidian`; `src/main.ts:165-167` uses `pluginDataFilePath("data.json")`. |
| 5 | Page identity/title source of truth is file path/basename, changed through file rename. | ACCURATE | `src/core/utils/contexts/pageTitle.ts:13-42` derives title from basename and builds same-folder rename targets; `src/core/utils/contexts/pageTitleRename.ts:235-328` rejects empty, slash, duplicate, and invalid targets. |
| 6 | Ordinary file metadata is frontmatter-backed and discovered from Markdown files. | ACCURATE | `src/core/utils/properties/allProperties.ts:132-168` discovers frontmatter keys and marks `source: "frontmatter"`; `src/core/utils/properties/frontmatterWrite.ts:7-31` accepts only successful frontmatter saves. |
| 7 | View layout state lives in Notidian context data, not row files. | ACCURATE | `src/core/react/components/SpaceView/Contexts/TableView/ColumnHeader.tsx:169-180` stores frozen count through `savePredicate`; `src/core/react/components/UI/Menus/contexts/propertyVisibilityMenu.tsx:188-194` persists `colsOrder` / `colsHidden` through `savePredicate`. |
| 8 | Context MDB stores values only when a field is explicitly Notidian-owned. | OVERSTATED | `src/core/utils/properties/propertyAuthority.ts:12-20` falls through to `return "notidian"` for any non-file, non-frontmatter, noncomputed column; `src/core/utils/properties/propertyAuthority.ts:30-34` persists that authority to context. |
| 9 | Computed values, file projections, and aggregates are not durable row data. | ACCURATE | `src/core/utils/properties/propertyAuthority.ts:16-18` classifies `fileprop` / `aggregate` as computed; `src/core/utils/properties/allProperties.ts:275-304` strips frontmatter-backed values before context row persistence. |
| 10 | Native Obsidian Bases is not an active runtime target. | ACCURATE | `src/main.ts:231-268` registers Notidian views only; `scripts/notidianRealVaultHarness.js:39-66` has no Bases flags; `scripts/notidianHealthAudit.js:443-469` asserts Bases core is disabled. |
| 11 | Guarantee: ordinary frontmatter values are accepted only after frontmatter write succeeds. | ACCURATE | `src/core/utils/contexts/tableEditTransaction.ts:279-299` saves frontmatter groups before `saveDB`; failures return `frontmatter-write-failed`. |
| 12 | Guarantee: paste cannot bypass row file-path fallback with an empty path. | ACCURATE | `src/core/utils/contexts/tableEditTransaction.ts:94-99` uses explicit path only when non-empty, otherwise row path. |
| 13 | Guarantee: stale frontmatter edits are skipped rather than written. | ACCURATE | `src/core/utils/contexts/tableEditTransaction.ts:248-263` compares current/base canonical values and returns `frontmatter-conflict` unless forced. |
| 14 | Guarantee: stale edits overwrite only after explicit “Apply anyway.” | ACCURATE | `src/core/react/components/SpaceView/Contexts/TableView/TableView.tsx:607-623` applies `forceFrontmatterWrite: true` only from conflict feedback; `TableView.tsx:1942-1967` renders the action. |
| 15 | Guarantee: bulk writes use accumulated snapshots. | ACCURATE | `src/core/utils/contexts/tableEditTransaction.ts:317-377` accumulates per-context snapshots before `saveContextDB`. |
| 16 | Guarantee: mixed title/property paste writes non-file values to renamed paths. | ACCURATE | `src/core/react/context/ContextEditorContext.tsx:853-907` runs bulk title rename first, then applies `applyTableEditPathOverrides`; `src/core/utils/contexts/tableEditTransaction.ts:100-108` rewrites write paths. |
| 17 | Guarantee: direct failures are surfaced inline and optimistic state resets. | ACCURATE | `src/core/utils/contexts/tableEditFeedback.ts:58-84` maps failed/skipped writes to visible feedback; `src/core/utils/contexts/tableEditFeedback.ts:106-119` increments reset tokens. |
| 18 | Guarantee: direct and bulk undo use the same apply paths as original edits. | ACCURATE | `src/core/react/components/SpaceView/Contexts/TableView/TableView.tsx:779-809` calls `applyTableEdits(undoEntry.writes)` for undo. |
| 19 | Guarantee: direct and bulk redo use the same paths and no forced flags. | ACCURATE | `src/core/utils/contexts/tableUndoJournal.ts:119-126` strips `forceFrontmatterWrite`; `src/core/react/components/SpaceView/Contexts/TableView/TableView.tsx:810-839` calls `applyTableEdits(redoEntry.redoWrites)`. |
| 20 | Guarantee: immediate undo after title paste targets the renamed current path. | ACCURATE | `src/core/utils/contexts/tableUndoJournal.ts:107-164` computes `currentPathAfterWrite` through `buildPageTitleRename`. |
| 21 | Guarantee: MDB rows are not durable source for frontmatter/computed values. | ACCURATE | `src/core/spaceManager/filesystemAdapter/filesystemAdapter.ts:530-545` saves `stripFrontmatterBackedRowValues(table)`; `src/core/utils/properties/allProperties.ts:275-304` removes non-context row values. |
| 22 | Guarantee: legacy migration planning does not strip context-only columns or conflicts. | ACCURATE | `src/core/utils/contexts/legacyContextMigrationCore.js:242-271` strips only safe/computed columns and preserves `context-only`; conflicts remain blocking issues. |
| 23 | Guarantee: legacy CLI is read-only and partial scans are never migration-ready. | ACCURATE | `scripts/notidianLegacyContextAudit.js:25-70` has no write flag; `scripts/notidianLegacyContextAudit.js:333-399` reports `mode: "read-only"` and gates `canApplyAutomatically` on complete scans. |
| 24 | Guarantee: create/rename/delete property planning previews consequences before destructive apply. | ACCURATE | `src/core/utils/contexts/notidianSchema.ts:222-270`, `272-421`, `423-477` build pure create/rename/delete plans and previews. |
| 25 | Guarantee: frontmatter header label edits alias only, not YAML keys. | ACCURATE | `src/core/utils/contexts/propertyNameValue.ts:29-37` routes frontmatter-backed header name edits to `alias`. |
| 26 | Guarantee: frontmatter delete actions are hide-only until destructive UI exists. | ACCURATE | `src/core/utils/contexts/propertyColumnActions.ts:8-18` returns hide instead of delete for frontmatter-backed columns; `src/core/react/context/ContextEditorContext.tsx:1275-1286` hides root columns. |
| 27 | Guarantee: frontmatter type changes stay within supported file-backed types. | ACCURATE | `src/core/utils/contexts/propertyTypeMenu.ts:8-17`, `48-58` restrict selectable frontmatter types and special-case Tags. |
| 28 | ADR 0016 display properties affect labels, not identity. | ACCURATE | `src/core/utils/contexts/rowDisplayLabel.ts:5-39` uses `predicate.listViewProps.displayProperty` for labels with basename fallback; title rename code remains path-based in `pageTitle.ts:13-42`. |
| 29 | Existing frontmatter keys can be suggested/imported as columns. | ACCURATE | `src/core/react/components/UI/Menus/contexts/newSpacePropertyMenu.tsx:220-240`, `342-363` discovers existing frontmatter properties and offers them for import. |
| 30 | Frozen columns are view state with clamped visible-column offsets. | ACCURATE | `src/core/utils/contexts/tableFreeze.ts:12-43`, `76-109` filters hidden columns, clamps frozen count, and computes sticky offsets. |
| 31 | Manual row ordering is view/order-only and clears sort/group after drag. | ACCURATE | `src/core/utils/contexts/tableRowOrder.ts:36-127` reorders rows only; `src/core/react/components/SpaceView/Contexts/TableView/TableView.tsx:1593-1627` saves rows and clears sort/group. |
| 32 | Current-state verification wrappers exist and drive source/live gates. | ACCURATE | `package.json:24-29` defines `verify:source`, `verify:source:pristine`, `verify:live`, `verify:live:ui`; `scripts/notidianVerify.js:80-183` implements those flows. |
| 33 | Architecture doc’s repository verification command block is the current exact gate. | DRIFTED | `docs/notidian-system-architecture.md:300-307` lists four direct commands; `scripts/notidianVerify.js:80-99` also runs `npm audit` and `git diff --check HEAD^ HEAD -- .`, and current-state points to `npm run verify:source`. |
| 34 | Implementation Map paths in current-state exist. | ACCURATE | All paths listed in `docs/current-state.md:341-358` resolved in a read-only existence check; none were missing. |
| 35 | README Status still lists “Redo support for table operations” as future work. | DRIFTED | `README.md:76-79` lists redo as next work, but redo is implemented in `src/core/react/components/SpaceView/Contexts/TableView/TableView.tsx:810-839` and covered by `scripts/notidianRealVaultHarness.js:2503-2515`, `2583-2595`. |

## Verdict

Docs and code are broadly aligned for the Notidian-only architecture: storage-root normalization, frontmatter authority, page-title identity, undo/redo, schema planning, legacy audit behavior, and real-vault verification all match reachable source. I found no evidence that native Bases or `.base` files are active runtime targets. The meaningful drift is documentation hygiene plus one overstatement: code treats source-less context columns as Notidian-owned by fallback, while the docs phrase that ownership as explicitly marked.

## Findings

### [SEV-medium] Context-native field ownership is documented as explicit, but code uses fallback ownership

Evidence: `docs/current-state.md:41`

> `Context-native fields | Notidian context MDB | Stores values only when a field is explicitly Notidian-owned.`

Evidence: `src/core/utils/properties/propertyAuthority.ts:12-20`

> `if (column.name === PathPropertyName) return "file";`
>
> `if (column.source === "frontmatter") return "frontmatter";`
>
> `if (column.type === "fileprop" || column.type === "aggregate") return "computed";`
>
> `return "notidian";`

Evidence: `src/core/utils/properties/propertyAuthority.ts:30-34`

> `return authority === "file" || authority === "notidian";`

Why it matters: the architecture rule says ordinary editable metadata belongs in Markdown frontmatter, while MDB row values are only for explicitly Notidian-owned fields. The current authority function makes any non-frontmatter, noncomputed, non-file column durable in MDB by default, so a missing or lost `source: "frontmatter"` marker can silently change authority.

Suggested fix direction: either make Notidian-owned fields explicit in schema, for example `source: "notidian"` or `notidianOwned: true`, and reject ambiguous durable row writes, or soften the docs to say that legacy/source-less context columns are currently treated as Notidian-owned.

Confidence: medium. Cheapest confirmation is a focused unit test constructing a source-less ordinary column, applying a row value, and asserting whether that value persists to the context MDB.

### [SEV-low] Architecture verification block lags the actual verification script

Evidence: `docs/notidian-system-architecture.md:300-307`

> `npm test -- --runInBand`
>
> `npx tsc -noEmit -skipLibCheck`
>
> `npm run build`
>
> `git diff --check`

Evidence: `docs/current-state.md:362-366`

> `npm run verify:source`

Evidence: `scripts/notidianVerify.js:80-99`

> `["npm", ["audit"], "Dependency audit"]`
>
> `["git", ["diff", "--check", "HEAD^", "HEAD", "--", "."], "Git whitespace check"]`

Why it matters: contributors following the architecture doc miss the current scripted gate and its extra checks. This is not a product correctness bug, but it can produce inconsistent audit and release results.

Suggested fix direction: replace the architecture command block with `npm run verify:source`, or list the exact steps from `scripts/notidianVerify.js`.

Confidence: high. Cheapest confirmation is `npm run verify:source -- --help` or reading `scripts/notidianVerify.js`.

### [SEV-low] README Status still lists redo as future work even though redo is implemented

Evidence: `README.md:76-79`

> `The next high-value work is:`
>
> `- Redo support for table operations.`

Evidence: `src/core/react/components/SpaceView/Contexts/TableView/TableView.tsx:810-839`

> `const redoLastTableOperation = async () => {`
>
> `const result = await applyTableEdits(redoEntry.redoWrites);`

Evidence: `scripts/notidianRealVaultHarness.js:2503-2515`, `2583-2595`

> `await harness.dispatchUndoShortcut(true);`
>
> `throw new Error("Direct edit redo failed");`
>
> `throw new Error("Paste redo did not restore pasted value");`

Why it matters: README status is a high-visibility onboarding surface. This stale bullet makes completed core behavior look missing.

Suggested fix direction: remove the redo bullet or replace it with the remaining known UI smoke gaps from `docs/current-state.md`.

Confidence: high. Cheapest confirmation is running only the targeted real-vault redo smoke when write-capable verification is allowed.

## Swept Clean

Verified all `docs/current-state.md` Guarantee bullets against reachable `src/` or `scripts/` code. The guarantees for frontmatter-first acceptance, stale conflict handling, explicit conflict apply, accumulated bulk writes, mixed title/property paste retargeting, undo/redo paths, MDB stripping, legacy audit safety, schema planning, header alias behavior, hide-only frontmatter deletes, and frontmatter type restrictions are supported by code.

Checked storage and migration behavior across `pluginIdentity`, the Obsidian storage guard, plugin load sanitization, `.notidian` persisters, and `scripts/notidianSpaceStoreMigration.js`. The docs match the implementation.

Checked active runtime reachability for Bases. The plugin registers Notidian views only, the real-vault harness exposes no Bases flags, and the health audit asserts Bases is disabled.

Checked current-state Known Gaps against code. The listed gaps still appear valid: richer conflict diff/merge, broader real-vault UI coverage, write-capable legacy migration CLI, destructive/default-backfill schema flows, and file moves from title cells are not implemented as completed runtime features. The README redo bullet is the stale exception.

Checked the Implementation Map in `docs/current-state.md`; all listed paths exist. I did not run builds, tests, or write-capable harnesses, per the read-only auditor brief.

## Improvement Paths

1. Consolidate verification docs around `npm run verify:source` and `npm run verify:live`, with implementation details owned by `scripts/notidianVerify.js`.

2. Make context-owned field authority explicit in schema, or document the current fallback model as intentional legacy compatibility.

3. Add a lightweight doc-drift check that catches stale README Status bullets and command blocks that diverge from `package.json` scripts.