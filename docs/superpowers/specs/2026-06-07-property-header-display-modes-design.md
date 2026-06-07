# Property Header Display Modes Design

## Context

Notidian table headers now generate readable labels from canonical frontmatter keys and show a custom tooltip. The next requirement is compactness control: sometimes a column should show icon plus text, sometimes text only, and sometimes only the icon.

## Decision

Add per-column header display modes saved as Notidian view state:

- `Adaptive`: default. Uses column width to compact from icon+text to text-only to icon-only.
- `Icon + Text`: always renders both parts.
- `Text Only`: hides the icon and renders the generated label.
- `Icon Only`: hides text and auxiliary context marker text, renders only the configured or field-type icon, and allows the column to resize to the 24px sticker footprint: an 18px sticker plus 3px of side padding on each side. At collapsed widths, boolean/Yes-No body cells use compact checkbox padding so cell content does not force the column wider than the header.

Header, body, and aggregate cells set `width`, `minWidth`, and `maxWidth`. This is required because browser table layout can stretch a cell that only has min/max constraints. Saved 18px and 26px widths from earlier collapsed-header builds are treated as old compact minima and normalized to 24px when loaded; deliberate widths at or above the new minimum are preserved.

The row-number gutter is not fixed-width CSS. It is computed from the largest visible row number: 24px for one digit, 30px for two digits, 36px for three digits, and so on. The row drag grip overlays above the gutter number so it does not force the row-number column wider while hidden.

These modes are stored in predicate `colsHeaderDisplay`, keyed by the same column id used for width, hidden, and frozen-column state. They do not write Markdown frontmatter and do not create display aliases.

Data anchoring is stored separately as predicate view state in `colsDataAnchor`. `Auto` is represented by no saved override. Explicit `Left`, `Center`, and `Right` choices override automatic behavior. Automatic anchoring centers icon-only columns, right-aligns columns whose visible data contains Hebrew/RTL text, and left-aligns all other data.

## Icon Configuration

Icon configuration lives beside the header-name input at the top of the column menu. The current icon appears to the left of the input and opens the picker. The picker contains a `Default` control that removes the configured `icon` attr and returns the header to the field-type default icon. Setting and resetting icons preserve unrelated column attrs and preserve the current column width before any icon-triggered schema refresh.

## Tooltip

The custom tooltip remains available in every display mode, including icon-only. It shows the beautiful rendered header label.

## Testing

Focused tests cover:

- display-mode parsing and adaptive width thresholds;
- 24px sticker-only minimum column width, persisted width clamping, and legacy 18px/26px normalization;
- row-number gutter width by visible row-number digit count;
- compact boolean body-cell padding at collapsed widths;
- predicate validation for `colsHeaderDisplay` and `colsDataAnchor`;
- automatic data anchoring for icon-only and Hebrew/RTL columns;
- icon set/reset helper behavior.
