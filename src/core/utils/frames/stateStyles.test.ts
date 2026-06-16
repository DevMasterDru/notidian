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
// Two current behaviors are deliberately PINNED here (not asserted "correct"),
// and are flagged as follow-up beads rather than fixed in this test bead:
//   (B1) generateStatefulCSS only emits pseudo-selector rules for FOUR of the
//        eight states (hover/focus/active/disabled). press / selected / loading
//        / error carry no pseudoSelectorMap entry and are SILENTLY DROPPED from
//        the emitted CSS. (Harmless today — no live consumer — but a latent
//        surprise if generateStatefulCSS is ever wired up.)
//   (B2) generateStatefulCSS interpolates `className` into the selector with NO
//        escaping, so an adversarial className injects raw text into the CSS.
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

  it("emits nothing for a base-less, state-only object whose states are all unsupported by the pseudo map", () => {
    // press/selected/loading/error are NOT in pseudoSelectorMap -> dropped.
    const css = generateStatefulCSS(
      { "press:transform": "scale(0.95)", "selected:color": "gold" },
      "frame-1"
    );
    expect(css).toBe("");
  });

  it("CHARACTERIZATION (B1): SILENTLY DROPS states with no pseudoSelectorMap entry while emitting the supported ones", () => {
    const css = generateStatefulCSS(
      {
        "hover:color": "blue", // supported -> emitted
        "press:transform": "scale(0.95)", // dropped
        "selected:color": "gold", // dropped
        "loading:opacity": "0.5", // dropped
        "error:color": "red", // dropped
        "disabled:opacity": "0.4", // supported -> emitted
      },
      "frame-1"
    );
    // Only hover + disabled survive.
    expect(css).toContain(".frame-1:hover { color: blue; }");
    expect(css).toContain(".frame-1:disabled { opacity: 0.4; }");
    expect(css).not.toContain("scale(0.95)");
    expect(css).not.toContain("gold");
    expect(css).not.toContain("0.5");
    expect(css).not.toMatch(/:error|:press|:selected|:loading/);
  });

  it("CHARACTERIZATION (B2): interpolates an adversarial className into the selector WITHOUT escaping", () => {
    // No CSS escaping today -> the raw className lands verbatim in the selector.
    const css = generateStatefulCSS(
      { "hover:color": "blue" },
      "frame-1 .evil { } .injected"
    );
    expect(css).toContain(".frame-1 .evil { } .injected:hover { color: blue; }");
  });

  it("skips a state bucket that has no properties (guarded by length > 0)", () => {
    // parseStateStyles never produces an empty bucket for valid input, but a
    // bucket with only-dropped (unsupported) states yields no output, and the
    // base block is the only thing emitted.
    const css = generateStatefulCSS({ color: "black", "press:x": "y" }, "frame-1");
    expect(css).toBe(".frame-1 { color: black; }\n");
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
