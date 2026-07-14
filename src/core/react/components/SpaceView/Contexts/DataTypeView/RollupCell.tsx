import { isKeyMatchConfig } from "core/utils/contexts/keyMatchResolver";
import { computeRowRollupDetailed } from "core/utils/contexts/tableRollupRuntime";
import React, { useMemo } from "react";
import { PathPropertyName } from "shared/types/context";
import { DBRow, SpaceTableColumn } from "shared/types/mdb";
import { safelyParseJSON } from "shared/utils/json";
import { TableCellMultiProp } from "../TableView/TableView";

// Read-only rollup cell (Notidian-8pl): aggregates a target property across the
// rows the configured relation column links to, computed from frontmatter at
// render time. Config (stored as JSON in the column value): {ref, field, fn}.
// Notidian-mx0k.1: when config.keyMatch is present and valid, uses key-match
// resolution instead of wikilink parsing. The rollup engine itself receives
// paths and aggregates unchanged.
export const RollupCell = (
  props: TableCellMultiProp & {
    row: DBRow;
    source: string;
    contextPath: string;
    columns: SpaceTableColumn[];
  }
) => {
  const rollup = useMemo(() => {
    const config = safelyParseJSON(props.propertyValue) ?? {};
    const useKeyMatch = isKeyMatchConfig(config);
    // Key-match: ref is the sourceField from keyMatch config; wikilink: ref is the
    // relation column name. For key-match, ref is still required for the rollup
    // engine's config identity, but the actual source field is keyMatch.sourceField.
    if (!useKeyMatch && !config.ref) return null;
    if (config.fn != "count" && !config.field) return null;
    const sourcePath = props.row?.[PathPropertyName] ?? props.contextPath;
    const fn = config.fn ?? "count";
    const periodScopedRollups =
      props.superstate.settings?.periodScopedRollups !== false
        ? config.period
        : undefined;

    // For key-match, the relation value is the source row's sourceField value.
    // For wikilink, it's the relation column's value.
    const relationValue = useKeyMatch
      ? props.row?.[config.keyMatch.sourceField]
      : props.row?.[config.ref];

    return {
      fn,
      ...computeRowRollupDetailed(
        props.superstate,
        relationValue,
        {
          relationProperty: useKeyMatch ? config.keyMatch.sourceField : config.ref,
          targetProperty: config.field,
          fn,
          period: periodScopedRollups,
        },
        sourcePath,
        useKeyMatch ? config.keyMatch : undefined
      ),
    };
  }, [
    props.propertyValue,
    props.row,
    props.superstate.settings?.periodScopedRollups,
  ]);

  if (!rollup) return <div className="mk-cell-rollup"></div>;

  // ADR 0029 D2: passive honesty marker when some links didn't contribute —
  // dangled, or were non-numeric under a numeric fn. `count` is never partial
  // (it counts relations, not resolved values), so it never shows the marker.
  // The displayed number is unchanged; this is text/CSS only (no innerHTML).
  const showPartial =
    rollup.fn != "count" && rollup.resolvedCount < rollup.relationCount;

  // Progress rollups (Notidian-5ond.7): render percent / percent_checked as a
  // Notion-style bar + "NN%". CSS-only (a div width, no innerHTML/SVG). A blank
  // value (nothing resolved) falls through to the plain empty render.
  const isPercent =
    rollup.fn == "percent" || rollup.fn == "percent_checked";
  if (isPercent && rollup.value !== "") {
    const pct = Math.max(0, Math.min(100, parseInt(rollup.value, 10) || 0));
    return (
      <div className="mk-cell-rollup mk-cell-rollup-progress">
        <div
          className="mk-rollup-bar"
          role="progressbar"
          aria-valuenow={pct}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <div className="mk-rollup-bar-fill" style={{ width: `${pct}%` }} />
        </div>
        <span className="mk-rollup-bar-label">{pct}%</span>
        {showPartial ? (
          <span
            className="mk-cell-rollup-partial"
            title={`${rollup.resolvedCount} of ${rollup.relationCount} counted — ${
              rollup.relationCount - rollup.resolvedCount
            } unresolved`}
          >
            ·{rollup.resolvedCount}/{rollup.relationCount}
          </span>
        ) : null}
      </div>
    );
  }

  return (
    <div className="mk-cell-rollup">
      {rollup.value}
      {showPartial ? (
        <span
          className="mk-cell-rollup-partial"
          title={`${rollup.resolvedCount} of ${rollup.relationCount} counted — ${
            rollup.relationCount - rollup.resolvedCount
          } unresolved/non-numeric`}
        >
          ·{rollup.resolvedCount}/{rollup.relationCount}
        </span>
      ) : null}
    </div>
  );
};
