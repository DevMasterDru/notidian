import { ScatterPlotTransformer } from "./ScatterPlotTransformer";

// ===========================================================================
// DEPTH (Q1) — characterization + adversarial test net for ScatterPlotTransformer
// (Notidian-kxq). PURE rawData -> ScatterPlotData transform (imports only types +
// inferEncodingType; no DOM/D3) => fully provable offline.
//
// Unlike the aggregating transformers, Scatter emits ONE point per qualifying
// row. It is the load-bearing data layer for the D3 scatter renderer: it resolves
// x/y (array-vs-scalar, with a field-name auto-detect fallback), extracts numeric
// values per encoding type, builds insertion-ordered categorical maps for
// nominal/ordinal axes, resolves optional size + color + series, computes
// x/y/size extents, and (optionally) jitters. These tests LOCK current behavior.
//
// NOTE ON DETERMINISM: jitter uses Math.random() and is therefore the ONE
// non-deterministic path; determinism is asserted only with jitter OFF.
// ===========================================================================

type Row = Record<string, unknown>;

const cfg = (enc: any, extra: any = {}): any => ({
  id: "scatter",
  name: "scatter",
  chartType: "scatter",
  mark: { type: "circle" },
  encoding: enc,
  layout: {},
  ...extra,
});

const quantXY = { x: { field: "x", type: "quantitative" }, y: { field: "y", type: "quantitative" } };

describe("ScatterPlotTransformer.transform — empty / guard contract", () => {
  it("returns the documented empty result for empty rawData", () => {
    expect(ScatterPlotTransformer.transform([], cfg(quantXY))).toEqual({
      data: [],
      xExtent: [0, 0],
      yExtent: [0, 0],
    });
  });

  it("returns empty for null / undefined rawData (no throw)", () => {
    expect(ScatterPlotTransformer.transform(null as any, cfg(quantXY))).toEqual({ data: [], xExtent: [0, 0], yExtent: [0, 0] });
    expect(ScatterPlotTransformer.transform(undefined as any, cfg(quantXY))).toEqual({ data: [], xExtent: [0, 0], yExtent: [0, 0] });
  });
});

describe("ScatterPlotTransformer.transform — basic quantitative points + extents", () => {
  it("emits one point per row and computes x/y extents", () => {
    const out = ScatterPlotTransformer.transform(
      [{ x: 1, y: 10 }, { x: 3, y: 5 }, { x: 2, y: 20 }],
      cfg(quantXY)
    );
    expect(out.data.length).toBe(3);
    expect(out.xExtent).toEqual([1, 3]);
    expect(out.yExtent).toEqual([5, 20]);
    expect(out.series).toEqual(["default"]);
  });

  it("uses the FIRST element when x / y are arrays", () => {
    const out = ScatterPlotTransformer.transform(
      [{ x: 1, y: 2 }],
      cfg({ x: [{ field: "x", type: "quantitative" }], y: [{ field: "y", type: "quantitative" }] })
    );
    expect(out.data).toEqual([
      { x: 1, y: 2, series: "default", metadata: { x: 1, y: 2 } },
    ]);
  });

  it("parses numeric strings, stripping non-numeric characters in quantitative mode", () => {
    const out = ScatterPlotTransformer.transform(
      [{ x: "$1,200", y: "3.5kg" }],
      cfg(quantXY)
    );
    expect(out.data[0].x).toBe(1200); // "$1,200" -> "1200"
    expect(out.data[0].y).toBe(3.5); // "3.5kg" -> "3.5"
  });
});

describe("ScatterPlotTransformer.transform — invalid points are skipped (null / missing only)", () => {
  it("skips rows whose x or y cell is null (extractNumericValue -> null)", () => {
    const out = ScatterPlotTransformer.transform(
      [{ x: 1, y: 2 }, { x: 4, y: null }],
      cfg(quantXY)
    );
    expect(out.data.length).toBe(1);
    expect(out.data[0]).toMatchObject({ x: 1, y: 2 });
  });

  it("skips rows missing the x or y key entirely", () => {
    const out = ScatterPlotTransformer.transform(
      [{ x: 1, y: 2 }, { x: 3 } as Row, { y: 4 } as Row],
      cfg(quantXY)
    );
    expect(out.data.length).toBe(1);
  });

  // KNOWN QUIRK (locked, not a redesign): in QUANTITATIVE mode the extractor
  // strips all non-numeric characters first, so a pure-garbage string collapses
  // to "" and Number("") === 0. Such a row is therefore NOT skipped — it lands at
  // coordinate 0. (Only null / undefined / "" / missing-key rows are skipped.)
  it("maps a pure non-numeric quantitative string to 0 instead of skipping it", () => {
    const out = ScatterPlotTransformer.transform([{ x: "abc", y: 5 }], cfg(quantXY));
    expect(out.data.length).toBe(1);
    expect(out.data[0]).toMatchObject({ x: 0, y: 5 });
  });

  it("an all-garbage row yields a single point at (0,0) with a [0,0] extent", () => {
    const out = ScatterPlotTransformer.transform([{ x: "no", y: "no" }], cfg(quantXY));
    expect(out.data.length).toBe(1);
    expect(out.data[0]).toMatchObject({ x: 0, y: 0 });
    expect(out.xExtent).toEqual([0, 0]);
    expect(out.yExtent).toEqual([0, 0]);
  });
});

describe("ScatterPlotTransformer.transform — categorical axes mapping", () => {
  it("maps nominal X values to numeric indices in INSERTION order (not sorted)", () => {
    const out = ScatterPlotTransformer.transform(
      [{ a: "lo", b: 1 }, { a: "hi", b: 2 }, { a: "lo", b: 3 }],
      cfg({ x: { field: "a", type: "nominal" }, y: { field: "b", type: "quantitative" } })
    );
    // first-seen order: lo=0, hi=1 (NOT alphabetical)
    expect([...(out.xCategoricalMap as Map<string, number>)]).toEqual([["lo", 0], ["hi", 1]]);
    expect(out.data.map((p) => p.x)).toEqual([0, 1, 0]);
    // categorical extent spans 0..(count-1)
    expect(out.xExtent).toEqual([0, 1]);
  });

  it("maps nominal Y values to indices and reports yExtent as 0..(count-1)", () => {
    const out = ScatterPlotTransformer.transform(
      [{ a: 1, b: "low" }, { a: 2, b: "high" }, { a: 3, b: "mid" }],
      cfg({ x: { field: "a", type: "quantitative" }, y: { field: "b", type: "nominal" } })
    );
    expect([...(out.yCategoricalMap as Map<string, number>)]).toEqual([["low", 0], ["high", 1], ["mid", 2]]);
    expect(out.yExtent).toEqual([0, 2]);
  });
});

describe("ScatterPlotTransformer.transform — size / color / series", () => {
  it("resolves a size encoding into point.size and a sizeExtent", () => {
    const out = ScatterPlotTransformer.transform(
      [{ x: 1, y: 1, s: 5 }, { x: 2, y: 2, s: 20 }],
      cfg({ ...quantXY, size: { field: "s", type: "quantitative" } })
    );
    expect(out.sizeExtent).toEqual([5, 20]);
    // sorted by size DESC for render order
    expect(out.data.map((p) => p.size)).toEqual([20, 5]);
  });

  it("groups points by a color field into named series and stores categorical color", () => {
    const out = ScatterPlotTransformer.transform(
      [{ x: 1, y: 1, g: "B" }, { x: 2, y: 2, g: "A" }],
      cfg({ ...quantXY, color: { field: "g", type: "nominal" } })
    );
    expect(out.series).toEqual(["A", "B"]); // series sorted
    const byColor = Object.fromEntries(out.data.map((p) => [p.color, p.series]));
    expect(byColor).toEqual({ A: "A", B: "B" });
  });

  it("coerces a quantitative color to a number (Number(v)||0)", () => {
    const out = ScatterPlotTransformer.transform(
      [{ x: 1, y: 1, c: "7" }],
      cfg({ ...quantXY, color: { field: "c", type: "quantitative" } })
    );
    expect(out.data[0].color).toBe(7);
  });

  it("omits sizeExtent when no size encoding is present", () => {
    const out = ScatterPlotTransformer.transform([{ x: 1, y: 1 }], cfg(quantXY));
    expect(out.sizeExtent).toBeUndefined();
  });
});

describe("ScatterPlotTransformer.transform — field auto-detect fallback", () => {
  it("falls back to conventional x/y keys when encodings have empty fields", () => {
    const out = ScatterPlotTransformer.transform(
      [{ x: 5, y: 9 }],
      cfg({ x: { field: "", type: "quantitative" }, y: { field: "", type: "quantitative" } })
    );
    expect(out.data[0]).toMatchObject({ x: 5, y: 9 });
  });
});

describe("ScatterPlotTransformer.transform — determinism (jitter OFF)", () => {
  it("same input -> identical output when jitter is disabled", () => {
    const rows: Row[] = [{ x: 3, y: 1, g: "B" }, { x: 1, y: 2, g: "A" }];
    const conf = cfg({ ...quantXY, color: { field: "g", type: "nominal" } });
    const a = ScatterPlotTransformer.transform(rows, conf);
    const b = ScatterPlotTransformer.transform(rows, conf);
    expect(a).toEqual(b);
  });

  it("does not mutate the caller's rawData", () => {
    const rows: Row[] = [{ x: 1, y: 2 }, { x: 3, y: 4 }];
    const snapshot = JSON.parse(JSON.stringify(rows));
    ScatterPlotTransformer.transform(rows, cfg(quantXY));
    expect(rows).toEqual(snapshot);
  });
});

describe("ScatterPlotTransformer.transform — jitter (the non-deterministic path)", () => {
  it("perturbs coordinates within the jitter window and preserves originals in metadata", () => {
    const seed = 0.123456789;
    const spy = jest.spyOn(Math, "random").mockReturnValue(seed);
    try {
      const out = ScatterPlotTransformer.transform(
        [{ x: 10, y: 20 }],
        cfg(quantXY, { mark: { type: "circle", jitter: 0.1 } })
      );
      const p = out.data[0];
      // deterministic offset = (seed - 0.5) * 0.1 * 2
      const offset = (seed - 0.5) * 0.1 * 2;
      expect(p.x).toBeCloseTo(10 + offset);
      expect(p.y).toBeCloseTo(20 + offset);
      expect(p.metadata!.originalX).toBe(10);
      expect(p.metadata!.originalY).toBe(20);
    } finally {
      spy.mockRestore();
    }
  });
});

describe("ScatterPlotTransformer — rendering helpers", () => {
  it("groupBySeries buckets points by their series", () => {
    const data = ScatterPlotTransformer.transform(
      [{ x: 1, y: 1, g: "A" }, { x: 2, y: 2, g: "B" }, { x: 3, y: 3, g: "A" }],
      cfg({ ...quantXY, color: { field: "g", type: "nominal" } })
    );
    const grouped = ScatterPlotTransformer.groupBySeries(data);
    expect(grouped.get("A")!.length).toBe(2);
    expect(grouped.get("B")!.length).toBe(1);
  });

  it("calculatePointSizes is a no-op without a sizeExtent", () => {
    const data = ScatterPlotTransformer.transform([{ x: 1, y: 1 }], cfg(quantXY));
    expect(ScatterPlotTransformer.calculatePointSizes(data)).toBe(data);
  });

  it("calculatePointSizes scales sizes into the radius range", () => {
    const data = ScatterPlotTransformer.transform(
      [{ x: 1, y: 1, s: 0 }, { x: 2, y: 2, s: 10 }],
      cfg({ ...quantXY, size: { field: "s", type: "quantitative" } })
    );
    const scaled = ScatterPlotTransformer.calculatePointSizes(data, 3, 20);
    const sizes = scaled.data.map((p: any) => p.scaledSize);
    expect(Math.min(...sizes)).toBeCloseTo(3); // size 0 -> minRadius
    expect(Math.max(...sizes)).toBeCloseTo(20); // size 10 -> maxRadius
  });
});
