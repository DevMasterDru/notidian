import { BarChartTransformer } from "./BarChartTransformer";
import { BarChartData } from "../types/ChartDataSchemas";
import { SpaceProperty } from "shared/types/mdb";

// ===========================================================================
// DEPTH (Q1) — characterization + adversarial test net for BarChartTransformer
// (Notidian-kxq). `BarChartTransformer.transform` is a PURE
// rawData -> BarChartData transform (imports only types + sortingUtils +
// inferEncodingType; no DOM/D3), so it is fully provable offline.
//
// It is the load-bearing data layer for the D3 bar renderer: it resolves x/y
// (array-vs-scalar) + an optional color SERIES, runs aggregation
// (sum/mean/.../count, with count forced for option fields), groups/stacks bars,
// orders categories + series via sortUniqueValues (the SAME axis-ordering path
// the Notidian-0id intelligentCompare non-transitivity bug corrupts), and emits
// a yExtent. These tests LOCK current behavior, including the deliberately
// surprising bits (non-numeric y cells are SKIPPED here — unlike Line/Area which
// coerce to 0; a category whose cells are all non-numeric disappears entirely).
// ===========================================================================

type Row = Record<string, unknown>;

const cfg = (enc: any, extra: any = {}): any => ({
  id: "bar",
  name: "bar",
  chartType: "bar",
  mark: { type: "rect" },
  encoding: enc,
  layout: {},
  ...extra,
});

/** value-by-category map for single-series assertions. */
const byCat = (d: BarChartData) => Object.fromEntries(d.data.map((p) => [String(p.category), p.value]));

describe("BarChartTransformer.transform — empty / guard contract", () => {
  const enc = { x: { field: "x", type: "nominal" }, y: { field: "y", type: "quantitative" } };

  it("returns the documented empty result for empty rawData", () => {
    expect(BarChartTransformer.transform([], cfg(enc))).toEqual({ data: [], categories: [] });
  });

  it("returns empty for null / undefined rawData (no throw)", () => {
    expect(BarChartTransformer.transform(null as any, cfg(enc))).toEqual({ data: [], categories: [] });
    expect(BarChartTransformer.transform(undefined as any, cfg(enc))).toEqual({ data: [], categories: [] });
  });

  it("returns empty when the x encoding is missing", () => {
    expect(BarChartTransformer.transform([{ y: 1 }], cfg({ y: { field: "y", type: "quantitative" } }))).toEqual({
      data: [],
      categories: [],
    });
  });

  it("returns empty when the y encoding is missing", () => {
    expect(BarChartTransformer.transform([{ x: "a" }], cfg({ x: { field: "x", type: "nominal" } }))).toEqual({
      data: [],
      categories: [],
    });
  });
});

describe("BarChartTransformer.transform — encoding resolution (array-vs-scalar)", () => {
  const rows: Row[] = [{ x: "a", y: 4 }, { x: "b", y: 6 }];

  it("accepts scalar x + scalar y", () => {
    const out = BarChartTransformer.transform(rows, cfg({ x: { field: "x", type: "nominal" }, y: { field: "y", type: "quantitative" } }));
    expect(byCat(out)).toEqual({ a: 4, b: 6 });
  });

  it("uses the FIRST element when x / y are arrays", () => {
    const out = BarChartTransformer.transform(
      rows,
      cfg({
        x: [{ field: "x", type: "nominal" }, { field: "ignore", type: "nominal" }],
        y: [{ field: "y", type: "quantitative" }, { field: "ignore2", type: "quantitative" }],
      })
    );
    expect(byCat(out)).toEqual({ a: 4, b: 6 });
  });
});

describe("BarChartTransformer.transform — aggregation arithmetic (single series)", () => {
  const rows: Row[] = [
    { x: "a", y: 2 },
    { x: "a", y: 4 },
    { x: "a", y: 6 },
    { x: "b", y: 10 },
  ];
  const enc = (aggregate?: string) => ({
    x: { field: "x", type: "nominal" },
    y: { field: "y", type: "quantitative", ...(aggregate ? { aggregate } : {}) },
  });

  it("defaults to sum when aggregate is omitted", () => {
    expect(byCat(BarChartTransformer.transform(rows, cfg(enc())))).toEqual({ a: 12, b: 10 });
  });

  it("mean / average", () => {
    expect(byCat(BarChartTransformer.transform(rows, cfg(enc("mean")))).a).toBe(4);
    expect(byCat(BarChartTransformer.transform(rows, cfg(enc("average")))).a).toBe(4);
  });

  it("min / max", () => {
    expect(byCat(BarChartTransformer.transform(rows, cfg(enc("min")))).a).toBe(2);
    expect(byCat(BarChartTransformer.transform(rows, cfg(enc("max")))).a).toBe(6);
  });

  it("count (counts ALL records per category, not numeric sum)", () => {
    expect(byCat(BarChartTransformer.transform(rows, cfg(enc("count"))))).toEqual({ a: 3, b: 1 });
  });

  it("median (odd / even)", () => {
    const odd = BarChartTransformer.transform(
      [{ x: "a", y: 1 }, { x: "a", y: 100 }, { x: "a", y: 2 }],
      cfg({ x: { field: "x", type: "nominal" }, y: { field: "y", type: "quantitative", aggregate: "median" } })
    );
    expect(odd.data[0].value).toBe(2);
    const even = BarChartTransformer.transform(
      [{ x: "a", y: 1 }, { x: "a", y: 3 }, { x: "a", y: 5 }, { x: "a", y: 7 }],
      cfg({ x: { field: "x", type: "nominal" }, y: { field: "y", type: "quantitative", aggregate: "median" } })
    );
    expect(even.data[0].value).toBe(4);
  });
});

describe("BarChartTransformer.transform — NaN / non-numeric cells (SKIP semantics, locked)", () => {
  it("SKIPS non-numeric y cells in numeric aggregation (does NOT coerce to 0)", () => {
    const out = BarChartTransformer.transform(
      [{ x: "a", y: "notnum" }, { x: "a", y: 5 }, { x: "b", y: 3 }],
      cfg({ x: { field: "x", type: "nominal" }, y: { field: "y", type: "quantitative", aggregate: "sum" } })
    );
    expect(byCat(out)).toEqual({ a: 5, b: 3 }); // the "notnum" cell contributed nothing
  });

  it("a category whose y cells are ALL non-numeric disappears entirely", () => {
    const out = BarChartTransformer.transform(
      [{ x: "gone", y: NaN }, { x: "gone", y: "x" }, { x: "keep", y: 9 }],
      cfg({ x: { field: "x", type: "nominal" }, y: { field: "y", type: "quantitative", aggregate: "sum" } })
    );
    expect(out.categories.map(String)).toEqual(["keep"]);
    expect(byCat(out)).toEqual({ keep: 9 });
  });

  it("coerces null / undefined x cells to the literal 'undefined' bucket", () => {
    const out = BarChartTransformer.transform(
      [{ x: null, y: 3 }, { x: undefined, y: 4 }],
      cfg({ x: { field: "x", type: "nominal" }, y: { field: "y", type: "quantitative", aggregate: "sum" } })
    );
    expect(out.categories.map(String)).toEqual(["undefined"]);
    expect(byCat(out)).toEqual({ undefined: 7 });
  });
});

describe("BarChartTransformer.transform — series (grouped) bars via color", () => {
  it("treats a color field DIFFERENT from x as a series and sorts series", () => {
    const out = BarChartTransformer.transform(
      [{ x: "q1", g: "B", y: 3 }, { x: "q1", g: "A", y: 5 }, { x: "q2", g: "A", y: 2 }],
      cfg({
        x: { field: "x", type: "nominal" },
        y: { field: "y", type: "quantitative", aggregate: "sum" },
        color: { field: "g", type: "nominal" },
      })
    );
    expect(out.series).toEqual(["A", "B"]);
    const a = out.data.find((d) => d.category === "q1" && d.series === "A");
    expect(a!.value).toBe(5);
  });

  it("does NOT treat color as a series when the color field equals the x field", () => {
    const out = BarChartTransformer.transform(
      [{ x: "a", y: 5 }, { x: "b", y: 3 }],
      cfg({
        x: { field: "x", type: "nominal" },
        y: { field: "y", type: "quantitative", aggregate: "sum" },
        color: { field: "x", type: "nominal" },
      })
    );
    expect(out.series).toBeUndefined();
    expect(out.data.every((d) => d.series === undefined)).toBe(true);
  });
});

describe("BarChartTransformer.transform — stacking", () => {
  it("marks stack groups and computes a cumulative yExtent for stacked series", () => {
    const out = BarChartTransformer.transform(
      [{ x: "q1", g: "A", y: 5 }, { x: "q1", g: "B", y: 3 }],
      cfg(
        { x: { field: "x", type: "nominal" }, y: { field: "y", type: "quantitative", aggregate: "sum" }, color: { field: "g", type: "nominal" } },
        { mark: { type: "rect", stack: true } }
      )
    );
    expect(out.stacks).toEqual(["stack1"]);
    expect(out.data.every((d) => d.stack === "stack1")).toBe(true);
    expect(out.yExtent).toEqual([0, 8]); // 5 + 3 cumulative for q1
  });

  it("calculateStackPositions assigns cumulative y0/y1 bands per category", () => {
    const data = BarChartTransformer.transform(
      [{ x: "q1", g: "A", y: 5 }, { x: "q1", g: "B", y: 3 }],
      cfg(
        { x: { field: "x", type: "nominal" }, y: { field: "y", type: "quantitative", aggregate: "sum" }, color: { field: "g", type: "nominal" } },
        { mark: { type: "rect", stack: true } }
      )
    );
    const stacked = BarChartTransformer.calculateStackPositions(data);
    const pts = stacked.data as any[];
    // bases are contiguous within the stack
    expect(pts[0].y0).toBe(0);
    expect(pts[0].y1).toBe(5);
    expect(pts[1].y0).toBe(5);
    expect(pts[1].y1).toBe(8);
  });
});

describe("BarChartTransformer.transform — option-field y forces count", () => {
  const props: SpaceProperty[] = [
    { name: "status", schemaId: "s", type: "option", value: "" } as any,
  ];
  it("counts occurrences of each option value per category when y is an option field", () => {
    const out = BarChartTransformer.transform(
      [
        { region: "north", status: "open" },
        { region: "north", status: "open" },
        { region: "north", status: "closed" },
      ],
      cfg({ x: { field: "region", type: "nominal" }, y: { field: "status", type: "nominal" } }),
      props
    );
    // No COLOR encoding -> seriesField is undefined, so each option-value count
    // emerges as its own data point whose `series` is undefined (the option name
    // survives only inside metadata's count value, not as a labeled series).
    // What is locked is the COUNT arithmetic: open=2, closed=1.
    expect(out.categories.map(String)).toEqual(["north"]);
    expect(out.data.map((d) => d.value).sort((a, b) => a - b)).toEqual([1, 2]);
    expect(out.data.every((d) => d.series === undefined)).toBe(true);
  });

  it("labels option-value counts as series when an explicit color field is provided", () => {
    const propsWithColor: SpaceProperty[] = [
      { name: "status", schemaId: "s", type: "option", value: "" } as any,
    ];
    const out = BarChartTransformer.transform(
      [
        { region: "north", grp: "open", status: "open" },
        { region: "north", grp: "open", status: "open" },
        { region: "north", grp: "closed", status: "closed" },
      ],
      cfg({
        x: { field: "region", type: "nominal" },
        y: { field: "status", type: "nominal" },
        color: { field: "grp", type: "nominal" },
      }),
      propsWithColor
    );
    const open = out.data.find((d) => d.series === "open");
    const closed = out.data.find((d) => d.series === "closed");
    expect(open!.value).toBe(2);
    expect(closed!.value).toBe(1);
  });
});

describe("BarChartTransformer.transform — category ordering + extent", () => {
  it("orders numeric-looking string categories numerically but keeps them as strings", () => {
    const out = BarChartTransformer.transform(
      [{ x: "10", y: 1 }, { x: "2", y: 1 }, { x: "1", y: 1 }],
      cfg({ x: { field: "x", type: "nominal" }, y: { field: "y", type: "quantitative", aggregate: "sum" } })
    );
    expect(out.categories).toEqual(["1", "2", "10"]);
    expect(out.categories.every((c) => typeof c === "string")).toBe(true);
  });

  it("yExtent floor is 0 but can drop below 0 for negative aggregates", () => {
    const out = BarChartTransformer.transform(
      [{ x: "a", y: -5 }, { x: "b", y: 3 }],
      cfg({ x: { field: "x", type: "nominal" }, y: { field: "y", type: "quantitative", aggregate: "sum" } })
    );
    expect(out.yExtent).toEqual([-5, 3]);
  });
});

describe("BarChartTransformer.transform — determinism", () => {
  it("same input -> identical output (shuffled rows converge)", () => {
    const enc = cfg({
      x: { field: "x", type: "nominal" },
      y: { field: "y", type: "quantitative", aggregate: "sum" },
      color: { field: "g", type: "nominal" },
    });
    const a = BarChartTransformer.transform([{ x: "b", g: "Y", y: 1 }, { x: "a", g: "X", y: 2 }, { x: "a", g: "Y", y: 3 }], enc);
    const b = BarChartTransformer.transform([{ x: "a", g: "Y", y: 3 }, { x: "a", g: "X", y: 2 }, { x: "b", g: "Y", y: 1 }], enc);
    expect(a.categories).toEqual(b.categories);
    expect(a.series).toEqual(b.series);
    expect([...a.data].sort(byKey)).toEqual([...b.data].sort(byKey));
  });

  it("does not mutate the caller's rawData", () => {
    const rows: Row[] = [{ x: "a", y: 5 }, { x: "b", y: 7 }];
    const snapshot = JSON.parse(JSON.stringify(rows));
    BarChartTransformer.transform(rows, cfg({ x: { field: "x", type: "nominal" }, y: { field: "y", type: "quantitative" } }));
    expect(rows).toEqual(snapshot);
  });
});

const byKey = (a: any, b: any) =>
  `${a.category}|${a.series}`.localeCompare(`${b.category}|${b.series}`);
