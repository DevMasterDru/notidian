import {
  parseTypeProfile,
  planFieldsMirror,
  planTypeProfileApply,
  typeProfileKindForType,
} from "core/utils/contexts/typeProfile";
import { defaultContextSchemaID } from "shared/schemas/context";
import { SpaceTable, SpaceTableSchema } from "shared/types/mdb";

const reviewsFrontmatter = {
  schema_type: "notidian_type_profile",
  database: "Reviews",
  slug: "reviews",
  fields: {
    type: { kind: "text", value: "review", required: true },
    status: {
      kind: "select",
      options: ["awaiting-review", "approved", "resolved"],
      required: true,
    },
    created: { kind: "date", required: true },
    project: { kind: "text" },
  },
};

const tableWithCols = (cols: SpaceTable["cols"]): SpaceTable => ({
  schema: { id: defaultContextSchemaID } as SpaceTableSchema,
  cols,
  rows: [],
});

describe("parseTypeProfile", () => {
  it("returns null without the schema_type marker", () => {
    expect(parseTypeProfile({ fields: {} })).toBeNull();
    expect(parseTypeProfile(null)).toBeNull();
  });

  it("parses kinds, options, required, and fixed values", () => {
    const profile = parseTypeProfile(reviewsFrontmatter);
    expect(profile.database).toBe("reviews");
    expect(profile.issues).toEqual([]);
    expect(profile.fields).toEqual([
      { name: "type", kind: "text", type: "text", options: undefined, required: true, value: "review" },
      { name: "status", kind: "select", type: "option", options: ["awaiting-review", "approved", "resolved"], required: true, value: undefined },
      { name: "created", kind: "date", type: "date", options: undefined, required: true, value: undefined },
      { name: "project", kind: "text", type: "text", options: undefined, required: false, value: undefined },
    ]);
  });

  it("degrades unknown kinds to text with a warning issue", () => {
    const profile = parseTypeProfile({
      schema_type: "notidian_type_profile",
      fields: { rating: { kind: "stars" } },
    });
    expect(profile.fields[0].type).toBe("text");
    expect(profile.issues).toEqual([
      { reason: "unknown-kind", field: "rating", kind: "stars" },
    ]);
  });

  it("maps password to the masked password column type", () => {
    const profile = parseTypeProfile({
      schema_type: "notidian_type_profile",
      fields: { secret: { kind: "password" } },
    });
    expect(profile.fields[0]).toMatchObject({ kind: "password", type: "password" });
    expect(profile.issues).toEqual([]);
  });

  it("tolerates a JSON-stringified fields map (metadata cache)", () => {
    const profile = parseTypeProfile({
      schema_type: "notidian_type_profile",
      fields: JSON.stringify({ status: { kind: "select", options: ["a"] } }),
    });
    expect(profile.fields[0]).toMatchObject({ name: "status", type: "option", options: ["a"] });
  });

  it("flags a missing or malformed fields map", () => {
    expect(
      parseTypeProfile({ schema_type: "notidian_type_profile" }).issues
    ).toEqual([{ reason: "missing-fields" }]);
    const profile = parseTypeProfile({
      schema_type: "notidian_type_profile",
      fields: { broken: "not-a-map", ok: { kind: "text" } },
    });
    expect(profile.issues).toEqual([{ reason: "invalid-field", field: "broken" }]);
    expect(profile.fields.map((f) => f.name)).toEqual(["ok"]);
  });
});

describe("planTypeProfileApply", () => {
  it("adds missing fields as frontmatter-backed columns", () => {
    const profile = parseTypeProfile(reviewsFrontmatter);
    const plan = planTypeProfileApply(profile, tableWithCols([
      { name: "File", type: "file" },
      { name: "status", type: "option", value: "" },
    ]));
    expect(plan.changed).toBe(true);
    const added = plan.cols.filter((c) => !["File", "status"].includes(c.name));
    expect(added.map((c) => c.name)).toEqual(["type", "created", "project"]);
    expect(added.every((c) => c.source == "frontmatter")).toBe(true);
    expect(added.find((c) => c.name == "created").type).toBe("date");
  });

  it("seeds hub options into existing select columns, hub order first, keeping local extras", () => {
    const profile = parseTypeProfile(reviewsFrontmatter);
    const plan = planTypeProfileApply(profile, tableWithCols([
      { name: "File", type: "file" },
      { name: "type", type: "text", source: "frontmatter" },
      { name: "created", type: "date", source: "frontmatter" },
      { name: "project", type: "text", source: "frontmatter" },
      {
        name: "status",
        type: "option",
        source: "frontmatter",
        value: JSON.stringify({
          options: [
            { name: "local-extra", value: "local-extra", color: "red" },
            { name: "approved", value: "approved", color: "green" },
          ],
        }),
      },
    ]));
    expect(plan.changed).toBe(true);
    const statusCol = plan.cols.find((c) => c.name == "status");
    const options = JSON.parse(statusCol.value).options;
    expect(options.map((o: { value: string }) => o.value)).toEqual([
      "awaiting-review",
      "approved",
      "resolved",
      "local-extra",
    ]);
    expect(options.find((o: { value: string }) => o.value == "approved").color).toBe("green");
  });

  it("upgrades a frontmatter-backed column's inferred type to the profile kind", () => {
    const profile = parseTypeProfile(reviewsFrontmatter);
    const plan = planTypeProfileApply(profile, tableWithCols([
      { name: "File", type: "file" },
      { name: "status", type: "text", source: "frontmatter", value: "" },
      { name: "created", type: "text", source: "frontmatter", value: "" },
    ]));
    expect(plan.changed).toBe(true);
    const statusCol = plan.cols.find((c) => c.name == "status");
    expect(statusCol.type).toBe("option");
    expect(JSON.parse(statusCol.value).options.map((o: { value: string }) => o.value)).toEqual([
      "awaiting-review", "approved", "resolved",
    ]);
    expect(plan.cols.find((c) => c.name == "created").type).toBe("date");
  });

  it("keeps a multi-variant column type and does not retype non-frontmatter columns", () => {
    const profile = parseTypeProfile(reviewsFrontmatter);
    const plan = planTypeProfileApply(profile, tableWithCols([
      { name: "File", type: "file" },
      { name: "type", type: "text", source: "frontmatter" },
      { name: "created", type: "date", source: "frontmatter" },
      { name: "project", type: "text", source: "frontmatter" },
      { name: "status", type: "option-multi", source: "frontmatter", value: JSON.stringify({ options: [
        { name: "awaiting-review", value: "awaiting-review" },
        { name: "approved", value: "approved" },
        { name: "resolved", value: "resolved" },
      ] }) },
    ]));
    expect(plan.cols.find((c) => c.name == "status").type).toBe("option-multi");
    const notidianOwned = planTypeProfileApply(profile, tableWithCols([
      { name: "File", type: "file" },
      { name: "type", type: "text", source: "frontmatter" },
      { name: "created", type: "date", source: "frontmatter" },
      { name: "project", type: "text", source: "frontmatter" },
      { name: "status", type: "text", source: "notidian", value: "" },
    ]));
    expect(notidianOwned.cols.find((c) => c.name == "status").type).toBe("text");
  });

  it("is a strict no-op on a conforming table", () => {
    const profile = parseTypeProfile(reviewsFrontmatter);
    const first = planTypeProfileApply(profile, tableWithCols([
      { name: "File", type: "file" },
    ]));
    const second = planTypeProfileApply(
      profile,
      tableWithCols(first.cols)
    );
    expect(second.changed).toBe(false);
    expect(second.cols).toEqual(first.cols);
  });

  it("no-ops without a profile", () => {
    expect(planTypeProfileApply(null, tableWithCols([])).changed).toBe(false);
  });
});

describe("planFieldsMirror", () => {
  const fields = reviewsFrontmatter.fields;

  it("adds a new column as a field with the mapped kind", () => {
    const plan = planFieldsMirror(fields, {
      kind: "add-column",
      name: "priority",
      type: "option",
    });
    expect(plan.changed).toBe(true);
    expect(plan.fields["priority"]).toEqual({ kind: "select" });
    expect(Object.keys(plan.fields)).toEqual([
      "type", "status", "created", "project", "priority",
    ]);
  });

  it("suppresses echo when the field already exists", () => {
    expect(
      planFieldsMirror(fields, { kind: "add-column", name: "Status", type: "option" }).changed
    ).toBe(false);
  });

  it("renames a key preserving order and attributes", () => {
    const plan = planFieldsMirror(fields, {
      kind: "rename-key",
      oldName: "project",
      newName: "stream",
    });
    expect(plan.changed).toBe(true);
    expect(Object.keys(plan.fields)).toEqual(["type", "status", "created", "stream"]);
    expect(plan.fields["stream"]).toEqual({ kind: "text" });
  });

  it("refuses a rename that would clobber an existing field", () => {
    expect(
      planFieldsMirror(fields, { kind: "rename-key", oldName: "project", newName: "status" }).changed
    ).toBe(false);
  });

  it("appends a new select option and suppresses duplicates", () => {
    const plan = planFieldsMirror(fields, {
      kind: "add-option",
      name: "status",
      option: "deferred",
    });
    expect(plan.changed).toBe(true);
    expect((plan.fields["status"] as { options: string[] }).options).toEqual([
      "awaiting-review", "approved", "resolved", "deferred",
    ]);
    expect(
      planFieldsMirror(fields, { kind: "add-option", name: "status", option: "approved" }).changed
    ).toBe(false);
  });
});

describe("typeProfileKindForType", () => {
  it("maps MDB types back to profile kinds", () => {
    expect(typeProfileKindForType("option")).toBe("select");
    expect(typeProfileKindForType("option-multi")).toBe("select");
    expect(typeProfileKindForType("boolean")).toBe("checkbox");
    expect(typeProfileKindForType("date")).toBe("date");
    expect(typeProfileKindForType("number")).toBe("number");
    expect(typeProfileKindForType("link")).toBe("link");
    expect(typeProfileKindForType("text")).toBe("text");
    expect(typeProfileKindForType("password")).toBe("password");
    expect(typeProfileKindForType("fileprop")).toBe("text");
  });
});
