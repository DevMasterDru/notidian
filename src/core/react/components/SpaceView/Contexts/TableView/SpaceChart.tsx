import {
  computeChartBuckets,
  maxBucketValue,
} from "core/utils/contexts/tableChart";
import { Superstate } from "makemd-core";
import React, { useMemo } from "react";
import { ChartPredicate } from "shared/types/predicate";
import { SpaceTableColumn } from "shared/types/mdb";

const AGGREGATES: ChartPredicate["aggregate"][] = [
  "count",
  "sum",
  "avg",
  "min",
  "max",
];

const formatValue = (value: number): string =>
  Number.isInteger(value) ? String(value) : value.toFixed(1);

// Read-only horizontal bar chart over the filtered rows (Notidian-4j7). Pure
// props in, config changes + close out; never writes vault data.
export const SpaceChart = (props: {
  superstate: Superstate;
  columns: SpaceTableColumn[];
  rows: Record<string, unknown>[];
  config: ChartPredicate;
  onConfigChange: (config: ChartPredicate) => void;
  onClose: () => void;
}) => {
  const keyOf = (col: SpaceTableColumn) => col.name + (col.table ?? "");
  const buckets = useMemo(
    () => computeChartBuckets({ rows: props.rows, config: props.config }),
    [props.rows, props.config]
  );
  const max = maxBucketValue(buckets);

  const update = (patch: Partial<ChartPredicate>) =>
    props.onConfigChange({ ...props.config, ...patch });

  return (
    <div className="mk-space-chart" onMouseDown={(e) => e.stopPropagation()}>
      <div className="mk-space-chart-controls">
        <span className="mk-space-chart-control-label">Group by</span>
        <select
          className="mk-space-chart-select"
          value={props.config.groupKey}
          onChange={(e) => update({ groupKey: e.target.value })}
        >
          {props.columns.map((col) => (
            <option key={keyOf(col)} value={keyOf(col)}>
              {col.name}
            </option>
          ))}
        </select>
        <select
          className="mk-space-chart-select"
          value={props.config.aggregate}
          onChange={(e) =>
            update({
              aggregate: e.target.value as ChartPredicate["aggregate"],
            })
          }
        >
          {AGGREGATES.map((agg) => (
            <option key={agg} value={agg}>
              {agg}
            </option>
          ))}
        </select>
        {props.config.aggregate != "count" && (
          <select
            className="mk-space-chart-select"
            value={props.config.valueKey ?? ""}
            onChange={(e) => update({ valueKey: e.target.value })}
          >
            <option value="">value…</option>
            {props.columns.map((col) => (
              <option key={keyOf(col)} value={keyOf(col)}>
                {col.name}
              </option>
            ))}
          </select>
        )}
        <span className="mk-space-chart-spacer"></span>
        <button
          className="mk-space-chart-close"
          aria-label="Hide chart"
          onClick={props.onClose}
        >
          ✕
        </button>
      </div>
      <div className="mk-space-chart-bars">
        {buckets.length == 0 ? (
          <div className="mk-space-chart-empty">Nothing to chart.</div>
        ) : (
          buckets.map((bucket) => (
            <div className="mk-space-chart-row" key={bucket.label}>
              <span className="mk-space-chart-label" title={bucket.label}>
                {bucket.label}
              </span>
              <div className="mk-space-chart-track">
                <div
                  className="mk-space-chart-bar"
                  style={{
                    width: max > 0 ? `${(bucket.value / max) * 100}%` : "0%",
                  }}
                ></div>
              </div>
              <span className="mk-space-chart-value">
                {formatValue(bucket.value)}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
};
