/**
 * Behavioral net for defaultValueForField (and saveDefaultValueForField) in
 * src/core/utils/contexts/fields/fields.ts.
 *
 * defaultValueForField is a PURE helper that resolves the value to seed a field
 * with: it returns the SUPPLIED value when one is genuinely present, otherwise
 * the field's configured default (with a `$space` special-case that yields the
 * supplied row path).
 *
 * These tests are mostly CORRECTED-behavior pins, not pure characterization: the
 * fix for Notidian-w6cq makes the number/boolean branch use value-PRESENCE
 * (undefined/null) rather than truthiness, so a legitimately-entered 0 / false
 * is no longer dropped in favor of the configured default. That falsy-collapse
 * is the same class fixed elsewhere in the repo (sortingUtils ADR 0025/0033).
 *
 * The string/option branch keeps its long-standing length-based presence check:
 * a present non-empty string wins; an empty string '' falls through to default.
 *
 * No superstate / I/O is involved, so the helper is pinned fully offline.
 */
import { SpaceProperty } from "shared/types/mdb";
import { defaultValueForField, saveDefaultValueForField } from "./fields";

/** Build a SpaceProperty of `type` whose `value` JSON encodes the given config. */
const prop = (type: string, config?: Record<string, unknown>): SpaceProperty => ({
  name: "field",
  type,
  value: config === undefined ? undefined : JSON.stringify(config),
});

describe("defaultValueForField — number kind (presence, not truthiness)", () => {
  // The bug: `if (value)` dropped a real 0 in favor of the configured default.
  it("returns a supplied 0 instead of collapsing to the default", () => {
    const field = prop("number", { default: 42 });
    expect(defaultValueForField(field, 0)).toBe(0);
  });

  it("returns other supplied numbers as-is", () => {
    const field = prop("number", { default: 42 });
    expect(defaultValueForField(field, 7)).toBe(7);
    expect(defaultValueForField(field, -3)).toBe(-3);
  });

  it("falls through to the configured default when value is undefined", () => {
    const field = prop("number", { default: 42 });
    expect(defaultValueForField(field, undefined)).toBe(42);
    expect(defaultValueForField(field)).toBe(42);
  });

  it("falls through to the configured default when value is null", () => {
    const field = prop("number", { default: 42 });
    expect(defaultValueForField(field, null)).toBe(42);
  });

  it("returns undefined when value is absent and there is no default", () => {
    expect(defaultValueForField(prop("number"))).toBeUndefined();
    expect(defaultValueForField(prop("number", {}))).toBeUndefined();
  });

  it("returns a supplied 0 even when there is no configured default", () => {
    expect(defaultValueForField(prop("number"), 0)).toBe(0);
  });
});

describe("defaultValueForField — boolean kind (presence, not truthiness)", () => {
  // The bug: `if (value)` dropped a real `false` in favor of the configured default.
  it("returns a supplied false instead of collapsing to the default", () => {
    const field = prop("boolean", { default: true });
    expect(defaultValueForField(field, false)).toBe(false);
  });

  it("returns a supplied true as-is", () => {
    const field = prop("boolean", { default: false });
    expect(defaultValueForField(field, true)).toBe(true);
  });

  it("falls through to the configured default when value is undefined / null", () => {
    expect(defaultValueForField(prop("boolean", { default: true }), undefined)).toBe(true);
    expect(defaultValueForField(prop("boolean", { default: true }), null)).toBe(true);
    expect(defaultValueForField(prop("boolean", { default: true }))).toBe(true);
  });

  it("returns a supplied false even when there is no configured default", () => {
    expect(defaultValueForField(prop("boolean"), false)).toBe(false);
  });
});

describe("defaultValueForField — string / text kind (length-based presence)", () => {
  it("returns a supplied non-empty string", () => {
    const field = prop("text", { default: "fallback" });
    expect(defaultValueForField(field, "hello")).toBe("hello");
  });

  it("falls through to the default for an empty string (treated as no value)", () => {
    const field = prop("text", { default: "fallback" });
    expect(defaultValueForField(field, "")).toBe("fallback");
  });

  it("falls through to the default for undefined", () => {
    const field = prop("text", { default: "fallback" });
    expect(defaultValueForField(field, undefined)).toBe("fallback");
    expect(defaultValueForField(field)).toBe("fallback");
  });

  it("returns undefined for an empty/absent value with no configured default", () => {
    expect(defaultValueForField(prop("text"), "")).toBeUndefined();
    expect(defaultValueForField(prop("text"))).toBeUndefined();
  });
});

describe("defaultValueForField — option kind", () => {
  it("returns a supplied non-empty option value", () => {
    const field = prop("option", { default: "a" });
    expect(defaultValueForField(field, "b")).toBe("b");
  });

  it("falls through to the configured default for an empty/absent value", () => {
    const field = prop("option", { default: "a" });
    expect(defaultValueForField(field, "")).toBe("a");
    expect(defaultValueForField(field)).toBe("a");
  });
});

describe("defaultValueForField — $space path-default branch", () => {
  it("returns the supplied path when default is $space and a path is given", () => {
    const field = prop("text", { default: "$space" });
    expect(defaultValueForField(field, "", "notes/Project")).toBe("notes/Project");
  });

  it("returns the literal $space when default is $space but no path is given", () => {
    const field = prop("text", { default: "$space" });
    expect(defaultValueForField(field, "")).toBe("$space");
  });

  it("ignores the $space path branch when a value is actually supplied", () => {
    const field = prop("text", { default: "$space" });
    // A present non-empty value wins before the default branch is consulted.
    expect(defaultValueForField(field, "explicit", "notes/Project")).toBe("explicit");
  });

  it("does not treat a non-$space default as a path", () => {
    const field = prop("text", { default: "plain" });
    expect(defaultValueForField(field, "", "notes/Project")).toBe("plain");
  });
});

describe("saveDefaultValueForField", () => {
  it("merges the new default into the field's parsed value JSON", () => {
    const field = prop("number", { default: 1, alias: "Score" });
    const saved = saveDefaultValueForField(field, 5);
    expect(JSON.parse(saved.value as string)).toMatchObject({ default: 5, alias: "Score" });
    // Other field metadata is preserved.
    expect(saved.name).toBe("field");
    expect(saved.type).toBe("number");
  });

  it("can persist a falsy default (0) round-tripped by defaultValueForField", () => {
    const field = prop("number", { default: 1 });
    const saved = saveDefaultValueForField(field, 0);
    expect(JSON.parse(saved.value as string).default).toBe(0);
    // And the persisted 0 is then returned as the configured default.
    expect(defaultValueForField(saved, undefined)).toBe(0);
  });
});
