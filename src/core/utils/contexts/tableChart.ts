// Pure chart aggregation (Notidian-4j7): group the in-memory filtered rows and
// aggregate a value per group. Read-only — charts never write vault data.

export type ChartAggregate = "count" | "sum" | "avg" | "min" | "max";

export type ChartConfig = {
  groupKey: string; // column accessor key (name + table) to group by
  aggregate: ChartAggregate;
  valueKey?: string; // numeric column to aggregate (ignored for count)
};

export type ChartBucket = { label: string; value: number; count: number };

const EMPTY_LABEL = "(empty)";

const numericValues = (
  rowsInBucket: Record<string, unknown>[],
  valueKey: string | undefined
): number[] => {
  if (!valueKey) return [];
  const out: number[] = [];
  for (const row of rowsInBucket) {
    const raw = row[valueKey];
    if (raw == null || raw === "") continue;
    const n = Number(raw);
    if (!Number.isNaN(n)) out.push(n);
  }
  return out;
};

const aggregateBucket = (
  rowsInBucket: Record<string, unknown>[],
  config: ChartConfig
): number => {
  if (config.aggregate == "count") return rowsInBucket.length;
  const nums = numericValues(rowsInBucket, config.valueKey);
  if (nums.length == 0) return 0;
  switch (config.aggregate) {
    case "sum":
      return nums.reduce((a, b) => a + b, 0);
    case "avg":
      return nums.reduce((a, b) => a + b, 0) / nums.length;
    // reduce, not Math.min/max(...spread): spreading a large bucket overflows
    // the call stack (RangeError) on tables with many rows in one group.
    case "min":
      return nums.reduce((m, n) => (n < m ? n : m), nums[0]);
    case "max":
      return nums.reduce((m, n) => (n > m ? n : m), nums[0]);
    default:
      return 0;
  }
};

export const computeChartBuckets = (params: {
  rows: Record<string, unknown>[];
  config: ChartConfig;
}): ChartBucket[] => {
  const { rows, config } = params;
  if (!config.groupKey || rows.length == 0) return [];

  // Preserve first-seen group order.
  const order: string[] = [];
  const groups = new Map<string, Record<string, unknown>[]>();
  for (const row of rows) {
    const raw = row[config.groupKey];
    const label =
      raw == null || String(raw).trim().length == 0 ? EMPTY_LABEL : String(raw);
    if (!groups.has(label)) {
      groups.set(label, []);
      order.push(label);
    }
    groups.get(label).push(row);
  }

  return order.map((label) => {
    const rowsInBucket = groups.get(label);
    return {
      label,
      value: aggregateBucket(rowsInBucket, config),
      count: rowsInBucket.length,
    };
  });
};

// Largest bar magnitude (absolute value) across buckets, so proportional bar
// widths stay correct when aggregates are negative (all-negative buckets would
// otherwise scale against 0 and render every bar at 0%). 0 when there are no
// buckets or every value is 0.
export const maxBucketMagnitude = (buckets: ChartBucket[]): number =>
  buckets.reduce((max, bucket) => Math.max(max, Math.abs(bucket.value)), 0);
