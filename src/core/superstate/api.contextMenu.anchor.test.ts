/**
 * Notidian-74n (follow-up): api.table.contextMenu must anchor the row context
 * menu to the ROW rect, not the clicked SVG child.
 *
 * WHY THIS TEST EXISTS
 * --------------------
 * showRowContextMenu's batch-1 fix captured the anchor rect SYNCHRONOUSLY at its
 * own function entry, assuming it owns the synchronous boundary. It does for the
 * direct TableView onContextMenu handler. But api.table.contextMenu is ITSELF
 * `async` and `await`s readTable() BEFORE calling showRowContextMenu. The React
 * synthetic event reaches it through a synchronous chain (FrameView onContextMenu
 * -> executeAction -> ContextListView contextMenu action -> api.table.contextMenu),
 * but the FIRST await in that chain is readTable() — which runs BEFORE
 * showRowContextMenu. In React 18, once the synchronous dispatch returns,
 * e.currentTarget is reset to null while e.target is retained (verified
 * empirically). So showRowContextMenu, reading e.currentTarget post-await, got
 * null and fell back to e.target — the clicked SVG child — the exact anti-pattern
 * the bead set out to remove.
 *
 * The fix: api.table.contextMenu captures the anchor rect + window from
 * e.currentTarget at its OWN synchronous boundary (before the await) and forwards
 * them to showRowContextMenu. This test drives the real API.table.contextMenu
 * with an event whose currentTarget is nulled on the next microtask (faithful to
 * React 18's post-dispatch reset) and a readTable that resolves later, then
 * asserts ui.openMenu received the ROW rect — proving the capture happened before
 * the await. It fails on the pre-fix code (which would forward null currentTarget
 * and anchor to the SVG child).
 */
import { ISuperstate } from "shared/types/superstate";
import type { Rect } from "shared/types/Pos";

// api.ts pulls in the heavy UI/menu graph for methods these tests do not
// exercise. Stub the ones we don't drive; CRUCIALLY do NOT mock rowContextMenu —
// we want the real showRowContextMenu so the capture-and-forward contract is
// exercised end to end.
jest.mock("makemd-core", () => ({}));
jest.mock(
  "core/react/components/UI/Menus/navigator/pathContextMenu",
  () => ({ showPathContextMenu: jest.fn() })
);
jest.mock(
  "core/react/components/UI/Modals/ContextCreateItemModal",
  () => ({ openContextCreateItemModal: jest.fn() })
);
// showRowContextMenu builds its menu via defaultMenu (SelectionMenu.tsx), which
// transitively imports the parsers->schemas graph ts-jest cannot parse here. We
// only assert WHICH rect is handed to ui.openMenu, so a passthrough stub for
// defaultMenu is faithful.
jest.mock(
  "core/react/components/UI/Menus/menu/SelectionMenu",
  () => ({ defaultMenu: (_ui: unknown, options: unknown) => ({ options }) })
);
// EditPropertyMenu is only referenced by an unused import in rowContextMenu.
jest.mock(
  "core/react/components/UI/Menus/contexts/EditPropertyMenu",
  () => ({ EditPropertiesSubmenu: (): null => null })
);
jest.mock("core/utils/contexts/context", () => ({
  __esModule: true,
  deleteRowInTable: jest.fn(),
  addRowInTable: jest.fn(),
  updateTableRow: jest.fn(),
  updateValueInContext: jest.fn(),
}));
jest.mock("./utils/spaces", () => ({
  __esModule: true,
  saveProperties: jest.fn(),
  newPathInSpace: jest.fn(),
}));

// Imported after mocks so the API picks up the mocked modules.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { API } = require("./api");

type XYWH = { x: number; y: number; width: number; height: number };
const ROW_RECT: XYWH = { x: 100, y: 200, width: 300, height: 30 };
const SVG_CHILD_RECT: XYWH = { x: 555, y: 777, width: 12, height: 12 };

const stubEl = (rect: XYWH) =>
  ({
    getBoundingClientRect: () => ({
      ...rect,
      top: rect.y,
      left: rect.x,
      right: rect.x + rect.width,
      bottom: rect.y + rect.height,
      toJSON: () => rect,
    }),
    ownerDocument: { defaultView: {} as Window },
  } as unknown as HTMLElement);

describe("api.table.contextMenu anchoring (Notidian-74n async caller)", () => {
  it("anchors to the ROW rect captured before the await, not the clicked SVG child (currentTarget nulled post-dispatch)", async () => {
    const openMenuCalls: Array<{ rect: Rect }> = [];

    // currentTarget = the bound row; target = the clicked SVG child. We model
    // React 18 by nulling currentTarget on the next microtask, which lands
    // BEFORE readTable() resolves (readTable awaits a later microtask).
    const rowEl = stubEl(ROW_RECT);
    const svgChild = stubEl(SVG_CHILD_RECT);

    const e: any = {
      preventDefault: () => {},
      currentTarget: rowEl,
      target: svgChild,
      view: { document: { defaultView: {} as Window } },
      clientX: SVG_CHILD_RECT.x,
      clientY: SVG_CHILD_RECT.y,
    };
    // React's post-dispatch reset: currentTarget becomes null after the
    // synchronous dispatch unwinds. Schedule it as a microtask so it fires
    // before readTable's (later) resolution.
    Promise.resolve().then(() => {
      e.currentTarget = null;
    });

    const superstate = {
      ui: {
        openMenu: (rect: Rect) => {
          openMenuCalls.push({ rect });
          return { update: () => {}, hide: () => {} };
        },
      },
      pathsIndex: new Map(),
      spaceManager: {
        // Resolve on a LATER microtask than the currentTarget-null microtask,
        // so by the time showRowContextMenu runs, currentTarget is already null.
        readTable: async () => {
          await Promise.resolve();
          await Promise.resolve();
          return {
            schema: { id: "t", name: "Table", type: "db", primary: "false" },
            rows: [{ name: "row-0" }],
          };
        },
      },
    } as unknown as ISuperstate;

    const api = new API(superstate);

    // Non-default schema -> reaches the showRowContextMenu branch.
    await api.table.contextMenu(e, "Some/Space", "table", 0);
    // Drain any trailing continuations.
    await Promise.resolve();
    await Promise.resolve();

    expect(openMenuCalls.length).toBe(1);
    const anchor = openMenuCalls[0].rect;
    expect(anchor.x).toBe(ROW_RECT.x);
    expect(anchor.y).toBe(ROW_RECT.y);
    // And explicitly NOT the clicked SVG child's rect (the pre-fix behavior).
    expect(anchor.x).not.toBe(SVG_CHILD_RECT.x);
    expect(anchor.y).not.toBe(SVG_CHILD_RECT.y);
  });
});
