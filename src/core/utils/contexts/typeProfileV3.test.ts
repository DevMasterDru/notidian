// Type Profile v3 (ADR-0056, Notidian-loan.1 / S1): schema model, parser, and
// mirror pass-through for the six new per-field declarations (enum, unique,
// pattern, title_binding, empty, reference, derived) plus the per-database
// `invariants:` block, reusing the existing Filter/predicate DSL.
//
// Scope note: this is the pure foundation layer — parse, plan, mirror. No
// enforcement (ADR-0057/Wave 2) and no new table-UI/column wiring ships here;
// planTypeProfileApply/planFieldsMirror/planTypeProfileMirror are proven to
// pass v3 attributes through UNCHANGED (characterization, not new behavior).

import {
  Invariant,
  NotidianTypeProfile,
  parseInvariants,
  parseTypeProfile,
  planFieldsMirror,
  planTypeProfileApply,
  planTypeProfileMirror,
  serializeTypeProfileField,
  TypeProfileField,
  TypeProfileIssue,
} from "core/utils/contexts/typeProfile";
import {
  planEnumValueRenameCascade,
} from "core/utils/contexts/notidianSchema";
import { defaultContextSchemaID } from "shared/schemas/context";
import { SpaceTable, SpaceTableSchema } from "shared/types/mdb";

const tableWithCols = (cols: SpaceTable["cols"]): SpaceTable => ({
  schema: { id: defaultContextSchemaID } as SpaceTableSchema,
  cols,
  rows: [],
});

const fieldOf = (
  profile: NotidianTypeProfile | null,
  name: string
): TypeProfileField => {
  const field = profile?.fields.find((f) => f.name == name);
  if (!field) throw new Error(`field ${name} not found`);
  return field;
};

// ---------------------------------------------------------------------------
// Round-trip: parse -> serializeTypeProfileField -> byte-stable original def.
// ---------------------------------------------------------------------------

describe("v3 field attributes — byte-stable round-trip", () => {
  it("enum {values, strict}", () => {
    const def = { kind: "select", enum: { values: ["a", "b", "c"], strict: true } };
    const profile = parseTypeProfile({
      schema_type: "notidian_type_profile",
      fields: { status: def },
    });
    expect(profile.issues).toEqual([]);
    const field = fieldOf(profile, "status");
    expect(field.enum).toEqual({ values: ["a", "b", "c"], strict: true });
    expect(serializeTypeProfileField(field)).toEqual(def);
  });

  it("unique {scope} with no where", () => {
    const def = { kind: "text", unique: { scope: "database" } };
    const profile = parseTypeProfile({
      schema_type: "notidian_type_profile",
      fields: { serial: def },
    });
    expect(profile.issues).toEqual([]);
    const field = fieldOf(profile, "serial");
    expect(field.unique).toEqual({ scope: "database" });
    expect(serializeTypeProfileField(field)).toEqual(def);
  });

  it("unique {scope, where: Filter[]}", () => {
    const def = {
      kind: "text",
      unique: {
        scope: "database",
        where: [
          { field: "status", fn: "isNotEmpty", value: "", fType: "literal" },
        ],
      },
    };
    const profile = parseTypeProfile({
      schema_type: "notidian_type_profile",
      fields: { serial: def },
    });
    expect(profile.issues).toEqual([]);
    const field = fieldOf(profile, "serial");
    expect(field.unique?.where).toEqual(def.unique.where);
    expect(serializeTypeProfileField(field)).toEqual(def);
  });

  it("pattern (regex string)", () => {
    const def = { kind: "text", pattern: "^GPIO-\\d+$" };
    const profile = parseTypeProfile({
      schema_type: "notidian_type_profile",
      fields: { pin: def },
    });
    expect(profile.issues).toEqual([]);
    const field = fieldOf(profile, "pin");
    expect(field.pattern).toBe("^GPIO-\\d+$");
    expect(serializeTypeProfileField(field)).toEqual(def);
  });

  it("title_binding: true", () => {
    const def = { kind: "text", title_binding: true };
    const profile = parseTypeProfile({
      schema_type: "notidian_type_profile",
      fields: { name: def },
    });
    expect(profile.issues).toEqual([]);
    const field = fieldOf(profile, "name");
    expect(field.title_binding).toBe(true);
    expect(serializeTypeProfileField(field)).toEqual(def);
  });

  it("title_binding: false — explicit false must round-trip, not vanish into 'absent'", () => {
    const def = { kind: "text", title_binding: false };
    const profile = parseTypeProfile({
      schema_type: "notidian_type_profile",
      fields: { name: def },
    });
    expect(profile.issues).toEqual([]);
    const field = fieldOf(profile, "name");
    expect(field.title_binding).toBe(false);
    expect(serializeTypeProfileField(field)).toEqual(def);
  });

  it("empty policy: absent", () => {
    const def = { kind: "text", empty: "absent" };
    const profile = parseTypeProfile({
      schema_type: "notidian_type_profile",
      fields: { note: def },
    });
    expect(profile.issues).toEqual([]);
    expect(serializeTypeProfileField(fieldOf(profile, "note"))).toEqual(def);
  });

  it("empty policy: empty-string", () => {
    const def = { kind: "text", empty: "empty-string" };
    const profile = parseTypeProfile({
      schema_type: "notidian_type_profile",
      fields: { note: def },
    });
    expect(profile.issues).toEqual([]);
    expect(serializeTypeProfileField(fieldOf(profile, "note"))).toEqual(def);
  });

  it("reference {targetFolder, targetKey, onBrokenWrite, onReferencedChange}", () => {
    const def = {
      kind: "text",
      reference: {
        targetFolder: "Gidi/Hardware/Board Registry",
        targetKey: "board_id",
        onBrokenWrite: "block",
        onReferencedChange: "cascade-preview",
      },
    };
    const profile = parseTypeProfile({
      schema_type: "notidian_type_profile",
      fields: { board_id: def },
    });
    expect(profile.issues).toEqual([]);
    const field = fieldOf(profile, "board_id");
    expect(field.reference).toEqual(def.reference);
    expect(serializeTypeProfileField(field)).toEqual(def);
  });

  it("derived {kind: template, spec, materialize}", () => {
    const def = {
      kind: "text",
      derived: {
        kind: "template",
        spec: { template: "{slave} {board_name}" },
        materialize: "frontmatter",
      },
    };
    const profile = parseTypeProfile({
      schema_type: "notidian_type_profile",
      fields: { display: def },
    });
    expect(profile.issues).toEqual([]);
    expect(serializeTypeProfileField(fieldOf(profile, "display"))).toEqual(def);
  });

  it("derived {kind: lookup} and {kind: rollup} — generic spec, materialize: none", () => {
    const lookupDef = {
      kind: "text",
      derived: { kind: "lookup", spec: { via: "board_id" }, materialize: "none" },
    };
    const rollupDef = {
      kind: "number",
      derived: { kind: "rollup", spec: { aggregate: "count" }, materialize: "none" },
    };
    const profile = parseTypeProfile({
      schema_type: "notidian_type_profile",
      fields: { board_name: lookupDef, used_channels: rollupDef },
    });
    expect(profile.issues).toEqual([]);
    expect(serializeTypeProfileField(fieldOf(profile, "board_name"))).toEqual(
      lookupDef
    );
    expect(serializeTypeProfileField(fieldOf(profile, "used_channels"))).toEqual(
      rollupDef
    );
  });

  it("preserves an unrecognized attribute verbatim (forward compat, no issue)", () => {
    const def = { kind: "text", future_attr: { anything: "goes", n: 3 } };
    const profile = parseTypeProfile({
      schema_type: "notidian_type_profile",
      fields: { widget: def },
    });
    expect(profile.issues).toEqual([]);
    const field = fieldOf(profile, "widget");
    expect(field.extra).toEqual({ future_attr: def.future_attr });
    expect(serializeTypeProfileField(field)).toEqual(def);
  });

  it("round-trips every v3 attribute declared together on one field", () => {
    const def = {
      kind: "select",
      required: true,
      value: "todo",
      options: ["todo", "done"],
      enum: { values: ["todo", "done"], strict: true },
      unique: { scope: "database" },
      pattern: "^[a-z]+$",
      title_binding: true,
      empty: "absent",
      reference: {
        targetFolder: "Some/Folder",
        targetKey: "key",
        onBrokenWrite: "warn",
        onReferencedChange: "warn",
      },
      derived: { kind: "rollup", spec: {}, materialize: "none" },
      an_extra_attr: "kept",
    };
    const profile = parseTypeProfile({
      schema_type: "notidian_type_profile",
      fields: { status: def },
    });
    expect(profile.issues).toEqual([]);
    expect(serializeTypeProfileField(fieldOf(profile, "status"))).toEqual(def);
  });

  it("kind_fields-owned v3 attributes round-trip too (v2 per-kind sub-schema)", () => {
    const def = { kind: "text", pattern: "^SN-\\d+$" };
    const profile = parseTypeProfile({
      schema_type: "notidian_type_profile",
      kind_fields: { sensor: { serial: def } },
    });
    expect(profile.issues).toEqual([]);
    const field = fieldOf(profile, "serial");
    expect(field.pattern).toBe("^SN-\\d+$");
    expect(serializeTypeProfileField(field)).toEqual(def);
  });
});

// ---------------------------------------------------------------------------
// Adversarial malformed shapes — diagnostics, never throws.
// ---------------------------------------------------------------------------

describe("v3 field attributes — malformed shapes degrade with a diagnostic, never throw", () => {
  const parseOneField = (
    def: unknown
  ): { field: TypeProfileField; issues: TypeProfileIssue[] } => {
    const profile = parseTypeProfile({
      schema_type: "notidian_type_profile",
      fields: { x: def },
    });
    return { field: fieldOf(profile, "x"), issues: profile.issues };
  };

  it("enum: not an object", () => {
    expect(() => parseOneField({ kind: "select", enum: "strict" })).not.toThrow();
    const { field, issues } = parseOneField({ kind: "select", enum: "strict" });
    expect(field.enum).toBeUndefined();
    expect(issues).toContainEqual({ reason: "invalid-enum", field: "x" });
  });

  it("enum: missing values array", () => {
    const { field, issues } = parseOneField({
      kind: "select",
      enum: { strict: true },
    });
    expect(field.enum).toBeUndefined();
    expect(issues).toContainEqual({ reason: "invalid-enum", field: "x" });
  });

  it("enum: values contains a non-string", () => {
    const { field, issues } = parseOneField({
      kind: "select",
      enum: { values: ["a", 2], strict: true },
    });
    expect(field.enum).toBeUndefined();
    expect(issues).toContainEqual({ reason: "invalid-enum", field: "x" });
  });

  it("enum: strict not boolean", () => {
    const { field, issues } = parseOneField({
      kind: "select",
      enum: { values: ["a"], strict: "yes" },
    });
    expect(field.enum).toBeUndefined();
    expect(issues).toContainEqual({ reason: "invalid-enum", field: "x" });
  });

  it("unique: wrong scope value", () => {
    const { field, issues } = parseOneField({
      kind: "text",
      unique: { scope: "table" },
    });
    expect(field.unique).toBeUndefined();
    expect(issues).toContainEqual({ reason: "invalid-unique", field: "x" });
  });

  it("unique.where: not an array", () => {
    const { field, issues } = parseOneField({
      kind: "text",
      unique: { scope: "database", where: "not-an-array" },
    });
    expect(field.unique).toBeUndefined();
    expect(issues).toContainEqual({ reason: "invalid-unique", field: "x" });
    expect(issues).toContainEqual({
      reason: "invalid-filter",
      path: "x.unique.where",
    });
  });

  it("unique.where: entry references an unknown filter fn — rejects the WHOLE unique, not a silently-weakened one", () => {
    const { field, issues } = parseOneField({
      kind: "text",
      unique: {
        scope: "database",
        where: [{ field: "status", fn: "notARealFn", value: "", fType: "literal" }],
      },
    });
    expect(field.unique).toBeUndefined();
    expect(issues).toContainEqual({
      reason: "unknown-filter-fn",
      path: "x.unique.where[0]",
      fn: "notARealFn",
    });
    expect(issues).toContainEqual({ reason: "invalid-unique", field: "x" });
  });

  it("pattern: invalid regex syntax does not throw", () => {
    expect(() => parseOneField({ kind: "text", pattern: "(unterminated" })).not.toThrow();
    const { field, issues } = parseOneField({ kind: "text", pattern: "(unterminated" });
    expect(field.pattern).toBeUndefined();
    expect(issues).toContainEqual({ reason: "invalid-pattern", field: "x" });
  });

  it("pattern: not a string", () => {
    const { field, issues } = parseOneField({ kind: "text", pattern: 42 });
    expect(field.pattern).toBeUndefined();
    expect(issues).toContainEqual({ reason: "invalid-pattern", field: "x" });
  });

  it("title_binding: not a boolean", () => {
    const { field, issues } = parseOneField({ kind: "text", title_binding: "yes" });
    expect(field.title_binding).toBeUndefined();
    expect(issues).toContainEqual({ reason: "invalid-title-binding", field: "x" });
  });

  it("empty: not a recognized policy", () => {
    const { field, issues } = parseOneField({ kind: "text", empty: "null" });
    expect(field.empty).toBeUndefined();
    expect(issues).toContainEqual({ reason: "invalid-empty-policy", field: "x" });
  });

  it("reference: missing targetKey", () => {
    const { field, issues } = parseOneField({
      kind: "text",
      reference: {
        targetFolder: "Folder",
        onBrokenWrite: "warn",
        onReferencedChange: "warn",
      },
    });
    expect(field.reference).toBeUndefined();
    expect(issues).toContainEqual({ reason: "invalid-reference", field: "x" });
  });

  it("reference: invalid onBrokenWrite enum value", () => {
    const { field, issues } = parseOneField({
      kind: "text",
      reference: {
        targetFolder: "Folder",
        targetKey: "key",
        onBrokenWrite: "explode",
        onReferencedChange: "warn",
      },
    });
    expect(field.reference).toBeUndefined();
    expect(issues).toContainEqual({ reason: "invalid-reference", field: "x" });
  });

  it("derived: invalid kind", () => {
    const { field, issues } = parseOneField({
      kind: "text",
      derived: { kind: "magic", spec: {}, materialize: "none" },
    });
    expect(field.derived).toBeUndefined();
    expect(issues).toContainEqual({ reason: "invalid-derived", field: "x" });
  });

  it("derived: spec not an object", () => {
    const { field, issues } = parseOneField({
      kind: "text",
      derived: { kind: "template", spec: "not-an-object", materialize: "none" },
    });
    expect(field.derived).toBeUndefined();
    expect(issues).toContainEqual({ reason: "invalid-derived", field: "x" });
  });

  it("derived: invalid materialize value", () => {
    const { field, issues } = parseOneField({
      kind: "text",
      derived: { kind: "template", spec: {}, materialize: "database" },
    });
    expect(field.derived).toBeUndefined();
    expect(issues).toContainEqual({ reason: "invalid-derived", field: "x" });
  });

  it("a malformed v3 attribute on one field never blocks its siblings from parsing", () => {
    const profile = parseTypeProfile({
      schema_type: "notidian_type_profile",
      fields: {
        broken: { kind: "select", enum: "not-an-object" },
        ok: { kind: "text", pattern: "^ok$" },
      },
    });
    expect(profile.fields.map((f) => f.name)).toEqual(["broken", "ok"]);
    expect(fieldOf(profile, "ok").pattern).toBe("^ok$");
    expect(profile.issues).toContainEqual({ reason: "invalid-enum", field: "broken" });
  });
});

// ---------------------------------------------------------------------------
// Invariants (ADR-0056 D8) — reuse the existing Filter DSL, never a new one.
// ---------------------------------------------------------------------------

describe("invariants — parse the per-database block into Filter-DSL structures", () => {
  const validInvariant = {
    when: [{ field: "kind", fn: "is", value: "network-device", fType: "literal" }],
    require: [{ field: "hostname", fn: "isNotEmpty", value: "", fType: "literal" }],
    severity: "error",
    message: "network-device rows must declare a hostname",
    autofix: "seed-default",
  };

  it("parses a fully-specified invariant with no issues", () => {
    const profile = parseTypeProfile({
      schema_type: "notidian_type_profile",
      fields: { hostname: { kind: "text" } },
      invariants: [validInvariant],
    });
    expect(profile.issues).toEqual([]);
    expect(profile.invariants).toEqual([validInvariant]);
  });

  it("parses an invariant with no `when` guard (applies to every row)", () => {
    const { when, ...rest } = validInvariant;
    const profile = parseTypeProfile({
      schema_type: "notidian_type_profile",
      fields: { hostname: { kind: "text" } },
      invariants: [rest],
    });
    expect(profile.issues).toEqual([]);
    expect(profile.invariants).toEqual([rest]);
  });

  it("tolerates a JSON-stringified invariants block (metadata cache quirk)", () => {
    const profile = parseTypeProfile({
      schema_type: "notidian_type_profile",
      fields: { hostname: { kind: "text" } },
      invariants: JSON.stringify([validInvariant]),
    });
    expect(profile.issues).toEqual([]);
    expect(profile.invariants).toEqual([validInvariant]);
  });

  it("flags a non-array invariants block without throwing or crashing the rest of the profile", () => {
    const profile = parseTypeProfile({
      schema_type: "notidian_type_profile",
      fields: { hostname: { kind: "text" } },
      invariants: { not: "a-list" },
    });
    expect(profile.invariants).toEqual([]);
    expect(profile.issues).toContainEqual({ reason: "invalid-invariants-block" });
    expect(profile.fields.map((f) => f.name)).toEqual(["hostname"]);
  });

  it("rejects an invariant missing `require` — excluded, with a diagnostic", () => {
    const { require, ...rest } = validInvariant;
    const profile = parseTypeProfile({
      schema_type: "notidian_type_profile",
      fields: { hostname: { kind: "text" } },
      invariants: [rest],
    });
    expect(profile.invariants).toEqual([]);
    expect(profile.issues).toContainEqual({ reason: "invalid-invariant", index: 0 });
  });

  it("rejects an invariant whose `require` references an unknown filter fn — the WHOLE rule is dropped, not silently weakened", () => {
    const bad = {
      ...validInvariant,
      require: [
        { field: "hostname", fn: "isNotEmpty", value: "", fType: "literal" },
        { field: "hostname", fn: "notARealFn", value: "", fType: "literal" },
      ],
    };
    const profile = parseTypeProfile({
      schema_type: "notidian_type_profile",
      fields: { hostname: { kind: "text" } },
      invariants: [bad],
    });
    expect(profile.invariants).toEqual([]);
    expect(profile.issues).toContainEqual({
      reason: "unknown-filter-fn",
      path: "invariants[0].require[1]",
      fn: "notARealFn",
    });
    expect(profile.issues).toContainEqual({ reason: "invalid-invariant", index: 0 });
  });

  it("rejects an invariant whose `when` references an unknown filter fn", () => {
    const bad = {
      ...validInvariant,
      when: [{ field: "kind", fn: "notARealFn", value: "x", fType: "literal" }],
    };
    const profile = parseTypeProfile({
      schema_type: "notidian_type_profile",
      fields: { hostname: { kind: "text" } },
      invariants: [bad],
    });
    expect(profile.invariants).toEqual([]);
    expect(profile.issues).toContainEqual({
      reason: "unknown-filter-fn",
      path: "invariants[0].when[0]",
      fn: "notARealFn",
    });
  });

  it("rejects an invalid severity value", () => {
    const bad = { ...validInvariant, severity: "critical" };
    const issues: TypeProfileIssue[] = [];
    const invariants = parseInvariants([bad], issues);
    expect(invariants).toEqual([]);
    expect(issues).toContainEqual({ reason: "invalid-invariant", index: 0 });
  });

  it("rejects an empty message", () => {
    const bad = { ...validInvariant, message: "" };
    const issues: TypeProfileIssue[] = [];
    expect(parseInvariants([bad], issues)).toEqual([]);
    expect(issues).toContainEqual({ reason: "invalid-invariant", index: 0 });
  });

  it("rejects a non-string autofix", () => {
    const bad = { ...validInvariant, autofix: 7 };
    const issues: TypeProfileIssue[] = [];
    expect(parseInvariants([bad], issues)).toEqual([]);
    expect(issues).toContainEqual({ reason: "invalid-invariant", index: 0 });
  });

  it("keeps a valid invariant even when a sibling entry is malformed", () => {
    const bad = { ...validInvariant, severity: "critical" };
    const issues: TypeProfileIssue[] = [];
    const invariants = parseInvariants([bad, validInvariant], issues);
    expect(invariants).toEqual([validInvariant]);
    expect(issues).toContainEqual({ reason: "invalid-invariant", index: 0 });
  });

  it("never throws on a non-object invariant entry (e.g. a bare string in the list)", () => {
    const issues: TypeProfileIssue[] = [];
    expect(() => parseInvariants(["not-an-object"], issues)).not.toThrow();
    expect(parseInvariants(["not-an-object"], [])).toEqual([]);
  });

  it("returns an empty list for an absent invariants block (no issue — it's optional)", () => {
    const issues: TypeProfileIssue[] = [];
    expect(parseInvariants(undefined, issues)).toEqual([]);
    expect(parseInvariants(null, issues)).toEqual([]);
    expect(issues).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Derived-field cycle detection (ADR-0056 D7 / ADR-0055 D5) — same-profile,
// template-kind fields only.
// ---------------------------------------------------------------------------

describe("cyclic derived spec — diagnostics, never throws", () => {
  const templateField = (template: string) => ({
    kind: "text",
    derived: { kind: "template", spec: { template }, materialize: "frontmatter" },
  });

  it("flags a direct two-field cycle (A references B, B references A)", () => {
    const profile = parseTypeProfile({
      schema_type: "notidian_type_profile",
      fields: {
        a: templateField("{b}"),
        b: templateField("{a}"),
      },
    });
    expect(profile.issues).toContainEqual(
      expect.objectContaining({ reason: "cyclic-derived", field: "a" })
    );
    expect(profile.issues).toContainEqual(
      expect.objectContaining({ reason: "cyclic-derived", field: "b" })
    );
    // Still returns the fields — a diagnostic, not a crash or an omission.
    expect(profile.fields.map((f) => f.name)).toEqual(["a", "b"]);
  });

  it("flags a self-reference", () => {
    const profile = parseTypeProfile({
      schema_type: "notidian_type_profile",
      fields: { display: templateField("{display} extra text") },
    });
    expect(profile.issues).toContainEqual(
      expect.objectContaining({ reason: "cyclic-derived", field: "display" })
    );
  });

  it("flags a three-field transitive cycle (A -> B -> C -> A)", () => {
    const profile = parseTypeProfile({
      schema_type: "notidian_type_profile",
      fields: {
        a: templateField("{b}"),
        b: templateField("{c}"),
        c: templateField("{a}"),
      },
    });
    const cyclic = profile.issues.filter((i) => i.reason == "cyclic-derived");
    expect(cyclic.map((i: any) => i.field).sort()).toEqual(["a", "b", "c"]);
  });

  it("does not flag a non-cyclic template chain (A -> B -> C, no cycle)", () => {
    const profile = parseTypeProfile({
      schema_type: "notidian_type_profile",
      fields: {
        a: templateField("{b}"),
        b: templateField("{c}"),
        c: { kind: "text" },
      },
    });
    expect(profile.issues).toEqual([]);
  });

  it("does not treat a cross-DB lookup token ({fk->Folder.key:field}) as a local cycle edge", () => {
    const profile = parseTypeProfile({
      schema_type: "notidian_type_profile",
      fields: {
        board_id: { kind: "text" },
        board_display: templateField(
          "{board_id->Board Registry.board_id:display}"
        ),
      },
    });
    expect(profile.issues).toEqual([]);
  });

  it("ignores lookup/rollup derived kinds (no spec.template to graph)", () => {
    const profile = parseTypeProfile({
      schema_type: "notidian_type_profile",
      fields: {
        a: { kind: "text", derived: { kind: "lookup", spec: { ref: "b" }, materialize: "none" } },
        b: { kind: "text", derived: { kind: "rollup", spec: { ref: "a" }, materialize: "none" } },
      },
    });
    expect(profile.issues).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// planTypeProfileApply / mirror — v3 attributes pass through untouched.
// No new runtime behavior ships this session: these characterize that the
// apply/mirror planners neither choke on nor silently drop v3 attributes.
// ---------------------------------------------------------------------------

describe("planTypeProfileApply — v3 attributes do not change column-plan output", () => {
  it("produces the identical column plan whether or not a field declares v3 attributes", () => {
    const plain = parseTypeProfile({
      schema_type: "notidian_type_profile",
      fields: { status: { kind: "select", options: ["a", "b"] } },
    });
    const withV3 = parseTypeProfile({
      schema_type: "notidian_type_profile",
      fields: {
        status: {
          kind: "select",
          options: ["a", "b"],
          enum: { values: ["a", "b"], strict: true },
          unique: { scope: "database" },
          pattern: "^[ab]$",
        },
      },
    });
    const table = tableWithCols([{ name: "File", type: "file" }]);
    const planPlain = planTypeProfileApply(plain, table);
    const planV3 = planTypeProfileApply(withV3, tableWithCols([{ name: "File", type: "file" }]));
    expect(planV3.cols).toEqual(planPlain.cols);
  });
});

describe("mirror — v3 attributes on an existing field survive rename/add-option (spread-based preservation)", () => {
  const fieldsWithV3 = {
    status: {
      kind: "select",
      options: ["a", "b"],
      enum: { values: ["a", "b"], strict: true },
      pattern: "^[ab]$",
      title_binding: false,
    },
  };

  it("planFieldsMirror rename-key preserves every v3 attribute on the renamed def", () => {
    const plan = planFieldsMirror(fieldsWithV3, {
      kind: "rename-key",
      oldName: "status",
      newName: "state",
    });
    expect(plan.changed).toBe(true);
    expect(plan.fields["state"]).toEqual(fieldsWithV3.status);
  });

  it("planFieldsMirror add-option preserves every v3 attribute on the def", () => {
    const plan = planFieldsMirror(fieldsWithV3, {
      kind: "add-option",
      name: "status",
      option: "c",
    });
    expect(plan.changed).toBe(true);
    expect(plan.fields["status"]).toEqual({
      ...fieldsWithV3.status,
      options: ["a", "b", "c"],
    });
  });

  it("planTypeProfileMirror rename-key preserves v3 attributes for a kind-owned field", () => {
    const fm = { kind_fields: { sensor: fieldsWithV3 } };
    const plan = planTypeProfileMirror(fm, {
      kind: "rename-key",
      oldName: "status",
      newName: "state",
    });
    expect(plan.changed).toBe(true);
    const sensorFields = plan.kindFields?.["sensor"] as
      | Record<string, unknown>
      | undefined;
    expect(sensorFields?.["state"]).toEqual(fieldsWithV3.status);
  });
});

// ---------------------------------------------------------------------------
// ADR-0015 planner extension: enum-value-rename row-cascade preview.
// ---------------------------------------------------------------------------

describe("planEnumValueRenameCascade — row-cascade preview (ADR-0056 D10)", () => {
  const scalarTable = (): SpaceTable =>
    tableWithCols([
      { name: "File", type: "file" },
      { name: "status", type: "option", value: "" },
    ]);

  const listTable = (): SpaceTable =>
    tableWithCols([
      { name: "File", type: "file" },
      { name: "tags", type: "option-multi", value: "" },
    ]);

  it("classifies old-only, new-only, and neither for a scalar select field", () => {
    const plan = planEnumValueRenameCascade({
      table: scalarTable(),
      field: "status",
      oldValue: "todo",
      newValue: "pending",
      paths: ["a.md", "b.md", "c.md"],
      frontmatterByPath: {
        "a.md": { status: "todo" },
        "b.md": { status: "pending" },
        "c.md": { status: "done" },
      },
    });
    expect(plan.issues).toEqual([]);
    expect(plan.isListValued).toBe(false);
    expect(plan.fileStates).toEqual([
      { path: "a.md", state: "old-only", currentValue: "todo" },
      { path: "b.md", state: "new-only", currentValue: "pending" },
      { path: "c.md", state: "neither", currentValue: "done" },
    ]);
    expect(plan.affectedPaths).toEqual(["a.md"]);
    expect(plan.canApplyAutomatically).toBe(true);
    expect(plan.requiresResolution).toBe(false);
  });

  it("flags both-conflict for a list-valued field already holding old AND new", () => {
    const plan = planEnumValueRenameCascade({
      table: listTable(),
      field: "tags",
      oldValue: "todo",
      newValue: "pending",
      paths: ["a.md", "b.md"],
      frontmatterByPath: {
        "a.md": { tags: ["todo", "urgent"] },
        "b.md": { tags: ["todo", "pending"] },
      },
    });
    expect(plan.isListValued).toBe(true);
    expect(plan.fileStates).toEqual([
      { path: "a.md", state: "old-only", currentValue: ["todo", "urgent"] },
      { path: "b.md", state: "both-conflict", currentValue: ["todo", "pending"] },
    ]);
    expect(plan.affectedPaths).toEqual(["a.md", "b.md"]);
    expect(plan.requiresResolution).toBe(true);
    expect(plan.canApplyAutomatically).toBe(false);
  });

  it("flags a same-value rename as an issue and never classifies rows", () => {
    const plan = planEnumValueRenameCascade({
      table: scalarTable(),
      field: "status",
      oldValue: "todo",
      newValue: "todo",
      paths: ["a.md"],
      frontmatterByPath: { "a.md": { status: "todo" } },
    });
    expect(plan.issues).toContainEqual({ reason: "same-value", value: "todo" });
    expect(plan.fileStates).toEqual([]);
  });

  it("flags a missing field (not on the table) without throwing", () => {
    const plan = planEnumValueRenameCascade({
      table: scalarTable(),
      field: "nonexistent",
      oldValue: "todo",
      newValue: "pending",
      paths: ["a.md"],
      frontmatterByPath: { "a.md": { status: "todo" } },
    });
    expect(plan.issues).toContainEqual({
      reason: "missing-field",
      field: "nonexistent",
    });
    expect(plan.fileStates).toEqual([]);
  });

  it("flags empty old/new values", () => {
    const plan = planEnumValueRenameCascade({
      table: scalarTable(),
      field: "status",
      oldValue: "",
      newValue: "",
      paths: [],
      frontmatterByPath: {},
    });
    expect(plan.issues).toContainEqual({ reason: "empty-value", which: "old" });
    expect(plan.issues).toContainEqual({ reason: "empty-value", which: "new" });
  });

  it("flags a blank/whitespace-only field instead of silently treating it as safe to apply", () => {
    const plan = planEnumValueRenameCascade({
      table: scalarTable(),
      field: "   ",
      oldValue: "todo",
      newValue: "pending",
      paths: ["a.md"],
      frontmatterByPath: { "a.md": { status: "todo" } },
    });
    expect(plan.issues).toContainEqual({ reason: "empty-field", field: "   " });
    expect(plan.fileStates).toEqual([]);
    expect(plan.canApplyAutomatically).toBe(false);
  });

  it("never throws on a row missing the field entirely", () => {
    expect(() =>
      planEnumValueRenameCascade({
        table: scalarTable(),
        field: "status",
        oldValue: "todo",
        newValue: "pending",
        paths: ["a.md"],
        frontmatterByPath: { "a.md": {} },
      })
    ).not.toThrow();
    const plan = planEnumValueRenameCascade({
      table: scalarTable(),
      field: "status",
      oldValue: "todo",
      newValue: "pending",
      paths: ["a.md"],
      frontmatterByPath: { "a.md": {} },
    });
    expect(plan.fileStates).toEqual([
      { path: "a.md", state: "neither", currentValue: undefined },
    ]);
  });
});
