import { LineChartTransformer } from "./LineChartTransformer";
import { LineChartData } from "../types/ChartDataSchemas";

// ===========================================================================
// DEPTH (Q1) — characterization + adversarial test net for LineChartTransformer
// (Notidian-kxq). PURE rawData -> LineChartData transform (imports only types +
// sortingUtils + inferEncodingType; no DOM/D3) => fully provable offline.
//
// It is the load-bearing data layer for the D3 line renderer: it resolves x/y
// (array-vs-scalar), branches into (a) multiple-Y-fields, (b) color-grouped
// single-Y, or (c) single-series, runs aggregation (DEFAULT mean — distinct from
// Bar/Area whose default is sum), fills missing categorical points with zeros,
// and sorts data + xDomain (the SAME axis-ordering path Notidian-0id corrupts).
//
// Locked surprises: non-numeric / null y cells are COERCED to 0 via
// `Number(v) || 0` (kept, not skipped — opposite of BarChartTransformer); the
// default aggregation is MEAN, not sum.
// ===========================================================================

type Row = Record<string, unknown>;

const cfg = (enc: any, extra: any = {}): any => ({
  id: "line",
  name: "line",
  chartType: "line",
  mark: { type: "line" },
  encoding: enc,
  layout: {},
  ...extra,
});

/** {series -> {x -> y}} for stable assertions over an unordered point list. */
const grid = (d: LineChartData) => {
  const g: Record<string, Record<string, number>> = {};
  d.data.forEach((p) => {
    const k = p.x instanceof Date ? p.x.toISOString() : String(p.x);
    (g[p.series] ||= {})[k] = p.y;
  });
  return g;
};

describe("LineChartTransformer.transform — empty / guard contract", () => {
  const empty: LineChartData = { data: [], series: [], xDomain: [], yExtent: [0, 0] };

  it("returns the documented empty result for empty rawData", () => {
    expect(LineChartTransformer.transform([], cfg({ x: { field: "x", type: "nominal" }, y: { field: "y", type: "quantitative" } }))).toEqual(empty);
  });

  it("returns empty for null / undefined rawData (no throw)", () => {
    const enc = cfg({ x: { field: "x", type: "nominal" }, y: { field: "y", type: "quantitative" } });
    expect(LineChartTransformer.transform(null as any, enc)).toEqual(empty);
    expect(LineChartTransformer.transform(undefined as any, enc)).toEqual(empty);
  });

  it("with non-empty data but missing x/y fields, returns no points (yExtent falls back to [0,0])", () => {
    const out = LineChartTransformer.transform([{ a: 1 }], cfg({ y: { field: "y", type: "quantitative" } }));
    expect(out.data).toEqual([]);
    expect(out.yExtent).toEqual([0, 0]);
  });
});

describe("LineChartTransformer.transform — single series + default aggregation", () => {
  const rows: Row[] = [{ x: "a", y: 2 }, { x: "a", y: 4 }, { x: "b", y: 10 }];

  it("DEFAULT aggregation is MEAN (collapses repeated x within a series)", () => {
    const out = LineChartTransformer.transform(rows, cfg({ x: { field: "x", type: "nominal" }, y: { field: "y", type: "quantitative" } }));
    expect(grid(out)).toEqual({ y: { a: 3, b: 10 } }); // (2+4)/2 = 3
    expect(out.series).toEqual(["y"]);
  });

  it("series name for a single-Y line is the y FIELD name", () => {
    const out = LineChartTransformer.transform([{ x: "a", revenue: 5 }], cfg({ x: { field: "x", type: "nominal" }, y: { field: "revenue", type: "quantitative" } }));
    expect(out.series).toEqual(["revenue"]);
  });

  it("explicit sum / min / max / count aggregations", () => {
    const e = (aggregate: string) => cfg({ x: { field: "x", type: "nominal" }, y: { field: "y", type: "quantitative", aggregate } });
    expect(grid(LineChartTransformer.transform(rows, e("sum"))).y.a).toBe(6);
    expect(grid(LineChartTransformer.transform(rows, e("min"))).y.a).toBe(2);
    expect(grid(LineChartTransformer.transform(rows, e("max"))).y.a).toBe(4);
    // count just tallies records per x
    expect(grid(LineChartTransformer.transform(rows, e("count"))).y.a).toBe(2);
  });

  it("distinct counts unique y values per x", () => {
    const out = LineChartTransformer.transform(
      [{ x: "a", y: 5 }, { x: "a", y: 5 }, { x: "a", y: 9 }],
      cfg({ x: { field: "x", type: "nominal" }, y: { field: "y", type: "quantitative", aggregate: "distinct" } })
    );
    expect(grid(out).y.a).toBe(2);
  });
});

describe("LineChartTransformer.transform — NaN / non-numeric / null y cells (COERCE to 0)", () => {
  it("coerces a non-numeric y cell to 0 and KEEPS the point (Number(v)||0)", () => {
    const out = LineChartTransformer.transform(
      [{ x: "a", y: "notnum" }],
      cfg({ x: { field: "x", type: "nominal" }, y: { field: "y", type: "quantitative" } })
    );
    expect(grid(out)).toEqual({ y: { a: 0 } });
  });

  it("coerces null / undefined y cells to 0 in a mean (lowering the average)", () => {
    const out = LineChartTransformer.transform(
      [{ x: "a", y: 6 }, { x: "a", y: null }],
      cfg({ x: { field: "x", type: "nominal" }, y: { field: "y", type: "quantitative" } })
    );
    expect(grid(out).y.a).toBe(3); // (6 + 0) / 2
  });

  it("drops rows with null x (normalizeXValue returns null -> skipped)", () => {
    const out = LineChartTransformer.transform(
      [{ x: null, y: 5 }, { x: "a", y: 7 }],
      cfg({ x: { field: "x", type: "nominal" }, y: { field: "y", type: "quantitative" } })
    );
    expect(out.xDomain).toEqual(["a"]);
  });
});

describe("LineChartTransformer.transform — color-grouped multi-series", () => {
  it("splits into one series per color value and fills missing x with 0", () => {
    const out = LineChartTransformer.transform(
      [
        { x: "jan", g: "A", y: 10 },
        { x: "feb", g: "A", y: 20 },
        { x: "jan", g: "B", y: 5 },
      ],
      cfg({
        x: { field: "x", type: "nominal" },
        y: { field: "y", type: "quantitative", aggregate: "sum" },
        color: { field: "g", type: "nominal" },
      })
    );
    expect(out.series).toEqual(["A", "B"]);
    const g = grid(out);
    expect(g.A).toEqual({ jan: 10, feb: 20 });
    // B had no Feb -> filled with 0 so the line is continuous across the domain
    expect(g.B).toEqual({ jan: 5, feb: 0 });
  });
});

describe("LineChartTransformer.transform — multiple Y fields = multiple series", () => {
  it("each Y field becomes its own series, defaulting to MEAN aggregation", () => {
    const out = LineChartTransformer.transform(
      [
        { x: "a", revenue: 100, cost: 40 },
        { x: "a", revenue: 200, cost: 60 },
      ],
      cfg({
        x: { field: "x", type: "nominal" },
        y: [{ field: "revenue", type: "quantitative" }, { field: "cost", type: "quantitative" }],
      })
    );
    expect(out.series.sort()).toEqual(["cost", "revenue"]);
    const g = grid(out);
    expect(g.revenue.a).toBe(150); // mean
    expect(g.cost.a).toBe(50);
  });
});

describe("LineChartTransformer.transform — x ordering + extent", () => {
  it("sorts the xDomain with numeric awareness for nominal numeric strings", () => {
    const out = LineChartTransformer.transform(
      [{ x: "10", y: 1 }, { x: "2", y: 1 }, { x: "1", y: 1 }],
      cfg({ x: { field: "x", type: "nominal" }, y: { field: "y", type: "quantitative", aggregate: "sum" } })
    );
    expect(out.xDomain).toEqual(["1", "2", "10"]);
  });

  it("computes yExtent across all points and falls back to [0,0] when empty", () => {
    const out = LineChartTransformer.transform(
      [{ x: "a", y: -3 }, { x: "b", y: 8 }],
      cfg({ x: { field: "x", type: "nominal" }, y: { field: "y", type: "quantitative", aggregate: "sum" } })
    );
    expect(out.yExtent).toEqual([-3, 8]);
  });
});

describe("LineChartTransformer.transform — determinism", () => {
  it("same input -> identical output regardless of row order", () => {
    const enc = cfg({
      x: { field: "x", type: "nominal" },
      y: { field: "y", type: "quantitative", aggregate: "sum" },
      color: { field: "g", type: "nominal" },
    });
    const a = LineChartTransformer.transform([{ x: "b", g: "Y", y: 1 }, { x: "a", g: "X", y: 2 }, { x: "a", g: "Y", y: 3 }], enc);
    const b = LineChartTransformer.transform([{ x: "a", g: "Y", y: 3 }, { x: "a", g: "X", y: 2 }, { x: "b", g: "Y", y: 1 }], enc);
    expect(a.series).toEqual(b.series);
    expect(a.xDomain).toEqual(b.xDomain);
    expect(grid(a)).toEqual(grid(b));
  });

  it("does not mutate the caller's rawData", () => {
    const rows: Row[] = [{ x: "a", y: 5 }, { x: "b", y: 7 }];
    const snapshot = JSON.parse(JSON.stringify(rows));
    LineChartTransformer.transform(rows, cfg({ x: { field: "x", type: "nominal" }, y: { field: "y", type: "quantitative" } }));
    expect(rows).toEqual(snapshot);
  });
});
