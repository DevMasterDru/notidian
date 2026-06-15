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

const CSS_COMMENT_RE = /\/\*[\s\S]*?\*\//g;
// A CSS escape is either a hex escape (\ + 1-6 hex digits, with an OPTIONAL single
// trailing whitespace terminator that the tokenizer consumes) or a literal escape
// (\ + any single non-hex, non-newline char standing for itself). We decode both
// so an obfuscated token like \75rl(...) (\75 = 'u') normalises to its literal form
// BEFORE the url()/@import regex runs. A trailing backslash with nothing after it
// is dropped (matches the CSS tokenizer, which treats EOF after \ as U+FFFD/ignored).
const CSS_ESCAPE_RE = /\\([0-9a-fA-F]{1,6})[ \t\n\r\f]?|\\([^\n\r\f])|\\$/g;
const CSS_IMPORT_RE = /@import[^;]*;?/gi;
// Quote-tolerant url() capture: the target is everything up to the closing paren,
// with quotes treated as ordinary chars inside the capture. This means a
// quote-MISMATCH (url("...') no longer makes the whole match fail and leak the
// target — we capture it, then strip stray quote chars before the allowlist test.
const CSS_URL_RE = /url\(([^)]*)\)/gi;

// Decode CSS hex/literal escapes so escape-obfuscated tokens normalise to their
// literal form (e.g. \75rl( -> url(). Browsers decode these before tokenising, so
// the regex below must see the same decoded text the browser would.
const decodeCssEscapes = (css: string): string =>
  css.replace(CSS_ESCAPE_RE, (full, hex: string | undefined, literal: string | undefined) => {
    if (hex != null) {
      const cp = parseInt(hex, 16);
      // 0 and out-of-range/surrogate codepoints become U+FFFD per the CSS tokenizer.
      if (cp === 0 || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) {
        return "�";
      }
      return String.fromCodePoint(cp);
    }
    if (literal != null) return literal;
    return ""; // trailing lone backslash (\$) — dropped
  });

// Neutralise remote fetches inside CSS — a <style> block or a style="" attribute.
// Element URL attributes (href/xlink:href/src) are allowlisted below, but CSS can
// fetch too: @import url(...), background/fill: url(...), cursor: url(...). CSS
// cannot execute script in this context, so the risk closed here is a remote
// fetch (icon phoning home / SSRF / tracking beacon) — the same guarantee
// sanitizeIconSVG already makes for element attributes (Notidian-m9r, found by
// the Notidian-5jk adversarial tests).
//
// A browser strips CSS comments and decodes CSS escapes BEFORE it tokenises url()/
// @import, so a regex over the raw text alone under-blocks three spec-legal
// obfuscations a browser still resolves as a remote fetch (Notidian-35q, found by
// the Notidian-hef adversarial sweep): hex/unicode escapes (\75rl(...)),
// comment-split tokens (u/**/rl(...)), and quote-mismatch (url("...')). We close
// that gap by NORMALISING first — strip comments, then decode escapes — so the
// neutraliser sees the same tokens the browser will, then re-derive every url()
// target with a quote-tolerant capture that can't leak on mismatched quotes.
//
// After normalisation: drop @import rules, and rewrite any url(...) that is not a
// same-document fragment (#id) or an inline data:image to an empty url() —
// preserving legitimate url(#gradient) refs and inline raster icons. The output is
// the normalised (comment-free, escape-decoded) CSS, which a browser interprets
// identically to the input, so this is sound (and idempotent — a second pass over
// already-normalised CSS is a fixed point).
const neutralizeCssFetches = (css: string): string => {
  if (!css) return css;
  const normalized = decodeCssEscapes(css.replace(CSS_COMMENT_RE, ""));
  return normalized
    .replace(CSS_IMPORT_RE, "")
    .replace(CSS_URL_RE, (match, target: string) => {
      // Strip surrounding/stray quote chars and whitespace, then test the allowlist.
      // Quotes are stripped wholesale (not just a matched pair) so a quote-mismatch
      // cannot smuggle a remote target past the #/data:image check.
      const value = String(target)
        .replace(/['"]/g, "")
        .replace(/\s+/g, "")
        .toLowerCase();
      return value.startsWith("#") || value.startsWith("data:image/")
        ? match
        : "url()";
    });
};

// Run a single-pass DOM cleaner to a FIXED POINT before returning, to defeat
// mutation-XSS (mXSS). A single template.innerHTML parse + serialise round-trip is
// not necessarily a closure: the HTML/foreign-content (SVG/MathML) parser has
// integration points where the tree the sanitiser SEES differs from the tree a
// browser builds when the SERIALISED output is re-parsed at the live innerHTML/
// dangerouslySetInnerHTML sink. The canonical case (found by the Notidian-y3h
// adversarial sweep): `<math><mtext><mglyph><style><img src=x onerror=alert(1)>`
// parses with the <img onerror> as the TEXT of <style> (so the attribute loop never
// sees it and CSS-neutralisation leaves it intact), but when that exact string is
// assigned to a live element's innerHTML the parser re-tokenises it into a LIVE
// <img onerror> in the light DOM — a working handler the single pass missed.
//
// Re-running the same cleaner on its own output closes the gap: on the second parse
// the smuggled node is already hoisted out of the integration point into the light
// DOM, where the cleaner's normal element/attribute strip catches it. The transform
// is monotone (it only removes elements/attributes and neutralises CSS — it never
// adds executable surface) and the serialiser is deterministic, so the iteration
// converges to a fixed point quickly (<=3 passes for every known payload).
//
// ONE exception breaks naive convergence: the obsolete <plaintext> element is the
// only HTML element whose parse->serialise round-trip is itself non-idempotent. Its
// content model swallows the rest of the input as raw text to EOF, but the
// serialiser still emits a `</plaintext>` close tag; that close tag is re-consumed
// as literal text by the next parse, which re-serialises it AGAIN — so each pass
// appends another `</plaintext>` and the string grows without bound. Pre-Notidian-y3h
// (single pass) preserved such content; the fixed-point loop, left unguarded, would
// hit the cap and destroy the WHOLE input (incl. benign neighbours) to "". <plaintext>
// is not dangerous (no handlers/URLs, everything after it is inert text in every
// parse), so the fix is in the per-pass cleaner: it rewrites each <plaintext> to a
// text node of its rendered content (exactly how a browser renders it), which is both
// idempotent and lossless. With that, an exhaustive scan of every HTML element name
// finds NO remaining non-idempotent construct, so the loop always converges fast.
//
// We still cap iterations defensively: if some future parser quirk fails to reach a
// fixed point within the cap, we fail safe by ESCAPING the original input to inert
// literal text (escapeHtml) rather than returning "" — that keeps the content
// visible (no silent data loss) while guaranteeing it carries no executable surface.
// A second pass over already-clean markup is itself the fixed point, so this
// preserves the documented idempotency contract and adds no cost for benign content
// (1 extra confirming pass).

// Replace every <plaintext> element in a parsed fragment with a text node of its
// rendered content. <plaintext> is the lone HTML element with a non-idempotent
// parse/serialise round-trip (see sanitizeToFixedPoint above): left intact it makes
// the fixed-point loop diverge and destroy benign content. It is not dangerous —
// browsers render everything after the tag as literal preformatted text, and that
// text stays inert through any number of re-parses — so collapsing it to its text
// node is BOTH faithful to how a browser shows it AND idempotent (a plain text node
// has no <plaintext> to rewrite on the next pass). Operates on the parsed
// template.content so it is consistent across both DOM-sink cleaners.
const collapsePlaintextElements = (root: DocumentFragment): void => {
  root.querySelectorAll("plaintext").forEach((el) => {
    el.replaceWith(root.ownerDocument.createTextNode(el.textContent ?? ""));
  });
};

const FIXED_POINT_MAX_PASSES = 6;
const sanitizeToFixedPoint = (
  html: string,
  onePass: (input: string) => string
): string => {
  let current = html;
  for (let i = 0; i < FIXED_POINT_MAX_PASSES; i++) {
    const next = onePass(current);
    if (next === current) return current; // stable: re-parsing changes nothing
    current = next;
  }
  // One more pass that STILL differs means we never reached a fixed point within the
  // cap. The serialised output cannot be trusted as fully neutralised, so fall back
  // to escaping the ORIGINAL input to inert literal text: safe by construction and,
  // unlike "", non-destructive — the user still sees their content (Notidian-DEPTH-
  // sanitize-rendered-frame-adversarial).
  return onePass(current) === current ? current : escapeHtml(html);
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
// icons, only to untrusted custom-iconset SVG. Run to a fixed point (above) so a
// parse-differential mXSS cannot survive the single parse/serialise round-trip.
const sanitizeIconSVGPass = (svg: string): string => {
  const template = document.createElement("template");
  template.innerHTML = svg;
  // Collapse the non-idempotent <plaintext> element to inert text first, so a
  // malformed icon carrying a top-level <plaintext> cannot diverge the fixed-point
  // loop (inside <svg> it is harmless foreign content and converges anyway).
  collapsePlaintextElements(template.content);
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
};

export const sanitizeIconSVG = (svg: string): string => {
  if (!svg || typeof svg != "string") return "";
  if (typeof document == "undefined") return "";
  try {
    return sanitizeToFixedPoint(svg, sanitizeIconSVGPass);
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
//
// One pass of the rendered-HTML / frame-text cleaner. sanitizeRenderedHtml and
// sanitizeFrameText share IDENTICAL element/attribute rules (the only difference is
// their input validation and the surrounding contract), so the per-pass work lives
// here and both run it to a fixed point (sanitizeToFixedPoint) to defeat the
// parse-differential mXSS documented above (Notidian-y3h).
const sanitizeHtmlSinkPass = (html: string): string => {
  const template = document.createElement("template");
  template.innerHTML = html;
  // Collapse the non-idempotent <plaintext> element to inert text BEFORE the
  // element/attribute strip so the fixed-point loop converges (see
  // collapsePlaintextElements / sanitizeToFixedPoint).
  collapsePlaintextElements(template.content);
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
};

export const sanitizeRenderedHtml = (html: string): string => {
  if (!html || typeof html != "string") return "";
  if (typeof document == "undefined") return "";
  try {
    return sanitizeToFixedPoint(html, sanitizeHtmlSinkPass);
  } catch {
    return "";
  }
};

// Sanitize the INLINE HTML of a frame text node (TextNodeView) before it is
// injected via dangerouslySetInnerHTML. Unlike a frontmatter value, this string
// is NOT plain text: the node is contentEditable and onBlur reads back
// e.target.innerHTML, so frame text legitimately carries inline FORMATTING markup
// (bold/italic/links/spans/line breaks). escapeHtml is therefore wrong here — it
// would render the tags as literal text on first paint and then double-escape on
// the innerHTML round-trip, corrupting the saved value. Instead we strip only what
// is genuinely dangerous and KEEP the formatting tags:
//   - remove script-capable / navigation / fetch elements (the shared
//     HTML_DANGEROUS_TAGS set: script/iframe/object/embed/SMIL/base/meta/link/
//     frame/form/...),
//   - drop every on* event-handler attribute,
//   - neutralise remote fetches inside <style>/style CSS (@import, url(...)),
//   - drop URL attributes whose scheme can execute/smuggle markup
//     (javascript:/vbscript:/data:text-html), keeping ordinary http(s)/# links.
// DOM-based (an inert <template> parses without executing/fetching) and fail-safe:
// "" on parse error or when there is no DOM (node test env / non-render contexts),
// matching sanitizeIconSVG / sanitizeRenderedHtml. The round-trip is lossless for
// content that contains no dangerous constructs, so a saved value re-sanitised on
// the next paint is stable (idempotent). bd Notidian-vke (deferred ebz sink #2).
// Shares the per-pass cleaner with sanitizeRenderedHtml and runs it to a fixed
// point (Notidian-y3h) so a parse-differential mXSS — directly reachable here
// because frame text is contentEditable and can carry pasted foreign markup —
// cannot survive the single parse/serialise round-trip.
export const sanitizeFrameText = (html: unknown): string => {
  if (html == null) return "";
  if (typeof html != "string") return "";
  if (html == "") return "";
  if (typeof document == "undefined") return "";
  try {
    return sanitizeToFixedPoint(html, sanitizeHtmlSinkPass);
  } catch {
    return "";
  }
};
