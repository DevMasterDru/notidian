import {
  DataTransformationPipeline,
  TransformedData,
} from "./DataTransformationPipeline";
import {
  BarChartData,
  PieChartData,
  AreaChartData,
  ScatterPlotData,
} from "./types/ChartDataSchemas";
import { VisualizationConfig } from "shared/types/visualization";
import { SpaceProperty } from "shared/types/mdb";
import i18n from "shared/i18n";

// ===========================================================================
// DEPTH (Q1) — characterization test net for DataTransformationPipeline
// (Notidian-34e). The pipeline is the static, pure orchestrator of the whole
// viz data path: normalizeConfig (auto-detect encoding types), transform
// (validate input -> normalize -> dispatch to the per-chart transformer),
// applyRenderingTransformations (rendering-phase math), and validateConfig
// (-> ValidationResult). It imports only i18n + transformers + the
// inferEncodingType util; it touches NO DOM/D3, so its behavior is fully
// provable offline.
//
// It pairs with Notidian-kxq (the per-transformer net): kxq locks the leaves,
// this locks the ORCHESTRATION — the contracts the pipeline guarantees on top
// of the transformers (empty-data short-circuits, chart-type dispatch table,
// the try/catch that turns a throwing transformer into a graceful error
// result, the rendering dispatch, and config validation messages).
//
// These tests CHARACTERIZE (lock) the CURRENT behavior; they are not a
// redesign. Where the current behavior is surprising-but-intentional (e.g. the
// pipeline SWALLOWS a transformer throw into an error result) the surprise is
// documented inline so a future change has to consciously re-bless it.
// (Small integers now infer `quantitative` via value-based inference — ADR 0035
// resolved the prior date-before-number ordering hazard.)
//
// RESOLVED (ADR 0037, Option A — was "KNOWN DEFECT (locked)"):
//   - normalizeConfig is now PURE: it clones the `encoding` subtree before
//     writing inferred types, so it no longer mutates the caller's config. The
//     `D3VisualizationEngine` `scales` memo was made self-sufficient (re-derives
//     encoding types locally for all chart types) in the same change, so it no
//     longer relies on the old in-place mutation. Locked below.
//   - validateConfig now FAILS SOFT on an undefined `encoding` (early guard
//     returning `{ valid:false, ['No encoding configured'] }`) instead of
//     throwing on the un-guarded `config.encoding.x` dereference. It has no live
//     caller, so the guard removes a latent throw without regressing a chart.
// ===========================================================================

type Row = Record<string, unknown>;

/** Minimal valid VisualizationConfig; `chartType`/`enc`/`extra` override. */
const cfg = (
  chartType: string,
  enc: any,
  extra: any = {}
): VisualizationConfig =>
  ({
    id: chartType,
    name: chartType,
    chartType,
    mark: { type: "rect" },
    encoding: enc,
    layout: {},
    ...extra,
  } as unknown as VisualizationConfig);

const encOf = (c: VisualizationConfig, key: "x" | "y" | "color" | "size") =>
  (c.encoding as any)[key];

// ---------------------------------------------------------------------------
// normalizeConfig — encoding type auto-detection
// ---------------------------------------------------------------------------
describe("DataTransformationPipeline.normalizeConfig — type inference", () => {
  it("infers `nominal` for string categories and leaves it", () => {
    const data: Row[] = [{ cat: "apple", v: "x" }];
    const out = DataTransformationPipeline.normalizeConfig(
      data,
      cfg("bar", { x: { field: "cat" } })
    );
    expect(encOf(out, "x").type).toBe("nominal");
  });

  it("infers `temporal` for ISO date-string values", () => {
    const data: Row[] = [{ d: "2020-01-01" }, { d: "2020-02-01" }];
    const out = DataTransformationPipeline.normalizeConfig(
      data,
      cfg("line", { x: { field: "d" } })
    );
    expect(encOf(out, "x").type).toBe("temporal");
  });

  it("infers `quantitative` for small integers via value-based inference (ADR 0035)", () => {
    // Number(String(n)) is finite for 1/2/3, so they short-circuit out of
    // date-candidacy and reach the numeric check -> quantitative. Previously
    // these classified as `temporal` because new Date("1") is a valid date and
    // the date check ran first; ADR 0035 resolved that hazard inherited from
    // inferEncodingType ordering.
    const data: Row[] = [{ n: 1 }, { n: 2 }, { n: 3 }];
    const out = DataTransformationPipeline.normalizeConfig(
      data,
      cfg("bar", { y: { field: "n" } })
    );
    expect(encOf(out, "y").type).toBe("quantitative");
  });

  it("uses SpaceProperty metadata over value sniffing (number -> quantitative)", () => {
    const data: Row[] = [{ price: 5 }, { price: 9 }];
    const props = [
      { name: "price", type: "number" } as unknown as SpaceProperty,
    ];
    const out = DataTransformationPipeline.normalizeConfig(
      data,
      cfg("bar", { y: { field: "price" } }),
      props
    );
    // The property forces quantitative; value-based inference also yields
    // quantitative for small ints since ADR 0035 (kept here to pin that the
    // metadata path is authoritative regardless of values).
    expect(encOf(out, "y").type).toBe("quantitative");
  });

  it("preserves an explicitly-set encoding type when no property says otherwise", () => {
    const data: Row[] = [{ cat: "a" }];
    const out = DataTransformationPipeline.normalizeConfig(
      data,
      cfg("bar", { x: { field: "cat", type: "ordinal" } })
    );
    expect(encOf(out, "x").type).toBe("ordinal");
  });
});

describe("DataTransformationPipeline.normalizeConfig — encoding shape handling", () => {
  it("normalizes a SCALAR x encoding back to a scalar", () => {
    const out = DataTransformationPipeline.normalizeConfig(
      [{ d: "2020-01-01" }],
      cfg("line", { x: { field: "d" } })
    );
    expect(Array.isArray(out.encoding.x)).toBe(false);
    expect(encOf(out, "x").type).toBe("temporal");
  });

  it("normalizes an ARRAY x encoding element-wise, keeping it an array", () => {
    const out = DataTransformationPipeline.normalizeConfig(
      [{ a: "2020-01-01", b: "apple" }],
      cfg("line", {
        x: [{ field: "a" }, { field: "b" }],
      })
    );
    expect(Array.isArray(out.encoding.x)).toBe(true);
    const xs = out.encoding.x as any[];
    expect(xs[0].type).toBe("temporal");
    expect(xs[1].type).toBe("nominal");
  });

  it("normalizes y the same way as x (array element-wise)", () => {
    const out = DataTransformationPipeline.normalizeConfig(
      [{ a: "apple", b: "2020-01-01" }],
      cfg("line", {
        y: [{ field: "a" }, { field: "b" }],
      })
    );
    const ys = out.encoding.y as any[];
    expect(ys[0].type).toBe("nominal");
    expect(ys[1].type).toBe("temporal");
  });

  it("normalizes the color encoding when it has a field", () => {
    const out = DataTransformationPipeline.normalizeConfig(
      [{ g: "2020-01-01" }],
      cfg("bar", { color: { field: "g" } })
    );
    expect(encOf(out, "color").type).toBe("temporal");
  });

  it("normalizes the size encoding when it has a field", () => {
    const props = [{ name: "s", type: "number" } as unknown as SpaceProperty];
    const out = DataTransformationPipeline.normalizeConfig(
      [{ s: 5 }],
      cfg("scatter", { size: { field: "s" } }),
      props
    );
    expect(encOf(out, "size").type).toBe("quantitative");
  });

  it("leaves an x-array element with no field untouched", () => {
    const out = DataTransformationPipeline.normalizeConfig(
      [{ a: "2020-01-01" }],
      cfg("line", { x: [{ field: "a" }, { type: "nominal" } as any] })
    );
    const xs = out.encoding.x as any[];
    expect(xs[0].type).toBe("temporal");
    // element with no `field` is returned as-is (no type forced)
    expect(xs[1]).toEqual({ type: "nominal" });
  });

  it("is a no-op for a config with an empty encoding object", () => {
    const out = DataTransformationPipeline.normalizeConfig(
      [{ a: 1 }],
      cfg("bar", {})
    );
    expect(out.encoding).toEqual({});
  });
});

describe("DataTransformationPipeline.normalizeConfig — idempotency", () => {
  it("re-running on an already-normalized config yields an equal result", () => {
    const data: Row[] = [{ cat: "a", v: "1.5x" }];
    const c = cfg("bar", { x: { field: "cat" }, y: { field: "v" } });
    const once = DataTransformationPipeline.normalizeConfig(data, c);
    const twice = DataTransformationPipeline.normalizeConfig(data, once);
    expect(twice.encoding).toEqual(once.encoding);
  });
});

describe("DataTransformationPipeline.normalizeConfig — PURE (no caller mutation)", () => {
  it("does NOT mutate the caller's encoding; returns a fresh encoding (ADR 0037)", () => {
    // ADR 0037 Option A: `normalizeConfig` clones the `encoding` subtree
    // (`{ ...config, encoding: { ...config.encoding } }`) before writing inferred
    // types, so the caller's original `config.encoding` is left untouched and
    // `out.encoding` is a NEW object. (The render-path read sites in
    // `D3VisualizationEngine` were made self-sufficient in the same change, so
    // they no longer rely on the old in-place mutation.)
    const original = cfg("bar", { x: { field: "cat" } });
    expect(encOf(original, "x").type).toBeUndefined();

    const out = DataTransformationPipeline.normalizeConfig(
      [{ cat: "apple" }],
      original
    );

    expect(out.encoding).not.toBe(original.encoding); // fresh reference
    expect(encOf(original, "x").type).toBeUndefined(); // original UNCHANGED
    expect(encOf(out, "x").type).toBe("nominal"); // output carries inferred type
  });

  it("does not surprise-mutate a config reused across two normalize calls (foot-gun fix)", () => {
    // The real hazard ADR 0037 removes: a caller that reuses/compares the SAME
    // config across renders must not have it mutated under it. Normalizing the
    // same untyped config against two different datasets must not let the first
    // call's inference leak into the second.
    const shared = cfg("bar", { x: { field: "f" } });

    const numericOut = DataTransformationPipeline.normalizeConfig(
      [{ f: 1 }, { f: 2 }],
      shared
    );
    expect(encOf(numericOut, "x").type).toBe("quantitative");

    // shared is still pristine, so the second call infers from its OWN data
    expect(encOf(shared, "x").type).toBeUndefined();
    const stringOut = DataTransformationPipeline.normalizeConfig(
      [{ f: "apple" }, { f: "pear" }],
      shared
    );
    expect(encOf(stringOut, "x").type).toBe("nominal");

    // first result is unaffected by the second call (no shared aliasing)
    expect(encOf(numericOut, "x").type).toBe("quantitative");
  });
});

// ---------------------------------------------------------------------------
// transform — input guards
// ---------------------------------------------------------------------------
describe("DataTransformationPipeline.transform — empty / guard contract", () => {
  const enc = {
    x: { field: "cat", type: "nominal" },
    y: { field: "v", type: "quantitative" },
  };

  it("returns the i18n noDataProvided error for empty rawData", () => {
    expect(DataTransformationPipeline.transform([], cfg("bar", enc))).toEqual({
      type: "bar",
      data: null,
      error: i18n.labels.noDataProvided,
    });
  });

  it("returns the noDataProvided error for null / undefined rawData (no throw)", () => {
    expect(
      DataTransformationPipeline.transform(null as any, cfg("bar", enc))
    ).toEqual({ type: "bar", data: null, error: i18n.labels.noDataProvided });
    expect(
      DataTransformationPipeline.transform(undefined as any, cfg("bar", enc))
    ).toEqual({ type: "bar", data: null, error: i18n.labels.noDataProvided });
  });

  it("carries the configured chartType into the empty-data error result", () => {
    const out = DataTransformationPipeline.transform([], cfg("pie", enc));
    expect(out.type).toBe("pie");
  });

  it("returns a 'unknown' result with a fixed message when chartType is missing", () => {
    const out = DataTransformationPipeline.transform(
      [{ cat: "a", v: 1 }],
      cfg("", enc)
    );
    expect(out).toEqual({
      type: "unknown",
      data: null,
      error: "Chart type not specified",
    });
  });

  it("checks empty-data BEFORE chartType (empty + no chartType -> noDataProvided)", () => {
    const out = DataTransformationPipeline.transform([], cfg("", enc));
    expect(out.error).toBe(i18n.labels.noDataProvided);
    expect(out.type).toBe(""); // config.chartType, not 'unknown'
  });
});

// ---------------------------------------------------------------------------
// transform — chart-type dispatch table
// ---------------------------------------------------------------------------
describe("DataTransformationPipeline.transform — dispatch table", () => {
  const rows: Row[] = [
    { cat: "a", v: 5, x: 1, y: 2 },
    { cat: "b", v: 3, x: 3, y: 4 },
  ];

  it("dispatches `bar` and tags the result type 'bar' with BarChartData shape", () => {
    const out = DataTransformationPipeline.transform(
      rows,
      cfg("bar", {
        x: { field: "cat", type: "nominal" },
        y: { field: "v", type: "quantitative", aggregate: "sum" },
      })
    );
    expect(out.type).toBe("bar");
    expect(out.error).toBeUndefined();
    const data = out.data as BarChartData;
    expect(Array.isArray(data.data)).toBe(true);
    expect(Array.isArray(data.categories)).toBe(true);
  });

  it("dispatches `pie` and tags the result type 'pie' with PieChartData shape", () => {
    const out = DataTransformationPipeline.transform(
      rows,
      cfg("pie", {
        x: { field: "cat", type: "nominal" },
        y: { field: "v", type: "quantitative", aggregate: "sum" },
      })
    );
    expect(out.type).toBe("pie");
    const data = out.data as PieChartData;
    expect(typeof data.total).toBe("number");
    expect(Array.isArray(data.data)).toBe(true);
  });

  it("dispatches `line`", () => {
    const out = DataTransformationPipeline.transform(
      rows,
      cfg("line", {
        x: { field: "cat", type: "nominal" },
        y: { field: "v", type: "quantitative" },
      })
    );
    expect(out.type).toBe("line");
    expect(out.data).not.toBeNull();
  });

  it("dispatches `area`", () => {
    const out = DataTransformationPipeline.transform(
      rows,
      cfg("area", {
        x: { field: "cat", type: "nominal" },
        y: { field: "v", type: "quantitative" },
      })
    );
    expect(out.type).toBe("area");
    expect(out.data).not.toBeNull();
  });

  it("dispatches `scatter`", () => {
    const out = DataTransformationPipeline.transform(
      rows,
      cfg("scatter", {
        x: { field: "x", type: "quantitative" },
        y: { field: "y", type: "quantitative" },
      })
    );
    expect(out.type).toBe("scatter");
    const data = out.data as ScatterPlotData;
    expect(Array.isArray(data.data)).toBe(true);
  });

  it("dispatches `radar`", () => {
    const out = DataTransformationPipeline.transform(
      rows,
      cfg("radar", {
        x: { field: "cat", type: "nominal" },
        y: { field: "v", type: "quantitative" },
      })
    );
    expect(out.type).toBe("radar");
    expect(out.data).not.toBeNull();
  });

  it("returns a 'not yet implemented' error for `heatmap` (the explicit unimplemented case)", () => {
    const out = DataTransformationPipeline.transform(
      rows,
      cfg("heatmap", {
        x: { field: "x", type: "quantitative" },
        y: { field: "y", type: "quantitative" },
      })
    );
    expect(out.type).toBe("heatmap");
    expect(out.data).toBeNull();
    expect(out.error).toBe(
      "Chart type 'heatmap' transformation not yet implemented"
    );
  });

  it("returns the same 'not yet implemented' error for any unknown chartType (default branch)", () => {
    const out = DataTransformationPipeline.transform(
      rows,
      cfg("bogus", {
        x: { field: "x", type: "quantitative" },
        y: { field: "y", type: "quantitative" },
      })
    );
    expect(out.type).toBe("bogus");
    expect(out.data).toBeNull();
    expect(out.error).toBe(
      "Chart type 'bogus' transformation not yet implemented"
    );
  });
});

// ---------------------------------------------------------------------------
// transform — normalize integration + resilience (try/catch)
// ---------------------------------------------------------------------------
describe("DataTransformationPipeline.transform — normalize integration", () => {
  it("auto-detects encoding types before dispatch (untyped numeric color works)", () => {
    // color encoding has no explicit type; the pipeline normalizes it before
    // handing rawData to the bar transformer, and the dispatch still succeeds.
    const out = DataTransformationPipeline.transform(
      [
        { cat: "a", v: 5, g: "g1" },
        { cat: "b", v: 3, g: "g2" },
      ],
      cfg("bar", {
        x: { field: "cat", type: "nominal" },
        y: { field: "v", type: "quantitative", aggregate: "sum" },
        color: { field: "g" },
      })
    );
    expect(out.type).toBe("bar");
    expect(out.error).toBeUndefined();
  });

  it("does NOT mutate the caller's config encoding via normalizeConfig (ADR 0037)", () => {
    // `transform` calls `normalizeConfig`, which is now pure (ADR 0037 Option A),
    // so the caller's config is left untouched after a transform.
    const config = cfg("bar", { x: { field: "cat" } });
    expect(encOf(config, "x").type).toBeUndefined();
    DataTransformationPipeline.transform([{ cat: "a" }], config);
    expect(encOf(config, "x").type).toBeUndefined();
  });
});

describe("DataTransformationPipeline.transform — resilience (try/catch wraps transformer throws)", () => {
  it("converts a throwing transformer into a graceful error result (does NOT throw)", () => {
    // AreaChartTransformer throws on a missing-x encoding (Notidian-drp KNOWN
    // DEFECT). The pipeline's try/catch is the safety net that turns that
    // throw into { data: null, error } instead of crashing the render path.
    let out!: TransformedData;
    expect(() => {
      out = DataTransformationPipeline.transform(
        [{ v: 5 }],
        cfg("area", { y: { field: "v", type: "quantitative" } })
      );
    }).not.toThrow();
    expect(out.type).toBe("area");
    expect(out.data).toBeNull();
    expect(typeof out.error).toBe("string");
    expect(out.error!.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// applyRenderingTransformations — rendering-phase dispatch
// ---------------------------------------------------------------------------
describe("DataTransformationPipeline.applyRenderingTransformations — guards", () => {
  it("returns the input unchanged (same reference) when data is null", () => {
    const td: TransformedData = { type: "bar", data: null, error: "x" };
    expect(DataTransformationPipeline.applyRenderingTransformations(td)).toBe(
      td
    );
  });

  it("returns the input unchanged for an unhandled type (e.g. 'line') with data", () => {
    const td: TransformedData = {
      type: "line",
      data: { data: [], series: [], xDomain: [], yExtent: [0, 0] } as any,
    };
    expect(DataTransformationPipeline.applyRenderingTransformations(td)).toBe(
      td
    );
  });
});

describe("DataTransformationPipeline.applyRenderingTransformations — bar stacking", () => {
  const barWith = (stacks?: string[]): TransformedData => ({
    type: "bar",
    data: {
      data: [
        { category: "a", value: 5, series: "s1", stack: "g" },
        { category: "a", value: 3, series: "s2", stack: "g" },
      ],
      categories: ["a"],
      series: ["s1", "s2"],
      stacks,
    } as BarChartData,
  });

  it("computes stack positions when bar data has non-empty stacks", () => {
    const input = barWith(["g"]);
    const out = DataTransformationPipeline.applyRenderingTransformations(input);
    // calculateStackPositions returns a NEW wrapper object (not same ref)
    expect(out).not.toBe(input);
    const pts = (out.data as BarChartData).data as any[];
    // stacking assigns cumulative y0/y1 bases to stacked points
    expect(pts.every((p) => typeof p.y0 === "number" && typeof p.y1 === "number")).toBe(true);
    // the second point in stack 'g' sits on top of the first (5), so y0=5
    expect(pts[0].y0).toBe(0);
    expect(pts[0].y1).toBe(5);
    expect(pts[1].y0).toBe(5);
    expect(pts[1].y1).toBe(8);
  });

  it("returns the input unchanged when bar data has no stacks", () => {
    const td = barWith(undefined);
    expect(DataTransformationPipeline.applyRenderingTransformations(td)).toBe(
      td
    );
  });

  it("returns the input unchanged when bar stacks is an empty array", () => {
    const td = barWith([]);
    expect(DataTransformationPipeline.applyRenderingTransformations(td)).toBe(
      td
    );
  });
});

describe("DataTransformationPipeline.applyRenderingTransformations — pie angles", () => {
  it("ALWAYS calculates angles for a pie result (no stacking gate)", () => {
    const td: TransformedData = {
      type: "pie",
      data: {
        data: [
          { label: "a", value: 25, percentage: 25 },
          { label: "b", value: 75, percentage: 75 },
        ],
        total: 100,
      } as PieChartData,
    };
    const out = DataTransformationPipeline.applyRenderingTransformations(td);
    const pts = (out.data as PieChartData).data as any[];
    expect(pts[0].startAngle).toBe(0);
    expect(pts[pts.length - 1].endAngle).toBeCloseTo(360);
  });
});

describe("DataTransformationPipeline.applyRenderingTransformations — area stacking", () => {
  const areaWith = (stacked: boolean): TransformedData => ({
    type: "area",
    data: {
      data: [
        { x: "a", y: 5, series: "s1" },
        { x: "a", y: 3, series: "s2" },
      ],
      series: ["s1", "s2"],
      xDomain: ["a"],
      yExtent: [0, 8],
      stacked,
    } as AreaChartData,
  });

  it("computes stack positions when area data is stacked", () => {
    const out = DataTransformationPipeline.applyRenderingTransformations(
      areaWith(true)
    );
    const pts = (out.data as AreaChartData).data;
    // stacking assigns y0 baselines: the second series sits on the first
    expect(pts.some((p) => (p.y0 ?? 0) > 0)).toBe(true);
  });

  it("returns the input unchanged when area is not stacked", () => {
    const td = areaWith(false);
    expect(DataTransformationPipeline.applyRenderingTransformations(td)).toBe(
      td
    );
  });
});

describe("DataTransformationPipeline.applyRenderingTransformations — scatter sizes", () => {
  const scatterWith = (sizeExtent?: [number, number]): TransformedData => ({
    type: "scatter",
    data: {
      data: [
        { x: 1, y: 2, size: 5 },
        { x: 3, y: 4, size: 10 },
      ],
      xExtent: [1, 3],
      yExtent: [2, 4],
      sizeExtent,
    } as ScatterPlotData,
  });

  it("computes scaled point sizes when sizeExtent exists", () => {
    const out = DataTransformationPipeline.applyRenderingTransformations(
      scatterWith([5, 10])
    );
    const pts = (out.data as ScatterPlotData).data;
    expect(pts.every((p) => typeof p.size === "number")).toBe(true);
  });

  it("returns the input unchanged when sizeExtent is absent", () => {
    const td = scatterWith(undefined);
    expect(DataTransformationPipeline.applyRenderingTransformations(td)).toBe(
      td
    );
  });
});

describe("DataTransformationPipeline.applyRenderingTransformations — error resilience", () => {
  it("silently returns the input when the rendering helper would throw on malformed data", () => {
    // type 'pie' always calls calculateAngles; feed it a shape that makes the
    // helper throw and confirm the pipeline swallows it and returns the input.
    const td: TransformedData = { type: "pie", data: { notPie: true } as any };
    let out!: TransformedData;
    expect(() => {
      out = DataTransformationPipeline.applyRenderingTransformations(td);
    }).not.toThrow();
    expect(out).toBe(td);
  });
});

// ---------------------------------------------------------------------------
// validateConfig — ValidationResult
// ---------------------------------------------------------------------------
describe("DataTransformationPipeline.validateConfig — record presence", () => {
  it("is invalid with a 'No data records found' error when rawData[0] is missing", () => {
    const out = DataTransformationPipeline.validateConfig(
      [],
      cfg("bar", {
        x: { field: "a", type: "nominal" },
        y: { field: "b", type: "quantitative" },
      })
    );
    expect(out).toEqual({
      valid: false,
      errors: ["No data records found"],
      warnings: [],
    });
  });

  it("is valid when all encoded fields exist in the sample record", () => {
    const out = DataTransformationPipeline.validateConfig(
      [{ a: 1, b: 2 }],
      cfg("bar", {
        x: { field: "a", type: "nominal" },
        y: { field: "b", type: "quantitative" },
      })
    );
    expect(out).toEqual({ valid: true, errors: [], warnings: [] });
  });

  it("uses ONLY the first record to derive available fields", () => {
    // 'b' is absent from the first record -> error, even though later rows have it.
    const out = DataTransformationPipeline.validateConfig(
      [{ a: 1 }, { a: 1, b: 2 }],
      cfg("bar", {
        x: { field: "a", type: "nominal" },
        y: { field: "b", type: "quantitative" },
      })
    );
    expect(out.valid).toBe(false);
    expect(out.errors).toContain("Y encoding field 'b' not found in data");
  });
});

describe("DataTransformationPipeline.validateConfig — missing-field errors (x/y)", () => {
  it("emits an error for a missing x field", () => {
    const out = DataTransformationPipeline.validateConfig(
      [{ present: 1 }],
      cfg("bar", { x: { field: "missingX", type: "nominal" } })
    );
    expect(out.errors).toContain("X encoding field 'missingX' not found in data");
    expect(out.valid).toBe(false);
  });

  it("emits an error for a missing y field", () => {
    const out = DataTransformationPipeline.validateConfig(
      [{ present: 1 }],
      cfg("bar", { y: { field: "missingY", type: "quantitative" } })
    );
    expect(out.errors).toContain("Y encoding field 'missingY' not found in data");
  });

  it("checks every element of an ARRAY x encoding", () => {
    const out = DataTransformationPipeline.validateConfig(
      [{ a: 1 }],
      cfg("bar", {
        x: [
          { field: "a", type: "nominal" },
          { field: "b", type: "nominal" },
        ],
      })
    );
    expect(out.errors).toContain("X encoding field 'b' not found in data");
    expect(out.errors).not.toContain("X encoding field 'a' not found in data");
  });

  it("treats a config with empty encoding {} as valid (no fields to check)", () => {
    // Array.isArray([undefined]) iteration with the `encoding?.field` guard
    // skips the undefined entries, so nothing is flagged.
    const out = DataTransformationPipeline.validateConfig(
      [{ a: 1 }],
      cfg("bar", {})
    );
    expect(out).toEqual({ valid: true, errors: [], warnings: [] });
  });
});

describe("DataTransformationPipeline.validateConfig — color/size warnings (not errors)", () => {
  it("warns (does not error) on a missing color field", () => {
    const out = DataTransformationPipeline.validateConfig(
      [{ a: 1, b: 2 }],
      cfg("bar", {
        x: { field: "a", type: "nominal" },
        y: { field: "b", type: "quantitative" },
        color: { field: "missingC", type: "nominal" },
      })
    );
    expect(out.warnings).toContain(
      "Color encoding field 'missingC' not found in data"
    );
    expect(out.errors).toEqual([]);
    expect(out.valid).toBe(true); // warnings don't invalidate
  });

  it("warns (does not error) on a missing size field", () => {
    const out = DataTransformationPipeline.validateConfig(
      [{ a: 1, b: 2 }],
      cfg("scatter", {
        x: { field: "a", type: "quantitative" },
        y: { field: "b", type: "quantitative" },
        size: { field: "missingS", type: "quantitative" },
      })
    );
    expect(out.warnings).toContain(
      "Size encoding field 'missingS' not found in data"
    );
    expect(out.valid).toBe(true);
  });
});

describe("DataTransformationPipeline.validateConfig — scatter chart-specific warnings", () => {
  it("warns when scatter x/y are not quantitative or temporal", () => {
    const out = DataTransformationPipeline.validateConfig(
      [{ a: 1, b: 2 }],
      cfg("scatter", {
        x: { field: "a", type: "nominal" },
        y: { field: "b", type: "nominal" },
      })
    );
    expect(out.warnings).toEqual([
      "Scatter plots work best with quantitative or temporal X axis",
      "Scatter plots work best with quantitative or temporal Y axis",
    ]);
    expect(out.valid).toBe(true);
  });

  it("does NOT warn when scatter x/y are quantitative", () => {
    const out = DataTransformationPipeline.validateConfig(
      [{ a: 1, b: 2 }],
      cfg("scatter", {
        x: { field: "a", type: "quantitative" },
        y: { field: "b", type: "quantitative" },
      })
    );
    expect(out.warnings).toEqual([]);
  });

  it("does NOT warn when scatter x/y are temporal", () => {
    const out = DataTransformationPipeline.validateConfig(
      [{ a: 1, b: 2 }],
      cfg("scatter", {
        x: { field: "a", type: "temporal" },
        y: { field: "b", type: "temporal" },
      })
    );
    expect(out.warnings).toEqual([]);
  });
});

describe("DataTransformationPipeline.validateConfig — pie chart-specific errors", () => {
  it("errors when pie has neither color nor x (categories) AND no y (values)", () => {
    const out = DataTransformationPipeline.validateConfig([{ a: 1 }], cfg("pie", {}));
    expect(out.errors).toEqual([
      "Pie charts require either color or x encoding for categories",
      "Pie charts require y encoding for values",
    ]);
    expect(out.valid).toBe(false);
  });

  it("errors only on missing y when x (category) is present", () => {
    const out = DataTransformationPipeline.validateConfig(
      [{ a: 1 }],
      cfg("pie", { x: { field: "a", type: "nominal" } })
    );
    expect(out.errors).toEqual(["Pie charts require y encoding for values"]);
  });

  it("accepts `color` as the category encoding in place of x", () => {
    const out = DataTransformationPipeline.validateConfig(
      [{ a: 1, b: 2 }],
      cfg("pie", {
        color: { field: "a", type: "nominal" },
        y: { field: "b", type: "quantitative" },
      })
    );
    expect(out.errors).toEqual([]);
    expect(out.valid).toBe(true);
  });

  it("is fully valid for a complete pie config (x category + y value)", () => {
    const out = DataTransformationPipeline.validateConfig(
      [{ a: 1, b: 2 }],
      cfg("pie", {
        x: { field: "a", type: "nominal" },
        y: { field: "b", type: "quantitative" },
      })
    );
    expect(out).toEqual({ valid: true, errors: [], warnings: [] });
  });
});

describe("DataTransformationPipeline.validateConfig — undefined encoding fails soft (ADR 0037)", () => {
  it("returns { valid:false, ['No encoding configured'] } (no throw) on undefined encoding", () => {
    // ADR 0037 Option A: an early guard fail-softs instead of throwing on the
    // un-guarded `config.encoding.x` dereference. `validateConfig` has no live
    // caller, so this removes a latent throw without regressing any chart.
    expect(() =>
      DataTransformationPipeline.validateConfig([{ a: 1 }], {} as any)
    ).not.toThrow();
    const out = DataTransformationPipeline.validateConfig([{ a: 1 }], {} as any);
    expect(out).toEqual({
      valid: false,
      errors: ["No encoding configured"],
      warnings: [],
    });
  });
});

describe("DataTransformationPipeline.validateConfig — determinism", () => {
  it("same input -> identical ValidationResult across calls", () => {
    const data: Row[] = [{ a: 1 }];
    const c = cfg("bar", {
      x: { field: "missingX", type: "nominal" },
      color: { field: "missingC", type: "nominal" },
    });
    const a = DataTransformationPipeline.validateConfig(data, c);
    const b = DataTransformationPipeline.validateConfig(data, c);
    expect(a).toEqual(b);
  });
});
