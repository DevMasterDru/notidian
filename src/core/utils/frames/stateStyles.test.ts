// ===========================================================================
// DEPTH (Long Autonomous Mode, Notidian-ktmr) — pinned characterization net
// for the PURE frame interaction-state styling helpers in
// src/core/utils/frames/stateStyles.ts.
//
// WHAT THEY ARE. Seven exported, fully-offline helpers (zero Superstate /
// Obsidian / React coupling) that drive how a frame node re-styles itself for
// interaction states (hover / press / focus / active / disabled / selected /
// loading / error). They split into two families:
//
//   RESOLUTION PATH (the LIVE render path — FrameView / FrameEditorNodeView):
//     - STATE_PREFIX_REGEX   regex that recognizes a "state:prop" style key
//     - parseStateStyles     FrameTreeProp -> { baseStyles, stateStyles{} }
//     - parseStylesForState  base styles + the currently-active InteractionState,
//                            merged (state wins) into a flat style object
//     - hasStatePrefixes     does any key carry a state prefix?
//     - extractStateTypes    the unique set of state types present
//
//   CSS-EMIT PATH (export-only today; not yet wired to a consumer):
//     - generateStatefulCSS  emits a CSS string (base rule + pseudo-selector
//                            rules) — render-path-shaped: a malformed or
//                            mis-scoped selector would silently break appearance
//     - isSimpleStateStyles  are all state props "simple" enough for CSS-only?
//
// WHY IT MATTERS. parseStylesForState is the function the frame runtime calls on
// every interaction-state change, so its base-vs-state partition, priority
// order, and "empty styles pass through unchanged" contract decide whether a
// frame restyles correctly on hover/press/etc. The regex is the gate for the
// whole feature: it must match ONLY the eight documented prefixes and capture
// the trailing property, never leaking an unknown/bare/empty key into a state
// bucket.
//
// CHARACTERIZATION POSTURE. These tests assert CURRENT behavior, not aspiration.
//   (B1) FIXED (Notidian-dczm): generateStatefulCSS now emits a rule block for
//        ALL EIGHT documented states. hover/focus/active/disabled emit real
//        pseudo-class selectors (`.cls:state`); the four non-pseudo states
//        press/selected/loading/error — which are NOT real CSS pseudo-classes —
//        emit deterministic `[data-state~="state"]` attribute selectors. None
//        are silently dropped anymore. The tests below assert the new behavior.
//   (B2) FIXED (Notidian-myrt): generateStatefulCSS now runs `className` through
//        escapeClassName (CSS.escape when a DOM exposes it, else a spec-aligned
//        manual fallback for the node/jsdom test env) ONCE before interpolating
//        it into every emitted selector — the base `.cls` rule AND every
//        pseudo / `[data-state~]` rule. An adversarial className can no longer
//        break out of its selector to inject extra CSS rules; a normal
//        kebab-case className round-trips untouched. The tests below assert the
//        escaped/sanitized behavior.
// ===========================================================================

import { FrameTreeProp } from "shared/types/mframe";
import {
  STATE_PREFIX_REGEX,
  parseStateStyles,
  parseStylesForState,
  hasStatePrefixes,
  extractStateTypes,
  generateStatefulCSS,
  isSimpleStateStyles,
  InteractionState,
} from "./stateStyles";

const DOCUMENTED_STATES = [
  "hover",
  "press",
  "focus",
  "active",
  "disabled",
  "selected",
  "loading",
  "error",
] as const;

describe("STATE_PREFIX_REGEX", () => {
  it.each(DOCUMENTED_STATES)(
    "matches the documented prefix '%s' and captures the trailing property",
    (state) => {
      const match = `${state}:backgroundColor`.match(STATE_PREFIX_REGEX);
      expect(match).not.toBeNull();
      expect(match![1]).toBe(state);
      expect(match![2]).toBe("backgroundColor");
    }
  );

  it("captures everything after the FIRST colon (greedy .+), so prop may itself contain a colon", () => {
    const match = "hover:background:url".match(STATE_PREFIX_REGEX);
    expect(match).not.toBeNull();
    expect(match![1]).toBe("hover");
    // .+ is greedy and unanchored on the inner group -> the whole remainder.
    expect(match![2]).toBe("background:url");
  });

  it("rejects an unknown/undocumented state prefix", () => {
    expect("checked:backgroundColor".match(STATE_PREFIX_REGEX)).toBeNull();
    expect("visited:color".match(STATE_PREFIX_REGEX)).toBeNull();
  });

  it("rejects a bare property with no state prefix", () => {
    expect("backgroundColor".match(STATE_PREFIX_REGEX)).toBeNull();
  });

  it("rejects a state prefix with an empty property (.+ requires >= 1 char)", () => {
    expect("hover:".match(STATE_PREFIX_REGEX)).toBeNull();
  });

  it("rejects the empty string", () => {
    expect("".match(STATE_PREFIX_REGEX)).toBeNull();
  });

  it("is case-sensitive: a differently-cased prefix does not match", () => {
    expect("Hover:color".match(STATE_PREFIX_REGEX)).toBeNull();
    expect("HOVER:color".match(STATE_PREFIX_REGEX)).toBeNull();
  });

  it("is anchored at the start: a documented prefix embedded mid-key does not match", () => {
    expect("xhover:color".match(STATE_PREFIX_REGEX)).toBeNull();
    expect("data-hover:color".match(STATE_PREFIX_REGEX)).toBeNull();
  });
});

describe("parseStateStyles", () => {
  it("partitions plain (non-prefixed) keys into baseStyles and leaves stateStyles empty", () => {
    const styles: FrameTreeProp = { color: "red", padding: "4px" };
    const { baseStyles, stateStyles } = parseStateStyles(styles);
    expect(baseStyles).toEqual({ color: "red", padding: "4px" });
    expect(stateStyles).toEqual({});
  });

  it("routes a state-prefixed key into its state bucket under the unprefixed property name", () => {
    const styles: FrameTreeProp = { "hover:backgroundColor": "blue" };
    const { baseStyles, stateStyles } = parseStateStyles(styles);
    expect(baseStyles).toEqual({});
    expect(stateStyles).toEqual({ hover: { backgroundColor: "blue" } });
  });

  it("partitions a mixed object into base + per-state buckets", () => {
    const styles: FrameTreeProp = {
      color: "black",
      "hover:color": "blue",
      "hover:opacity": "0.8",
      "disabled:opacity": "0.4",
    };
    const { baseStyles, stateStyles } = parseStateStyles(styles);
    expect(baseStyles).toEqual({ color: "black" });
    expect(stateStyles).toEqual({
      hover: { color: "blue", opacity: "0.8" },
      disabled: { opacity: "0.4" },
    });
  });

  it("places the SAME property appearing under multiple states into each respective bucket", () => {
    const styles: FrameTreeProp = {
      "hover:backgroundColor": "blue",
      "focus:backgroundColor": "green",
      "active:backgroundColor": "purple",
    };
    const { baseStyles, stateStyles } = parseStateStyles(styles);
    expect(baseStyles).toEqual({});
    expect(stateStyles.hover).toEqual({ backgroundColor: "blue" });
    expect(stateStyles.focus).toEqual({ backgroundColor: "green" });
    expect(stateStyles.active).toEqual({ backgroundColor: "purple" });
  });

  it("treats an unknown-prefixed key as a BASE style (it does not match the regex)", () => {
    const styles: FrameTreeProp = { "checked:color": "red" };
    const { baseStyles, stateStyles } = parseStateStyles(styles);
    expect(baseStyles).toEqual({ "checked:color": "red" });
    expect(stateStyles).toEqual({});
  });

  it("returns the SAME cached object reference for a repeated call with the same styles reference (WeakMap cache)", () => {
    const styles: FrameTreeProp = { "hover:color": "blue" };
    const first = parseStateStyles(styles);
    const second = parseStateStyles(styles);
    expect(second).toBe(first);
  });

  it("does not share the cache across distinct object references with equal content", () => {
    const a: FrameTreeProp = { "hover:color": "blue" };
    const b: FrameTreeProp = { "hover:color": "blue" };
    expect(parseStateStyles(b)).not.toBe(parseStateStyles(a));
  });
});

describe("parseStylesForState", () => {
  const noState: InteractionState = {};

  it("returns the input unchanged (same reference) when styles is empty", () => {
    const empty: FrameTreeProp = {};
    expect(parseStylesForState(empty, { hover: true })).toBe(empty);
  });

  it("returns the input unchanged (same reference) when styles is falsy", () => {
    // The function guards on `!styles`; characterize that pass-through.
    const nullish = null as unknown as FrameTreeProp;
    expect(parseStylesForState(nullish, { hover: true })).toBe(nullish);
  });

  it("returns just the base styles (in a NEW object) when no state is active", () => {
    const styles: FrameTreeProp = { color: "black", "hover:color": "blue" };
    const resolved = parseStylesForState(styles, noState);
    expect(resolved).toEqual({ color: "black" });
    expect(resolved).not.toBe(styles);
  });

  it("merges an active state over the base, with the active state winning on shared props", () => {
    const styles: FrameTreeProp = {
      color: "black",
      padding: "4px",
      "hover:color": "blue",
    };
    const resolved = parseStylesForState(styles, { hover: true });
    expect(resolved).toEqual({ color: "blue", padding: "4px" });
  });

  it("does not apply a state's styles when that state is not active", () => {
    const styles: FrameTreeProp = { color: "black", "hover:color": "blue" };
    const resolved = parseStylesForState(styles, { focus: true });
    // focus has no overrides here, so only base survives.
    expect(resolved).toEqual({ color: "black" });
  });

  it("applies styles for a state that IS in the priority list (e.g. selected)", () => {
    const styles: FrameTreeProp = {
      color: "black",
      "selected:color": "gold",
    };
    expect(parseStylesForState(styles, { selected: true })).toEqual({
      color: "gold",
    });
  });

  it("resolves multi-active states by the documented statePriority order — 'active' (last) wins over 'hover'", () => {
    const styles: FrameTreeProp = {
      "hover:color": "blue",
      "active:color": "red",
    };
    // statePriority = [disabled, loading, error, selected, focus, hover, press, active]
    // Both applied in order; later (active) overwrites earlier (hover).
    const resolved = parseStylesForState(styles, { hover: true, active: true });
    expect(resolved).toEqual({ color: "red" });
  });

  it("resolves 'disabled' (earliest in priority) being overwritten by a later active state (hover)", () => {
    const styles: FrameTreeProp = {
      "disabled:color": "grey",
      "hover:color": "blue",
    };
    // disabled is applied first, hover later -> hover wins.
    const resolved = parseStylesForState(styles, { disabled: true, hover: true });
    expect(resolved).toEqual({ color: "blue" });
  });

  it("non-overlapping active states are unioned (no shared prop, both contribute)", () => {
    const styles: FrameTreeProp = {
      "hover:color": "blue",
      "focus:outline": "1px",
    };
    const resolved = parseStylesForState(styles, { hover: true, focus: true });
    expect(resolved).toEqual({ color: "blue", outline: "1px" });
  });

  it("ignores an unknown-prefixed key (kept as a literal base property)", () => {
    const styles: FrameTreeProp = { "checked:color": "red", color: "black" };
    const resolved = parseStylesForState(styles, { hover: true });
    expect(resolved).toEqual({ "checked:color": "red", color: "black" });
  });
});

describe("hasStatePrefixes", () => {
  it("returns true when at least one key carries a documented state prefix", () => {
    expect(hasStatePrefixes({ color: "black", "hover:color": "blue" })).toBe(true);
  });

  it("returns false when no key carries a state prefix", () => {
    expect(hasStatePrefixes({ color: "black", padding: "4px" })).toBe(false);
  });

  it("returns false for an unknown prefix", () => {
    expect(hasStatePrefixes({ "checked:color": "red" })).toBe(false);
  });

  it("returns false for an empty styles object", () => {
    expect(hasStatePrefixes({})).toBe(false);
  });

  it("returns false for a falsy styles argument", () => {
    expect(hasStatePrefixes(null as unknown as FrameTreeProp)).toBe(false);
  });
});

describe("extractStateTypes", () => {
  it("returns the unique set of state types present", () => {
    const styles: FrameTreeProp = {
      "hover:color": "blue",
      "hover:opacity": "0.8",
      "focus:outline": "1px",
    };
    const types = extractStateTypes(styles);
    expect(types).toEqual(["hover", "focus"]);
  });

  it("deduplicates a state type that appears across multiple properties", () => {
    const styles: FrameTreeProp = {
      "hover:color": "blue",
      "hover:opacity": "0.8",
      "hover:transform": "scale(1.1)",
    };
    expect(extractStateTypes(styles)).toEqual(["hover"]);
  });

  it("preserves first-seen insertion order of state types", () => {
    const styles: FrameTreeProp = {
      "focus:outline": "1px",
      "hover:color": "blue",
      "active:color": "red",
    };
    expect(extractStateTypes(styles)).toEqual(["focus", "hover", "active"]);
  });

  it("returns an empty array when there are no state prefixes", () => {
    expect(extractStateTypes({ color: "black" })).toEqual([]);
  });

  it("ignores unknown prefixes", () => {
    expect(extractStateTypes({ "checked:color": "red", "hover:color": "blue" })).toEqual([
      "hover",
    ]);
  });

  it("returns an empty array for a falsy styles argument", () => {
    expect(extractStateTypes(null as unknown as FrameTreeProp)).toEqual([]);
  });
});

describe("generateStatefulCSS", () => {
  it("emits a base rule block scoped to the className when base styles exist", () => {
    const css = generateStatefulCSS({ color: "black" }, "frame-1");
    expect(css).toBe(".frame-1 { color: black; }\n");
  });

  it("converts camelCase properties to kebab-case in the emitted CSS", () => {
    const css = generateStatefulCSS({ backgroundColor: "blue" }, "frame-1");
    expect(css).toContain("background-color: blue;");
  });

  it("emits one pseudo-selector block per supported state, scoped to the className", () => {
    const css = generateStatefulCSS(
      {
        color: "black",
        "hover:backgroundColor": "blue",
        "focus:outline": "1px",
      },
      "frame-1"
    );
    expect(css).toContain(".frame-1 { color: black; }");
    expect(css).toContain(".frame-1:hover { background-color: blue; }");
    expect(css).toContain(".frame-1:focus { outline: 1px; }");
  });

  it("uses the documented pseudo-selector suffix (':state'), NOT a '-state' class suffix", () => {
    const css = generateStatefulCSS({ "hover:color": "blue" }, "frame-1");
    expect(css).toContain(".frame-1:hover {");
    expect(css).not.toContain(".frame-1-hover");
  });

  it("does not leak one state's properties into another state's rule block", () => {
    const css = generateStatefulCSS(
      { "hover:color": "blue", "focus:color": "green" },
      "frame-1"
    );
    const hoverBlock = css
      .split("\n")
      .find((line) => line.includes(":hover"))!;
    const focusBlock = css
      .split("\n")
      .find((line) => line.includes(":focus"))!;
    expect(hoverBlock).toContain("color: blue;");
    expect(hoverBlock).not.toContain("green");
    expect(focusBlock).toContain("color: green;");
    expect(focusBlock).not.toContain("blue");
  });

  it("returns an empty string for an empty styles object (no-op)", () => {
    expect(generateStatefulCSS({}, "frame-1")).toBe("");
  });

  it("emits data-state rule blocks (no base block) for a base-less object of non-pseudo states", () => {
    // press/selected are non-pseudo -> emitted as [data-state~] selectors;
    // with no base styles there is no base block.
    const css = generateStatefulCSS(
      { "press:transform": "scale(0.95)", "selected:color": "gold" },
      "frame-1"
    );
    expect(css).not.toContain(".frame-1 {");
    expect(css).toContain(
      '.frame-1[data-state~="press"] { transform: scale(0.95); }'
    );
    expect(css).toContain('.frame-1[data-state~="selected"] { color: gold; }');
  });

  it("ignores unknown state prefixes (not one of the eight) — no state rule block is produced", () => {
    // STATE_PREFIX_REGEX only recognizes the eight documented prefixes, so an
    // unknown prefix like 'wobble:' is NOT split into a state bucket and never
    // produces a `:wobble` pseudo or `[data-state~="wobble"]` attribute rule.
    const css = generateStatefulCSS({ "wobble:color": "red" }, "frame-1");
    expect(css).not.toMatch(/:wobble/);
    expect(css).not.toContain('[data-state~="wobble"]');
  });

  it("B1 (Notidian-dczm): emits real pseudo-classes for hover/focus/active/disabled and [data-state~] for press/selected/loading/error — none dropped", () => {
    const css = generateStatefulCSS(
      {
        "hover:color": "blue", // pseudo -> :hover
        "press:transform": "scale(0.95)", // non-pseudo -> [data-state~="press"]
        "selected:color": "gold", // non-pseudo -> [data-state~="selected"]
        "loading:opacity": "0.5", // non-pseudo -> [data-state~="loading"]
        "error:color": "red", // non-pseudo -> [data-state~="error"]
        "disabled:opacity": "0.4", // pseudo -> :disabled
      },
      "frame-1"
    );
    // The two real pseudo-classes emit as `:state` selectors.
    expect(css).toContain(".frame-1:hover { color: blue; }");
    expect(css).toContain(".frame-1:disabled { opacity: 0.4; }");
    // The four non-pseudo states now ALSO emit, via deterministic
    // `[data-state~="state"]` attribute selectors — no longer dropped.
    expect(css).toContain(
      '.frame-1[data-state~="press"] { transform: scale(0.95); }'
    );
    expect(css).toContain(
      '.frame-1[data-state~="selected"] { color: gold; }'
    );
    expect(css).toContain(
      '.frame-1[data-state~="loading"] { opacity: 0.5; }'
    );
    expect(css).toContain('.frame-1[data-state~="error"] { color: red; }');
  });

  it("emits each non-pseudo state as a data-state attribute selector, NOT a bogus ':state' pseudo-class", () => {
    const css = generateStatefulCSS(
      { "loading:opacity": "0.5", "error:color": "red" },
      "frame-1"
    );
    // These are not real pseudo-classes, so they must NOT appear as `:loading`
    // / `:error`, which no browser would match.
    expect(css).not.toMatch(/:loading|:error/);
    expect(css).toContain('[data-state~="loading"]');
    expect(css).toContain('[data-state~="error"]');
  });

  it("does not leak a non-pseudo state's properties into another state's rule block", () => {
    const css = generateStatefulCSS(
      { "loading:color": "blue", "error:color": "green" },
      "frame-1"
    );
    const loadingBlock = css
      .split("\n")
      .find((line) => line.includes('[data-state~="loading"]'))!;
    const errorBlock = css
      .split("\n")
      .find((line) => line.includes('[data-state~="error"]'))!;
    expect(loadingBlock).toContain("color: blue;");
    expect(loadingBlock).not.toContain("green");
    expect(errorBlock).toContain("color: green;");
    expect(errorBlock).not.toContain("blue");
  });

  it("B2 (Notidian-myrt): escapes an adversarial className so it CANNOT inject extra CSS rules", () => {
    // FIXED: className is now run through escapeClassName before interpolation,
    // so CSS metacharacters (space, '.', '{', '}') are backslash-escaped and the
    // whole value stays a single class selector — no break-out into a `.evil`
    // rule or a dangling `.injected` rule.
    const css = generateStatefulCSS(
      { "hover:color": "blue" },
      "frame-1 .evil { } .injected"
    );
    // The raw, unescaped injection string must NOT appear verbatim.
    expect(css).not.toContain(".frame-1 .evil { } .injected:hover");
    // The metacharacters are escaped (no UNescaped space/brace survives inside
    // the selector portion that precedes the `:hover`).
    expect(css).toContain("\\ "); // spaces are backslash-escaped
    expect(css).toContain("\\{"); // '{' is backslash-escaped
    expect(css).toContain("\\}"); // '}' is backslash-escaped
    expect(css).toContain("\\."); // '.' is backslash-escaped
    // The only unescaped braces/colon are the rule's own delimiters: exactly one
    // opening and one closing brace for the single emitted :hover rule.
    const unescapedOpen = (css.match(/(?<!\\)\{/g) || []).length;
    const unescapedClose = (css.match(/(?<!\\)\}/g) || []).length;
    expect(unescapedOpen).toBe(1);
    expect(unescapedClose).toBe(1);
    // The declaration still lands correctly for the (escaped) class on :hover.
    expect(css).toContain(":hover { color: blue; }");
  });

  it("B2 (Notidian-myrt): escapes className in the BASE rule and EVERY state rule (pseudo + data-state)", () => {
    // Escaping happens once at the source, so it must cover the base `.cls` rule,
    // the pseudo-class rule, AND the [data-state~] attribute rule alike.
    const css = generateStatefulCSS(
      {
        color: "black", // base rule
        "hover:color": "blue", // pseudo selector
        "selected:color": "gold", // [data-state~] selector
      },
      "a{}b"
    );
    // Adversarial braces never survive UNescaped in any selector. The only
    // unescaped braces are the three rules' own delimiters (base + hover +
    // selected = 3 open / 3 close).
    expect((css.match(/(?<!\\)\{/g) || []).length).toBe(3);
    expect((css.match(/(?<!\\)\}/g) || []).length).toBe(3);
    // Each rule still emits with the escaped class and correct declaration.
    expect(css).toContain("a\\{\\}b { color: black; }");
    expect(css).toContain("a\\{\\}b:hover { color: blue; }");
    expect(css).toContain('a\\{\\}b[data-state~="selected"] { color: gold; }');
  });

  it("B2 (Notidian-myrt): leaves a normal kebab-case className untouched (no spurious escaping)", () => {
    // The common, valid case must round-trip byte-for-byte — escaping only the
    // dangerous characters, never the safe `[A-Za-z0-9_-]` identifier set.
    const css = generateStatefulCSS(
      { color: "black", "hover:color": "blue" },
      "frame-node_1-abc"
    );
    expect(css).toContain(".frame-node_1-abc { color: black; }");
    expect(css).toContain(".frame-node_1-abc:hover { color: blue; }");
    expect(css).not.toContain("\\");
  });

  it("B2 (Notidian-myrt): hex-escapes a leading digit so the class cannot be read as a number", () => {
    // A leading digit is a positional hazard the serialize-identifier algorithm
    // hex-escapes; the rest passes through.
    const css = generateStatefulCSS({ color: "black" }, "1frame");
    expect(css).toContain(".\\31 frame { color: black; }");
  });

  it("emits the base block plus a data-state block for a base + non-pseudo state object", () => {
    // The base block and the press (non-pseudo) state block both emit; the
    // length>0 guard only skips genuinely-empty buckets, which valid input
    // never produces.
    const css = generateStatefulCSS({ color: "black", "press:x": "y" }, "frame-1");
    expect(css).toContain(".frame-1 { color: black; }\n");
    expect(css).toContain('.frame-1[data-state~="press"] { x: y; }');
  });
});

describe("isSimpleStateStyles", () => {
  it("returns true when every property across every state is in the simple set", () => {
    expect(
      isSimpleStateStyles({
        hover: { backgroundColor: "blue", opacity: "0.8" },
        active: { transform: "scale(0.95)" },
      })
    ).toBe(true);
  });

  it("returns false when ANY state contains a non-simple property", () => {
    expect(
      isSimpleStateStyles({
        hover: { backgroundColor: "blue", outline: "1px" }, // outline not simple
      })
    ).toBe(false);
  });

  it("returns true (vacuously) for an empty state-styles map", () => {
    expect(isSimpleStateStyles({})).toBe(true);
  });

  it("returns true (vacuously) for a state with no properties", () => {
    expect(isSimpleStateStyles({ hover: {} })).toBe(true);
  });

  it("boundary: a single non-simple property among many simple ones flips the result to false", () => {
    expect(
      isSimpleStateStyles({
        hover: {
          backgroundColor: "blue",
          color: "white",
          opacity: "0.9",
          transform: "scale(1.1)",
          gap: "4px", // gap is NOT in the simple set
        },
      })
    ).toBe(false);
  });

  it("boundary: each documented simple property is individually accepted", () => {
    const simple = [
      "backgroundColor",
      "color",
      "opacity",
      "transform",
      "boxShadow",
      "borderColor",
      "borderWidth",
      "borderRadius",
      "fontSize",
      "fontWeight",
      "padding",
      "margin",
      "width",
      "height",
      "scale",
    ];
    for (const prop of simple) {
      expect(isSimpleStateStyles({ hover: { [prop]: "x" } })).toBe(true);
    }
  });
});
