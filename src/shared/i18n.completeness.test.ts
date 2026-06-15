/**
 * Offline i18n completeness sweep (bd Notidian-wkr).
 *
 * ROOT CAUSE this guards against: `src/shared/i18n.ts` exposes the string table
 * through a `Proxy` (i18n.ts:56) whose `get` trap delegates to `Reflect.get` and
 * therefore returns `undefined` — it NEVER throws — for a key that is absent from
 * `src/shared/en.ts`. So a reference like `i18n.labels.repeat`, when the key is
 * missing, silently produces `undefined`, which then flows into a preset `name`,
 * a menu item `name`, an `aria-label`, etc. as a missing/blank string. This class
 * of bug is invisible to tsc (the proxy is typed as `Record<string, ...>`) and
 * to the runtime (no error) — only the user sees a blank label.
 *
 * This test makes that bug class GATE-ENFORCEABLE and offline-verifiable: it
 * statically scans the whole `src/` tree for every i18n reference of the form
 *   i18n.<seg>.<seg>(.<seg>)*
 * — including chains broken across continuation lines (e.g. `i18n.descriptions`
 * on one line and `.someKey` on the next) — and the `t` alias used by files that
 * import the default export either as `import { default as t } from "shared/i18n"`
 * or as `import t from "shared/i18n"`. It resolves each chain against the real
 * `en` table, and FAILS — listing every
 * offending reference and the file it lives in — if any chain resolves to
 * `undefined`. A future commit that references a key without adding it to en.ts
 * (or that deletes a key still in use) fails HERE with a precise message.
 *
 * Runs in the default node env: pure filesystem + source-text inspection + a
 * direct `en` import. No DOM, no I/O beyond reading source files.
 *
 * --- Scope, and the known false-positive classes it deliberately excludes ---
 *
 * The reference scan is intentionally conservative — it only validates STATIC,
 * LITERAL member-access chains, because only those have a key knowable offline:
 *
 *  1. Dynamic / computed access — `i18n.commands[cmd]`, `i18n.aggregates[fn]`,
 *     `i18n.formulas[name]`, `i18n.labels[expr]` — the key is a runtime value,
 *     not a literal, so it is NOT (and cannot be) checked here. These chains end
 *     before the `[` and are not captured.
 *
 *  2. Method calls on a resolved string — `i18n.menu.removeFromSpace.replace(...)`,
 *     `i18n.editor.linkName.replace("${1}", x)`, `String.prototype.split`, etc.
 *     Here `.replace`/`.split`/... is a JS method on the (valid) string value, NOT
 *     an i18n key. A trailing segment immediately followed by `(` is treated as a
 *     method call and dropped before resolution, so these do not produce false
 *     "missing key" failures while the real underlying key (e.g.
 *     `i18n.menu.removeFromSpace`) is still validated.
 *
 *  3. Prose mentions in comments and string literals naming an `i18n.x.y` path —
 *     comments are stripped before scanning, and this test file (which documents
 *     such paths) excludes itself via `__filename`.
 *
 * If a key is genuinely accessed only dynamically, it cannot be swept here by
 * construction; that is an accepted, documented limitation, not a gap to paper
 * over with a looser regex (which would re-introduce false positives).
 */
import * as fs from "fs";
import * as path from "path";
import { en } from "./en";

const SRC_ROOT = path.resolve(__dirname, ".."); // .../src

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

/** Strip block + line comments so prose that merely names an i18n path is ignored. */
const stripComments = (raw: string): string =>
  raw
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");

type Ref = { chain: string[]; raw: string; file: string };

/**
 * Extract literal i18n reference chains from one file's (comment-stripped) source.
 *
 * `base` is the identifier the i18n proxy is bound to in this file — always
 * `i18n` for the default import, and additionally `t` for files that alias the
 * default export as `t`.
 *
 * Captures `base.seg(.seg)*` and, via the optional trailing `(` group, detects
 * when the last segment is an immediate method call (e.g. `.replace(` ) — in
 * which case that segment is a JS String method, not an i18n key, and is dropped.
 *
 * The segment separator is whitespace/newline-tolerant — `(?:\s*\.\s*ident)+` —
 * so chains broken across continuation lines (a very common Prettier wrap, e.g.
 * `i18n.descriptions\n  .someKey`) are captured to their true leaf, not silently
 * truncated at the last same-line segment. Each captured segment is trimmed.
 */
const extractRefs = (code: string, base: string, file: string): Ref[] => {
  // \b<base>  then one-or-more (optional-ws ".") identifier  then optional ws + "("
  const re = new RegExp(
    `\\b${base}((?:\\s*\\.\\s*[A-Za-z_$][A-Za-z0-9_$]*)+)\\s*(\\()?`,
    "g"
  );
  const refs: Ref[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(code)) !== null) {
    // Split on "." then trim each segment of the surrounding whitespace/newlines
    // the tolerant separator allowed in; the first element is the empty string
    // before the leading dot, so drop it.
    let segs = m[1]
      .split(".")
      .slice(1)
      .map((s) => s.trim());
    const calledImmediately = Boolean(m[2]);
    // A bare `base()` cannot happen (segs always has >=1 here). If the chain ends
    // in a method call AND has a key segment beneath it, drop the call leaf.
    if (calledImmediately && segs.length > 1) {
      segs = segs.slice(0, -1);
    }
    if (segs.length === 0) continue;
    refs.push({ chain: segs, raw: `${base}.${segs.join(".")}`, file });
  }
  return refs;
};

/** Resolve a dotted chain against `en`; returns the leaf value or `undefined`. */
const resolve = (chain: string[]): unknown => {
  let cur: unknown = en;
  for (const seg of chain) {
    if (cur === undefined || cur === null || typeof cur !== "object") {
      return undefined;
    }
    if (!(seg in (cur as Record<string, unknown>))) return undefined;
    cur = (cur as Record<string, unknown>)[seg];
  }
  return cur;
};

describe("i18n completeness sweep — every referenced key resolves (Notidian-wkr)", () => {
  const files = listSourceFiles(SRC_ROOT).filter((f) => {
    if (f === __filename) return false; // this file documents i18n.* paths in prose
    if (/\.test\.tsx?$/.test(f)) return false; // tests name keys in describe/strings
    return true;
  });

  // Files that alias the default i18n export as `t` — only there is `t.x.y` an
  // i18n reference (elsewhere `t` is an unrelated local). Both import spellings
  // bind the default export to `t`, so both must be detected:
  //   import { default as t } from "shared/i18n"   (brace form)
  //   import t from "shared/i18n"                   (default-named form)
  const aliasFiles = new Set(
    files.filter((f) => {
      const src = fs.readFileSync(f, "utf8");
      return (
        /import\s*\{[^}]*\bdefault as t\b[^}]*\}\s*from\s*["'][^"']*i18n["']/.test(
          src
        ) || /import\s+t\s+from\s*["'][^"']*i18n["']/.test(src)
      );
    })
  );

  // Collect the de-duplicated set of literal references across the tree.
  const byRaw = new Map<string, Ref>();
  for (const f of files) {
    const code = stripComments(fs.readFileSync(f, "utf8"));
    for (const ref of extractRefs(code, "i18n", f)) {
      if (!byRaw.has(ref.raw)) byRaw.set(ref.raw, ref);
    }
    if (aliasFiles.has(f)) {
      for (const ref of extractRefs(code, "t", f)) {
        // Normalize the alias to its real path for resolution + reporting.
        const realRaw = `i18n.${ref.chain.join(".")}`;
        if (!byRaw.has(realRaw)) {
          byRaw.set(realRaw, { chain: ref.chain, raw: realRaw, file: ref.file });
        }
      }
    }
  }
  const refs = [...byRaw.values()].sort((a, b) => a.raw.localeCompare(b.raw));

  it("scans the source tree and finds i18n references to validate", () => {
    // Sanity floor: if this collapses to ~0 the scanner silently broke and the
    // completeness assertion below would pass vacuously. The tree carries ~1000.
    expect(refs.length).toBeGreaterThan(500);
  });

  it("every referenced i18n key resolves to a non-undefined value in en.ts", () => {
    const offenders = refs
      .filter((r) => resolve(r.chain) === undefined)
      .map((r) => `${r.raw}  (e.g. ${path.relative(SRC_ROOT, r.file)})`);

    if (offenders.length > 0) {
      throw new Error(
        `Found ${offenders.length} i18n reference(s) that resolve to undefined in en.ts ` +
          `(silent missing-key bug — the i18n Proxy returns undefined, never throws). ` +
          `Add each key to src/shared/en.ts (Title Case label conventions):\n  ` +
          offenders.join("\n  ")
      );
    }
    expect(offenders).toEqual([]);
  });

  it("the previously-missing keys this sweep added are present (regression pins)", () => {
    // Keys that were silently undefined before Notidian-wkr; pinned individually
    // so a regression names the exact key rather than only the bulk sweep.
    const added: Array<[string[], string]> = [
      [["labels", "barChart"], "Bar Chart"],
      [["labels", "lineChart"], "Line Chart"],
      [["labels", "scatterPlot"], "Scatter Plot"],
      [["labels", "pieChart"], "Pie Chart"],
      [["labels", "areaChart"], "Area Chart"],
      [["labels", "radarChart"], "Radar Chart"],
      [["labels", "replace"], "Replace"],
      [["labels", "pinned"], "Pinned"],
      [["labels", "joined"], "Joined"],
      [["descriptions", "replace"], "Replace"],
      // Found only after the scan was made newline-tolerant: these are referenced
      // via multi-line chains (`i18n.descriptions\n  .key`) and were undefined.
      [
        ["descriptions", "changeTheSyncSettingsToIncludeUnsupportedFileTypes"],
        "Change the sync settings to include unsupported file types.",
      ],
      [
        ["descriptions", "dropStickerPackZipOrIndividualIconsHereToImport"],
        "Drop a sticker pack .zip or individual icons here to import.",
      ],
      [
        [
          "descriptions",
          "dragAndDropZipStickerPacksOrIndividualIconFilesHereToImport",
        ],
        "Drag and drop .zip sticker packs or individual icon files here to import.",
      ],
    ];
    for (const [chain, expected] of added) {
      expect(resolve(chain)).toBe(expected);
    }
  });
});
