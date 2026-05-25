import { frontmatterPropertySource } from "core/utils/properties/allProperties";
import { defaultContextSchemaID } from "shared/schemas/context";
import { PathPropertyName } from "shared/types/context";
import { SpaceTable } from "shared/types/mdb";
import {
  applyLegacyContextMigrationPlan,
  auditLegacyContextTable,
  createLegacyContextMigrationPlan,
} from "./legacyContextMigration";

const legacyTable = (): SpaceTable => ({
  schema: { id: defaultContextSchemaID, name: "Files", type: "db" },
  cols: [
    {
      name: PathPropertyName,
      type: "file",
      schemaId: defaultContextSchemaID,
    },
    {
      name: "Created",
      type: "fileprop",
      value: `${PathPropertyName}.ctime`,
      schemaId: defaultContextSchemaID,
    },
    {
      name: "status",
      type: "text",
      value: "",
      schemaId: defaultContextSchemaID,
    },
    {
      name: "manual",
      type: "text",
      value: "",
      schemaId: defaultContextSchemaID,
    },
  ],
  rows: [
    {
      [PathPropertyName]: "Relays & Devices/A.md",
      status: "active",
      manual: "context-a",
    },
    {
      [PathPropertyName]: "Relays & Devices/B.md",
      status: "paused",
      manual: "context-b",
    },
  ],
});

const categoryFor = (table: SpaceTable, columnName: string) =>
  auditLegacyContextTable({
    table,
    frontmatterByPath: {},
  }).columns.find((column) => column.columnName == columnName)?.category;

describe("auditLegacyContextTable", () => {
  it("classifies frontmatter candidates while preserving context-only columns", () => {
    const audit = auditLegacyContextTable({
      table: legacyTable(),
      frontmatterByPath: {
        "Relays & Devices/A.md": {
          status: "active",
          rating: 5,
          area: "Veg",
        },
        "Relays & Devices/B.md": {
          status: "paused",
          rating: 4,
        },
      },
    });

    expect(audit.columns.map(({ columnName, category }) => ({
      columnName,
      category,
    }))).toEqual([
      { columnName: PathPropertyName, category: "file" },
      { columnName: "Created", category: "computed" },
      { columnName: "status", category: "frontmatter-candidate" },
      { columnName: "manual", category: "context-only" },
    ]);
    expect(audit.discoveredFrontmatterColumns.map((column) => column.name))
      .toEqual(["rating", "area"]);
    expect(audit.valueIssues).toEqual([
      expect.objectContaining({
        columnName: "status",
        path: "Relays & Devices/A.md",
        state: "matching",
      }),
      expect.objectContaining({
        columnName: "status",
        path: "Relays & Devices/B.md",
        state: "matching",
      }),
    ]);
  });

  it("recognizes existing authority categories without frontmatter snapshots", () => {
    const table = legacyTable();
    table.cols = table.cols.map((column) =>
      column.name == "status"
        ? { ...column, source: frontmatterPropertySource }
        : column
    );

    expect(categoryFor(table, PathPropertyName)).toBe("file");
    expect(categoryFor(table, "Created")).toBe("computed");
    expect(categoryFor(table, "status")).toBe("already-frontmatter");
    expect(categoryFor(table, "manual")).toBe("context-only");
  });
});

describe("createLegacyContextMigrationPlan", () => {
  it("plans safe source marking, row cleanup, and discovered frontmatter columns", () => {
    const audit = auditLegacyContextTable({
      table: legacyTable(),
      frontmatterByPath: {
        "Relays & Devices/A.md": {
          status: "active",
          rating: 5,
          area: "Veg",
        },
        "Relays & Devices/B.md": {
          status: "paused",
          rating: 4,
        },
      },
    });

    const plan = createLegacyContextMigrationPlan(audit);

    expect(plan.canApplyAutomatically).toBe(true);
    expect(plan.columnsToMarkFrontmatter).toEqual(["status"]);
    expect(plan.columnsToStripFromRows).toEqual(["Created", "status"]);
    expect(plan.preservedContextColumns).toEqual(["manual"]);
    expect(plan.columnsToAdd.map((column) => column.name)).toEqual([
      "rating",
      "area",
    ]);
    expect(plan.blockingIssues).toEqual([]);
  });

  it("blocks automatic cleanup when duplicate context and frontmatter values conflict", () => {
    const audit = auditLegacyContextTable({
      table: legacyTable(),
      frontmatterByPath: {
        "Relays & Devices/A.md": {
          status: "frontmatter-active",
        },
        "Relays & Devices/B.md": {
          status: "paused",
        },
      },
    });

    const plan = createLegacyContextMigrationPlan(audit);

    expect(plan.canApplyAutomatically).toBe(false);
    expect(plan.columnsToMarkFrontmatter).toEqual([]);
    expect(plan.columnsToStripFromRows).toEqual(["Created"]);
    expect(plan.blockingIssues).toEqual([
      expect.objectContaining({
        columnName: "status",
        path: "Relays & Devices/A.md",
        state: "conflict",
        contextValue: "active",
        frontmatterValue: "frontmatter-active",
      }),
    ]);
  });

  it("blocks automatic cleanup when context has values that frontmatter lacks", () => {
    const audit = auditLegacyContextTable({
      table: legacyTable(),
      frontmatterByPath: {
        "Relays & Devices/A.md": {},
        "Relays & Devices/B.md": {
          status: "paused",
        },
      },
    });

    const plan = createLegacyContextMigrationPlan(audit);

    expect(plan.canApplyAutomatically).toBe(false);
    expect(plan.columnsToMarkFrontmatter).toEqual([]);
    expect(plan.blockingIssues).toEqual([
      expect.objectContaining({
        columnName: "status",
        path: "Relays & Devices/A.md",
        state: "context-only-value",
        contextValue: "active",
      }),
    ]);
  });
});

describe("applyLegacyContextMigrationPlan", () => {
  it("returns a migrated copy without mutating the input table", () => {
    const table = legacyTable();
    const audit = auditLegacyContextTable({
      table,
      frontmatterByPath: {
        "Relays & Devices/A.md": {
          status: "active",
          rating: 5,
        },
        "Relays & Devices/B.md": {
          status: "paused",
          rating: 4,
        },
      },
    });
    const plan = createLegacyContextMigrationPlan(audit);

    const migrated = applyLegacyContextMigrationPlan(table, plan);

    expect(migrated).not.toBe(table);
    expect(migrated.cols.find((column) => column.name == "status"))
      .toMatchObject({ source: frontmatterPropertySource });
    expect(migrated.cols.find((column) => column.name == "rating"))
      .toMatchObject({
        name: "rating",
        source: frontmatterPropertySource,
        schemaId: defaultContextSchemaID,
      });
    expect(migrated.rows).toEqual([
      {
        [PathPropertyName]: "Relays & Devices/A.md",
        manual: "context-a",
      },
      {
        [PathPropertyName]: "Relays & Devices/B.md",
        manual: "context-b",
      },
    ]);

    expect(table.cols.find((column) => column.name == "status")?.source)
      .toBeUndefined();
    expect(table.cols.some((column) => column.name == "rating")).toBe(false);
    expect(table.rows[0]).toEqual({
      [PathPropertyName]: "Relays & Devices/A.md",
      status: "active",
      manual: "context-a",
    });
  });
});
