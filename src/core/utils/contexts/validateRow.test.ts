// Pure validation core (ADR-0057 D1, Notidian-loan.2 / S2). Covers every
// declared violation class, the fail-open/fail-closed CONTRAST ADR-0057
// deliberately introduces over ADR-0032/0034's universal fail-open filter
// semantics, the Gidi audit's concrete fixture classes (D3/D5/D6 + enum/
// reference/title-binding drift), and adversarial input (malformed row/patch,
// an invariant or `unique.where` naming an undeclared field, an under-wired
// ctx) — every case must return diagnostics, never throw.

import {
  NotidianTypeProfile,
  parseTypeProfile,
  TypeProfileField,
} from "core/utils/contexts/typeProfile";
import {
  validateRow,
  validateRowPatch,
  Violation,
  ValidateRowCtx,
} from "core/utils/contexts/validateRow";

const codesOf = (violations: Violation[]): string[] =>
  violations.map((v) => v.code);

const schemaOf = (fields: TypeProfileField[]): NotidianTypeProfile => ({
  fields,
  kindFields: {},
  invariants: [],
  issues: [],
});

// ---------------------------------------------------------------------------
// type coercion mismatch
// ---------------------------------------------------------------------------

describe("checkType", () => {
  const numberSchema = schemaOf([{ name: "count", kind: "number", type: "number" }]);
  const booleanSchema = schemaOf([{ name: "active", kind: "checkbox", type: "boolean" }]);
  const dateSchema = schemaOf([{ name: "installed", kind: "date", type: "date" }]);
  const multiSchema = schemaOf([
    { name: "tags", kind: "multi_select", type: "option-multi" },
  ]);
  const textSchema = schemaOf([{ name: "notes", kind: "text", type: "text" }]);

  it("flags a non-numeric string on a number field", () => {
    const v = validateRow(numberSchema, { count: "abc" });
    expect(codesOf(v)).toEqual(["type"]);
    expect(v[0].field).toBe("count");
    expect(v[0].repairTier).toBe("manual-only");
  });

  it("accepts a numeric string and a real number", () => {
    expect(validateRow(numberSchema, { count: "42" })).toEqual([]);
    expect(validateRow(numberSchema, { count: 42 })).toEqual([]);
  });

  it("flags a non-boolean string on a boolean field", () => {
    const v = validateRow(booleanSchema, { active: "yes" });
    expect(codesOf(v)).toEqual(["type"]);
  });

  it("accepts true/false and their string forms", () => {
    expect(validateRow(booleanSchema, { active: true })).toEqual([]);
    expect(validateRow(booleanSchema, { active: "false" })).toEqual([]);
  });

  it("flags an unparseable date", () => {
    const v = validateRow(dateSchema, { installed: "not-a-date" });
    expect(codesOf(v)).toEqual(["type"]);
  });

  it("accepts an ISO date string", () => {
    expect(validateRow(dateSchema, { installed: "2026-07-04" })).toEqual([]);
  });

  it("flags a scalar where a list was declared", () => {
    const v = validateRow(multiSchema, { tags: 42 });
    expect(codesOf(v)).toEqual(["type"]);
  });

  it("accepts an array or a delimited string for a multi field", () => {
    expect(validateRow(multiSchema, { tags: ["a", "b"] })).toEqual([]);
    expect(validateRow(multiSchema, { tags: "a, b" })).toEqual([]);
  });

  it("flags an object/array where a scalar was declared (malformed-value coercion)", () => {
    expect(codesOf(validateRow(textSchema, { notes: { nested: true } }))).toEqual([
      "type",
    ]);
    expect(codesOf(validateRow(textSchema, { notes: ["a", "b"] }))).toEqual([
      "type",
    ]);
  });

  it("skips the type check entirely for an absent/empty value", () => {
    expect(validateRow(numberSchema, {})).toEqual([]);
    expect(validateRow(numberSchema, { count: "" })).toEqual([]);
    expect(validateRow(numberSchema, { count: null })).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// enum(strict)
// ---------------------------------------------------------------------------

describe("checkEnum", () => {
  const strictSchema = schemaOf([
    {
      name: "status",
      kind: "select",
      type: "option",
      enum: { values: ["active", "spare", "retired"], strict: true },
    },
  ]);
  const advisorySchema = schemaOf([
    { name: "status", kind: "select", type: "option", options: ["active", "spare"] },
  ]);

  it("flags a value outside the strict vocabulary", () => {
    const v = validateRow(strictSchema, { status: "unknown" });
    expect(codesOf(v)).toEqual(["enum"]);
    expect(v[0].repairTier).toBe("one-click");
    expect(v[0].suggestedFix).toContain("active");
  });

  it("accepts a legal value", () => {
    expect(validateRow(strictSchema, { status: "spare" })).toEqual([]);
  });

  it("never enforces a non-strict (advisory) options list", () => {
    expect(validateRow(advisorySchema, { status: "anything-goes" })).toEqual([]);
  });

  it("checks every element of a multi-value enum, reporting only the illegal ones", () => {
    const multiEnum = schemaOf([
      {
        name: "scopes",
        kind: "multi_select",
        type: "option-multi",
        enum: { values: ["wash", "fill", "drain"], strict: true },
      },
    ]);
    const v = validateRow(multiEnum, { scopes: ["wash", "rinse"] });
    expect(codesOf(v)).toEqual(["enum"]);
    expect(v[0].message).toContain("rinse");
    expect(v[0].message).not.toContain("wash,");
  });

  it("splits a multi-value field's delimited-string encoding before enum-checking (no false positive)", () => {
    // `checkType` (and `listEquals`/`listIncludes` in predicate/filter.ts) both
    // treat the delimited-string form as a legal encoding of a multi field's
    // value — `checkEnum` must split it the same way, or "wash, fill" reads as
    // one composite string instead of its two legal constituent elements.
    const multiEnum = schemaOf([
      {
        name: "scopes",
        kind: "multi_select",
        type: "option-multi",
        enum: { values: ["wash", "fill", "drain"], strict: true },
      },
    ]);
    expect(validateRow(multiEnum, { scopes: "wash, fill" })).toEqual([]);
  });

  it("flags only the illegal element of a delimited-string multi-value enum", () => {
    const multiEnum = schemaOf([
      {
        name: "scopes",
        kind: "multi_select",
        type: "option-multi",
        enum: { values: ["wash", "fill", "drain"], strict: true },
      },
    ]);
    const v = validateRow(multiEnum, { scopes: "wash, rinse" });
    expect(codesOf(v)).toEqual(["enum"]);
    expect(v[0].message).toContain("rinse");
    expect(v[0].message).not.toContain("wash,");
  });

  it("does NOT split a single-value (non-multi) field's string on a comma", () => {
    const singleEnum = schemaOf([
      {
        name: "status",
        kind: "select",
        type: "option",
        enum: { values: ["active, spare"], strict: true },
      },
    ]);
    // A single-select field's whole comma-containing string is one value,
    // never split like a multi field's delimited encoding.
    expect(validateRow(singleEnum, { status: "active, spare" })).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// required
// ---------------------------------------------------------------------------

describe("checkRequired", () => {
  const schema = schemaOf([{ name: "model", kind: "text", type: "text", required: true }]);

  it.each([undefined, null, ""])("flags a missing required value (%p)", (value) => {
    const row = value === undefined ? {} : { model: value };
    const v = validateRow(schema, row);
    expect(codesOf(v)).toEqual(["required"]);
    expect(v[0].repairTier).toBe("manual-only");
  });

  it("flags an empty array as missing", () => {
    const multiRequired = schemaOf([
      { name: "tags", kind: "multi_select", type: "option-multi", required: true },
    ]);
    expect(codesOf(validateRow(multiRequired, { tags: [] }))).toEqual(["required"]);
  });

  it("accepts a present value", () => {
    expect(validateRow(schema, { model: "ESP32-S3" })).toEqual([]);
  });

  it("does not flag a falsy-but-present value (0)", () => {
    const numberRequired = schemaOf([
      { name: "count", kind: "number", type: "number", required: true },
    ]);
    expect(validateRow(numberRequired, { count: 0 })).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// pattern
// ---------------------------------------------------------------------------

describe("checkPattern", () => {
  const schema = schemaOf([
    { name: "serial", kind: "text", type: "text", pattern: "^[0-9]{2}-ch[0-9]{2}$" },
  ]);

  it("flags a value that does not match the declared pattern", () => {
    const v = validateRow(schema, { serial: "not-shaped-right" });
    expect(codesOf(v)).toEqual(["pattern"]);
    expect(v[0].repairTier).toBe("manual-only");
  });

  it("accepts a matching value", () => {
    expect(validateRow(schema, { serial: "02-ch25" })).toEqual([]);
  });

  it("skips an absent value (required's job, not pattern's)", () => {
    expect(validateRow(schema, {})).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// title_binding
// ---------------------------------------------------------------------------

describe("checkTitleBinding", () => {
  const schema = schemaOf([
    { name: "sensor_id", kind: "text", type: "text", title_binding: true },
  ]);

  it("flags a field value that does not mirror the file basename", () => {
    const v = validateRowPatch(schema, { sensor_id: "02-ch26" }, {}, {
      basename: "02-ch25",
    });
    expect(codesOf(v)).toEqual(["title-binding"]);
    expect(v[0].repairTier).toBe("one-click");
  });

  it("accepts a matching value", () => {
    const v = validateRowPatch(schema, { sensor_id: "02-ch25" }, {}, {
      basename: "02-ch25",
    });
    expect(v).toEqual([]);
  });

  it("skips entirely when the caller has no basename to compare against", () => {
    expect(validateRow(schema, { sensor_id: "02-ch26" })).toEqual([]);
  });

  it("flags an empty field against a non-empty basename", () => {
    const v = validateRowPatch(schema, {}, {}, { basename: "02-ch25" });
    expect(codesOf(v)).toEqual(["title-binding"]);
  });
});

// ---------------------------------------------------------------------------
// empty-encoding policy (Gidi audit D3: bare-null vs empty-string)
// ---------------------------------------------------------------------------

describe("checkEmptyEncoding", () => {
  const emptyStringSchema = schemaOf([
    { name: "device", kind: "text", type: "text", empty: "empty-string" },
  ]);
  const absentSchema = schemaOf([
    { name: "device", kind: "text", type: "text", empty: "absent" },
  ]);

  it("bare null is NEVER a legal encoding, under either policy", () => {
    expect(codesOf(validateRow(emptyStringSchema, { device: null }))).toEqual([
      "empty-encoding",
    ]);
    expect(codesOf(validateRow(absentSchema, { device: null }))).toEqual([
      "empty-encoding",
    ]);
  });

  it('policy "empty-string": an absent key is a violation, "" is correct', () => {
    expect(codesOf(validateRow(emptyStringSchema, {}))).toEqual(["empty-encoding"]);
    expect(validateRow(emptyStringSchema, { device: "" })).toEqual([]);
  });

  it('policy "absent": "" is a violation, an absent key is correct', () => {
    expect(codesOf(validateRow(absentSchema, { device: "" }))).toEqual([
      "empty-encoding",
    ]);
    expect(validateRow(absentSchema, {})).toEqual([]);
  });

  it("a real value never trips the empty-encoding check", () => {
    expect(validateRow(emptyStringSchema, { device: "ESP32-Pin7" })).toEqual([]);
  });

  it("the repair tier is autofix (ADR-0057 D5's declared mechanical-normalization class)", () => {
    expect(validateRow(emptyStringSchema, { device: null })[0].repairTier).toBe(
      "autofix"
    );
  });
});

// ---------------------------------------------------------------------------
// unique(+where)
// ---------------------------------------------------------------------------

describe("checkUnique", () => {
  const schema = schemaOf([
    { name: "sensor_id", kind: "text", type: "text", unique: { scope: "database" } },
  ]);

  it("flags a value already used by another row", () => {
    const ctx: ValidateRowCtx = {
      getOtherRows: () => [{ sensor_id: "S1" }, { sensor_id: "S2" }],
    };
    const v = validateRowPatch(schema, { sensor_id: "S1" }, {}, ctx);
    expect(codesOf(v)).toEqual(["unique"]);
  });

  it("accepts a value no other row holds", () => {
    const ctx: ValidateRowCtx = {
      getOtherRows: () => [{ sensor_id: "S1" }, { sensor_id: "S2" }],
    };
    expect(validateRowPatch(schema, { sensor_id: "S3" }, {}, ctx)).toEqual([]);
  });

  it("skips gracefully when the caller has not wired a rows-provider", () => {
    expect(validateRow(schema, { sensor_id: "S1" })).toEqual([]);
  });

  it("skips an empty value (nothing to collide on)", () => {
    const ctx: ValidateRowCtx = { getOtherRows: () => [{ sensor_id: "" }] };
    expect(validateRowPatch(schema, {}, {}, ctx)).toEqual([]);
  });

  it("ignores non-plain-object entries from a malformed rows snapshot", () => {
    const ctx: ValidateRowCtx = {
      getOtherRows: () => [null, "garbage", { sensor_id: "S1" }] as any,
    };
    expect(codesOf(validateRowPatch(schema, { sensor_id: "S1" }, {}, ctx))).toEqual([
      "unique",
    ]);
    expect(validateRowPatch(schema, { sensor_id: "S9" }, {}, ctx)).toEqual([]);
  });

  it("`where` scopes BOTH which rows must be checked and which rows count as candidates", () => {
    const scopedSchema = schemaOf([
      {
        name: "sensor_id",
        kind: "text",
        type: "text",
        unique: {
          scope: "database",
          where: [{ field: "status", fn: "isNot", value: "spare", fType: "literal" }],
        },
      },
      { name: "status", kind: "select", type: "option" },
    ]);
    const ctx: ValidateRowCtx = {
      getOtherRows: () => [
        { sensor_id: "S1", status: "spare" }, // out of scope: excluded as a candidate.
        { sensor_id: "S2", status: "active" },
      ],
    };
    // Current row is itself a spare -> out of scope -> never checked, even
    // though S1 collides with another spare row.
    expect(
      codesOf(
        validateRowPatch(
          scopedSchema,
          { sensor_id: "S1", status: "spare" },
          {},
          ctx
        )
      )
    ).toEqual([]);
    // Current row is active and collides with the OTHER active row.
    expect(
      codesOf(
        validateRowPatch(
          scopedSchema,
          { sensor_id: "S2", status: "active" },
          {},
          ctx
        )
      )
    ).toEqual(["unique"]);
    // Current row is active but only collides with the out-of-scope spare row
    // -> the spare candidate is excluded, so no violation.
    expect(
      validateRowPatch(scopedSchema, { sensor_id: "S1", status: "active" }, {}, ctx)
    ).toEqual([]);
  });

  it("never throws when the injected rows-provider itself throws", () => {
    const ctx: ValidateRowCtx = {
      getOtherRows: () => {
        throw new Error("index not ready");
      },
    };
    expect(() =>
      validateRowPatch(schema, { sensor_id: "S1" }, {}, ctx)
    ).not.toThrow();
    expect(validateRowPatch(schema, { sensor_id: "S1" }, {}, ctx)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// reference existence (onBrokenWrite)
// ---------------------------------------------------------------------------

describe("checkReference", () => {
  const blockingSchema = schemaOf([
    {
      name: "board_id",
      kind: "text",
      type: "text",
      reference: {
        targetFolder: "Gidi/Hardware/Board Registry",
        targetKey: "board_id",
        onBrokenWrite: "block",
        onReferencedChange: "warn",
      },
    },
  ]);
  const warningSchema = schemaOf([
    {
      name: "board_id",
      kind: "text",
      type: "text",
      reference: {
        targetFolder: "Gidi/Hardware/Board Registry",
        targetKey: "board_id",
        onBrokenWrite: "warn",
        onReferencedChange: "warn",
      },
    },
  ]);

  it('"block" severity is error', () => {
    const ctx: ValidateRowCtx = { resolveReferenceExists: () => false };
    const v = validateRowPatch(blockingSchema, { board_id: "B99" }, {}, ctx);
    expect(codesOf(v)).toEqual(["reference-broken"]);
    expect(v[0].severity).toBe("error");
    expect(v[0].repairTier).toBe("one-click");
  });

  it('"warn" severity is warn', () => {
    const ctx: ValidateRowCtx = { resolveReferenceExists: () => false };
    const v = validateRowPatch(warningSchema, { board_id: "B99" }, {}, ctx);
    expect(v[0].severity).toBe("warn");
  });

  it("accepts a resolvable reference", () => {
    const ctx: ValidateRowCtx = { resolveReferenceExists: () => true };
    expect(validateRowPatch(blockingSchema, { board_id: "B01" }, {}, ctx)).toEqual([]);
  });

  it("skips an unset FK (required's job, not reference's)", () => {
    const ctx: ValidateRowCtx = { resolveReferenceExists: () => false };
    expect(validateRowPatch(blockingSchema, {}, {}, ctx)).toEqual([]);
  });

  it("skips gracefully when the caller has not wired a resolver", () => {
    expect(validateRow(blockingSchema, { board_id: "B99" })).toEqual([]);
  });

  it("never throws when the injected resolver itself throws", () => {
    const ctx: ValidateRowCtx = {
      resolveReferenceExists: () => {
        throw new Error("index not ready");
      },
    };
    expect(() =>
      validateRowPatch(blockingSchema, { board_id: "B99" }, {}, ctx)
    ).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// invariants: when-gate then require; the fail-open/fail-closed CONTRAST
// ---------------------------------------------------------------------------

describe("invariants", () => {
  it("a `when` guard that fails suppresses the whole invariant", () => {
    const schema: NotidianTypeProfile = {
      ...schemaOf([
        { name: "status", kind: "select", type: "option" },
        { name: "device", kind: "text", type: "text" },
      ]),
      invariants: [
        {
          when: [{ field: "status", fn: "is", value: "spare", fType: "literal" }],
          require: [{ field: "device", fn: "isEmpty", value: "", fType: "literal" }],
          severity: "warn",
          message: "spare devices must not have a device assignment",
        },
      ],
    };
    expect(
      validateRow(schema, { status: "active", device: "ESP32-Pin7" })
    ).toEqual([]);
  });

  it("fires when the guard passes and the requirement fails", () => {
    const schema: NotidianTypeProfile = {
      ...schemaOf([
        { name: "status", kind: "select", type: "option" },
        { name: "device", kind: "text", type: "text" },
      ]),
      invariants: [
        {
          when: [{ field: "status", fn: "is", value: "spare", fType: "literal" }],
          require: [{ field: "device", fn: "isEmpty", value: "", fType: "literal" }],
          severity: "warn",
          message: "spare devices must not have a device assignment",
        },
      ],
    };
    const v = validateRow(schema, { status: "spare", device: "ESP32-Pin7" });
    expect(codesOf(v)).toEqual(["invariant"]);
    expect(v[0].severity).toBe("warn");
    expect(v[0].field).toBe("device");
    expect(v[0].message).toBe("spare devices must not have a device assignment");
  });

  it("is silent when the guard passes and the requirement is satisfied", () => {
    const schema: NotidianTypeProfile = {
      ...schemaOf([
        { name: "status", kind: "select", type: "option" },
        { name: "device", kind: "text", type: "text" },
      ]),
      invariants: [
        {
          when: [{ field: "status", fn: "is", value: "spare", fType: "literal" }],
          require: [{ field: "device", fn: "isEmpty", value: "", fType: "literal" }],
          severity: "warn",
          message: "spare devices must not have a device assignment",
        },
      ],
    };
    expect(validateRow(schema, { status: "spare", device: "" })).toEqual([]);
  });

  it("resolves a cross-field `require` via fType:'property' against the SAME row (ADR-0056 D8)", () => {
    const schema: NotidianTypeProfile = {
      ...schemaOf([
        { name: "channels", kind: "number", type: "number" },
        { name: "used_channels", kind: "number", type: "number" },
      ]),
      invariants: [
        {
          require: [
            {
              field: "used_channels",
              fn: "isLessThanOrEqual",
              value: "channels",
              fType: "property",
            },
          ],
          severity: "error",
          message: "used_channels must not exceed channels",
        },
      ],
    };
    expect(validateRow(schema, { channels: "4", used_channels: "3" })).toEqual([]);
    const v = validateRow(schema, { channels: "4", used_channels: "5" });
    expect(codesOf(v)).toEqual(["invariant"]);
    expect(v[0].field).toBe("used_channels");
  });

  it("leaves `field` undefined when `require` spans more than one field", () => {
    const schema: NotidianTypeProfile = {
      ...schemaOf([
        { name: "a", kind: "text", type: "text" },
        { name: "b", kind: "text", type: "text" },
      ]),
      invariants: [
        {
          require: [
            { field: "a", fn: "isNotEmpty", value: "", fType: "literal" },
            { field: "b", fn: "isNotEmpty", value: "", fType: "literal" },
          ],
          severity: "error",
          message: "both a and b are required together",
        },
      ],
    };
    const v = validateRow(schema, { a: "", b: "" });
    expect(v[0].field).toBeUndefined();
  });

  it("labels a declared autofix invariant with the autofix repair tier", () => {
    const schema: NotidianTypeProfile = {
      ...schemaOf([{ name: "device", kind: "text", type: "text" }]),
      invariants: [
        {
          require: [{ field: "device", fn: "isNotEmpty", value: "", fType: "literal" }],
          severity: "error",
          message: "device must be set",
          autofix: "normalize-empty",
        },
      ],
    };
    const v = validateRow(schema, {});
    expect(v[0].repairTier).toBe("autofix");
    expect(v[0].suggestedFix).toBe("normalize-empty");
  });

  it("labels an invariant with no declared autofix as manual-only", () => {
    const schema: NotidianTypeProfile = {
      ...schemaOf([{ name: "device", kind: "text", type: "text" }]),
      invariants: [
        {
          require: [{ field: "device", fn: "isNotEmpty", value: "", fType: "literal" }],
          severity: "error",
          message: "device must be set",
        },
      ],
    };
    expect(validateRow(schema, {})[0].repairTier).toBe("manual-only");
  });

  // The deliberate CONTRAST with ADR-0032/0034's universal fail-open filter
  // semantics: an unresolvable `require` filter (its field is not declared
  // anywhere in the schema -- the "missing schema field" adversarial class)
  // is FAIL-CLOSED for `severity: "error"`, fail-OPEN (today's lenient
  // default) for `severity: "warn"`.
  describe("fail-open/fail-closed contrast on an undeclared `require` field", () => {
    const schemaWith = (severity: "error" | "warn"): NotidianTypeProfile => ({
      ...schemaOf([{ name: "status", kind: "select", type: "option" }]),
      invariants: [
        {
          require: [
            { field: "ghost_field", fn: "isNotEmpty", value: "", fType: "literal" },
          ],
          severity,
          message: "ghost_field rule",
        },
      ],
    });

    it("error severity: fails CLOSED (treated as violated)", () => {
      const v = validateRow(schemaWith("error"), { status: "active" });
      expect(codesOf(v)).toEqual(["invariant"]);
      expect(v[0].field).toBe("ghost_field");
      expect(v[0].severity).toBe("error");
    });

    it("warn severity: fails OPEN (treated as satisfied, no violation)", () => {
      expect(validateRow(schemaWith("warn"), { status: "active" })).toEqual([]);
    });
  });

  // A profile with zero declared `fields` but a non-empty `invariants` list
  // is a reachable parser output (typeProfile.ts's `parseInvariants` runs
  // independent of `parseFields`; a schema authored invariants-before-fields
  // yields exactly this shape, flagged with a `missing-fields` issue but
  // still carrying real invariants). `validateRowPatch` must still evaluate
  // those invariants -- an empty `fields` list must never silently bypass
  // the fail-closed contract above.
  describe("invariants still evaluate when `fields` is empty", () => {
    const emptyFieldsSchema = (severity: "error" | "warn"): NotidianTypeProfile => ({
      fields: [],
      kindFields: {},
      issues: [{ reason: "missing-fields" }],
      invariants: [
        {
          require: [
            { field: "ghost_field", fn: "isNotEmpty", value: "", fType: "literal" },
          ],
          severity,
          message: "ghost_field rule",
        },
      ],
    });

    it("error severity: still fails CLOSED even though `fields` is empty", () => {
      const v = validateRowPatch(emptyFieldsSchema("error"), {}, {});
      expect(codesOf(v)).toEqual(["invariant"]);
      expect(v[0].severity).toBe("error");
    });

    it("warn severity: still fails OPEN (no violation) when `fields` is empty", () => {
      expect(validateRowPatch(emptyFieldsSchema("warn"), {}, {})).toEqual([]);
    });

    it("a schema with truly no invariants AND no fields still raises nothing", () => {
      expect(validateRowPatch(schemaOf([]), {}, {})).toEqual([]);
    });
  });

  it("an unresolvable `when` guard always defaults to true (fail-open, unchanged) -- it never suppresses evaluation", () => {
    const schema: NotidianTypeProfile = {
      ...schemaOf([{ name: "status", kind: "text", type: "text" }]),
      invariants: [
        {
          when: [{ field: "ghost_field", fn: "isNotEmpty", value: "", fType: "literal" }],
          require: [{ field: "status", fn: "isNotEmpty", value: "", fType: "literal" }],
          severity: "error",
          message: "status required once the (unresolvable) guard passes",
        },
      ],
    };
    const v = validateRow(schema, {});
    expect(codesOf(v)).toEqual(["invariant"]);
  });
});

// ---------------------------------------------------------------------------
// Gidi audit fixtures (docs/audits/2026-07-02-notidian-database-governance-audit.md
// D3/D5/D6, plus enum/reference/title-binding drift), parsed through the REAL
// S1 parser end-to-end rather than hand-built TypeProfileField literals.
// ---------------------------------------------------------------------------

describe("Gidi audit fixtures", () => {
  const hubFrontmatter = {
    schema_type: "notidian_type_profile",
    fields: {
      status: {
        kind: "select",
        enum: { values: ["active", "spare", "retired"], strict: true },
      },
      device: { kind: "text", empty: "empty-string" },
      scope: {
        kind: "select",
        enum: { values: ["wash", "fill", "drain"], strict: true },
        empty: "empty-string",
      },
      model: { kind: "text", required: true },
      sensor_id: { kind: "text", title_binding: true },
      board_id: {
        kind: "text",
        reference: {
          targetFolder: "Gidi/Hardware/Board Registry",
          targetKey: "board_id",
          onBrokenWrite: "warn",
          onReferencedChange: "warn",
        },
      },
    },
    invariants: [
      {
        when: [{ field: "status", fn: "is", value: "spare", fType: "literal" }],
        require: [{ field: "device", fn: "isEmpty", value: "", fType: "literal" }],
        severity: "warn",
        message: "status: spare rows must not have a device assignment.",
      },
    ],
  };

  const profile = parseTypeProfile(hubFrontmatter);

  it("parses cleanly with no issues", () => {
    expect(profile?.issues).toEqual([]);
  });

  it("D3 -- bare null vs empty-string encoding drift", () => {
    // Isolate `device`'s own violations -- the bare row otherwise also (and
    // correctly) fires `scope`'s empty-encoding + `model`'s required check,
    // since this fixture profile declares those too.
    const deviceIssuesOf = (row: Record<string, unknown>) =>
      validateRow(profile, row).filter((v) => v.field == "device");
    expect(codesOf(deviceIssuesOf({ device: null }))).toEqual(["empty-encoding"]);
    expect(
      validateRow(profile, { device: "", model: "x", scope: "wash" }).filter(
        (v) => v.field == "device"
      )
    ).toEqual([]);
  });

  it("D5 -- spare-with-device lifecycle invariant", () => {
    const v = validateRow(profile, {
      status: "spare",
      device: "ESP32-Pin7",
      model: "x",
      scope: "wash",
    });
    expect(v.some((issue) => issue.code == "invariant")).toBe(true);
  });

  it("D6 -- missing required `model`", () => {
    const v = validateRow(profile, { model: "", scope: "wash" });
    expect(v.some((issue) => issue.code == "required" && issue.field == "model")).toBe(
      true
    );
  });

  it("broken key-match reference on `board_id`", () => {
    const ctx: ValidateRowCtx = { resolveReferenceExists: () => false };
    const v = validateRowPatch(
      profile,
      { model: "x", scope: "wash", board_id: "B99" },
      {},
      ctx
    );
    expect(
      v.some((issue) => issue.code == "reference-broken" && issue.field == "board_id")
    ).toBe(true);
  });

  it("enum violation on `scope`", () => {
    const v = validateRow(profile, { model: "x", scope: "rinse" });
    expect(
      v.some((issue) => issue.code == "enum" && issue.field == "scope")
    ).toBe(true);
  });

  it("title/id mismatch on `sensor_id`", () => {
    const v = validateRowPatch(
      profile,
      { model: "x", scope: "wash", sensor_id: "02-ch26" },
      {},
      { basename: "02-ch25" }
    );
    expect(
      v.some((issue) => issue.code == "title-binding" && issue.field == "sensor_id")
    ).toBe(true);
  });

  it("a fully clean row raises nothing", () => {
    const ctx: ValidateRowCtx = {
      getOtherRows: () => [],
      resolveReferenceExists: () => true,
    };
    const v = validateRowPatch(
      profile,
      {
        status: "active",
        device: "ESP32-Pin7",
        scope: "wash",
        model: "ESP32-S3",
        sensor_id: "02-ch25",
        board_id: "B01",
      },
      {},
      { ...ctx, basename: "02-ch25" }
    );
    expect(v).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Adversarial: never throws; a malformed row/schema degrades to a diagnostic
// (or a graceful empty/skip), never an exception.
// ---------------------------------------------------------------------------

describe("adversarial input", () => {
  const schema = schemaOf([{ name: "model", kind: "text", type: "text", required: true }]);

  it.each([null, ["array"], "a string", 42, true])(
    "a malformed row (%p) returns a malformed-row diagnostic, never throws",
    (badRow) => {
      expect(() => validateRowPatch(schema, badRow as any, {})).not.toThrow();
      const v = validateRowPatch(schema, badRow as any, {});
      expect(codesOf(v)).toEqual(["malformed-row"]);
      expect(v[0].message).toContain("row");
    }
  );

  it.each([["array"], "a string", 42, true])(
    "a malformed patch (%p) returns a malformed-row diagnostic, never throws",
    (badPatch) => {
      expect(() => validateRowPatch(schema, {}, badPatch as any)).not.toThrow();
      const v = validateRowPatch(schema, {}, badPatch as any);
      expect(codesOf(v)).toEqual(["malformed-row"]);
      expect(v[0].message).toContain("patch");
    }
  );

  it("null/undefined patch is treated as no proposed change, not malformed", () => {
    expect(validateRowPatch(schema, { model: "x" }, null as any)).toEqual([]);
    expect(validateRowPatch(schema, { model: "x" }, undefined as any)).toEqual([]);
  });

  it("a null schema returns no violations (nothing declared to check)", () => {
    expect(validateRow(null, { anything: "goes" })).toEqual([]);
    expect(validateRow(undefined, { anything: "goes" })).toEqual([]);
  });

  it("a schema with no fields returns no violations", () => {
    expect(validateRow(schemaOf([]), { anything: "goes" })).toEqual([]);
  });

  it("a hand-built non-conforming schema (fields/invariants not arrays) degrades gracefully", () => {
    const brokenSchema = { fields: undefined, invariants: "not-a-list" } as any;
    expect(() => validateRow(brokenSchema, { model: "x" })).not.toThrow();
    expect(validateRow(brokenSchema, { model: "x" })).toEqual([]);
  });

  it('an invariant naming an undeclared "missing schema" field never throws', () => {
    const schemaWithGhostInvariant: NotidianTypeProfile = {
      ...schemaOf([{ name: "status", kind: "text", type: "text" }]),
      invariants: [
        {
          require: [
            { field: "ghost", fn: "isNotEmpty", value: "", fType: "literal" },
          ],
          severity: "error",
          message: "ghost rule",
        },
      ],
    };
    expect(() =>
      validateRow(schemaWithGhostInvariant, { status: "active" })
    ).not.toThrow();
  });

  it("`unique.where` naming an undeclared field defaults the guard open (row stays in scope) without throwing", () => {
    const schemaWithGhostWhere = schemaOf([
      {
        name: "sensor_id",
        kind: "text",
        type: "text",
        unique: {
          scope: "database",
          where: [{ field: "ghost", fn: "isNotEmpty", value: "", fType: "literal" }],
        },
      },
    ]);
    const ctx: ValidateRowCtx = { getOtherRows: () => [{ sensor_id: "S1" }] };
    expect(() =>
      validateRowPatch(schemaWithGhostWhere, { sensor_id: "S1" }, {}, ctx)
    ).not.toThrow();
    expect(codesOf(validateRowPatch(schemaWithGhostWhere, { sensor_id: "S1" }, {}, ctx))).toEqual(
      ["unique"]
    );
  });

  it("an unresolvable `pattern` regex never throws (defensive, not a reachable production path)", () => {
    const badPattern = schemaOf([
      // A hand-built field bypassing S1's own parse-time regex validation.
      { name: "serial", kind: "text", type: "text", pattern: "(unclosed" },
    ]);
    expect(() => validateRow(badPattern, { serial: "anything" })).not.toThrow();
  });

  it("an unknown extra property on the row (not declared anywhere in the schema) raises nothing", () => {
    // Deliberate design boundary (see validateRow.ts's module comment): ordinary
    // Obsidian metadata (aliases, tags, cssclasses, ...) not part of the Type
    // Profile must NOT misfire as a violation.
    expect(
      validateRow(schema, { model: "x", aliases: ["y"], cssclasses: ["z"] })
    ).toEqual([]);
  });

  it("validateRow(schema, row, ctx) == validateRowPatch(schema, row, row, ctx)", () => {
    const ctx: ValidateRowCtx = { basename: "x" };
    const row = { model: "x" };
    expect(validateRow(schema, row, ctx)).toEqual(
      validateRowPatch(schema, row, row, ctx)
    );
  });

  it("patch overrides only the keys it sets; explicit undefined clears a field", () => {
    const v = validateRowPatch(schema, { model: "x" }, { model: undefined });
    expect(codesOf(v)).toEqual(["required"]);
  });

  it("works with no ctx argument at all (defaults to {})", () => {
    const referenceSchema = schemaOf([
      {
        name: "board_id",
        kind: "text",
        type: "text",
        reference: {
          targetFolder: "x",
          targetKey: "y",
          onBrokenWrite: "block",
          onReferencedChange: "warn",
        },
      },
    ]);
    expect(() => validateRow(referenceSchema, { board_id: "B1" })).not.toThrow();
    expect(validateRow(referenceSchema, { board_id: "B1" })).toEqual([]);
  });
});
