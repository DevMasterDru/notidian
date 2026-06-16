import { FrameTreeProp } from "shared/types/mframe";

/**
 * State prefix regex for parsing state-specific style properties
 * Matches patterns like "hover:backgroundColor", "press:transform", etc.
 */
export const STATE_PREFIX_REGEX = /^(hover|press|focus|active|disabled|selected|loading|error):(.+)$/;

/**
 * Supported interaction states
 */
export type InteractionState = {
  hover?: boolean;
  press?: boolean;
  focus?: boolean;
  active?: boolean;
  disabled?: boolean;
  selected?: boolean;
  loading?: boolean;
  error?: boolean;
};

/**
 * Parsed state styles structure for caching
 */
export type ParsedStateStyles = {
  baseStyles: FrameTreeProp;
  stateStyles: { [state: string]: FrameTreeProp };
};

/**
 * WeakMap cache for parsed state styles to avoid re-parsing
 */
const stateStyleCache = new WeakMap<FrameTreeProp, ParsedStateStyles>();

/**
 * Parse styles object into base styles and state-specific styles
 * @param styles - The styles object potentially containing state prefixes
 * @returns Parsed styles separated by state
 */
export const parseStateStyles = (styles: FrameTreeProp): ParsedStateStyles => {
  // Check cache first
  const cached = stateStyleCache.get(styles);
  if (cached) {
    return cached;
  }

  const baseStyles: FrameTreeProp = {};
  const stateStyles: { [state: string]: FrameTreeProp } = {};

  for (const [key, value] of Object.entries(styles)) {
    const match = key.match(STATE_PREFIX_REGEX);

    if (match) {
      const [, stateType, propertyName] = match;
      if (!stateStyles[stateType]) {
        stateStyles[stateType] = {};
      }
      stateStyles[stateType][propertyName] = value;
    } else {
      baseStyles[key] = value;
    }
  }

  const result = { baseStyles, stateStyles };
  
  // Cache the result
  stateStyleCache.set(styles, result);
  
  return result;
};

/**
 * Resolve styles based on current interaction state
 * @param styles - The styles object potentially containing state prefixes
 * @param currentState - Current interaction state
 * @returns Resolved styles with state-specific styles applied
 */
export const parseStylesForState = (
  styles: FrameTreeProp,
  currentState: InteractionState
): FrameTreeProp => {
  if (!styles || Object.keys(styles).length === 0) {
    return styles;
  }

  const { baseStyles, stateStyles } = parseStateStyles(styles);
  
  // Start with base styles
  const resolvedStyles = { ...baseStyles };

  // Apply state-specific styles in priority order
  // Later states override earlier ones if multiple are active
  const statePriority = ['disabled', 'loading', 'error', 'selected', 'focus', 'hover', 'press', 'active'];
  
  for (const stateType of statePriority) {
    if (currentState[stateType as keyof InteractionState] && stateStyles[stateType]) {
      Object.assign(resolvedStyles, stateStyles[stateType]);
    }
  }

  return resolvedStyles;
};

/**
 * Check if a styles object contains any state-prefixed properties
 * @param styles - The styles object to check
 * @returns True if any state prefixes are found
 */
export const hasStatePrefixes = (styles: FrameTreeProp): boolean => {
  if (!styles) return false;
  
  return Object.keys(styles).some(key => STATE_PREFIX_REGEX.test(key));
};

/**
 * Extract all unique state types from a styles object
 * @param styles - The styles object to analyze
 * @returns Array of state types found in the styles
 */
export const extractStateTypes = (styles: FrameTreeProp): string[] => {
  if (!styles) return [];
  
  const stateTypes = new Set<string>();
  
  for (const key of Object.keys(styles)) {
    const match = key.match(STATE_PREFIX_REGEX);
    if (match) {
      stateTypes.add(match[1]);
    }
  }
  
  return Array.from(stateTypes);
};

/**
 * Real CSS pseudo-class for each interaction state that maps to one.
 * hover / focus / active / disabled are genuine pseudo-classes the browser
 * toggles itself, so they emit `.className:state { ... }`.
 */
const STATE_PSEUDO_SELECTOR_MAP: { readonly [state: string]: string } = {
  hover: ':hover',
  focus: ':focus',
  active: ':active',
  disabled: ':disabled',
};

/**
 * The four documented interaction states that are NOT real CSS pseudo-classes
 * (press / selected / loading / error). They cannot be a `:state` pseudo, so
 * they are driven by a `data-state` attribute the runtime sets on the element
 * and emit `.className[data-state~="state"] { ... }`. The `~=` token match lets
 * several non-pseudo states coexist in one space-separated `data-state` value
 * (e.g. `data-state="loading selected"`), matching how parseStylesForState
 * already allows multiple simultaneously-active states.
 */
const NON_PSEUDO_STATES: ReadonlySet<string> = new Set([
  'press',
  'selected',
  'loading',
  'error',
]);

/**
 * Escape a class name for safe interpolation into a CSS selector.
 *
 * `generateStatefulCSS` builds selectors via string interpolation
 * (`.${className} { ... }`). Without escaping, a className containing CSS
 * metacharacters (spaces, `{`, `}`, `.`, `#`, `:`, `[`, `]`, etc.) would break
 * out of the intended `.class` selector and inject arbitrary rules into the
 * emitted stylesheet — e.g. `frame-1 .evil { } .injected` would emit a rule for
 * a *different* element plus a dangling rule. This is a CSS-injection sink.
 *
 * Strategy:
 *  - Prefer the platform `CSS.escape` (CSSOM `serializeIdentifier`), the
 *    spec-correct identifier serializer, when it exists (real browser DOM).
 *  - Otherwise fall back to a spec-aligned manual escape: the jest test
 *    environment is `node` (and even jsdom does not expose `window.CSS`), so a
 *    self-contained fallback is mandatory, not optional. It backslash-escapes
 *    every character outside the CSS "safe" identifier set `[A-Za-z0-9_-]` and
 *    hex-escapes the two positional hazards the spec calls out (a leading digit,
 *    and a leading hyphen followed by a digit), so the result is always a single
 *    valid CSS identifier that cannot terminate the selector early.
 */
const escapeClassName = (className: string): string => {
  // Prefer the platform serializer when present (real DOM contexts).
  const platformCSS = (globalThis as { CSS?: { escape?: (value: string) => string } }).CSS;
  if (platformCSS && typeof platformCSS.escape === "function") {
    return platformCSS.escape(className);
  }

  // Self-contained, spec-aligned fallback (node/jsdom — no `CSS.escape`).
  // Mirrors CSSOM serializeIdentifier for the cases that matter here.
  let result = "";
  for (let i = 0; i < className.length; i++) {
    const ch = className[i];
    const code = className.charCodeAt(i);

    // NULL -> U+FFFD REPLACEMENT CHARACTER (per the serialize-identifier algorithm).
    if (code === 0x0000) {
      result += "�";
      continue;
    }

    // A leading digit, or a leading hyphen followed by a digit, must be
    // hex-escaped so the identifier cannot be read as a number.
    const isDigit = code >= 0x0030 && code <= 0x0039;
    if (i === 0 && isDigit) {
      result += `\\${code.toString(16)} `;
      continue;
    }
    if (i === 1 && isDigit && className.charCodeAt(0) === 0x002d /* - */) {
      result += `\\${code.toString(16)} `;
      continue;
    }

    // Control characters (incl. DEL) are hex-escaped.
    if ((code >= 0x0001 && code <= 0x001f) || code === 0x007f) {
      result += `\\${code.toString(16)} `;
      continue;
    }

    // The CSS-safe identifier set passes through unescaped.
    const isSafe =
      (code >= 0x0041 && code <= 0x005a) || // A-Z
      (code >= 0x0061 && code <= 0x007a) || // a-z
      isDigit ||
      code === 0x002d || // -
      code === 0x005f || // _
      code >= 0x0080; // non-ASCII passes through (valid in identifiers)
    if (isSafe) {
      result += ch;
      continue;
    }

    // Everything else (space, {, }, ., #, :, [, ], (, ), etc.) is backslash-escaped.
    result += `\\${ch}`;
  }
  return result;
};

/**
 * Build the CSS selector that targets `className` for a given interaction
 * state. Real pseudo-classes use a `:state` suffix; the four non-pseudo states
 * use a deterministic `[data-state~="state"]` attribute selector. Returns null
 * for any state that is neither (so unknown states are skipped, not emitted as
 * malformed CSS).
 *
 * `className` is assumed to be ALREADY escaped by the caller (see
 * `generateStatefulCSS`), so it is interpolated directly here — escape once at
 * the source, not per selector.
 */
const selectorForState = (className: string, stateType: string): string | null => {
  const pseudoSelector = STATE_PSEUDO_SELECTOR_MAP[stateType];
  if (pseudoSelector) {
    return `.${className}${pseudoSelector}`;
  }
  if (NON_PSEUDO_STATES.has(stateType)) {
    return `.${className}[data-state~="${stateType}"]`;
  }
  return null;
};

/**
 * Generate CSS for state-specific styles (for performance optimization).
 *
 * Emits a rule block for every documented interaction state: the four real
 * pseudo-classes (hover/focus/active/disabled) as `:state` selectors, and the
 * four non-pseudo states (press/selected/loading/error) as deterministic
 * `[data-state~="state"]` attribute selectors. No documented state is silently
 * dropped.
 *
 * @param styles - The styles object containing state prefixes
 * @param className - CSS class name to apply styles to
 * @returns CSS string with one rule block per base + present interaction state
 */
export const generateStatefulCSS = (styles: FrameTreeProp, className: string): string => {
  const { baseStyles, stateStyles } = parseStateStyles(styles);

  // Escape ONCE at the source. `className` is interpolated raw into every
  // emitted selector (the base `.cls` rule and every pseudo / data-state rule
  // built by selectorForState), so an unescaped className containing CSS
  // metacharacters would inject arbitrary rules into the stylesheet. Escaping
  // here neutralizes the injection for both the base rule and all state rules.
  const safeClassName = escapeClassName(className);

  let css = '';

  // Base styles
  if (Object.keys(baseStyles).length > 0) {
    css += `.${safeClassName} { ${convertToCSS(baseStyles)} }\n`;
  }

  // State-specific CSS: real pseudo-classes get a ':state' selector, the four
  // non-pseudo states get a deterministic '[data-state~="state"]' selector.
  for (const [stateType, stateStyleObj] of Object.entries(stateStyles)) {
    const selector = selectorForState(safeClassName, stateType);
    if (selector && Object.keys(stateStyleObj).length > 0) {
      css += `${selector} { ${convertToCSS(stateStyleObj)} }\n`;
    }
  }

  return css;
};

/**
 * Convert style object to CSS string
 * @param styles - Style object to convert
 * @returns CSS property string
 */
const convertToCSS = (styles: FrameTreeProp): string => {
  return Object.entries(styles)
    .map(([key, value]) => {
      // Convert camelCase to kebab-case
      const cssProperty = key.replace(/([A-Z])/g, '-$1').toLowerCase();
      return `${cssProperty}: ${value};`;
    })
    .join(' ');
};

/**
 * Check if state styles contain only simple CSS properties that can be handled with CSS pseudo-selectors
 * @param stateStyles - State styles to check
 * @returns True if styles are simple enough for CSS-only handling
 */
export const isSimpleStateStyles = (stateStyles: { [state: string]: FrameTreeProp }): boolean => {
  const simpleProperties = new Set([
    'backgroundColor', 'color', 'opacity', 'transform', 'boxShadow', 
    'borderColor', 'borderWidth', 'borderRadius', 'fontSize', 'fontWeight',
    'padding', 'margin', 'width', 'height', 'scale'
  ]);
  
  for (const stateStyleObj of Object.values(stateStyles)) {
    for (const property of Object.keys(stateStyleObj)) {
      if (!simpleProperties.has(property)) {
        return false;
      }
    }
  }
  
  return true;
};