// ===========================================================================
// DEPTH (Long Autonomous Mode, Notidian-pb3f) — adversarial + characterization
// net for the pure object-surgery helpers in src/core/utils/objects.ts.
//
// WHAT THEY ARE. These helpers are pure data-shaping primitives with ZERO prior
// coverage. Two of them are on the live render path for frame state:
//   - deepOmit is used by frame.ts `executableChanged(a, b)` to strip volatile
//     exec/parent fields off a FrameExecutable before a deep-equality dirty
//     check — i.e. it decides whether a frame re-renders. A silent change to its
//     reshape behavior changes when frames repaint.
//   - renameKey is used by FrameInstanceContext.tsx `saveState` as
//     `renameKey(newState, "$root", _exec.id)` to relabel the synthetic "$root"
//     node of freshly-computed frame state to the executable's real id, IN
//     PLACE, before the state is applied. A regression here mislabels or drops a
//     node's computed state.
// The rest (replaceKeys / replaceKeysByValue / createAutoObject / removeKey /
// arrayToObject / applyFunctionToObject) are general object surgery whose subtle
// edges (collision determinism, prototype-shaped keys, Proxy auto-vivification)
// are easy to silently regress in a refactor.
//
// METHOD (AGENTS.md Long Autonomous Mode). Every assertion pins LIVE behavior,
// characterized first with throwaway node probes against the real lodash that
// ships in this repo. Where current behavior is the correct contract we assert
// it as the contract; where it is a sharp, surprising edge we label it and pin
// it so a refactor cannot move it silently. None of the characterized behavior
// is a global-corrupting defect (the adversarial prototype-pollution cases all
// prove Object.prototype stays clean), so these stay characterization tests, not
// regression flags. The two genuinely-surprising-but-not-dangerous edges
// (deepOmit's sparse-array hole on numeric-key omit; replaceKeys silently
// dropping a value remapped onto "__proto__") are documented inline.
//
// Pure offline net — testEnvironment:node (jest.config.js default), no Obsidian
// mocks, no jsdom.
// ===========================================================================

import {
  applyFunctionToObject,
  arrayToObject,
  createAutoObject,
  deepOmit,
  removeKey,
  renameKey,
  replaceKeys,
  replaceKeysByValue,
} from "./objects";

// ---------------------------------------------------------------------------
// Global safety guard: after the whole suite (which deliberately throws
// prototype-pollution-shaped keys at every helper), Object.prototype must be
// pristine. If any helper had corrupted the global prototype, this fails loudly.
// ---------------------------------------------------------------------------
afterAll(() => {
  expect(Object.prototype.hasOwnProperty.call(Object.prototype, "polluted")).toBe(
    false
  );
  expect((Object.prototype as any).polluted).toBeUndefined();
  expect(({} as any).polluted).toBeUndefined();
});

describe("renameKey", () => {
  it("renames an own key in place (mutation, no return value)", () => {
    const obj: { [k: string]: any } = { old: 1, keep: 2 };
    const result = renameKey(obj, "old", "new");
    expect(result).toBeUndefined(); // returns nothing; pure side effect
    expect(obj).toEqual({ new: 1, keep: 2 });
    expect("old" in obj).toBe(false);
  });

  it("is a no-op when oldKey === newKey (does not touch the property)", () => {
    const obj: { [k: string]: any } = { x: 1 };
    renameKey(obj, "x", "x");
    expect(obj).toEqual({ x: 1 });
    expect(Object.prototype.hasOwnProperty.call(obj, "x")).toBe(true);
  });

  it("is a no-op when oldKey is absent (does not invent newKey)", () => {
    const obj: { [k: string]: any } = { x: 1 };
    renameKey(obj, "missing", "y");
    expect(obj).toEqual({ x: 1 });
    expect("y" in obj).toBe(false);
  });

  it("only considers OWN properties — an inherited oldKey is not renamed", () => {
    const base = { inherited: 7 };
    const child: { [k: string]: any } = Object.create(base);
    renameKey(child, "inherited", "moved");
    // inherited stays on the prototype; nothing copied onto the child
    expect(Object.prototype.hasOwnProperty.call(child, "moved")).toBe(false);
    expect(child.inherited).toBe(7); // still visible via prototype chain
  });

  it("null / undefined object guard returns undefined without throwing", () => {
    expect(renameKey(null as any, "a", "b")).toBeUndefined();
    expect(renameKey(undefined as any, "a", "b")).toBeUndefined();
  });

  it("preserves the full property DESCRIPTOR, not just the value", () => {
    const obj: { [k: string]: any } = {};
    Object.defineProperty(obj, "old", {
      value: 42,
      enumerable: false,
      writable: false,
      configurable: true,
    });
    renameKey(obj, "old", "new");
    const desc = Object.getOwnPropertyDescriptor(obj, "new")!;
    expect(desc).toEqual({
      value: 42,
      enumerable: false,
      writable: false,
      configurable: true,
    });
    expect("old" in obj).toBe(false);
  });

  it("preserves an accessor (getter) descriptor rather than snapshotting its value", () => {
    const obj: { [k: string]: any } = {};
    let backing = 7;
    Object.defineProperty(obj, "foo", {
      configurable: true,
      enumerable: true,
      get() {
        return backing;
      },
    });
    renameKey(obj, "foo", "bar");
    expect(obj.bar).toBe(7);
    backing = 99; // a snapshot would have frozen at 7; a live getter follows
    expect(obj.bar).toBe(99);
    expect(Object.prototype.hasOwnProperty.call(obj, "foo")).toBe(false);
  });

  it("collision: renaming onto an existing key overwrites the target with the source value", () => {
    const obj: { [k: string]: any } = { a: 1, b: 2 };
    renameKey(obj, "a", "b"); // a's value wins, a is deleted
    expect(obj).toEqual({ b: 1 });
  });

  it("render-path shape: relabels a '$root' frame-state node to a real exec id (FrameInstanceContext.saveState)", () => {
    const newState: { [k: string]: any } = {
      $root: { props: { value: "computed" }, actions: {} },
      child: { props: {} },
    };
    renameKey(newState, "$root", "frame-exec-id-123");
    expect("$root" in newState).toBe(false);
    expect(newState["frame-exec-id-123"]).toEqual({
      props: { value: "computed" },
      actions: {},
    });
    expect(newState.child).toEqual({ props: {} });
  });

  it("ADVERSARIAL: renaming a real key TO '__proto__' does not corrupt Object.prototype", () => {
    const obj: { [k: string]: any } = { real: 1 };
    renameKey(obj, "real", "__proto__");
    // defineProperty creates a genuine own '__proto__' data property (it bypasses
    // the magic __proto__ setter), so no global pollution.
    expect(Object.getPrototypeOf({})).toBe(Object.prototype);
    expect(({} as any).real).toBeUndefined();
  });
});

describe("replaceKeys", () => {
  it("remaps mapped keys and passes unmapped keys through unchanged", () => {
    const out = replaceKeys({ a: 1, keep: 9 }, { a: "Z" });
    expect(out).toEqual({ Z: 1, keep: 9 });
  });

  it("returns a NEW object and does not mutate the input", () => {
    const input = { a: 1 };
    const out = replaceKeys(input, { a: "b" });
    expect(out).not.toBe(input);
    expect(input).toEqual({ a: 1 });
  });

  it("collision determinism: two source keys mapped to the same target is LAST-WRITE-WINS in source for-in order", () => {
    // a and b both map to "X"; b is enumerated after a, so b's value (2) wins.
    const out = replaceKeys({ a: 1, b: 2, c: 3 }, { a: "X", b: "X" });
    expect(out).toEqual({ X: 2, c: 3 });
  });

  it("collision determinism: an unmapped key colliding with a remapped target — original enumeration order decides", () => {
    // "k" is unmapped (stays "k"); "a" -> "k". for-in visits a before k, so the
    // later (unmapped) "k" overwrites a's remapped value.
    const out = replaceKeys({ a: 1, k: 2 }, { a: "k" });
    expect(out).toEqual({ k: 2 });
  });

  it("SHARP EDGE: enumerates with `for..in`, so it ALSO copies INHERITED enumerable keys (unlike renameKey/applyFunctionToObject which guard with hasOwnProperty)", () => {
    const base = { inherited: 99 };
    const child: { [k: string]: any } = Object.create(base);
    child.own = 5;
    const out = replaceKeys(child, { own: "renamed" });
    // inherited is enumerated by for..in and copied (with its key unmapped);
    // pin this divergence from the own-only helpers in this same module.
    expect(out).toEqual({ renamed: 5, inherited: 99 });
  });

  it("a remapped value reaching an own '__proto__' source key uses the safe target name", () => {
    // An OWN enumerable __proto__ (created via defineProperty) IS seen by for-in.
    const src: { [k: string]: any } = {};
    Object.defineProperty(src, "__proto__", {
      value: "v",
      enumerable: true,
      configurable: true,
      writable: true,
    });
    const out = replaceKeys(src, { ["__proto__"]: "renamed" });
    expect(out).toEqual({ renamed: "v" });
  });

  it("ADVERSARIAL: 'constructor'/'prototype' source keys remapped to safe targets do not touch the global prototype", () => {
    const out = replaceKeys(
      { constructor: 1, prototype: 2, normal: 3 },
      { constructor: "ctor", prototype: "proto" }
    );
    expect(out).toEqual({ ctor: 1, proto: 2, normal: 3 });
    expect(Object.getPrototypeOf({})).toBe(Object.prototype);
    expect(({} as any).ctor).toBeUndefined();
  });

  it("ADVERSARIAL: remapping a value ONTO '__proto__' silently DROPS the value (proto-set semantics) but never pollutes Object.prototype", () => {
    // newObject["__proto__"] = 1 invokes the magic __proto__ setter; since 1 is
    // not an object the prototype is left unchanged and NO own "__proto__" data
    // property is created — the value is silently lost. This is a sharp,
    // surprising edge characterized here so a refactor (e.g. to Object.create or
    // a Map) cannot change it without a failing test.
    const out = replaceKeys({ a: 1 }, { a: "__proto__" });
    expect(Object.prototype.hasOwnProperty.call(out, "__proto__")).toBe(false);
    expect(Object.getPrototypeOf(out)).toBe(Object.prototype);
    expect(Object.getPrototypeOf({})).toBe(Object.prototype);
    expect(({} as any).a).toBeUndefined();
  });
});

describe("replaceKeysByValue", () => {
  it("remaps by VALUE: a key whose mapped value matches an input key is renamed back to the map key", () => {
    // map {db: "Display"} means: the input key "Display" becomes "db".
    const out = replaceKeysByValue({ Display: 1, other: 2 }, { db: "Display" });
    expect(out).toEqual({ db: 1, other: 2 });
  });

  it("reversed-map collision determinism: when two map entries share a value, the LAST map entry wins the reversal", () => {
    // reversedObject2 is built by `reversedObject2[object2[key]] = key` in map
    // for-in order: {a:"X", b:"X"} reverses to {X:"b"} (b overwrites a). So an
    // input key "X" is renamed to "b"; "Y" is unmapped and passes through.
    const out = replaceKeysByValue({ X: 1, Y: 2 }, { a: "X", b: "X" });
    expect(out).toEqual({ b: 1, Y: 2 });
  });

  it("is an exact inverse of replaceKeys for an injective (bijective) map", () => {
    const map = { a: "alpha", b: "beta" };
    const original = { a: 1, b: 2 };
    const renamed = replaceKeys(original, map); // {alpha:1, beta:2}
    const back = replaceKeysByValue(renamed, map); // {a:1, b:2}
    expect(renamed).toEqual({ alpha: 1, beta: 2 });
    expect(back).toEqual(original);
  });
});

describe("deepOmit", () => {
  it("omits a top-level key and accepts a single string (not just an array) of keys", () => {
    expect(deepOmit({ a: 1, b: 2 }, "b")).toEqual({ a: 1 });
    expect(deepOmit({ a: 1, b: 2, c: 3 }, ["b", "c"])).toEqual({ a: 1 });
  });

  it("recurses: omits the named key at every depth", () => {
    const input = { keep: 1, drop: 9, nested: { keep: 2, drop: 8, deeper: { drop: 7, keep: 3 } } };
    expect(deepOmit(input, "drop")).toEqual({
      keep: 1,
      nested: { keep: 2, deeper: { keep: 3 } },
    });
  });

  it("returns a new structure and does not mutate the input", () => {
    const input = { a: 1, n: { b: 2, drop: 3 } };
    const out = deepOmit(input, "drop");
    expect(out).toEqual({ a: 1, n: { b: 2 } });
    expect(input).toEqual({ a: 1, n: { b: 2, drop: 3 } }); // untouched
    expect(out.n).not.toBe(input.n);
  });

  it("CHARACTERIZATION: lodash _.transform PRESERVES arrays as arrays (it does NOT reshape array-as-object)", () => {
    // The bead hypothesized an "array-becomes-object reshape"; the live behavior
    // of the lodash that ships here is the opposite — _.transform seeds its
    // accumulator from the source's type, so an array stays an Array (constructor
    // === Array) at every depth. Pin this so a future lodash bump or hand-rolled
    // replacement can't silently turn frame array fields into plain objects.
    const out = deepOmit({ a: [10, 20, 30], b: 1 }, "b");
    expect(Array.isArray(out.a)).toBe(true);
    expect(out.a.constructor).toBe(Array);
    expect(out.a).toEqual([10, 20, 30]);
  });

  it("CHARACTERIZATION: a top-level array input stays an array", () => {
    const out = deepOmit([{ x: 1 }, { x: 2 }] as any, "nope");
    expect(Array.isArray(out)).toBe(true);
    expect(out).toEqual([{ x: 1 }, { x: 2 }]);
  });

  it("CHARACTERIZATION: omitting a key INSIDE array elements keeps the array an array", () => {
    const out = deepOmit({ items: [{ id: 1, drop: 9 }, { id: 2, drop: 8 }] }, "drop");
    expect(Array.isArray(out.items)).toBe(true);
    expect(out.items).toEqual([{ id: 1 }, { id: 2 }]);
  });

  it("SHARP EDGE: omitting a numeric-string key that matches an array index leaves a sparse hole (kept length, null on serialize)", () => {
    // keysToOmit "1" matches the array's index "1"; _.transform skips it but the
    // array length is unchanged, leaving a hole. This is surprising but pinned:
    // a refactor must not quietly compact the array (which would shift indices).
    const out = deepOmit({ arr: ["a", "b", "c"] }, "1");
    expect(Array.isArray(out.arr)).toBe(true);
    expect(out.arr.length).toBe(3);
    expect(1 in out.arr).toBe(false); // genuine hole, not the value undefined
    expect(JSON.parse(JSON.stringify(out.arr))).toEqual(["a", null, "c"]);
  });

  it("render-path shape: strips the volatile exec/parent fields used by executableChanged()", () => {
    // Mirrors frame.ts executableChanged: the deep-equality dirty check ignores
    // these fields. Pin that they are removed at the top level here.
    const exec = {
      id: "x",
      type: "group",
      props: { a: 1 },
      execProps: { a: () => 1 },
      execStyles: {},
      execActions: {},
      execPropsOptions: {},
      parent: { id: "p" },
    };
    const stripped = deepOmit(exec, [
      "execPropsOptions",
      "execProps",
      "execStyles",
      "execActions",
      "parent",
    ]);
    expect(stripped).toEqual({ id: "x", type: "group", props: { a: 1 } });
  });

  it("ADVERSARIAL: object whose own keys are prototype-shaped is omitted/copied without polluting Object.prototype", () => {
    const input: { [k: string]: any } = { keep: 1 };
    Object.defineProperty(input, "constructor", {
      value: "evil",
      enumerable: true,
      configurable: true,
      writable: true,
    });
    const out = deepOmit(input, "nothing");
    expect(out.keep).toBe(1);
    expect(Object.getPrototypeOf({})).toBe(Object.prototype);
    expect(({} as any).keep).toBeUndefined();
  });
});

describe("createAutoObject", () => {
  it("carries the isAutoObject sentinel", () => {
    const ao = createAutoObject();
    expect(ao.isAutoObject).toBe(true);
  });

  it("seeds from a source object and still flags isAutoObject", () => {
    const ao = createAutoObject({ a: 1, b: 2 });
    expect(ao.a).toBe(1);
    expect(ao.b).toBe(2);
    expect(ao.isAutoObject).toBe(true);
  });

  it("auto-vivifies a chain of nested auto-objects on GET", () => {
    const ao = createAutoObject();
    const leaf = ao.a.b.c;
    expect(leaf.isAutoObject).toBe(true);
    // the intermediate links were materialized as auto-objects on the target
    expect(ao.a.isAutoObject).toBe(true);
    expect(ao.a.b.isAutoObject).toBe(true);
  });

  it("a vivified node persists (same reference on re-access)", () => {
    const ao = createAutoObject();
    const first = ao.x;
    const second = ao.x;
    expect(first).toBe(second);
  });

  it("SET wraps an assigned PLAIN object into an auto-object", () => {
    const ao = createAutoObject();
    ao.plain = { x: 1, nested: { y: 2 } };
    expect(ao.plain.isAutoObject).toBe(true);
    expect(ao.plain.x).toBe(1);
  });

  it("SET does NOT re-wrap a value that is already an auto-object (sentinel short-circuit preserves identity)", () => {
    const ao = createAutoObject();
    const existing = createAutoObject({ y: 5 });
    ao.nested = existing;
    expect(ao.nested).toBe(existing); // same reference, not re-proxied
    expect(ao.nested.y).toBe(5);
  });

  it("SET passes primitives through untouched", () => {
    const ao = createAutoObject();
    ao.n = 42;
    ao.s = "str";
    ao.b = false;
    ao.nul = null;
    expect(ao.n).toBe(42);
    expect(ao.s).toBe("str");
    expect(ao.b).toBe(false);
    // null is falsy so the set wrapper leaves it; GET then auto-vivifies because
    // null is not `in target`? No: the key IS in target, value null -> returns null.
    expect(ao.nul).toBe(null);
  });

  it("a key that was explicitly set is returned as-is, not re-vivified", () => {
    const ao = createAutoObject();
    ao.count = 0; // falsy but present
    expect(ao.count).toBe(0); // 'count' in target -> returns the stored 0
  });
});

describe("removeKey", () => {
  it("deletes the key IN PLACE and returns the same object reference", () => {
    const obj = { a: 1, b: 2 };
    const out = removeKey(obj, "a");
    expect(out).toBe(obj);
    expect(out).toEqual({ b: 2 });
  });

  it("is a silent no-op for an absent key", () => {
    const obj = { a: 1 };
    expect(removeKey(obj, "missing")).toEqual({ a: 1 });
  });
});

describe("arrayToObject", () => {
  it("keys an array of objects by the chosen field", () => {
    const out = arrayToObject([{ id: "a", v: 1 }, { id: "b", v: 2 }], "id");
    expect(out).toEqual({ a: { id: "a", v: 1 }, b: { id: "b", v: 2 } });
  });

  it("duplicate key: last element wins", () => {
    const out = arrayToObject([{ id: "a", v: 1 }, { id: "a", v: 2 }], "id");
    expect(out).toEqual({ a: { id: "a", v: 2 } });
  });

  it("empty array yields an empty object", () => {
    expect(arrayToObject([], "id")).toEqual({});
  });
});

describe("applyFunctionToObject", () => {
  it("maps each own value through the function, exposing both value and key", () => {
    const out = applyFunctionToObject({ a: 1, b: 2 }, (v, k) => `${k}:${v * 10}`);
    expect(out).toEqual({ a: "a:10", b: "b:20" });
  });

  it("returns a new object and ignores inherited keys", () => {
    const base = { inherited: 99 };
    const child: { [k: string]: any } = Object.create(base);
    child.own = 5;
    const out = applyFunctionToObject(child, (v) => v);
    expect(out).toEqual({ own: 5 });
    expect("inherited" in out).toBe(false);
  });
});
