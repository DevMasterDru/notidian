import { computeRowRollup } from "core/utils/contexts/tableRollupRuntime";

// Minimal superstate: pathsIndex (path -> {metadata:{property}}) + empty spacesIndex.
const makeSuperstate = (fm: Record<string, Record<string, any>>) =>
  ({
    spacesIndex: new Map(),
    pathsIndex: new Map(
      Object.entries(fm).map(([path, property]) => [
        path,
        { metadata: { property } },
      ])
    ),
  } as any);

describe("computeRowRollup", () => {
  const superstate = makeSuperstate({
    "Tasks/A": { hours: 3 },
    "Tasks/B": { hours: 5 },
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
});
