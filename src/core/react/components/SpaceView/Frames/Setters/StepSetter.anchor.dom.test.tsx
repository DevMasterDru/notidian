/**
 * @jest-environment jsdom
 */
// Offline (jsdom) regression coverage for Notidian-nu9w (batch 3):
//   "Anchor menus to e.currentTarget, not e.target."
//
// WHY THIS TEST EXISTS
// --------------------
// StepSetter renders a unit `<span>` whose onClick opens the unit-selection menu
// via superstate.ui.openMenu, anchored at the span's rect. Before the fix,
// showUnitMenu computed the rect from `(e.target as HTMLElement)`. e.target is
// whatever element the pointer landed on; a click on a nested child anchors the
// popup to the wrong rect. The fix anchors to `e.currentTarget` — the span the
// handler is bound to.
//
// jsdom does not lay out, so we stub DISTINCT rects on the unit span vs. an inner
// child, dispatch a real bubbling click whose `target` is the child, and assert
// the rect handed to ui.openMenu is the SPAN's rect. defaultMenu (SelectionMenu)
// is stubbed so the test exercises only the rect computation the fix changed.
import React from "react";
import { act } from "react-dom/test-utils";
import { createRoot, Root } from "react-dom/client";

// makemd-core is a heavy barrel; StepSetter pulls in only the Superstate/
// SelectOption TYPES transitively (erased at runtime), so an empty stub is faithful.
jest.mock("makemd-core", () => ({}));

// defaultMenu only shapes the menu props object; the rect (first openMenu arg) is
// the only thing this fix touches, so a passthrough stub keeps the test focused.
jest.mock("core/react/components/UI/Menus/menu/SelectionMenu", () => ({
  defaultMenu: (_ui: any, options: any) => ({ options }),
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { StepSetter } = require("./StepSetter");

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

type XYWH = { x: number; y: number; width: number; height: number };
const SPAN_RECT: XYWH = { x: 140, y: 260, width: 24, height: 16 };
const CHILD_RECT: XYWH = { x: 666, y: 888, width: 6, height: 6 };

const stubRect = (el: Element, rect: XYWH) => {
  (el as any).getBoundingClientRect = () => ({
    ...rect,
    top: rect.y,
    left: rect.x,
    right: rect.x + rect.width,
    bottom: rect.y + rect.height,
    toJSON: () => rect,
  });
};

const openMenuCalls: { rect: { x: number; y: number } }[] = [];
const makeSuperstate = (): any => ({
  ui: {
    getSticker: () => "",
    openMenu: (rect: any) => {
      openMenuCalls.push({ rect: { x: rect.x, y: rect.y } });
    },
  },
});

describe("StepSetter unit menu anchoring (Notidian-nu9w)", () => {
  let root: Root;
  let container: HTMLElement;

  beforeEach(() => {
    openMenuCalls.length = 0;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
      root.render(
        <StepSetter
          superstate={makeSuperstate()}
          name="Gap"
          value="'10px'"
          units={["px", "%"]}
          setValue={() => {}}
        />
      );
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("anchors the unit menu to the bound span, not the clicked child", () => {
    // The unit span is the last child of the setter row; it renders the unit text.
    const spans = Array.from(
      container.querySelectorAll("span")
    ) as HTMLElement[];
    const unitSpan = spans.find((s) => s.textContent === "px") as HTMLElement;
    expect(unitSpan).toBeTruthy();

    // Inject a child so a click can land on something other than the span itself,
    // reproducing the e.target-vs-currentTarget divergence.
    const child = document.createElement("i");
    unitSpan.appendChild(child);

    stubRect(unitSpan, SPAN_RECT);
    stubRect(child, CHILD_RECT);

    act(() => {
      child.dispatchEvent(
        new MouseEvent("click", {
          bubbles: true,
          cancelable: true,
          view: window,
        })
      );
    });

    expect(openMenuCalls.length).toBeGreaterThan(0);
    const anchor = openMenuCalls[openMenuCalls.length - 1].rect;
    expect(anchor.x).toBe(SPAN_RECT.x);
    expect(anchor.y).toBe(SPAN_RECT.y);
    // Guard: reverting to e.target would anchor on the clicked child instead.
    expect(anchor.x).not.toBe(CHILD_RECT.x);
    expect(anchor.y).not.toBe(CHILD_RECT.y);
  });
});
