import { pageTitleFromPath } from "core/utils/contexts/pageTitle";
import { Superstate } from "makemd-core";
import React, { useEffect, useState } from "react";
import i18n from "shared/i18n";
import { DataHealthViolation } from "shared/types/dataHealth";

// Database Health panel (Notidian-loan.5, ADR-0057 D3/D4) — mirrors
// SyncWarnings.tsx's modal vocabulary (mk-modal-contents/-heading/
// -description/-card/-button-group) so it costs zero new CSS beyond the
// health-specific tints TableView.css already carries for the badge/broken
// row. Plain text only, per ADR-0057 D3 + the ADR-0017/0019 sanitize
// invariant — no dangerouslySetInnerHTML anywhere in this file.
//
// Two views, switched by LOCAL state (never a route/prop change, so opening
// from the FilterBar chip always lands on that database's own view first):
//   - "db": one card per violating row in `dbPath`, PLUS a sweep-incomplete
//     card when the reconciler's sweep mechanism itself could not account for
//     every row — see reconciler.ts's own SweepIncompleteInfo doc comment.
//     The header total uses the EXACT SAME formula as `getViolationCount`
//     (which itself counts a sweep-incomplete flag as +1) so this panel's
//     total always equals the FilterBar chip's count for the same dbPath —
//     a DoD assertion, not just a nicety.
//   - "vault": every database currently holding any violation/sweep flag
//     (getAllDbPaths), each with ITS own getViolationCount — click one to
//     jump into its "db" view (with a Back-equivalent "All databases" link
//     to return).
export const formatIssueCount = (n: number): string =>
  n == 1
    ? i18n.labels.databaseHealthIssueSingular
    : i18n.labels.databaseHealthIssueCount.replace("${1}", String(n));

const tierLabel = (tier: string): string =>
  tier == "autofix"
    ? i18n.labels.repairTierAutofix
    : tier == "one-click"
    ? i18n.labels.repairTierOneClick
    : i18n.labels.repairTierManual;

export const showDatabaseHealthModal = (
  superstate: Superstate,
  dbPath: string,
  win: Window
): void => {
  superstate.ui.openModal(
    i18n.labels.databaseHealth,
    <DatabaseHealthPanel superstate={superstate} dbPath={dbPath} />,
    win
  );
};

type PanelView = { mode: "db"; dbPath: string } | { mode: "vault" };

export const DatabaseHealthPanel = (props: {
  superstate: Superstate;
  dbPath?: string;
  hide?: () => void;
}) => {
  const { superstate } = props;
  const [view, setView] = useState<PanelView>(
    props.dbPath ? { mode: "db", dbPath: props.dbPath } : { mode: "vault" }
  );
  // Forces a re-render on any reconciler mutation while the panel is open
  // (row fixed elsewhere, a sweep completes, ...) — same onChange subscribe
  // idiom TableView/FilterBar use; the actual counts are read fresh below,
  // never cached, so there is nothing else to keep in sync. Unlike those two
  // (db-scoped, Notidian-loan.5 review round 2 unit S1), this panel is
  // vault-aware — it can show every database's own count (the "vault" view)
  // or one database's own (the "db" view, switchable via local state without
  // remounting) — so it deliberately IGNORES the onChange dbPath argument
  // and always bumps, regardless of which database mutated.
  const [, setBump] = useState(0);
  useEffect(() => {
    const unsubscribe = superstate.reconciler?.onChange(() =>
      setBump((n) => n + 1)
    );
    return () => unsubscribe?.();
  }, [superstate.reconciler]);

  // Notidian-loan.5 review round 2 (unit S3): self-guards the flag so this
  // panel is safe regardless of which caller opens it -- defense-in-depth
  // alongside FilterBar's own gate on rendering the chip that opens it in
  // the first place. Placed AFTER every hook above (React's rules of hooks:
  // hooks must run unconditionally, in the same order, on every render).
  if (!superstate.settings.enableDataHealthSurfaces) return null;

  // Jump-to-row (Unit 4): captured BEFORE hide() unmounts this tree (the
  // portal + its DOM are gone right after), so the window is resolved from
  // the clicked element while it is still live. A CustomEvent (not a direct
  // callback) because this modal is a separate portal render tree, not a
  // descendant of TableView — there is no prop path between them.
  const showRow = (
    e: React.MouseEvent,
    dbPath: string,
    rowPath: string
  ): void => {
    const win =
      (e.currentTarget as HTMLElement).ownerDocument?.defaultView ?? window;
    props.hide?.();
    win.dispatchEvent(
      new CustomEvent("mk-health-jump-to-row", { detail: { dbPath, rowPath } })
    );
  };

  if (view.mode == "vault") {
    const dbPaths = superstate.reconciler?.getAllDbPaths() ?? [];
    return (
      <div className="mk-modal-contents mk-health-panel" data-health-view="vault">
        <div className="mk-modal-heading">{i18n.labels.databaseHealth}</div>
        {dbPaths.length == 0 ? (
          <div className="mk-modal-description">
            {i18n.labels.noDatabasesWithIssues}
          </div>
        ) : (
          dbPaths.map((dbPath) => {
            const count = superstate.reconciler?.getViolationCount(dbPath) ?? 0;
            return (
              <div
                key={dbPath}
                className="mk-modal-card mk-health-db-card"
                data-db-path={dbPath}
                data-violation-count={count}
                role="button"
                tabIndex={0}
                onClick={() => setView({ mode: "db", dbPath })}
                onKeyDown={(e) => {
                  if (e.key == "Enter") setView({ mode: "db", dbPath });
                }}
              >
                <div className="mk-modal-heading">
                  {pageTitleFromPath(dbPath)}
                </div>
                <div className="mk-modal-description">
                  {count == 0
                    ? i18n.labels.databaseHealthAllClear
                    : formatIssueCount(count)}
                </div>
              </div>
            );
          })
        )}
      </div>
    );
  }

  const dbPath = view.dbPath;
  const violationsByRow =
    superstate.reconciler?.getDbViolations(dbPath) ??
    new Map<string, DataHealthViolation[]>();
  const sweepIncomplete = superstate.reconciler?.getSweepIncomplete(dbPath);
  // The SAME formula getViolationCount itself uses (row violations + one for
  // a sweep-incomplete flag) — read straight from the reconciler rather than
  // re-derived from violationsByRow.size, so a drift here can never diverge
  // from the FilterBar chip's own count for this dbPath.
  const total = superstate.reconciler?.getViolationCount(dbPath) ?? 0;

  return (
    <div className="mk-modal-contents mk-health-panel" data-health-view="db">
      <div className="mk-modal-heading">{pageTitleFromPath(dbPath)}</div>
      <div className="mk-button-group">
        <button
          className="mk-health-all-databases-link"
          onClick={() => setView({ mode: "vault" })}
        >
          {i18n.labels.allDatabases}
        </button>
      </div>
      <div
        className="mk-modal-description mk-health-total"
        data-panel-violation-count={total}
      >
        {i18n.labels.databaseHealthTotal.replace("${1}", String(total))}
      </div>
      {total == 0 && (
        <div className="mk-modal-description">
          {i18n.labels.databaseHealthAllClear}
        </div>
      )}
      {[...violationsByRow.entries()].map(([rowPath, violations]) => (
        <div
          key={rowPath}
          className="mk-modal-card mk-health-row-card"
          data-row-path={rowPath}
          data-violation-count={violations.length}
        >
          <div className="mk-modal-heading">{pageTitleFromPath(rowPath)}</div>
          {violations.map((v, i) => (
            <div key={i} className="mk-modal-description">
              {v.message} ({tierLabel(v.repairTier)})
            </div>
          ))}
          <div className="mk-button-group">
            <button
              className="mk-health-show-row"
              onClick={(e) => showRow(e, dbPath, rowPath)}
            >
              {i18n.labels.showRow}
            </button>
          </div>
        </div>
      ))}
      {sweepIncomplete && (
        <div className="mk-modal-card mk-health-sweep-incomplete-card">
          <div className="mk-modal-heading">
            {i18n.labels.sweepIncompleteCardTitle}
          </div>
          <div className="mk-modal-description">{sweepIncomplete.message}</div>
        </div>
      )}
    </div>
  );
};
