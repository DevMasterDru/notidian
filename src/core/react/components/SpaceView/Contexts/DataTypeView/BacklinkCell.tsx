import { computeRowBackRelation } from "core/utils/contexts/tableBackRelationRuntime";
import React, { useMemo } from "react";
import { PathPropertyName } from "shared/types/context";
import { DBRow, SpaceTableColumn } from "shared/types/mdb";
import { safelyParseJSON } from "shared/utils/json";
import { TableCellMultiProp } from "../TableView/TableView";

// Read-only back-relation cell (Notidian-ahk): the rows that link to this row
// through the configured relation property, computed from the row's precomputed
// inlinks at render time. Config (JSON in the column value): {ref, fn, field} —
// ref = the relation property's name on the linking rows; fn defaults to "list"
// (the linking rows' titles), other fns aggregate via the rollup engine.
export const BacklinkCell = (
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
    const targetPath = props.row?.[PathPropertyName] ?? props.contextPath;
    if (!targetPath) return "";
    return computeRowBackRelation(props.superstate, targetPath, {
      relationProperty: config.ref,
      fn: config.fn ?? "list",
      field: config.field,
    });
  }, [props.propertyValue, props.row]);
  return <div className="mk-cell-rollup">{value}</div>;
};
