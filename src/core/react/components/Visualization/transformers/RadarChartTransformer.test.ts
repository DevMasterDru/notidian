import { RadarChartTransformer, RadarChartData } from "./RadarChartTransformer";

// ===========================================================================
// DEPTH (Q1) — characterization + adversarial test net for RadarChartTransformer
// (Notidian-kxq). PURE rawData -> RadarChartData transform (imports only types +
// sortingUtils; no DOM/D3) => fully provable offline.
//
// It is the load-bearing data layer for the D3 radar renderer with THREE
// distinct branches keyed off the encoding shape:
//   (a) multiple Y fields  -> each Y field is an AXIS, each X value a SERIES,
//                             and rows are emitted RAW (no aggregation);
//   (b) single Y + color   -> X gives axes, color gives series, values are
//                             aggregated per (series, axis) [default MEAN];
//   (c) single Y, no color  -> X gives axes, the y field name is the series,
//                             values aggregated per axis [default MEAN].
// Axes are ordered via sortUniqueValues (the SAME axis-ordering path Notidian-0id
// corrupts); series are sorted; maxValue floors to 1 for a usable scale (except
// the early empty-guard returns which floor to 0). These tests LOCK behavior.
// ===========================================================================

type Row = Record<string, unknown>;

const cfg = (enc: any, extra: any = {}): any => ({
  id: "radar",
  name: "radar",
  chartType: "radar",
  mark: { type: "line" },
  encoding: enc,
  layout: {},
  ...extra,
});

/** {series -> {axis -> value}} for stable assertions. */
const grid = (d: RadarChartData) => {
  const g: Record<string, Record<string, number>> = {};
  d.data.forEach((p) => {
    (g[p.series] ||= {})[p.axis] = p.value;
  });
  return g;
};

describe("RadarChartTransformer.transform — empty / guard contract", () => {
  const empty: RadarChartData = { data: [], axes: [], series: [], maxValue: 0 };

  it("returns the documented empty result for empty rawData", () => {
    expect(RadarChartTransformer.transform([], cfg({ x: { field: "ax", type: "nominal" }, y: { field: "v", type: "quantitative" } }))).toEqual(empty);
  });

  it("returns empty for null / undefined rawData (no throw)", () => {
    const enc = cfg({ x: { field: "ax", type: "nominal" }, y: { field: "v", type: "quantitative" } });
    expect(RadarChartTransformer.transform(null as any, enc)).toEqual(empty);
    expect(RadarChartTransformer.transform(undefined as any, enc)).toEqual(empty);
  });

  it("returns empty (maxValue 0) when the x encoding is missing", () => {
    expect(RadarChartTransformer.transform([{ v: 5 }], cfg({ y: { field: "v", type: "quantitative" } }))).toEqual(empty);
  });

  it("returns empty when x is present but the single y encoding is missing", () => {
    expect(RadarChartTransformer.transform([{ ax: "a" }], cfg({ x: { field: "ax", type: "nominal" } }))).toEqual(empty);
  });
});

describe("RadarChartTransformer.transform — single series (no color)", () => {
  const rows: Row[] = [{ ax: "speed", v: 2 }, { ax: "speed", v: 4 }, { ax: "power", v: 10 }];

  it("DEFAULT aggregation is MEAN; the series is the y field name", () => {
    const out = RadarChartTransformer.transform(rows, cfg({ x: { field: "ax", type: "nominal" }, y: { field: "v", type: "quantitative" } }));
    expect(out.series).toEqual(["v"]);
    expect(grid(out)).toEqual({ v: { speed: 3, power: 10 } }); // (2+4)/2 = 3
    expect(out.axes).toEqual(["power", "speed"]); // sorted
    expect(out.maxValue).toBe(10);
  });

  it("explicit sum / min / max / count aggregations", () => {
    const e = (aggregate: string) => cfg({ x: { field: "ax", type: "nominal" }, y: { field: "v", type: "quantitative", aggregate } });
    expect(grid(RadarChartTransformer.transform(rows, e("sum"))).v.speed).toBe(6);
    expect(grid(RadarChartTransformer.transform(rows, e("min"))).v.speed).toBe(2);
    expect(grid(RadarChartTransformer.transform(rows, e("max"))).v.speed).toBe(4);
    expect(grid(RadarChartTransformer.transform(rows, e("count"))).v.speed).toBe(2);
  });

  it("floors maxValue to 1 when every aggregated value is 0 (usable scale)", () => {
    const out = RadarChartTransformer.transform([{ ax: "a", v: 0 }], cfg({ x: { field: "ax", type: "nominal" }, y: { field: "v", type: "quantitative" } }));
    expect(out.maxValue).toBe(1);
  });

  it("coerces non-numeric / null values to 0 (Number(v)||0)", () => {
    const out = RadarChartTransformer.transform(
      [{ ax: "a", v: "x" }, { ax: "a", v: 6 }],
      cfg({ x: { field: "ax", type: "nominal" }, y: { field: "v", type: "quantitative" } })
    );
    expect(grid(out).v.a).toBe(3); // (0 + 6)/2 = 3 (mean)
  });

  it("coerces a null axis cell to the literal 'unknown' bucket", () => {
    const out = RadarChartTransformer.transform([{ ax: null, v: 5 }], cfg({ x: { field: "ax", type: "nominal" }, y: { field: "v", type: "quantitative" } }));
    expect(out.axes).toEqual(["unknown"]);
  });
});

describe("RadarChartTransformer.transform — color-grouped series", () => {
  it("aggregates per (series, axis) with the default MEAN and sorts axes + series", () => {
    const out = RadarChartTransformer.transform(
      [
        { ax: "speed", g: "team1", v: 4 },
        { ax: "speed", g: "team1", v: 6 },
        { ax: "power", g: "team1", v: 10 },
        { ax: "speed", g: "team2", v: 2 },
      ],
      cfg({ x: { field: "ax", type: "nominal" }, y: { field: "v", type: "quantitative" }, color: { field: "g", type: "nominal" } })
    );
    expect(out.series).toEqual(["team1", "team2"]);
    expect(out.axes).toEqual(["power", "speed"]);
    const g = grid(out);
    expect(g.team1).toEqual({ speed: 5, power: 10 }); // (4+6)/2 = 5
    expect(g.team2).toEqual({ speed: 2 });
    expect(out.maxValue).toBe(10);
  });

  it("returns empty when color is set but the single y encoding is missing", () => {
    const out = RadarChartTransformer.transform(
      [{ ax: "speed", g: "t1" }],
      cfg({ x: { field: "ax", type: "nominal" }, color: { field: "g", type: "nominal" } })
    );
    expect(out).toEqual({ data: [], axes: [], series: [], maxValue: 0 });
  });
});

describe("RadarChartTransformer.transform — multiple Y fields (raw, no aggregation)", () => {
  it("treats each Y field as an axis and each X value as a series, emitting RAW rows", () => {
    const out = RadarChartTransformer.transform(
      [
        { name: "Alice", speed: 8, power: 5 },
        { name: "Bob", speed: 6, power: 9 },
      ],
      cfg({
        x: { field: "name", type: "nominal" },
        y: [{ field: "speed", type: "quantitative" }, { field: "power", type: "quantitative" }],
      })
    );
    expect(out.series).toEqual(["Alice", "Bob"]);
    expect(out.axes).toEqual(["power", "speed"]); // sorted
    expect(out.data.length).toBe(4); // 2 records x 2 axes, no collapsing
    const g = grid(out);
    expect(g.Alice).toEqual({ speed: 8, power: 5 });
    expect(g.Bob).toEqual({ speed: 6, power: 9 });
    expect(out.maxValue).toBe(9);
  });

  it("coerces non-numeric multi-Y cells to 0", () => {
    const out = RadarChartTransformer.transform(
      [{ name: "A", speed: "fast", power: 3 }],
      cfg({ x: { field: "name", type: "nominal" }, y: [{ field: "speed", type: "quantitative" }, { field: "power", type: "quantitative" }] })
    );
    expect(grid(out).A).toEqual({ speed: 0, power: 3 });
  });
});

describe("RadarChartTransformer.transform — determinism", () => {
  it("same input -> identical output regardless of row order", () => {
    const enc = cfg({ x: { field: "ax", type: "nominal" }, y: { field: "v", type: "quantitative" }, color: { field: "g", type: "nominal" } });
    const a = RadarChartTransformer.transform(
      [{ ax: "b", g: "Y", v: 1 }, { ax: "a", g: "X", v: 2 }, { ax: "a", g: "Y", v: 3 }],
      enc
    );
    const b = RadarChartTransformer.transform(
      [{ ax: "a", g: "Y", v: 3 }, { ax: "a", g: "X", v: 2 }, { ax: "b", g: "Y", v: 1 }],
      enc
    );
    expect(a.axes).toEqual(b.axes);
    expect(a.series).toEqual(b.series);
    expect(grid(a)).toEqual(grid(b));
    expect(a.maxValue).toBe(b.maxValue);
  });

  it("does not mutate the caller's rawData", () => {
    const rows: Row[] = [{ ax: "a", v: 5 }, { ax: "b", v: 7 }];
    const snapshot = JSON.parse(JSON.stringify(rows));
    RadarChartTransformer.transform(rows, cfg({ x: { field: "ax", type: "nominal" }, y: { field: "v", type: "quantitative" } }));
    expect(rows).toEqual(snapshot);
  });
});
