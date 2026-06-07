# Property Header Tooltips Design

## Context

Notidian table headers can become narrow enough that property names are truncated. The requested feature is a polished hover tooltip that shows the full property name, while also making snake-case frontmatter keys readable in the header.

During review, we confirmed that Make.md's upstream alias behavior was intentional for its broader context database model. Make.md contexts can store schema/data in context SQLite files, and field aliases support user-facing labels for internal or non-editable fields. Notidian's current architecture is narrower: ordinary Markdown note metadata is owned by frontmatter, so frontmatter-backed table headers should not hide the canonical YAML key behind a stored display alias.

## Decision

Add a table-header tooltip while tightening the display invariant for ordinary frontmatter-backed properties.

- Frontmatter-backed columns render a deterministic generated label from the canonical `field.name`, such as `sensor_id` -> `Sensor ID`.
- Context-owned and other non-frontmatter fields continue to render `nameForField(field)`, preserving Make.md-style aliases where aliases still describe Notidian-owned view/schema state.
- The tooltip shows the full rendered header label, including the generated beautiful label for frontmatter-backed columns.
- Generated frontmatter labels get a very faint hairline marker only when the displayed label differs from the raw key.
- Header display can be forced per column to `Adaptive`, `Icon + Text`, `Text Only`, or `Icon Only`.
- Existing frontmatter-backed aliases remain in view schema data but are ignored by the table header.
- New header-name edits for frontmatter-backed fields are ignored rather than stored as display aliases.
- `Rename Frontmatter Key` remains the explicit command for changing a YAML/frontmatter key.

## UI Behavior

The tooltip appears when hovering the property-name text in a table header. It renders through a Notidian-owned React portal into the active document body, so it is not constrained by the table's horizontal scroll container and can use a scoped Notidian visual style instead of Obsidian's default black tooltip.

The tooltip should:

- appear above the header text after hover;
- use a slightly larger, readable text treatment;
- use a tinted theme surface rather than a black native tooltip;
- show the full rendered property label with normal capitalization, not CSS-transformed capitalization;
- use a very faint hairline marker on generated labels that differ from their raw key;
- allow icon-only and text-only header display modes without changing the tooltip;
- avoid intercepting clicks, drags, or resize handles;
- keep the full property name in DOM text so assistive technology can read it without triggering Obsidian's global black tooltip.

## Architecture

Add a pure helper that chooses the header display name:

- frontmatter-backed fields: a generated label from `field.name`, the generated tooltip label, `field.name` as canonical metadata, and a flag for labels that differ from the key;
- all other fields: `nameForField(field) ?? field.name`.

Use that helper in `ColumnHeader.tsx` for both visible text and tooltip text. A small tested positioning helper places the portal tooltip above the header, centers the arrow over the property label, and clamps the tooltip inside the viewport. While the Notidian tooltip is visible, the document body gets a temporary class that hides Obsidian's native `.tooltip` node; this prevents Obsidian's global truncated-text tooltip from showing a second black tooltip below the header. Update `fieldForPropertyNameInput` so frontmatter-backed name input edits preserve the existing field instead of writing aliases. This keeps the frontmatter authority decision testable without rendering React.

Per-column header display mode is stored in predicate view state as `colsHeaderDisplay`, keyed by the existing table column id. Icon configuration stays in column attrs; resetting the icon removes only the configured `icon` attr.

## Testing

Add focused unit tests for the helper:

- frontmatter-backed aliases are ignored in table headers;
- frontmatter-backed snake-case keys render generated labels with common technical acronyms;
- frontmatter-backed generated labels are marked when the displayed label differs from the raw key;
- Notidian-owned/context aliases continue to render;
- empty or missing alias data falls back to the canonical field name.
- frontmatter-backed property-name input preserves the canonical field without writing an alias.
- tooltip positioning stays above the header and clamps within the viewport.
- header display modes resolve full/text/icon visibility deterministically.
- predicate validation preserves valid header display modes and drops invalid ones.

Then run the standard source and live-health verification set before claiming plugin health:

```bash
npm test -- --runInBand
npx tsc -noEmit -skipLibCheck
npm run build
npm run health:audit -- --live
```

## Self-Review

- No placeholders remain.
- The design preserves ADR 0014 and ADR 0015: ordinary data remains canonical in files/frontmatter, and schema key changes use the explicit rename flow.
- Scope is limited to table header display and tooltip behavior.
