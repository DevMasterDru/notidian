// Static guard for the dead formula-helper removal (bd Notidian-y8qk). The
// `runFormula` and `runExec` exports were deleted from parser.ts: both had ZERO
// live callers, and `runFormula` was a stale duplicate of runFormulaWithContext
// that re-did the math.create/factory/import setup AND carried a latent bug — an
// EMPTY catch over an uninitialized `let value`, so a throwing formula returned
// `undefined` (not `''`) despite its `: string` signature. Every live formula
// path uses runFormulaWithContext (linkContextRow.ts, api.ts, commands.ts,
// spaces.ts, filesystemAdapter.ts, ActionTester.tsx), which correctly falls back
// to `value = ''` in its catch.
//
// This is the offline, gates-enforceable half of the "removed export is no longer
// imported/referenced anywhere" requirement: if a future change re-introduces a
// `runFormula` / `runExec` export or a live reference to either bare symbol, this
// test fails. It mirrors deadMKitRemoval.guard.test.ts — pure filesystem +
// source-text inspection, default node env, no DOM. Bare-symbol word boundaries
// (`\brunFormula\b`) deliberately do NOT match the surviving `runFormulaNode` /
// `runFormulaWithContext` (a word char follows `runFormula`), and comments are
// stripped first so the breadcrumb in parser.ts and the prose here are ignored —
// only live code counts.
import * as fs from "fs";
import * as path from "path";

const SRC_ROOT = path.resolve(__dirname, "../../../"); // .../src

const listSourceFiles = (dir: string, acc: string[] = []): string[] => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
      listSourceFiles(full, acc);
    } else if (/\.(ts|tsx)$/.test(entry.name)) {
      acc.push(full);
    }
  }
  return acc;
};

// Strip block + line comments so explanatory docstrings (and this guard's own
// needles) do not trip the search — only live code counts.
const stripComments = (raw: string): string =>
  raw
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");

describe("dead formula-helper removal — static guard (Notidian-y8qk)", () => {
  const files = listSourceFiles(SRC_ROOT);
  const removedSymbols = ["runFormula", "runExec"] as const;

  it("parser.ts no longer exports runFormula or runExec", () => {
    const parser = fs.readFileSync(
      path.join(SRC_ROOT, "core/utils/formula/parser.ts"),
      "utf8"
    );
    const code = stripComments(parser);
    for (const sym of removedSymbols) {
      // `export const runFormula` / `export const runExec` (the only way these
      // were ever exported) must be gone. The bare-symbol word boundary keeps
      // the surviving runFormulaNode / runFormulaWithContext exports clear.
      expect(
        new RegExp(`export\\s+const\\s+${sym}\\b`).test(code)
      ).toBe(false);
    }
    // And the live `runFormulaWithContext` export the codebase depends on must
    // still be present (this removal must not have collateral-deleted it).
    expect(/export\s+const\s+runFormulaWithContext\b/.test(code)).toBe(true);
  });

  it("no source file references the removed runFormula / runExec symbols in CODE", () => {
    const offenders: { file: string; symbol: string }[] = [];
    for (const f of files) {
      // This guard file itself names the removed symbols as the search needles.
      if (f === __filename) continue;
      const code = stripComments(fs.readFileSync(f, "utf8"));
      for (const sym of removedSymbols) {
        // `\b...\b` matches the BARE symbol only — `runFormulaNode` and
        // `runFormulaWithContext` (a word char follows `runFormula`) are not hit.
        if (new RegExp(`\\b${sym}\\b`).test(code)) {
          offenders.push({ file: f, symbol: sym });
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
