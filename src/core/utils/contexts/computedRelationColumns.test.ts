import { PathPropertyName } from "shared/types/context";
import { DBRows, SpaceProperty } from "shared/types/mdb";
import { fieldTypeForField } from "schemas/mdb";
import { filterReturnForCol } from "core/utils/contexts/predicate/filter";
import {
  normalizedSortForType,
  sortReturnForCol,
} from "core/utils/contexts/predicate/sort";
import fs from "fs";
import path from "path";

const loadMaterializer = (): any => {
  try {
    return require("./computedRelationColumns").materializeComputedRelationColumns;
  } catch {
    return undefined;
  }
};

const makeSuperstate = () => {
  const pathsIndex = new Map<string, any>([
    [
      "Projects/Alpha.md",
      {
        metadata: {
          property: {},
          inlinks: ["Tasks/A.md", "Tasks/B.md"],
        },
      },
    ],
    [
      "Projects/Beta.md",
      {
        metadata: {
          property: {},
          inlinks: [],
        },
      },
    ],
    [
      "Tasks/A.md",
      {
        metadata: {
          property: {
            project: "[[Projects/Alpha]]",
            done: "2026-01-01",
          },
        },
      },
    ],
    [
      "Tasks/B.md",
      {
        metadata: {
          property: {
            project: "[[Projects/Alpha]]",
            done: "2025-12-31",
          },
        },
      },
    ],
  ]);
  return {
    pathsIndex,
    spacesIndex: new Map(),
    spaceManager: {
      resolvePath: (link: string) => {
        if (pathsIndex.has(link)) return link;
        if (pathsIndex.has(`${link}.md`)) return `${link}.md`;
        const wanted = link.replace(/\.md$/, "").split("/").pop();
        return (
          [...pathsIndex.keys()].find(
            (path) => path.replace(/\.md$/, "").split("/").pop() == wanted
          ) ?? link
        );
      },
    },
  } as any;
};

describe("materializeComputedRelationColumns", () => {
  it("is wired into the provider data seam before native filter and sort", () => {
    const source = fs.readFileSync(
      path.join(
        process.cwd(),
        "src/core/react/context/ContextEditorContext.tsx"
      ),
      "utf8"
    );
    const materializeAt = source.indexOf("materializeComputedRelationColumns({");
    const sortAt = source.indexOf("const sortedAllData = useMemo");
    expect(materializeAt).toBeGreaterThan(-1);
    expect(sortAt).toBeGreaterThan(materializeAt);
    expect(source).toContain("millisecondsUntilNextLocalDay()");
  });

  it("overlays scoped forward and reverse rollup values without mutating rows", () => {
    const materialize = loadMaterializer();
    expect(typeof materialize).toBe("function");

    const rows: DBRows = [
      {
        [PathPropertyName]: "Projects/Alpha.md",
        tasks: "[[Tasks/A]], [[Tasks/B]]",
      },
    ];
    const snapshot = JSON.parse(JSON.stringify(rows));
    const columns: SpaceProperty[] = [
      {
        name: "forward_today",
        type: "rollup",
        value: JSON.stringify({
          ref: "tasks",
          fn: "count",
          period: { field: "done", scope: "today" },
        }),
      },
      {
        name: "reverse_this_week",
        type: "backlink",
        value: JSON.stringify({
          ref: "project",
          fn: "count",
          period: { field: "done", scope: "iso-week" },
        }),
      },
    ];

    const result = materialize({
      rows,
      columns,
      superstate: makeSuperstate(),
      contextPath: "Projects",
      now: new Date(2026, 0, 1, 12),
    });

    expect(result).toEqual([
      expect.objectContaining({
        forward_today: "1",
        reverse_this_week: "2",
      }),
    ]);
    expect(rows).toEqual(snapshot);
    expect(result[0]).not.toBe(rows[0]);
  });

  it("degrades malformed computed-column config to an empty render value", () => {
    const materialize = loadMaterializer();
    expect(typeof materialize).toBe("function");
    const rows = [{ [PathPropertyName]: "Projects/Alpha.md" }];
    const result = materialize({
      rows,
      columns: [{ name: "broken", type: "rollup", value: "{" }],
      superstate: makeSuperstate(),
      contextPath: "Projects",
      now: new Date(2026, 0, 1),
    });
    expect(result[0].broken).toBe("");
  });

  it("feeds scoped counts into native numeric filter and sort dispatch", () => {
    const materialize = loadMaterializer();
    const column: SpaceProperty = {
      name: "done_today",
      type: "backlink",
      value: JSON.stringify({
        ref: "project",
        fn: "count",
        period: { field: "done", scope: "today" },
      }),
    };
    const rows = materialize({
      rows: [
        { [PathPropertyName]: "Projects/Alpha.md" },
        { [PathPropertyName]: "Projects/Beta.md" },
      ],
      columns: [column],
      superstate: makeSuperstate(),
      contextPath: "Projects",
      now: new Date(2026, 0, 1, 12),
    });

    expect(fieldTypeForField(column)).toBe("number");
    expect(
      filterReturnForCol(
        column,
        {
          field: column.name,
          fn: "isGreatThan",
          fType: "literal",
          value: "0",
        } as any,
        rows[0],
        {}
      )
    ).toBe(true);
    expect(
      filterReturnForCol(
        column,
        {
          field: column.name,
          fn: "isGreatThan",
          fType: "literal",
          value: "0",
        } as any,
        rows[1],
        {}
      )
    ).toBe(false);

    const sortFn = normalizedSortForType(fieldTypeForField(column), false);
    expect(sortFn).toBe("number");
    expect(
      sortReturnForCol(
        column,
        { field: column.name, fn: sortFn } as any,
        rows[1],
        rows[0]
      )
    ).toBe(-1);
  });
});
