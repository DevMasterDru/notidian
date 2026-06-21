/**
 * STRUCTURAL INVARIANT LOCK for the owner-facing formula function registry —
 * Notidian-m0n3.
 *
 * `formulasInfos` (formulasInfos.ts) is the single source of help + autocomplete
 * metadata the owner sees in the formula editor. It is consumed two ways that
 * BOTH trust its shape implicitly and have no other guard:
 *
 *  - syntax.ts:101 — `autocomplete: Object.keys(formulasInfos)` feeds the
 *    highlighter / autocompleter the *object keys*. The picker (FormulaEditor.tsx)
 *    reads `formulasInfos[f.name]` and renders `entry.name`, `entry.args`,
 *    `entry.returnType`. So the KEY is the lookup/insert token while NAME is the
 *    rendered label — if they ever disagree, the picker shows one function but
 *    inserts another.
 *  - i18n.dynamicKeys.test.ts already pins that the i18n key space equals
 *    `Object.values(formulasInfos).map(f => f.name)` AND notes "the top-level
 *    `formulasInfos` keys equal those `.name` values" — an assumption that lives
 *    only in a comment there. This test makes that assumption an enforced fact.
 *
 * The registry is 60 hand-maintained entries with heavy copy-paste between
 * siblings (every date fn, every list fn). The realistic drift is a copy-paste
 * slip: a pasted entry whose KEY was renamed but `name`/`fn` wasn't (key != name,
 * or fn points at the donor function — "help describes X, inserts Y"), or a
 * dropped field (a missing `returnType`, exactly the `dateSubtract` defect this
 * bead fixed). Each of those ships as an owner-visible defect with NO compile
 * error, because `returnType` is `?:` optional in the type and the keys are an
 * open `Record<string, FormulaInfo>`.
 *
 * This concern is PURE and offline-verifiable, so it is pinned as a real test
 * (the formula-side sibling of the filterFnTypes <-> filterFnLabels parity lock,
 * Notidian-sp1z). It is a characterization lock — it asserts the contract the
 * consumers already depend on, it does not change behaviour.
 */
import { formulasInfos } from "./formulasInfos";

const entries = Object.entries(formulasInfos);
const registeredNames = new Set(Object.keys(formulasInfos));

describe("formulasInfos structural invariant lock", () => {
  it("registry is non-empty (a wiped/renamed export would silently empty the picker)", () => {
    expect(entries.length).toBeGreaterThan(0);
  });

  // (1) The object KEY is the lookup/insert token; entry.name is the rendered
  //     label. They MUST be identical or the picker mislabels what it inserts.
  describe("(1) object key === entry.name", () => {
    it.each(entries)("key %s matches its name field", (key, entry) => {
      expect(entry.name).toBe(key);
    });
  });

  // (2) entry.fn is the function this entry resolves to. A non-empty string that
  //     resolves to a real registered name catches a dangling / wrong fn pointer
  //     (the "help describes X but inserts Y" defect). Today every fn === its own
  //     name; the contract is only that fn names a function the registry knows.
  describe("(2) entry.fn is a non-empty string resolving to a registered name", () => {
    it.each(entries)("fn for %s is a non-empty string", (_key, entry) => {
      expect(typeof entry.fn).toBe("string");
      expect(entry.fn.length).toBeGreaterThan(0);
    });

    it.each(entries)("fn for %s resolves to an existing registry entry", (_key, entry) => {
      expect(registeredNames.has(entry.fn)).toBe(true);
    });
  });

  // (3) returnType drives the type shown in help and the type-checking of nested
  //     formulas; category groups the entry in the picker. Both must be present
  //     non-empty strings (returnType is `?:` optional in the type, so a dropped
  //     one — the dateSubtract defect — compiles fine and must be caught here).
  describe("(3) returnType is a non-empty string and category is present", () => {
    it.each(entries)("returnType for %s is a non-empty string", (_key, entry) => {
      expect(typeof entry.returnType).toBe("string");
      expect((entry.returnType ?? "").trim().length).toBeGreaterThan(0);
    });

    it.each(entries)("category for %s is a non-empty string", (_key, entry) => {
      expect(typeof entry.category).toBe("string");
      expect(entry.category.trim().length).toBeGreaterThan(0);
    });
  });

  // (4) args drives the parameter help / signature the owner reads. It must be an
  //     array; each arg needs a string name and an array `types` (so a malformed
  //     half-edited arg is caught before it renders a blank/undefined param row).
  //     `types` MAY be empty only for the variadic placeholder arg (name "...",
  //     e.g. ifs/lets), which is the registry's existing convention; every other
  //     arg's types must be non-empty.
  describe("(4) args is an array of well-formed { name, types } params", () => {
    it.each(entries)("args for %s is an array", (_key, entry) => {
      expect(Array.isArray(entry.args)).toBe(true);
    });

    it.each(entries)("every arg of %s has a string name and an array types", (_key, entry) => {
      for (const arg of entry.args) {
        expect(typeof arg.name).toBe("string");
        expect(arg.name.length).toBeGreaterThan(0);
        expect(Array.isArray(arg.types)).toBe(true);
      }
    });

    it.each(entries)("every non-variadic arg of %s has a non-empty types array", (_key, entry) => {
      for (const arg of entry.args) {
        if (arg.name === "...") continue; // variadic placeholder — empty types by convention
        expect(arg.types.length).toBeGreaterThan(0);
        expect(arg.types.every((t) => typeof t === "string" && t.length > 0)).toBe(true);
      }
    });
  });
});
