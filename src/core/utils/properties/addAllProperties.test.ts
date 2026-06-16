import { defaultContextSchemaID } from "shared/schemas/context";
import { PathPropertyName } from "shared/types/context";
import { SpaceProperty, SpaceTable } from "shared/types/mdb";
import { buildAddAllPropertiesTable } from "./addAllProperties";

// Pure-reducer coverage for the one-click "Add all properties" column
// composition (bd Notidian-r6oj, Part C). This is the offline-testable core of
// the durable materialization path the new-property window now reuses for both
// its prominent top-level action and the buried "Existing Property → All"
// option.

const fmCol = (name: string, type = "text"): SpaceProperty => ({
  name,
  type,
  value: "",
  schemaId: defaultContextSchemaID,
  source: "frontmatter",
});

const baseTable = (): SpaceTable => ({
  schema: { id: defaultContextSchemaID, name: "Files", type: "db" },
  cols: [
    { name: PathPropertyName, type: "file", schemaId: defaultContextSchemaID },
    // An existing COMPUTED column (read-only). It must NEVER be re-typed or
    // re-sourced by add-all; add-all only ever appends new discovered columns.
    {
      name: "backlinks",
      type: "fileprop",
      schemaId: defaultContextSchemaID,
      value: JSON.stringify({ field: "backlinks" }),
    },
    // An existing Notidian-owned column.
    { name: "manual", type: "text", schemaId: defaultContextSchemaID },
  ],
  rows: [{ [PathPropertyName]: "A.md", manual: "local" }],
});

describe("buildAddAllPropertiesTable (Notidian-r6oj)", () => {
  it("appends every discovered frontmatter column after the existing columns, in discovery order", () => {
    const table = baseTable();
    const discovered = [fmCol("status", "option"), fmCol("priority", "number")];

    const next = buildAddAllPropertiesTable(table, discovered);

    expect(next.cols.map((c) => c.name)).toEqual([
      PathPropertyName,
      "backlinks",
      "manual",
      "status",
      "priority",
    ]);
    // Appended columns keep their discovered (frontmatter-sourced) classification.
    expect(next.cols.find((c) => c.name == "status")?.source).toBe(
      "frontmatter"
    );
    expect(next.cols.find((c) => c.name == "priority")?.type).toBe("number");
  });

  it("never re-types or re-sources an existing computed or notidian column (authority partition holds)", () => {
    const table = baseTable();
    // Even if a same-named frontmatter property were (incorrectly) handed in,
    // the reducer only appends — it does not rewrite the existing column. The
    // real caller never passes a name already in table.cols (discovery excludes
    // them), but the reducer must not corrupt them regardless.
    const discovered = [fmCol("brandnew")];

    const next = buildAddAllPropertiesTable(table, discovered);

    const computed = next.cols.find((c) => c.name == "backlinks");
    expect(computed?.type).toBe("fileprop");
    expect(computed?.source).toBeUndefined();
    const notidian = next.cols.find((c) => c.name == "manual");
    expect(notidian?.type).toBe("text");
    expect(notidian?.source).toBeUndefined();
  });

  it("is pure: it mutates neither the input table nor its cols array", () => {
    const table = baseTable();
    const beforeCols = table.cols;
    const beforeLen = table.cols.length;
    const next = buildAddAllPropertiesTable(table, [fmCol("status")]);

    expect(next).not.toBe(table);
    expect(next.cols).not.toBe(table.cols);
    expect(table.cols).toBe(beforeCols);
    expect(table.cols.length).toBe(beforeLen); // unchanged
  });

  it("passes rows through unchanged (new frontmatter columns carry no stored row values)", () => {
    const table = baseTable();
    const next = buildAddAllPropertiesTable(table, [fmCol("status")]);
    expect(next.rows).toBe(table.rows);
  });

  it("tolerates an empty/absent cols or discovered list", () => {
    expect(
      buildAddAllPropertiesTable({ cols: [] } as any, [fmCol("a")]).cols.map(
        (c) => c.name
      )
    ).toEqual(["a"]);
    expect(
      buildAddAllPropertiesTable(baseTable(), []).cols.map((c) => c.name)
    ).toEqual([PathPropertyName, "backlinks", "manual"]);
  });
});
