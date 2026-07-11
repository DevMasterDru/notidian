
export const safelyParseJSON = (json: string) => {
  // This function cannot be optimised, it's best to
  // keep it small!
  let parsed;
  try {
    parsed = JSON.parse(json);
  } catch (e) {
    //
    // Oh well, but whatever...
  }

  return parsed; // Could be undefined!
};

// bd Notidian-gz66 — prototype-pollution scrub for a parsed JSON map, applied at
// the frame load boundary (frameToNode in src/core/utils/frames/nodes.ts).
//
// JSON.parse revives an object key literally named "__proto__" as a REAL OWN
// enumerable DATA property (and likewise materializes own "constructor" /
// "prototype" keys) — unlike an object literal, where `{ __proto__: v }` routes
// through Object.prototype's __proto__ SETTER and leaves no own key. In the frame
// runtime such an own key is EXECUTABLE: buildExecutable's applyFunctionToObject
// compiles each map value with `new Function` and writes it back by key, which for
// "__proto__" sets the exec object's PROTOTYPE to the compiled fn (and for
// constructor/prototype creates an own shadowing key); the runner then reads it
// back — `codeBlockStore[key]?.call(environment)` — and executes it with $api (full
// vault write authority) in scope. Stripping these own keys the instant a frame map
// is parsed guarantees they can never enter a materialized node, reach the executor,
// or be .call()ed.
//
// This is deliberately NOT folded into safelyParseJSON: non-frame callers keep the
// exact legacy parse. It is SHALLOW: the only sink is a TOP-LEVEL key of a
// code-bearing map (applyFunctionToObject enumerates a single level, and a nested
// "__proto__" is JSON.stringify'd back as a QUOTED property and re-evaluated as
// inert data, never the proto setter). Non-object inputs (undefined/null/primitive/
// array) pass through unchanged so the safelyParseJSON undefined-on-failure contract
// and array columns both survive. Returns a FRESH object; never mutates its input.
const PROTOTYPE_POLLUTION_KEYS = ["__proto__", "constructor", "prototype"];
export const scrubPrototypeKeys = <T>(value: T): T => {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return value;
  }
  const clean: { [key: string]: unknown } = {};
  // Object.keys enumerates the JSON.parse-revived own "__proto__" (own +
  // enumerable), so skipping the dangerous keys here removes them from the copy.
  for (const key of Object.keys(value as { [key: string]: unknown })) {
    if (PROTOTYPE_POLLUTION_KEYS.indexOf(key) !== -1) continue;
    clean[key] = (value as { [key: string]: unknown })[key];
  }
  return clean as T;
};
