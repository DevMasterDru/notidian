/**
 * @jest-environment jsdom
 */
// Real-DOM coverage for sanitizeIconSVG (Notidian-5jk). The default jest env is
// 'node' (no document), where sanitizeIconSVG early-returns "" and is never
// exercised. This file opts into jsdom via the per-file docblock above so ONLY
// this file gets a DOM — the rest of the suite stays on node, keeping the
// transform surface narrow (the broad React/jsdom attempt in Notidian-3dv hit an
// ESM matchers.js issue; this file imports no React/testing-library code).
//
// The payloads below are adversarial: each tries a distinct bypass of the
// allowlist sanitizer. Assertions normalise to lower-case and check for the
// presence/absence of tokens rather than exact serialisation, so they are robust
// to jsdom's SVG attribute/case serialisation.
import {
  escapeHtml,
  sanitizeIconSVG,
  sanitizeRenderedHtml,
} from "shared/utils/sanitize";

const lower = (svg: string): string => sanitizeIconSVG(svg).toLowerCase();
const rendered = (html: string): string => sanitizeRenderedHtml(html).toLowerCase();

describe("sanitizeIconSVG — jsdom (Notidian-5jk)", () => {
  it("runs against a real DOM (document is defined, no early return)", () => {
    expect(typeof document).not.toBe("undefined");
    // A pure-shape icon survives — proving the function did real work, not the
    // node-env early return (which would also yield "" for this input).
    expect(lower('<svg viewBox="0 0 24 24"><path d="M4 4h16"/></svg>')).toContain(
      "<path"
    );
  });

  describe("removes script-capable / foreign-content elements", () => {
    it("strips <script> but keeps sibling shapes", () => {
      const result = lower(
        '<svg><script>alert(1)</script><path d="M0 0"/></svg>'
      );
      expect(result).not.toContain("<script");
      expect(result).not.toContain("alert(1)");
      expect(result).toContain("<path");
    });

    it("strips camelCase <foreignObject> case-insensitively (and its children)", () => {
      const result = lower(
        '<svg><foreignObject><iframe src="https://evil.example"></iframe></foreignObject><circle r="2"/></svg>'
      );
      expect(result).not.toContain("foreignobject");
      expect(result).not.toContain("iframe");
      expect(result).not.toContain("evil.example");
      expect(result).toContain("<circle");
    });

    it("strips <iframe>, <object>, and <embed>", () => {
      const result = lower(
        '<svg><iframe src="x"></iframe><object data="x"></object><embed src="x"/><rect/></svg>'
      );
      expect(result).not.toContain("iframe");
      expect(result).not.toContain("<object");
      expect(result).not.toContain("<embed");
      expect(result).toContain("<rect");
    });

    it("strips SMIL <set>/<animate>/<animateTransform> that could write a handler at runtime", () => {
      const setResult = lower(
        '<svg><rect/><set attributeName="onclick" to="alert(1)"/></svg>'
      );
      expect(setResult).not.toContain("<set");
      expect(setResult).not.toContain("onclick");

      const animResult = lower(
        '<svg><a><animate attributeName="href" to="javascript:alert(1)"/></a><animateTransform attributeName="transform" type="rotate"/></svg>'
      );
      expect(animResult).not.toContain("<animate");
      expect(animResult).not.toContain("javascript:");
    });

    it("strips a dangerous element nested inside a safe group", () => {
      const result = lower('<svg><g><script>evil()</script></g></svg>');
      expect(result).not.toContain("script");
      expect(result).not.toContain("evil()");
      expect(result).toContain("<g");
    });
  });

  describe("drops event-handler attributes but keeps the element", () => {
    it("drops on* handlers in any case", () => {
      const result = lower(
        '<svg onload="a()"><rect onclick="b()" onMouseOver="c()" ONERROR="d()"/></svg>'
      );
      expect(result).not.toContain("onload");
      expect(result).not.toContain("onclick");
      expect(result).not.toContain("onmouseover");
      expect(result).not.toContain("onerror");
      expect(result).not.toMatch(/a\(\)|b\(\)|c\(\)|d\(\)/);
      expect(result).toContain("<rect");
    });
  });

  describe("URL attributes: allow only #fragments and data:image", () => {
    it("drops javascript: in href and xlink:href", () => {
      expect(lower('<svg><use href="javascript:alert(1)"/></svg>')).not.toContain(
        "javascript:"
      );
      expect(
        lower('<svg><use xlink:href="javascript:alert(1)"/></svg>')
      ).not.toContain("javascript:");
    });

    it("drops remote http(s) URLs (no phoning home / SSRF)", () => {
      const result = lower(
        '<svg><image href="https://evil.example/track.png"/><use href="http://evil.example/x"/></svg>'
      );
      expect(result).not.toContain("evil.example");
      expect(result).not.toContain("http");
    });

    it("drops data:text/html and other non-image data URLs", () => {
      expect(
        lower('<svg><a href="data:text/html,<script>alert(1)</script>">x</a></svg>')
      ).not.toContain("data:text/html");
    });

    it("drops entity-encoded and whitespace-obfuscated javascript: URLs", () => {
      // The HTML parser decodes the entity before the attribute is read, and the
      // sanitizer strips whitespace before matching, so neither obfuscation slips
      // through the allowlist.
      expect(
        lower('<svg><use href="&#106;avascript:alert(1)"/></svg>')
      ).not.toContain("javascript:");
      expect(
        lower('<svg><use href="java\nscript:alert(1)"/></svg>')
      ).not.toContain("script:");
    });

    it("preserves same-document fragment references (legit <use> symbol reuse)", () => {
      expect(lower('<svg><use href="#icon-a"/></svg>')).toContain('href="#icon-a"');
    });

    it("preserves inline data:image raster sources", () => {
      const result = lower(
        '<svg><image href="data:image/png;base64,iVBORw0KGgo="/></svg>'
      );
      expect(result).toContain("data:image/png");
    });
  });

  describe("CSS fetches in <style> / style attr (Notidian-m9r)", () => {
    it("drops @import (remote stylesheet fetch)", () => {
      const result = lower(
        '<svg><style>@import url("http://evil.example/x.css");.a{fill:#0a0}</style><path class="a"/></svg>'
      );
      expect(result).not.toContain("@import");
      expect(result).not.toContain("evil.example");
      // legitimate rule survives
      expect(result).toContain("fill:#0a0");
    });

    it("neutralises remote url() in a <style> block but keeps the rule shell", () => {
      const result = lower(
        '<svg><style>.a{background:url("http://evil.example/b.png")}</style><rect class="a"/></svg>'
      );
      expect(result).not.toContain("evil.example");
      expect(result).not.toContain("http");
      expect(result).toContain("url()");
      expect(result).toContain("<rect");
    });

    it("neutralises remote url() in an inline style attribute", () => {
      const result = lower(
        '<svg><rect style="fill:url(http://evil.example/c.png)"/></svg>'
      );
      expect(result).not.toContain("evil.example");
      expect(result).toContain("<rect");
    });

    it("strips on* handlers on a <style> element (stylesheet load XSS)", () => {
      const result = lower('<svg><style onload="alert(1)">.a{fill:#000}</style></svg>');
      expect(result).not.toContain("onload");
      expect(result).not.toContain("alert(1)");
    });

    it("preserves legitimate local url(#fragment) and data:image in CSS", () => {
      const styleResult = lower(
        '<svg><style>.a{fill:url(#grad)}</style><path class="a"/></svg>'
      );
      expect(styleResult).toContain("url(#grad)");

      const inlineResult = lower(
        '<svg><rect style="fill:url(#grad);stroke:#111"/></svg>'
      );
      expect(inlineResult).toContain("url(#grad)");
      expect(inlineResult).toContain("stroke:#111");

      const dataResult = lower(
        '<svg><rect style="background:url(data:image/png;base64,AAAA)"/></svg>'
      );
      expect(dataResult).toContain("data:image/png");
    });
  });

  describe("preserves legitimate icon markup", () => {
    it("keeps paths, fills, gradients, defs, and viewBox geometry", () => {
      const icon =
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24">' +
        '<defs><linearGradient id="g"><stop offset="0" stop-color="#f00"/></linearGradient></defs>' +
        '<path d="M12 2 L22 22" fill="url(#g)" stroke="#000"/>' +
        '<circle cx="12" cy="12" r="10"/></svg>';
      const result = lower(icon);
      expect(result).toContain("lineargradient");
      expect(result).toContain("<path");
      expect(result).toContain("<circle");
      expect(result).toContain("viewbox");
      expect(result).toContain("fill=");
      expect(result).toContain("url(#g)");
    });

    it("keeps a <style> block used by some legitimate icons", () => {
      const result = lower(
        '<svg><style>.a{fill:#0a0}</style><path class="a" d="M0 0"/></svg>'
      );
      expect(result).toContain("<style");
      expect(result).toContain("fill:#0a0");
      expect(result).toContain("<path");
    });
  });

  describe("fail-safe contract", () => {
    it("returns an empty string for empty / non-string input", () => {
      expect(sanitizeIconSVG("")).toBe("");
      expect(sanitizeIconSVG(null as unknown as string)).toBe("");
      expect(sanitizeIconSVG(undefined as unknown as string)).toBe("");
      expect(sanitizeIconSVG(123 as unknown as string)).toBe("");
    });

    it("always returns a string", () => {
      expect(typeof sanitizeIconSVG('<svg><path/></svg>')).toBe("string");
      expect(typeof sanitizeIconSVG("not svg at all")).toBe("string");
    });
  });
});

describe("sanitizeRenderedHtml — jsdom (Notidian-3yb)", () => {
  describe("removes script-capable / navigation / fetch elements", () => {
    it("strips <script> and keeps surrounding markdown", () => {
      const result = rendered(
        '<div><p>hello</p><script>alert(1)</script><p>world</p></div>'
      );
      expect(result).not.toContain("<script");
      expect(result).not.toContain("alert(1)");
      expect(result).toContain("hello");
      expect(result).toContain("world");
    });

    it("strips <iframe>, <object>, <embed>, <foreignObject>", () => {
      const result = rendered(
        '<iframe src="https://evil.example"></iframe><object data="x"></object><embed src="x"/><svg><foreignObject><div>x</div></foreignObject></svg><p>ok</p>'
      );
      expect(result).not.toContain("<iframe");
      expect(result).not.toContain("<object");
      expect(result).not.toContain("<embed");
      expect(result).not.toContain("foreignobject");
      expect(result).toContain("ok");
    });

    it("strips document-level <base>/<meta>/<link>/<form>", () => {
      const result = rendered(
        '<base href="https://evil.example/"><meta http-equiv="refresh" content="0;url=https://evil.example"><link rel="stylesheet" href="https://evil.example/x.css"><form action="https://evil.example"><input/></form><p>body</p>'
      );
      expect(result).not.toContain("<base");
      expect(result).not.toContain("<meta");
      expect(result).not.toContain("<link");
      expect(result).not.toContain("<form");
      expect(result).not.toContain("evil.example");
      expect(result).toContain("body");
    });
  });

  describe("drops event handlers and dangerous-scheme URLs", () => {
    it("drops on* handlers (the real innerHTML XSS vector)", () => {
      const result = rendered(
        '<img src="x" onerror="alert(1)"/><a href="#" onclick="steal()">x</a>'
      );
      expect(result).not.toContain("onerror");
      expect(result).not.toContain("onclick");
      expect(result).not.toMatch(/alert\(1\)|steal\(\)/);
    });

    it("drops javascript:/vbscript: and data:text/html URLs", () => {
      expect(rendered('<a href="javascript:alert(1)">x</a>')).not.toContain(
        "javascript:"
      );
      expect(
        rendered('<a href="vbscript:msgbox(1)">x</a>')
      ).not.toContain("vbscript:");
      expect(
        rendered('<a href="data:text/html,<script>alert(1)</script>">x</a>')
      ).not.toContain("data:text/html");
      expect(
        rendered('<a href="&#106;avascript:alert(1)">x</a>')
      ).not.toContain("javascript:");
    });
  });

  describe("preserves ordinary rendered markdown (including remote resources)", () => {
    it("keeps formatting, headings, lists, and code", () => {
      const result = rendered(
        '<h1>Title</h1><p><strong>bold</strong> and <em>em</em></p><ul><li>a</li></ul><pre><code>x()</code></pre>'
      );
      expect(result).toContain("<h1");
      expect(result).toContain("<strong");
      expect(result).toContain("<em");
      expect(result).toContain("<li");
      expect(result).toContain("<code");
    });

    it("keeps relative, http(s), and mailto links/images (legit in notes)", () => {
      expect(rendered('<a href="note.md">x</a>')).toContain('href="note.md"');
      expect(
        rendered('<a href="https://example.com/page">x</a>')
      ).toContain("https://example.com/page");
      expect(rendered('<a href="mailto:a@b.com">x</a>')).toContain(
        "mailto:a@b.com"
      );
      expect(
        rendered('<img src="https://example.com/pic.png"/>')
      ).toContain("https://example.com/pic.png");
    });

    it("neutralises remote url() in inline styles but keeps the element", () => {
      const result = rendered(
        '<div style="background:url(http://evil.example/b.png);color:#111">x</div>'
      );
      expect(result).not.toContain("evil.example");
      expect(result).toContain("color:#111");
      expect(result).toContain(">x<");
    });
  });

  describe("fail-safe contract", () => {
    it("returns an empty string for empty / non-string input", () => {
      expect(sanitizeRenderedHtml("")).toBe("");
      expect(sanitizeRenderedHtml(null as unknown as string)).toBe("");
      expect(sanitizeRenderedHtml(123 as unknown as string)).toBe("");
    });
  });
});

// ---------------------------------------------------------------------------
// Adversarial + property hardening (Notidian-b81). Deterministic, offline, no
// new deps: the "property" tests enumerate generated inputs in a loop rather
// than pulling in a fuzzer, so they stay reproducible and fast under jest.
// ---------------------------------------------------------------------------

// A small, seedable PRNG so the generated-input loops are reproducible across
// runs (a failure prints the exact input; re-running reproduces it).
const makeRng = (seed: number): (() => number) => {
  let state = seed >>> 0;
  return () => {
    // xorshift32
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state / 0xffffffff;
  };
};

const SPECIAL = ["&", "<", ">", '"', "'"];
// Spread iterates by Unicode code point, so the emoji surrogate pair stays one
// element: indexing FILLER[i] can never split it into a lone (invalid) surrogate
// — the generated text is always well-formed scalar text, which is what the
// round-trip contract is about (escapeHtml itself touches only the 5 ASCII
// specials and is transparent to everything else).
const FILLER = [...("abc 123 ZZ \n\t.,/-_=:;()[]{}|@#%*+~`" + "éü你好😀")];

const randText = (rng: () => number, maxLen: number): string => {
  const len = Math.floor(rng() * maxLen);
  let out = "";
  for (let i = 0; i < len; i++) {
    // Bias toward the five HTML-significant chars so they appear often.
    if (rng() < 0.45) {
      out += SPECIAL[Math.floor(rng() * SPECIAL.length)];
    } else {
      out += FILLER[Math.floor(rng() * FILLER.length)];
    }
  }
  return out;
};

describe("escapeHtml property: lossless round-trip via contentEditable read-back (Notidian-b81)", () => {
  // escapeHtml's documented contract (sanitize.ts:10-14) is that it seeds a
  // contentEditable field which is later read back; the round-trip must be
  // lossless for ordinary text. The canonical read-back of HTML-entity-decoded
  // text is Node.textContent (jsdom does not implement innerText layout — it is
  // undefined here), which is exactly the value the host platform's
  // contentEditable surfaces; using a real <div contenteditable> element makes
  // the test the genuine sink, not just a string assertion.
  const roundTrip = (text: string): string => {
    const el = document.createElement("div");
    el.setAttribute("contenteditable", "true");
    el.innerHTML = escapeHtml(text);
    return el.textContent ?? "";
  };

  it("round-trips every special char and their permutations losslessly", () => {
    const cases = [
      SPECIAL.join(""),
      SPECIAL.join("X"),
      ...SPECIAL,
      ...SPECIAL.map((c) => c + c),
      "a&b<c>d\"e'f&amp;g", // includes a literal pre-escaped sequence
      "&amp;&lt;&gt;&quot;&#39;", // text that LOOKS escaped must survive verbatim
    ];
    for (const text of cases) {
      expect(roundTrip(text)).toBe(text);
    }
  });

  it("round-trips 500 generated arbitrary strings losslessly (seeded)", () => {
    const rng = makeRng(0x9e3779b9);
    for (let i = 0; i < 500; i++) {
      const text = randText(rng, 40);
      // toBe surfaces the exact failing input in the diff if it ever breaks.
      expect(roundTrip(text)).toBe(text);
    }
  });

  it("never emits a raw HTML-significant char (output is inert as markup)", () => {
    const rng = makeRng(0x12345678);
    for (let i = 0; i < 300; i++) {
      const text = randText(rng, 30);
      const escaped = escapeHtml(text);
      // Parse the escaped output as HTML: it must produce zero child elements,
      // proving no char was interpreted as markup.
      const probe = document.createElement("div");
      probe.innerHTML = escaped;
      expect(probe.childElementCount).toBe(0);
    }
  });

  it("does not double-escape a no-special-char string (identity)", () => {
    expect(escapeHtml("plain ascii text 123")).toBe("plain ascii text 123");
    expect(escapeHtml("héllo wörld 你好")).toBe("héllo wörld 你好");
  });

  it("handles the documented null/undefined contract", () => {
    expect(escapeHtml(null)).toBe("");
    expect(escapeHtml(undefined)).toBe("");
    expect(escapeHtml(0)).toBe("0");
    expect(escapeHtml(false)).toBe("false");
  });
});

describe("nested / recursive adversarial payloads (Notidian-b81)", () => {
  it("removes a <script> buried several layers deep (sanitizeRenderedHtml)", () => {
    const result = rendered(
      "<div><section><article><p><span>" +
        "<script>alert(1)</script>" +
        "</span></p></article></section></div><p>tail</p>"
    );
    expect(result).not.toContain("<script");
    expect(result).not.toContain("alert(1)");
    expect(result).toContain("tail");
    expect(result).toContain("<span");
  });

  it("removes a <script> buried several layers deep (sanitizeIconSVG)", () => {
    const result = lower(
      "<svg><g><g><g><g>" +
        "<script>evil()</script>" +
        '<path d="M0 0"/>' +
        "</g></g></g></g></svg>"
    );
    expect(result).not.toContain("script");
    expect(result).not.toContain("evil()");
    expect(result).toContain("<path");
  });

  it("removes EVERY sibling dangerous element, keeping interleaved safe ones", () => {
    const result = rendered(
      "<div>" +
        "<script>a()</script><p>one</p>" +
        '<iframe src="https://evil.example"></iframe><p>two</p>' +
        '<object data="x"></object><p>three</p>' +
        "</div>"
    );
    expect(result).not.toContain("<script");
    expect(result).not.toContain("<iframe");
    expect(result).not.toContain("<object");
    expect(result).not.toContain("evil.example");
    expect(result).toContain("one");
    expect(result).toContain("two");
    expect(result).toContain("three");
  });

  it("removing a dangerous parent must NOT leave an orphaned child script", () => {
    // <form> is dangerous; a <script> nested inside it must vanish with it (the
    // static querySelectorAll snapshot still visits the detached child, but the
    // output must contain neither).
    const result = rendered(
      '<form action="x"><div><script>steal()</script></div></form><p>after</p>'
    );
    expect(result).not.toContain("<form");
    expect(result).not.toContain("<script");
    expect(result).not.toContain("steal()");
    expect(result).toContain("after");
  });

  it("dangerous element whose ancestor is ALSO dangerous (double removal is safe)", () => {
    const result = rendered(
      '<noscript><iframe src="https://evil.example"><script>x()</script></iframe></noscript><p>ok</p>'
    );
    expect(result).not.toContain("<noscript");
    expect(result).not.toContain("<iframe");
    expect(result).not.toContain("<script");
    expect(result).not.toContain("evil.example");
    expect(result).toContain("ok");
  });

  it("re-parsed output of a nested payload has ZERO dangerous elements", () => {
    const out = sanitizeRenderedHtml(
      "<div><span><script>a()</script></span>" +
        '<p><img src="x" onerror="b()"/></p>' +
        "<svg><foreignObject><iframe></iframe></foreignObject></svg></div>"
    );
    const probe = document.createElement("template");
    probe.innerHTML = out;
    const dangerous = probe.content.querySelectorAll(
      "script, iframe, object, embed, form, noscript, foreignObject"
    );
    expect(dangerous.length).toBe(0);
  });
});

describe("re-injection fixed point (Notidian-b81)", () => {
  // The sanitizer's output must be a FIXED POINT: feeding it back in changes
  // nothing, and the output, re-parsed, exposes no executable surface. This
  // guards against an entity-/escape-driven second-pass resurrection of a
  // dangerous construct.
  const C0 = String.fromCharCode(1); // a C0 control char (the b81 leading-ctrl fix)
  const fixedPointPayloads = [
    '<img src="x" onerror="alert(1)"/><a href="javascript:alert(2)">x</a>',
    '<div><script>evil()</script><p style="background:url(http://evil.example/x)">t</p></div>',
    '<a href="&#106;avascript:alert(1)">x</a><iframe src="https://evil.example"></iframe>',
    '<form action="javascript:alert(1)"><button formaction="javascript:alert(2)">x</button></form>',
    '<svg><foreignObject><script>x()</script></foreignObject><use href="javascript:y()"/></svg>',
    '<a href="' + C0 + 'javascript:alert(1)">x</a>',
  ];

  it("sanitizeRenderedHtml output is stable on a second pass (no change)", () => {
    for (const payload of fixedPointPayloads) {
      const once = sanitizeRenderedHtml(payload);
      const twice = sanitizeRenderedHtml(once);
      expect(twice).toBe(once);
    }
  });

  it("re-parsed output never exposes on*/script/dangerous-scheme", () => {
    for (const payload of fixedPointPayloads) {
      const out = sanitizeRenderedHtml(payload);
      const probe = document.createElement("template");
      probe.innerHTML = out;
      probe.content.querySelectorAll("*").forEach((el) => {
        expect(el.tagName.toLowerCase()).not.toMatch(
          /^(script|iframe|object|embed|form|noscript|foreignobject)$/
        );
        Array.from(el.attributes).forEach((attr) => {
          expect(attr.name.toLowerCase().startsWith("on")).toBe(false);
          const v = attr.value
            .replace(/[\s -]+/g, "")
            .toLowerCase();
          expect(v.startsWith("javascript:")).toBe(false);
          expect(v.startsWith("vbscript:")).toBe(false);
          expect(v.startsWith("data:") && !v.startsWith("data:image/")).toBe(
            false
          );
        });
      });
    }
  });

  it("sanitizeIconSVG output is a fixed point too", () => {
    const svgs = [
      '<svg><script>a()</script><path onclick="b()" d="M0 0"/></svg>',
      '<svg><use href="javascript:alert(1)"/><image href="https://evil.example/x"/></svg>',
      '<svg><style>@import url(http://evil/x.css);.a{background:url(http://evil/y.png)}</style></svg>',
    ];
    for (const svg of svgs) {
      const once = sanitizeIconSVG(svg);
      const twice = sanitizeIconSVG(once);
      expect(twice).toBe(once);
    }
  });
});

describe("scheme-obfuscation matrix for hasDangerousUrlScheme (Notidian-b81)", () => {
  // hasDangerousUrlScheme is internal; exercise it through the public sink across
  // every url-bearing attribute and every obfuscation it must defeat.
  const URL_ATTRS = [
    "href",
    "src",
    "action",
    "formaction",
    "poster",
    "data",
    "background",
  ];

  const TAB = "\t";
  const LF = "\n";
  const CR = "\r";
  const FF = "\f";
  const NBSP = " ";
  const C0_1 = String.fromCharCode(1);
  const C0_8 = String.fromCharCode(8);
  const C0_31 = String.fromCharCode(31);

  // Each obfuscation produces a value that, after parser/sanitizer
  // normalisation, must still be recognised as javascript: and dropped.
  const obfuscate: Array<(scheme: string) => string> = [
    (s) => s, // plain
    (s) => s.toUpperCase(),
    (s) => s.replace("javascript", "JaVaScRiPt"), // mixed case
    (s) => s.replace("a", "a" + TAB).replace("i", "i" + LF), // tab/newline interleave
    (s) => s.replace("v", "v" + FF).replace("s", "s" + CR), // formfeed/CR interleave
    (s) => NBSP + s, // leading NBSP
    (s) => s.replace("c", "c" + NBSP), // interior NBSP
    (s) => C0_1 + s, // leading C0 control (bypass closed by b81)
    (s) => C0_1 + C0_8 + C0_31 + s, // multiple leading C0 controls
    (s) => "  " + TAB + " " + LF + " " + s, // leading mixed whitespace
  ];

  it("blocks javascript: under every obfuscation across every url attribute", () => {
    for (const attr of URL_ATTRS) {
      for (const fn of obfuscate) {
        const value = fn("javascript:alert(1)");
        const out = rendered(`<a ${attr}="${value}">x</a>`);
        expect(out).not.toMatch(/javascript/);
      }
    }
  });

  it("blocks vbscript: under mixed-case + whitespace obfuscation", () => {
    const variants = [
      "vbscript:msgbox(1)",
      "VBScript:msgbox(1)",
      "vb" + TAB + "script:msgbox(1)",
      C0_1 + "vbscript:msgbox(1)",
      NBSP + "vbscript:msgbox(1)",
    ];
    for (const v of variants) {
      expect(rendered(`<a href="${v}">x</a>`)).not.toContain("vbscript:");
    }
  });

  it("blocks data:text/html (markup smuggling) but keeps data:image", () => {
    expect(rendered('<a href="data:text/html,<b>x</b>">y</a>')).not.toContain(
      "data:text/html"
    );
    expect(rendered('<a href="data:text/html,x">y</a>')).not.toContain(
      "data:text/html"
    );
    expect(rendered('<img src="data:image/png;base64,AAAA"/>')).toContain(
      "data:image/png"
    );
  });

  it("does NOT over-block legit URLs that merely contain the substring", () => {
    expect(rendered('<a href="https://x.com/javascript-guide">x</a>')).toContain(
      "javascript-guide"
    );
    expect(rendered('<a href="note-about-vbscript.md">x</a>')).toContain(
      "note-about-vbscript.md"
    );
    expect(rendered('<a href="mailto:js@dev.io">x</a>')).toContain(
      "mailto:js@dev.io"
    );
  });
});

describe("neutralizeCssFetches edge cases (Notidian-b81)", () => {
  it("neutralises MULTIPLE url() in one declaration, keeping the local fragment", () => {
    const result = rendered(
      '<div style="background:url(http://evil.example/a.png),url(#grad),url(https://evil.example/b.png)">x</div>'
    );
    expect(result).not.toContain("evil.example");
    expect(result).not.toContain("http");
    expect(result).toContain("url(#grad)");
    expect(result.match(/url\(\)/g)?.length).toBe(2);
  });

  it("neutralises unquoted url() with odd internal whitespace", () => {
    const result = rendered(
      '<div style="background:url(   http://evil.example/x.png   )">x</div>'
    );
    expect(result).not.toContain("evil.example");
    expect(result).toContain("url()");
  });

  it("neutralises url() with single and double quotes equally", () => {
    expect(
      rendered("<div style=\"background:url('http://evil.example/x')\">x</div>")
    ).not.toContain("evil.example");
    expect(
      rendered(
        '<div style="background:url(&quot;http://evil.example/y&quot;)">x</div>'
      )
    ).not.toContain("evil.example");
  });

  it("drops @import EVEN WITH a media query / trailing clauses (style block)", () => {
    const result = rendered(
      '<style>@import url(http://evil.example/x.css) screen and (max-width: 600px);.a{fill:#0a0}</style><p class="a">t</p>'
    );
    expect(result).not.toContain("@import");
    expect(result).not.toContain("evil.example");
    expect(result).not.toContain("max-width");
    expect(result).toContain("fill:#0a0");
  });

  it("drops a bare @import (no url() token) too", () => {
    const result = rendered(
      '<style>@import "http://evil.example/x.css";.b{fill:#111}</style>'
    );
    expect(result).not.toContain("@import");
    expect(result).not.toContain("evil.example");
    expect(result).toContain("fill:#111");
  });

  it("keeps data:image in CSS but drops data:text/html in CSS", () => {
    const kept = rendered(
      '<div style="background:url(data:image/png;base64,AAAA)">x</div>'
    );
    expect(kept).toContain("data:image/png");

    const dropped = rendered(
      '<div style="background:url(data:text/html,<b>x</b>)">y</div>'
    );
    expect(dropped).not.toContain("data:text/html");
    expect(dropped).toContain("url()");
  });

  it("neutralises CSS fetches inside an SVG <style> block AND a style attribute", () => {
    const styleBlock = lower(
      '<svg><style>.a{background:url(http://evil.example/x.png),url(#g)}</style><rect class="a"/></svg>'
    );
    expect(styleBlock).not.toContain("evil.example");
    expect(styleBlock).toContain("url(#g)");

    const styleAttr = lower(
      '<svg><rect style="fill:url(#g);background:url(http://evil.example/y.png)"/></svg>'
    );
    expect(styleAttr).not.toContain("evil.example");
    expect(styleAttr).toContain("url(#g)");
  });
});
