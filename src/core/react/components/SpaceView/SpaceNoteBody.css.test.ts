/**
 * @jest-environment node
 *
 * CSS-source regression guard for the collapsible space-note-body shrink-to-fit
 * fix (Notidian-xazq). jsdom cannot apply real CSS layout, so SpaceNoteBody.dom
 * .test.tsx can only lock the render contract — it cannot catch the failure mode
 * that actually shipped: a shrink rule scoped to a class (.mk-foldernote) that is
 * not present in the live DOM, leaving CodeMirror's inline ~viewport-tall
 * .cm-content "scroll past end" padding-bottom in place so the note body rendered
 * far taller than its content. This test asserts, against the real stylesheet,
 * that the operative rule exists, beats the inline padding (!important), reaches
 * the class the component actually emits (.mk-space-note--collapsible), and stays
 * scoped to that opt-in class so the flag-OFF (collapsibleNoteBody=false) DOM —
 * plain .mk-space-note — is byte-identical.
 */
import * as fs from "fs";
import * as path from "path";

const css = fs.readFileSync(
  path.resolve(process.cwd(), "src/css/SpaceViewer/SpaceView.css"),
  "utf8"
);

// Strip CSS comments so explanatory prose (which mentions these selectors) can
// never satisfy a match — only real rules count.
const stripComments = (s: string): string => s.replace(/\/\*[\s\S]*?\*\//g, "");
const code = stripComments(css);

// Parse into { selector, body } rule pairs (flat top-level rules; sufficient here).
const rules: Array<{ selector: string; body: string }> = [];
const ruleRe = /([^{}]+)\{([^{}]*)\}/g;
let m: RegExpExecArray | null;
while ((m = ruleRe.exec(code)) !== null) {
  rules.push({ selector: m[1].trim(), body: m[2].trim() });
}

const declares = (body: string, prop: string, value: RegExp): boolean => {
  const decl = body
    .split(";")
    .map((d) => d.trim())
    .find((d) => d.toLowerCase().startsWith(prop.toLowerCase() + ":"));
  return decl != null && value.test(decl);
};

describe("SpaceView.css — collapsible note body shrink-to-fit (Notidian-xazq)", () => {
  it("zeroes .cm-content scroll-past-end padding, scoped to .mk-space-note--collapsible, with !important", () => {
    const paddingZeroRules = rules.filter(
      (r) =>
        /\.cm-content\b/.test(r.selector) &&
        declares(r.body, "padding-bottom", /0(px)?\s*!important/i)
    );
    // The note-region (not .mk-space-body) padding-zero rule must exist...
    const noteRule = paddingZeroRules.find((r) =>
      /\.mk-space-note--collapsible\b/.test(r.selector)
    );
    expect(noteRule).toBeDefined();

    // ...and EVERY padding-zero rule that touches .mk-space-note must require the
    // --collapsible modifier — a bare ".mk-space-note .cm-content { padding-bottom:0 }"
    // would change the flag-OFF legacy path and break the kill-switch byte-identity.
    const leaks = paddingZeroRules.filter(
      (r) =>
        /\.mk-space-note\b/.test(r.selector) &&
        !/\.mk-space-note--collapsible\b/.test(r.selector)
    );
    expect(leaks).toEqual([]);
  });

  it("forces the collapsible note editor/scroller/sizer to content height (not dependent on .mk-foldernote)", () => {
    // At least one height:auto + min-height:0 rule must reach the flowspace/flow
    // editor via .mk-space-note--collapsible WITHOUT also requiring .mk-foldernote
    // (the class that was unreliably present and made the original fix a no-op).
    const robustHeightRule = rules.find(
      (r) =>
        /\.mk-space-note--collapsible\b/.test(r.selector) &&
        /\.(mk-flowspace-editor|mk-floweditor|cm-scroller|cm-sizer)\b/.test(
          r.selector
        ) &&
        !/\.mk-foldernote\b/.test(r.selector) &&
        declares(r.body, "height", /auto/i) &&
        declares(r.body, "min-height", /0\s*!important/i)
    );
    expect(robustHeightRule).toBeDefined();
  });
});
