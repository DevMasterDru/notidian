/**
 * @jest-environment jsdom
 */
// Offline (jsdom) regression coverage for Notidian-3txp (batch 2):
//   "Anchor menus to e.currentTarget, not e.target."
//
// WHY THIS TEST EXISTS
// --------------------
// SpaceCell renders its disclosure control as a `.mk-cell-option-select` div that
// paints a collapse glyph via `dangerouslySetInnerHTML` SVG. Before the fix,
// showMenu computed its anchor rect from `(e.target as HTMLElement)
// .getBoundingClientRect()`. Because a click can land on the inner SVG (or its
// <path>), `e.target` resolved to that child — at a different layout position —
// making the popup "jump" to the click position instead of staying anchored to
// the control. The fix anchors to `e.currentTarget`, which React always sets to
// the element the handler is bound to (the icon div), giving a stable anchor.
//
// jsdom does not lay out, so getBoundingClientRect() returns all-zero rects by
// default and the control-vs-child distinction is invisible. We therefore stub
// getBoundingClientRect() with DISTINCT rects on the control and on its inner SVG
// child, then dispatch a real bubbling click whose `target` is the inner SVG
// child. We assert the rect handed to `superstate.ui.openMenu` is the CONTROL's
// rect, not the child's. This fails on the pre-fix code and passes after.
import React from "react";
import { act } from "react-dom/test-utils";
import { createRoot, Root } from "react-dom/client";

// makemd-core is a heavy barrel (drags in ESM-only deps the ts-jest transform
// cannot parse). SpaceCell only imports the SelectMenuProps TYPE from it, erased
// at runtime, so an empty stub is faithful.
jest.mock("makemd-core", () => ({}));

// contextPathFromPath drags in the full context/spaceManager graph (ESM-only deps).
// SpaceCell only uses it in a useEffect to resolve a display object; a resolved
// null is faithful for the anchor scenario (the disclosure control still renders).
jest.mock("core/utils/contexts/context", () => ({
  contextPathFromPath: () => Promise.resolve(null),
}));

// TableView is a heavy barrel; SpaceCell uses only the CellEditMode numeric enum
// from it at runtime (and the TableCellProp type, erased). Re-create the enum
// faithfully so the disclosure control renders when editMode > EditModeView.
jest.mock("../TableView/TableView", () => ({
  CellEditMode: {
    EditModeReadOnly: 0,
    EditModeNone: 1,
    EditModeView: 2,
    EditModeValueOnly: 3,
    EditModeActive: 4,
    EditModeAlways: 5,
  },
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { SpaceCell } = require("./SpaceCell");

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

type XYWH = { x: number; y: number; width: number; height: number };
const CONTROL_RECT: XYWH = { x: 100, y: 200, width: 24, height: 24 };
const SVG_CHILD_RECT: XYWH = { x: 555, y: 777, width: 10, height: 10 };

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
  allSpaces: (): any[] => [],
  ui: {
    getSticker: () => "<svg><path d='M0 0h1v1H0z'></path></svg>",
    openMenu: (rect: any) => {
      calls.push({ rect: { x: rect.x, y: rect.y } });
      return { update: () => {}, hide: () => {} };
    },
    openPath: () => {},
  },
});

describe("SpaceCell menu anchoring (Notidian-3txp)", () => {
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
        <SpaceCell
          superstate={superstate}
          initialValue="spaces://test"
          // editMode 5 (EditModeAlways) > EditModeView (2) so the disclosure
          // control renders.
          editMode={5}
          isTable={false}
          compactMode={false}
          saveValue={() => {}}
          setEditMode={() => {}}
          property={{ name: "space", schemaId: "", type: "space" } as any}
        />
      );
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("anchors the menu to the bound disclosure control, not the clicked SVG child", () => {
    const control = container.querySelector(
      ".mk-cell-option-select"
    ) as HTMLElement;
    expect(control).toBeTruthy();
    const svgChild = control.querySelector("path") ?? control.querySelector("svg");
    expect(svgChild).toBeTruthy();

    stubRect(control, CONTROL_RECT);
    stubRect(svgChild as Element, SVG_CHILD_RECT);

    act(() => {
      // A real bubbling click whose target is the inner SVG child. React resolves
      // currentTarget to the control as the event bubbles to its listener —
      // exactly the live-DOM scenario the bug came from.
      svgChild!.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true, view: window })
      );
    });

    expect(calls.length).toBeGreaterThan(0);
    const anchor = calls[calls.length - 1].rect;
    expect(anchor.x).toBe(CONTROL_RECT.x);
    expect(anchor.y).toBe(CONTROL_RECT.y);
    // And explicitly NOT the clicked SVG child's rect (the pre-fix behavior).
    expect(anchor.x).not.toBe(SVG_CHILD_RECT.x);
    expect(anchor.y).not.toBe(SVG_CHILD_RECT.y);
  });
});
