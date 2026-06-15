/**
 * @jest-environment jsdom
 */
// Real-DOM coverage for sanitizeFrameText (Notidian-vke, deferred ebz sink #2).
//
// Frame text (TextNodeView) is injected via dangerouslySetInnerHTML and the node
// is contentEditable: onBlur reads back e.target.innerHTML, so the value
// legitimately carries inline FORMATTING markup (bold/italic/links/spans/breaks).
// The sanitizer must therefore strip only what is genuinely dangerous
// (script/on*/dangerous-URLs/fetch elements) and KEEP formatting — the opposite
// of escapeHtml, which would render tags as literal text and corrupt the
// innerHTML round-trip. This file opts into jsdom (the default env is node, where
// the function early-returns ""), importing no React so the transform surface
// stays narrow (matching sanitize.dom.test.ts).
import { sanitizeFrameText } from "shared/utils/sanitize";

const frame = (html: string): string => sanitizeFrameText(html).toLowerCase();

describe("sanitizeFrameText — jsdom (Notidian-vke)", () => {
  it("runs against a real DOM (no node-env early return)", () => {
    expect(typeof document).not.toBe("undefined");
    // Formatting survives — proves real DOM work happened, not the "" early return.
    expect(frame("<b>bold</b>")).toContain("<b>");
  });

  describe("KEEPS inline formatting (the core difference from escapeHtml)", () => {
    it("preserves bold/italic/strong/em/underline/span", () => {
      const result = frame(
        "<b>b</b><i>i</i><strong>s</strong><em>e</em><u>u</u><span>x</span>"
      );
      expect(result).toContain("<b>");
      expect(result).toContain("<i>");
      expect(result).toContain("<strong>");
      expect(result).toContain("<em>");
      expect(result).toContain("<u>");
      expect(result).toContain("<span>");
    });

    it("preserves line breaks, divs, and ordinary text content", () => {
      const result = frame("line one<br>line two<div>line three</div>");
      expect(result).toContain("<br");
      expect(result).toContain("<div");
      expect(result).toContain("line one");
      expect(result).toContain("line three");
    });

    it("preserves a safe color/style span (frame text styling)", () => {
      const result = frame('<span style="color:#e11;font-weight:600">red</span>');
      expect(result).toContain("color:#e11");
      expect(result).toContain("font-weight:600");
      expect(result).toContain("red");
    });

    it("preserves legitimate links (relative, http(s), mailto)", () => {
      expect(frame('<a href="note.md">x</a>')).toContain('href="note.md"');
      expect(frame('<a href="https://example.com">x</a>')).toContain(
        "https://example.com"
      );
      expect(frame('<a href="mailto:a@b.com">x</a>')).toContain("mailto:a@b.com");
    });

    it("is the identity for plain text (no special constructs)", () => {
      expect(sanitizeFrameText("Project Notes 2026")).toBe("Project Notes 2026");
      expect(sanitizeFrameText("café — déjà vu 😀")).toBe("café — déjà vu 😀");
    });
  });

  describe("STRIPS the dangerous constructs", () => {
    it("removes <script> but keeps surrounding formatted text", () => {
      const result = frame("<b>safe</b><script>alert(1)</script>more");
      expect(result).not.toContain("<script");
      expect(result).not.toContain("alert(1)");
      expect(result).toContain("<b>");
      expect(result).toContain("more");
    });

    it("drops on* event handlers but keeps the element", () => {
      const result = frame('<span onclick="steal()" onmouseover="x()">t</span>');
      expect(result).not.toContain("onclick");
      expect(result).not.toContain("onmouseover");
      expect(result).not.toMatch(/steal\(\)|x\(\)/);
      expect(result).toContain("<span");
      expect(result).toContain("t");
    });

    it("drops onerror on an injected <img>", () => {
      const result = frame('<img src="x" onerror="alert(1)">caption');
      expect(result).not.toContain("onerror");
      expect(result).not.toContain("alert(1)");
      expect(result).toContain("caption");
    });

    it("drops javascript:/vbscript:/data:text-html links, keeps the anchor text", () => {
      expect(frame('<a href="javascript:alert(1)">x</a>')).not.toContain(
        "javascript:"
      );
      expect(frame('<a href="vbscript:msgbox(1)">x</a>')).not.toContain(
        "vbscript:"
      );
      expect(
        frame('<a href="data:text/html,<script>alert(1)</script>">x</a>')
      ).not.toContain("data:text/html");
      // entity- and whitespace-obfuscated variants are caught too
      expect(frame('<a href="&#106;avascript:alert(1)">x</a>')).not.toContain(
        "javascript:"
      );
    });

    it("removes <iframe>/<object>/<embed>/<form> embedded in frame text", () => {
      const result = frame(
        '<iframe src="https://evil.example"></iframe>' +
          '<object data="x"></object><embed src="x">' +
          '<form action="https://evil.example"><input></form><b>kept</b>'
      );
      expect(result).not.toContain("<iframe");
      expect(result).not.toContain("<object");
      expect(result).not.toContain("<embed");
      expect(result).not.toContain("<form");
      expect(result).not.toContain("evil.example");
      expect(result).toContain("<b>");
    });

    it("neutralises remote url() in an inline style but keeps the element", () => {
      const result = frame(
        '<span style="background:url(http://evil.example/x.png);color:#111">t</span>'
      );
      expect(result).not.toContain("evil.example");
      expect(result).toContain("color:#111");
      expect(result).toContain("t");
    });

    it("removes a <script> buried inside nested formatting", () => {
      const result = frame(
        "<div><span><b><script>evil()</script></b></span></div>tail"
      );
      expect(result).not.toContain("<script");
      expect(result).not.toContain("evil()");
      expect(result).toContain("tail");
    });
  });

  describe("contentEditable round-trip safety", () => {
    it("is idempotent: re-sanitising the output changes nothing (fixed point)", () => {
      const payloads = [
        "<b>bold</b> and <i>italic</i> text",
        '<span style="color:#e11">red</span><br>line',
        '<img src="x" onerror="alert(1)"><b>kept</b>',
        '<a href="javascript:alert(1)">x</a><a href="note.md">y</a>',
        "<div><script>evil()</script><span>safe</span></div>",
      ];
      for (const p of payloads) {
        const once = sanitizeFrameText(p);
        const twice = sanitizeFrameText(once);
        expect(twice).toBe(once);
      }
    });

    it("re-parsed output exposes no script/on*/dangerous-scheme surface", () => {
      const out = sanitizeFrameText(
        '<b>x</b><script>a()</script><img src="x" onerror="b()">' +
          '<a href="javascript:c()">l</a><iframe src="https://evil.example"></iframe>'
      );
      const probe = document.createElement("template");
      probe.innerHTML = out;
      probe.content.querySelectorAll("*").forEach((el) => {
        expect(el.tagName.toLowerCase()).not.toMatch(
          /^(script|iframe|object|embed|form|noscript|foreignobject)$/
        );
        Array.from(el.attributes).forEach((attr) => {
          expect(attr.name.toLowerCase().startsWith("on")).toBe(false);
          const v = attr.value.replace(/[\s\-]+/g, "").toLowerCase();
          expect(v.startsWith("javascript:")).toBe(false);
          expect(v.startsWith("vbscript:")).toBe(false);
        });
      });
      // the legitimate formatting survived the same pass
      expect(out.toLowerCase()).toContain("<b>");
    });

    it("a real contentEditable read-back of safe text is lossless", () => {
      // The TextNodeView sink: the value is set as innerHTML on a contentEditable
      // div and onBlur reads e.target.innerHTML back. For content that contains
      // no dangerous constructs, that round-trip must be lossless (formatting
      // preserved), which is exactly why escapeHtml is unusable here.
      const safe = "<b>Title</b> — <i>note</i> with a <a href=\"x.md\">link</a>";
      const el = document.createElement("div");
      el.setAttribute("contenteditable", "true");
      el.innerHTML = sanitizeFrameText(safe);
      // innerHTML read-back keeps the formatting tags.
      expect(el.innerHTML.toLowerCase()).toContain("<b>");
      expect(el.innerHTML.toLowerCase()).toContain("<i>");
      expect(el.innerHTML.toLowerCase()).toContain("<a");
    });
  });

  describe("fail-safe contract", () => {
    it("returns '' for empty / nullish / non-string input", () => {
      expect(sanitizeFrameText("")).toBe("");
      expect(sanitizeFrameText(null)).toBe("");
      expect(sanitizeFrameText(undefined)).toBe("");
      expect(sanitizeFrameText(123 as unknown as string)).toBe("");
    });

    it("always returns a string", () => {
      expect(typeof sanitizeFrameText("<b>x</b>")).toBe("string");
      expect(typeof sanitizeFrameText("plain")).toBe("string");
    });
  });
});
