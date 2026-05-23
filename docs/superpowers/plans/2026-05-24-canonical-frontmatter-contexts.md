# Canonical Frontmatter Contexts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Notidian frontmatter-backed context columns explicit, immediately materialized on metadata changes, safely written through to frontmatter, and stripped from durable context row storage.

**Architecture:** Add `source: "frontmatter"` provenance to `SpaceProperty`, centralize materialization/storage helpers in `core/utils/properties/allProperties.ts`, and reuse them from context parsing, metadata updates, context saves, and UI edit write-through. Keep legacy context-only columns intact.

**Tech Stack:** TypeScript, Jest, Obsidian `processFrontMatter`, Notidian context MDB tables.

---

### Task 1: Mark Frontmatter-Backed Columns Explicitly

**Files:**
- Modify: `src/shared/types/mdb.ts`
- Modify: `src/shared/schemas/fields.ts`
- Modify: `src/core/utils/properties/allProperties.ts`
- Test: `src/core/utils/properties/allProperties.test.ts`

- [ ] **Step 1: Write failing tests**

Add tests proving discovered frontmatter columns have `source: "frontmatter"`, existing matching columns are upgraded, and frontmatter-backed row values can be stripped for storage.

- [ ] **Step 2: Verify red**

Run: `npx jest src/core/utils/properties/allProperties.test.ts --runInBand`

Expected: FAIL because `source`, materialization, and storage stripping helpers are missing.

- [ ] **Step 3: Implement provenance helpers**

Add `source?: string` to `SpaceProperty`, include `source` in `fieldSchema.cols`, and add helpers:

```ts
export const frontmatterPropertySource = "frontmatter";
export const isFrontmatterBackedProperty = (property?: Pick<SpaceProperty, "source">) =>
  property?.source === frontmatterPropertySource;
export const stripFrontmatterBackedRowValues = (table: SpaceTable): SpaceTable;
export const materializeFrontmatterBackedContextTable = (
  table: SpaceTable,
  pathsIndex: Map<string, Pick<PathState, "metadata">>,
  paths: string[],
  settings: MakeMDSettings,
  enabled: boolean
): { table: SpaceTable; changed: boolean };
```

- [ ] **Step 4: Verify green**

Run: `npx jest src/core/utils/properties/allProperties.test.ts --runInBand`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/shared/types/mdb.ts src/shared/schemas/fields.ts src/core/utils/properties/allProperties.ts src/core/utils/properties/allProperties.test.ts
git commit -m "feat: mark frontmatter-backed context columns"
```

### Task 2: Reuse Materialization During Context Parsing And Metadata Updates

**Files:**
- Modify: `src/core/superstate/cacheParsers.ts`
- Modify: `src/core/superstate/cacheParsers.test.ts`
- Modify: `src/core/utils/contexts/context.ts`

- [ ] **Step 1: Write failing tests**

Add parser tests that expect `source: "frontmatter"` on materialized columns and expect legacy frontmatter columns to keep adding new external properties.

- [ ] **Step 2: Verify red**

Run: `npx jest src/core/superstate/cacheParsers.test.ts --runInBand`

Expected: FAIL until parser uses the centralized materializer.

- [ ] **Step 3: Implement parser reuse**

Replace the parser's inline discovery logic with `materializeFrontmatterBackedContextTable`.

- [ ] **Step 4: Implement metadata update reuse**

In `updateContextWithProperties`, materialize the context table before row projection so a newly added external frontmatter key becomes a visible column during metadata-change sync.

- [ ] **Step 5: Verify green**

Run: `npx jest src/core/superstate/cacheParsers.test.ts src/core/utils/properties/allProperties.test.ts --runInBand`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/core/superstate/cacheParsers.ts src/core/superstate/cacheParsers.test.ts src/core/utils/contexts/context.ts
git commit -m "fix: materialize frontmatter columns on metadata sync"
```

### Task 3: Persist Context Tables Without Frontmatter Row Values

**Files:**
- Modify: `src/core/spaceManager/filesystemAdapter/filesystemAdapter.ts`
- Test: `src/core/utils/properties/allProperties.test.ts`

- [ ] **Step 1: Write failing storage test**

Add a pure helper test proving `stripFrontmatterBackedRowValues` keeps `File` and context-only values but removes frontmatter-backed values.

- [ ] **Step 2: Verify red**

Run: `npx jest src/core/utils/properties/allProperties.test.ts --runInBand`

Expected: FAIL until storage stripping is implemented.

- [ ] **Step 3: Strip before filesystem table saves**

Call `stripFrontmatterBackedRowValues(table)` from filesystem `saveTable`.

- [ ] **Step 4: Verify green**

Run: `npx jest src/core/utils/properties/allProperties.test.ts --runInBand`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/spaceManager/filesystemAdapter/filesystemAdapter.ts src/core/utils/properties/allProperties.ts src/core/utils/properties/allProperties.test.ts
git commit -m "fix: keep frontmatter values out of context storage"
```

### Task 4: Make Frontmatter Writes Awaited And Source-Aware

**Files:**
- Modify: `src/core/react/context/ContextEditorContext.tsx`

- [ ] **Step 1: Make write-through decisions source-aware**

Add a local helper that writes a changed cell to frontmatter when the column is explicitly frontmatter-backed, or when the legacy `saveAllContextToFrontmatter` option is enabled.

- [ ] **Step 2: Await writes before row saves**

Convert the relevant edit handlers to await `saveProperties` before saving local row state. If the write rejects, rethrow or report without saving MDB row state as canonical.

- [ ] **Step 3: Verify TypeScript**

Run: `npx tsc -noEmit -skipLibCheck`

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/core/react/context/ContextEditorContext.tsx
git commit -m "fix: await frontmatter-backed context writes"
```

### Task 5: Full Verification

**Files:**
- No code changes expected.

- [ ] **Step 1: Run focused tests**

Run: `npx jest src/core/utils/properties/allProperties.test.ts src/core/superstate/cacheParsers.test.ts --runInBand`

Expected: PASS.

- [ ] **Step 2: Run all tests**

Run: `npm test -- --runInBand`

Expected: PASS.

- [ ] **Step 3: Run TypeScript**

Run: `npx tsc -noEmit -skipLibCheck`

Expected: PASS.

- [ ] **Step 4: Run production build**

Run: `npm run build`

Expected: PASS.

- [ ] **Step 5: Check diff whitespace**

Run: `git diff --check -- . ':(exclude)main.js'`

Expected: PASS.
