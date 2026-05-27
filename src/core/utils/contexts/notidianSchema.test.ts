import { frontmatterPropertySource } from "core/utils/properties/allProperties";
import { defaultContextSchemaID } from "shared/schemas/context";
import { PathPropertyName } from "shared/types/context";
import { SpaceTable } from "shared/types/mdb";
import {
  createFrontmatterPropertyPlan,
  discoverFrontmatterSchema,
  planDeleteFrontmatterProperty,
  planRenameFrontmatterProperty,
} from "./notidianSchema";

const table = (): SpaceTable => ({
  schema: { id: defaultContextSchemaID, name: "Files", type: "db" },
  cols: [
    {
      name: PathPropertyName,
      type: "file",
      schemaId: defaultContextSchemaID,
      primary: "true",
    },
    {
      name: "status",
      type: "text",
      value: "",
      schemaId: defaultContextSchemaID,
      source: frontmatterPropertySource,
    },
  ],
  rows: [],
});

describe("discoverFrontmatterSchema", () => {
  it("summarizes existing frontmatter keys without writing files", () => {
    const schema = discoverFrontmatterSchema({
      paths: [
        "Relays & Devices/A.md",
        "Relays & Devices/B.md",
        "Relays & Devices/C.md",
      ],
      frontmatterByPath: {
        "Relays & Devices/A.md": {
          status: "active",
          rating: 2,
          enabled: true,
          internal: "skip",
        },
        "Relays & Devices/B.md": {
          status: "paused",
          rating: "unknown",
        },
        "Relays & Devices/C.md": {
          enabled: false,
        },
      },
      excludedKeys: ["internal"],
    });

    const byKey = new Map(schema.map((property) => [property.key, property]));

    expect(byKey.get("status")).toEqual({
      key: "status",
      type: "text",
      presentCount: 2,
      missingCount: 1,
      observedTypes: ["text"],
    });
    expect(byKey.get("rating")).toEqual({
      key: "rating",
      type: "text",
      presentCount: 2,
      missingCount: 1,
      observedTypes: ["number", "text"],
    });
    expect(byKey.get("enabled")).toEqual({
      key: "enabled",
      type: "boolean",
      presentCount: 2,
      missingCount: 1,
      observedTypes: ["boolean"],
    });
    expect(byKey.has("internal")).toBe(false);
    expect(byKey.has(PathPropertyName)).toBe(false);
  });
});

describe("createFrontmatterPropertyPlan", () => {
  it("adds a frontmatter-backed view column without frontmatter writes", () => {
    const plan = createFrontmatterPropertyPlan({
      table: table(),
      key: "area",
      type: "text",
    });

    expect(plan.canApply).toBe(true);
    expect(plan.issues).toEqual([]);
    expect(plan.frontmatterWrites).toEqual([]);
    expect(plan.tablePreview.cols.at(-1)).toEqual({
      name: "area",
      type: "text",
      value: "",
      schemaId: defaultContextSchemaID,
      source: frontmatterPropertySource,
    });
  });

  it("blocks duplicate property names case-insensitively", () => {
    const source = table();
    const plan = createFrontmatterPropertyPlan({
      table: source,
      key: "STATUS",
      type: "text",
    });

    expect(plan.canApply).toBe(false);
    expect(plan.issues).toEqual([
      {
        reason: "duplicate-column",
        key: "STATUS",
        existingKey: "status",
      },
    ]);
    expect(plan.tablePreview).toBe(source);
  });
});

describe("planRenameFrontmatterProperty", () => {
  it("does not produce writes for an invalid same-key rename", () => {
    const source = table();

    const plan = planRenameFrontmatterProperty({
      table: source,
      oldKey: "status",
      newKey: "status",
      paths: ["Relays & Devices/A.md"],
      frontmatterByPath: {
        "Relays & Devices/A.md": { status: "active" },
      },
    });

    expect(plan.canApplyAutomatically).toBe(false);
    expect(plan.issues).toEqual([{ reason: "same-key", key: "status" }]);
    expect(plan.fileStates).toEqual([]);
    expect(plan.automaticWrites).toEqual([]);
    expect(plan.tablePreview).toBe(source);
  });

  it("classifies every row and blocks automatic application on collisions", () => {
    const source = table();
    source.cols = source.cols.map((column) =>
      column.name == "status" ? { ...column, name: "state" } : column
    );

    const plan = planRenameFrontmatterProperty({
      table: source,
      oldKey: "state",
      newKey: "status",
      paths: [
        "Relays & Devices/A.md",
        "Relays & Devices/B.md",
        "Relays & Devices/C.md",
        "Relays & Devices/D.md",
        "Relays & Devices/E.md",
      ],
      frontmatterByPath: {
        "Relays & Devices/A.md": { state: "active" },
        "Relays & Devices/B.md": { state: "queued", status: "active" },
        "Relays & Devices/C.md": { state: "done", status: "done" },
        "Relays & Devices/D.md": { status: "archived" },
        "Relays & Devices/E.md": {},
      },
    });

    expect(plan.canApplyAutomatically).toBe(false);
    expect(plan.requiresResolution).toBe(true);
    expect(plan.fileStates).toEqual([
      {
        path: "Relays & Devices/A.md",
        state: "old-only",
        oldValue: "active",
      },
      {
        path: "Relays & Devices/B.md",
        state: "both-conflict",
        oldValue: "queued",
        newValue: "active",
      },
      {
        path: "Relays & Devices/C.md",
        state: "both-same",
        oldValue: "done",
        newValue: "done",
      },
      {
        path: "Relays & Devices/D.md",
        state: "new-only",
        newValue: "archived",
      },
      {
        path: "Relays & Devices/E.md",
        state: "neither",
      },
    ]);
    expect(plan.automaticWrites).toEqual([
      {
        path: "Relays & Devices/A.md",
        set: { status: "active" },
        removeKeys: ["state"],
      },
      {
        path: "Relays & Devices/C.md",
        set: {},
        removeKeys: ["state"],
      },
    ]);
    expect(plan.issues).toEqual([
      {
        reason: "frontmatter-conflict",
        path: "Relays & Devices/B.md",
        oldKey: "state",
        newKey: "status",
      },
    ]);
    expect(plan.tablePreview.cols.find((column) => column.name == "status"))
      .toMatchObject({
        name: "status",
        source: frontmatterPropertySource,
      });
  });
});

describe("planDeleteFrontmatterProperty", () => {
  it("does not produce destructive writes when the property is not in the table schema", () => {
    const plan = planDeleteFrontmatterProperty({
      table: table(),
      key: "missing",
      mode: "delete-frontmatter",
      paths: ["Relays & Devices/A.md"],
      frontmatterByPath: {
        "Relays & Devices/A.md": { missing: "value" },
      },
    });

    expect(plan.issues).toEqual([
      { reason: "missing-source-column", key: "missing" },
    ]);
    expect(plan.affectedFiles).toEqual([]);
    expect(plan.frontmatterWrites).toEqual([]);
  });

  it("can hide a property from the view without deleting frontmatter", () => {
    const plan = planDeleteFrontmatterProperty({
      table: table(),
      key: "status",
      mode: "hide-from-view",
      paths: ["Relays & Devices/A.md"],
      frontmatterByPath: {
        "Relays & Devices/A.md": { status: "active" },
      },
    });

    expect(plan.destructive).toBe(false);
    expect(plan.requiresConfirmation).toBe(false);
    expect(plan.frontmatterWrites).toEqual([]);
    expect(plan.affectedFiles).toEqual([]);
    expect(plan.tablePreview.cols.find((column) => column.name == "status"))
      .toMatchObject({ hidden: "true" });
  });

  it("plans destructive frontmatter deletion as an explicit preview", () => {
    const plan = planDeleteFrontmatterProperty({
      table: table(),
      key: "status",
      mode: "delete-frontmatter",
      paths: [
        "Relays & Devices/A.md",
        "Relays & Devices/B.md",
        "Relays & Devices/C.md",
      ],
      frontmatterByPath: {
        "Relays & Devices/A.md": { status: "active" },
        "Relays & Devices/B.md": {},
        "Relays & Devices/C.md": { status: "" },
      },
    });

    expect(plan.destructive).toBe(true);
    expect(plan.requiresConfirmation).toBe(true);
    expect(plan.affectedFiles).toEqual([
      "Relays & Devices/A.md",
      "Relays & Devices/C.md",
    ]);
    expect(plan.frontmatterWrites).toEqual([
      {
        path: "Relays & Devices/A.md",
        set: {},
        removeKeys: ["status"],
      },
      {
        path: "Relays & Devices/C.md",
        set: {},
        removeKeys: ["status"],
      },
    ]);
    expect(plan.tablePreview.cols.find((column) => column.name == "status"))
      .toMatchObject({ hidden: "true" });
  });
});
