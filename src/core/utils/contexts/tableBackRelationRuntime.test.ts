import { computeRowBackRelation } from "core/utils/contexts/tableBackRelationRuntime";

// Mock superstate for back-relations: pathsIndex carries each row's `inlinks`
// (reverse-link index) + `metadata.property`, and spaceManager.resolvePath
// emulates the production link index (Notidian-e1u) — exact key wins, else a
// bare path gets ".md", else a basename-only link resolves by basename.
const makeSuperstate = (
  rows: Record<string, { inlinks?: string[]; property?: Record<string, any> }>
) => {
  const pathsIndex = new Map(
    Object.entries(rows).map(([path, { inlinks, property }]) => [
      path,
      { inlinks: inlinks ?? [], metadata: { property: property ?? {} } },
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

describe("computeRowBackRelation", () => {
  // Two rows link to Projects/Alpha.md through `project`, authored as a
  // basename-only and a bare-path wikilink — exactly the forms the pure resolver
  // missed. A third inlink links only incidentally (no `project` property) and
  // must be excluded.
  const superstate = makeSuperstate({
    "Projects/Alpha.md": {
      inlinks: ["Tasks/A.md", "Tasks/B.md", "Notes/Mention.md"],
      property: {},
    },
    "Tasks/A.md": { property: { project: "[[Alpha]]", hours: 3 } },
    "Tasks/B.md": { property: { project: "[[Projects/Alpha]]", hours: 5 } },
    "Notes/Mention.md": { property: { body: "see [[Projects/Alpha]]" } },
  });

  it("lists rows that link back via basename and bare-path wikilinks", () => {
    expect(
      computeRowBackRelation(superstate, "Projects/Alpha.md", {
        relationProperty: "project",
        fn: "list",
      })
    ).toBe("A, B");
  });

  it("excludes inlinks whose relation property does not resolve back", () => {
    // Notes/Mention is an inlink but its `project` property is absent, so it is
    // not a back-relation through `project`.
    expect(
      computeRowBackRelation(superstate, "Projects/Alpha.md", {
        relationProperty: "project",
        fn: "count",
      })
    ).toBe("2");
  });

  it("aggregates a field over the back-relation set", () => {
    expect(
      computeRowBackRelation(superstate, "Projects/Alpha.md", {
        relationProperty: "project",
        fn: "sum",
        field: "hours",
      })
    ).toBe("8");
  });

  it("returns empty when nothing links back", () => {
    expect(
      computeRowBackRelation(superstate, "Tasks/A.md", {
        relationProperty: "project",
        fn: "list",
      })
    ).toBe("");
  });

  it("returns empty for missing config", () => {
    expect(
      computeRowBackRelation(superstate, "Projects/Alpha.md", {
        relationProperty: "",
      })
    ).toBe("");
  });
});
