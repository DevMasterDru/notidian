/**
 * @jest-environment jsdom
 */
// Pins the sanitize.ts FIXED-POINT machinery itself (Notidian-2lg) — the loop that
// sanitizeIconSVG / sanitizeRenderedHtml / sanitizeFrameText run their per-pass
// cleaner through (sanitizeToFixedPoint) to defeat parse-differential mXSS
// (Notidian-y3h). The sibling adversarial file (sanitizeHtmlSinks.adversarial.dom
// .test.ts) already exercises, for the two HTML sinks, the <plaintext> collapse
// regression (its section 7) and the idempotency / mXSS-convergence property (its
// section 5); this file deliberately does NOT duplicate those. It adds the THREE
// load-bearing fixed-point branches that no DOM test currently exercises:
//
//   (A) the sanitize.ts:146 EXHAUSTIVENESS CLAIM — "an exhaustive scan of every
//       HTML element name finds NO remaining non-idempotent construct". We pin it
//       directly: wrap a benign payload in EVERY standard HTML element name and
//       assert the sanitiser output is a fixed point (fn(out) === out) for all
//       three public sinks. The FAILING state is any element whose parse/serialise
//       round-trip diverges — exactly the class of bug that <plaintext> was, and a
//       red flag for any future parser/jsdom quirk. (If this ever goes red it is a
//       REAL find: file a follow-up bead, do NOT blind-fix the render path.)
//
//   (B) the sanitizeIconSVG <plaintext> branch (sanitize.ts:289,
//       collapsePlaintextElements on the icon path). The icon sink had ZERO
//       <plaintext> coverage, yet its source carries the explicit claim that "a
//       malformed icon carrying a top-level <plaintext> cannot diverge the
//       fixed-point loop". We pin that: a top-level <plaintext> (incl. an embedded
//       onerror payload, and with a benign sibling) collapses to inert ESCAPED
//       text, never grows unbounded, never destroys the benign neighbour, and
//       reaches a fixed point.
//
//   (C) the cap -> escapeHtml(original) FAIL-SAFE contract (sanitize.ts:187). The
//       loop is capped at FIXED_POINT_MAX_PASSES; if it ever fails to converge it
//       must fall back to escapeHtml(original) — inert literal text, NON-destructive
//       — rather than "". The branch is currently unreachable through any public
//       sink (no standard element diverges — pinned by (A)), so per the bead we pin
//       the OBSERVABLE INVARIANT the branch exists to guarantee, not a mocked
//       divergent parser: over the full corpus every output is a fixed point of one
//       more pass, and NO benign-text-bearing input ever silently collapses to "".
//       We also pin the property the fallback relies on — escapeHtml(input) is
//       itself inert AND non-empty for non-empty input — which is precisely why ""
//       would be the wrong fallback.
//
// As in the sibling .dom files, the default jest env is node (document undefined,
// every sink early-returns ""); this file opts into jsdom so the real DOM
// parse/serialise round-trip — the actual sink behaviour — is exercised. It imports
// no React/testing-library, keeping the transform surface narrow.
import {
  escapeHtml,
  sanitizeFrameText,
  sanitizeIconSVG,
  sanitizeRenderedHtml,
} from "shared/utils/sanitize";

// All three public sinks share the same sanitizeToFixedPoint loop, so the
// fixed-point / exhaustiveness properties must hold for every one of them. The
// HTML sinks (sanitizeRenderedHtml / sanitizeFrameText) share an identical per-pass
// cleaner; sanitizeIconSVG uses the SVG-icon cleaner — both run through the same
// loop and the same collapsePlaintextElements pre-step.
const SINKS: Array<{ name: string; fn: (s: string) => string }> = [
  { name: "sanitizeRenderedHtml", fn: sanitizeRenderedHtml },
  { name: "sanitizeFrameText", fn: (s) => sanitizeFrameText(s) },
  { name: "sanitizeIconSVG", fn: sanitizeIconSVG },
];

// The canonical list of standard HTML element names — current, deprecated, and
// obsolete (WHATWG HTML element index + historical elements). Obsolete/foreign
// names are INCLUDED on purpose: that is exactly where a non-idempotent
// parse/serialise round-trip hides (<plaintext> is the documented one), so an
// honest exhaustiveness check of the sanitize.ts:146 claim must probe them. Kept as
// a literal array (not derived at runtime) so the corpus is stable and a future
// parser quirk on a specific tag is reproducible from the test source alone.
const ALL_HTML_ELEMENT_NAMES = [
  "a", "abbr", "acronym", "address", "applet", "area", "article", "aside",
  "audio", "b", "base", "basefont", "bdi", "bdo", "bgsound", "big", "blink",
  "blockquote", "body", "br", "button", "canvas", "caption", "center", "cite",
  "code", "col", "colgroup", "content", "data", "datalist", "dd", "del",
  "details", "dfn", "dialog", "dir", "div", "dl", "dt", "em", "embed",
  "fieldset", "figcaption", "figure", "font", "footer", "form", "frame",
  "frameset", "h1", "h2", "h3", "h4", "h5", "h6", "head", "header", "hgroup",
  "hr", "html", "i", "iframe", "image", "img", "input", "ins", "isindex",
  "kbd", "keygen", "label", "legend", "li", "link", "main", "map", "mark",
  "marquee", "menu", "menuitem", "meta", "meter", "multicol", "nav", "nextid",
  "nobr", "noembed", "noframes", "noscript", "object", "ol", "optgroup",
  "option", "output", "p", "param", "picture", "plaintext", "pre", "progress",
  "q", "rb", "rp", "rt", "rtc", "ruby", "s", "samp", "script", "section",
  "select", "shadow", "slot", "small", "source", "spacer", "span", "strike",
  "strong", "style", "sub", "summary", "sup", "table", "tbody", "td",
  "template", "textarea", "tfoot", "th", "thead", "time", "title", "tr",
  "track", "tt", "u", "ul", "var", "video", "wbr", "xmp",
];

// Re-parse the sanitiser output the way the real sink does (assign to a live
// element's innerHTML) and report every residual executable surface. The fixed-
// point machinery exists to make this empty even for parse-differential payloads,
// so the convergence tests below assert it.
const liveDangerousSurface = (
  output: string
): { tags: string[]; handlers: string[] } => {
  const live = document.createElement("div");
  live.innerHTML = output;
  const tags: string[] = [];
  const handlers: string[] = [];
  live.querySelectorAll("*").forEach((el) => {
    const tag = el.tagName.toLowerCase();
    if (/^(script|iframe|object|embed|foreignobject|form|noscript|frame)$/.test(tag)) {
      tags.push(tag);
    }
    Array.from(el.attributes).forEach((attr) => {
      if (attr.name.toLowerCase().startsWith("on")) handlers.push(attr.name.toLowerCase());
    });
  });
  return { tags, handlers };
};

describe("sanitize fixed-point machinery (Notidian-2lg)", () => {
  it("runs against a real DOM (no node-env early return)", () => {
    expect(typeof document).not.toBe("undefined");
    // Real DOM work happened, not the "" early return: benign markup survives.
    expect(sanitizeRenderedHtml("<b>x</b>").toLowerCase()).toContain("<b>");
    expect(sanitizeFrameText("<b>x</b>").toLowerCase()).toContain("<b>");
    expect(sanitizeIconSVG("<svg><path d='M0 0'/></svg>").toLowerCase()).toContain(
      "<path"
    );
  });

  // -------------------------------------------------------------------------
  // (A) The sanitize.ts:146 exhaustiveness claim. EVERY standard HTML element
  //     name, wrapping a benign payload + a benign sibling, must yield a fixed
  //     point on every sink. <plaintext> is the lone element that WOULD diverge
  //     without collapsePlaintextElements — its presence in the list makes this a
  //     genuine regression net for the collapse, and a red flag for any new quirk.
  // -------------------------------------------------------------------------
  describe("(A) exhaustive element-name fixed-point scan — pins sanitize.ts:146", () => {
    for (const { name, fn } of SINKS) {
      it(`${name}: every standard HTML element name yields a fixed point`, () => {
        // Collect ALL offenders before asserting, so a failure names every
        // non-idempotent element at once (not just the first) — that is the
        // actionable "real find" report the bead asks for.
        const offenders: Array<{ tag: string; once: string; twice: string }> = [];
        for (const tag of ALL_HTML_ELEMENT_NAMES) {
          // A benign payload with an attribute, plus a benign sibling, so a
          // divergence that ALSO destroyed the neighbour is caught here too.
          const input = `<${tag} title="t">benign-content</${tag}><span>neighbour</span>`;
          const once = fn(input);
          const twice = fn(once);
          if (twice !== once) offenders.push({ tag, once, twice });
        }
        // FAILING STATE = any non-idempotent element. The message lists each
        // offender's tag + the diverging output so a real find is immediately
        // diagnosable (and a follow-up bead can be filed without re-deriving it).
        expect(offenders).toEqual([]);
      });
    }

    it("the lone known offender <plaintext> is in the scanned corpus (guard)", () => {
      // If <plaintext> ever fell out of the list the exhaustiveness scan above
      // would silently stop covering the one element that actually diverges.
      expect(ALL_HTML_ELEMENT_NAMES).toContain("plaintext");
    });

    it("every scanned element output is ALSO a fixed point of a SECOND extra pass", () => {
      // The :146 claim is specifically that the loop CONVERGES (a fixed point is
      // reached), not merely that pass 1 == pass 2. Pin that pass(out) is stable
      // for two extra passes across the whole corpus and every sink.
      for (const { fn } of SINKS) {
        for (const tag of ALL_HTML_ELEMENT_NAMES) {
          const out = fn(`<${tag}>x</${tag}>y`);
          expect(fn(fn(out))).toBe(out);
        }
      }
    });
  });

  // -------------------------------------------------------------------------
  // (B) sanitizeIconSVG <plaintext> collapse (sanitize.ts:289). The icon sink had
  //     no <plaintext> coverage; its source claims a top-level <plaintext> "cannot
  //     diverge the fixed-point loop" and inside <svg> "is harmless foreign content
  //     and converges anyway". Pin both, plus the no-data-loss / inert-escaping
  //     guarantees.
  // -------------------------------------------------------------------------
  describe("(B) sanitizeIconSVG collapses <plaintext> without divergence or data-loss", () => {
    it("a top-level <plaintext> collapses to inert text and reaches a fixed point", () => {
      const out = sanitizeIconSVG("<plaintext>rest of the icon markup");
      // Not destroyed to "" (the pre-collapse divergence regression), and the
      // <plaintext> tag itself is gone (collapsed to its text node).
      expect(out).not.toBe("");
      expect(out.toLowerCase()).not.toContain("<plaintext");
      expect(out).toContain("rest of the icon markup");
      // Fixed point: re-sanitising changes nothing (no unbounded </plaintext> growth).
      expect(sanitizeIconSVG(out)).toBe(out);
    });

    it("a top-level <plaintext> keeps a benign sibling AND text past it (no data-loss)", () => {
      const out = sanitizeIconSVG('<svg><circle r="2"/></svg><plaintext>trailing text');
      expect(out).not.toBe("");
      // The benign element before <plaintext> survives.
      expect(out.toLowerCase()).toContain("<circle");
      // The text the <plaintext> swallowed is preserved as literal text.
      expect(out).toContain("trailing text");
      expect(sanitizeIconSVG(out)).toBe(out);
    });

    it("a <plaintext>-smuggled onerror comes back ESCAPED, never a live handler", () => {
      // Everything after <plaintext> is raw text in every parse, so a smuggled
      // <img onerror> must be neutralised to inert literal text, not resurrected.
      const out = sanitizeIconSVG("<plaintext><img src=x onerror=alert(1)>");
      expect(out).not.toBe("");
      // No live <img>/handler after a real innerHTML re-parse (the actual sink).
      const surface = liveDangerousSurface(out);
      expect(surface.handlers).toEqual([]);
      const live = document.createElement("div");
      live.innerHTML = out;
      expect(live.querySelectorAll("img").length).toBe(0);
      // The payload survives as escaped literal text (visible, inert).
      expect(out.toLowerCase()).toContain("onerror");
      expect(out).toContain("&lt;img");
      expect(sanitizeIconSVG(out)).toBe(out);
    });

    it("a <plaintext> nested inside <svg> foreign content also converges", () => {
      const out = sanitizeIconSVG("<svg><plaintext>x</plaintext><path d='M0 0'/></svg>");
      expect(out).not.toBe("");
      expect(sanitizeIconSVG(out)).toBe(out);
    });

    it("a corpus of <plaintext> icon shapes never diverges or destroys to ''", () => {
      const shapes = [
        "<plaintext>",
        "<plaintext>tail",
        "before<plaintext>after",
        "<svg><plaintext>inside</plaintext></svg>",
        "<g><plaintext>x</g>",
        "<plaintext><script>evil()</script>",
        "<defs></defs><plaintext>markup<plaintext>more",
      ];
      for (const s of shapes) {
        const once = sanitizeIconSVG(s);
        // Inputs carrying visible words must not collapse to "".
        if (/[a-z]/.test(s.replace(/<[^>]*>/g, ""))) {
          expect(once).not.toBe("");
        }
        expect(sanitizeIconSVG(once)).toBe(once); // fixed point, no </plaintext> growth
        expect(liveDangerousSurface(once).handlers).toEqual([]);
      }
    });
  });

  // -------------------------------------------------------------------------
  // (C) The cap -> escapeHtml(original) fail-safe contract (sanitize.ts:187).
  //     Per the bead, pinned via the OBSERVABLE INVARIANT rather than a mocked
  //     divergent parser (no standard element diverges — pinned by (A), so the
  //     branch is unreachable through the public API): every output is a fixed
  //     point of one more pass, and a benign-text input never silently becomes "".
  // -------------------------------------------------------------------------
  describe("(C) cap -> escapeHtml fail-safe: non-destructive convergence contract", () => {
    // A corpus mixing benign formatting, dangerous constructs, mXSS integration-
    // point fragments, and the <plaintext> divergence trigger — the inputs most
    // likely to stress convergence and (pre-fix) trip the cap. EVERY entry carries
    // a benign sentinel (the word "keepme") OUTSIDE any dangerous element, so the
    // non-destructive contract is testable: a correct sanitiser must preserve that
    // sentinel — it can only vanish if the whole input was wrongly destroyed (the
    // "" regression the escapeHtml fallback exists to prevent). (Benign text that
    // lives INSIDE a dangerous element, e.g. a <form>'s only child, is legitimately
    // removed with the element — that is normal stripping, not the fallback path —
    // so the sentinel is deliberately placed outside.)
    const CORPUS = [
      "keepme Hello world",
      "<b>bold</b> and <i>italic</i> keepme",
      '<a href="note.md">link</a><span>after</span> keepme',
      "keepme <plaintext>rest of my note",
      "<b>note</b> keepme<plaintext>tail",
      "keepme before <plaintext> <img src=x onerror=alert(1)> after",
      "keepme<math><mtext><mglyph><style><img src=x onerror=alert(1)></style></mglyph></math>",
      "keepme<svg><style><img src=1 onerror=alert(1)></style></svg>",
      'keepme<form action="javascript:y()"><button formaction="javascript:z()">b</button></form>',
      "keepme<table><caption><svg><style><img src=x onerror=alert(1)>",
      "<div>before<plaintext>after</div>keepme",
      "keepme plain note with <plaintext> followed by lots of trailing prose to swallow",
    ];

    for (const { name, fn } of SINKS) {
      it(`${name}: every corpus output is a fixed point of one MORE pass`, () => {
        // This is the exact guarantee sanitize.ts:187 enforces: the returned value,
        // re-run once more, is unchanged (the loop converged) — never a value that
        // would keep changing. If convergence ever failed, the fallback would
        // escape; either way the result is stable under another pass.
        for (const input of CORPUS) {
          const out = fn(input);
          expect(fn(out)).toBe(out);
        }
      });

      it(`${name}: benign content OUTSIDE dangerous elements is NEVER silently lost to ""`, () => {
        // The whole point of the escapeHtml fallback over "": content stays visible.
        // Each corpus entry carries a "keepme" sentinel outside any dangerous
        // element; a correct sanitiser must keep it (and so must yield a non-empty
        // result). The FAILING state is the sentinel vanishing — i.e. the whole
        // input collapsing, the regression sanitize.ts:184-187 guards against.
        for (const input of CORPUS) {
          const out = fn(input);
          expect(out).not.toBe("");
          expect(out).toContain("keepme");
        }
      });
    }

    it("escapeHtml(input) — the fallback target — is itself inert AND non-empty", () => {
      // Pins WHY escapeHtml(original) is the correct fail-safe and "" is not: the
      // fallback is non-destructive (non-empty for non-empty input) and carries no
      // executable surface (a live re-parse exposes no element/handler at all).
      const dangerous = [
        '<img src=x onerror="alert(1)">',
        "<script>evil()</script>",
        "<plaintext><iframe src=javascript:y()>",
        "Hello <b>world</b>",
      ];
      for (const input of dangerous) {
        const escaped = escapeHtml(input);
        expect(escaped).not.toBe(""); // non-destructive
        expect(escaped).not.toContain("<"); // every < became &lt; — no live markup
        const live = document.createElement("div");
        live.innerHTML = escaped;
        // Escaped text re-parses to a SINGLE text node: zero elements, zero handlers.
        expect(live.querySelectorAll("*").length).toBe(0);
        expect(liveDangerousSurface(escaped)).toEqual({ tags: [], handlers: [] });
        // And escapeHtml is the identity for the visible characters of plain text.
        expect(escapeHtml("Project Notes 2026")).toBe("Project Notes 2026");
      }
    });

    it("the documented invariant holds across the whole corpus on every sink: fixed point AND benign content kept", () => {
      // One combined assertion of the sanitize.ts:182-187 contract: for any input,
      // sanitize(input) is a fixed point of one more pass (converged or escaped),
      // and benign content outside dangerous elements is never discarded.
      for (const { fn } of SINKS) {
        for (const input of CORPUS) {
          const out = fn(input);
          expect(fn(out)).toBe(out);
          expect(out).toContain("keepme");
        }
      }
    });
  });
});
