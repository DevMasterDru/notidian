import classNames from "classnames";
import React from "react";
import i18n from "shared/i18n";
import { DataHealthViolation } from "shared/types/dataHealth";

// Row-health badge (Notidian-loan.5, ADR-0057 D3/D4): a small, severity-tinted
// affordance rendered in a data row's gutter when the row currently has ANY
// live violation (per the reconciler's read API — see reconciler.ts's own
// public-API doc comment). Plain text/CSS only — NO dangerouslySetInnerHTML,
// per ADR-0057 D3 and the ADR-0017/0019 sanitize invariant (this is the one
// affordance in the row-rendering surface that is deliberately NOT a
// sticker-icon button, unlike HubRowIndicator's precedent).
//
// This component carries no gating logic of its own (the caller — TableView,
// flag-gated on settings.enableDataHealthSurfaces — only renders it once it
// has already resolved the row's violations), so it stays trivially testable:
// given `violations`, it renders (or renders nothing for an empty list),
// tints by the WORST severity present (error beats warn), and surfaces every
// violation's message (+ code) in a native `title` tooltip.
const severityRank = (severity: DataHealthViolation["severity"]): number =>
  severity == "error" ? 2 : 1;

const worstViolation = (violations: DataHealthViolation[]): DataHealthViolation | null =>
  violations.length == 0
    ? null
    : violations.reduce((worst, v) =>
        severityRank(v.severity) > severityRank(worst.severity) ? v : worst
      );

export const RowHealthBadge = (props: {
  violations: DataHealthViolation[];
  onOpenMenu?: (e: React.MouseEvent) => void;
}) => {
  const violations = props.violations ?? [];
  const worst = worstViolation(violations);
  if (!worst) return null;

  const tooltip = violations
    .map((v) => `${v.message}${v.code ? ` (${v.code})` : ""}`)
    .join("\n");

  return (
    <button
      type="button"
      className={classNames(
        "mk-row-health-badge",
        worst.severity == "error"
          ? "mk-row-health-badge--error"
          : "mk-row-health-badge--warn"
      )}
      data-violation-count={violations.length}
      data-violation-code={worst.code}
      data-repair-tier={worst.repairTier}
      title={tooltip}
      aria-label={i18n.labels.rowHealthBadge}
      onClick={(e) => {
        e.stopPropagation();
        props.onOpenMenu?.(e);
      }}
    >
      <span className="mk-row-health-badge-dot" aria-hidden="true"></span>
      {violations.length > 1 ? (
        <span className="mk-row-health-badge-count">{violations.length}</span>
      ) : null}
    </button>
  );
};
