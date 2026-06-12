import {
  ChartConfig,
  computeChartBuckets,
  maxBucketValue,
} from "core/utils/contexts/tableChart";

const rows = [
  { Status: "active", Hours: "3" },
  { Status: "active", Hours: "5" },
  { Status: "retired", Hours: "2" },
  { Status: "", Hours: "x" },
];

const cfg = (over: Partial<ChartConfig>): ChartConfig => ({
  groupKey: "Status",
  aggregate: "count",
  ...over,
});

describe("computeChartBuckets", () => {
  it("counts rows per group, first-seen order, empty group labelled", () => {
    expect(computeChartBuckets({ rows, config: cfg({}) })).toEqual([
      { label: "active", value: 2, count: 2 },
      { label: "retired", value: 1, count: 1 },
      { label: "(empty)", value: 1, count: 1 },
    ]);
  });

  it("sums a numeric value column per group, ignoring non-numeric cells", () => {
    expect(
      computeChartBuckets({
        rows,
        config: cfg({ aggregate: "sum", valueKey: "Hours" }),
      })
    ).toEqual([
      { label: "active", value: 8, count: 2 },
      { label: "retired", value: 2, count: 1 },
      { label: "(empty)", value: 0, count: 1 },
    ]);
  });

  it("averages numeric values, dividing by the count of numeric cells only", () => {
    const buckets = computeChartBuckets({
      rows: [
        { g: "a", v: "10" },
        { g: "a", v: "20" },
        { g: "a", v: "nope" },
      ],
      config: { groupKey: "g", aggregate: "avg", valueKey: "v" },
    });
    expect(buckets).toEqual([{ label: "a", value: 15, count: 3 }]);
  });

  it("supports min and max", () => {
    const base = {
      rows: [
        { g: "a", v: "7" },
        { g: "a", v: "3" },
      ],
      groupKey: "g",
      valueKey: "v",
    };
    expect(
      computeChartBuckets({
        rows: base.rows,
        config: { groupKey: "g", aggregate: "min", valueKey: "v" },
      })[0].value
    ).toBe(3);
    expect(
      computeChartBuckets({
        rows: base.rows,
        config: { groupKey: "g", aggregate: "max", valueKey: "v" },
      })[0].value
    ).toBe(7);
  });

  it("returns nothing when the group key is missing/empty config", () => {
    expect(computeChartBuckets({ rows, config: cfg({ groupKey: "" }) })).toEqual(
      []
    );
    expect(computeChartBuckets({ rows: [], config: cfg({}) })).toEqual([]);
  });

  it("sum/avg/min/max with no numeric values yield 0", () => {
    const buckets = computeChartBuckets({
      rows: [{ g: "a", v: "x" }],
      config: { groupKey: "g", aggregate: "sum", valueKey: "v" },
    });
    expect(buckets[0].value).toBe(0);
  });
});

describe("maxBucketValue", () => {
  it("returns the largest bucket value, or 0 for none", () => {
    expect(
      maxBucketValue([
        { label: "a", value: 2, count: 2 },
        { label: "b", value: 5, count: 1 },
      ])
    ).toBe(5);
    expect(maxBucketValue([])).toBe(0);
  });
});
