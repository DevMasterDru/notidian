# Table RTL Mode And Row Grip Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add full mirrored RTL mode for Notidian table database views and refine the row drag grip visual design.

**Architecture:** Store table direction as predicate view state using `tableDirection: "ltr" | "rtl"`. The table renderer applies a stable RTL class/`dir` attribute, computes frozen offsets on the logical side, and keeps saved column order canonical. Data-anchor Auto becomes table-direction aware, and the view options menu exposes the whole-table direction setting.

**Tech Stack:** React, TypeScript, TanStack Table, Notidian predicate schemas, Jest, CSS.

---

### Task 1: Predicate Direction State

**Files:**
- Modify: `src/shared/types/predicate.ts`
- Modify: `src/shared/schemas/predicate.tsx`
- Modify: `src/core/utils/contexts/predicate/predicate.tsx`
- Test: `src/core/utils/contexts/predicate/predicate.test.tsx`

- [ ] **Step 1: Write failing predicate validation tests**

Add tests that assert missing or invalid `tableDirection` normalizes to `"ltr"` and `"rtl"` is preserved:

```ts
expect(validatePredicate({ ...defaultTablePredicate, tableDirection: "rtl" }, defaultTablePredicate).tableDirection).toBe("rtl");
expect(validatePredicate({ ...defaultTablePredicate, tableDirection: "bad" as any }, defaultTablePredicate).tableDirection).toBe("ltr");
expect(validatePredicate({ ...defaultTablePredicate, tableDirection: undefined as any }, defaultTablePredicate).tableDirection).toBe("ltr");
```

- [ ] **Step 2: Run the predicate tests and verify RED**

Run: `npm test -- src/core/utils/contexts/predicate/predicate.test.tsx --runInBand`

Expected: Type/test failure because `tableDirection` is not defined or validated yet.

- [ ] **Step 3: Add the minimal predicate implementation**

Add:

```ts
export type TableDirection = "ltr" | "rtl";
```

Add `tableDirection: TableDirection` to `Predicate`, set both default predicates to `"ltr"`, and add a small validation branch:

```ts
const tableDirection = prevPredicate.tableDirection == "rtl" ? "rtl" : defaultPredicate.tableDirection;
```

Include `tableDirection` in the validated return.

- [ ] **Step 4: Run the predicate tests and verify GREEN**

Run: `npm test -- src/core/utils/contexts/predicate/predicate.test.tsx --runInBand`

Expected: PASS.

### Task 2: Direction-Aware Helpers

**Files:**
- Modify: `src/core/utils/contexts/propertyDataAnchor.ts`
- Modify: `src/core/utils/contexts/tableFreeze.ts`
- Test: `src/core/utils/contexts/propertyDataAnchor.test.ts`
- Test: `src/core/utils/contexts/tableFreeze.test.ts`

- [ ] **Step 1: Write failing helper tests**

Add an RTL Auto anchor test:

```ts
expect(columnDataAnchorForCells({
  mode: "auto",
  headerDisplayMode: "full",
  columnWidth: 150,
  values: ["plain english"],
  tableDirection: "rtl",
})).toBe("right");
```

Add RTL sticky offset expectations:

```ts
expect(stickyOffsetsForFrozenColumns({
  columns,
  hiddenColumnIds: [],
  frozenColumnCount: 2,
  columnSizes: { [PathPropertyName]: 220, status: 90 },
  rowGutterWidth: 42,
  tableDirection: "rtl",
})).toEqual({
  [PathPropertyName]: { side: "right", offset: 42, width: 220, isLast: false },
  status: { side: "right", offset: 262, width: 90, isLast: true },
});
```

- [ ] **Step 2: Run helper tests and verify RED**

Run: `npm test -- src/core/utils/contexts/propertyDataAnchor.test.ts src/core/utils/contexts/tableFreeze.test.ts --runInBand`

Expected: FAIL because helpers do not accept or return direction-aware data.

- [ ] **Step 3: Implement direction-aware helpers**

Update `FrozenColumnOffset` to:

```ts
export type FrozenColumnOffset = {
  side: "left" | "right";
  offset: number;
  width: number;
  isLast: boolean;
};
```

Keep LTR behavior semantically identical by returning `side: "left"` and `offset` equal to the old `left` value. Add optional `tableDirection?: TableDirection` input. Update `columnDataAnchorForCells` to accept `tableDirection?: TableDirection` and return `"right"` for Auto in RTL after icon-only centering is checked.

- [ ] **Step 4: Run helper tests and verify GREEN**

Run: `npm test -- src/core/utils/contexts/propertyDataAnchor.test.ts src/core/utils/contexts/tableFreeze.test.ts --runInBand`

Expected: PASS.

### Task 3: View Options Direction Control

**Files:**
- Create: `src/core/react/components/UI/Menus/contexts/TableDirectionMenu.tsx`
- Modify: `src/core/react/components/UI/Menus/contexts/propertyHeaderDisplayMenu.test.tsx`
- Modify: `src/core/react/components/SpaceView/Contexts/FilterBar/FilterBar.tsx`
- Modify: `src/shared/en.ts`
- Modify: `src/shared/i18n.ts`

- [ ] **Step 1: Write failing menu component test**

Add a test that renders `TableDirectionMenuComponent` with `tableDirection="rtl"`, expects `Direction`, `Left to Right`, and `Right to Left`, and clicks the LTR option to call `setTableDirection("ltr")`.

- [ ] **Step 2: Run menu tests and verify RED**

Run: `npm test -- src/core/react/components/UI/Menus/contexts/propertyHeaderDisplayMenu.test.tsx --runInBand`

Expected: FAIL because the component does not exist.

- [ ] **Step 3: Implement the compact direction component**

Create `TableDirectionMenu.tsx` with the same compact segmented style as the existing property display controls:

```tsx
export const TableDirectionMenuComponent = (props: {
  tableDirection: TableDirection;
  setTableDirection: (direction: TableDirection) => void;
  hide: () => void;
}) => { /* render Direction + LTR/RTL segmented buttons */ };
```

Add i18n strings: `direction`, `leftToRight`, `rightToLeft`.

- [ ] **Step 4: Wire the component into the view options menu**

In `FilterBar.tsx`, read `predicate?.tableDirection ?? "ltr"`, add `setTableDirection`, and push the custom menu fragment near `limit`.

- [ ] **Step 5: Run menu tests and verify GREEN**

Run: `npm test -- src/core/react/components/UI/Menus/contexts/propertyHeaderDisplayMenu.test.tsx --runInBand`

Expected: PASS.

### Task 4: Mirrored Table Rendering

**Files:**
- Modify: `src/core/react/components/SpaceView/Contexts/TableView/TableView.tsx`
- Modify: `src/css/SpaceViewer/TableView.css`
- Test: `scripts/notidianTableCss.test.js`

- [ ] **Step 1: Write failing CSS/render-facing tests**

Extend CSS tests to require:

```js
expect(css).toMatch(/\.mk-table-rtl\s*{[^}]*direction:\s*rtl;/s);
expect(css).toMatch(/\.mk-table-rtl \.mk-frozen-row-gutter\s*{[^}]*right:\s*0;/s);
expect(css).toMatch(/\.mk-table-rtl \.mk-frozen-column-last\s*{[^}]*box-shadow:/s);
```

- [ ] **Step 2: Run CSS tests and verify RED**

Run: `npm test -- scripts/notidianTableCss.test.js --runInBand`

Expected: FAIL because RTL CSS does not exist.

- [ ] **Step 3: Update table rendering**

In `TableView.tsx`, derive:

```ts
const tableDirection = predicate?.tableDirection ?? "ltr";
const isRTLTable = tableDirection == "rtl";
```

Add classes and dir:

```tsx
className={classNames("mk-table", isRTLTable && "mk-table-rtl")}
dir={tableDirection}
```

Pass `tableDirection` into `stickyOffsetsForFrozenColumns` and `columnDataAnchorForCells`. Use computed style keys:

```ts
...(frozenOffset ? { [frozenOffset.side]: frozenOffset.offset } : {})
```

- [ ] **Step 4: Add RTL CSS**

Add RTL rules that pin gutter/columns from the right, flip borders/shadows, and avoid broken cell text inheritance:

```css
.mk-table-rtl { direction: rtl; }
.mk-table-rtl .mk-frozen-row-gutter { right: 0; left: auto; }
.mk-table-rtl .mk-frozen-column { left: auto; }
.mk-table-rtl .mk-td { direction: inherit; }
```

- [ ] **Step 5: Run CSS tests and verify GREEN**

Run: `npm test -- scripts/notidianTableCss.test.js --runInBand`

Expected: PASS.

### Task 5: Row Grip Polish

**Files:**
- Modify: `src/css/SpaceViewer/TableView.css`
- Modify: `scripts/notidianTableCss.test.js`

- [ ] **Step 1: Write failing grip CSS assertions**

Assert the grip has a 16px target, themed border/ring, hover fill, and six-dot grip sizing:

```js
expect(css).toMatch(/\.mk-row-drag-handle\s*{[^}]*width:\s*16px;/s);
expect(css).toMatch(/\.mk-row-drag-handle\s*{[^}]*box-shadow:\s*inset 0 0 0 1px/s);
expect(css).toMatch(/\.mk-row-grip\s*{[^}]*width:\s*10px;/s);
expect(css).toMatch(/\.mk-row-grip\s*{[^}]*background-size:\s*5px 4px;/s);
```

- [ ] **Step 2: Run CSS tests and verify RED**

Run: `npm test -- scripts/notidianTableCss.test.js --runInBand`

Expected: FAIL until the polished styles are added.

- [ ] **Step 3: Implement polished grip styles**

Update `.mk-row-drag-handle` and `.mk-row-grip` with a 16px centered control, subtle border/ring, hover/selected/dragging background, and accent grip color while dragging.

- [ ] **Step 4: Run CSS tests and verify GREEN**

Run: `npm test -- scripts/notidianTableCss.test.js --runInBand`

Expected: PASS.

### Task 6: Documentation, Build, Live Verification

**Files:**
- Modify: `docs/current-state.md`
- Modify: `docs/notidian-system-architecture.md`
- Modify: `docs/table-database-workflows.md`
- Modify: `styles.css`
- Modify: `main.js` only if build changes JavaScript bundle output

- [ ] **Step 1: Update docs**

Document that table direction is predicate view state, RTL mode mirrors the row gutter and frozen columns, and Auto data anchor defaults right in RTL.

- [ ] **Step 2: Run full verification**

Run:

```bash
npm test -- --runInBand
npx tsc -noEmit -skipLibCheck
npm run build
npm run health:audit -- --live
```

Expected: all exit 0.

- [ ] **Step 3: Install and reload in Atlas Vault**

Run:

```bash
npm run install:vault -- --vault-path="/Users/druker/Atlas Vault" --allow-write
obsidian plugin:reload id=notidian
```

Expected: plugin installs and reloads.

- [ ] **Step 4: Live DOM checks**

Use `obsidian eval` to set the active table predicate direction to RTL, then verify `.mk-table-rtl`, `dir="rtl"`, right-side gutter geometry, and that the drag grip remains centered above the gutter number. Restore the original table direction after the measurement and confirm no captured errors.

- [ ] **Step 5: Commit**

Run:

```bash
git status --short
git add src/shared/types/predicate.ts src/shared/schemas/predicate.tsx src/core/utils/contexts/predicate/predicate.tsx src/core/utils/contexts/predicate/predicate.test.tsx src/core/utils/contexts/propertyDataAnchor.ts src/core/utils/contexts/propertyDataAnchor.test.ts src/core/utils/contexts/tableFreeze.ts src/core/utils/contexts/tableFreeze.test.ts src/core/react/components/UI/Menus/contexts/TableDirectionMenu.tsx src/core/react/components/UI/Menus/contexts/propertyHeaderDisplayMenu.test.tsx src/core/react/components/SpaceView/Contexts/FilterBar/FilterBar.tsx src/core/react/components/SpaceView/Contexts/TableView/TableView.tsx src/css/SpaceViewer/TableView.css scripts/notidianTableCss.test.js src/shared/en.ts src/shared/i18n.ts docs/current-state.md docs/notidian-system-architecture.md docs/table-database-workflows.md styles.css main.js
git commit -m "feat: add rtl table direction mode"
```

Expected: commit contains only the RTL table mode, row grip polish, docs, and generated bundle updates.
