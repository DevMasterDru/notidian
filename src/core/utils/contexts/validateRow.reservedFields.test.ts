// Reserved system fields (Notidian-loan.15, Atlas Method ADR-0069 D1). Proves
// context_class + locked are validated by the EXISTING validateRow/validateRowPatch
// machinery as RECOGNIZED field names with FIXED definitions — WITHOUT the hub
// declaring them — and that the enum is the closed six-member set (`mirror` is a
// derived specialization, never a 7th member). Pure + offline: no vault, no DOM.
//
// SCOPE FENCE COVERAGE (loan.15): these fields must never become user-editable
// columns, so the merge lives at the validation boundary and NOT in
// NotidianTypeProfile.fields — planTypeProfileApply's projection and
// serializeTypeProfileField's hub round-trip are proven untouched here too.

import {
  CONTEXT_CLASS_VALUES,
  NotidianTypeProfile,
  parseTypeProfile,
  planTypeProfileApply,
  RESERVED_SYSTEM_FIELDS,
  serializeTypeProfileField,
  TypeProfileField,
  typeProfileSchemaType,
} from "core/utils/contexts/typeProfile";
import {
  validateRow,
  validateRowPatch,
  Violation,
} from "core/utils/contexts/validateRow";

const codesOf = (violations: Violation[]): string[] =>
  violations.map((v) => v.code);

const emptyProfile = (): NotidianTypeProfile => ({
  fields: [],
  kindFields: {},
  invariants: [],
  issues: [],
});

// A real (non-null) profile with one unrelated declared field — the common
// case: a database that never mentions context_class/locked in its hub.
const profileWith = (fields: TypeProfileField[]): NotidianTypeProfile => ({
  fields,
  kindFields: {},
  invariants: [],
  issues: [],
});

describe("reserved system fields — context_class (strict enum, ADR-0069 D1)", () => {
  it("accepts every declared enum member", () => {
    for (const member of CONTEXT_CLASS_VALUES) {
      expect(validateRow(emptyProfile(), { context_class: member })).toEqual([]);
    }
  });

  it("'derived' is a legal member (mirror is expressed as a derived specialization)", () => {
    expect(validateRow(emptyProfile(), { context_class: "derived" })).toEqual([]);
  });

  it("'mirror' is NOT a member — it is a derived specialization, never a 7th enum value", () => {
    const v = validateRow(emptyProfile(), { context_class: "mirror" });
    expect(codesOf(v)).toEqual(["enum"]);
    expect(v[0].field).toBe("context_class");
  });

  it("an arbitrary non-member (e.g. 'foo') is an enum violation", () => {
    const v = validateRow(emptyProfile(), { context_class: "foo" });
    expect(codesOf(v)).toEqual(["enum"]);
    expect(v[0].code).toBe("enum");
    expect(v[0].field).toBe("context_class");
  });

  it("the closed set is exactly the ADR-0069 D1 six — no MIRROR, no extras", () => {
    expect([...CONTEXT_CLASS_VALUES]).toEqual([
      "truth",
      "elaboration",
      "history",
      "evidence",
      "policy",
      "derived",
    ]);
    expect([...CONTEXT_CLASS_VALUES]).not.toContain("mirror");
  });
});

describe("reserved system fields — locked (boolean, existing coercion path)", () => {
  it("accepts boolean true and false", () => {
    expect(validateRow(emptyProfile(), { locked: true })).toEqual([]);
    expect(validateRow(emptyProfile(), { locked: false })).toEqual([]);
  });

  it("accepts the string forms 'true'/'false' (same boolean coercion as any boolean field)", () => {
    expect(validateRow(emptyProfile(), { locked: "true" })).toEqual([]);
    expect(validateRow(emptyProfile(), { locked: "false" })).toEqual([]);
  });

  it("flags a non-boolean value via the existing boolean policy (a 'type' violation)", () => {
    const v = validateRow(emptyProfile(), { locked: "yes" });
    expect(codesOf(v)).toEqual(["type"]);
    expect(v[0].field).toBe("locked");
  });
});

describe("reserved system fields — absence + not-required", () => {
  it("BOTH fields absent = valid (neither is required)", () => {
    expect(validateRow(emptyProfile(), {})).toEqual([]);
    expect(
      validateRow(profileWith([{ name: "title", kind: "text", type: "text" }]), {
        title: "x",
      })
    ).toEqual([]);
  });

  it("a valid context_class + locked together is valid", () => {
    expect(
      validateRow(emptyProfile(), { context_class: "policy", locked: true })
    ).toEqual([]);
  });

  it("both invalid together surface both violations", () => {
    const v = validateRow(emptyProfile(), {
      context_class: "mirror",
      locked: 5,
    });
    expect(codesOf(v).sort()).toEqual(["enum", "type"]);
  });
});

describe("reserved system fields — validated wherever validateRow runs", () => {
  it("validateRowPatch sees them on the PROPOSED (patched) value, not just the observed row", () => {
    // A row currently valid; a patch that sets context_class to a non-member
    // must fail (the effective row is {...row, ...patch}).
    const v = validateRowPatch(
      emptyProfile(),
      { context_class: "truth" },
      { context_class: "bogus" }
    );
    expect(codesOf(v)).toEqual(["enum"]);
  });

  it("a null/undefined schema (not a type profile) injects nothing — stays []", () => {
    // Mirrors validateRow.test.ts's null-schema contract: reserved fields only
    // apply to a REAL parsed profile, never to a non-profiled folder's rows.
    expect(validateRow(null, { context_class: "mirror", locked: "nope" })).toEqual(
      []
    );
    expect(
      validateRow(undefined, { context_class: "mirror", locked: "nope" })
    ).toEqual([]);
  });

  it("the reserved definition is AUTHORITATIVE — it overrides a same-named field the hub declared", () => {
    // A hub that (wrongly) declares context_class as a free-text field must
    // STILL be enum-validated against the fixed reserved set.
    const hubTriedText = profileWith([
      { name: "context_class", kind: "text", type: "text" },
    ]);
    expect(validateRow(hubTriedText, { context_class: "mirror" })[0]?.code).toBe(
      "enum"
    );
    expect(validateRow(hubTriedText, { context_class: "truth" })).toEqual([]);
  });
});

describe("reserved system fields — loan.15 scope fence (never a user-editable column)", () => {
  it("parseTypeProfile does NOT inject the reserved fields into the materialized union", () => {
    const profile = parseTypeProfile({
      schema_type: typeProfileSchemaType,
      fields: { title: { kind: "text" } },
    });
    const names = (profile?.fields ?? []).map((f) => f.name);
    expect(names).toEqual(["title"]);
    expect(names).not.toContain("context_class");
    expect(names).not.toContain("locked");
  });

  it("planTypeProfileApply never projects a reserved field as a column", () => {
    const profile = parseTypeProfile({
      schema_type: typeProfileSchemaType,
      fields: { title: { kind: "text" } },
    });
    const plan = planTypeProfileApply(profile, {
      cols: [{ name: "title", type: "text", schemaId: "files" }],
      schema: { id: "files", name: "Files", type: "db" },
    } as any);
    const colNames = plan.cols.map((c) => c.name);
    expect(colNames).not.toContain("context_class");
    expect(colNames).not.toContain("locked");
  });

  it("serializeTypeProfileField round-trips a reserved field's fixed def (available, but off the hub path)", () => {
    // The reserved fragment IS a well-formed TypeProfileField, so if a future
    // consumer ever serializes it, it survives untouched — it is simply never
    // reached from a hub note's fields map (asserted by the projection test).
    const contextClass = RESERVED_SYSTEM_FIELDS.find(
      (f) => f.name === "context_class"
    )!;
    expect(serializeTypeProfileField(contextClass)).toEqual({
      kind: "select",
      enum: { values: [...CONTEXT_CLASS_VALUES], strict: true },
    });
  });
});
