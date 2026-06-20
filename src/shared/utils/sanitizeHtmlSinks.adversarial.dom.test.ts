/**
 * @jest-environment jsdom
 */
// Adversarial + property DEPTH for the two remaining shared sanitize.ts innerHTML
// sinks — sanitizeRenderedHtml (markdown->HTML pipeline: FileLinkViewComponent note
// preview + markdownAdapter canvas-thumbnail foreignObject) and sanitizeFrameText
// (TextNodeView dangerouslySetInnerHTML, contentEditable round-trip) — bringing them
// to the depth sanitizeIconSVG (sanitize.dom.test.ts) and neutralizeCssFetches
// (neutralizeCssFetches.dom.test.ts) already have. bd Notidian-y3h.
//
// Design contract for every assertion below: the FAILING state is the dangerous
// payload SURVIVING. Each test asserts the absence of an executable/fetch surface
// (or, for the round-trip property, exact equality), so a regression that lets a
// payload through turns the test red — never silently green. The default jest env is
// node (no document), where every function early-returns ""; this file opts into
// jsdom so the real DOM template parse/serialise round-trip — the actual sink
// behaviour — is exercised. It imports no React/testing-library, keeping the
// transform surface narrow (matching the sibling .dom.test.ts files).
//
// Verification helpers re-parse the sanitiser OUTPUT into a LIVE element and inspect
// the resulting tree, because the real sinks assign the output to a live element's
// innerHTML / dangerouslySetInnerHTML — that re-parse is where a parse-differential
// mutation-XSS would resurrect a stripped handler, so a string-only assertion is not
// enough.
import {
  sanitizeFrameText,
  sanitizeRenderedHtml,
} from "shared/utils/sanitize";

// The two sinks share identical element/attribute rules, so each adversarial case
// is run against BOTH via this table — neither sink may diverge.
const SINKS: Array<{ name: string; fn: (s: string) => string }> = [
  { name: "sanitizeRenderedHtml", fn: sanitizeRenderedHtml },
  {
    name: "sanitizeFrameText",
    fn: (s: string) => sanitizeFrameText(s),
  },
];

// Mirror of the sanitiser's denylists (sanitize.ts) so a divergence in the source
// constants is caught by these tests rather than silently un-covered.
const HTML_DANGEROUS_TAGS = [
  "script",
  "foreignobject",
  "iframe",
  "object",
  "embed",
  "set",
  "animate",
  "animatetransform",
  "base",
  "meta",
  "link",
  "frame",
  "frameset",
  "applet",
  "form",
  "noscript",
];
const HTML_URL_ATTRS = [
  "href",
  "xlink:href",
  "src",
  "action",
  "formaction",
  "background",
  "poster",
  "data",
];

// The corrected dangerous-scheme contract, encoded ONCE and shared by every probe
// in this suite (Notidian-w9qm). It is a faithful mirror of sanitize.ts's
// hasDangerousUrlScheme: normalise exactly as the WHATWG URL parser does before it
// reads the scheme (strip ALL whitespace + the C0 control range, lower-case) and
// then classify. The load-bearing CORRECTION over the OLD allowlist this helper
// used to carry: a navigated-to / resolved-as-document `data:image/svg+xml` is
// ACTIVE content (it runs its own <script>/onload), so it is DANGEROUS in an
// HTML_URL_ATTR even though it shares the `data:image/` prefix — while inert raster
// `data:image/{png,jpeg,gif,webp,bmp}` stays safe. Entities are already decoded by
// the HTML parser by the time an attribute value is read here, so this sees the
// same literal text the real sink's predicate sees.
const normalizeUrlForScheme = (value: string): string =>
  // eslint-disable-next-line no-control-regex
  value.replace(/[\s\x00-\x1f]+/g, "").toLowerCase();

const isDangerousScheme = (rawAttrValue: string): boolean => {
  const v = normalizeUrlForScheme(rawAttrValue);
  if (v.startsWith("javascript:") || v.startsWith("vbscript:")) return true;
  if (v.startsWith("data:")) {
    // Any non-image data: payload (data:text/html, data:application/...) is
    // dangerous; among data:image/* only scriptable svg+xml is — raster is inert.
    if (!v.startsWith("data:image/")) return true;
    if (v.startsWith("data:image/svg+xml")) return true;
  }
  return false;
};

// Re-parse the sanitised output the way the real sink does (assign to a live
// element's innerHTML) and report every residual executable/fetch surface. This is
// the load-bearing check: it catches mXSS resurrection that a string scan misses.
// It now classifies URL attributes through isDangerousScheme above, so a resurrected
// data:image/svg+xml in a navigable attr is caught here too (it no longer rides the
// `data:image/` prefix past the probe — Notidian-w9qm).
type Surface = {
  dangerousTags: string[];
  onHandlers: string[];
  dangerousUrls: string[];
};
const probeLiveSurface = (output: string): Surface => {
  const live = document.createElement("div");
  live.innerHTML = output;
  const dangerousTags: string[] = [];
  const onHandlers: string[] = [];
  const dangerousUrls: string[] = [];
  const dangerSet = new Set(HTML_DANGEROUS_TAGS);
  const urlSet = new Set(HTML_URL_ATTRS);
  live.querySelectorAll("*").forEach((el) => {
    const tag = el.tagName.toLowerCase();
    if (dangerSet.has(tag)) dangerousTags.push(tag);
    Array.from(el.attributes).forEach((attr) => {
      const name = attr.name.toLowerCase();
      if (name.startsWith("on")) onHandlers.push(name);
      if (urlSet.has(name) && isDangerousScheme(attr.value)) {
        dangerousUrls.push(`${name}=${normalizeUrlForScheme(attr.value)}`);
      }
    });
  });
  return { dangerousTags, onHandlers, dangerousUrls };
};

const expectInert = (output: string): void => {
  const surface = probeLiveSurface(output);
  // Each is its own assertion so a failure names the exact residual surface.
  expect(surface.dangerousTags).toEqual([]);
  expect(surface.onHandlers).toEqual([]);
  expect(surface.dangerousUrls).toEqual([]);
};

// A small, seedable PRNG so the generated-corpus loops are reproducible (a failure
// prints the exact input; re-running reproduces it). Same xorshift32 as the
// sibling escapeHtml property suite.
const makeRng = (seed: number): (() => number) => {
  let state = seed >>> 0;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state / 0xffffffff;
  };
};

describe("sanitize HTML sinks — jsdom adversarial depth (Notidian-y3h)", () => {
  it("runs against a real DOM (no node-env early return)", () => {
    expect(typeof document).not.toBe("undefined");
    // Formatting survives — proves real DOM work happened, not the "" early return.
    expect(sanitizeRenderedHtml("<b>x</b>").toLowerCase()).toContain("<b>");
    expect(sanitizeFrameText("<b>x</b>").toLowerCase()).toContain("<b>");
  });

  // -------------------------------------------------------------------------
  // (1) Every HTML_DANGEROUS_TAGS member, incl. mixed-case (case handled via
  //     tagName.toLowerCase — pin it so a switch to a case-sensitive selector
  //     would fail).
  // -------------------------------------------------------------------------
  describe("(1) removes every HTML_DANGEROUS_TAGS member", () => {
    for (const tag of HTML_DANGEROUS_TAGS) {
      for (const { name, fn } of SINKS) {
        it(`${name}: strips <${tag}> (lowercase) and keeps a safe sibling`, () => {
          const out = fn(`<div><${tag}></${tag}><p>keep</p></div>`);
          expect(out.toLowerCase()).not.toContain(`<${tag}`);
          expect(out.toLowerCase()).toContain("keep");
        });
      }
    }

    // Mixed/odd casing: the parser lower-cases HTML tag names, but SVG/MathML
    // foreign content preserves author case in tagName, so the sanitiser MUST
    // compare lower-cased. These mixed-case spellings must all be removed.
    const MIXED_CASE: Array<[string, string]> = [
      ["Script", "<Script>alert(1)</Script>"],
      ["ForeignObject", "<svg><ForeignObject><b>x</b></ForeignObject></svg>"],
      ["sEt", '<svg><sEt attributeName="onclick" to="alert(1)"/></svg>'],
      ["aniMate", '<svg><aniMate attributeName="href" to="javascript:x()"/></svg>'],
      [
        "aniMateTransform",
        '<svg><aniMateTransform attributeName="transform" type="rotate"/></svg>',
      ],
      ["IFRAME", '<IFRAME src="https://evil.example"></IFRAME>'],
      ["ObJeCt", '<ObJeCt data="x"></ObJeCt>'],
      ["NoScript", "<NoScript><b>x</b></NoScript>"],
    ];
    for (const [label, payload] of MIXED_CASE) {
      for (const { name, fn } of SINKS) {
        it(`${name}: strips mixed-case <${label}> (lower-cased tagName match)`, () => {
          const out = fn(`${payload}<p>keep</p>`).toLowerCase();
          expect(out).not.toContain(label.toLowerCase());
          expect(out).not.toContain("alert(1)");
          expect(out).not.toContain("javascript:");
          expect(out).not.toContain("evil.example");
          expect(out).toContain("keep");
        });
      }
    }

    it("SMIL <set>/<animate> cannot write an on* handler at runtime (both stripped)", () => {
      // The threat the SMIL set covers: a <set>/<animate> that targets an event
      // attribute or a URL attribute writes it AFTER the one-time static strip.
      // Removing the elements outright closes that.
      for (const { fn } of SINKS) {
        const out = fn(
          '<svg><rect/>' +
            '<set attributeName="onclick" to="alert(1)"/>' +
            '<animate attributeName="href" to="javascript:alert(1)"/>' +
            '<animateTransform attributeName="onload" to="x"/>' +
            "</svg>"
        ).toLowerCase();
        expect(out).not.toContain("<set");
        expect(out).not.toContain("<animate");
        expect(out).not.toContain("onclick");
        expect(out).not.toContain("javascript:");
      }
    });
  });

  // -------------------------------------------------------------------------
  // (2) on* handler stripping across odd casings / whitespace.
  // -------------------------------------------------------------------------
  describe("(2) drops on* handlers across odd casing / whitespace", () => {
    const ON_VARIANTS = [
      'onclick="a()"',
      'oNcLick="b()"',
      'ONERROR="c()"',
      'OnMouseOver="d()"',
      'onLoad="e()"',
      // An underscore-bearing name still starts with "on" after lower-casing; the
      // sanitiser is deliberately over-broad (drops anything starting with "on"),
      // which is safe — assert it is dropped.
      'on_error="f()"',
    ];
    for (const variant of ON_VARIANTS) {
      for (const { name, fn } of SINKS) {
        it(`${name}: drops ${variant} but keeps the element`, () => {
          const out = fn(`<span ${variant}>text</span>`).toLowerCase();
          expect(out).not.toMatch(/\bon[a-z_]*=/);
          expect(out).not.toMatch(/[a-f]\(\)/);
          expect(out).toContain("<span");
          expect(out).toContain("text");
        });
      }
    }

    it("a whitespace-split handler name does not reconstitute a live handler", () => {
      // The HTML parser treats interior whitespace as an attribute-name terminator,
      // so `on\tclick` becomes a boolean `on` attribute (dropped: starts with "on")
      // plus a `click` attribute — and `click` is NOT an event handler. Pin that the
      // live re-parse exposes no on* handler.
      for (const { fn } of SINKS) {
        const out = fn('<b on\tclick="alert(1)">x</b>');
        expect(probeLiveSurface(out).onHandlers).toEqual([]);
      }
    });

    it("drops onerror on an injected <img> (the classic innerHTML vector)", () => {
      for (const { fn } of SINKS) {
        const out = fn('<img src="x" onerror="alert(1)">caption').toLowerCase();
        expect(out).not.toContain("onerror");
        expect(out).not.toContain("alert(1)");
        expect(out).toContain("caption");
      }
    });
  });

  // -------------------------------------------------------------------------
  // (3) hasDangerousUrlScheme bypass attempts across ALL HTML_URL_ATTRS,
  //     including xlink:href, with C0-control / tab-newline-split / mixed-case /
  //     entity-pre-decoded forms (the Notidian-b81 class).
  // -------------------------------------------------------------------------
  describe("(3) dangerous-scheme URLs blocked across EVERY HTML_URL_ATTR", () => {
    const TAB = "\t";
    const LF = "\n";
    const CR = "\r";
    const FF = "\f";
    const C0_1 = String.fromCharCode(1);
    const C0_8 = String.fromCharCode(8);
    const C0_31 = String.fromCharCode(31);

    // Each obfuscation, after parser + sanitiser normalisation, must still be
    // recognised as the dangerous scheme `javascript:` and dropped. Every variant
    // here normalises (entities decoded by the HTML parser; tab/newline/C0 controls
    // stripped by hasDangerousUrlScheme) back to a value that STARTS WITH
    // `javascript:` — so the attribute must be removed.
    const obfuscate: Array<(scheme: string) => string> = [
      (s) => s, // plain
      (s) => s.toUpperCase(), // all caps
      (s) => s.replace("javascript", "JaVaScRiPt"), // mixed case
      (s) => s.replace("a", "a" + TAB).replace("i", "i" + LF), // tab/newline split inside scheme
      (s) => s.replace("v", "v" + FF).replace("s", "s" + CR), // formfeed/CR split inside scheme
      (s) => "java" + TAB + "script" + s.slice("javascript".length), // tab between keyword halves
      (s) => C0_1 + s, // leading C0 control (the b81 fix)
      (s) => C0_1 + C0_8 + C0_31 + s, // multiple leading C0 controls
      (s) => "  " + TAB + LF + " " + s, // leading mixed whitespace
    ];

    for (const attr of HTML_URL_ATTRS) {
      it(`blocks javascript: in ${attr} under every obfuscation`, () => {
        for (const fn of obfuscate) {
          const value = fn("javascript:alert(1)");
          // xlink:href is meaningful on SVG elements; use a host that carries the
          // attribute through the parser unchanged for each attr name.
          const html = `<svg><a ${attr}="${value}">x</a></svg>`;
          for (const { fn: sink } of SINKS) {
            const out = sink(html);
            // The load-bearing guarantee: a live re-parse exposes NO dangerous-scheme
            // URL attribute (the attribute was removed). A raw substring scan is too
            // coarse — a benign value can legitimately contain the letters
            // "javascript" — so the live surface is the authoritative check.
            expect(probeLiveSurface(out).dangerousUrls).toEqual([]);
          }
        }
      });
    }

    it("blocks vbscript: across attrs incl. xlink:href", () => {
      const variants = [
        "vbscript:msgbox(1)",
        "VBScript:msgbox(1)",
        "vb" + TAB + "script:msgbox(1)",
        C0_1 + "vbscript:msgbox(1)",
      ];
      for (const v of variants) {
        for (const attr of ["href", "xlink:href", "src", "poster"]) {
          for (const { fn } of SINKS) {
            const out = fn(`<svg><a ${attr}="${v}">x</a></svg>`).toLowerCase();
            expect(out).not.toContain("vbscript:");
          }
        }
      }
    });

    it("entity-pre-decoded javascript: is blocked (HTML parser decodes first — b81)", () => {
      // The HTML parser decodes the entity before the attribute value is read, so by
      // the time the sanitiser sees it, it is literal `javascript:`.
      const encoded = [
        "&#106;avascript:alert(1)", // decimal j
        "&#x6a;avascript:alert(1)", // hex j
        "&#0000106;avascript:alert(1)", // padded decimal j
        "java&#9;script:alert(1)", // entity tab in the middle
      ];
      for (const e of encoded) {
        for (const attr of HTML_URL_ATTRS) {
          for (const { fn } of SINKS) {
            const out = fn(`<svg><a ${attr}="${e}">x</a></svg>`);
            expect(probeLiveSurface(out).dangerousUrls).toEqual([]);
          }
        }
      }
    });

    it("blocks data:text/html but keeps data:image across attrs", () => {
      for (const { fn } of SINKS) {
        expect(fn('<a href="data:text/html,<b>x</b>">y</a>').toLowerCase()).not.toContain(
          "data:text/html"
        );
        // poster on a media element, data on <object>-equivalent — data:image kept.
        expect(
          fn('<img src="data:image/png;base64,AAAA">').toLowerCase()
        ).toContain("data:image/png");
      }
    });

    // ---------------------------------------------------------------------
    // Scriptable data:image/svg+xml in NAVIGABLE attrs (Notidian-vvoj contract,
    // adversarially locked by Notidian-w9qm).
    //
    // An SVG document is ACTIVE content: navigated to (an <a href> click) or
    // resolved as a document (a <use xlink:href> resolve) it executes its OWN
    // <script>/onload, unlike an inert raster image. So data:image/svg+xml — though
    // it carries the `data:image/` prefix the OLD allowlist treated as safe — is a
    // working XSS at click time and MUST be dropped across EVERY HTML_URL_ATTR,
    // while raster data:image/{png,jpeg,gif,webp,bmp} stays allowed (legit inline
    // images). The fix is scoped to navigable HTML attrs only: the CSS image context
    // (neutralizeCssFetches url()) deliberately keeps svg+xml allowed and is pinned
    // by neutralizeCssFetches.dom.test.ts so this scoping can never silently drift.
    //
    // The load-bearing check is probeLiveSurface above — its scheme classifier now
    // encodes THIS corrected contract (data:image/svg+xml is dangerous; raster is
    // not), so a residual / mXSS-resurrected svg+xml in a navigable attr is caught by
    // the same authoritative live re-parse every other dangerous-scheme case uses. A
    // second, attribute-specific read-back (svgAttrUrls) and a string scan are kept
    // as belt-and-braces so a failure names the exact surviving attribute too.
    const svgAttrUrls = (output: string, attr: string): string[] => {
      const live = document.createElement("div");
      live.innerHTML = output;
      const found: string[] = [];
      live.querySelectorAll("*").forEach((el) => {
        // getAttribute, lower-cased + control/space-stripped, mirrors the
        // sanitiser's own normalisation so a split/obfuscated survivor is seen.
        const v = el.getAttribute(attr);
        if (v != null) found.push(normalizeUrlForScheme(v));
      });
      return found;
    };

    // Each primitive, after the HTML parser decodes entities and the sink strips
    // whitespace/C0 controls + lower-cases, normalises to a LITERAL `data:image/
    // svg+xml` MIME — i.e. a browser recognises it as an SVG and would run its
    // script when the attribute is navigated/resolved. So every one MUST be blocked.
    // (Percent-escapes are NOT decoded by the scheme predicate, by design: the
    // WHATWG/data-URL parser does not percent-decode the MIME, so `data:image/%73vg`
    // is an UNRECOGNISED MIME = inert and is intentionally NOT in this scriptable
    // set — see the "inert non-svg MIME" case below. Percent-encoding the BODY is
    // fine to include here because the MIME stays the literal svg+xml.)
    const C0 = String.fromCharCode(1);
    const SVG_DATA_URI_OBFUSCATIONS: Array<(body: string) => string> = [
      (b) => `data:image/svg+xml,${b}`, // plain, URL-encoded body
      (b) => `data:image/svg+xml;base64,${b}`, // ;base64 media-type param
      (b) => `data:image/svg+xml;charset=utf-8,${b}`, // ;charset media-type param
      (b) => `DATA:IMAGE/SVG+XML,${b}`, // upper-case scheme + MIME
      (b) => `data:image/SVG+xml,${b}`, // mixed-case subtype
      (b) => `dAtA:ImAgE/sVg+XmL,${b}`, // fully alternating case
      (b) => `\tdata:image/svg+xml,${b}`, // leading tab (stripped by normaliser)
      (b) => `${C0}data:image/svg+xml,${b}`, // leading C0 control (the b81 class)
      (b) => `${C0}\t\ndata:image/svg+xml,${b}`, // mixed leading C0 + whitespace
      (b) => `data:image/svg+xml ,${b}`, // trailing space before comma
      (b) => `data:image/s\tvg+xml,${b}`, // tab split INSIDE the subtype
      (b) => `data:image/svg+x\nml,${b}`, // newline split inside the subtype
      (b) => `da${C0}ta:image/svg+xml,${b}`, // C0 split inside the `data` scheme
      (b) => `data:image/svg${C0}+xml,${b}`, // C0 split around the `+`
      (b) => `data:image/svg+xml,${encodeURIComponent(b)}`, // percent-encoded BODY, literal svg MIME
      // Entity-encoded chars WITHIN the literal `svg+xml` text — the HTML parser
      // decodes &#115; -> 's', &#x73; -> 's', &#43; -> '+' BEFORE the attribute is
      // read, so the sink still sees a literal svg+xml MIME.
      (b) => `data:image/&#115;vg+xml,${b}`, // decimal-entity 's'
      (b) => `data:image/&#x73;vg+xml,${b}`, // hex-entity 's'
      (b) => `data:image/svg&#43;xml,${b}`, // entity '+'
      (b) => `data:image/svg+&#120;ml,${b}`, // entity 'x'
    ];

    // Two distinct scriptable payload BODIES: onload= (runs on document load) and
    // an inline <script> (runs when the SVG is the navigated document). Both make
    // the data-URI a working XSS, so the contract must hold for each.
    const SVG_PAYLOAD_BODIES: Array<[string, string]> = [
      [
        "svg onload",
        "<svg xmlns='http://www.w3.org/2000/svg' onload='alert(1)'></svg>",
      ],
      [
        "svg script",
        "<svg xmlns='http://www.w3.org/2000/svg'><script>alert(2)</script></svg>",
      ],
    ];
    // Back-compat default body used by the cross-attr / <use> assertions below.
    const SVG_BODY = SVG_PAYLOAD_BODIES[0][1];

    const assertSvgBlocked = (out: string, attr: string): void => {
      // (1) Authoritative: the live re-parse exposes NO dangerous-scheme URL attr.
      //     probeLiveSurface now classifies data:image/svg+xml as dangerous, so a
      //     resurrection in ANY navigable attr is caught here.
      expect(probeLiveSurface(out).dangerousUrls).toEqual([]);
      // (2) Attribute-specific read-back: nothing normalises to data:image/svg in
      //     this particular attr (names the exact survivor on failure).
      for (const got of svgAttrUrls(out, attr)) {
        expect(got).not.toContain("data:image/svg");
      }
      // (3) Belt-and-braces string scan over the serialised output.
      expect(out.toLowerCase()).not.toContain("data:image/svg");
    };

    // The contract across every HTML_URL_ATTR x both sinks x both payload bodies x
    // every obfuscation primitive — no sink/attribute/body may diverge.
    for (const attr of HTML_URL_ATTRS) {
      it(`blocks scriptable data:image/svg+xml in ${attr} under every obfuscation + body`, () => {
        for (const [, body] of SVG_PAYLOAD_BODIES) {
          for (const make of SVG_DATA_URI_OBFUSCATIONS) {
            const value = make(body).replace(/'/g, "&#39;");
            const html = `<svg><a ${attr}="${value}">x</a></svg>`;
            for (const { fn } of SINKS) {
              assertSvgBlocked(fn(html), attr);
            }
          }
        }
      });
    }

    // Property-style fuzz: interleave the obfuscation primitives and payload bodies
    // with the attribute set and both sinks, in a reproducible seeded order, so a
    // combination not enumerated by the exhaustive loop above is still exercised.
    it("PROPERTY: every obfuscation x body x attr x sink combination is blocked", () => {
      const rng = makeRng(0x5111_d00d);
      for (let i = 0; i < 600; i++) {
        const attr = HTML_URL_ATTRS[Math.floor(rng() * HTML_URL_ATTRS.length)];
        const make =
          SVG_DATA_URI_OBFUSCATIONS[
            Math.floor(rng() * SVG_DATA_URI_OBFUSCATIONS.length)
          ];
        const [, body] =
          SVG_PAYLOAD_BODIES[Math.floor(rng() * SVG_PAYLOAD_BODIES.length)];
        const { fn } = SINKS[Math.floor(rng() * SINKS.length)];
        const value = make(body).replace(/'/g, "&#39;");
        // Vary the host element so the attribute is carried through unchanged.
        const host = rng() < 0.5 ? "a" : "image";
        const out = fn(`<svg><${host} ${attr}="${value}">x</${host}></svg>`);
        assertSvgBlocked(out, attr);
      }
    });

    it("KEEPS inert raster data:image/{png,jpeg,gif,webp,bmp} in navigable attrs", () => {
      // Raster images are inert in every context, so the fix must NOT over-block
      // them — a regression that nukes all data:image/ would fail here. Asserted via
      // probeLiveSurface (no dangerous URL) AND the read-back (the raster URI is
      // PRESERVED), so an over-block that silently drops the attr also fails.
      const raster = [
        "data:image/png;base64,iVBORw0KGgo=",
        "data:image/jpeg;base64,/9j/4AAQ=",
        "data:image/gif;base64,R0lGODlh",
        "data:image/webp;base64,UklGRhAAAAB",
        "data:image/bmp;base64,Qk0=",
      ];
      for (const uri of raster) {
        const subtype = uri.split("/")[1].split(";")[0]; // png, jpeg, ...
        for (const { fn } of SINKS) {
          // src is the natural raster sink; href on <a> must keep it too (a link to
          // an inline raster image is a legit, inert target).
          const outSrc = fn(`<img src="${uri}">`).toLowerCase();
          expect(outSrc).toContain(`data:image/${subtype}`);
          expect(probeLiveSurface(outSrc).dangerousUrls).toEqual([]);
          const outHref = fn(`<a href="${uri}">x</a>`).toLowerCase();
          expect(outHref).toContain(`data:image/${subtype}`);
          expect(probeLiveSurface(outHref).dangerousUrls).toEqual([]);
        }
      }
    });

    it("an inert non-svg data:image MIME (percent-encoded subtype) is NOT a scriptable-svg block target", () => {
      // `data:image/%73vg+xml` is NOT decoded to svg by the scheme predicate (the
      // data-URL parser does not percent-decode the MIME), so the browser sees an
      // UNRECOGNISED image MIME = inert, never an executing SVG. It is therefore
      // correctly OUTSIDE the svg+xml block — and, carrying the data:image/ prefix,
      // is a plain raster-class data:image, kept. Pin this so a future "decode
      // everything" overreach (which would wrongly start blocking it) is caught.
      const uri = `data:image/%73vg+xml,${encodeURIComponent(SVG_BODY)}`;
      for (const { fn } of SINKS) {
        const out = fn(`<a href="${uri}">x</a>`);
        // It survives (kept) — it is an inert non-svg image MIME, not a navigable
        // scriptable SVG — and exposes no dangerous-scheme surface.
        expect(out.toLowerCase()).toContain("data:image/%73vg");
        expect(probeLiveSurface(out).dangerousUrls).toEqual([]);
      }
    });

    it("blocks svg+xml in <use xlink:href> for BOTH payload bodies (resolve-as-document vector)", () => {
      // <use xlink:href="data:image/svg+xml,..."> resolves the referenced SVG as a
      // document, running its <script>/onload — the second navigable vector besides
      // an <a href> click. The xlink:href must be dropped for either payload.
      for (const [, body] of SVG_PAYLOAD_BODIES) {
        const value = `data:image/svg+xml,${body}`.replace(/'/g, "&#39;");
        for (const { fn } of SINKS) {
          assertSvgBlocked(fn(`<svg><use xlink:href="${value}"/></svg>`), "xlink:href");
        }
      }
    });

    it("does NOT over-block legit URLs that merely contain the substring", () => {
      for (const { fn } of SINKS) {
        expect(fn('<a href="https://x.com/javascript-guide">x</a>')).toContain(
          "javascript-guide"
        );
        expect(fn('<a href="note-about-vbscript.md">x</a>')).toContain(
          "note-about-vbscript.md"
        );
        expect(fn('<a href="mailto:js@dev.io">x</a>')).toContain("mailto:js@dev.io");
        expect(fn('<a href="https://example.com/page">x</a>')).toContain(
          "https://example.com/page"
        );
      }
    });
  });

  // -------------------------------------------------------------------------
  // (4) Nested / mutation-XSS shapes that a single template.innerHTML reparse
  //     could resurrect. THIS is where the Notidian-y3h fix lives: the sinks now
  //     run to a fixed point, so a parse-differential mXSS cannot survive.
  // -------------------------------------------------------------------------
  describe("(4) nested / mutation-XSS (mXSS) shapes", () => {
    // The canonical parse-differential payloads: the sanitiser's first template
    // parse places the smuggled node as TEXT inside <style> (so the attribute loop
    // never sees it), but a live innerHTML re-parse hoists it into a working
    // element. The fixed-point loop catches it on the next pass.
    const MXSS_PAYLOADS = [
      "<math><mtext><table><mglyph><style><img src=x onerror=alert(1)></style></mglyph></mtext></math>",
      "<svg><style><img src=1 onerror=alert(1)></style></svg>",
      '<math><mtext><mglyph><style><a href="javascript:alert(1)">x</a></style></mglyph></math>',
      "<table><caption><svg><style><img src=x onerror=alert(1)>",
      "<noscript><style><img src=x onerror=alert(1)></style></noscript>",
      '<math><annotation-xml encoding="text/html"><iframe src="javascript:alert(1)"></iframe></annotation-xml></math>',
      '<svg></p><style><a id="</style><img src=1 onerror=alert(1)>">',
    ];
    for (const payload of MXSS_PAYLOADS) {
      for (const { name, fn } of SINKS) {
        it(`${name}: mXSS payload is inert after a LIVE re-parse :: ${payload.slice(0, 40)}…`, () => {
          // FAILING STATE = a live onerror/script/iframe/javascript: surviving.
          expectInert(fn(payload));
        });
      }
    }

    it("svg><style> with a remote @import is neutralised (CSS fetch path)", () => {
      for (const { fn } of SINKS) {
        const out = fn(
          '<svg><style>@import url(http://evil.example/x.css);.a{fill:#0a0}</style></svg>'
        ).toLowerCase();
        expect(out).not.toContain("@import");
        expect(out).not.toContain("evil.example");
      }
    });

    it("<noscript> content (parsed as text when scripting-off) carries no live handler", () => {
      // jsdom parses <noscript> children as a live subtree; the <noscript> element
      // is itself dangerous and removed, taking its children with it.
      for (const { fn } of SINKS) {
        const out = fn(
          '<noscript><img src=x onerror=alert(1)><iframe src=javascript:y()></iframe></noscript><p>ok</p>'
        ).toLowerCase();
        expect(out).not.toContain("<noscript");
        expectInert(fn('<noscript><img src=x onerror=alert(1)></noscript><p>ok</p>'));
        expect(out).toContain("ok");
      }
    });

    it("nested <template> content is INERT at the sink (does not execute / resurrect)", () => {
      // A <script>/<img onerror> inside a NESTED <template> survives the single-pass
      // querySelectorAll (it lives in the inner template.content fragment, not the
      // light DOM). That is acceptable because <template> content is parsed inertly
      // by the HTML spec: assigning it to a live element's innerHTML neither renders
      // nor executes it. Pin that invariant: the light DOM exposes ZERO live
      // script / on* surface. (See Notidian-y3h follow-up bead for defence-in-depth
      // stripping of inert template content.)
      for (const { fn } of SINKS) {
        const out = fn(
          '<template><script>x()</script><img src=q onerror=hack()></template><p>ok</p>'
        );
        const live = document.createElement("div");
        live.innerHTML = out;
        // No script executes from the light DOM, and the <img onerror> is locked
        // inside the inert template fragment, never the rendered tree.
        expect(live.querySelectorAll("script").length).toBe(0);
        const liveImgs = Array.from(live.querySelectorAll("img")).filter(
          (im) => im.getAttribute("onerror") != null
        );
        expect(liveImgs.length).toBe(0);
        expect(out.toLowerCase()).toContain("ok");
      }
    });

    it("removes EVERY interleaved dangerous sibling, keeping the safe ones", () => {
      for (const { fn } of SINKS) {
        const out = fn(
          "<div>" +
            "<script>a()</script><p>one</p>" +
            '<iframe src="https://evil.example"></iframe><p>two</p>' +
            '<object data="x"></object><p>three</p>' +
            "<svg><foreignObject><b>nope</b></foreignObject></svg><p>four</p>" +
            "</div>"
        ).toLowerCase();
        expect(out).not.toContain("<script");
        expect(out).not.toContain("<iframe");
        expect(out).not.toContain("<object");
        expect(out).not.toContain("foreignobject");
        expect(out).not.toContain("evil.example");
        for (const word of ["one", "two", "three", "four"]) {
          expect(out).toContain(word);
        }
      }
    });

    it("removing a dangerous PARENT also removes its nested script child", () => {
      for (const { fn } of SINKS) {
        const out = fn(
          '<form action="x"><div><script>steal()</script></div></form><p>after</p>'
        ).toLowerCase();
        expect(out).not.toContain("<form");
        expect(out).not.toContain("<script");
        expect(out).not.toContain("steal()");
        expect(out).toContain("after");
      }
    });
  });

  // -------------------------------------------------------------------------
  // (5) IDEMPOTENCY / round-trip property: sanitize(sanitize(x)) === sanitize(x)
  //     over a generated corpus. Load-bearing for sanitizeFrameText, whose value
  //     is re-sanitised on every paint of a contentEditable round-trip.
  // -------------------------------------------------------------------------
  describe("(5) idempotency / fixed-point property over a generated corpus", () => {
    // Building blocks the generator stitches into adversarial documents. Mixing
    // safe formatting, dangerous elements, obfuscated schemes, CSS fetches, and
    // the mXSS integration-point fragments stresses the fixed-point convergence.
    const FRAGMENTS = [
      "<b>bold</b>",
      "<i>italic</i>",
      "<u>u</u>",
      "<span>x</span>",
      "plain text",
      "<br>",
      "<div>block</div>",
      '<a href="note.md">link</a>',
      '<a href="https://example.com">remote</a>',
      '<a href="mailto:a@b.com">mail</a>',
      "<script>evil()</script>",
      '<img src="x" onerror="alert(1)">',
      '<a href="javascript:alert(1)">js</a>',
      '<a href="&#106;avascript:alert(1)">ent</a>',
      '<iframe src="https://evil.example"></iframe>',
      '<form action="javascript:y()"><button formaction="javascript:z()">b</button></form>',
      '<span style="background:url(http://evil.example/x.png);color:#111">s</span>',
      '<svg><foreignObject><script>q()</script></foreignObject><use href="javascript:r()"/></svg>',
      "<math><mtext><mglyph><style><img src=x onerror=alert(1)></style></mglyph></math>",
      "<svg><style><img src=1 onerror=alert(1)></style></svg>",
      '<span on\tclick="a()">t</span>',
      String.fromCharCode(1) + "leading-control",
      "<noscript><style><img src=x onerror=p()></style></noscript>",
    ];

    const buildDoc = (rng: () => number): string => {
      const count = 1 + Math.floor(rng() * 6);
      let out = "";
      for (let i = 0; i < count; i++) {
        out += FRAGMENTS[Math.floor(rng() * FRAGMENTS.length)];
      }
      return out;
    };

    for (const { name, fn } of SINKS) {
      it(`${name}: sanitize(sanitize(x)) === sanitize(x) over 400 generated docs`, () => {
        const rng = makeRng(0x9e3779b9 ^ name.length);
        for (let i = 0; i < 400; i++) {
          const doc = buildDoc(rng);
          const once = fn(doc);
          const twice = fn(once);
          // toBe surfaces the exact failing input/output in the diff if it breaks.
          expect(twice).toBe(once);
        }
      });

      it(`${name}: the fixed-point output is INERT after a live re-parse (400 docs)`, () => {
        const rng = makeRng(0x12345678 ^ name.length);
        for (let i = 0; i < 400; i++) {
          const doc = buildDoc(rng);
          // FAILING STATE = any live dangerous tag / on* / dangerous-scheme.
          expectInert(fn(doc));
        }
      });
    }

    it("explicit mXSS payloads reach a fixed point AND are inert (both sinks)", () => {
      const payloads = [
        "<math><mtext><table><mglyph><style><img src=x onerror=alert(1)></style></mglyph></mtext></math>",
        "<svg><style><img src=1 onerror=alert(1)></style></svg>",
        '<img src="x" onerror="alert(1)"><a href="javascript:y()">z</a>',
        "<div><script>e()</script><span>safe</span></div>",
      ];
      for (const { fn } of SINKS) {
        for (const p of payloads) {
          const once = fn(p);
          expect(fn(once)).toBe(once); // fixed point
          expectInert(once); // and safe
        }
      }
    });
  });

  // -------------------------------------------------------------------------
  // (6) Formatting-preservation for sanitizeFrameText (the contentEditable
  //     round-trip is load-bearing — escapeHtml would corrupt it). bold/italic/
  //     links/http(s) must survive.
  // -------------------------------------------------------------------------
  describe("(6) sanitizeFrameText preserves legitimate inline formatting", () => {
    const frame = (s: string) => sanitizeFrameText(s).toLowerCase();

    it("keeps bold/italic/strong/em/underline/span/code", () => {
      const out = frame(
        "<b>b</b><i>i</i><strong>s</strong><em>e</em><u>u</u><span>x</span><code>c</code>"
      );
      for (const tag of ["<b>", "<i>", "<strong>", "<em>", "<u>", "<span>", "<code>"]) {
        expect(out).toContain(tag);
      }
    });

    it("keeps line breaks, divs, and ordinary text content", () => {
      const out = frame("one<br>two<div>three</div>");
      expect(out).toContain("<br");
      expect(out).toContain("<div");
      expect(out).toContain("one");
      expect(out).toContain("three");
    });

    it("keeps a safe color/font style span (frame text styling)", () => {
      const out = frame('<span style="color:#e11;font-weight:600">red</span>');
      expect(out).toContain("color:#e11");
      expect(out).toContain("font-weight:600");
      expect(out).toContain("red");
    });

    it("keeps relative, http(s), and mailto links", () => {
      expect(frame('<a href="note.md">x</a>')).toContain('href="note.md"');
      expect(frame('<a href="https://example.com">x</a>')).toContain(
        "https://example.com"
      );
      expect(frame('<a href="http://example.com">x</a>')).toContain(
        "http://example.com"
      );
      expect(frame('<a href="mailto:a@b.com">x</a>')).toContain("mailto:a@b.com");
    });

    it("is the identity for plain text (no special constructs)", () => {
      expect(sanitizeFrameText("Project Notes 2026")).toBe("Project Notes 2026");
      expect(sanitizeFrameText("café — déjà vu 😀")).toBe("café — déjà vu 😀");
    });

    it("keeps formatting WHILE stripping an adjacent dangerous construct", () => {
      const out = frame(
        '<b>kept</b><script>nope()</script><a href="https://ok.example">link</a>' +
          '<img src="x" onerror="evil()"><i>also-kept</i>'
      );
      expect(out).toContain("<b>");
      expect(out).toContain("kept");
      expect(out).toContain("<i>");
      expect(out).toContain("also-kept");
      expect(out).toContain("https://ok.example");
      expect(out).not.toContain("<script");
      expect(out).not.toContain("onerror");
      expect(out).not.toContain("evil()");
    });

    it("a real contentEditable read-back of safe formatted text is lossless", () => {
      // The TextNodeView sink: value set as innerHTML on a contentEditable div,
      // onBlur reads e.target.innerHTML back. For content with no dangerous
      // constructs the round-trip must keep the formatting (why escapeHtml is wrong).
      const safe = '<b>Title</b> — <i>note</i> with a <a href="x.md">link</a>';
      const el = document.createElement("div");
      el.setAttribute("contenteditable", "true");
      el.innerHTML = sanitizeFrameText(safe);
      const readBack = el.innerHTML.toLowerCase();
      expect(readBack).toContain("<b>");
      expect(readBack).toContain("<i>");
      expect(readBack).toContain("<a");
      // And re-sanitising the read-back is a fixed point (paint stability).
      expect(sanitizeFrameText(el.innerHTML)).toBe(sanitizeFrameText(safe));
    });
  });

  // -------------------------------------------------------------------------
  // (7) Non-idempotent raw-text element regression (Notidian-DEPTH-sanitize-
  //     rendered-frame-adversarial). <plaintext> is the ONLY HTML element whose
  //     parse->serialise round-trip is itself non-idempotent: each pass appends
  //     another </plaintext>, so the fixed-point loop (introduced by Notidian-y3h)
  //     used to hit the cap and DESTROY the whole input — incl. benign neighbours —
  //     to "". The per-pass cleaner now collapses <plaintext> to inert text, so the
  //     loop converges and benign content survives. Each test's FAILING state is
  //     either lost benign content or a live executable surface.
  // -------------------------------------------------------------------------
  describe("(7) <plaintext> non-idempotency does not destroy benign content", () => {
    for (const { name, fn } of SINKS) {
      it(`${name}: keeps text around a bare <plaintext> (no "" data-loss)`, () => {
        const out = fn("Hello <plaintext> world");
        expect(out).not.toBe(""); // the pre-fix regression returned ""
        expect(out).toContain("Hello");
        expect(out).toContain("world");
      });

      it(`${name}: keeps a safe sibling element AND text past a <plaintext>`, () => {
        const out = fn("<b>note</b><plaintext>rest of my note");
        expect(out).not.toBe("");
        expect(out.toLowerCase()).toContain("<b>note</b>");
        expect(out).toContain("rest of my note");
      });

      it(`${name}: <plaintext> content stays inert literal text (no live handler)`, () => {
        // Everything after <plaintext> is text in any parse, so a smuggled onerror
        // must come back ESCAPED, never as a live <img onerror>.
        const out = fn("<plaintext><img src=x onerror=alert(1)>");
        expect(out).not.toBe("");
        expectInert(out);
        const live = document.createElement("div");
        live.innerHTML = out;
        expect(live.querySelectorAll("img").length).toBe(0);
      });

      it(`${name}: reaches a fixed point for <plaintext> shapes (idempotent)`, () => {
        const shapes = [
          "Hello <plaintext> world",
          "<b>note</b><plaintext>rest",
          "<table><plaintext>x",
          "<plaintext>",
          "<plaintext><script>e()</script>",
          "<div>before<plaintext>after</div>",
        ];
        for (const s of shapes) {
          const once = fn(s);
          expect(fn(once)).toBe(once); // fixed point, no divergence
          expectInert(once);
        }
      });
    }

    it("a 1,200-doc fuzz mixing <plaintext> with other fragments never destroys to '' or diverges", () => {
      // Targeted regression of the reviewer's 60k-doc fuzz: every input that
      // contains benign text must keep producing a non-empty, fixed-point, inert
      // output once a <plaintext> is in the mix.
      const PIECES = [
        "<b>bold</b>",
        "plain text here",
        "<plaintext>",
        "<plaintext>tail",
        "<i>x</i>",
        "<table><plaintext>y",
        "<img src=x onerror=alert(1)>",
        "<a href='note.md'>l</a>",
        "more words",
      ];
      const rng = makeRng(0xC0FFEE);
      for (const { fn } of SINKS) {
        for (let i = 0; i < 600; i++) {
          const count = 1 + Math.floor(rng() * 5);
          let doc = "";
          for (let j = 0; j < count; j++) doc += PIECES[Math.floor(rng() * PIECES.length)];
          const once = fn(doc);
          // Inputs carrying visible words must not collapse to "" (the regression).
          if (/[a-z]/.test(doc.replace(/<[^>]*>/g, ""))) {
            expect(once).not.toBe("");
          }
          expect(fn(once)).toBe(once); // fixed point
          expectInert(once); // and safe
        }
      }
    });
  });

  // -------------------------------------------------------------------------
  // (8) Defence-in-depth: nested <template> content is sanitised to arbitrary
  //     depth (Notidian-2s1). A <template>'s children live in its OWN .content
  //     DocumentFragment, which `querySelectorAll('*')` over the host fragment
  //     does NOT visit (per spec, template content is an inert separate fragment).
  //     So pre-fix, a <script>/<img onerror>/javascript: nested inside a
  //     <template> survived every sanitiser. It was INERT at the live sink (pinned
  //     by the section-(4) "nested <template> content is INERT" test), but a latent
  //     risk if downstream ever extracts template.content and re-injects it into
  //     the light DOM. The per-pass cleaner now recurses into template.content, so
  //     the nested content is stripped too. These tests inspect INSIDE the template
  //     fragments (probeLiveSurface only walks the light DOM, where the content is
  //     inert by spec) — the FAILING STATE is any dangerous surface surviving in
  //     the nested template content.
  // -------------------------------------------------------------------------
  describe("(8) nested <template> content is deeply sanitised (Notidian-2s1)", () => {
    // Re-parse the sanitiser output and recursively collect every residual
    // dangerous surface, DESCENDING into nested <template>.content (the fragments
    // querySelectorAll('*') does not cross). This is the load-bearing check for the
    // defence-in-depth fix: probeLiveSurface (light DOM only) cannot see it.
    type DeepSurface = {
      dangerousTags: string[];
      onHandlers: string[];
      dangerousUrls: string[];
      templateDepth: number;
    };
    const probeDeepSurface = (output: string): DeepSurface => {
      const dangerousTags: string[] = [];
      const onHandlers: string[] = [];
      const dangerousUrls: string[] = [];
      let templateDepth = 0;
      const dangerSet = new Set(HTML_DANGEROUS_TAGS);
      const urlSet = new Set(HTML_URL_ATTRS);
      const walk = (root: DocumentFragment, depth: number): void => {
        templateDepth = Math.max(templateDepth, depth);
        root.querySelectorAll("*").forEach((el) => {
          const tag = el.tagName.toLowerCase();
          if (dangerSet.has(tag)) dangerousTags.push(tag);
          Array.from(el.attributes).forEach((attr) => {
            const name = attr.name.toLowerCase();
            if (name.startsWith("on")) onHandlers.push(name);
            // Shared corrected classifier (Notidian-w9qm): also catches a
            // data:image/svg+xml smuggled into a navigable attr at template depth,
            // and uses the proper C0-control normalisation (the inline regex here
            // used to be /[\s -]+/g — whitespace+space+literal-hyphen — which did
            // NOT strip the C0 control range a real bypass can hide a scheme behind).
            if (urlSet.has(name) && isDangerousScheme(attr.value)) {
              dangerousUrls.push(`${name}=${normalizeUrlForScheme(attr.value)}`);
            }
          });
          if (tag == "template") {
            const content = (el as HTMLTemplateElement).content;
            if (content) walk(content, depth + 1);
          }
        });
      };
      const host = document.createElement("template");
      host.innerHTML = output;
      walk(host.content, 0);
      return { dangerousTags, onHandlers, dangerousUrls, templateDepth };
    };

    const expectDeepInert = (output: string): void => {
      const s = probeDeepSurface(output);
      expect(s.dangerousTags).toEqual([]);
      expect(s.onHandlers).toEqual([]);
      expect(s.dangerousUrls).toEqual([]);
    };

    it("the deep probe actually descends into nested template content (sanity)", () => {
      // Guard the test harness itself: if probeDeepSurface failed to descend it
      // would report a false-green. A RAW (unsanitised) nested-template payload
      // must register every dangerous surface AND a templateDepth >= 2.
      const raw =
        "<template><template><script>x()</script>" +
        '<img src=q onerror=hack()><a href="javascript:alert(1)">z</a>' +
        "</template></template>";
      const host = document.createElement("template");
      host.innerHTML = raw;
      const s = probeDeepSurface(host.innerHTML);
      expect(s.templateDepth).toBeGreaterThanOrEqual(2);
      expect(s.dangerousTags).toContain("script");
      expect(s.onHandlers).toContain("onerror");
      expect(s.dangerousUrls.length).toBeGreaterThan(0);
    });

    // Each payload nests a distinct vector one or more <template> levels deep.
    const NESTED_PAYLOADS: Array<[string, string]> = [
      ["script", "<template><script>x()</script></template>"],
      [
        "img onerror",
        "<template><img src=q onerror=hack()></template>",
      ],
      [
        "on* handler",
        '<template><span onclick="steal()">t</span></template>',
      ],
      [
        "javascript: URL",
        '<template><a href="javascript:alert(1)">z</a></template>',
      ],
      [
        "vbscript: URL",
        '<template><a href="vbscript:msgbox(1)">z</a></template>',
      ],
      [
        "data:image/svg+xml URL (scriptable, Notidian-w9qm)",
        "<template><a href=\"data:image/svg+xml,&lt;svg onload=alert(1)&gt;\">z</a></template>",
      ],
      [
        "data:text/html URL",
        '<template><a href="data:text/html,<b>x</b>">z</a></template>',
      ],
      [
        "iframe",
        '<template><iframe src="https://evil.example"></iframe></template>',
      ],
      [
        "CSS url() fetch in <style>",
        "<template><style>.a{background:url(http://evil.example/x.png)}</style></template>",
      ],
      [
        "CSS @import in <style>",
        "<template><style>@import url(http://evil.example/x.css);</style></template>",
      ],
      [
        "inline style url() fetch",
        '<template><span style="background:url(http://evil.example/x.png)">s</span></template>',
      ],
      [
        "two levels deep",
        "<template><template><script>x()</script><img src=q onerror=h()></template></template>",
      ],
      [
        "three levels deep, mixed vectors",
        "<template><template><template>" +
          '<script>x()</script><img onerror=h() src=p><a href="javascript:y()">z</a>' +
          "</template></template></template>",
      ],
      [
        "dangerous content interleaved across template levels",
        "<template><script>a()</script><template><img src=q onerror=b()>" +
          '<a href="javascript:c()">z</a></template></template>',
      ],
    ];

    for (const [label, payload] of NESTED_PAYLOADS) {
      for (const { name, fn } of SINKS) {
        it(`${name}: strips ${label} from nested template content`, () => {
          // FAILING STATE = the dangerous surface surviving INSIDE the template
          // fragment (querySelectorAll over the host never visits it).
          expectDeepInert(fn(payload));
          // And the light DOM stays inert too (the pre-existing invariant holds).
          expectInert(fn(payload));
        });
      }
    }

    it("CSS fetches inside a nested <template>'s <style>/style are neutralised", () => {
      for (const { fn } of SINKS) {
        const out = fn(
          "<template>" +
            "<style>@import url(http://evil.example/a.css);.b{fill:url(http://evil.example/b.png)}</style>" +
            '<span style="background:url(http://evil.example/c.png);color:#0a0">s</span>' +
            "</template>"
        );
        // Inspect the (inert) template content directly.
        const host = document.createElement("template");
        host.innerHTML = out;
        const inner = host.content.querySelector("template");
        const innerHtml = (inner ? inner.innerHTML : out).toLowerCase();
        expect(innerHtml).not.toContain("@import");
        expect(innerHtml).not.toContain("evil.example");
        // A legit inline color is preserved (deep clean is surgical, not nuke).
        expect(innerHtml).toContain("#0a0");
      }
    });

    it("benign nested <template> content survives intact (no over-strip)", () => {
      for (const { fn } of SINKS) {
        const out = fn(
          '<template><b>hello</b><a href="note.md">link</a><i>world</i></template>'
        );
        const host = document.createElement("template");
        host.innerHTML = out;
        const inner = host.content.querySelector("template");
        const innerHtml = (inner ? inner.innerHTML : out).toLowerCase();
        expect(innerHtml).toContain("<b>hello</b>");
        expect(innerHtml).toContain("<i>world</i>");
        expect(innerHtml).toContain('href="note.md"');
      }
    });

    it("safe siblings OUTSIDE the template are preserved while it is cleaned", () => {
      for (const { fn } of SINKS) {
        const out = fn(
          "<template><script>x()</script></template><p>kept-outside</p>"
        );
        expect(out.toLowerCase()).toContain("kept-outside");
        expectDeepInert(out);
      }
    });

    it("nested-template payloads reach a fixed point AND are deeply inert", () => {
      for (const { fn } of SINKS) {
        for (const [, payload] of NESTED_PAYLOADS) {
          const once = fn(payload);
          // Idempotency: re-sanitising the output changes nothing.
          expect(fn(once)).toBe(once);
          // Fixed-point output carries no dangerous surface at any depth.
          expectDeepInert(once);
        }
      }
    });

    it("a generated corpus mixing nested templates is fixed-point AND deeply inert", () => {
      const PIECES = [
        "<b>bold</b>",
        "plain text",
        "<template><script>e()</script></template>",
        '<template><img src=x onerror=alert(1)></template>',
        '<template><a href="javascript:y()">j</a></template>',
        "<template><template><script>z()</script></template></template>",
        '<template><b>benign</b><a href="note.md">l</a></template>',
        "<template><style>@import url(http://evil.example/x.css)</style></template>",
        "<p>ok</p>",
      ];
      const rng = makeRng(0x5a17e2 ^ 0x2 /* Notidian-2s1 */);
      for (const { fn } of SINKS) {
        for (let i = 0; i < 400; i++) {
          const count = 1 + Math.floor(rng() * 5);
          let doc = "";
          for (let j = 0; j < count; j++) {
            doc += PIECES[Math.floor(rng() * PIECES.length)];
          }
          const once = fn(doc);
          expect(fn(once)).toBe(once); // fixed point (no divergence)
          expectDeepInert(once); // no dangerous surface at any depth
        }
      }
    });
  });

  // -------------------------------------------------------------------------
  // Fail-safe contract parity (both sinks).
  // -------------------------------------------------------------------------
  describe("fail-safe contract", () => {
    it("sanitizeRenderedHtml returns '' for empty / non-string input", () => {
      expect(sanitizeRenderedHtml("")).toBe("");
      expect(sanitizeRenderedHtml(null as unknown as string)).toBe("");
      expect(sanitizeRenderedHtml(undefined as unknown as string)).toBe("");
      expect(sanitizeRenderedHtml(123 as unknown as string)).toBe("");
    });

    it("sanitizeFrameText returns '' for empty / nullish / non-string input", () => {
      expect(sanitizeFrameText("")).toBe("");
      expect(sanitizeFrameText(null)).toBe("");
      expect(sanitizeFrameText(undefined)).toBe("");
      expect(sanitizeFrameText(123 as unknown as string)).toBe("");
    });

    it("both always return a string for benign input", () => {
      expect(typeof sanitizeRenderedHtml("<p>x</p>")).toBe("string");
      expect(typeof sanitizeFrameText("<b>x</b>")).toBe("string");
    });
  });
});
