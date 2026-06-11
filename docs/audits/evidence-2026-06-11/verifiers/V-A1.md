## Verdict
CONFIRMED

## Trace
UI trigger: `TableView` exposes reload conflict handling and calls `reloadContextData()` at `src/core/react/components/SpaceView/Contexts/TableView/TableView.tsx:585-590`.

Bridge: `ContextEditorContext.reloadContextData` calls `reloadContextByPath(contextPath, { force: true, calculate: true })` at `src/core/react/context/ContextEditorContext.tsx:812-817`.

Runtime reload: `reloadContextByPath` delegates to `reloadContext`, which sends an indexer `context` job and then calls `contextReloaded` at `src/core/superstate/superstate.ts:766-781`.

Worker bridge: the indexer reads existing MDB tables and sends `pathsIndex`, `contextsIndex`, settings, and `dbExists` to the worker at `src/core/superstate/workers/indexer/indexer.ts:176-213`; the worker dispatches to `parseContext` at `src/core/superstate/workers/indexer/indexer.worker.ts:25-32`; `parseContext` calls `parseContextTableToCache` at `src/core/superstate/workers/indexer/impl.ts:27-29`.

Helper path: `parseContextTableToCache` materializes columns at `src/core/superstate/cacheParsers.ts:47-65`, then runs `syncContextRow` and optionally `linkContextRow` at `src/core/superstate/cacheParsers.ts:78-83`.

Missed safeguard: `materializeFrontmatterBackedContextTable` only runs if `contextHasOnlyDefaultOrFrontmatterColumns` passes; mixed contexts with unrelated user columns return unchanged at `src/core/utils/properties/allProperties.ts:207-219`. That leaves the unmarked colliding column unmarked.

Overlay: `syncContextRow` overlays any frontmatter key whose name exists in `fieldsByName`, with no `source` check, at `src/core/utils/contexts/linkContextRow.ts:92-108`.

Save condition: `contextReloaded` saves only when `cache.dbExists && changed` at `src/core/superstate/superstate.ts:787-798`. So line ~795 is active when the MDB file already exists and the parsed context table differs from persisted MDB.

Persistence: `SpaceManager.saveTable` forwards to the adapter at `src/core/spaceManager/spaceManager.ts:225-227`; filesystem persistence wraps the save in `stripFrontmatterBackedRowValues(table)` at `src/core/spaceManager/filesystemAdapter/filesystemAdapter.ts:530-545`.

Strip failure: `stripFrontmatterBackedRowValues` strips only columns where `shouldPersistAuthorityValueToContext` is false at `src/core/utils/properties/allProperties.ts:275-289`. Unmarked columns become authority `"notidian"` at `src/core/utils/properties/propertyAuthority.ts:12-20`, and `"notidian"` persists at `src/core/utils/properties/propertyAuthority.ts:30-34`.

## Evidence
Repro test: `src/core/utils/contexts/__audit__/a1-sync-leak.audit.test.ts`.

Key repro lines: mixed unmarked `status` plus unrelated `manual` columns at `src/core/utils/contexts/__audit__/a1-sync-leak.audit.test.ts:43-57`; real helper composition at `src/core/utils/contexts/__audit__/a1-sync-leak.audit.test.ts:59-86`; assertion that leaked YAML survives MDB stripping at `src/core/utils/contexts/__audit__/a1-sync-leak.audit.test.ts:88-98`.

Test output:
```text
PASS src/core/utils/contexts/__audit__/a1-sync-leak.audit.test.ts
✓ persists a YAML value into MDB rows when an unmarked mixed-context column matches frontmatter
Test Suites: 1 passed, 1 total
Tests: 1 passed, 1 total
```

## Severity check
SEV-high holds. Scope is narrower than “any unmarked matching column”: fully default/frontmatter-compatible contexts are protected by materialization. But mixed legacy contexts with at least one unrelated Notidian-owned column bypass that safeguard, then silently persist canonical YAML into hidden MDB row data on reload when `changed` is true and the MDB exists. That violates the authority architecture and can create durable shadow metadata.

## Fix sketch
Mark the overlaid frontmatter keys as non-persistent before save, even when the table is mixed.

Minimal options:
- In `syncContextRow`, overlay only explicit `source: "frontmatter"` columns.
- Or in `parseContextTableToCache`, return a `projectionRows` table for cache/UI but keep persisted rows authority-stripped by discovered frontmatter key.
- Prefer preserving mixed-context columns while treating name-colliding YAML projections as frontmatter-owned for persistence.
- Add a regression test where mixed context columns keep `manual` but omit colliding `status` from saved MDB rows.

Next step: review the new audit test and approve whether you want me to implement the minimal fix now.