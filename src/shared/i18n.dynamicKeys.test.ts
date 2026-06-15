/**
 * Offline dynamic-key i18n coverage (bd Notidian-bym).
 *
 * COMPANION to `i18n.completeness.test.ts` (Notidian-wkr). That sweep validates
 * every LITERAL `i18n.<seg>.<seg>` chain in `src/`, but by construction it CANNOT
 * reach COMPUTED access — `i18n.commands[label]`, `i18n.aggregates[fn]`,
 * `i18n.formulas[name]` — where the bracket key is a runtime value, not a literal.
 * The completeness scan stops before the `[` and never sees the key.
 *
 * The risk is identical to the literal case: `src/shared/i18n.ts` exposes the
 * string table through a `Proxy` (i18n.ts:56) whose `get` trap returns `undefined`
 * — it NEVER throws — for an absent key. So a computed read like
 * `i18n.aggregates[fn]` for a `fn` that exists in the registry but not in
 * `src/shared/en.ts` silently yields `undefined`, which flows into a menu item
 * `name` / footer label as a BLANK string. tsc cannot see it (the group is typed
 * `Record<string, string>`) and the runtime never errors — only the user sees a
 * blank label.
 *
 * This test makes that bug class gate-enforceable for every computed-access site
 * whose KEY SPACE IS A STATIC, FINITE REGISTRY. For each such site we enumerate
 * the exact set of keys the code can pass and assert each resolves to a non-empty
 * string in `en.ts`. We bind the enumeration to the SAME registry the runtime
 * iterates, so adding a registry member without its i18n label fails HERE.
 *
 * --- The computed-access sites covered, and the registry each iterates ---
 *
 *  1. `i18n.commands[label]` — MakeMenu.tsx:77,79,106. `label` comes from
 *     `plugin.commands` (`{ label, value, icon, ... }[]`), built by each enactor's
 *     `loadCommands()` (basics/enactor/obsidian.tsx, basics/enactor/makemd.tsx).
 *     Those command lists are STATIC literals, so the finite key space is the union
 *     of the `label:` literals across both enactors, extracted by source scan
 *     (the enactors import `obsidian` and cannot be loaded in this node env).
 *
 *  2. `i18n.aggregates[f]` — PropertyValue.tsx:340,676; TableView.tsx:2423,2441.
 *     `f` is always a key of `aggregateFnTypes` (PropertyValue.tsx:334 and
 *     TableView.tsx:2415 both iterate `Object.keys(aggregateFnTypes)`; the stored
 *     `colsCalc[col]` value read at :676/:2441 is one of those same keys). So the
 *     finite key space IS `Object.keys(aggregateFnTypes)`, imported directly.
 *
 *  3. `i18n.formulas[name]` — FormulaEditor.tsx:274. `name` is
 *     `presetField.func.name`, i.e. the `name` of a `formulasInfos` entry
 *     (FormulaEditor.tsx:244 sets `func` from `formulasInfos[f.name]`). The finite
 *     key space is `Object.values(formulasInfos).map(f => f.name)`, imported
 *     directly. (The top-level `formulasInfos` keys equal those `.name` values.)
 *
 * --- Deliberately OUT OF SCOPE: genuinely open-ended key spaces ---
 *
 * `i18n.labels[expr]` and any other computed read whose key is a USER-SUPPLIED or
 * otherwise unbounded value (a property name, a typed expression, free text) has
 * NO finite literal key set knowable offline, so completeness for it is
 * undecidable here and is NOT asserted. (As of this writing the source carries no
 * live `i18n.labels[...]` computed site — the universe of computed i18n access is
 * exactly the three groups above — but the principle stands for any future one:
 * static-registry key spaces are swept here; open-ended ones are not.)
 *
 * Runs in the default node env: a direct `en` / registry import + source-text
 * inspection of the two enactor files. No DOM, no obsidian, no I/O beyond reading
 * those source files.
 */
import * as fs from "fs";
import * as path from "path";
import { en } from "./en";
import { aggregateFnTypes } from "../core/utils/contexts/predicate/aggregates";
import { formulasInfos } from "../core/utils/formula/formulasInfos";

/** A resolvable i18n label is a present, non-empty string in the group table. */
const resolvesToLabel = (group: Record<string, unknown>, key: string): boolean =>
  Object.prototype.hasOwnProperty.call(group, key) &&
  typeof group[key] === "string" &&
  (group[key] as string).length > 0;

/** Report every registry key whose computed i18n read would yield a blank label. */
const undefinedKeys = (
  group: Record<string, unknown>,
  keys: string[]
): string[] => keys.filter((k) => !resolvesToLabel(group, k));

describe("i18n dynamic-key coverage — every statically-known computed key resolves (Notidian-bym)", () => {
  describe("i18n.aggregates[fn] — key space = Object.keys(aggregateFnTypes)", () => {
    const fnKeys = Object.keys(aggregateFnTypes);

    it("the aggregate registry is non-empty (guards a vacuous pass)", () => {
      // If the registry import silently collapsed, the coverage assertion below
      // would pass over zero keys. Floor it to the known shipped count.
      expect(fnKeys.length).toBeGreaterThanOrEqual(20);
    });

    it("every aggregate function key resolves to a non-blank label in en.aggregates", () => {
      const missing = undefinedKeys(
        en.aggregates as Record<string, unknown>,
        fnKeys
      );
      if (missing.length > 0) {
        throw new Error(
          `${missing.length} aggregate registry key(s) have no en.aggregates label, so ` +
            `i18n.aggregates[fn] yields undefined -> a BLANK aggregate menu/footer label ` +
            `(the i18n Proxy returns undefined, never throws). The access sites iterate ` +
            `Object.keys(aggregateFnTypes), so the registry key — not a synonym — must be ` +
            `the en.ts key. Add each to src/shared/en.ts "aggregates":\n  ` +
            missing.join("\n  ")
        );
      }
      expect(missing).toEqual([]);
    });

    it("'avg' (the registry/runtime key) resolves — regression pin for the avg/average mismatch", () => {
      // aggregateFnTypes uses key 'avg' (aggregates.ts:116) and the rollup runtime
      // switches on 'avg' (tableRollup.ts:104); the stored colsCalc value is 'avg'.
      // en.ts previously labelled it under 'average' only, so i18n.aggregates['avg']
      // was undefined -> a blank "Average" aggregate menu item / footer. Pin the
      // canonical key so a reintroduced synonym fails by name.
      expect(resolvesToLabel(en.aggregates as Record<string, unknown>, "avg")).toBe(
        true
      );
      expect((en.aggregates as Record<string, string>).avg).toBe("Average");
    });
  });

  describe("i18n.formulas[name] — key space = formulasInfos[*].name", () => {
    const formulaNames = Object.values(formulasInfos).map((f) => f.name);

    it("the formula registry is non-empty (guards a vacuous pass)", () => {
      expect(formulaNames.length).toBeGreaterThanOrEqual(50);
    });

    it("every formula preset name resolves to a non-blank label in en.formulas", () => {
      const missing = undefinedKeys(
        en.formulas as Record<string, unknown>,
        formulaNames
      );
      if (missing.length > 0) {
        throw new Error(
          `${missing.length} formula preset name(s) have no en.formulas description, so ` +
            `i18n.formulas[name] yields undefined -> a BLANK formula-suggester description. ` +
            `FormulaEditor.tsx:274 reads i18n.formulas[presetField.func.name] for every ` +
            `formulasInfos entry. Add each to src/shared/en.ts "formulas":\n  ` +
            missing.join("\n  ")
        );
      }
      expect(missing).toEqual([]);
    });
  });

  describe("i18n.commands[label] — key space = enactor loadCommands() label literals", () => {
    // The enactors import `obsidian`, so we cannot load them here; extract the
    // static `label: "..."` literals from each enactor source instead. (Every
    // `label:` in these two files is a command label — verified at authoring time.)
    const ENACTOR_FILES = [
      path.resolve(__dirname, "../basics/enactor/obsidian.tsx"),
      path.resolve(__dirname, "../basics/enactor/makemd.tsx"),
    ];

    const extractCommandLabels = (file: string): string[] => {
      const src = fs.readFileSync(file, "utf8");
      const re = /\blabel:\s*"([^"]+)"/g;
      const out: string[] = [];
      let m: RegExpExecArray | null;
      while ((m = re.exec(src)) !== null) out.push(m[1]);
      return out;
    };

    const commandLabels = Array.from(
      new Set(ENACTOR_FILES.flatMap(extractCommandLabels))
    ).sort();

    it("extracts a plausible set of command labels from the enactors (guards a vacuous pass)", () => {
      // If the scan silently broke, coverage below would pass over zero labels.
      expect(commandLabels.length).toBeGreaterThanOrEqual(15);
    });

    it("every command label resolves to a non-blank label in en.commands", () => {
      const missing = undefinedKeys(
        en.commands as Record<string, unknown>,
        commandLabels
      );
      if (missing.length > 0) {
        throw new Error(
          `${missing.length} MakeMenu command label(s) have no en.commands label, so ` +
            `i18n.commands[label] yields undefined. MakeMenu.tsx:106 falls back to the raw ` +
            `label, but :77/:79 (suggestion filtering) silently skips the i18n match. Add ` +
            `each to src/shared/en.ts "commands":\n  ` +
            missing.join("\n  ")
        );
      }
      expect(missing).toEqual([]);
    });
  });
});
