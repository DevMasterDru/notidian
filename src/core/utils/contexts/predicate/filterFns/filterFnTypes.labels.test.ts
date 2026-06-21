/**
 * KEY-PARITY LOCK between the predicate engine's matcher registry and the
 * owner-facing filter-builder dropdown labels — Notidian-sp1z.
 *
 * The filter-builder dropdown the owner sees is driven by TWO parallel maps that
 * nothing keeps in sync:
 *
 *  - filterFnTypes  (filterFnTypes.ts) — the row-matching function registry the
 *    predicate engine actually runs (resolved via filterReturnForCol in
 *    filter.ts). One entry per stored `filter.fn`.
 *  - filterFnLabels (filterFnLabels.ts) — the human label rendered for each fn in
 *    the filter-builder UI dropdown.
 *
 * They are in perfect sync today (same key set). But there is no structural
 * guard, so they can silently DRIFT, and EITHER direction is an owner-visible
 * defect:
 *
 *  - A matcher with NO label  -> the dropdown renders a blank/undefined option
 *    row for a fn the engine can otherwise run.
 *  - A label with NO matcher  -> a dead dropdown option that, once selected,
 *    resolves to no matcher and matches nothing.
 *  - A label that is empty / undefined (e.g. an i18n key typo that resolves to
 *    `undefined` or `''`) -> a present-but-blank dropdown row.
 *
 * This concern is PURE and offline-verifiable, so it is pinned as a real test
 * (not a runtime flag). It deliberately does NOT re-test matcher behaviour
 * (filter.test.ts) or the dispatch wiring (filterFnTypes.test.ts) — it locks ONLY
 * the cross-map contract. src is untouched (characterization, not behaviour
 * change).
 */
import { filterFnTypes } from "./filterFnTypes";
import { filterFnLabels } from "./filterFnLabels";

const typeKeys = Object.keys(filterFnTypes);
const labelKeys = Object.keys(filterFnLabels);

describe("filterFnTypes <-> filterFnLabels key-parity lock", () => {
  // ------------------------------------------------------------------ //
  // (1) The two maps cover EXACTLY the same fn keys (both directions).  //
  // ------------------------------------------------------------------ //
  describe("(1) the matcher registry and the label map cover the same fn keys", () => {
    it("every matcher in filterFnTypes has a label in filterFnLabels (no blank dropdown row)", () => {
      const missingLabels = typeKeys.filter((k) => !(k in filterFnLabels));
      expect(missingLabels).toEqual([]);
    });

    it("every label in filterFnLabels has a matcher in filterFnTypes (no dead dropdown option)", () => {
      const orphanLabels = labelKeys.filter((k) => !(k in filterFnTypes));
      expect(orphanLabels).toEqual([]);
    });

    it("the two key SETS are identical", () => {
      // Order-independent equality of the two key sets.
      expect([...typeKeys].sort()).toEqual([...labelKeys].sort());
    });
  });

  // ------------------------------------------------------------------ //
  // (2) Every label renders to a real, non-empty string.               //
  //   Catches an i18n key that resolves to undefined / '' -> a present  //
  //   but BLANK dropdown row the owner cannot read or distinguish.      //
  // ------------------------------------------------------------------ //
  describe("(2) every label is a non-empty, non-whitespace string", () => {
    it.each(labelKeys)("label for %s is a usable string", (key) => {
      const label = filterFnLabels[key];
      expect(typeof label).toBe("string");
      // A blank/whitespace-only label is an invisible dropdown row.
      expect((label ?? "").trim().length).toBeGreaterThan(0);
    });
  });

  // ------------------------------------------------------------------ //
  // (3) Every matcher entry has the shape the engine consumes, so a     //
  //   half-added registry entry (label present, matcher incomplete) is  //
  //   caught here rather than at runtime in filterReturnForCol.         //
  // ------------------------------------------------------------------ //
  describe("(3) every matcher entry has the engine-consumed shape (fn + type[] + valueType)", () => {
    it.each(typeKeys)("entry %s has a callable fn, a non-empty type[], and a string valueType", (key) => {
      const entry = filterFnTypes[key];
      expect(entry).toBeDefined();
      expect(typeof entry.fn).toBe("function");
      expect(Array.isArray(entry.type)).toBe(true);
      expect(entry.type.length).toBeGreaterThan(0);
      expect(entry.type.every((t) => typeof t === "string" && t.length > 0)).toBe(true);
      expect(typeof entry.valueType).toBe("string");
      expect(entry.valueType.length).toBeGreaterThan(0);
    });
  });
});
