# Authority Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Notidian enforce a clear authority boundary so file-backed data cannot silently become context-owned data.

**Architecture:** Add a small authority registry for context columns, harden frontmatter writes into explicit transactions, improve type reconciliation for discovered properties, and strengthen page-title rename reconciliation. Context MDB remains the view/config/cache layer; file paths and frontmatter remain canonical.

**Tech Stack:** TypeScript, React context, Jest, Obsidian/Notidian space manager adapters.

---

### Task 1: Column Authority Registry

**Files:**
- Create: `src/core/utils/properties/propertyAuthority.ts`
- Create: `src/core/utils/properties/propertyAuthority.test.ts`
- Modify: `src/core/utils/properties/allProperties.ts`

- [ ] **Step 1: Write failing authority tests**

```ts
import { PathPropertyName } from "shared/types/context";
import { frontmatterPropertySource } from "./allProperties";
import {
  propertyAuthorityForColumn,
  shouldPersistAuthorityValueToContext,
  shouldWriteAuthorityValueToFrontmatter,
} from "./propertyAuthority";

describe("propertyAuthorityForColumn", () => {
  it("classifies file identity, frontmatter, formula, and Notidian-owned columns", () => {
    expect(propertyAuthorityForColumn({ name: PathPropertyName, type: "file" })).toBe("file");
    expect(propertyAuthorityForColumn({ name: "status", type: "text", source: frontmatterPropertySource })).toBe("frontmatter");
    expect(propertyAuthorityForColumn({ name: "age", type: "fileprop" })).toBe("computed");
    expect(propertyAuthorityForColumn({ name: "manual", type: "text" })).toBe("notidian");
  });

  it("only frontmatter authority writes through to frontmatter without the legacy bulk setting", () => {
    expect(shouldWriteAuthorityValueToFrontmatter({ name: "status", type: "text", source: frontmatterPropertySource }, false)).toBe(true);
    expect(shouldWriteAuthorityValueToFrontmatter({ name: "manual", type: "text" }, false)).toBe(false);
    expect(shouldWriteAuthorityValueToFrontmatter({ name: "manual", type: "text" }, true)).toBe(true);
  });

  it("does not persist file, frontmatter, or computed values as durable context values", () => {
    expect(shouldPersistAuthorityValueToContext({ name: PathPropertyName, type: "file" })).toBe(true);
    expect(shouldPersistAuthorityValueToContext({ name: "status", type: "text", source: frontmatterPropertySource })).toBe(false);
    expect(shouldPersistAuthorityValueToContext({ name: "age", type: "fileprop" })).toBe(false);
    expect(shouldPersistAuthorityValueToContext({ name: "manual", type: "text" })).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify RED**

Run: `npm test -- src/core/utils/properties/propertyAuthority.test.ts --runInBand`

Expected: FAIL because `propertyAuthority.ts` does not exist.

- [ ] **Step 3: Implement the authority registry**

```ts
import { PathPropertyName } from "shared/types/context";
import { SpaceProperty } from "shared/types/mdb";
import {
  frontmatterPropertySource,
  isFrontmatterBackedProperty,
} from "./allProperties";

export type PropertyAuthority =
  | "file"
  | "frontmatter"
  | "notidian"
  | "computed";

export const propertyAuthorityForColumn = (
  property?: Partial<Pick<SpaceProperty, "name" | "source" | "type">>
): PropertyAuthority => {
  if (property?.name === PathPropertyName) return "file";
  if (isFrontmatterBackedProperty(property)) return "frontmatter";
  if (property?.type === "fileprop" || property?.type === "aggregate") {
    return "computed";
  }
  return "notidian";
};

export const shouldWriteAuthorityValueToFrontmatter = (
  property: Partial<Pick<SpaceProperty, "name" | "source" | "type">>,
  saveAllContextToFrontmatter: boolean
): boolean =>
  propertyAuthorityForColumn(property) === "frontmatter" ||
  (propertyAuthorityForColumn(property) === "notidian" &&
    saveAllContextToFrontmatter);

export const shouldPersistAuthorityValueToContext = (
  property: Partial<Pick<SpaceProperty, "name" | "source" | "type">>
): boolean => {
  const authority = propertyAuthorityForColumn(property);
  return authority === "file" || authority === "notidian";
};
```

- [ ] **Step 4: Wire existing persistence decisions through the registry**

Update `allProperties.ts` so `shouldWriteContextPropertyToFrontmatter` delegates to `shouldWriteAuthorityValueToFrontmatter`, and `stripFrontmatterBackedRowValues` uses `shouldPersistAuthorityValueToContext`.

- [ ] **Step 5: Run focused tests**

Run: `npm test -- src/core/utils/properties/propertyAuthority.test.ts src/core/utils/properties/allProperties.test.ts --runInBand`

Expected: PASS.

### Task 2: Frontmatter Write Transaction Helper

**Files:**
- Create: `src/core/utils/properties/frontmatterWrite.ts`
- Create: `src/core/utils/properties/frontmatterWrite.test.ts`
- Modify: `src/core/react/context/ContextEditorContext.tsx`

- [ ] **Step 1: Write failing transaction tests**

```ts
import { saveFrontmatterProperties } from "./frontmatterWrite";

describe("saveFrontmatterProperties", () => {
  it("returns success only when the space manager confirms the write", async () => {
    const result = await saveFrontmatterProperties({
      superstate: { spaceManager: { saveProperties: jest.fn(async () => true) } } as any,
      path: "a.md",
      properties: { status: "active" },
    });

    expect(result.ok).toBe(true);
  });

  it("notifies and returns failure when the write returns false or undefined", async () => {
    const notify = jest.fn();
    const falseResult = await saveFrontmatterProperties({
      superstate: { spaceManager: { saveProperties: jest.fn(async () => false) }, ui: { notify } } as any,
      path: "a.md",
      properties: { status: "active" },
    });
    const undefinedResult = await saveFrontmatterProperties({
      superstate: { spaceManager: { saveProperties: jest.fn(async () => undefined) }, ui: { notify } } as any,
      path: "a.md",
      properties: { status: "active" },
    });

    expect(falseResult.ok).toBe(false);
    expect(undefinedResult.ok).toBe(false);
    expect(notify).toHaveBeenCalled();
  });

  it("notifies and returns failure when the write throws", async () => {
    const notify = jest.fn();
    const result = await saveFrontmatterProperties({
      superstate: { spaceManager: { saveProperties: jest.fn(async () => { throw new Error("denied"); }) }, ui: { notify } } as any,
      path: "a.md",
      properties: { status: "active" },
    });

    expect(result.ok).toBe(false);
    expect(result.error).toBeInstanceOf(Error);
    expect(notify).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the test to verify RED**

Run: `npm test -- src/core/utils/properties/frontmatterWrite.test.ts --runInBand`

Expected: FAIL because `frontmatterWrite.ts` does not exist.

- [ ] **Step 3: Implement the helper**

```ts
import { Superstate } from "makemd-core";

export type FrontmatterWriteResult =
  | { ok: true }
  | { ok: false; error?: unknown };

export const saveFrontmatterProperties = async ({
  superstate,
  path,
  properties,
  failureMessage = "Could not update file properties.",
}: {
  superstate: Superstate;
  path: string;
  properties: Record<string, unknown>;
  failureMessage?: string;
}): Promise<FrontmatterWriteResult> => {
  if (!path || Object.keys(properties).length === 0) return { ok: true };

  try {
    const saved = await superstate.spaceManager.saveProperties(path, properties);
    if (saved === true) return { ok: true };
    superstate.ui?.notify?.(failureMessage);
    return { ok: false };
  } catch (error) {
    superstate.ui?.notify?.(failureMessage);
    return { ok: false, error };
  }
};
```

- [ ] **Step 4: Replace direct frontmatter writes in context editing**

In `ContextEditorContext.tsx`, replace direct `saveProperties(...)` calls in `updateRow`, `updateValue`, and `updateFieldValue` with `saveFrontmatterProperties(...)`. For single-cell writes, return early on failure before saving the context row. For row writes, return early when the frontmatter transaction fails so failed file-backed changes are not shown as accepted context changes.

- [ ] **Step 5: Run focused tests**

Run: `npm test -- src/core/utils/properties/frontmatterWrite.test.ts src/core/utils/properties/allProperties.test.ts --runInBand`

Expected: PASS.

### Task 3: Safer Frontmatter Type Reconciliation

**Files:**
- Modify: `src/core/utils/properties/allProperties.ts`
- Modify: `src/core/utils/properties/allProperties.test.ts`

- [ ] **Step 1: Write failing conflict test**

Add a test proving that mixed observed YAML types resolve to `text`:

```ts
it("uses text when observed frontmatter values for one property have conflicting types", () => {
  const pathsIndex = new Map<string, any>([
    ["a.md", pathState({ voltage: 24 })],
    ["b.md", pathState({ voltage: "24V" })],
  ]);

  const result = materializeFrontmatterBackedContextTable(
    {
      schema: { id: defaultContextSchemaID, name: "Files", type: "db" },
      cols: defaultContextFields.rows as any,
      rows: [{ [PathPropertyName]: "a.md" }, { [PathPropertyName]: "b.md" }],
    },
    pathsIndex,
    ["a.md", "b.md"],
    settings,
    true
  );

  expect(result.table.cols.find((col) => col.name === "voltage")).toEqual(
    expect.objectContaining({ type: "text", source: frontmatterPropertySource })
  );
});
```

- [ ] **Step 2: Run RED**

Run: `npm test -- src/core/utils/properties/allProperties.test.ts --runInBand`

Expected: FAIL because current code picks first-seen type.

- [ ] **Step 3: Implement type reconciliation**

Collect all observed mapped MDB types per property. If all non-unknown observed types agree, use that type. If they conflict, use `text`.

- [ ] **Step 4: Run focused tests**

Run: `npm test -- src/core/utils/properties/allProperties.test.ts --runInBand`

Expected: PASS.

### Task 4: Rename Reconciliation Deduplication

**Files:**
- Modify: `src/core/utils/contexts/pageTitleRename.ts`
- Modify: `src/core/utils/contexts/pageTitleRename.test.ts`

- [ ] **Step 1: Write failing duplicate-row test**

Add a test where metadata sync leaves two rows for the renamed path, and verify the transaction saves only one at the original position.

- [ ] **Step 2: Run RED**

Run: `npm test -- src/core/utils/contexts/pageTitleRename.test.ts --runInBand`

Expected: FAIL because duplicate renamed rows are not removed.

- [ ] **Step 3: Implement deduplicating row preservation**

Change row preservation to collect the first row matching the renamed path, remove all rows matching that path, and insert the retained row at the original index.

- [ ] **Step 4: Run focused tests**

Run: `npm test -- src/core/utils/contexts/pageTitleRename.test.ts --runInBand`

Expected: PASS.

### Task 5: Verification and Bundle

**Files:**
- Modify generated bundle files: `main.js`, `styles.css` if build output changes.

- [ ] **Step 1: Run full unit tests**

Run: `npm test -- --runInBand`

Expected: all suites pass.

- [ ] **Step 2: Run TypeScript check**

Run: `npx tsc -noEmit -skipLibCheck`

Expected: exit code 0.

- [ ] **Step 3: Run production build**

Run: `npm run build`

Expected: exit code 0 and generated plugin bundle updated if needed.

- [ ] **Step 4: Check whitespace**

Run: `git diff --check -- . ':(exclude)main.js'`

Expected: no whitespace errors.
