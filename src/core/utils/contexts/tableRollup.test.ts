import {
  computeFrontmatterRollup,
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
