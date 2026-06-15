/**
 * @jest-environment jsdom
 */
// Offline (jsdom) regression coverage for Notidian-74n (batch 1):
//   "Anchor menus to e.currentTarget, not e.target."
//
// WHY THIS TEST EXISTS
// --------------------
// showDisclosureMenu(ui, e, ...) is a shared opener used by disclosure-style
// menu controls. Before the fix it computed its anchor rect from
// `(e.target as HTMLElement).getBoundingClientRect()`, so a click landing on an
// inner SVG glyph (icon controls render their icon via dangerouslySetInnerHTML
// SVG) anchored the popup to the child's rect instead of the bound control. The
// fix reads `e.currentTarget`, the element the handler is bound to.
//
// We mount a tiny host whose onClick forwards the synthetic event to
// showDisclosureMenu, with a real SVG child inside the bound control. We stub
// distinct rects on the control vs. the child, dispatch a bubbling click on the
// child, and assert the rect handed to ui.openMenu is the CONTROL's rect.
import React from "react";
import { act } from "react-dom/test-utils";
import { createRoot, Root } from "react-dom/client";

// makemd-core is a heavy barrel. SelectionMenu's only runtime symbol from it is
// the SelectOptionType enum; re-export the REAL enum from its source of truth.
jest.mock("makemd-core", () => ({
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  SelectOptionType: require("shared/types/menu").SelectOptionType,
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { showDisclosureMenu } = require("./SelectionMenu");

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

type XYWH = { x: number; y: number; width: number; height: number };
const CONTROL_RECT: XYWH = { x: 100, y: 200, width: 30, height: 30 };
const SVG_CHILD_RECT: XYWH = { x: 555, y: 777, width: 12, height: 12 };

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

type OpenMenuCall = { rect: { x: number; y: number } };

const makeUi = (calls: OpenMenuCall[]): any => ({
  openMenu: (rect: any) => {
    calls.push({ rect: { x: rect.x, y: rect.y } });
    return { update: () => {}, hide: () => {} };
  },
});

describe("showDisclosureMenu anchoring (Notidian-74n)", () => {
  let calls: OpenMenuCall[];
  let ui: any;
  let root: Root;
  let container: HTMLElement;

  beforeEach(() => {
    calls = [];
    ui = makeUi(calls);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
      root.render(
        <div
          className="host-control"
          onClick={(e) =>
            showDisclosureMenu(
              ui,
              e,
              false,
              false,
              "",
              [{ name: "Alpha", value: "a" }],
              () => {}
            )
          }
        >
          <span
            className="host-glyph"
            dangerouslySetInnerHTML={{
              __html: "<svg><path d='M0 0h1v1H0z'></path></svg>",
            }}
          />
        </div>
      );
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("anchors the disclosure menu to the bound control, not the clicked SVG child", () => {
    const control = container.querySelector(".host-control") as HTMLElement;
    expect(control).toBeTruthy();
    const svgChild =
      control.querySelector("path") ?? control.querySelector("svg");
    expect(svgChild).toBeTruthy();

    stubRect(control, CONTROL_RECT);
    stubRect(svgChild as Element, SVG_CHILD_RECT);

    act(() => {
      svgChild!.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true, view: window })
      );
    });

    expect(calls.length).toBeGreaterThan(0);
    const anchor = calls[calls.length - 1].rect;
    expect(anchor.x).toBe(CONTROL_RECT.x);
    expect(anchor.y).toBe(CONTROL_RECT.y);
    expect(anchor.x).not.toBe(SVG_CHILD_RECT.x);
    expect(anchor.y).not.toBe(SVG_CHILD_RECT.y);
  });
});
