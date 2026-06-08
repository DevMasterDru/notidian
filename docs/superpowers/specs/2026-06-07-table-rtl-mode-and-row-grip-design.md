# Table RTL Mode And Row Grip Design

## Goal

Make Notidian tables feel native for Hebrew/right-to-left databases while keeping
ordinary left-to-right databases unchanged. Also refine the row drag grip so it
looks intentional instead of like a raw dotted handle.

## Chosen Approach

Use a full mirrored table mode stored as Notidian predicate view state.

Rejected alternatives:

- Text-only RTL: right-aligns text but leaves the row gutter, frozen columns,
  and navigation model left-to-right. This is visually inconsistent for Hebrew
  databases.
- Per-column RTL: useful for mixed content, but it does not solve whole-table
  database direction and would duplicate the existing data-anchor controls.

The mode is per database view, not global settings and not frontmatter. It should
write only predicate view state.

## Predicate State

Add `tableDirection` to `Predicate`:

- `"ltr"` is the default and is omitted/normalized when older predicates have no
  value.
- `"rtl"` enables full mirrored table behavior.
- Invalid values normalize back to `"ltr"`.

This field is independent of `colsDataAnchor`. Explicit column anchors continue
to win over automatic behavior.

## UI

Add a compact direction control in the existing view-options menu, near other
whole-view controls such as limit/source/list:

- Label: `Direction`
- Options: `Left to Right` and `Right to Left`
- The active option uses the same compact active segmented style as header
  display and data anchor.

Do not place this in the column header dropdown. Column dropdowns configure a
single property; table direction configures the whole database view.

## Full Mirrored Table Behavior

When `tableDirection` is `"rtl"`:

- The table wrapper receives a stable RTL class and `dir="rtl"`.
- The row-number gutter renders on the right side of the grid.
- Columns visually flow right-to-left.
- Frozen columns pin from the right, not the left.
- The frozen gutter pins to the right.
- Frozen shadow/border treatment flips so the visible edge stays at the unfrozen
  side.
- Column resizing, drag order, row selection, row dragging, pagination, and
  sorting/filtering semantics remain view-state operations and do not write
  Markdown frontmatter.
- Text entry inside cells must not inherit broken browser mirroring. Cell
  content keeps its own natural writing direction where existing editors already
  do that; Notidian only mirrors the table chrome and default alignment.

## Data Anchor Defaults

`Auto` data anchoring becomes direction-aware:

- Icon-only columns still center.
- Explicit `Left`, `Center`, and `Right` still override all automatic behavior.
- In RTL table mode, Auto defaults to right.
- In LTR table mode, Auto keeps the existing behavior: right-align visible
  Hebrew/RTL data, otherwise left-align.

This keeps Hebrew databases readable by default without taking away per-column
control.

## Keyboard And Ordering

The saved column order remains the canonical view order. RTL mode mirrors visual
presentation, not storage. Keyboard left/right movement should follow the visual
table direction:

- In LTR, `ArrowRight` moves to the next visual column.
- In RTL, `ArrowRight` moves to the previous saved-order column because that is
  visually to the right.

Column drag reordering should continue saving the visual order users create.
The implementation keeps DOM/saved order canonical and lets the RTL table
direction mirror the visual order. Drag handlers continue to save `colsOrder`
from active and target column ids.

## Row Drag Grip Polish

Keep the grip above the gutter number, but make it look like a deliberate small
control:

- 16px square target with an 8px radius.
- Soft menu/background fill on hover, focus, selected, and dragging states.
- Border or inset ring using Obsidian/Notidian theme variables.
- Subtle six-dot grip with muted color at rest and accent color while dragging.
- It must not reserve gutter width and must stay centered over the row number in
  both LTR and RTL.

## Testing

Add focused tests for:

- predicate validation/defaulting for `tableDirection`;
- direction-aware sticky offsets that return `left` offsets for LTR and `right`
  offsets for RTL;
- direction-aware Auto data anchoring;
- CSS rules for the polished row grip and RTL frozen gutter/column mirroring;
- the view-options direction control rendering and invoking `setTableDirection`.

Live verification should install the built plugin into Atlas Vault, reload
Notidian, and inspect the DOM for:

- `.mk-table-rtl` and `dir="rtl"` when enabled;
- row gutter on the right side;
- frozen offsets using right-side CSS in RTL;
- the drag grip still centered above the gutter number;
- no captured Obsidian errors.
