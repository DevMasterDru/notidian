/**
 * Structural-validity net for fields/presets.ts.
 *
 * presets.ts exports `RepeatTemplate`, a SpaceProperty preset for an RRULE-style
 * "Repeat" object property. Its `value` is a JSON-stringified ObjectType schema:
 *
 *   { typeName: string, type: { <fieldKey>: { label, type, value? } , ... } }
 *
 * where each inner field's `type` must be one of the allowed property types, and
 * `option`/`option-multi` fields carry a `value.options` array of {name, value}.
 *
 * This module is a static constant (no I/O), so we pin its shape exactly: the
 * preset must be a structurally valid SpaceProperty, its embedded schema must
 * round-trip through JSON, and every embedded field must be well-formed. A
 * regression that, say, mistypes a freq option or drops the required `until`
 * field would break calendar repeat config silently — these tests catch it.
 */
import i18n from "shared/i18n";
import { safelyParseJSON } from "shared/utils/json";
import { LegacyRepeatTemplate, RepeatTemplate } from "./presets";

/** Allowed inner field property types for an embedded ObjectType schema. */
const ALLOWED_FIELD_TYPES = new Set([
  "text",
  "number",
  "boolean",
  "date",
  "option",
  "option-multi",
  "link",
  "link-multi",
  "tags",
  "tags-multi",
  "object",
  "object-multi",
]);

type EmbeddedField = {
  label?: unknown;
  type?: unknown;
  value?: {
    required?: unknown;
    options?: Array<{ name?: unknown; value?: unknown }>;
    alias?: unknown;
  };
};

type EmbeddedSchema = {
  typeName?: unknown;
  type?: Record<string, EmbeddedField>;
};

describe("i18n.labels.repeat — root-cause regression guard", () => {
  // REGRESSION (fixed in this change): presets.ts uses `i18n.labels.repeat` for
  // both the preset `name` and the embedded `typeName`, but that key was MISSING
  // from src/shared/en.ts's `labels` table, so RepeatTemplate.name resolved to
  // `undefined`. The fix added `"repeat": "Repeat"` to labels. This test pins the
  // root cause directly so a future removal of the key fails HERE (with a clear
  // message) rather than only via the downstream structural assertions below.
  it("the labels table provides a non-empty 'repeat' string", () => {
    expect(typeof i18n.labels.repeat).toBe("string");
    expect((i18n.labels.repeat as string).length).toBeGreaterThan(0);
  });
});

describe("RepeatTemplate — top-level SpaceProperty shape", () => {
  it("has a non-empty string name", () => {
    expect(typeof RepeatTemplate.name).toBe("string");
    expect((RepeatTemplate.name as string).length).toBeGreaterThan(0);
  });

  it("is declared as an 'object' property type", () => {
    expect(RepeatTemplate.type).toBe("object");
  });

  it("carries a JSON-parseable value payload", () => {
    expect(typeof RepeatTemplate.value).toBe("string");
    const parsed = safelyParseJSON(RepeatTemplate.value as string);
    expect(parsed).toBeDefined();
    expect(typeof parsed).toBe("object");
  });
});

describe("RepeatTemplate — embedded ObjectType schema", () => {
  const schema = safelyParseJSON(RepeatTemplate.value as string) as EmbeddedSchema;

  it("has a typeName and a non-empty `type` map of fields", () => {
    expect(typeof schema.typeName).toBe("string");
    expect(schema.type).toBeDefined();
    expect(typeof schema.type).toBe("object");
    expect(Object.keys(schema.type as object).length).toBeGreaterThan(0);
  });

  it("declares the RRULE-required `freq` and `until` fields", () => {
    // These two are marked required:true and are the backbone of an RRULE.
    expect(schema.type).toHaveProperty("freq");
    expect(schema.type).toHaveProperty("until");
    expect((schema.type as Record<string, EmbeddedField>).freq.value?.required).toBe(
      true
    );
    expect(
      (schema.type as Record<string, EmbeddedField>).until.value?.required
    ).toBe(true);
  });

  const fieldEntries = Object.entries(schema.type as Record<string, EmbeddedField>);

  it.each(fieldEntries.map(([k]) => [k]))(
    "field '%s' has a non-empty string label",
    (key) => {
      const field = (schema.type as Record<string, EmbeddedField>)[key];
      expect(typeof field.label).toBe("string");
      expect((field.label as string).length).toBeGreaterThan(0);
    }
  );

  it.each(fieldEntries.map(([k]) => [k]))(
    "field '%s' has a type within the allowed set",
    (key) => {
      const field = (schema.type as Record<string, EmbeddedField>)[key];
      expect(typeof field.type).toBe("string");
      expect(ALLOWED_FIELD_TYPES.has(field.type as string)).toBe(true);
    }
  );

  it.each(
    fieldEntries
      .filter(([, f]) => f.type === "option" || f.type === "option-multi")
      .map(([k]) => [k])
  )("option field '%s' carries a well-formed options array", (key) => {
    const field = (schema.type as Record<string, EmbeddedField>)[key];
    const options = field.value?.options;
    expect(Array.isArray(options)).toBe(true);
    expect((options as unknown[]).length).toBeGreaterThan(0);
    for (const opt of options as Array<{ name?: unknown; value?: unknown }>) {
      expect(typeof opt.name).toBe("string");
      expect((opt.name as string).length).toBeGreaterThan(0);
      expect(typeof opt.value).toBe("string");
      expect((opt.value as string).length).toBeGreaterThan(0);
    }
  });

  it("freq options are exactly the five ADR-0020 supported frequencies", () => {
    const freq = (schema.type as Record<string, EmbeddedField>).freq;
    const values = (freq.value?.options ?? []).map((o) => o.value);
    expect(new Set(values)).toEqual(
      new Set([
        "YEARLY",
        "MONTHLY",
        "WEEKLY",
        "DAILY",
        "HOURLY",
      ])
    );
  });

  it("keeps the seven historical choices only in the kill-switch OFF template", () => {
    const legacy = safelyParseJSON(
      LegacyRepeatTemplate.value as string
    ) as EmbeddedSchema;
    const freq = (legacy.type as Record<string, EmbeddedField>).freq;
    expect(new Set((freq.value?.options ?? []).map((option) => option.value))).toEqual(
      new Set([
        "YEARLY",
        "MONTHLY",
        "WEEKLY",
        "DAILY",
        "HOURLY",
        "MINUTELY",
        "SECONDLY",
      ])
    );
  });

  it("weekday option values (wkst/byweekday) are the two-letter RRULE day codes", () => {
    const expected = new Set(["MO", "TU", "WE", "TH", "FR", "SA", "SU"]);
    for (const key of ["wkst", "byweekday"]) {
      const field = (schema.type as Record<string, EmbeddedField>)[key];
      const values = (field.value?.options ?? []).map((o) => o.value);
      expect(new Set(values)).toEqual(expected);
    }
  });

  it("has NO field with a duplicate option value within its own option set", () => {
    for (const [, field] of fieldEntries) {
      if (field.type !== "option" && field.type !== "option-multi") continue;
      const values = (field.value?.options ?? []).map((o) => o.value);
      expect(new Set(values).size).toBe(values.length);
    }
  });
});
