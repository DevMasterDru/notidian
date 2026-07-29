/**
 * @jest-environment node
 *
 * CSS-source regression guard for the H3 title-cell wrap fix (Notidian-pb7p.3 /
 * Atlas ADR-0096 H3). jsdom applies no real CSS cascade, so a DOM test cannot
 * catch the failure mode that actually shipped: `colsWrap: "wrap"` set
 * white-space:normal on .mk-cell-text, but the File / page-title cell renders a
 * PathCrumb whose .mk-path (and its inner span) carry their OWN
 * nowrap + overflow:hidden + text-overflow:ellipsis from FileContext.css. Those
 * inner rules win, so the wrap toggle silently did nothing on the one column a
 * dense hub most needs to read in full (S3A evidence: 685px reading width).
 *
 * This asserts against the real stylesheets that the override exists, reaches
 * the elements the crumb actually emits, and stays scoped to .mk-td-wrap-wrap so
 * clip columns (the default) and every non-table .mk-path are untouched.
 */
import * as fs from "fs";
import * as path from "path";

const readCss = (relative: string): string =>
  fs.readFileSync(path.resolve(process.cwd(), relative), "utf8");

// Strip comments so explanatory prose (which names these selectors) can never
// satisfy a match — only real rules count.
const stripComments = (s: string): string => s.replace(/\/\*[\s\S]*?\*\//g, "");

const parseRules = (css: string): Array<{ selector: string; body: string }> => {
  const rules: Array<{ selector: string; body: string }> = [];
  const ruleRe = /([^{}]+)\{([^{}]*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = ruleRe.exec(stripComments(css))) !== null) {
    rules.push({ selector: m[1].trim(), body: m[2].trim() });
  }
  return rules;
};

const declares = (body: string, prop: string, value: RegExp): boolean => {
  const decl = body
    .split(";")
    .map((d) => d.trim())
    .find((d) => d.toLowerCase().startsWith(prop.toLowerCase() + ":"));
  return decl != null && value.test(decl);
};

const tableRules = parseRules(readCss("src/css/SpaceViewer/TableView.css"));
const fileContextRules = parseRules(readCss("src/css/Panels/FileContext.css"));

describe("TableView.css — colsWrap reaches the title cell (Notidian-pb7p.3)", () => {
  it("still has the truncating .mk-path rules this override must beat (premise guard)", () => {
    // If FileContext.css ever stops truncating, the override below is dead code
    // and this whole guard should be revisited rather than silently passing.
    const truncating = fileContextRules.filter(
      (r) =>
        /\.mk-path\b/.test(r.selector) &&
        declares(r.body, "white-space", /nowrap/i)
    );
    expect(truncating.length).toBeGreaterThan(0);
  });

  it("un-truncates .mk-path AND its inner span inside a wrap-mode cell", () => {
    const wrapPathRules = tableRules.filter(
      (r) =>
        /\.mk-td-wrap-wrap\b/.test(r.selector) &&
        /\.mk-path\b/.test(r.selector) &&
        declares(r.body, "white-space", /normal/i)
    );
    expect(wrapPathRules.length).toBeGreaterThan(0);

    const selectors = wrapPathRules.map((r) => r.selector).join(" ");
    // The crumb nests its label in a span with its own ellipsis; overriding the
    // container alone leaves the text truncated.
    expect(/\.mk-path\s+span\b/.test(selectors)).toBe(true);

    // Ellipsis must be cleared too — white-space alone still renders "…" in
    // browsers once overflow is visible.
    const clearsEllipsis = wrapPathRules.some((r) =>
      declares(r.body, "text-overflow", /clip/i)
    );
    expect(clearsEllipsis).toBe(true);
  });

  it("never un-truncates .mk-path outside an explicit wrap-mode cell", () => {
    // A bare ".mk-td .mk-path { white-space: normal }" would change every clip
    // column (the default) and break the uniform single-line row contract.
    const leaks = tableRules.filter(
      (r) =>
        /\.mk-path\b/.test(r.selector) &&
        !/\.mk-td-wrap-wrap\b/.test(r.selector) &&
        (declares(r.body, "white-space", /normal/i) ||
          declares(r.body, "text-overflow", /clip/i))
    );
    expect(leaks).toEqual([]);
  });
});
