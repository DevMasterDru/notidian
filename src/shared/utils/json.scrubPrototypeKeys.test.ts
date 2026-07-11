// bd Notidian-gz66 — unit net for scrubPrototypeKeys (the prototype-pollution
// scrub applied at the frame load boundary, src/shared/utils/json.ts).
//
// The attack surface is JSON.parse: it revives an object key literally named
// "__proto__" as a REAL OWN ENUMERABLE DATA property (and likewise materializes
// own "constructor"/"prototype" keys), unlike an object literal where
// `{ __proto__: v }` routes through Object.prototype's __proto__ SETTER. Such an
// own key is executable in the frame runtime (buildExecutable ->
// applyFunctionToObject stashes the compiled fn as the exec object's prototype for
// "__proto__" / as an own shadowing key for constructor|prototype; the runner reads
// it back and .call()s it with $api in scope). scrubPrototypeKeys strips those own
// keys so they can never enter a materialized frame map. It must NOT change
// safelyParseJSON's own undefined-on-failure contract for any other caller.
import { safelyParseJSON, scrubPrototypeKeys } from "./json";

describe("scrubPrototypeKeys — removes dangerous own keys from a parsed map", () => {
  it("removes an OWN __proto__ key revived by JSON.parse (the real vector)", () => {
    const parsed = JSON.parse('{"a":1,"__proto__":"evil"}');
    // precondition: JSON.parse yields an OWN __proto__ key (an object literal
    // would instead set the prototype and leave NO own key).
    expect(Object.prototype.hasOwnProperty.call(parsed, "__proto__")).toBe(true);

    const clean = scrubPrototypeKeys(parsed) as Record<string, unknown>;
    expect(Object.prototype.hasOwnProperty.call(clean, "__proto__")).toBe(false);
    expect(clean.a).toBe(1);
    // no pollution: the scrubbed map's prototype is the ordinary Object.prototype.
    expect(Object.getPrototypeOf(clean)).toBe(Object.prototype);
  });

  it("removes OWN constructor and prototype keys too", () => {
    const parsed = JSON.parse('{"keep":1,"constructor":"c","prototype":"p"}');
    expect(Object.prototype.hasOwnProperty.call(parsed, "constructor")).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(parsed, "prototype")).toBe(true);

    const clean = scrubPrototypeKeys(parsed) as Record<string, unknown>;
    expect(Object.prototype.hasOwnProperty.call(clean, "constructor")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(clean, "prototype")).toBe(false);
    expect(clean.keep).toBe(1);
    // constructor now resolves to the inherited Object, not the attacker string.
    expect((clean as { constructor: unknown }).constructor).toBe(Object);
  });

  it("preserves benign keys/values and JSON.stringify order (nodeToFrame re-serializes)", () => {
    const parsed = JSON.parse('{"z":1,"a":"two","m":[3,4],"__proto__":"x"}');
    const clean = scrubPrototypeKeys(parsed);
    expect(clean).toEqual({ z: 1, a: "two", m: [3, 4] });
    expect(JSON.stringify(clean)).toBe('{"z":1,"a":"two","m":[3,4]}');
  });

  it("passes primitives / null / undefined / arrays through unchanged (never throws)", () => {
    expect(scrubPrototypeKeys(undefined)).toBeUndefined();
    expect(scrubPrototypeKeys(null)).toBeNull();
    expect(scrubPrototypeKeys(false)).toBe(false);
    expect(scrubPrototypeKeys(0)).toBe(0);
    expect(scrubPrototypeKeys("")).toBe("");
    // arrays must survive as arrays (a JSON array column must not become an object).
    const arr = JSON.parse("[1,2,3]");
    expect(scrubPrototypeKeys(arr)).toBe(arr);
    expect(Array.isArray(scrubPrototypeKeys(JSON.parse("[]")))).toBe(true);
  });

  it("does NOT mutate its input (returns a fresh scrubbed copy)", () => {
    const parsed = JSON.parse('{"a":1,"__proto__":"evil"}');
    scrubPrototypeKeys(parsed);
    // input untouched: it still carries its own __proto__ key.
    expect(Object.prototype.hasOwnProperty.call(parsed, "__proto__")).toBe(true);
  });

  it("composes with safelyParseJSON without altering its undefined-on-failure contract", () => {
    expect(scrubPrototypeKeys(safelyParseJSON("{bad json"))).toBeUndefined();
    expect(scrubPrototypeKeys(safelyParseJSON(""))).toBeUndefined();
    expect(scrubPrototypeKeys(safelyParseJSON("null"))).toBeNull();
    const clean = scrubPrototypeKeys(
      safelyParseJSON('{"ok":1,"__proto__":"$api.deleteVault()"}')
    ) as Record<string, unknown>;
    expect(Object.prototype.hasOwnProperty.call(clean, "__proto__")).toBe(false);
    expect(clean.ok).toBe(1);
  });

  it("safelyParseJSON itself is UNCHANGED — it still returns the raw own __proto__ key", () => {
    // The scrub is intentionally NOT baked into safelyParseJSON (non-frame callers
    // keep the exact legacy parse). Pin that the boundary is the caller's choice.
    const raw = safelyParseJSON('{"ok":1,"__proto__":"evil"}');
    expect(Object.prototype.hasOwnProperty.call(raw, "__proto__")).toBe(true);
  });
});
