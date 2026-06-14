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
