/**
 * @jest-environment jsdom
 */
// Adversarial coverage for neutralizeCssFetches — the regex-based CSS
// remote-fetch chokepoint in src/shared/utils/sanitize.ts (added in
// Notidian-m9r, found by the Notidian-5jk adversarial sweep). It is the SHARED
// CSS-neutraliser behind all three DOM sanitizers (sanitizeIconSVG,
// sanitizeRenderedHtml, sanitizeFrameText), so a regression here weakens every
// vault-content innerHTML/SVG/frame sink at once. This file (Notidian-hef) locks
// the CURRENT security contract against regression and — critically — makes the
// documented UNDER-block boundary EXPLICIT instead of letting an exotic
// escape-obfuscation payload silently pass.
//
// neutralizeCssFetches is module-private, so it is exercised through the two
// public sinks that route BOTH code paths it has:
//   - the <style> textContent path  (CSS rule blocks), and
//   - the inline style="" attribute path.
// sanitizeIconSVG drives the SVG side of both; sanitizeRenderedHtml drives the
// HTML side of both. Testing through the real sinks (an inert <template> + jsdom
// serialisation) means we prove the genuine chokepoint, not a private string fn
// in isolation. The default jest env is 'node' (no document), where these sinks
// early-return ""; the docblock above opts THIS file into jsdom.
//
// Contract neutralizeCssFetches must hold (sanitize.ts:44-63):
//   DROP   @import rules entirely (url(...) or bare-string form),
//   REWRITE any url(...) that is not a same-document fragment (#id) or an inline
//          data:image to an empty url(),
//   PRESERVE url(#id) refs and inline data:image rasters,
//   be IDEMPOTENT and CASE-INSENSITIVE.
// Risk closed: a remote FETCH (icon phoning home / SSRF / tracking beacon). CSS
// cannot execute script in this context, so even the documented gaps below are
// fetch-only, never RCE.
import {
  sanitizeIconSVG,
  sanitizeRenderedHtml,
} from "shared/utils/sanitize";

// Assertions normalise to lower case and check token presence/absence rather
// than exact serialisation, so they survive jsdom's attribute/case quirks.
const svg = (css: string): string =>
  sanitizeIconSVG(css).toLowerCase();
const html = (css: string): string =>
  sanitizeRenderedHtml(css).toLowerCase();

// Wrap a CSS declaration in a <style> block and in an inline style="" attribute,
// for each of the SVG and HTML sinks — the four entry points neutralizeCssFetches
// is reachable from. A matcher run across all four proves the neutraliser, not an
// accident of one wrapper.
const styleBlockSvg = (decl: string): string =>
  svg(`<svg><style>.a{${decl}}</style><rect class="a"/></svg>`);
const styleAttrSvg = (decl: string): string =>
  svg(`<svg><rect style="${decl}"/></svg>`);
const styleBlockHtml = (decl: string): string =>
  html(`<style>.a{${decl}}</style><div class="a">t</div>`);
const styleAttrHtml = (decl: string): string =>
  html(`<div style="${decl}">t</div>`);

const ALL_SINKS: Array<[string, (decl: string) => string]> = [
  ["SVG <style> block", styleBlockSvg],
  ["SVG inline style attr", styleAttrSvg],
  ["HTML <style> block", styleBlockHtml],
  ["HTML inline style attr", styleAttrHtml],
];

describe("neutralizeCssFetches — runs against a real DOM (Notidian-hef)", () => {
  it("document is defined, so the sinks do real work (no node early-return)", () => {
    expect(typeof document).not.toBe("undefined");
    // A pure-shape rule survives — proving the function ran, not the "" early
    // return (which would yield no rule at all).
    expect(styleBlockSvg("fill:#0a0")).toContain("fill:#0a0");
  });
});

describe("@import is dropped entirely (Notidian-hef)", () => {
  // @import is the strongest remote-fetch primitive in CSS: it pulls an entire
  // foreign stylesheet. Both the url() form and the bare-string form must vanish.
  it("drops @import url(remote) — quoted and unquoted", () => {
    const cases = [
      '@import url(http://evil.example/x.css);.a{fill:#0a0}',
      "@import url('http://evil.example/x.css');.a{fill:#0a0}",
      '@import url("http://evil.example/x.css");.a{fill:#0a0}',
    ];
    for (const css of cases) {
      const r = svg(`<svg><style>${css}</style><path class="a"/></svg>`);
      expect(r).not.toContain("@import");
      expect(r).not.toContain("evil.example");
      expect(r).toContain("fill:#0a0"); // the legit rule after it survives
    }
  });

  it("drops bare @import 'remote' / \"remote\" (no url() token)", () => {
    const cases = [
      `@import "http://evil.example/x.css";.b{fill:#111}`,
      `@import 'http://evil.example/x.css';.b{fill:#111}`,
    ];
    for (const css of cases) {
      const r = html(`<style>${css}</style><div class="b">t</div>`);
      expect(r).not.toContain("@import");
      expect(r).not.toContain("evil.example");
      expect(r).toContain("fill:#111");
    }
  });

  it("drops @import with trailing media-query clauses up to the ; (no leak)", () => {
    const r = html(
      '<style>@import url(http://evil.example/x.css) screen and (max-width:600px);.a{fill:#0a0}</style><p class="a">t</p>'
    );
    expect(r).not.toContain("@import");
    expect(r).not.toContain("evil.example");
    expect(r).not.toContain("max-width");
    expect(r).toContain("fill:#0a0");
  });
});

describe("remote url() is neutralised across every CSS property (Notidian-hef)", () => {
  // The neutraliser is property-agnostic (it matches the url() token, not the
  // property), but a regression could be introduced by a future property-name
  // allowlist, so prove the whole remote-fetch property surface explicitly.
  const REMOTE_PROPS: Array<[string, string]> = [
    ["background", "background:url(http://evil.example/bg.png)"],
    ["background-image", "background-image:url(http://evil.example/bg.png)"],
    ["cursor", "cursor:url(http://evil.example/c.cur),auto"],
    ["mask", "mask:url(http://evil.example/m.svg)"],
    ["mask-image", "mask-image:url(http://evil.example/m.svg)"],
    ["list-style-image", "list-style-image:url(http://evil.example/b.png)"],
    ["border-image", "border-image:url(http://evil.example/bi.png) 30"],
    ["content", "content:url(http://evil.example/c.png)"],
    ["fill", "fill:url(http://evil.example/p.svg)"],
    ["filter", "filter:url(http://evil.example/f.svg#blur)"],
  ];

  for (const [name, decl] of REMOTE_PROPS) {
    it(`neutralises ${name}:url(remote) in all four sinks`, () => {
      for (const [, sink] of ALL_SINKS) {
        const r = sink(decl);
        expect(r).not.toContain("evil.example"); // remote host gone
        expect(r).not.toContain("http://");
        expect(r).toContain("url()"); // collapsed to the empty, inert form
      }
    });
  }
});

describe("every remote URL SCHEME shape is neutralised (Notidian-hef)", () => {
  // The allowlist keeps only #fragment and data:image; EVERYTHING else — including
  // schemes a naive denylist would miss — must collapse to url().
  const REMOTE_SCHEMES: Array<[string, string]> = [
    ["http", "url(http://evil.example/x.png)"],
    ["https", "url(https://evil.example/x.png)"],
    ["protocol-relative //", "url(//evil.example/x.png)"],
    ["ftp", "url(ftp://evil.example/x)"],
    ["file", "url(file:///etc/passwd)"],
    // Markup-free target: an embedded <b> in a url() is a raw-text/<style>
    // parser concern handled by the tag-stripping path, not by this neutraliser.
    ["data:text/html (non-image data)", "url(data:text/html;charset=utf-8,xx)"],
    ["data:application/json", "url(data:application/json,xx)"],
    ["bare relative path", "url(/abs/path/track.png)"],
    ["bare host-relative", "url(track.png)"],
  ];

  for (const [name, decl] of REMOTE_SCHEMES) {
    it(`neutralises background:${name}`, () => {
      for (const [, sink] of ALL_SINKS) {
        const r = sink(`background:${decl}`);
        expect(r).toContain("url()");
        expect(r).not.toContain("evil.example");
        expect(r).not.toContain("/etc/passwd");
        expect(r).not.toContain("data:text/html");
        expect(r).not.toContain("data:application/json");
        expect(r).not.toContain("track.png");
      }
    });
  }
});

describe("allowlist is PRESERVED — #fragment and data:image survive (Notidian-hef)", () => {
  it("keeps url(#id) same-document fragment refs (gradients, masks, filters)", () => {
    for (const [, sink] of ALL_SINKS) {
      expect(sink("fill:url(#grad)")).toContain("url(#grad)");
      expect(sink("mask:url(#m1)")).toContain("url(#m1)");
      expect(sink("filter:url(#blur)")).toContain("url(#blur)");
    }
  });

  it("keeps inline data:image rasters (quoted and unquoted)", () => {
    for (const [, sink] of ALL_SINKS) {
      expect(sink("background:url(data:image/png;base64,AAAA)")).toContain(
        "data:image/png"
      );
      expect(sink("background:url('data:image/png;base64,AAAA')")).toContain(
        "data:image/png"
      );
      expect(sink("background:url(data:image/svg+xml;base64,PHN2Zz4=)")).toContain(
        "data:image/svg"
      );
    }
  });

  it("keeps the local fragment while neutralising remote siblings in one decl", () => {
    for (const [, sink] of ALL_SINKS) {
      const r = sink(
        "background:url(http://evil.example/a.png),url(#grad),url(https://evil.example/b.png)"
      );
      expect(r).not.toContain("evil.example");
      expect(r).toContain("url(#grad)");
      // exactly the two remote ones collapsed
      expect(r.match(/url\(\)/g)?.length).toBe(2);
    }
  });

  it("does NOT over-block a legit local rule that merely mentions a url-ish word", () => {
    for (const [, sink] of ALL_SINKS) {
      const r = sink("background-color:#abc;color:#123");
      expect(r).toContain("#abc");
      expect(r).toContain("#123");
      expect(r).not.toContain("url()");
    }
  });
});

// ===========================================================================
// SCOPE REGRESSION: data:image/svg+xml STAYS allowed in CSS url() (Notidian-w9qm).
//
// Notidian-vvoj blocks data:image/svg+xml in the NAVIGABLE HTML URL attrs
// (href/xlink:href/src/...) because an SVG navigated-to / resolved-as-document
// runs its own <script>/onload. The CSS image context is DIFFERENT: a CSS url()
// (background/fill/mask/cursor/...) loads the SVG as an IMAGE SOURCE, which renders
// the SVG's pixels WITHOUT executing its script — exactly like a raster <img src>.
// So neutralizeCssFetches must KEEP data:image/svg+xml (its allowlist is
// `#fragment` | `data:image/*`, deliberately MIME-agnostic). These tests pin that
// the svg+xml fix did NOT leak into the CSS neutraliser — proving the block is
// scoped to navigable HTML attrs only. If a future change extends the svg+xml block
// into neutralizeCssFetches, these go red (the inline svg image would be wrongly
// collapsed to url()).
// ===========================================================================
describe("data:image/svg+xml STAYS allowed in CSS url() — image context is inert (Notidian-w9qm)", () => {
  // Every form the navigable-attr block treats as dangerous must, in the CSS image
  // context, be PRESERVED (collapsed-to-url() would be the failure).
  const SVG_URLS = [
    "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=",
    "data:image/svg+xml;charset=utf-8,<svg></svg>",
    "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg'></svg>",
  ];

  it("keeps a data:image/svg+xml url() across all four CSS sinks", () => {
    for (const uri of SVG_URLS) {
      for (const [, sink] of ALL_SINKS) {
        const r = sink(`background:url(${uri})`);
        // The svg data-URI image survives — NOT collapsed to the empty url().
        expect(r).toContain("data:image/svg");
        expect(r).not.toMatch(/url\(\s*\)/);
      }
    }
  });

  it("keeps an svg+xml url() across image properties (fill/mask/cursor/content)", () => {
    const uri = "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=";
    const props = ["fill", "mask", "mask-image", "cursor", "content", "border-image"];
    for (const prop of props) {
      for (const [, sink] of ALL_SINKS) {
        const r = sink(`${prop}:url(${uri})`);
        expect(r).toContain("data:image/svg");
      }
    }
  });

  it("keeps the svg+xml image while neutralising a remote sibling in the SAME decl", () => {
    // Proves the keep is selective (the allowlist), not a blanket pass: the remote
    // url() is still collapsed, the inline svg image is still kept.
    for (const [, sink] of ALL_SINKS) {
      const r = sink(
        "background:url(http://evil.example/a.png),url(data:image/svg+xml;base64,PHN2Zz4=)"
      );
      expect(r).not.toContain("evil.example");
      expect(r).toContain("data:image/svg");
      expect(r.match(/url\(\)/g)?.length).toBe(1); // only the remote one collapsed
    }
  });
});

describe("quoting and whitespace variants are handled (Notidian-hef)", () => {
  it("neutralises single-quoted, double-quoted, and unquoted remote url()", () => {
    for (const [, sink] of ALL_SINKS) {
      expect(sink("background:url('http://evil.example/x')")).not.toContain(
        "evil.example"
      );
      expect(sink("background:url(http://evil.example/x)")).not.toContain(
        "evil.example"
      );
    }
    // &quot; entity-encoded double quotes are decoded by the HTML parser first.
    expect(
      html('<div style="background:url(&quot;http://evil.example/y&quot;)">t</div>')
    ).not.toContain("evil.example");
  });

  it("neutralises url() with leading/trailing/internal whitespace around the target", () => {
    for (const [, sink] of ALL_SINKS) {
      const r = sink("background:url(   http://evil.example/x.png   )");
      expect(r).not.toContain("evil.example");
      expect(r).toContain("url()");
    }
  });

  it("still PRESERVES a #fragment that has surrounding whitespace", () => {
    // The neutraliser strips internal whitespace before the #/data: test, so a
    // padded fragment is still recognised as local and kept (re-emitted via the
    // original match text).
    for (const [, sink] of ALL_SINKS) {
      expect(sink("fill:url(  #grad  )")).toContain("#grad");
    }
  });
});

describe("CASE-INSENSITIVITY — URL() and @IMPORT in any case (Notidian-hef)", () => {
  it("neutralises uppercase / mixed-case URL( token)", () => {
    for (const [, sink] of ALL_SINKS) {
      expect(sink("background:URL(http://evil.example/x)")).toContain("url()");
      expect(sink("background:Url(http://evil.example/x)")).toContain("url()");
      expect(sink("background:uRL(http://evil.example/x)")).not.toContain(
        "evil.example"
      );
    }
  });

  it("preserves a #fragment regardless of URL-token case", () => {
    for (const [, sink] of ALL_SINKS) {
      // jsdom may lower-case the token on re-serialisation; assert the kept
      // payload (#grad) survives rather than the token's exact case.
      expect(sink("fill:URL(#grad)").replace(/\s+/g, "")).toContain("(#grad)");
    }
  });

  it("drops @IMPORT / @Import in any case", () => {
    const cases = ["@IMPORT", "@Import", "@iMpOrT"];
    for (const kw of cases) {
      const r = html(
        `<style>${kw} url(http://evil.example/x.css);.a{fill:#0a0}</style><p class="a">t</p>`
      );
      expect(r).not.toContain("@import");
      expect(r).not.toContain("evil.example");
      expect(r).toContain("fill:#0a0");
    }
  });
});

describe("IDEMPOTENCY — output is a fixed point (Notidian-hef)", () => {
  // A sanitised value can be re-stored and re-sanitised on the next paint
  // (sanitizeFrameText round-trip), so neutralizeCssFetches MUST be stable: a
  // second pass changes nothing, and no entity/escape can resurrect a fetch.
  const PAYLOADS = [
    "background:url(http://evil.example/a.png),url(#grad)",
    "fill:url(#grad);background:url(https://evil.example/b.png)",
    "background:url(data:image/png;base64,AAAA)",
    "cursor:url(//evil.example/c.cur),auto",
  ];

  it("sanitizeIconSVG: second pass over a <style> block equals the first", () => {
    for (const decl of PAYLOADS) {
      const once = sanitizeIconSVG(`<svg><style>.a{${decl}}</style></svg>`);
      const twice = sanitizeIconSVG(once);
      expect(twice).toBe(once);
    }
  });

  it("sanitizeIconSVG: second pass over an inline style attr equals the first", () => {
    for (const decl of PAYLOADS) {
      const once = sanitizeIconSVG(`<svg><rect style="${decl}"/></svg>`);
      const twice = sanitizeIconSVG(once);
      expect(twice).toBe(once);
    }
  });

  it("sanitizeRenderedHtml: second pass equals the first (block + attr + @import)", () => {
    const docs = [
      ...PAYLOADS.map((d) => `<style>.a{${d}}</style>`),
      ...PAYLOADS.map((d) => `<div style="${d}">t</div>`),
      '<style>@import url(http://evil.example/x.css);.a{fill:#0a0}</style>',
    ];
    for (const doc of docs) {
      const once = sanitizeRenderedHtml(doc);
      const twice = sanitizeRenderedHtml(once);
      expect(twice).toBe(once);
    }
  });

  it("re-parsed neutralised output exposes no remote url() target", () => {
    for (const decl of PAYLOADS) {
      const out = sanitizeRenderedHtml(`<div style="${decl}">t</div>`);
      const probe = document.createElement("template");
      probe.innerHTML = out;
      probe.content.querySelectorAll("*").forEach((el) => {
        const style = el.getAttribute("style") ?? "";
        // every surviving url() is either empty, a #fragment, or data:image
        for (const m of style.matchAll(/url\(([^)]*)\)/gi)) {
          const target = m[1].replace(/['"\s]/g, "").toLowerCase();
          const ok =
            target === "" ||
            target.startsWith("#") ||
            target.startsWith("data:image/");
          expect(ok).toBe(true);
        }
      });
    }
  });
});

// ===========================================================================
// PREVIOUSLY-DOCUMENTED UNDER-BLOCK BOUNDARY — NOW CLOSED (Notidian-hef -> Notidian-35q)
//
// The neutraliser was regex-based over the RAW CSS and matched only the LITERAL
// `url(` / `@import` tokens, so three spec-legal obfuscations a browser still
// resolves as a remote fetch slipped through: hex/unicode escapes (\75rl(...)),
// comment-split tokens (u/**/rl(...)), and quote-mismatch (url("...')). The
// Notidian-hef sweep PINNED that gap (active `it`s asserting it survived) and left
// `xit` placeholders for the desired post-fix behavior. Notidian-35q closed the
// gap by NORMALISING first — strip CSS comments, decode CSS escapes — so the
// neutraliser sees the same tokens a browser will, then re-deriving the url()
// target with a quote-tolerant capture that can't leak on mismatched quotes.
//
// In lockstep with that fix (the file's contract is "the boundary can never drift
// unnoticed"), the once-CURRENT assertions below were FLIPPED from "the gap
// survives" to "the gap is closed", and the DESIRED `xit` block was promoted to
// `it`. These payloads were always FETCH-only (CSS cannot execute script in this
// innerHTML context), so the risk they closed is SSRF / tracking-beacon, never RCE.
// ===========================================================================
describe("formerly-documented under-block gaps — NOW CLOSED (Notidian-35q)", () => {
  it("CSS hex escape \\75rl(...) is neutralised (\\75 = 'u', decoded before matching)", () => {
    // A browser decodes the \75 escape to `u`, resolving `url(...)` and fetching.
    // The neutraliser now decodes the escape first, so the remote target collapses.
    const r = svg('<svg><style>.a{background:\\75rl(http://evil.example/x)}</style></svg>');
    expect(r).not.toContain("evil.example"); // <-- gap CLOSED (Notidian-35q)
    // The obfuscated token is decoded, so the literal escape sequence is gone too.
    expect(r).not.toContain("\\75rl(");
    expect(r).toContain("url()"); // collapsed to the empty, inert form
  });

  it("comment-split u/**/rl(...) is neutralised (comments stripped before matching)", () => {
    // CSS strips comments before tokenising, so `u/**/rl(...)` is a real url() to
    // a browser; the neutraliser now strips comments first and collapses it.
    const r = html('<style>.a{background:u/**/rl(http://evil.example/x)}</style>');
    expect(r).not.toContain("evil.example"); // <-- gap CLOSED (Notidian-35q)
    expect(r).not.toContain("u/**/rl("); // the split token is gone
    expect(r).toContain("url()");
  });

  it("quote-mismatch url(\"...') no longer leaks the remote target", () => {
    // The quote-tolerant capture takes everything up to the closing paren and
    // strips stray quote chars before the allowlist test, so a mismatched pair
    // (opening " / closing ') can't smuggle the remote target through.
    const r = html(
      `<div style="background:url(&quot;http://evil.example/x')">t</div>`
    );
    expect(r).not.toContain("evil.example"); // <-- gap CLOSED (Notidian-35q)
  });

  it("the fix is BOUNDED — a sibling local rule is still sanitised normally", () => {
    // Alongside a (now-decoded) escaped token the neutraliser still collapses a
    // plain remote url() in the same block: BOTH remote tokens are neutralised, so
    // the rule remains intact — the fix closed the gap without over- or under-block.
    const r = svg(
      '<svg><style>.a{background:\\75rl(http://evil.example/x)}.b{background:url(http://other.example/y)}</style></svg>'
    );
    expect(r).not.toContain("other.example"); // plain url() neutralised
    expect(r).not.toContain("evil.example"); // escaped url() now also neutralised
    expect(r.match(/url\(\)/g)?.length).toBe(2); // both collapsed
  });
});

describe("closed under-block gaps — DESIRED behavior now holds (Notidian-35q)", () => {
  // These encoded what hardening should achieve; Notidian-35q landed the fix and
  // promoted them from xit -> it. They are intentionally kept as a second,
  // assertion-only restatement of the same contract as the block above.
  it("decodes CSS hex escapes before matching \\75rl(remote)", () => {
    const r = svg('<svg><style>.a{background:\\75rl(http://evil.example/x)}</style></svg>');
    expect(r).not.toContain("evil.example");
  });

  it("strips CSS comments so u/**/rl(remote) is neutralised", () => {
    const r = html('<style>.a{background:u/**/rl(http://evil.example/x)}</style>');
    expect(r).not.toContain("evil.example");
  });

  it("handles quote-mismatch url(\"...') without leaking the target", () => {
    const r = html(
      `<div style="background:url(&quot;http://evil.example/x')">t</div>`
    );
    expect(r).not.toContain("evil.example");
  });
});

describe("fail-safe contract is unaffected by CSS neutralisation (Notidian-hef)", () => {
  it("empty / non-string input still yields empty string for both sinks", () => {
    expect(sanitizeIconSVG("")).toBe("");
    expect(sanitizeRenderedHtml("")).toBe("");
    expect(sanitizeIconSVG(null as unknown as string)).toBe("");
    expect(sanitizeRenderedHtml(undefined as unknown as string)).toBe("");
  });

  it("a CSS-only payload with no shapes still returns a string", () => {
    expect(typeof sanitizeRenderedHtml('<style>.a{background:url(http://x/y)}</style>')).toBe(
      "string"
    );
  });
});
