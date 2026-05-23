# Page Title Cell Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the built-in file/name column in context tables inline-editable, with edits renaming the underlying Markdown file.

**Architecture:** Add a small pure utility module for page-title projection and validation, then add an explicit row rename callback in `ContextEditorContext`. `DataTypeView` routes only the built-in `File` column to a dedicated `PageTitleCell`, leaving normal text/frontmatter columns unchanged.

**Tech Stack:** TypeScript, React, Jest, existing Notidian `spaceManager.renamePath` and table context infrastructure.

---

### Task 1: Add Page Title Utilities

**Files:**
- Create: `src/core/utils/contexts/pageTitle.ts`
- Test: `src/core/utils/contexts/pageTitle.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
import {
  buildPageTitleRename,
  pageTitleFromPath,
  validatePageTitle,
} from "./pageTitle";

describe("page title utilities", () => {
  it("uses the file basename without extension as the display title", () => {
    expect(pageTitleFromPath("Relays & Devices/Veg - Mix Pump.md")).toBe(
      "Veg - Mix Pump"
    );
  });

  it("builds a same-folder target path and preserves the extension", () => {
    expect(
      buildPageTitleRename(
        "Relays & Devices/Veg - Mix Pump.md",
        "Veg - Main Pump"
      )
    ).toEqual({
      oldPath: "Relays & Devices/Veg - Mix Pump.md",
      newPath: "Relays & Devices/Veg - Main Pump.md",
      title: "Veg - Main Pump",
    });
  });

  it("rejects empty and path-like titles", () => {
    expect(validatePageTitle("").ok).toBe(false);
    expect(validatePageTitle("Other/Name").ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run the tests to verify RED**

Run: `npx jest src/core/utils/contexts/pageTitle.test.ts --runInBand`

Expected: FAIL because `pageTitle.ts` does not exist.

- [ ] **Step 3: Implement the utilities**

```typescript
export type PageTitleValidation =
  | { ok: true; title: string }
  | { ok: false; reason: string };

export type PageTitleRename = {
  oldPath: string;
  newPath: string;
  title: string;
};

export const pageTitleFromPath = (path: string): string => {
  const fileName = path.split("/").pop() ?? path;
  const extensionIndex = fileName.lastIndexOf(".");
  return extensionIndex > 0 ? fileName.slice(0, extensionIndex) : fileName;
};

export const validatePageTitle = (title: string): PageTitleValidation => {
  const trimmed = title.trim();
  if (trimmed.length == 0) return { ok: false, reason: "empty" };
  if (trimmed.includes("/")) return { ok: false, reason: "slash" };
  return { ok: true, title: trimmed };
};

export const buildPageTitleRename = (
  oldPath: string,
  title: string
): PageTitleRename => {
  const validation = validatePageTitle(title);
  if (!validation.ok) throw new Error(validation.reason);
  const lastSlash = oldPath.lastIndexOf("/");
  const parent = lastSlash >= 0 ? oldPath.slice(0, lastSlash) : "";
  const fileName = lastSlash >= 0 ? oldPath.slice(lastSlash + 1) : oldPath;
  const extensionIndex = fileName.lastIndexOf(".");
  const extension = extensionIndex > 0 ? fileName.slice(extensionIndex) : "";
  const newPath = parent
    ? `${parent}/${validation.title}${extension}`
    : `${validation.title}${extension}`;
  return { oldPath, newPath, title: validation.title };
};
```

- [ ] **Step 4: Run the tests to verify GREEN**

Run: `npx jest src/core/utils/contexts/pageTitle.test.ts --runInBand`

Expected: PASS.

### Task 2: Add Rename Operation To Context Editor

**Files:**
- Modify: `src/core/react/context/ContextEditorContext.tsx`
- Test: `src/core/react/context/pageTitleRename.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
import { renamePageTitleForRow } from "./ContextEditorContext";
import { PathPropertyName } from "shared/types/context";

describe("renamePageTitleForRow", () => {
  it("renames the underlying file instead of writing a context value", async () => {
    const renamePath = jest.fn(async (_oldPath, newPath) => newPath);
    const pathExists = jest.fn(async (path) => path.endsWith("Existing.md"));
    const reloadContextByPath = jest.fn(async () => undefined);
    const notify = jest.fn();

    const result = await renamePageTitleForRow({
      row: { [PathPropertyName]: "Relays & Devices/Old.md" },
      value: "New",
      contextPath: "Relays & Devices",
      superstate: {
        spaceManager: { pathExists, renamePath },
        reloadContextByPath,
        ui: { notify },
      } as any,
    });

    expect(result).toBe("Relays & Devices/New.md");
    expect(renamePath).toHaveBeenCalledWith(
      "Relays & Devices/Old.md",
      "Relays & Devices/New.md"
    );
    expect(reloadContextByPath).toHaveBeenCalledWith("Relays & Devices", {
      force: true,
      calculate: true,
    });
    expect(notify).not.toHaveBeenCalled();
  });

  it("rejects duplicate target paths", async () => {
    const renamePath = jest.fn();
    const notify = jest.fn();

    const result = await renamePageTitleForRow({
      row: { [PathPropertyName]: "Relays & Devices/Old.md" },
      value: "Existing",
      contextPath: "Relays & Devices",
      superstate: {
        spaceManager: {
          pathExists: jest.fn(async () => true),
          renamePath,
        },
        ui: { notify },
      } as any,
    });

    expect(result).toBeNull();
    expect(renamePath).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the tests to verify RED**

Run: `npx jest src/core/react/context/pageTitleRename.test.ts --runInBand`

Expected: FAIL because `renamePageTitleForRow` is not exported.

- [ ] **Step 3: Implement the rename helper and expose it through context**

Add `renamePageTitleForRow` near the top-level exports in `ContextEditorContext.tsx`, then add `renameRowTitle` to `ContextEditorContextProps`, default context, provider value, and the `DataTypeView` wiring.

- [ ] **Step 4: Run the targeted tests**

Run: `npx jest src/core/react/context/pageTitleRename.test.ts --runInBand`

Expected: PASS.

### Task 3: Add The PageTitleCell UI

**Files:**
- Create: `src/core/react/components/SpaceView/Contexts/DataTypeView/PageTitleCell.tsx`
- Modify: `src/core/react/components/SpaceView/Contexts/DataTypeView/DataTypeView.tsx`
- Modify: `src/core/react/components/SpaceView/Contexts/TableView/TableView.tsx`

- [ ] **Step 1: Implement `PageTitleCell`**

Create a focused cell component that displays `pageTitleFromPath(initialValue)`, edits inline with `contentEditable`, commits through `renameValue`, cancels with `Escape`, opens the path on modifier-click, and restores display text after failed saves.

- [ ] **Step 2: Wire the rename callback**

Extend `DataTypeViewProps` with `renameValue?: (value: string) => Promise<string | null>`, pass it from `TableView`, and route only `fieldType.type == "file"` plus `column.name == PathPropertyName` to `PageTitleCell`.

- [ ] **Step 3: Keep the `File` column selectable/editable**

Change table column metadata from `editable: f.name != PathPropertyName` to `editable: true` for visible cells, relying on `PageTitleCell` for safe rename behavior.

### Task 4: Verify, Build, And Commit

**Files:**
- All touched implementation and test files

- [ ] **Step 1: Run targeted tests**

Run:

```bash
npx jest src/core/utils/contexts/pageTitle.test.ts src/core/react/context/pageTitleRename.test.ts --runInBand
```

Expected: PASS.

- [ ] **Step 2: Run full tests**

Run: `npm test -- --runInBand`

Expected: PASS.

- [ ] **Step 3: Run TypeScript check**

Run: `npx tsc -noEmit -skipLibCheck`

Expected: exit 0.

- [ ] **Step 4: Build plugin bundle**

Run: `npm run build`

Expected: exit 0 and updated `main.js` if bundle output changes.

- [ ] **Step 5: Check whitespace**

Run: `git diff --check -- . ':(exclude)main.js'`

Expected: no output.

- [ ] **Step 6: Commit**

```bash
git add docs/superpowers/specs/2026-05-24-page-title-cell-design.md docs/superpowers/plans/2026-05-24-page-title-cell.md src/core/utils/contexts/pageTitle.ts src/core/utils/contexts/pageTitle.test.ts src/core/react/context/ContextEditorContext.tsx src/core/react/context/pageTitleRename.test.ts src/core/react/components/SpaceView/Contexts/DataTypeView/PageTitleCell.tsx src/core/react/components/SpaceView/Contexts/DataTypeView/DataTypeView.tsx src/core/react/components/SpaceView/Contexts/TableView/TableView.tsx main.js
git commit -m "feat: edit file titles from context tables"
```
