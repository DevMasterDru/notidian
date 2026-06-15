/**
 * Offline static-registry cross-check for the VISUALIZATION aggregation registry
 * (bd Notidian-ed4).
 *
 * --- Why this is a SEPARATE site from the table-footer aggregate registry ---
 *
 * Notidian carries TWO independent aggregate naming canons, and they DO NOT share
 * keys:
 *
 *  A. The table-footer / rollup registry — `aggregateFnTypes`
 *     (src/core/utils/contexts/predicate/aggregates.ts), canonical key `avg`,
 *     labelled in `en.aggregates`. Its registry-vs-en.ts cross-check (incl. the
 *     `avg`/`average` mismatch fix) is owned by `i18n.dynamicKeys.test.ts`
 *     (Notidian-bym). This file deliberately does NOT re-assert it (de-dup).
 *
 *  B. The chart/visualization aggregation enum — `AggregationType`
 *     (src/core/utils/visualization/visualizationUtils.ts:443 =
 *     'count'|'sum'|'average'|'min'|'max'|'distinct'), canonical key `average`
 *     (NOT `avg`), labelled in `en.menu`. bym explicitly left this site untouched
 *     ("i18n.menu.average (visualization, literal access) untouched"). It is the
 *     scope of THIS bead.
 *
 * --- The bug class this locks (the mirror image of the avg/average defect) ---
 *
 * The visualization aggregation registry is surfaced by VisualizationToolbar.tsx
 * as a static submenu: each option pairs a LABEL (`name: i18n.menu.<key>`,
 * literal access) with a VALUE persisted into the chart config and switched on by
 * the `aggregateData`/`aggregateByGroup`/`bucketByTimeUnit` reducers in
 * visualizationUtils.ts (`updateAggregate("<value>")` -> `case "<value>":`). The
 * label key and the stored value are COUPLED — both are `average`, `count`, ... —
 * but nothing enforces that coupling:
 *
 *   - The literal-chain completeness sweep (Notidian-wkr, i18n.completeness.test)
 *     proves `i18n.menu.average` (the LABEL literal) resolves, but says nothing
 *     about the VALUE side or the coupling.
 *   - bym's dynamic-key test covers registry A (`aggregateFnTypes`), not B.
 *
 * So two real, currently-unguarded drifts survive both:
 *
 *   1. A "fix" that renames `en.menu.average` -> `en.menu.avg` (a very plausible
 *      mistake right after bym renamed `en.aggregates.average` -> `avg` for the
 *      OTHER registry) silently blanks the chart aggregation menu's "Average"
 *      item — `i18n.menu.average` becomes `undefined` (the i18n Proxy never
 *      throws). wkr would catch the now-dangling literal, but only if the literal
 *      survives; this test pins the *coupling* (label key == stored value) so the
 *      intent is explicit and a half-rename (value still `average`, label renamed)
 *      is caught by name here.
 *   2. A toolbar option whose stored value the computation switches don't handle
 *      (drift between the offered registry and the `AggregationType` reducers)
 *      silently falls through `default: count` — wrong numbers, no error. This
 *      test binds each offered value to a real `case "<value>":` so an unhandled
 *      option fails HERE.
 *
 * The offered registry is derived from the toolbar SOURCE (the same source-scan
 * technique bym used for enactor command labels), not a hand-copied list, so
 * adding/removing/renaming a toolbar aggregation option without its label, its
 * en.menu entry, or its reducer case fails here.
 *
 * Runs in the default node env: pure filesystem + source-text inspection + a
 * direct `en` import. No DOM, no React/obsidian/makemd-core load (the toolbar and
 * visualizationUtils both transitively import those, so we read their source).
 */
import * as fs from "fs";
import * as path from "path";
import { en } from "shared/en";

const TOOLBAR_FILE = path.resolve(
  __dirname,
  "../../react/components/Visualization/VisualizationToolbar.tsx"
);
const VIZ_UTILS_FILE = path.resolve(__dirname, "./visualizationUtils.ts");

/** A resolvable i18n label is a present, non-empty string in the group table. */
const resolvesToLabel = (group: Record<string, unknown>, key: string): boolean =>
  Object.prototype.hasOwnProperty.call(group, key) &&
  typeof group[key] === "string" &&
  (group[key] as string).length > 0;

/**
 * Extract the visualization aggregation registry the toolbar SURFACES: each
 * submenu option pairs `name: i18n.menu.<labelKey>` with `updateAggregate("<value>")`
 * inside the same option object. We pair them positionally within the aggregate
 * submenu block — both lists are emitted in lockstep, one per option — and assert
 * equal length so a structural change to the block can't silently desync them.
 */
const extractToolbarAggregationRegistry = (): {
  labelKeys: string[];
  values: string[];
} => {
  const src = fs.readFileSync(TOOLBAR_FILE, "utf8");
  // Narrow to the aggregate submenu so unrelated i18n.menu.* / updateX(...) sites
  // elsewhere in the toolbar can't leak in. The block opens at the
  // `aggregateOptions: SelectOption[] = [` declaration.
  const blockStart = src.indexOf("aggregateOptions");
  expect(blockStart).toBeGreaterThanOrEqual(0);
  // Bound the block at the next declaration after the option array closes.
  const after = src.slice(blockStart);
  const blockEnd = after.indexOf("const updateAggregate");
  const block = blockEnd >= 0 ? after.slice(0, blockEnd) : after;

  const labelKeys: string[] = [];
  const valueArgs: string[] = [];
  const labelRe = /name:\s*i18n\.menu\.([A-Za-z0-9_]+)/g;
  const valueRe = /updateAggregate\(\s*"([^"]+)"\s*\)/g;
  let m: RegExpExecArray | null;
  while ((m = labelRe.exec(block)) !== null) labelKeys.push(m[1]);
  while ((m = valueRe.exec(block)) !== null) valueArgs.push(m[1]);
  return { labelKeys, values: valueArgs };
};

/**
 * The set of aggregation values the visualizationUtils reducers actually compute
 * (every `case "<value>":` in the file). An offered toolbar value missing from
 * this set falls through `default` to a wrong (count) result with no error.
 */
const extractReducerCases = (): Set<string> => {
  const src = fs.readFileSync(VIZ_UTILS_FILE, "utf8");
  const out = new Set<string>();
  const re = /case\s*['"]([^'"]+)['"]\s*:/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) out.add(m[1]);
  return out;
};

describe("visualization aggregation registry <-> en.menu / reducers (Notidian-ed4)", () => {
  const { labelKeys, values } = extractToolbarAggregationRegistry();

  it("extracts a plausible, paired aggregation registry from the toolbar (guards a vacuous pass)", () => {
    // If the scan silently broke, the coupling assertions would pass over zero
    // options. Floor to the shipped count (count/sum/average/min/max/distinct).
    expect(labelKeys.length).toBeGreaterThanOrEqual(6);
    expect(values.length).toBeGreaterThanOrEqual(6);
    // Label and value lists are emitted one-per-option; they MUST be the same
    // length or the positional pairing below is meaningless.
    expect(labelKeys.length).toBe(values.length);
  });

  it("every aggregation LABEL key resolves to a non-blank label in en.menu (literal-access label side)", () => {
    const missing = labelKeys.filter(
      (k) => !resolvesToLabel(en.menu as Record<string, unknown>, k)
    );
    if (missing.length > 0) {
      throw new Error(
        `${missing.length} visualization aggregation label key(s) have no en.menu entry, so ` +
          `VisualizationToolbar's i18n.menu.<key> yields undefined -> a BLANK aggregation ` +
          `submenu item (the i18n Proxy returns undefined, never throws). Add each to ` +
          `src/shared/en.ts "menu":\n  ` +
          missing.join("\n  ")
      );
    }
    expect(missing).toEqual([]);
  });

  it("each offered aggregation VALUE is handled by a visualizationUtils reducer case (no silent fall-through to count)", () => {
    const cases = extractReducerCases();
    const unhandled = values.filter((v) => !cases.has(v));
    if (unhandled.length > 0) {
      throw new Error(
        `${unhandled.length} aggregation value(s) the toolbar can persist are NOT handled by any ` +
          `case "<value>": in visualizationUtils.ts, so aggregateData/aggregateByGroup/bucketByTimeUnit ` +
          `fall through 'default' to a COUNT result for them (wrong numbers, no error). Add a reducer ` +
          `case for each, or remove the toolbar option:\n  ` +
          unhandled.join("\n  ")
      );
    }
    expect(unhandled).toEqual([]);
  });

  it("label key == stored value for every option — the canonical coupling that blocks the mirror avg/average drift", () => {
    // For the visualization registry the en.menu label key and the persisted
    // aggregation value are intentionally the SAME token (label `average` <->
    // value `average`). Pinning equality makes a half-rename (rename the en.menu
    // key OR the stored value but not both) fail by name here — the exact mirror
    // of the avg/average mismatch bym fixed on the table-footer registry.
    const mismatched: string[] = [];
    for (let i = 0; i < values.length; i++) {
      if (labelKeys[i] !== values[i]) {
        mismatched.push(`option ${i}: label "${labelKeys[i]}" != value "${values[i]}"`);
      }
    }
    expect(mismatched).toEqual([]);
  });

  it("pins the 'average' option (label + value + reducer + en.menu) — regression anchor for the mirror of the avg/average defect", () => {
    // The chart aggregation canonical key is 'average' (NOT 'avg' — that is the
    // OTHER registry, bym's). Pin all four facets so a cross-contaminating
    // rename toward 'avg' fails loudly here.
    expect(labelKeys).toContain("average");
    expect(values).toContain("average");
    expect(extractReducerCases().has("average")).toBe(true);
    expect(resolvesToLabel(en.menu as Record<string, unknown>, "average")).toBe(true);
    expect((en.menu as Record<string, string>).average).toBe("Average");
  });
});
