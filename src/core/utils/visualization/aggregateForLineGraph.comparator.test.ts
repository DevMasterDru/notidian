/**
 * Source-text regression net for `aggregateForLineGraph`'s x-axis sort comparator
 * (bd Notidian-cm66; ADR 0033 — `intelligentCompare` non-transitivity bug class).
 *
 * --- Why this is a SOURCE-SCAN test, not a direct-import test ---
 *
 * `visualizationUtils.ts` transitively imports React / obsidian / makemd-core (the
 * same constraint `visualizationAggregation.i18n.test.ts` documents and works
 * around the same way). Importing it here to call `aggregateForLineGraph` directly
 * would drag that heavy graph into the default node jest env. The COMPARATOR'S
 * correctness — that it is a real strict weak ordering (reflexive, antisymmetric,
 * transitive over a mixed date/number/string domain; never NaN; "Infinity"/"1e999"
 * reflexive) — is ALREADY exhaustively pinned where the comparator lives, in
 * `sortingUtils.test.ts`'s `intelligentCompare` SWO block. Re-importing the whole
 * viz module to re-prove laws another test already owns would be duplication for a
 * heavy cost.
 *
 * --- What THIS test locks (the refactor itself, by name) ---
 *
 * Notidian-cm66 deleted an INLINE per-PAIR-branch comparator inside
 * `aggregateForLineGraph` (`if (isDateLike(aVal) || isDateLike(bVal))`, plus a
 * duplicated local `isDateLike`) — the textbook non-transitive pattern ADR 0033
 * says `intelligentCompare` was built to replace — and swapped in the canonical
 * `intelligentCompare`. This net pins that decision AT THIS CALL SITE so a future
 * edit can't silently regress it back to a per-pair inline comparator:
 *
 *   1. the file imports `intelligentCompare` from the canonical sortingUtils;
 *   2. the `aggregateForLineGraph` x-axis sort delegates to `intelligentCompare`
 *      over `_originalXValue` (the SWO-hardened comparator, not an inline one);
 *   3. the legacy non-transitive markers are GONE from the file — no
 *      `isDateLike(aVal) || isDateLike(bVal)` per-pair branch, and no duplicated
 *      local `const isDateLike =` (it now lives only in sortingUtils).
 *
 * Runs in the default node env: pure filesystem + source-text inspection. No DOM,
 * no React/obsidian/makemd-core load.
 */
import * as fs from "fs";
import * as path from "path";

const VIZ_UTILS_FILE = path.resolve(__dirname, "./visualizationUtils.ts");

const readSource = (): string => fs.readFileSync(VIZ_UTILS_FILE, "utf8");

/**
 * Strip block and line comments so the "anti-pattern is gone" assertions inspect
 * CODE only. (The replacement comment in visualizationUtils.ts legitimately QUOTES
 * the legacy `isDateLike(aVal) || isDateLike(bVal)` pattern in prose to explain why
 * it was removed; that documentation must not be mistaken for a live recurrence.)
 */
const stripComments = (src: string): string =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

/**
 * Isolate the `aggregateForLineGraph` export body so assertions about its sort
 * comparator can't be satisfied by unrelated code elsewhere in the (large) file.
 */
const extractAggregateForLineGraphBody = (src: string): string => {
  const start = src.indexOf("export const aggregateForLineGraph");
  expect(start).toBeGreaterThanOrEqual(0);
  const after = src.slice(start);
  // Bound at the next top-level export (the body is well within it).
  const nextExport = after.indexOf("\nexport const ", 1);
  return nextExport >= 0 ? after.slice(0, nextExport) : after;
};

describe("aggregateForLineGraph x-axis comparator <- intelligentCompare (Notidian-cm66 / ADR 0033)", () => {
  const src = readSource();
  const body = extractAggregateForLineGraphBody(src);

  it("imports the canonical SWO-hardened intelligentCompare from sortingUtils", () => {
    // The import must resolve to THE comparator that sortingUtils.test.ts proves is
    // a strict weak ordering — not a re-declared local copy.
    expect(src).toMatch(
      /import\s*\{[^}]*\bintelligentCompare\b[^}]*\}\s*from\s*["'][^"']*Visualization\/utils\/sortingUtils["']/
    );
  });

  it("sorts the x-axis by delegating to intelligentCompare over _originalXValue", () => {
    // The sort callback hands both _originalXValue keys to intelligentCompare; the
    // _originalXValue plumbing is preserved (it is what carries the original value
    // through aggregation to the sort).
    expect(body).toMatch(
      /\.sort\(\s*\(a,\s*b\)\s*=>\s*intelligentCompare\(\s*a\._originalXValue,\s*b\._originalXValue\s*\)\s*\)/
    );
  });

  it("no longer contains the legacy NON-TRANSITIVE per-PAIR branch (the ADR 0033 anti-pattern)", () => {
    // `isDateLike(aVal) || isDateLike(bVal)` selected the date branch based on the
    // comparison PARTNER, not a stable per-value classification — the exact
    // non-transitive pattern ADR 0033 documents. It must be gone from the CODE
    // (comments quoting it to explain the removal are stripped first).
    expect(stripComments(src)).not.toMatch(
      /isDateLike\([^)]*\)\s*\|\|\s*isDateLike\(/
    );
  });

  it("no longer duplicates a local isDateLike helper (it lives only in sortingUtils)", () => {
    // The inline comparator carried its own copy of isDateLike; deleting the
    // comparator removes the duplication. A `const isDateLike =` declaration
    // reappearing here would signal a re-introduced inline comparator.
    expect(stripComments(src)).not.toMatch(/const\s+isDateLike\s*=/);
  });
});
