# Legacy Context Audit And Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a non-destructive legacy Make.md context audit and migration planner so Notidian can classify, preview, and safely canonicalize old context data later.

**Architecture:** Add a pure utility under `src/core/utils/contexts` that accepts a `SpaceTable` plus canonical frontmatter snapshots and returns an audit plus a dry migration plan. Keep disk writes, Obsidian commands, and UI migration prompts out of this phase so every data-safety rule is testable independently.

**Tech Stack:** TypeScript, Jest, existing `SpaceTable`/`SpaceProperty` types, existing `frontmatterPropertySource`, `PathPropertyName`, and property authority helpers.

---

### Task 1: Write The Legacy Audit Tests

**Files:**
- Create: `src/core/utils/contexts/legacyContextMigration.test.ts`

- [ ] **Step 1: Add failing tests for legacy classification**

Create `src/core/utils/contexts/legacyContextMigration.test.ts` with tests that import:

```ts
import { defaultContextSchemaID } from "shared/schemas/context";
import { PathPropertyName } from "shared/types/context";
import { SpaceTable } from "shared/types/mdb";
import {
  applyLegacyContextMigrationPlan,
  auditLegacyContextTable,
  createLegacyContextMigrationPlan,
} from "./legacyContextMigration";
```

Cover these behaviors:

- unmarked columns matching frontmatter become `frontmatter-candidate`;
- context-only columns remain `context-only`;
- matching MDB duplicate values are planned for cleanup;
- conflicts are reported and block automatic cleanup;
- discovered frontmatter-only keys are planned as added columns;
- applying a plan returns a new table without mutating the input.

- [ ] **Step 2: Run the new test and verify it fails**

Run:

```bash
npm test -- legacyContextMigration.test.ts --runInBand
```

Expected: the test suite fails because `legacyContextMigration` does not exist yet.

### Task 2: Implement The Pure Migration Utility

**Files:**
- Create: `src/core/utils/contexts/legacyContextMigration.ts`

- [ ] **Step 1: Add public types and helpers**

Create exported types for:

- `LegacyContextColumnClassification`;
- `LegacyContextValueIssue`;
- `LegacyContextAudit`;
- `LegacyContextMigrationPlan`.

Use string literal types for category names so tests can assert exact behavior.

- [ ] **Step 2: Implement `auditLegacyContextTable`**

The function should:

- build column classifications using `propertyAuthorityForColumn`;
- inspect row paths from `PathPropertyName`;
- compare table row values with `frontmatterByPath[path][column.name]`;
- treat `undefined`, `null`, and empty string as empty;
- classify candidate value states as `matching`, `context-only-value`, `frontmatter-only-value`, `conflict`, or `empty`;
- discover frontmatter keys missing from the schema.

- [ ] **Step 3: Implement `createLegacyContextMigrationPlan`**

The function should:

- mark candidate columns as frontmatter-backed only when at least one matching frontmatter key exists;
- block automatic cleanup when any candidate has conflict issues;
- recommend stripping row values for already-frontmatter and non-conflicting candidate columns;
- preserve context-only columns and values;
- include discovered frontmatter keys as proposed added columns with `source: "frontmatter"`.

- [ ] **Step 4: Implement `applyLegacyContextMigrationPlan`**

The function should:

- return a copied `SpaceTable`;
- set `source: "frontmatter"` on planned candidate columns;
- append planned discovered columns;
- remove row values for columns in the cleanup plan;
- never remove `File` values or context-only values;
- not mutate the input table.

### Task 3: Verify The Utility

**Files:**
- Modify: `src/core/utils/contexts/legacyContextMigration.ts`
- Modify: `src/core/utils/contexts/legacyContextMigration.test.ts`

- [ ] **Step 1: Run the focused tests**

Run:

```bash
npm test -- legacyContextMigration.test.ts --runInBand
```

Expected: all tests pass.

- [ ] **Step 2: Run adjacent authority tests**

Run:

```bash
npm test -- allProperties.test.ts propertyAuthority.test.ts tableEditTransaction.test.ts --runInBand
```

Expected: all tests pass.

### Task 4: Document The Result

**Files:**
- Create: `docs/adr/0010-legacy-context-audit-and-migration.md`
- Modify: `docs/current-state.md`
- Modify: `docs/table-database-workflows.md`

- [ ] **Step 1: Add ADR 0010**

Document why Make.md avoided direct conversion, why Notidian uses audit-first migration, what data states are classified, and why no destructive migration command exists yet.

- [ ] **Step 2: Update current-state and workflow docs**

Replace the generic legacy migration gap with the implemented pure audit/planner and the remaining UI/CLI migration command gap.

### Task 5: Full Verification And Commit

**Files:**
- All files changed by this plan.

- [ ] **Step 1: Run verification**

Run:

```bash
npm test -- --runInBand
npx tsc -noEmit -skipLibCheck
npm run build
```

Expected: all commands exit 0.

- [ ] **Step 2: Commit and push**

Run:

```bash
git status --short
git add src/core/utils/contexts/legacyContextMigration.ts src/core/utils/contexts/legacyContextMigration.test.ts docs/adr/0010-legacy-context-audit-and-migration.md docs/current-state.md docs/table-database-workflows.md docs/superpowers/specs/2026-05-26-legacy-context-audit-migration-design.md docs/superpowers/plans/2026-05-26-legacy-context-audit-migration.md
git commit -m "feat: add legacy context migration audit"
git push origin main
```
