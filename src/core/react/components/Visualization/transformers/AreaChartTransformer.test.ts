import { AreaChartTransformer } from "./AreaChartTransformer";
import { AreaChartData } from "../types/ChartDataSchemas";

// ===========================================================================
// DEPTH (Q1) — characterization + adversarial test net for AreaChartTransformer
// (Notidian-kxq). PURE rawData -> AreaChartData transform (imports only types +
// sortingUtils + inferEncodingType; no DOM/D3) => fully provable offline.
//
// It is the load-bearing data layer for the D3 area renderer. It mirrors the
// Line transformer (x/y array-vs-scalar; multi-Y / color-grouped / single-series
// branches; zero-fill for missing points; sort data + xDomain) but adds STACKING
// (`stacked` flag, `y0` base, cumulative yExtent) and DEFAULTS aggregation to SUM
// (distinct from Line's MEAN). Non-numeric / null y cells are coerced to 0
// (`Number(v) || 0`), like Line. These tests LOCK current behavior.
// ===========================================================================

type Row = Record<string, unknown>;

const cfg = (enc: any, extra: any = {}): any => ({
  id: "area",
  name: "area",
  chartType: "area",
  mark: { type: "area" },
  encoding: enc,
  layout: {},
  ...extra,
});

const grid = (d: AreaChartData) => {
  const g: Record<string, Record<string, number>> = {};
  d.data.forEach((p) => {
    (g[p.series] ||= {})[String(p.x)] = p.y;
  });
  return g;
};

describe("AreaChartTransformer.transform — empty / guard contract", () => {
  const empty: AreaChartData = { data: [], series: [], xDomain: [], yExtent: [0, 0], stacked: false };

  it("returns the documented empty result for empty rawData", () => {
    expect(
      AreaChartTransformer.transform([], cfg({ x: { field: "x", type: "nominal" }, y: { field: "y", type: "quantitative" } }))
    ).toEqual(empty);
  });

  it("returns empty for null / undefined rawData (no throw)", () => {
    const enc = cfg({ x: { field: "x", type: "nominal" }, y: { field: "y", type: "quantitative" } });
    expect(AreaChartTransformer.transform(null as any, enc)).toEqual(empty);
    expect(AreaChartTransformer.transform(undefined as any, enc)).toEqual(empty);
  });

  it("returns the empty contract when the y encoding is missing (x present)", () => {
    const out = AreaChartTransformer.transform([{ x: "a" }], cfg({ x: { field: "x", type: "nominal" } }));
    expect(out.data).toEqual([]);
    expect(out.yExtent).toEqual([0, 0]);
  });

  it("returns the empty contract when the x encoding OBJECT is present but its field is missing", () => {
    const out = AreaChartTransformer.transform([{ a: 1 }], cfg({ x: { type: "nominal" }, y: { field: "y", type: "quantitative" } }));
    expect(out.data).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// RESOLVED (ADR 0038, Option A — was a KNOWN DEFECT under Notidian-kxq/Notidian-drp).
// Area used to be the ONLY one of the six transformers that THREW (instead of
// returning the safe empty contract) when the `x` encoding was entirely absent or
// an empty array on NON-EMPTY data.
//
// Root cause: after the (working) per-branch helper guards, the MAIN body
// dereferenced `xEncodings[0].type` in the temporal fill block with NO null-guard,
// while the sibling check above it WAS guarded (`xEncodings[0]?.type`). With
// `config.encoding.x === undefined` (or `[]`), `xEncodings = [undefined]`, so the
// fill block threw `TypeError: Cannot read properties of undefined (reading 'type')`.
//
// FIX (ADR 0038, Option A): Area now early-returns the documented empty contract
// when there is no usable x encoding (`!xEncodings[0]?.field`), mirroring the
// missing-encoding contract of its five sibling transformers (Bar/Pie/Line/
// Scatter/Radar) — including its structural twin Line, which guards the same fill
// block with `if (xEncodings[0])`. A half-configured area chart now renders an
// empty frame instead of surfacing a render-path TypeError. The two assertions
// below were the locked `toThrow` characterization pins, flipped to expect the
// empty contract in the same commit that landed the guard.
// ---------------------------------------------------------------------------
describe("AreaChartTransformer.transform — missing x encoding returns the empty contract (ADR 0038)", () => {
  const empty: AreaChartData = { data: [], series: [], xDomain: [], yExtent: [0, 0], stacked: false };

  it("returns the empty contract when the x encoding is entirely absent on non-empty data", () => {
    expect(
      AreaChartTransformer.transform([{ a: 1 }], cfg({ y: { field: "y", type: "quantitative" } }))
    ).toEqual(empty);
  });

  it("returns the empty contract when the x encoding is an empty array on non-empty data", () => {
    expect(
      AreaChartTransformer.transform([{ a: 1 }], cfg({ x: [], y: { field: "y", type: "quantitative" } }))
    ).toEqual(empty);
  });
});

describe("AreaChartTransformer.transform — single series + default aggregation", () => {
  const rows: Row[] = [{ x: "a", y: 2 }, { x: "a", y: 4 }, { x: "b", y: 10 }];

  it("DEFAULT aggregation is SUM (distinct from Line's mean)", () => {
    const out = AreaChartTransformer.transform(rows, cfg({ x: { field: "x", type: "nominal" }, y: { field: "y", type: "quantitative" } }));
    expect(grid(out)).toEqual({ y: { a: 6, b: 10 } });
    expect(out.stacked).toBe(false);
  });

  it("explicit mean / min / max aggregations", () => {
    const e = (aggregate: string) => cfg({ x: { field: "x", type: "nominal" }, y: { field: "y", type: "quantitative", aggregate } });
    expect(grid(AreaChartTransformer.transform(rows, e("mean"))).y.a).toBe(3);
    expect(grid(AreaChartTransformer.transform(rows, e("min"))).y.a).toBe(2);
    expect(grid(AreaChartTransformer.transform(rows, e("max"))).y.a).toBe(4);
  });

  it("count / distinct paths tally records / unique values per x", () => {
    const cnt = AreaChartTransformer.transform(rows, cfg({ x: { field: "x", type: "nominal" }, y: { field: "y", type: "quantitative", aggregate: "count" } }));
    expect(grid(cnt).y.a).toBe(2);
    const dist = AreaChartTransformer.transform(
      [{ x: "a", y: 5 }, { x: "a", y: 5 }, { x: "a", y: 9 }],
      cfg({ x: { field: "x", type: "nominal" }, y: { field: "y", type: "quantitative", aggregate: "distinct" } })
    );
    expect(grid(dist).y.a).toBe(2);
  });
});

describe("AreaChartTransformer.transform — NaN / non-numeric / null cells (COERCE to 0)", () => {
  it("coerces a non-numeric y cell to 0 and keeps the point", () => {
    const out = AreaChartTransformer.transform(
      [{ x: "a", y: "notnum" }],
      cfg({ x: { field: "x", type: "nominal" }, y: { field: "y", type: "quantitative" } })
    );
    expect(grid(out)).toEqual({ y: { a: 0 } });
  });

  it("drops rows whose x is null (normalizeXValue -> null)", () => {
    const out = AreaChartTransformer.transform(
      [{ x: null, y: 5 }, { x: "a", y: 7 }],
      cfg({ x: { field: "x", type: "nominal" }, y: { field: "y", type: "quantitative", aggregate: "sum" } })
    );
    expect(out.xDomain).toEqual(["a"]);
  });
});

describe("AreaChartTransformer.transform — color-grouped multi-series", () => {
  it("creates one series per color value and zero-fills missing x slots", () => {
    const out = AreaChartTransformer.transform(
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
    expect(g.B).toEqual({ jan: 5, feb: 0 }); // zero-filled
  });
});

describe("AreaChartTransformer.transform — multiple Y fields = multiple series", () => {
  it("each Y field becomes its own series with default SUM aggregation", () => {
    const out = AreaChartTransformer.transform(
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
    expect(g.revenue.a).toBe(300); // sum
    expect(g.cost.a).toBe(100);
  });
});

describe("AreaChartTransformer.transform — stacking", () => {
  const rows: Row[] = [{ x: "jan", g: "A", y: 10 }, { x: "jan", g: "B", y: 5 }];
  const stackedCfg = cfg(
    { x: { field: "x", type: "nominal" }, y: { field: "y", type: "quantitative", aggregate: "sum" }, color: { field: "g", type: "nominal" } },
    { mark: { type: "area", stack: true } }
  );

  it("sets stacked=true and a cumulative yExtent across stacked series", () => {
    const out = AreaChartTransformer.transform(rows, stackedCfg);
    expect(out.stacked).toBe(true);
    expect(out.yExtent).toEqual([0, 15]); // 10 + 5
    // y0 initialized to 0 before render-phase stacking
    expect(out.data.every((p) => p.y0 === 0)).toBe(true);
  });

  it("calculateStackPositions assigns cumulative y0 bases per x", () => {
    const out = AreaChartTransformer.transform(rows, stackedCfg);
    const stacked = AreaChartTransformer.calculateStackPositions(out);
    const a = stacked.data.find((p) => p.series === "A")!;
    const b = stacked.data.find((p) => p.series === "B")!;
    // sorted by series (A before B); A is the base, B stacks on top of A.
    expect(a.y0).toBe(0);
    expect(b.y0).toBe(10);
  });
});

describe("AreaChartTransformer.transform — x ordering + determinism", () => {
  it("sorts xDomain with numeric awareness for nominal numeric strings", () => {
    const out = AreaChartTransformer.transform(
      [{ x: "10", y: 1 }, { x: "2", y: 1 }, { x: "1", y: 1 }],
      cfg({ x: { field: "x", type: "nominal" }, y: { field: "y", type: "quantitative", aggregate: "sum" } })
    );
    expect(out.xDomain).toEqual(["1", "2", "10"]);
  });

  it("same input -> identical output regardless of row order", () => {
    const enc = cfg({
      x: { field: "x", type: "nominal" },
      y: { field: "y", type: "quantitative", aggregate: "sum" },
      color: { field: "g", type: "nominal" },
    });
    const a = AreaChartTransformer.transform([{ x: "b", g: "Y", y: 1 }, { x: "a", g: "X", y: 2 }, { x: "a", g: "Y", y: 3 }], enc);
    const b = AreaChartTransformer.transform([{ x: "a", g: "Y", y: 3 }, { x: "a", g: "X", y: 2 }, { x: "b", g: "Y", y: 1 }], enc);
    expect(a.series).toEqual(b.series);
    expect(a.xDomain).toEqual(b.xDomain);
    expect(grid(a)).toEqual(grid(b));
  });

  it("does not mutate the caller's rawData", () => {
    const rows: Row[] = [{ x: "a", y: 5 }, { x: "b", y: 7 }];
    const snapshot = JSON.parse(JSON.stringify(rows));
    AreaChartTransformer.transform(rows, cfg({ x: { field: "x", type: "nominal" }, y: { field: "y", type: "quantitative" } }));
    expect(rows).toEqual(snapshot);
  });
});
