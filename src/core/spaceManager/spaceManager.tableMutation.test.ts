import { PathPropertyName } from "shared/types/context";
import { SpaceTable } from "shared/types/mdb";
import { applyTableMutation, TableMutationConflict } from "core/utils/contexts/tableMutation";

const table = (): SpaceTable => ({
  schema: { id: "alternate", name: "Alternate", predicate: "one" },
  cols: [
    { name: PathPropertyName, schemaId: "alternate", type: "file" },
    { name: "Status", schemaId: "alternate", type: "text" },
    { name: "Remove Me", schemaId: "alternate", type: "text" },
  ],
  rows: [
    { [PathPropertyName]: "A.md", Status: "open" },
    { [PathPropertyName]: "Delete.md", Status: "old" },
  ],
} as any);

describe("explicit table mutation operations", () => {
  it("does not depend on metadata lost by structuredClone and preserves independent cached edits", () => {
    const base = structuredClone(table());
    const firstDesired = structuredClone(base);
    firstDesired.rows.push({ [PathPropertyName]: "First.md", Status: "one" });
    const secondDesired = structuredClone(base);
    secondDesired.cols.push({ name: "Owner", schemaId: "alternate", type: "text" } as any);

    const afterFirst = applyTableMutation(structuredClone(base), { kind: "merge", base, desired: firstDesired });
    const afterSecond = applyTableMutation(afterFirst, { kind: "merge", base: structuredClone(base), desired: secondDesired });

    expect(afterSecond.schema.id).toBe("alternate");
    expect(afterSecond.rows.map(row => row[PathPropertyName])).toContain("First.md");
    expect(afterSecond.cols.map(col => col.name)).toContain("Owner");
  });

  it("preserves concurrent row and column rename/delete plus independent schema changes", () => {
    const base = table();
    const firstDesired = structuredClone(base);
    firstDesired.rows = firstDesired.rows
      .filter(row => row[PathPropertyName] !== "Delete.md")
      .map(row => row[PathPropertyName] === "A.md" ? { ...row, [PathPropertyName]: "Renamed.md" } : row);
    firstDesired.cols = firstDesired.cols
      .filter(col => col.name !== "Remove Me")
      .map(col => col.name === "Status" ? { ...col, name: "State" } : col);
    const concurrent = structuredClone(base);
    concurrent.schema = { ...concurrent.schema, predicate: "two" };
    concurrent.rows.push({ [PathPropertyName]: "Concurrent.md", Status: "new" });

    const merged = applyTableMutation(concurrent, { kind: "merge", base, desired: firstDesired });

    expect(merged.schema.predicate).toBe("two");
    expect(merged.rows.map(row => row[PathPropertyName])).toEqual(["Renamed.md", "Concurrent.md"]);
    expect(merged.cols.map(col => col.name)).toEqual([PathPropertyName, "State"]);
  });

  it("surfaces a conflict instead of silently overwriting the same schema/view field", () => {
    const base = table();
    const desired = structuredClone(base);
    desired.schema.predicate = "desired";
    const concurrent = structuredClone(base);
    concurrent.schema.predicate = "concurrent";

    expect(() => applyTableMutation(concurrent, { kind: "merge", base, desired }))
      .toThrow(TableMutationConflict);
  });

  it.each([
    ["empty base row path", (base: SpaceTable, desired: SpaceTable, current: SpaceTable) => {
      base.rows.push({ [PathPropertyName]: "", Status: "bad" });
      desired.rows = structuredClone(base.rows);
      current.rows = structuredClone(base.rows);
    }],
    ["duplicate desired row path", (_base: SpaceTable, desired: SpaceTable) => {
      desired.rows.push({ [PathPropertyName]: "A.md", Status: "duplicate" });
    }],
    ["duplicate current row path", (_base: SpaceTable, _desired: SpaceTable, current: SpaceTable) => {
      current.rows.push({ [PathPropertyName]: "A.md", Status: "duplicate" });
    }],
  ])("rejects an ambiguous %s", (_name, mutate) => {
    const base = table();
    const desired = structuredClone(base);
    const current = structuredClone(base);
    mutate(base, desired, current);

    expect(() => applyTableMutation(current, { kind: "merge", base, desired }))
      .toThrow(TableMutationConflict);
  });

  it("rejects duplicate and empty column identities before merging", () => {
    const duplicateBase = table();
    duplicateBase.cols.push({ name: "Status", schemaId: "alternate", type: "text" } as any);
    expect(() => applyTableMutation(structuredClone(duplicateBase), {
      kind: "merge", base: duplicateBase, desired: structuredClone(duplicateBase),
    })).toThrow(TableMutationConflict);

    const base = table();
    const desired = structuredClone(base);
    desired.cols.push({ name: "", schemaId: "alternate", type: "text" } as any);
    expect(() => applyTableMutation(structuredClone(base), { kind: "merge", base, desired }))
      .toThrow(TableMutationConflict);
  });

  it("preserves intentional desired row and column ordering", () => {
    const base = table();
    const desired = structuredClone(base);
    desired.rows.reverse();
    desired.cols = [desired.cols[2], desired.cols[0], desired.cols[1]];

    const merged = applyTableMutation(structuredClone(base), { kind: "merge", base, desired });

    expect(merged.rows.map(row => row[PathPropertyName])).toEqual(["Delete.md", "A.md"]);
    expect(merged.cols.map(col => col.name)).toEqual(["Remove Me", PathPropertyName, "Status"]);
  });

  it("keeps concurrent independent additions deterministically after desired ordering", () => {
    const base = table();
    const desired = structuredClone(base);
    desired.rows.reverse();
    desired.rows.push({ [PathPropertyName]: "Desired.md", Status: "desired" });
    desired.cols = [desired.cols[1], desired.cols[0], desired.cols[2]];
    desired.cols.push({ name: "Desired Column", schemaId: "alternate", type: "text" } as any);
    const current = structuredClone(base);
    current.rows.splice(1, 0, { [PathPropertyName]: "Concurrent One.md", Status: "one" });
    current.rows.push({ [PathPropertyName]: "Concurrent Two.md", Status: "two" });
    current.cols.splice(1, 0, { name: "Concurrent One", schemaId: "alternate", type: "text" } as any);
    current.cols.push({ name: "Concurrent Two", schemaId: "alternate", type: "text" } as any);

    const merged = applyTableMutation(current, { kind: "merge", base, desired });

    expect(merged.rows.map(row => row[PathPropertyName])).toEqual([
      "Delete.md", "A.md", "Desired.md", "Concurrent One.md", "Concurrent Two.md",
    ]);
    expect(merged.cols.map(col => col.name)).toEqual([
      "Status", PathPropertyName, "Remove Me", "Desired Column", "Concurrent One", "Concurrent Two",
    ]);
  });

  it.each([
    ["row rename versus edit", (desired: SpaceTable, current: SpaceTable) => {
      desired.rows[0][PathPropertyName] = "Renamed.md";
      current.rows[0].Status = "concurrent";
    }],
    ["row delete versus edit", (desired: SpaceTable, current: SpaceTable) => {
      desired.rows = desired.rows.slice(1);
      current.rows[0].Status = "concurrent";
    }],
    ["column rename versus edit", (desired: SpaceTable, current: SpaceTable) => {
      desired.cols[1].name = "State";
      current.cols[1].type = "number" as any;
    }],
    ["column delete versus edit", (desired: SpaceTable, current: SpaceTable) => {
      desired.cols = desired.cols.filter(col => col.name !== "Status");
      current.cols[1].type = "number" as any;
    }],
  ])("surfaces an explicit conflict for %s", (_name, mutate) => {
    const base = table();
    const desired = structuredClone(base);
    const current = structuredClone(base);
    mutate(desired, current);

    expect(() => applyTableMutation(current, { kind: "merge", base, desired }))
      .toThrow(TableMutationConflict);
  });

  it("preserves concurrent deletion when the desired mutation did not edit that identity", () => {
    const base = table();
    const desired = structuredClone(base);
    desired.schema.name = "Desired Name";
    const current = structuredClone(base);
    current.rows = current.rows.filter(row => row[PathPropertyName] !== "Delete.md");
    current.cols = current.cols.filter(col => col.name !== "Remove Me");

    const merged = applyTableMutation(current, { kind: "merge", base, desired });

    expect(merged.schema.name).toBe("Desired Name");
    expect(merged.rows.map(row => row[PathPropertyName])).toEqual(["A.md"]);
    expect(merged.cols.map(col => col.name)).toEqual([PathPropertyName, "Status"]);
  });

  it("rejects an identical concurrent row at a newly desired rename identity", () => {
    const base = table();
    const desired = structuredClone(base);
    desired.rows[0] = {
      ...desired.rows[0],
      [PathPropertyName]: "Renamed.md",
    };
    const current = structuredClone(base);
    current.rows.push(structuredClone(desired.rows[0]));

    expect(() => applyTableMutation(current, { kind: "merge", base, desired }))
      .toThrow(TableMutationConflict);
  });

  it("rejects an identical concurrent column at a newly desired rename identity", () => {
    const base = table();
    const desired = structuredClone(base);
    desired.cols[1] = { ...desired.cols[1], name: "State" };
    const current = structuredClone(base);
    current.cols.push(structuredClone(desired.cols[1]));

    expect(() => applyTableMutation(current, { kind: "merge", base, desired }))
      .toThrow(TableMutationConflict);
  });

  it.each([
    ["desired", (base: SpaceTable, desired: SpaceTable) => {
      desired.schema.id = "renamed";
    }],
    ["current", (_base: SpaceTable, _desired: SpaceTable, current: SpaceTable) => {
      current.schema.id = "concurrent";
    }],
  ])("rejects a %s schema identity mismatch", (_name, mutate) => {
    const base = table();
    const desired = structuredClone(base);
    const current = structuredClone(base);
    mutate(base, desired, current);

    expect(() => applyTableMutation(current, { kind: "merge", base, desired }))
      .toThrow(TableMutationConflict);
  });
});
