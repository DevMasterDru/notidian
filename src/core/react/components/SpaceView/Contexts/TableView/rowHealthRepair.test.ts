// Offline (node) coverage for the row-health repair menu's schema-resolution
// + repair-classification helpers (Notidian-loan.5, ADR-0057 D5). Pure logic,
// no DOM, no React — mirrors the reconciler's own private schema resolution
// with a fake spacesIndex/pathsIndex.
import { typeProfileSchemaType } from "core/utils/contexts/typeProfile";
import {
  emptyEncodingIsAutofixable,
  enumValuesForField,
  fieldFromSchema,
  resolveDbTypeProfile,
} from "./rowHealthRepair";

const fakeSuperstate = (opts: {
  notePath?: string;
  property?: Record<string, unknown>;
}) => {
  const spacesIndex = new Map<string, any>();
  const pathsIndex = new Map<string, any>();
  if (opts.notePath) {
    spacesIndex.set("db/path", { space: { notePath: opts.notePath } });
    pathsIndex.set(opts.notePath, { metadata: { property: opts.property } });
  }
  return { spacesIndex, pathsIndex } as any;
};

describe("resolveDbTypeProfile", () => {
  it("returns null when the dbPath is falsy", () => {
    expect(resolveDbTypeProfile(fakeSuperstate({}), null)).toBeNull();
    expect(resolveDbTypeProfile(fakeSuperstate({}), undefined)).toBeNull();
  });

  it("returns null when the space has no hub notePath", () => {
    const superstate = fakeSuperstate({});
    expect(resolveDbTypeProfile(superstate, "db/path")).toBeNull();
  });

  it("returns null when the hub note carries no parseable schema", () => {
    const superstate = fakeSuperstate({
      notePath: "db/hub.md",
      property: { unrelated: "value" },
    });
    expect(resolveDbTypeProfile(superstate, "db/path")).toBeNull();
  });

  it("resolves the schema via the SAME hub-note lookup the reconciler uses", () => {
    const superstate = fakeSuperstate({
      notePath: "db/hub.md",
      property: {
        schema_type: typeProfileSchemaType,
        fields: JSON.stringify({
          status: { kind: "select" },
        }),
      },
    });
    const schema = resolveDbTypeProfile(superstate, "db/path");
    expect(schema).not.toBeNull();
    expect(schema!.fields.some((f) => f.name == "status")).toBe(true);
  });
});

describe("fieldFromSchema", () => {
  const schema = {
    fields: [
      { name: "status", kind: "select", type: "option" },
      { name: "title", kind: "text", type: "text" },
    ],
    kindFields: {},
    invariants: [],
    issues: [],
  } as any;

  it("finds a declared field by name", () => {
    expect(fieldFromSchema(schema, "status")?.name).toBe("status");
  });

  it("returns null for an undeclared field, a null schema, or a missing name", () => {
    expect(fieldFromSchema(schema, "nope")).toBeNull();
    expect(fieldFromSchema(null, "status")).toBeNull();
    expect(fieldFromSchema(schema, undefined)).toBeNull();
  });
});

describe("emptyEncodingIsAutofixable", () => {
  it("is autofixable only when the declared policy is empty-string", () => {
    expect(emptyEncodingIsAutofixable({ empty: "empty-string" } as any)).toBe(
      true
    );
    expect(emptyEncodingIsAutofixable({ empty: "absent" } as any)).toBe(false);
    expect(emptyEncodingIsAutofixable(null)).toBe(false);
    expect(emptyEncodingIsAutofixable(undefined)).toBe(false);
  });
});

describe("enumValuesForField", () => {
  it("returns the declared enum values, or [] when absent", () => {
    expect(
      enumValuesForField({ enum: { values: ["a", "b"], strict: true } } as any)
    ).toEqual(["a", "b"]);
    expect(enumValuesForField({} as any)).toEqual([]);
    expect(enumValuesForField(null)).toEqual([]);
  });
});
