import {
  computeFrontmatterRollup,
  computeFrontmatterRollupDetailed,
  parseRelationLinks,
  RollupConfig,
} from "core/utils/contexts/tableRollup";

describe("parseRelationLinks", () => {
  it("extracts wikilink targets from a string, stripping aliases", () => {
    expect(parseRelationLinks("[[Tasks/A|A task]], [[Tasks/B]]")).toEqual([
      "Tasks/A",
      "Tasks/B",
    ]);
  });

  it("handles a YAML array of links", () => {
    expect(parseRelationLinks(["[[A]]", "[[B|b]]"])).toEqual(["A", "B"]);
  });

  it("strips heading/block fragments so links resolve to the file path", () => {
    expect(parseRelationLinks("[[Tasks/A#Section]]")).toEqual(["Tasks/A"]);
    expect(parseRelationLinks("[[Tasks/A#^block|Alias]]")).toEqual(["Tasks/A"]);
  });

  it("falls back to comma-separated plain paths when there are no wikilinks", () => {
    expect(parseRelationLinks("A, B ,C")).toEqual(["A", "B", "C"]);
  });

  it("dedupes and ignores empties/null", () => {
    expect(parseRelationLinks("[[A]], [[A]]")).toEqual(["A"]);
    expect(parseRelationLinks(null)).toEqual([]);
    expect(parseRelationLinks("")).toEqual([]);
  });

  it("keeps both paths in a mixed plain + wikilink value (source order)", () => {
    expect(parseRelationLinks("A, [[B]]")).toEqual(["A", "B"]);
    expect(parseRelationLinks("[[B]], A")).toEqual(["B", "A"]);
  });
});

describe("computeFrontmatterRollup", () => {
  // Linked rows' frontmatter, resolved by path (prod: superstate.pathsIndex).
  const fm: Record<string, Record<string, any>> = {
    "Tasks/A": { hours: 3, status: "done" },
    "Tasks/B": { hours: 5, status: "open" },
    "Tasks/C": { hours: "nope", status: "done" },
    // Tasks/D has no frontmatter entry (unresolved link)
  };
  const resolve = (p: string) => fm[p] ?? null;
  const cfg = (over: Partial<RollupConfig>): RollupConfig => ({
    relationProperty: "tasks",
    targetProperty: "hours",
    fn: "count",
    ...over,
  });

  it("count returns the number of relation links (not resolved rows)", () => {
    expect(
      computeFrontmatterRollup({
        linkPaths: ["Tasks/A", "Tasks/B", "Tasks/D"],
        config: cfg({ fn: "count" }),
        resolveFrontmatter: resolve,
      })
    ).toBe("3");
  });

  it("sum/avg over a numeric target, skipping non-numeric and unresolved", () => {
    const links = ["Tasks/A", "Tasks/B", "Tasks/C", "Tasks/D"];
    expect(
      computeFrontmatterRollup({
        linkPaths: links,
        config: cfg({ fn: "sum", targetProperty: "hours" }),
        resolveFrontmatter: resolve,
      })
    ).toBe("8");
    expect(
      computeFrontmatterRollup({
        linkPaths: links,
        config: cfg({ fn: "avg", targetProperty: "hours" }),
        resolveFrontmatter: resolve,
      })
    ).toBe("4");
  });

  it("min and max over the numeric target", () => {
    const links = ["Tasks/A", "Tasks/B"];
    expect(
      computeFrontmatterRollup({
        linkPaths: links,
        config: cfg({ fn: "min", targetProperty: "hours" }),
        resolveFrontmatter: resolve,
      })
    ).toBe("3");
    expect(
      computeFrontmatterRollup({
        linkPaths: links,
        config: cfg({ fn: "max", targetProperty: "hours" }),
        resolveFrontmatter: resolve,
      })
    ).toBe("5");
  });

  it("values joins unique non-empty target values", () => {
    expect(
      computeFrontmatterRollup({
        linkPaths: ["Tasks/A", "Tasks/B", "Tasks/C"],
        config: cfg({ fn: "values", targetProperty: "status" }),
        resolveFrontmatter: resolve,
      })
    ).toBe("done, open");
  });

  it("count_values counts only resolved non-empty target values", () => {
    expect(
      computeFrontmatterRollup({
        linkPaths: ["Tasks/A", "Tasks/B", "Tasks/D"],
        config: cfg({ fn: "count_values", targetProperty: "hours" }),
        resolveFrontmatter: resolve,
      })
    ).toBe("2");
  });

  it("numeric aggregate with no numeric values: sum=0, others empty", () => {
    expect(
      computeFrontmatterRollup({
        linkPaths: ["Tasks/C"],
        config: cfg({ fn: "sum", targetProperty: "hours" }),
        resolveFrontmatter: resolve,
      })
    ).toBe("0");
    expect(
      computeFrontmatterRollup({
        linkPaths: ["Tasks/C"],
        config: cfg({ fn: "avg", targetProperty: "hours" }),
        resolveFrontmatter: resolve,
      })
    ).toBe("");
  });

  it("flattens array-valued frontmatter for count_values/values/sum", () => {
    const arrFm: Record<string, Record<string, any>> = {
      P: { labels: ["x", "y"], nums: [2, 3] },
      Q: { labels: ["y", "z"], nums: [4] },
    };
    const r = (p: string) => arrFm[p] ?? null;
    expect(
      computeFrontmatterRollup({
        linkPaths: ["P", "Q"],
        config: cfg({ fn: "count_values", targetProperty: "labels" }),
        resolveFrontmatter: r,
      })
    ).toBe("4");
    expect(
      computeFrontmatterRollup({
        linkPaths: ["P", "Q"],
        config: cfg({ fn: "values", targetProperty: "labels" }),
        resolveFrontmatter: r,
      })
    ).toBe("x, y, z");
    expect(
      computeFrontmatterRollup({
        linkPaths: ["P", "Q"],
        config: cfg({ fn: "sum", targetProperty: "nums" }),
        resolveFrontmatter: r,
      })
    ).toBe("9");
  });

  it("does not coerce booleans, dates, or whitespace into numbers", () => {
    const oddFm: Record<string, Record<string, any>> = {
      A: { v: true },
      B: { v: "   " },
      C: { v: 4 },
    };
    const r = (p: string) => oddFm[p] ?? null;
    // true and whitespace are excluded; only 4 sums.
    expect(
      computeFrontmatterRollup({
        linkPaths: ["A", "B", "C"],
        config: cfg({ fn: "sum", targetProperty: "v" }),
        resolveFrontmatter: r,
      })
    ).toBe("4");
  });

  it("empty relation: count 0, no crash", () => {
    expect(
      computeFrontmatterRollup({
        linkPaths: [],
        config: cfg({ fn: "count" }),
        resolveFrontmatter: resolve,
      })
    ).toBe("0");
  });
});

describe("computeFrontmatterRollupDetailed (ADR 0029 D2)", () => {
  // Reuse the same fixture: A/B numeric+resolved, C resolves but non-numeric,
  // D dangling (unresolved).
  const fm: Record<string, Record<string, any>> = {
    "Tasks/A": { hours: 3, status: "done" },
    "Tasks/B": { hours: 5, status: "open" },
    "Tasks/C": { hours: "nope", status: "done" },
  };
  const resolve = (p: string) => fm[p] ?? null;
  const cfg = (over: Partial<RollupConfig>): RollupConfig => ({
    relationProperty: "tasks",
    targetProperty: "hours",
    fn: "count",
    ...over,
  });

  it("relationCount always equals linkPaths.length (incl. dangling)", () => {
    const r = computeFrontmatterRollupDetailed({
      linkPaths: ["Tasks/A", "Tasks/B", "Tasks/D"],
      config: cfg({ fn: "sum" }),
      resolveFrontmatter: resolve,
    });
    expect(r.relationCount).toBe(3);
  });

  it("count: resolvedCount == relationCount (never partial) and value preserved", () => {
    const r = computeFrontmatterRollupDetailed({
      linkPaths: ["Tasks/A", "Tasks/B", "Tasks/D"],
      config: cfg({ fn: "count" }),
      resolveFrontmatter: resolve,
    });
    expect(r).toEqual({ value: "3", relationCount: 3, resolvedCount: 3 });
  });

  it("sum/avg/min/max: resolvedCount counts only links yielding a finite number", () => {
    const links = ["Tasks/A", "Tasks/B", "Tasks/C", "Tasks/D"];
    // A=3, B=5 numeric; C='nope' non-numeric; D dangling -> 2 of 4 counted.
    for (const fn of ["sum", "avg", "min", "max"]) {
      const r = computeFrontmatterRollupDetailed({
        linkPaths: links,
        config: cfg({ fn, targetProperty: "hours" }),
        resolveFrontmatter: resolve,
      });
      expect(r.relationCount).toBe(4);
      expect(r.resolvedCount).toBe(2);
    }
    // Value still preserved (sum of 3+5).
    expect(
      computeFrontmatterRollupDetailed({
        linkPaths: links,
        config: cfg({ fn: "sum", targetProperty: "hours" }),
        resolveFrontmatter: resolve,
      }).value
    ).toBe("8");
  });

  it("count_values/values/unique: resolvedCount counts links with a non-empty value", () => {
    const links = ["Tasks/A", "Tasks/B", "Tasks/C", "Tasks/D"];
    // hours: A=3, B=5, C='nope' all present & non-empty; D dangling -> 3 of 4.
    for (const fn of ["count_values", "values", "unique"]) {
      const r = computeFrontmatterRollupDetailed({
        linkPaths: links,
        config: cfg({ fn, targetProperty: "hours" }),
        resolveFrontmatter: resolve,
      });
      expect(r.relationCount).toBe(4);
      expect(r.resolvedCount).toBe(3);
    }
  });

  it("attributes resolution PER LINK, not per flattened value (array target)", () => {
    const arrFm: Record<string, Record<string, any>> = {
      P: { nums: [2, 3] }, // one link, two numeric values
      Q: { nums: [] }, // present but empty -> contributes nothing
    };
    const r = (p: string) => arrFm[p] ?? null;
    const detailed = computeFrontmatterRollupDetailed({
      linkPaths: ["P", "Q", "R"], // R dangling
      config: cfg({ fn: "sum", targetProperty: "nums" }),
      resolveFrontmatter: r,
    });
    // Only P contributes a number -> 1 of 3, even though P carried 2 values.
    expect(detailed.relationCount).toBe(3);
    expect(detailed.resolvedCount).toBe(1);
    expect(detailed.value).toBe("5");
  });

  it("all links resolve: resolvedCount == relationCount (no partial)", () => {
    const r = computeFrontmatterRollupDetailed({
      linkPaths: ["Tasks/A", "Tasks/B"],
      config: cfg({ fn: "sum", targetProperty: "hours" }),
      resolveFrontmatter: resolve,
    });
    expect(r.resolvedCount).toBe(r.relationCount);
  });
});
