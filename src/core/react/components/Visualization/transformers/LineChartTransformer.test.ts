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

// ===========================================================================
// SWO-LAW / JUNK-AXIS ORDERING for the x-axis comparators (Notidian-pjv6).
//
// `sortData` (l~591) and the non-option fallback of `sortXDomain` (l~609) used to
// dispatch on xEncoding.type and subtract a type-ASSERTED value:
//   temporal     -> (a.x as Date).getTime() - (b.x as Date).getTime()
//   quantitative -> (a.x as number) - (b.x as number)
// The `as Date` / `as number` are runtime lies — x can be a string or an Invalid
// Date — so getTime()/Number coercion yields NaN. A NaN comparator return is the
// ADR 0033 defect: NON-REFLEXIVE (compare(x,x) can be NaN) and V8/TimSort-input-
// dependent. The fix routes both through the canonical, SWO-hardened
// intelligentCompare. These tests assert the comparators are now a strict weak
// ordering over a junk/mixed-type temporal/quantitative axis (reflexive,
// antisymmetric, transitive, deterministic) — the law the old code broke. They
// reach the private static comparators directly (the methods the bug lives in) so
// they exercise the comparator even for axis values normalizeXValue would drop.
// ===========================================================================
describe("LineChartTransformer x-axis comparators are a strict weak ordering (Notidian-pjv6)", () => {
  // Reach the private static helpers — they are where the NaN-returning comparator
  // lived, and `transform`'s normalizeXValue would otherwise filter the junk out.
  const sortData = (data: any[], xEncoding: any) =>
    (LineChartTransformer as any).sortData(data, xEncoding);
  const sortXDomain = (domain: any[], xEncoding: any, tableProps?: any) =>
    (LineChartTransformer as any).sortXDomain(domain, xEncoding, tableProps);

  // A deliberately junk-bearing axis a quantitative/temporal encoding can carry at
  // runtime: real numbers, an unparseable string, an Invalid Date, ±Infinity-coercing
  // tokens — every operand that made the old `as Date/as number` subtraction NaN.
  const JUNK_AXIS: any[] = [
    10, 2, 1, "notnum", "Infinity", "-Infinity", "1e999",
    new Date("not a date"), new Date("2020-01-01"), "2019-06-15", "", "zeta",
  ];

  const assertSWO = (cmp: (a: any, b: any) => number, axis: any[]) => {
    // Reflexive: every self-compare is exactly 0 (never NaN) — the property the
    // type-asserted NaN subtraction violated.
    for (const v of axis) {
      const r = cmp(v, v);
      expect(Number.isNaN(r)).toBe(false);
      expect(Math.sign(r)).toBe(0);
    }
    // Antisymmetric: sign(cmp(a,b)) === -sign(cmp(b,a)) for all pairs, never NaN.
    for (const a of axis) {
      for (const b of axis) {
        const ab = cmp(a, b);
        const ba = cmp(b, a);
        expect(Number.isNaN(ab)).toBe(false);
        expect(Number.isNaN(ba)).toBe(false);
        // sign(cmp(a,b)) + sign(cmp(b,a)) === 0; the `+ 0` normalizes -0 so the
        // equal-element case (sign 0) compares cleanly under Object.is.
        expect(Math.sign(ab) + Math.sign(ba) + 0).toBe(0);
      }
    }
    // Transitive (on the equivalence classes the comparator induces): if a<=b and
    // b<=c then a<=c, over every ordered triple.
    for (const a of axis) {
      for (const b of axis) {
        for (const c of axis) {
          if (cmp(a, b) <= 0 && cmp(b, c) <= 0) {
            expect(cmp(a, c)).toBeLessThanOrEqual(0);
          }
        }
      }
    }
  };

  it("the canonical comparator the x-axis sort now routes through obeys the SWO laws on a junk axis (never NaN)", () => {
    // sortData / sortXDomain delegate the per-pair relation to intelligentCompare;
    // a comparator must be a strict weak ordering to feed Array.prototype.sort safely.
    // The OLD per-type subtraction returned NaN here (compare(x,x) === NaN) — the
    // exact law this asserts. The deterministic-total-order its below prove the
    // transformer actually routes the axis sort through this comparator.
    const { intelligentCompare } = require("../utils/sortingUtils");
    assertSWO(intelligentCompare, JUNK_AXIS);
  });

  it("sortData produces a deterministic, total order on a junk temporal axis regardless of input order", () => {
    const mk = (axis: any[]) => sortData(axis.map((x) => ({ x, y: 0 })), { type: "temporal" }).map((p: any) => String(p.x));
    const forward = mk([...JUNK_AXIS]);
    const reversed = mk([...JUNK_AXIS].reverse());
    const shuffled = mk([JUNK_AXIS[4], JUNK_AXIS[0], JUNK_AXIS[8], JUNK_AXIS[3], JUNK_AXIS[1], JUNK_AXIS[10], JUNK_AXIS[2], JUNK_AXIS[5], JUNK_AXIS[6], JUNK_AXIS[7], JUNK_AXIS[9], JUNK_AXIS[11]]);
    expect(reversed).toEqual(forward);
    expect(shuffled).toEqual(forward);
  });

  it("sortData produces a deterministic, total order on a junk quantitative axis regardless of input order", () => {
    const mk = (axis: any[]) => sortData(axis.map((x) => ({ x, y: 0 })), { type: "quantitative" }).map((p: any) => String(p.x));
    const forward = mk([...JUNK_AXIS]);
    const reversed = mk([...JUNK_AXIS].reverse());
    expect(reversed).toEqual(forward);
  });

  it("sortXDomain's non-option fallback produces a deterministic order on a junk quantitative axis", () => {
    const forward = sortXDomain([...JUNK_AXIS], { type: "quantitative" }).map(String);
    const reversed = sortXDomain([...JUNK_AXIS].reverse(), { type: "quantitative" }).map(String);
    expect(reversed).toEqual(forward);
  });

  it("keeps an all-numeric quantitative axis in ascending numeric order (no regression vs the old subtraction)", () => {
    const out = sortData([{ x: 10, y: 0 }, { x: 2, y: 0 }, { x: 1, y: 0 }], { type: "quantitative" }).map((p: any) => p.x);
    expect(out).toEqual([1, 2, 10]);
  });

  it("keeps an all-valid temporal axis in chronological order (no regression vs getTime subtraction)", () => {
    const d1 = new Date("2019-01-01");
    const d2 = new Date("2020-06-15");
    const d3 = new Date("2021-12-31");
    const out = sortData([{ x: d2, y: 0 }, { x: d3, y: 0 }, { x: d1, y: 0 }], { type: "temporal" }).map((p: any) => (p.x as Date).getTime());
    expect(out).toEqual([d1.getTime(), d2.getTime(), d3.getTime()]);
  });
});
