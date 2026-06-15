/**
 * @jest-environment jsdom
 */
// Offline (jsdom) regression coverage for Notidian-74n (batch 1):
//   "Anchor menus to e.currentTarget, not e.target."
//
// WHY THIS TEST EXISTS
// --------------------
// Dropdown renders a collapse glyph via `dangerouslySetInnerHTML` SVG inside the
// clickable `.mk-cell-option-item` row. Before the fix, openMenu computed its
// anchor rect from `(e.target as HTMLElement).getBoundingClientRect()`. Because a
// click can land on the inner SVG (or its <path>), `e.target` resolved to that
// child — at a different layout position — making the popup "jump" to the click
// position instead of staying anchored to the option row. The fix anchors to
// `e.currentTarget`, which React always sets to the element the handler is bound
// to (the row), giving a stable anchor.
//
// jsdom does not lay out, so getBoundingClientRect() returns all-zero rects by
// default and the row-vs-child distinction is invisible. We therefore stub
// getBoundingClientRect() with DISTINCT rects on the row and on its inner SVG
// child, then dispatch a real bubbling click whose `target` is the inner SVG
// child. We assert the rect handed to `superstate.ui.openMenu` is the ROW's rect,
// not the child's. This fails on the pre-fix code and passes after.
import React from "react";
import { act } from "react-dom/test-utils";
import { createRoot, Root } from "react-dom/client";

// makemd-core is a heavy barrel (drags in ESM-only deps the ts-jest transform
// cannot parse). Dropdown only imports TYPES from it (SelectOption, Superstate),
// which are erased at runtime, so an empty stub is faithful.
jest.mock("makemd-core", () => ({}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { Dropdown } = require("./Dropdown");

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

type XYWH = { x: number; y: number; width: number; height: number };
const ROW_RECT: XYWH = { x: 100, y: 200, width: 30, height: 30 };
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

const makeSuperstate = (calls: OpenMenuCall[]): any => ({
  ui: {
    getSticker: () => "<svg><path d='M0 0h1v1H0z'></path></svg>",
    openMenu: (rect: any) => {
      calls.push({ rect: { x: rect.x, y: rect.y } });
      return { update: () => {}, hide: () => {} };
    },
  },
});

describe("Dropdown menu anchoring (Notidian-74n)", () => {
  let calls: OpenMenuCall[];
  let superstate: any;
  let root: Root;
  let container: HTMLElement;

  beforeEach(() => {
    calls = [];
    superstate = makeSuperstate(calls);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
      root.render(
        <Dropdown
          superstate={superstate}
          value="a"
          options={[
            { name: "Alpha", value: "a" },
            { name: "Beta", value: "b" },
          ]}
          selectValue={() => {}}
        />
      );
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("anchors the dropdown menu to the option row, not the clicked SVG child", () => {
    const row = container.querySelector(".mk-cell-option-item") as HTMLElement;
    expect(row).toBeTruthy();
    const svgChild =
      row.querySelector("path") ?? row.querySelector("svg");
    expect(svgChild).toBeTruthy();

    stubRect(row, ROW_RECT);
    stubRect(svgChild as Element, SVG_CHILD_RECT);

    act(() => {
      // A real bubbling click whose target is the inner SVG child. React resolves
      // currentTarget to the row as the event bubbles to its listener — exactly
      // the live-DOM scenario the bug came from.
      svgChild!.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true, view: window })
      );
    });

    expect(calls.length).toBeGreaterThan(0);
    const anchor = calls[calls.length - 1].rect;
    expect(anchor.x).toBe(ROW_RECT.x);
    expect(anchor.y).toBe(ROW_RECT.y);
    // And explicitly NOT the clicked SVG child's rect (the pre-fix behavior).
    expect(anchor.x).not.toBe(SVG_CHILD_RECT.x);
    expect(anchor.y).not.toBe(SVG_CHILD_RECT.y);
  });
});
