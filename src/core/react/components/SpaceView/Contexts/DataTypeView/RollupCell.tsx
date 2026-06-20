import { computeRowRollupDetailed } from "core/utils/contexts/tableRollupRuntime";
import React, { useMemo } from "react";
import { PathPropertyName } from "shared/types/context";
import { DBRow, SpaceTableColumn } from "shared/types/mdb";
import { safelyParseJSON } from "shared/utils/json";
import { TableCellMultiProp } from "../TableView/TableView";

// Read-only rollup cell (Notidian-8pl): aggregates a target property across the
// rows the configured relation column links to, computed from frontmatter at
// render time. Config (stored as JSON in the column value): {ref, field, fn}.
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
    if (!config.ref) return null;
    if (config.fn != "count" && !config.field) return null;
    const relationValue = props.row?.[config.ref];
    const sourcePath = props.row?.[PathPropertyName] ?? props.contextPath;
    const fn = config.fn ?? "count";
    return {
      fn,
      ...computeRowRollupDetailed(
        props.superstate,
        relationValue,
        {
          relationProperty: config.ref,
          targetProperty: config.field,
          fn,
        },
        sourcePath
      ),
    };
  }, [props.propertyValue, props.row]);

  if (!rollup) return <div className="mk-cell-rollup"></div>;

  // ADR 0029 D2: passive honesty marker when some links didn't contribute —
  // dangled, or were non-numeric under a numeric fn. `count` is never partial
  // (it counts relations, not resolved values), so it never shows the marker.
  // The displayed number is unchanged; this is text/CSS only (no innerHTML).
  const showPartial =
    rollup.fn != "count" && rollup.resolvedCount < rollup.relationCount;
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
