import {
  parseTypeProfile,
  planFieldsMirror,
  planTypeProfileApply,
  planTypeProfileMirror,
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
    expect(typeProfileKindForType("option-multi")).toBe("multi_select");
    expect(typeProfileKindForType("boolean")).toBe("checkbox");
    expect(typeProfileKindForType("date")).toBe("date");
    expect(typeProfileKindForType("number")).toBe("number");
    expect(typeProfileKindForType("link")).toBe("link");
    expect(typeProfileKindForType("text")).toBe("text");
    expect(typeProfileKindForType("password")).toBe("password");
    expect(typeProfileKindForType("fileprop")).toBe("text");
    expect(typeProfileKindForType("option-multi")).toBe("multi_select");
  });
});

describe("parseTypeProfile v2 — kind_fields (Notidian-egz)", () => {
  const infra = {
    schema_type: "notidian_type_profile",
    database: "Infrastructure",
    fields: {
      kind: {
        kind: "select",
        options: ["network-device", "credential-reference"],
        required: true,
      },
      status: { kind: "select", options: ["active", "retired"] },
    },
    kind_fields: {
      "network-device": {
        hostname: { kind: "text", required: true },
        aliases: { kind: "multi_select" },
        network: { kind: "relation", target_database: "Infrastructure" },
        config_path: { kind: "path" },
      },
      "credential-reference": {
        provider: { kind: "text" },
        secret: { kind: "password" },
        last_rotated: { kind: "date" },
      },
    },
  };

  it("materializes the union of common fields and every kind's fields", () => {
    const profile = parseTypeProfile(infra);
    expect(profile.fields.map((f) => f.name)).toEqual([
      "kind",
      "status",
      "hostname",
      "aliases",
      "network",
      "config_path",
      "provider",
      "secret",
      "last_rotated",
    ]);
  });

  it("maps new kinds: password, multi_select->option-multi, relation->link, path->text", () => {
    const profile = parseTypeProfile(infra);
    const typeOf = (name: string) =>
      profile.fields.find((f) => f.name == name)?.type;
    expect(typeOf("secret")).toBe("password");
    expect(typeOf("aliases")).toBe("option-multi");
    expect(typeOf("network")).toBe("link");
    expect(typeOf("config_path")).toBe("text");
    expect(profile.issues).toEqual([]);
  });

  it("exposes per-kind field groups in kindFields", () => {
    const profile = parseTypeProfile(infra);
    expect(Object.keys(profile.kindFields)).toEqual([
      "network-device",
      "credential-reference",
    ]);
    expect(
      profile.kindFields["credential-reference"].map((f) => f.name)
    ).toEqual(["provider", "secret", "last_rotated"]);
  });

  it("dedupes a name shared by common fields and a kind (common wins)", () => {
    const profile = parseTypeProfile({
      schema_type: "notidian_type_profile",
      fields: { shared: { kind: "select", options: ["a"] } },
      kind_fields: {
        k1: { shared: { kind: "text" }, only: { kind: "number" } },
      },
    });
    const shared = profile.fields.filter((f) => f.name == "shared");
    expect(shared).toHaveLength(1);
    expect(shared[0].type).toBe("option");
    expect(profile.fields.map((f) => f.name)).toEqual(["shared", "only"]);
  });

  it("parses kind_fields even with no common fields map", () => {
    const profile = parseTypeProfile({
      schema_type: "notidian_type_profile",
      kind_fields: { k1: { a: { kind: "text" } } },
    });
    expect(profile.fields.map((f) => f.name)).toEqual(["a"]);
    expect(profile.issues).toEqual([]);
  });

  it("records an issue for a malformed kind_fields entry without crashing", () => {
    const profile = parseTypeProfile({
      schema_type: "notidian_type_profile",
      fields: { a: { kind: "text" } },
      kind_fields: { bad: "not-a-map" },
    });
    expect(profile.fields.map((f) => f.name)).toEqual(["a"]);
    expect(profile.issues).toContainEqual({
      reason: "invalid-field",
      field: "kind_fields.bad",
    });
  });

  it("still reports missing-fields when nothing yields columns", () => {
    const profile = parseTypeProfile({
      schema_type: "notidian_type_profile",
    });
    expect(profile.fields).toEqual([]);
    expect(profile.issues).toContainEqual({ reason: "missing-fields" });
  });
});

describe("planTypeProfileMirror — kind-aware (Notidian-egz)", () => {
  const fm = {
    fields: { status: { kind: "select", options: ["active"] } },
    kind_fields: {
      "credential-reference": {
        secret: { kind: "password" },
        scope: { kind: "select", options: ["read"] },
      },
    },
  };

  it("renames a kind-owned field inside kind_fields, not fields", () => {
    const plan = planTypeProfileMirror(fm, {
      kind: "rename-key",
      oldName: "secret",
      newName: "api_secret",
    });
    expect(plan.changed).toBe(true);
    expect(plan.fields).toBeUndefined();
    expect(plan.kindFields?.["credential-reference"]).toEqual({
      api_secret: { kind: "password" },
      scope: { kind: "select", options: ["read"] },
    });
  });

  it("renames a common field inside fields, not kind_fields", () => {
    const plan = planTypeProfileMirror(fm, {
      kind: "rename-key",
      oldName: "status",
      newName: "state",
    });
    expect(plan.changed).toBe(true);
    expect(plan.kindFields).toBeUndefined();
    expect(plan.fields).toEqual({
      state: { kind: "select", options: ["active"] },
    });
  });

  it("adds an option to a kind-owned select", () => {
    const plan = planTypeProfileMirror(fm, {
      kind: "add-option",
      name: "scope",
      option: "write",
    });
    expect(plan.changed).toBe(true);
    expect(plan.kindFields?.["credential-reference"]).toMatchObject({
      scope: { kind: "select", options: ["read", "write"] },
    });
  });

  it("adds a brand-new column to common fields, never a kind", () => {
    const plan = planTypeProfileMirror(fm, {
      kind: "add-column",
      name: "owner",
      type: "text",
    });
    expect(plan.fields).toMatchObject({ owner: { kind: "text" } });
    expect(plan.kindFields).toBeUndefined();
  });

  it("no-ops add-column when the name already exists in a kind (no duplicate)", () => {
    const plan = planTypeProfileMirror(fm, {
      kind: "add-column",
      name: "secret",
      type: "text",
    });
    expect(plan.changed).toBe(false);
  });

  it("no-ops a rename whose target name already exists anywhere", () => {
    const plan = planTypeProfileMirror(fm, {
      kind: "rename-key",
      oldName: "status",
      newName: "scope",
    });
    expect(plan.changed).toBe(false);
  });

  it("renames a name shared by fields and a kind in BOTH maps (no resurfacing dup)", () => {
    const shared = {
      fields: { scope: { kind: "text" } },
      kind_fields: { "credential-reference": { scope: { kind: "text" } } },
    };
    const plan = planTypeProfileMirror(shared, {
      kind: "rename-key",
      oldName: "scope",
      newName: "access_scope",
    });
    expect(plan.changed).toBe(true);
    expect(plan.fields).toEqual({ access_scope: { kind: "text" } });
    expect(plan.kindFields?.["credential-reference"]).toEqual({
      access_scope: { kind: "text" },
    });
    // The old name must not survive in either map (else it re-materializes).
    expect(plan.fields).not.toHaveProperty("scope");
    expect(plan.kindFields?.["credential-reference"]).not.toHaveProperty(
      "scope"
    );
  });

  it("always returns the current normalized maps for serializer threading", () => {
    const plan = planTypeProfileMirror(fm, {
      kind: "add-option",
      name: "nonexistent",
      option: "x",
    });
    expect(plan.changed).toBe(false);
    expect(plan.currentFields).toEqual(fm.fields);
    expect(plan.currentKindFields).toEqual(fm.kind_fields);
  });
});
