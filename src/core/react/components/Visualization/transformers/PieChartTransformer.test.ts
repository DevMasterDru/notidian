import { PieChartTransformer } from "./PieChartTransformer";
import { PieChartData } from "../types/ChartDataSchemas";
import i18n from "shared/i18n";

// ===========================================================================
// DEPTH (Q1) — characterization + adversarial test net for PieChartTransformer
// (Notidian-kxq). `PieChartTransformer.transform(rawData, config)` is a PURE
// rawData -> PieChartData transform: it imports only i18n + ChartDataSchemas
// types, touches no DOM/D3, so its correctness is fully provable offline.
//
// It is the load-bearing data layer feeding D3VisualizationEngine for pie/donut
// charts: it resolves the category encoding (color OR x, array-vs-scalar), the
// value encoding (y, array-vs-scalar), runs aggregation (sum/mean/.../count),
// detects the `_aggregatedCount` pre-aggregation marker, excludes non-positive
// slices, and applies sort/limit transforms (with an i18n "Others" rollup).
//
// These tests CHARACTERIZE (lock) the CURRENT behavior; they are not a redesign.
// Where the current behavior is surprising-but-intentional (e.g. non-positive
// slices silently dropped, pre-aggregated rows NOT re-summed), the surprise is
// documented inline so a future change has to consciously re-bless it.
// ===========================================================================

type Row = Record<string, unknown>;

/** Minimal valid VisualizationConfig for a pie chart; `enc`/`extra` override. */
const cfg = (enc: any, extra: any = {}): any => ({
  id: "pie",
  name: "pie",
  chartType: "pie",
  mark: { type: "arc" },
  encoding: enc,
  layout: {},
  ...extra,
});

const labels = (d: PieChartData) => d.data.map((p) => p.label);
const values = (d: PieChartData) => d.data.map((p) => p.value);

describe("PieChartTransformer.transform — empty / guard contract", () => {
  const enc = {
    x: { field: "cat", type: "nominal" },
    y: { field: "v", type: "quantitative", aggregate: "sum" },
  };

  it("returns the documented empty result for empty rawData", () => {
    expect(PieChartTransformer.transform([], cfg(enc))).toEqual({ data: [], total: 0 });
  });

  it("returns empty for null/undefined rawData (no throw)", () => {
    expect(PieChartTransformer.transform(null as any, cfg(enc))).toEqual({ data: [], total: 0 });
    expect(PieChartTransformer.transform(undefined as any, cfg(enc))).toEqual({ data: [], total: 0 });
  });

  it("returns empty when the category encoding is missing", () => {
    const out = PieChartTransformer.transform([{ v: 5 }], cfg({ y: { field: "v", type: "quantitative" } }));
    expect(out).toEqual({ data: [], total: 0 });
  });

  it("returns empty when the value encoding is missing", () => {
    const out = PieChartTransformer.transform([{ cat: "a" }], cfg({ x: { field: "cat", type: "nominal" } }));
    expect(out).toEqual({ data: [], total: 0 });
  });

  it("returns empty when encoding object is entirely empty", () => {
    expect(PieChartTransformer.transform([{ cat: "a", v: 1 }], cfg({}))).toEqual({ data: [], total: 0 });
  });
});

describe("PieChartTransformer.transform — encoding resolution (array-vs-scalar)", () => {
  const rows: Row[] = [{ cat: "a", v: 4 }, { cat: "b", v: 6 }];

  it("accepts scalar x + scalar y encodings", () => {
    const out = PieChartTransformer.transform(
      rows,
      cfg({ x: { field: "cat", type: "nominal" }, y: { field: "v", type: "quantitative" } })
    );
    expect(out.total).toBe(10);
    expect(labels(out).sort()).toEqual(["a", "b"]);
  });

  it("uses the FIRST element when x / y are arrays", () => {
    const out = PieChartTransformer.transform(
      rows,
      cfg({
        x: [{ field: "cat", type: "nominal" }, { field: "ignored", type: "nominal" }],
        y: [{ field: "v", type: "quantitative" }, { field: "ignored2", type: "quantitative" }],
      })
    );
    expect(out.total).toBe(10);
    expect(labels(out).sort()).toEqual(["a", "b"]);
  });

  it("prefers the color encoding over x for the category (documented precedence)", () => {
    const out = PieChartTransformer.transform(
      [{ x: "X1", grp: "G", v: 5 }],
      cfg({
        x: { field: "x", type: "nominal" },
        color: { field: "grp", type: "nominal" },
        y: { field: "v", type: "quantitative" },
      })
    );
    // Category came from `color` (grp=G), not from x (X1).
    expect(labels(out)).toEqual(["G"]);
  });
});

describe("PieChartTransformer.transform — aggregation arithmetic", () => {
  const rows: Row[] = [
    { cat: "a", v: 2 },
    { cat: "a", v: 4 },
    { cat: "a", v: 6 },
    { cat: "b", v: 10 },
  ];
  const enc = (aggregate: string) => ({
    x: { field: "cat", type: "nominal" },
    y: { field: "v", type: "quantitative", aggregate },
  });

  it("sum (also the default when aggregate is omitted)", () => {
    const out = PieChartTransformer.transform(rows, cfg(enc("sum")));
    const map = Object.fromEntries(out.data.map((p) => [p.label, p.value]));
    expect(map).toEqual({ a: 12, b: 10 });

    const def = PieChartTransformer.transform(
      rows,
      cfg({ x: { field: "cat", type: "nominal" }, y: { field: "v", type: "quantitative" } })
    );
    expect(Object.fromEntries(def.data.map((p) => [p.label, p.value]))).toEqual({ a: 12, b: 10 });
  });

  it("mean / average", () => {
    const mean = PieChartTransformer.transform(rows, cfg(enc("mean")));
    const avg = PieChartTransformer.transform(rows, cfg(enc("average")));
    expect(Object.fromEntries(mean.data.map((p) => [p.label, p.value])).a).toBe(4); // (2+4+6)/3
    expect(Object.fromEntries(avg.data.map((p) => [p.label, p.value])).a).toBe(4);
  });

  it("min / max", () => {
    const min = PieChartTransformer.transform(rows, cfg(enc("min")));
    const max = PieChartTransformer.transform(rows, cfg(enc("max")));
    expect(Object.fromEntries(min.data.map((p) => [p.label, p.value])).a).toBe(2);
    expect(Object.fromEntries(max.data.map((p) => [p.label, p.value])).a).toBe(6);
  });

  it("count", () => {
    const out = PieChartTransformer.transform(rows, cfg(enc("count")));
    expect(Object.fromEntries(out.data.map((p) => [p.label, p.value]))).toEqual({ a: 3, b: 1 });
  });

  it("median (odd and even cardinality)", () => {
    const odd = PieChartTransformer.transform(
      [{ c: "a", v: 1 }, { c: "a", v: 100 }, { c: "a", v: 2 }],
      cfg({ x: { field: "c", type: "nominal" }, y: { field: "v", type: "quantitative", aggregate: "median" } })
    );
    expect(odd.data[0].value).toBe(2); // sorted [1,2,100] -> middle 2
    const even = PieChartTransformer.transform(
      [{ c: "a", v: 1 }, { c: "a", v: 3 }, { c: "a", v: 5 }, { c: "a", v: 7 }],
      cfg({ x: { field: "c", type: "nominal" }, y: { field: "v", type: "quantitative", aggregate: "median" } })
    );
    expect(even.data[0].value).toBe(4); // (3+5)/2
  });

  it("distinct counts unique numeric values", () => {
    const out = PieChartTransformer.transform(
      [{ c: "a", v: 5 }, { c: "a", v: 5 }, { c: "a", v: 9 }],
      cfg({ x: { field: "c", type: "nominal" }, y: { field: "v", type: "quantitative", aggregate: "distinct" } })
    );
    expect(out.data[0].value).toBe(2); // {5,9}
  });
});

describe("PieChartTransformer.transform — NaN / non-numeric / null cells", () => {
  it("coerces non-numeric value cells to 0 (Number(v)||0), so they vanish from a positive-only pie", () => {
    // 'a' has only the non-numeric cell -> sum 0 -> excluded (pie keeps only > 0).
    const out = PieChartTransformer.transform(
      [{ c: "a", v: "notnum" }, { c: "b", v: 8 }],
      cfg({ x: { field: "c", type: "nominal" }, y: { field: "v", type: "quantitative", aggregate: "sum" } })
    );
    expect(labels(out)).toEqual(["b"]);
    expect(out.total).toBe(8);
  });

  it("treats null / undefined value cells as 0", () => {
    const out = PieChartTransformer.transform(
      [{ c: "a", v: null }, { c: "a", v: 5 }, { c: "a", v: undefined }],
      cfg({ x: { field: "c", type: "nominal" }, y: { field: "v", type: "quantitative", aggregate: "sum" } })
    );
    expect(out.data[0].value).toBe(5); // 0 + 5 + 0
  });

  it("coerces null / undefined CATEGORY cells to the literal 'undefined' bucket", () => {
    const out = PieChartTransformer.transform(
      [{ c: null, v: 3 }, { c: undefined, v: 4 }],
      cfg({ x: { field: "c", type: "nominal" }, y: { field: "v", type: "quantitative", aggregate: "sum" } })
    );
    // Both fall into the single String(null||... )='undefined' bucket.
    expect(labels(out)).toEqual(["undefined"]);
    expect(out.data[0].value).toBe(7);
  });
});

describe("PieChartTransformer.transform — non-positive slice exclusion (locked behavior)", () => {
  it("drops negative-valued slices entirely and totals only positive slices", () => {
    const out = PieChartTransformer.transform(
      [{ c: "neg", v: -5 }, { c: "pos", v: 10 }],
      cfg({ x: { field: "c", type: "nominal" }, y: { field: "v", type: "quantitative", aggregate: "sum" } })
    );
    expect(labels(out)).toEqual(["pos"]);
    expect(out.total).toBe(10);
    expect(out.data[0].percentage).toBe(100);
  });

  it("drops zero-valued slices entirely", () => {
    const out = PieChartTransformer.transform(
      [{ c: "z", v: 0 }, { c: "p", v: 4 }],
      cfg({ x: { field: "c", type: "nominal" }, y: { field: "v", type: "quantitative", aggregate: "sum" } })
    );
    expect(labels(out)).toEqual(["p"]);
  });
});

describe("PieChartTransformer.transform — duplicate category collapse + percentage", () => {
  it("collapses duplicate categories into one slice and computes percentages off the total", () => {
    const out = PieChartTransformer.transform(
      [{ c: "a", v: 10 }, { c: "a", v: 10 }, { c: "b", v: 20 }, { c: "b", v: 10 }],
      cfg({ x: { field: "c", type: "nominal" }, y: { field: "v", type: "quantitative", aggregate: "sum" } })
    );
    const map = Object.fromEntries(out.data.map((p) => [p.label, p]));
    expect(out.total).toBe(50);
    expect(map.a.value).toBe(20);
    expect(map.b.value).toBe(30);
    expect(map.a.percentage).toBeCloseTo(40);
    expect(map.b.percentage).toBeCloseTo(60);
    const sumPct = out.data.reduce((s, p) => s + p.percentage, 0);
    expect(sumPct).toBeCloseTo(100);
  });
});

describe("PieChartTransformer.transform — pre-aggregated marker path (_aggregatedCount)", () => {
  it("when ANY row carries _aggregatedCount, values are taken raw and NOT re-aggregated", () => {
    // No collapse, no re-sum: each marked row becomes its own slice with Number(v).
    const out = PieChartTransformer.transform(
      [
        { cat: "a", v: 3, _aggregatedCount: 5 },
        { cat: "b", v: 7, _aggregatedCount: 1 },
      ],
      cfg({ x: { field: "cat", type: "nominal" }, y: { field: "v", type: "quantitative", aggregate: "sum" } })
    );
    expect(Object.fromEntries(out.data.map((p) => [p.label, p.value]))).toEqual({ a: 3, b: 7 });
    expect(out.total).toBe(10);
  });

  it("pre-aggregated path collapses by the Map key when categories repeat (last write wins per key)", () => {
    // The pre-agg branch builds a Map keyed by category; repeated categories
    // overwrite, they are NOT summed (distinct from the normal aggregate path).
    const out = PieChartTransformer.transform(
      [
        { cat: "a", v: 3, _aggregatedCount: 1 },
        { cat: "a", v: 8, _aggregatedCount: 1 },
      ],
      cfg({ x: { field: "cat", type: "nominal" }, y: { field: "v", type: "quantitative", aggregate: "sum" } })
    );
    expect(labels(out)).toEqual(["a"]);
    expect(out.data[0].value).toBe(8); // last write wins, not 11
  });
});

describe("PieChartTransformer.transform — sort + limit transforms", () => {
  const rows: Row[] = [
    { c: "a", v: 30 },
    { c: "b", v: 10 },
    { c: "c", v: 20 },
    { c: "d", v: 40 },
  ];
  const baseEnc = { x: { field: "c", type: "nominal" }, y: { field: "v", type: "quantitative", aggregate: "sum" } };

  it("descending sort orders slices high -> low", () => {
    const out = PieChartTransformer.transform(
      rows,
      cfg(baseEnc, { transform: [{ type: "sort", options: { order: "descending" } }] })
    );
    expect(values(out)).toEqual([40, 30, 20, 10]);
  });

  it("ascending sort orders slices low -> high", () => {
    const out = PieChartTransformer.transform(
      rows,
      cfg(baseEnc, { transform: [{ type: "sort", options: { order: "ascending" } }] })
    );
    expect(values(out)).toEqual([10, 20, 30, 40]);
  });

  it("limit rolls the overflow into a single i18n 'Others' slice", () => {
    const out = PieChartTransformer.transform(
      rows,
      cfg(baseEnc, {
        transform: [
          { type: "sort", options: { order: "descending" } },
          { type: "limit", options: { count: 2 } },
        ],
      })
    );
    expect(labels(out)).toEqual(["d", "a", i18n.labels.others]);
    const others = out.data[out.data.length - 1];
    expect(others.value).toBe(30); // 20 (c) + 10 (b)
    expect(others.metadata!.count).toBe(2);
  });

  it("does not add an 'Others' slice when nothing overflows the limit", () => {
    const out = PieChartTransformer.transform(
      rows,
      cfg(baseEnc, { transform: [{ type: "limit", options: { count: 10 } }] })
    );
    expect(out.data.map((p) => p.label)).not.toContain(i18n.labels.others);
    expect(out.data.length).toBe(4);
  });

  it("ignores a non-array transform value safely", () => {
    const out = PieChartTransformer.transform(rows, cfg(baseEnc, { transform: "garbage" as any }));
    expect(out.data.length).toBe(4);
  });
});

describe("PieChartTransformer.transform — determinism", () => {
  it("same input -> identical output across repeated calls", () => {
    const rows: Row[] = [{ c: "a", v: 1 }, { c: "b", v: 2 }, { c: "c", v: 3 }];
    const enc = cfg({ x: { field: "c", type: "nominal" }, y: { field: "v", type: "quantitative", aggregate: "sum" } });
    const a = PieChartTransformer.transform(rows, enc);
    const b = PieChartTransformer.transform(rows, enc);
    expect(a).toEqual(b);
  });

  it("does not mutate the caller's rawData array", () => {
    const rows: Row[] = [{ c: "a", v: 5 }, { c: "b", v: 7 }];
    const snapshot = JSON.parse(JSON.stringify(rows));
    PieChartTransformer.transform(rows, cfg({ x: { field: "c", type: "nominal" }, y: { field: "v", type: "quantitative" } }));
    expect(rows).toEqual(snapshot);
  });
});

describe("PieChartTransformer.calculateAngles — rendering helper", () => {
  it("assigns contiguous start/end angles summing to 360 for full data", () => {
    const data = PieChartTransformer.transform(
      [{ c: "a", v: 25 }, { c: "b", v: 75 }],
      cfg({ x: { field: "c", type: "nominal" }, y: { field: "v", type: "quantitative", aggregate: "sum" } })
    );
    const withAngles = PieChartTransformer.calculateAngles(data);
    const pts = withAngles.data as any[];
    expect(pts[0].startAngle).toBe(0);
    expect(pts[pts.length - 1].endAngle).toBeCloseTo(360);
    // contiguity: each slice's end == next slice's start
    for (let i = 1; i < pts.length; i++) {
      expect(pts[i].startAngle).toBeCloseTo(pts[i - 1].endAngle);
    }
  });
});
