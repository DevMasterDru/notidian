import { computeRowRollup } from "core/utils/contexts/tableRollupRuntime";

// Minimal superstate: pathsIndex (path -> {metadata:{property}}) + empty
// spacesIndex + a spaceManager.resolvePath that emulates the production link
// index (Notidian-e1u): an exact key wins, else a bare path gets ".md", else a
// basename-only link resolves to the file whose basename matches, else the link
// passes through unchanged.
const makeSuperstate = (fm: Record<string, Record<string, any>>) => {
  const pathsIndex = new Map(
    Object.entries(fm).map(([path, property]) => [
      path,
      { metadata: { property } },
    ])
  );
  const resolvePath = (link: string, _source?: string): string => {
    if (pathsIndex.has(link)) return link;
    if (pathsIndex.has(link + ".md")) return link + ".md";
    const wanted = link.split("/").pop();
    for (const key of pathsIndex.keys()) {
      const base = key.replace(/\.md$/, "").split("/").pop();
      if (base === wanted) return key;
    }
    return link;
  };
  return {
    spacesIndex: new Map(),
    pathsIndex,
    spaceManager: { resolvePath },
  } as any;
};

describe("computeRowRollup", () => {
  const superstate = makeSuperstate({
    "Tasks/A": { hours: 3, done: "2026-01-01" },
    "Tasks/B": { hours: 5, done: "2025-12-31" },
  });

  it("resolves linked paths from frontmatter and aggregates the target", () => {
    expect(
      computeRowRollup(
        superstate,
        "[[Tasks/A]], [[Tasks/B]]",
        { relationProperty: "tasks", targetProperty: "hours", fn: "sum" },
        "Projects/X"
      )
    ).toBe("8");
  });

  it("count is independent of resolution", () => {
    expect(
      computeRowRollup(
        superstate,
        "[[Tasks/A]], [[Tasks/Missing]]",
        { relationProperty: "tasks", targetProperty: "hours", fn: "count" },
        "Projects/X"
      )
    ).toBe("2");
  });

  it("returns 0/empty for an empty relation value", () => {
    expect(
      computeRowRollup(
        superstate,
        "",
        { relationProperty: "tasks", targetProperty: "hours", fn: "sum" },
        "Projects/X"
      )
    ).toBe("0");
  });

  it("threads an injected clock through a period-scoped forward rollup", () => {
    expect(
      (computeRowRollup as any)(
        superstate,
        "[[Tasks/A]], [[Tasks/B]]",
        {
          relationProperty: "tasks",
          targetProperty: "",
          fn: "count",
          period: { field: "done", scope: "today" },
        },
        "Projects/X",
        undefined,
        new Date(2026, 0, 1, 12)
      )
    ).toBe("1");
  });

  // Regression for Notidian-e1u: production pathsIndex keys carry the ".md"
  // extension, and relations are commonly authored as bare or basename-only
  // wikilinks. The pure resolvePath left those unresolved (the rollup silently
  // read nothing); routing through spaceManager.resolvePath canonicalizes them.
  it("canonicalizes bare and basename-only links to the .md key", () => {
    const prod = makeSuperstate({
      "Tasks/A.md": { hours: 3 },
      "Tasks/B.md": { hours: 5 },
    });
    expect(
      computeRowRollup(
        prod,
        // [[Tasks/A]] = bare path (no extension); [[B]] = basename only.
        "[[Tasks/A]], [[B]]",
        { relationProperty: "tasks", targetProperty: "hours", fn: "sum" },
        "Projects/X.md"
      )
    ).toBe("8");
  });
});
