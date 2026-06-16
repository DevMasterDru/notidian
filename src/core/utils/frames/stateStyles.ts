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
 * Build the CSS selector that targets `className` for a given interaction
 * state. Real pseudo-classes use a `:state` suffix; the four non-pseudo states
 * use a deterministic `[data-state~="state"]` attribute selector. Returns null
 * for any state that is neither (so unknown states are skipped, not emitted as
 * malformed CSS).
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

  let css = '';

  // Base styles
  if (Object.keys(baseStyles).length > 0) {
    css += `.${className} { ${convertToCSS(baseStyles)} }\n`;
  }

  // State-specific CSS: real pseudo-classes get a ':state' selector, the four
  // non-pseudo states get a deterministic '[data-state~="state"]' selector.
  for (const [stateType, stateStyleObj] of Object.entries(stateStyles)) {
    const selector = selectorForState(className, stateType);
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