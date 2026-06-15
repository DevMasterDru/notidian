// Security helpers for the injection-sink sweep (Notidian-ebz).
//
// Threat model: vault content is not fully trusted. Notes (and AI agents that
// write to the vault) can carry pasted/foreign markup, so any place where a
// frontmatter value, file/schema name, or vault-supplied SVG reaches the DOM via
// dangerouslySetInnerHTML / innerHTML must be neutralised. Plugin-authored
// strings (the bundled lucide/ui icon set from getSticker) are NOT routed
// through here — they are trusted and must keep rendering verbatim.

// Escape the five HTML-significant characters so a vault-controlled string is
// shown as literal text instead of being parsed as markup. & must go first or
// the later replacements would be double-escaped. Used to seed contentEditable
// fields that are read back via innerText, so the round-trip is lossless for
// ordinary text (no special chars => identity).
export const escapeHtml = (value: unknown): string => {
  if (value == null) return "";
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
};

// Elements that can execute script or embed/run foreign content inside an SVG.
// SMIL <set>/<animate>* are included because they can write an on* handler at
// runtime, bypassing a one-time static attribute strip. <style> is deliberately
// NOT here: CSS cannot execute script in this context and some legitimate icons
// rely on it. Compared lower-cased, so this is case-insensitive (foreignObject).
const SVG_DANGEROUS_TAGS = new Set([
  "script",
  "foreignobject",
  "iframe",
  "object",
  "embed",
  "set",
  "animate",
  "animatetransform",
]);

const CSS_IMPORT_RE = /@import[^;]*;?/gi;
const CSS_URL_RE = /url\(\s*(['"]?)([^'")]*)\1\s*\)/gi;

// Neutralise remote fetches inside CSS — a <style> block or a style="" attribute.
// Element URL attributes (href/xlink:href/src) are allowlisted below, but CSS can
// fetch too: @import url(...), background/fill: url(...), cursor: url(...). CSS
// cannot execute script in this context, so the risk closed here is a remote
// fetch (icon phoning home / SSRF / tracking beacon) — the same guarantee
// sanitizeIconSVG already makes for element attributes (Notidian-m9r, found by
// the Notidian-5jk adversarial tests). Drop @import rules, and rewrite any
// url(...) that is not a same-document fragment (#id) or an inline data:image to
// an empty url() — preserving legitimate url(#gradient) refs and inline raster
// icons. Regex-based: it handles realistic payloads; exotic CSS escape-obfuscation
// of the url()/@import tokens is out of scope (still only a fetch, never script).
const neutralizeCssFetches = (css: string): string => {
  if (!css) return css;
  return css.replace(CSS_IMPORT_RE, "").replace(CSS_URL_RE, (match, _quote, target) => {
    const value = String(target).replace(/\s+/g, "").toLowerCase();
    return value.startsWith("#") || value.startsWith("data:image/")
      ? match
      : "url()";
  });
};

// Sanitize a vault-supplied SVG icon (custom iconsets) before it is injected as
// raw markup. Removes script/foreignObject/etc. elements and all on* event-handler
// attributes, restricts URL attributes and CSS url()/@import to same-document
// fragments and inline data:image (blocking javascript: and remote fetches in both
// element attributes AND <style>/style CSS), while preserving the shapes/paths/
// fills/styles that make up a legitimate icon. DOM-based: an inert <template> parses
// the markup without executing scripts or fetching resources, and elements are
// matched by lower-cased tagName so camelCase SVG tags can't slip past a
// case-sensitive selector. Runtime only (no DOM in the node test env). Fail-safe:
// any parse error yields an empty string — a missing icon is acceptable, an
// executing payload is not. Deliberately NOT applied to the bundled lucide/ui
// icons, only to untrusted custom-iconset SVG.
export const sanitizeIconSVG = (svg: string): string => {
  if (!svg || typeof svg != "string") return "";
  if (typeof document == "undefined") return "";
  try {
    const template = document.createElement("template");
    template.innerHTML = svg;
    // Static snapshot of all descendants; safe to mutate while iterating.
    template.content.querySelectorAll("*").forEach((el) => {
      const tag = el.tagName.toLowerCase();
      if (SVG_DANGEROUS_TAGS.has(tag)) {
        el.remove();
        return;
      }
      // <style> CSS is kept (legit icons use it) but its remote fetches are
      // neutralised; the element's own attributes (e.g. <style onload>) are still
      // processed by the loop below.
      if (tag == "style") {
        el.textContent = neutralizeCssFetches(el.textContent ?? "");
      }
      Array.from(el.attributes).forEach((attr) => {
        const name = attr.name.toLowerCase();
        // Inline style attributes can fetch via url(); neutralise rather than drop
        // so legitimate fills/gradients survive.
        if (name == "style") {
          el.setAttribute(attr.name, neutralizeCssFetches(attr.value));
          return;
        }
        const value = attr.value.replace(/\s+/g, "").toLowerCase();
        const isUrlAttr =
          name == "href" || name == "xlink:href" || name == "src";
        // on* handlers are always dropped. For URL attributes (e.g. <use href>,
        // <image href>) allow only same-doc fragments (#id) and raster data:image
        // — this blocks javascript:, data:text/html, and remote http(s) fetches
        // (an icon phoning home / SSRF / tracking beacon) while keeping legit
        // symbol reuse and inline raster icons working.
        if (name.startsWith("on")) {
          el.removeAttribute(attr.name);
        } else if (
          isUrlAttr &&
          !(value.startsWith("#") || value.startsWith("data:image/"))
        ) {
          el.removeAttribute(attr.name);
        }
      });
    });
    return template.innerHTML;
  } catch {
    return "";
  }
};

// Elements removed from RENDERED markdown HTML before innerHTML injection: the
// SVG-dangerous set plus document-level navigation/fetch elements that have no
// place in inline note content. <style> is kept (its CSS fetches are neutralised).
const HTML_DANGEROUS_TAGS = new Set([
  ...SVG_DANGEROUS_TAGS,
  "base",
  "meta",
  "link",
  "frame",
  "frameset",
  "applet",
  "form",
  "noscript",
]);

const HTML_URL_ATTRS = new Set([
  "href",
  "xlink:href",
  "src",
  "action",
  "formaction",
  "background",
  "poster",
  "data",
]);

// A URL whose scheme can execute script or smuggle markup. Unlike an icon, rendered
// markdown legitimately links to / embeds remote http(s) resources, so those are
// allowed; only executable/markup schemes are blocked.
//
// Normalisation mirrors (a strict superset of) what the WHATWG URL parser does
// before it reads the scheme, so an attacker cannot hide a dangerous scheme behind
// characters the browser discards at navigation time. The parser strips ALL leading
// (and trailing) C0 control chars (U+0000-U+001F) or space, and every ASCII tab/
// newline throughout, BEFORE reading the scheme: so `\u0001javascript:` parses (and
// executes) as plain `javascript:`. The old `\s`-only strip was a real bypass here
// because `\s` matches \t\n\v\f\r, space, NBSP and Unicode whitespace but NOT the
// C0 controls \u0001-\u0008 / \u000e-\u001f. We strip every whitespace char (\s) AND
// the whole C0 control range globally -- a superset that can only over-block (an
// interior control char breaks a real scheme, so dropping it is harmless), never
// under-block. Entities were already decoded by the HTML parser (Notidian-b81).
const hasDangerousUrlScheme = (raw: string): boolean => {
  // eslint-disable-next-line no-control-regex
  const value = (raw ?? "").replace(/[\s\u0000-\u001f]+/g, "").toLowerCase();
  if (value.startsWith("javascript:") || value.startsWith("vbscript:")) {
    return true;
  }
  if (value.startsWith("data:") && !value.startsWith("data:image/")) {
    return true;
  }
  return false;
};

// Sanitize a RENDERED HTML string from the markdown->HTML pipeline before it is
// injected via innerHTML (FileLinkViewComponent note/link preview, and the
// markdownAdapter canvas-thumbnail foreignObject). The pipeline already drops most
// raw HTML via htmlToTree's tag whitelist and emits no raw nodes (hast-util-to-html
// runs without allowDangerousHtml), but this is the defence-in-depth chokepoint the
// authority/security model requires for any vault-content innerHTML sink: it removes
// script-capable/navigation/fetch elements and all on* handlers, neutralises CSS
// fetches in <style>/style, and drops dangerous-scheme URLs (javascript:/vbscript:/
// data:text-html) while preserving ordinary markdown (formatting, links, images,
// including remote http(s)). DOM-based and fail-safe ("" on parse error or no DOM).
// Notidian-3yb (follow-up to the Notidian-ebz sweep).
export const sanitizeRenderedHtml = (html: string): string => {
  if (!html || typeof html != "string") return "";
  if (typeof document == "undefined") return "";
  try {
    const template = document.createElement("template");
    template.innerHTML = html;
    template.content.querySelectorAll("*").forEach((el) => {
      const tag = el.tagName.toLowerCase();
      if (HTML_DANGEROUS_TAGS.has(tag)) {
        el.remove();
        return;
      }
      if (tag == "style") {
        el.textContent = neutralizeCssFetches(el.textContent ?? "");
      }
      Array.from(el.attributes).forEach((attr) => {
        const name = attr.name.toLowerCase();
        if (name.startsWith("on")) {
          el.removeAttribute(attr.name);
        } else if (name == "style") {
          el.setAttribute(attr.name, neutralizeCssFetches(attr.value));
        } else if (HTML_URL_ATTRS.has(name) && hasDangerousUrlScheme(attr.value)) {
          el.removeAttribute(attr.name);
        }
      });
    });
    return template.innerHTML;
  } catch {
    return "";
  }
};
