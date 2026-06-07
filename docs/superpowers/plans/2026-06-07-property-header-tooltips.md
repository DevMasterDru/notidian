# Property Header Tooltips Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add polished hover tooltips for Notidian table property headers while ensuring frontmatter-backed headers show readable labels generated from canonical YAML keys.

**Architecture:** Add a pure header-name helper, use it from the table header component, and render a scoped Notidian portal tooltip above the header text. The helper turns keys like `sensor_id` into labels like `Sensor ID`, uses that beautiful label as the tooltip text, keeps the canonical YAML key as metadata, and exposes whether the generated label differs from the raw key so the UI can apply a very faint hairline marker. A small positioning helper keeps the portal tooltip above the anchor and clamped inside the viewport.

**Tech Stack:** TypeScript, React, Jest, Obsidian/Notidian CSS variables.

---

## File Structure

- Create: `src/core/utils/contexts/propertyHeaderName.ts`
  - Owns the generated-label, canonical-key, and generated-label marker rules for table property headers.
- Create: `src/core/utils/contexts/propertyHeaderName.test.ts`
  - Covers frontmatter-backed aliases, generated labels, Notidian-owned aliases, and canonical fallback.
- Create: `src/core/utils/contexts/propertyHeaderTooltipPosition.ts`
  - Calculates above-header tooltip position and arrow offset.
- Create: `src/core/utils/contexts/propertyHeaderTooltipPosition.test.ts`
  - Covers above-header placement and viewport clamping.
- Modify: `src/core/utils/contexts/propertyNameValue.ts`
  - Prevents new frontmatter-backed header-name aliases.
- Modify: `src/core/utils/contexts/propertyNameValue.test.ts`
  - Covers the frontmatter-backed name-input no-op.
- Modify: `src/core/react/components/SpaceView/Contexts/TableView/ColumnHeader.tsx`
  - Uses the helper for visible header text, beautiful tooltip text, and generated-label marker class.
- Modify: `src/css/SpaceViewer/TableView.css`
  - Keeps table header property names ellipsized without CSS-transforming the key and adds the faint generated-label marker.

### Task 1: Header Display Helper

**Files:**
- Create: `src/core/utils/contexts/propertyHeaderName.ts`
- Create: `src/core/utils/contexts/propertyHeaderName.test.ts`

- [x] **Step 1: Write the failing test**

```typescript
import { frontmatterPropertySource } from "core/utils/properties/allProperties";
import { propertyHeaderDisplayName } from "./propertyHeaderName";

describe("propertyHeaderDisplayName", () => {
  it("shows generated labels for frontmatter-backed table headers", () => {
    expect(
      propertyHeaderDisplayName({
        name: "sensor_id",
        type: "text",
        value: JSON.stringify({ alias: "Sensor Identifier" }),
        source: frontmatterPropertySource,
      })
    ).toBe("Sensor ID");
  });

  it("keeps aliases for Notidian-owned fields", () => {
    expect(
      propertyHeaderDisplayName({
        name: "manual_status",
        type: "text",
        value: JSON.stringify({ alias: "Status" }),
      })
    ).toBe("Status");
  });

  it("falls back to the canonical field name when no alias is present", () => {
    expect(
      propertyHeaderDisplayName({
        name: "priority",
        type: "text",
        value: "",
      })
    ).toBe("priority");
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `npm test -- propertyHeaderName.test.ts --runInBand`

Expected: FAIL because `propertyHeaderName.ts` does not exist.

- [x] **Step 3: Write minimal implementation**

```typescript
import type { SpaceTableColumn } from "shared/types/mdb";
import { nameForField } from "core/utils/frames/frames";
import { isFrontmatterBackedProperty } from "core/utils/properties/allProperties";

const propertyHeaderTokenLabels: Record<string, string> = {
  ai: "AI",
  id: "ID",
  llm: "LLM",
  mqtt: "MQTT",
};

export const propertyHeaderLabelForKey = (key: string): string =>
  key
    .trim()
    .split(/[^A-Za-z0-9]+/)
    .filter((token) => token.length > 0)
    .map((token) => {
      const normalized = token.toLowerCase();
      return (
        propertyHeaderTokenLabels[normalized] ??
        `${normalized.charAt(0).toUpperCase()}${normalized.slice(1)}`
      );
    })
    .join(" ") || key;

export const propertyHeaderDisplayName = (
  field: Pick<SpaceTableColumn, "name" | "type" | "value" | "source">
): string => {
  if (isFrontmatterBackedProperty(field)) {
    return propertyHeaderLabelForKey(field.name);
  }
  return nameForField(field) ?? field.name;
};
```

- [x] **Step 4: Run test to verify it passes**

Run: `npm test -- propertyHeaderName.test.ts --runInBand`

Expected: PASS.

### Task 2: Wire Header Rendering And Tooltip

**Files:**
- Modify: `src/core/react/components/SpaceView/Contexts/TableView/ColumnHeader.tsx`
- Modify: `src/css/SpaceViewer/TableView.css`

- [x] **Step 1: Use the helper in `ColumnHeader.tsx`**

Replace the `nameForField` import with:

```typescript
import { propertyHeaderNameInfo } from "core/utils/contexts/propertyHeaderName";
```

Import the portal and positioning helpers:

```typescript
import { createPortal } from "react-dom";
import {
  propertyHeaderTooltipPosition,
  PropertyHeaderTooltipPosition,
  PropertyHeaderTooltipRect,
} from "core/utils/contexts/propertyHeaderTooltipPosition";
```

Before the `return`, add tooltip state and hover handlers that compute the anchor rect, position the tooltip above the header, and hide it on mouse leave, resize, or scroll:

```typescript
  const headerNameInfo = field ? propertyHeaderNameInfo(field) : null;
  const headerName = headerNameInfo?.displayName ?? "";
```

While the portal tooltip is active, add `mk-property-header-tooltip-visible` to the active document body so Obsidian's native `.tooltip` node is hidden during the same hover.

Replace the header key element with:

```tsx
            <div
              ref={propertyHeaderRef}
              className="mk-path-context-field-key mk-property-header-name"
              onMouseEnter={showPropertyHeaderTooltip}
              onMouseLeave={hidePropertyHeaderTooltip}
            >
              <span className="mk-property-header-name-text">
                {headerName}
              </span>
            </div>
```

- [x] **Step 2: Add scoped header text and tooltip CSS**

Append near the `.mk-col-header` rules in `src/css/SpaceViewer/TableView.css`:

```css
.mk-property-header-name {
  position: relative;
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-transform: none;
}

.mk-property-header-name-text {
  display: block;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  text-transform: none;
}

.mk-property-header-tooltip {
  position: fixed;
  pointer-events: none;
  max-width: min(360px, calc(100vw - 24px));
  padding: 9px 12px;
  border-radius: 8px;
}

body.mk-property-header-tooltip-visible > .tooltip {
  display: none !important;
}
```

- [x] **Step 3: Run focused tests**

Run: `npm test -- propertyHeaderName.test.ts --runInBand`

Expected: PASS.

### Task 3: Prevent New Frontmatter Header Aliases

**Files:**
- Modify: `src/core/utils/contexts/propertyNameValue.test.ts`
- Modify: `src/core/utils/contexts/propertyNameValue.ts`

- [x] **Step 1: Write the failing test**

Change the first assertion in `propertyNameValue.test.ts` so the expected frontmatter-backed result preserves the original value without adding `alias`.

- [x] **Step 2: Run test to verify it fails**

Run: `npm test -- propertyNameValue.test.ts --runInBand`

Expected: FAIL because the helper still writes `alias`.

- [x] **Step 3: Write minimal implementation**

```typescript
  if (isFrontmatterBackedProperty(field)) {
    return { ...field };
  }
```

Place this before the invalid-name/non-editable alias branch.

- [x] **Step 4: Run focused tests**

Run: `npm test -- propertyNameValue.test.ts propertyHeaderName.test.ts --runInBand`

Expected: PASS.

### Task 4: Verification

**Files:**
- No source edits unless verification exposes an issue.

- [x] **Step 1: Run full Jest suite**

Run: `npm test -- --runInBand`

Expected: PASS.

- [x] **Step 2: Run TypeScript check**

Run: `npx tsc -noEmit -skipLibCheck`

Expected: exit 0.

- [x] **Step 3: Run production build**

Run: `npm run build`

Expected: exit 0.

- [x] **Step 4: Run live health audit**

Run: `npm run health:audit -- --live`

Expected: exit 0, with Notidian enabled/loaded and native Bases disabled.

## Self-Review

- Spec coverage: all approved requirements map to Tasks 1-3.
- Placeholder scan: no `TBD`, `TODO`, or vague steps remain.
- Type consistency: `propertyHeaderDisplayName` accepts the subset used by tests and `ColumnHeader`.
