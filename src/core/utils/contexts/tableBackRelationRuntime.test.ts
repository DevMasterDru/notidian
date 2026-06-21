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

// Notidian-bk7e: the "Children" backlink (ref = the parent-link column) over a
// path-qualified self-relation, reading inlinks from path.metadata.inlinks (where
// the adapter actually stores them) — the end-to-end children + %-of-children path.
describe("computeRowBackRelation children (Notidian-bk7e)", () => {
  const makeSuperstateMeta = (
    rows: Record<string, { inlinks?: string[]; property?: Record<string, any> }>
  ) => {
    const pathsIndex = new Map(
      Object.entries(rows).map(([path, { inlinks, property }]) => [
        path,
        // inlinks live on METADATA (the real adapter location), NOT top-level.
        { metadata: { inlinks: inlinks ?? [], property: property ?? {} } },
      ])
    );
    const resolvePath = (link: string): string => {
      if (pathsIndex.has(link)) return link;
      if (pathsIndex.has(link + ".md")) return link + ".md";
      const wanted = link.split("/").pop();
      for (const key of pathsIndex.keys()) {
        const base = key.replace(/\.md$/, "").split("/").pop();
        if (base === wanted) return key;
      }
      return link;
    };
    return { spacesIndex: new Map(), pathsIndex, spaceManager: { resolvePath } } as any;
  };

  // Parent has 2 direct children (path-qualified parent links), a grandchild
  // (child of C1, NOT a direct child of Parent), and an incidental inlink.
  const ss = makeSuperstateMeta({
    "F/Parent.md": {
      inlinks: ["F/C1.md", "F/C2.md", "F/G.md", "F/Mention.md"],
      property: {},
    },
    "F/C1.md": { property: { "Parent item": "[[F/Parent|Parent]]", done: true } },
    "F/C2.md": { property: { "Parent item": "[[F/Parent|Parent]]", done: false } },
    "F/G.md": { property: { "Parent item": "[[F/C1|C1]]", done: true } }, // grandchild
    "F/Mention.md": { property: { body: "see [[F/Parent]]" } }, // not a child
  });

  it("lists EXACTLY the direct children (path-qualified self-relation), not grandchildren or incidental links", () => {
    expect(
      computeRowBackRelation(ss, "F/Parent.md", { relationProperty: "Parent item", fn: "list" })
    ).toBe("C1, C2");
  });

  it("percent_checked over the children gives % of children done (the rollup use case)", () => {
    // C1 done=true, C2 done=false -> 1/2 = 50
    expect(
      computeRowBackRelation(ss, "F/Parent.md", {
        relationProperty: "Parent item",
        fn: "percent_checked",
        field: "done",
      })
    ).toBe("50");
  });

  it("reads inlinks from metadata.inlinks (the field the runtime now uses)", () => {
    // A leaf with no children -> empty list, proving the metadata.inlinks read path.
    expect(
      computeRowBackRelation(ss, "F/C2.md", { relationProperty: "Parent item", fn: "list" })
    ).toBe("");
  });
});
