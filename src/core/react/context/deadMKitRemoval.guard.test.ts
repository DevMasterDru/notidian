// Static guard for the dead-MKit-preview-runtime removal (bd Notidian-bnb / ADR
// 0018). This is the offline, gates-enforceable half of the "removed export is
// no longer imported anywhere" requirement: if a future change resurrects the
// deleted MKitContext.tsx file or re-introduces an import of the removed
// symbols (which re-creates the SpaceManagerContext <-> MKitContext circular
// import), this test fails. Runs in the default node env — pure filesystem +
// source-text inspection, no DOM.
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

describe("dead MKit preview runtime removal — static guard (Notidian-bnb)", () => {
  const files = listSourceFiles(SRC_ROOT);

  it("MKitContext.tsx is deleted", () => {
    const deleted = path.join(
      SRC_ROOT,
      "core/react/context/MKitContext.tsx"
    );
    expect(fs.existsSync(deleted)).toBe(false);
  });

  it("no source file imports from ./MKitContext (or the MKitContext module)", () => {
    const offenders = files.filter((f) => {
      const text = fs.readFileSync(f, "utf8");
      // Match an ES import whose module specifier ends in /MKitContext or
      // is "./MKitContext" — ignores prose/comments that merely name the file.
      return /import[^;]*from\s+["'][^"']*\/?MKitContext["']/.test(text);
    });
    expect(offenders).toEqual([]);
  });

  it("no source file references the removed symbols in CODE (useMKitPreviewContext / MKitProvider / MKitSpaceManagerProvider)", () => {
    const removedSymbols = [
      "useMKitPreviewContext",
      "MKitProvider",
      "MKitSpaceManagerProvider",
    ];
    const offenders: { file: string; symbol: string }[] = [];
    for (const f of files) {
      // This guard file itself names the removed symbols as the search needles.
      if (f === __filename) continue;
      const raw = fs.readFileSync(f, "utf8");
      // Strip block + line comments so the explanatory docstrings in
      // SpaceManagerContext.tsx / settings.ts (which legitimately NAME the
      // removed symbols) do not trip the guard — only live code counts.
      const code = raw
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
      for (const sym of removedSymbols) {
        if (new RegExp(`\\b${sym}\\b`).test(code)) {
          offenders.push({ file: f, symbol: sym });
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("the dead MKit-preview scaffolding is fully pruned (Notidian-rzv): no source file references INERT_MKIT_PREVIEW_CONTEXT / InertProcessedSpaceData / InertMKitPreviewContext / removeMKitPreviewRuntime in CODE", () => {
    // The residual-prune (Notidian-rzv) deleted the local inert scaffolding and
    // retired the removeMKitPreviewRuntime setting. If a future change resurrects
    // any of them, this guard fails. Comments are stripped first so the guard
    // file's own needles and any prose are ignored — only live code counts.
    const prunedSymbols = [
      "INERT_MKIT_PREVIEW_CONTEXT",
      "InertProcessedSpaceData",
      "InertMKitPreviewContext",
      "removeMKitPreviewRuntime",
    ];
    const offenders: { file: string; symbol: string }[] = [];
    for (const f of files) {
      if (f === __filename) continue;
      const raw = fs.readFileSync(f, "utf8");
      const code = raw
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
      for (const sym of prunedSymbols) {
        if (new RegExp(`\\b${sym}\\b`).test(code)) {
          offenders.push({ file: f, symbol: sym });
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
