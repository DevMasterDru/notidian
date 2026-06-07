# Property Header Display Modes Design

## Context

Notidian table headers now generate readable labels from canonical frontmatter keys and show a custom tooltip. The next requirement is compactness control: sometimes a column should show icon plus text, sometimes text only, and sometimes only the icon.

## Decision

Add per-column header display modes saved as Notidian view state:

- `Adaptive`: default. Uses column width to compact from icon+text to text-only to icon-only.
- `Icon + Text`: always renders both parts.
- `Text Only`: hides the icon and renders the generated label.
- `Icon Only`: hides text and renders the configured or field-type icon.

These modes are stored in predicate `colsHeaderDisplay`, keyed by the same column id used for width, hidden, and frozen-column state. They do not write Markdown frontmatter and do not create display aliases.

## Icon Configuration

Icon configuration lives beside the header-name input at the top of the column menu. The current icon appears to the left of the input and opens the picker. The picker contains a `Default` control that removes the configured `icon` attr and returns the header to the field-type default icon. Setting and resetting icons preserve unrelated column attrs and preserve the current column width before any icon-triggered schema refresh.

## Tooltip

The custom tooltip remains available in every display mode, including icon-only. It shows the beautiful rendered header label.

## Testing

Focused tests cover:

- display-mode parsing and adaptive width thresholds;
- predicate validation for `colsHeaderDisplay`;
- icon set/reset helper behavior.
