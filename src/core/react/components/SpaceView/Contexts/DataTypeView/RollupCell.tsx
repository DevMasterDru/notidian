import { computeRowRollup } from "core/utils/contexts/tableRollupRuntime";
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
  const value = useMemo(() => {
    const config = safelyParseJSON(props.propertyValue) ?? {};
    if (!config.ref) return "";
    if (config.fn != "count" && !config.field) return "";
    const relationValue = props.row?.[config.ref];
    const sourcePath = props.row?.[PathPropertyName] ?? props.contextPath;
    return computeRowRollup(
      props.superstate,
      relationValue,
      {
        relationProperty: config.ref,
        targetProperty: config.field,
        fn: config.fn ?? "count",
      },
      sourcePath
    );
  }, [props.propertyValue, props.row]);
  return <div className="mk-cell-rollup">{value}</div>;
};
