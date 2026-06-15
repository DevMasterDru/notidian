/**
 * @jest-environment jsdom
 */
// Offline (jsdom) regression coverage for Notidian-nu9w (batch 3):
//   "Anchor menus to e.currentTarget, not e.target."
//
// WHY THIS TEST EXISTS
// --------------------
// ColorSetter binds its onClick to the `.mk-editor-frame-color` swatch and opens
// the color picker anchored at that control's rect. Before the fix, showColorMenu
// computed the rect from `(e.target as HTMLElement).getBoundingClientRect()`.
// e.target is whatever element the pointer landed on; when a click lands on a
// nested child it is NOT the bound swatch, so the popup anchors to the wrong rect.
// The fix anchors to `e.currentTarget` — the swatch the handler is bound to.
//
// jsdom does not lay out, so we stub DISTINCT rects on the swatch vs. an inner
// child, dispatch a real bubbling click whose `target` is the inner child, and
// assert the rect handed to showColorPickerMenu is the SWATCH's rect. We mock the
// colorPickerMenu module so the test records the rect without mounting the full
// picker UI — the rect computation is the only thing this fix changed.
import React from "react";
import { act } from "react-dom/test-utils";
import { createRoot, Root } from "react-dom/client";

// makemd-core is a heavy barrel; ColorSetter pulls in only the Superstate TYPE
// transitively (erased at runtime), so an empty stub is faithful.
jest.mock("makemd-core", () => ({}));

// Capture the rect that ColorSetter hands the color picker, without mounting the
// picker. showColorPickerMenu(superstate, rect, win, value, setValue).
const colorPickerCalls: { rect: { x: number; y: number } }[] = [];
jest.mock(
  "core/react/components/UI/Menus/properties/colorPickerMenu",
  () => ({
    showColorPickerMenu: (_superstate: any, rect: any) => {
      colorPickerCalls.push({ rect: { x: rect.x, y: rect.y } });
      return { hide: () => {} };
    },
  })
);

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { ColorSetter } = require("./ColorSetter");

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

type XYWH = { x: number; y: number; width: number; height: number };
const SWATCH_RECT: XYWH = { x: 100, y: 200, width: 30, height: 30 };
const CHILD_RECT: XYWH = { x: 555, y: 777, width: 8, height: 8 };

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

const makeSuperstate = (): any => ({
  ui: { getSticker: () => "" },
});

describe("ColorSetter menu anchoring (Notidian-nu9w)", () => {
  let root: Root;
  let container: HTMLElement;

  beforeEach(() => {
    colorPickerCalls.length = 0;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
      root.render(
        <ColorSetter
          superstate={makeSuperstate()}
          value="#ff0000"
          setValue={() => {}}
        />
      );
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("anchors the color picker to the bound swatch, not the clicked child", () => {
    const swatch = container.querySelector(
      ".mk-editor-frame-color"
    ) as HTMLElement;
    expect(swatch).toBeTruthy();
    // Inject a child so a click can land on something other than the swatch
    // itself, reproducing the e.target-vs-currentTarget divergence.
    const child = document.createElement("span");
    swatch.appendChild(child);

    stubRect(swatch, SWATCH_RECT);
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

    expect(colorPickerCalls.length).toBeGreaterThan(0);
    const anchor = colorPickerCalls[colorPickerCalls.length - 1].rect;
    expect(anchor.x).toBe(SWATCH_RECT.x);
    expect(anchor.y).toBe(SWATCH_RECT.y);
    // Guard: reverting to e.target would anchor on the clicked child instead.
    expect(anchor.x).not.toBe(CHILD_RECT.x);
    expect(anchor.y).not.toBe(CHILD_RECT.y);
  });
});
