import { defaultPredicate } from "shared/schemas/predicate";
import { safelyParseJSON } from "shared/utils/json";
import { Predicate } from "shared/types/predicate";
import { defaultPredicateForSchema, validatePredicate } from "./predicate";

// ===========================================================================
// Notidian-2y21 — VIEW-CUSTOMIZATION PREDICATE round-trip durability (unit).
//
// The per-DB view customizations the owner reported resetting — hidden props
// (colsHidden), custom column widths (colsSize), column order (colsOrder), plus
// frozenColumnCount / colsHeaderDisplay / colsDataAnchor / colsWrap — all live in
// the view's PREDICATE JSON (m_schema.predicate). Persistence is a pure cycle:
//
//   SAVE  (ContextEditorContext.savePredicate):
//     JSON.stringify(validatePredicate({ ...prev, ...edit }, defPredicate))
//   LOAD  (ContextEditorContext.parsePredicate):
//     validatePredicate(safelyParseJSON(stored), defPredicate)
//
// This net pins that cycle: a configured predicate serialized then re-parsed must
// return the SAME customizations, and the stored JSON must round-trip byte-stably
// (so a no-op reload never rewrites/loses it). If validatePredicate ever dropped a
// cols* field (it has regressed this way before — chart/subItems, Notidian-4j7),
// these assertions catch it offline without the engine.
// ===========================================================================

// Reproduce the production save (savePredicate) and load (parsePredicate) seams
// exactly, minus the React state plumbing.
const saveCycle = (
  prev: Partial<Predicate>,
  edit: Partial<Predicate>,
  defPredicate: Predicate
): string => {
  const merged = { ...defPredicate, ...prev, ...edit } as Predicate;
  return JSON.stringify(validatePredicate(merged, defPredicate));
};
const loadCycle = (stored: string, defPredicate: Predicate): Predicate =>
  validatePredicate(safelyParseJSON(stored), defPredicate);

describe("Notidian-2y21: view-customization predicate round-trips through save/load", () => {
  const defPredicate = defaultPredicateForSchema({
    id: "files",
    name: "Files",
    type: "db",
  } as any);

  it("hidden props + column widths + column order survive a save -> reload", () => {
    const stored = saveCycle(
      {},
      {
        colsHidden: ["Secret", "Internal"],
        colsSize: { Name: 240, Count: 80, "O'Brien": 100 },
        colsOrder: ["Name", "Count", "Status"],
        frozenColumnCount: 2,
      },
      defPredicate
    );

    const loaded = loadCycle(stored, defPredicate);

    expect(loaded.colsHidden).toEqual(["Secret", "Internal"]);
    expect(loaded.colsSize).toEqual({ Name: 240, Count: 80, "O'Brien": 100 });
    expect(loaded.colsOrder).toEqual(["Name", "Count", "Status"]);
    expect(loaded.frozenColumnCount).toBe(2);
  });

  it("the stored predicate JSON is byte-STABLE across an idle reload (no silent rewrite/loss)", () => {
    const stored1 = saveCycle(
      {},
      {
        colsHidden: ["Secret"],
        colsSize: { Name: 240 },
        colsOrder: ["Name", "Count"],
        colsHeaderDisplay: { Name: "text" },
        colsDataAnchor: { Count: "center" },
        colsWrap: { Name: "wrap" },
        frozenColumnCount: 1,
      },
      defPredicate
    );

    // An idle reload: parse then re-serialize with no edit. The bytes must match.
    const reloaded = loadCycle(stored1, defPredicate);
    const stored2 = JSON.stringify(validatePredicate(reloaded, defPredicate));

    expect(stored2).toBe(stored1);
  });

  it("editing ONE customization (a width) preserves the others (hidden + order)", () => {
    const stored1 = saveCycle(
      {},
      {
        colsHidden: ["Secret"],
        colsSize: { Name: 200 },
        colsOrder: ["Name", "Count"],
      },
      defPredicate
    );
    const prev = loadCycle(stored1, defPredicate);

    // Owner drags a column wider — only colsSize changes; the spread in
    // savePredicate ({ ...predicate, ...newPredicate }) must keep the rest.
    const stored2 = saveCycle(prev, { colsSize: { Name: 360 } }, defPredicate);
    const loaded = loadCycle(stored2, defPredicate);

    expect(loaded.colsSize).toEqual({ Name: 360 });
    expect(loaded.colsHidden).toEqual(["Secret"]); // preserved
    expect(loaded.colsOrder).toEqual(["Name", "Count"]); // preserved
  });

  it("adversarially-quoted column names in cols* survive the JSON round-trip", () => {
    const stored = saveCycle(
      {},
      {
        colsHidden: ['a"b', "c'd"],
        colsSize: { 'q"x': 120, "O'Brien": 90 },
        colsOrder: ["Name", 'a"b', "c'd"],
      },
      defPredicate
    );
    const loaded = loadCycle(stored, defPredicate);

    expect(loaded.colsHidden).toEqual(['a"b', "c'd"]);
    expect(loaded.colsSize).toEqual({ 'q"x': 120, "O'Brien": 90 });
    expect(loaded.colsOrder).toEqual(["Name", 'a"b', "c'd"]);
  });

  it("an empty/default predicate save does NOT null a previously-stored layout when merged", () => {
    // Guards the first-save / empty-cols overwrite worry (root-cause Path B): the
    // savePredicate spread merges over the PRIOR predicate, so a partial edit that
    // omits cols* must not blank them.
    const stored1 = saveCycle(
      {},
      { colsHidden: ["Secret"], colsSize: { Name: 240 }, colsOrder: ["Name"] },
      defPredicate
    );
    const prev = loadCycle(stored1, defPredicate);

    // A partial edit that touches an unrelated field (a filter) — cols* omitted.
    const stored2 = saveCycle(
      prev,
      { filters: [{ field: "Count", fn: "isGreatThan", value: "0", fType: "number" }] },
      defPredicate
    );
    const loaded = loadCycle(stored2, defPredicate);

    expect(loaded.colsHidden).toEqual(["Secret"]);
    expect(loaded.colsSize).toEqual({ Name: 240 });
    expect(loaded.colsOrder).toEqual(["Name"]);
    expect(loaded.filters).toHaveLength(1);
  });
});
