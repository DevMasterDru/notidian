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
import { sanitizeIconSVG } from "shared/utils/sanitize";

const lower = (svg: string): string => sanitizeIconSVG(svg).toLowerCase();

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
