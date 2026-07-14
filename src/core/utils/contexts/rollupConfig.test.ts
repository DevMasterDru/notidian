import { SpaceProperty } from "shared/types/mdb";
import { fieldTypeForField } from "schemas/mdb";
import fs from "fs";
import path from "path";

const loadConfigApi = (): any => {
  try {
    return require("./rollupConfig");
  } catch {
    return {};
  }
};

const column = (type: "rollup" | "backlink", fn: string): SpaceProperty => ({
  name: `${type}_${fn}`,
  type,
  value: JSON.stringify({ ref: "relation", field: "value", fn }),
});

describe("rollup comparison and period config", () => {
  it("infers comparison types from the aggregate function", () => {
    const { comparisonTypeForComputedRelationColumn } = loadConfigApi();
    expect(typeof comparisonTypeForComputedRelationColumn).toBe("function");
    expect(comparisonTypeForComputedRelationColumn(column("rollup", "count"))).toBe(
      "number"
    );
    expect(comparisonTypeForComputedRelationColumn(column("backlink", "latest"))).toBe(
      "date"
    );
    expect(comparisonTypeForComputedRelationColumn(column("rollup", "values"))).toBe(
      "text"
    );
    expect(
      comparisonTypeForComputedRelationColumn({ name: "plain", type: "text" })
    ).toBeNull();
  });

  it("routes native filter and sort menus through the inferred type", () => {
    expect(fieldTypeForField(column("rollup", "count"))).toBe("number");
    expect(fieldTypeForField(column("backlink", "latest"))).toBe("date");
    expect(fieldTypeForField(column("rollup", "values"))).toBe("text");
  });

  it("sets and clears period scope without disturbing the relation config", () => {
    const { updateComputedRelationPeriod } = loadConfigApi();
    expect(typeof updateComputedRelationPeriod).toBe("function");
    const base = {
      ref: "routine",
      field: "done",
      fn: "count",
      keyMatch: { type: "key-match", sourceField: "id" },
    };
    expect(updateComputedRelationPeriod(base, "today", "done")).toEqual({
      ...base,
      period: { field: "done", scope: "today" },
    });
    expect(
      updateComputedRelationPeriod(
        { ...base, period: { field: "done", scope: "today" } },
        "",
        "done"
      )
    ).toEqual(base);
  });

  it("wires period configuration into the property menu and both cell runtimes", () => {
    const read = (relative: string) =>
      fs.readFileSync(path.join(process.cwd(), relative), "utf8");
    const menu = read(
      "src/core/react/components/UI/Menus/contexts/PropertyValue.tsx"
    );
    const rollupCell = read(
      "src/core/react/components/SpaceView/Contexts/DataTypeView/RollupCell.tsx"
    );
    const backlinkCell = read(
      "src/core/react/components/SpaceView/Contexts/DataTypeView/BacklinkCell.tsx"
    );
    expect(menu).toContain("selectComputedRelationPeriod");
    expect(menu).toContain('span>{"Period"}</span>');
    expect(rollupCell).toContain("period: periodScopedRollups");
    expect(backlinkCell).toContain("period: periodScopedRollups");
  });
});
