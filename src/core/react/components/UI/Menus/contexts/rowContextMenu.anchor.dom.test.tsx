/**
 * @jest-environment jsdom
 */
// Offline (jsdom) regression coverage for Notidian-74n (batch 1):
//   "Anchor menus to e.currentTarget, not e.target — read SYNCHRONOUSLY before
//    any await."
//
// WHY THIS TEST EXISTS (and why this case is special)
// ---------------------------------------------------
// showRowContextMenu is `async` and `await`s spaceManager.readTable() BEFORE it
// opens its menu. A naive `e.target -> e.currentTarget` swap would crash here:
// after an await React has returned from the handler and `e.currentTarget` is
// null. The fix captures the anchor rect SYNCHRONOUSLY at function entry (from
// e.currentTarget, the bound row) and reuses it after the await. This test:
//   (1) proves the anchor handed to ui.openMenu is the ROW's rect, not the
//       clicked SVG child's rect (the e.target anti-pattern), AND
//   (2) proves it survives the await INTERNAL to showRowContextMenu (no crash,
//       correct rect), by capturing the rect synchronously and only reading it
//       after readTable resolves.
// It fails on a code path that read e.target after the await (wrong rect) or
// e.currentTarget after the await (null -> throw).
//
// SCOPE NOTE: this exercises the SYNCHRONOUS caller — the direct TableView
// onContextMenu handler that invokes showRowContextMenu while e.currentTarget is
// still the bound row. The OTHER caller, api.table.contextMenu, is itself async
// and awaits readTable() BEFORE calling showRowContextMenu, so by then React has
// already nulled e.currentTarget; that surface needs the rect captured at the
// caller's synchronous boundary and is covered by
// src/core/superstate/api.contextMenu.anchor.test.ts (Notidian-74n follow-up).
import React from "react";
import { act } from "react-dom/test-utils";
import { createRoot, Root } from "react-dom/client";

// --- Heavy-graph isolation: mock every collaborator the module imports. None of
// the mocked paths are exercised on the non-primary-schema branch we drive (it
// builds two SelectOptions and opens the bottom menu); the mocks just sever the
// transitive ESM graph the ts-jest transform cannot parse. ----------------------
jest.mock("makemd-core", () => ({}));
jest.mock("core/utils/contexts/context", () => ({
  deleteRowInTable: jest.fn(),
}));
jest.mock("../navigator/pathContextMenu", () => ({
  showPathContextMenu: jest.fn(),
}));
jest.mock("./EditPropertyMenu", () => ({
  EditPropertiesSubmenu: (): null => null,
}));
jest.mock("../../Modals/ContextCreateItemModal", () => ({
  openContextCreateItemModal: jest.fn(),
}));
// defaultMenu lives in SelectionMenu.tsx, which transitively imports the parsers
// -> schemas graph (needs the full i18n + mdb tables) that ts-jest cannot parse
// here. We are only asserting WHICH RECT is handed to ui.openMenu, not the menu
// contents, so a light passthrough stub for defaultMenu is faithful.
jest.mock("../menu/SelectionMenu", () => ({
  defaultMenu: (_ui: unknown, options: unknown) => ({ options }),
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { showRowContextMenu } = require("./rowContextMenu");

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

type XYWH = { x: number; y: number; width: number; height: number };
const ROW_RECT: XYWH = { x: 100, y: 200, width: 300, height: 30 };
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
    openMenu: (rect: any) => {
      calls.push({ rect: { x: rect.x, y: rect.y } });
      return { update: () => {}, hide: () => {} };
    },
  },
  spaceManager: {
    // Non-primary schema with one row -> reaches the bottom openMenu path
    // (the primary branch routes to the mocked showPathContextMenu instead).
    readTable: async () => ({
      schema: { id: "t", name: "Table", type: "db", primary: "false" },
      rows: [{ name: "row-0" }],
    }),
  },
  pathsIndex: new Map(),
});

const flush = async () => {
  // Let the awaited readTable() promise and its continuation settle.
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
};

describe("showRowContextMenu anchoring (Notidian-74n)", () => {
  let calls: OpenMenuCall[];
  let superstate: any;
  let root: Root;
  let container: HTMLElement;
  let capturedAnchor: { x: number; y: number } | null;

  beforeEach(() => {
    calls = [];
    capturedAnchor = null;
    superstate = makeSuperstate(calls);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
      root.render(
        <div
          className="host-row"
          onContextMenu={(e) =>
            showRowContextMenu(e, superstate, "Some/Space", "table", 0)
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

  it("anchors the row context menu to the row rect captured before the await, not the clicked SVG child", async () => {
    const row = container.querySelector(".host-row") as HTMLElement;
    expect(row).toBeTruthy();
    const svgChild =
      row.querySelector("path") ?? row.querySelector("svg");
    expect(svgChild).toBeTruthy();

    stubRect(row, ROW_RECT);
    stubRect(svgChild as Element, SVG_CHILD_RECT);

    act(() => {
      // A real bubbling contextmenu whose target is the inner SVG child.
      svgChild!.dispatchEvent(
        new MouseEvent("contextmenu", {
          bubbles: true,
          cancelable: true,
          view: window,
        })
      );
    });

    // The rect must already have been captured synchronously; the await has not
    // yet resolved, so openMenu has not been called yet — but no crash occurred.
    await flush();

    expect(calls.length).toBeGreaterThan(0);
    const anchor = calls[calls.length - 1].rect;
    capturedAnchor = anchor;
    expect(anchor.x).toBe(ROW_RECT.x);
    expect(anchor.y).toBe(ROW_RECT.y);
    // And explicitly NOT the clicked SVG child's rect (the pre-fix behavior).
    expect(anchor.x).not.toBe(SVG_CHILD_RECT.x);
    expect(anchor.y).not.toBe(SVG_CHILD_RECT.y);
    expect(capturedAnchor).not.toBeNull();
  });
});
