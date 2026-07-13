import classNames from "classnames";
import React from "react";
import i18n from "shared/i18n";

// Read-only lock badge (Notidian-loan.15, Atlas Method ADR-0069): a small,
// NON-INTERACTIVE affordance rendered in a data row's gutter when the row's
// reserved `locked` system field resolves truthy. DISPLAY ONLY — there is no
// onClick, no click-to-unlock, and no write path of any kind; the owner is the
// authority on the direct-UI path (ADR-0069 D2 scopes lock PREVENTION to the
// MCP write path, not this render surface).
//
// Sanitize invariant (ADR-0017/0019): plain text + CSS only — NO
// dangerouslySetInnerHTML / innerHTML / inline SVG. The lock glyph is a pure
// CSS-icon `<span>` (`.mk-lock-badge-icon`), styled in TableView.css.
//
// The flag gate is threaded in as the `enabled` prop rather than read here:
// this is a flag-gated core render-path change, so the component self-gates on
// BOTH `enabled` and `locked` to make the entire flag-OFF / locked-false /
// locked-true matrix provable offline (LockBadge.dom.test.tsx) without mounting
// the full TableView, and to give defense-in-depth if a future call site forgets
// the gate. It renders NOTHING unless the flag is ON *and* the row is locked.

// Pure truthiness resolver for the reserved `locked` frontmatter value — a real
// YAML boolean (`locked: true`) or its string form (`locked: "true"`), the same
// two shapes the boolean coercion path in validateRow accepts. Everything else
// (false, "false", absent, null, any other value) is "not locked". Exported for
// the TableView call site to resolve the row value and for unit coverage.
export const isLockedValue = (value: unknown): boolean =>
  value === true || value === "true";

export const LockBadge = (props: {
  enabled?: boolean;
  locked?: boolean;
}): React.ReactElement | null => {
  if (props.enabled !== true || props.locked !== true) return null;

  return (
    <span
      className={classNames("mk-lock-badge")}
      title={i18n.labels.lockBadge}
      aria-label={i18n.labels.lockBadge}
      role="img"
    >
      <span className="mk-lock-badge-icon" aria-hidden="true"></span>
    </span>
  );
};
