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
// Sub-items (ADR 0024 B1): mock the create + frontmatter-write collaborators so
// the "Add sub-item" action's one-way contract can be asserted in isolation.
jest.mock("core/superstate/utils/spaces", () => ({
  newPathInSpace: jest.fn(),
}));
jest.mock("core/utils/properties/frontmatterWrite", () => ({
  saveFrontmatterProperties: jest.fn(),
}));
// Non-destructive parent-delete (Notidian-5ond.8): mock ONLY deletePath (whose
// real module pulls a heavy transitive graph ts-jest cannot parse here). The
// decision helper (requestRowDeleteWithSubItems), the pure collectSubtreePaths,
// and the SubItemDeleteModal are kept REAL so these tests exercise the actual
// leaf-vs-parent branch and recursive descendant removal.
jest.mock("core/superstate/utils/path", () => ({
  deletePath: jest.fn(),
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

// ---------------------------------------------------------------------------
// "Add sub-item" action (ADR 0024 B1, Notidian-f0pj.1)
// Proves the action creates a child row and writes ONLY the child's parent link
// — the parent's file is NEVER written (the one-way guarantee). Drives the
// non-primary branch (so the option lands in the bottom openMenu options array)
// with subItemsField set.
// ---------------------------------------------------------------------------
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { newPathInSpace } = require("core/superstate/utils/spaces");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const {
  saveFrontmatterProperties,
} = require("core/utils/properties/frontmatterWrite");

const PARENT_PATH = "Some/Space/Parent.md";
const CHILD_PATH = "Some/Space/Untitled.md";

const fakeEvent = (): any => {
  const el = document.createElement("div");
  (el as any).getBoundingClientRect = () => ({
    x: 0,
    y: 0,
    width: 0,
    height: 0,
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    toJSON: () => ({}),
  });
  return {
    preventDefault: () => {},
    currentTarget: el,
    target: el,
    view: window,
  };
};

describe("showRowContextMenu Add sub-item (ADR 0024 B1)", () => {
  let openedMenus: any[];
  let superstate: any;

  beforeEach(() => {
    newPathInSpace.mockReset();
    newPathInSpace.mockResolvedValue(CHILD_PATH);
    saveFrontmatterProperties.mockReset();
    saveFrontmatterProperties.mockResolvedValue({ ok: true });
    openedMenus = [];
    superstate = {
      ui: {
        openMenu: (_rect: any, menu: any) => {
          openedMenus.push(menu);
          return { update: () => {}, hide: () => {} };
        },
      },
      spaceManager: {
        readTable: async () => ({
          schema: { id: "t", name: "Table", type: "db", primary: "false" },
          rows: [{ File: PARENT_PATH }],
        }),
      },
      spacesIndex: new Map([
        ["Some/Space", { path: "Some/Space", name: "Space", type: "folder" }],
      ]),
      pathsIndex: new Map(),
    };
  });

  const addSubItemOption = async () => {
    await showRowContextMenu(
      fakeEvent(),
      superstate,
      "Some/Space",
      "table",
      0,
      undefined,
      undefined,
      "parent"
    );
    await Promise.resolve();
    const options = openedMenus[openedMenus.length - 1]?.options ?? [];
    // "Add sub-item" is the only option with the plus icon.
    return options.find((o: any) => o && o.icon === "ui//plus");
  };

  it("offers an Add sub-item option only when subItemsField is set", async () => {
    expect(await addSubItemOption()).toBeTruthy();

    // Without the field, no plus option is added.
    openedMenus = [];
    await showRowContextMenu(
      fakeEvent(),
      superstate,
      "Some/Space",
      "table",
      0
    );
    await Promise.resolve();
    const options = openedMenus[openedMenus.length - 1]?.options ?? [];
    expect(options.find((o: any) => o && o.icon === "ui//plus")).toBeFalsy();
  });

  it("creates a child and writes ONLY the child's parent link (parent untouched)", async () => {
    const option = await addSubItemOption();
    expect(option).toBeTruthy();

    await option.onClick();
    await Promise.resolve();

    // Child created in the same space, empty title, dontOpen=true (mirrors newRow).
    expect(newPathInSpace).toHaveBeenCalledTimes(1);
    const [ss, space, type, name, dontOpen] = newPathInSpace.mock.calls[0];
    expect(ss).toBe(superstate);
    expect(space).toEqual({ path: "Some/Space", name: "Space", type: "folder" });
    expect(type).toBe("md");
    expect(name).toBe("");
    expect(dontOpen).toBe(true);

    // Exactly one frontmatter write, to the CHILD, with only the parent link —
    // PATH-QUALIFIED (Notidian-kg81) so it resolves to THIS parent row instead
    // of the first same-named file vault-wide; basename kept as the display alias.
    expect(saveFrontmatterProperties).toHaveBeenCalledTimes(1);
    const writeArg = saveFrontmatterProperties.mock.calls[0][0];
    expect(writeArg.path).toBe(CHILD_PATH);
    expect(writeArg.properties).toEqual({ parent: "[[Some/Space/Parent|Parent]]" });

    // One-way guarantee: the parent's file is never a write target.
    for (const call of saveFrontmatterProperties.mock.calls) {
      expect(call[0].path).not.toBe(PARENT_PATH);
    }
  });
});

// ---------------------------------------------------------------------------
// Non-destructive parent-delete 3-way prompt (Notidian-5ond.8, ADR 0050)
// Proves: a LEAF row deletes silently (no modal); a PARENT row opens the 3-way
// prompt; the recursive option removes the correct counted descendant paths AND
// the parent; the "delete only" option promotes (parent gone, NO child rewrite);
// and Cancel is a no-op. Drives the non-primary branch so the MDB deleteRow
// option lands in the menu, and threads a real subItemsDelete config.
// ---------------------------------------------------------------------------
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { deleteRowInTable } = require("core/utils/contexts/context");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { deletePath } = require("core/superstate/utils/path");

// Tree over the visible rows: P > C1, C2 ; C1 > G (grandchild). Leaf = L.
// Row data uses PathPropertyName ("File") for paths and "parent" for links.
const VISIBLE_ROWS = [
  { File: "P", parent: "" },
  { File: "C1", parent: "[[P]]" },
  { File: "C2", parent: "[[P]]" },
  { File: "G", parent: "[[C1]]" },
  { File: "L", parent: "" },
];

describe("showRowContextMenu non-destructive delete (Notidian-5ond.8)", () => {
  let openedMenus: any[];
  let openedModals: any[];
  let tableRows: Record<string, any>[];
  let superstate: any;
  let root: Root;
  let container: HTMLElement;

  beforeEach(() => {
    deleteRowInTable.mockReset();
    deletePath.mockReset();
    openedMenus = [];
    openedModals = [];
    // The menu re-reads the table; order it so the index maps to a known row.
    tableRows = [
      { File: "P", parent: "" }, // index 0 -> parent with subtree
      { File: "L", parent: "" }, // index 1 -> leaf
    ];
    superstate = {
      ui: {
        openMenu: (_rect: any, menu: any) => {
          openedMenus.push(menu);
          return { update: () => {}, hide: () => {} };
        },
        openModal: (title: string, modal: any, _win: Window) => {
          openedModals.push({ title, modal });
          return { update: () => {}, hide: () => {} };
        },
      },
      spaceManager: {
        readTable: async () => ({
          schema: { id: "t", name: "Table", type: "db", primary: "false" },
          rows: tableRows,
        }),
        spaceInfoForPath: () => ({ path: "Some/Space" }),
      },
      pathsIndex: new Map(),
    };
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  const deleteOption = async (index: number) => {
    await showRowContextMenu(
      fakeEvent(),
      superstate,
      "Some/Space",
      "table",
      index,
      undefined,
      undefined,
      undefined, // subItemsField — not exercised here
      // The non-destructive-delete config: visible rows + tree parent key.
      { parentKey: "parent", rows: VISIBLE_ROWS }
    );
    await Promise.resolve();
    const options = openedMenus[openedMenus.length - 1]?.options ?? [];
    return options.find((o: any) => o && o.icon === "ui//trash");
  };

  // Render a captured modal element so we can click its buttons.
  const renderModal = (modalEl: JSX.Element): HTMLElement => {
    act(() => {
      // The modal framework injects `hide`; supply a no-op so the component runs.
      root.render(React.cloneElement(modalEl, { hide: () => {} }));
    });
    return container;
  };

  it("LEAF row deletes silently — no modal, immediate deleteRowInTable", async () => {
    const option = await deleteOption(1); // index 1 -> "L" (leaf)
    expect(option).toBeTruthy();
    await option.onClick(fakeEvent());
    await Promise.resolve();
    expect(openedModals).toHaveLength(0); // never prompts a childless row
    expect(deleteRowInTable).toHaveBeenCalledTimes(1);
    expect(deletePath).not.toHaveBeenCalled();
  });

  it("PARENT row opens the 3-way prompt instead of deleting", async () => {
    const option = await deleteOption(0); // index 0 -> "P" (has subtree)
    expect(option).toBeTruthy();
    await option.onClick(fakeEvent());
    await Promise.resolve();
    expect(openedModals).toHaveLength(1);
    // Nothing deleted yet — the user must choose.
    expect(deleteRowInTable).not.toHaveBeenCalled();
    expect(deletePath).not.toHaveBeenCalled();
    // The modal renders three buttons (promote / recursive / cancel).
    const host = renderModal(openedModals[0].modal);
    const buttons = host.querySelectorAll("button");
    expect(buttons).toHaveLength(3);
  });

  it("recursive option removes the COUNTED descendants AND the parent", async () => {
    const option = await deleteOption(0);
    await option.onClick(fakeEvent());
    await Promise.resolve();
    const host = renderModal(openedModals[0].modal);
    const buttons = Array.from(host.querySelectorAll("button"));
    // The destructive (recursive) button carries mod-warning.
    const recursive = buttons.find((b) =>
      b.classList.contains("mod-warning")
    ) as HTMLButtonElement;
    expect(recursive).toBeTruthy();
    // P's descendants are C1, G, C2 (3) — the count the modal showed.
    expect(recursive.textContent).toContain("3");
    act(() => recursive.click());
    // The recursive branch awaits each descendant deletePath, THEN deleteSelf —
    // flush enough microtasks for the whole chain (3 descendants + the parent).
    for (let i = 0; i < 8; i++) await Promise.resolve();
    // Every descendant path was deleted...
    const deleted = deletePath.mock.calls.map((c: any[]) => c[1]);
    expect(deleted.sort()).toEqual(["C1", "C2", "G"]);
    // ...and the parent row itself via the MDB remover (deleteSelf).
    expect(deleteRowInTable).toHaveBeenCalledTimes(1);
  });

  it("'delete item only' deletes JUST the parent — children promote, never rewritten", async () => {
    const option = await deleteOption(0);
    await option.onClick(fakeEvent());
    await Promise.resolve();
    const host = renderModal(openedModals[0].modal);
    const buttons = Array.from(host.querySelectorAll("button"));
    // The default (promote) button is the non-warning, non-cancel one.
    const promote = buttons.find(
      (b) =>
        !b.classList.contains("mod-warning") &&
        b.textContent !== "Cancel"
    ) as HTMLButtonElement;
    expect(promote).toBeTruthy();
    act(() => promote.click());
    await Promise.resolve();
    // Only the parent removed; NO descendant deletePath (children promote).
    expect(deleteRowInTable).toHaveBeenCalledTimes(1);
    expect(deletePath).not.toHaveBeenCalled();
  });

  it("Cancel is a no-op — nothing deleted", async () => {
    const option = await deleteOption(0);
    await option.onClick(fakeEvent());
    await Promise.resolve();
    const host = renderModal(openedModals[0].modal);
    const cancel = Array.from(host.querySelectorAll("button")).find(
      (b) => b.textContent === "Cancel"
    ) as HTMLButtonElement;
    expect(cancel).toBeTruthy();
    act(() => cancel.click());
    await Promise.resolve();
    expect(deleteRowInTable).not.toHaveBeenCalled();
    expect(deletePath).not.toHaveBeenCalled();
  });
});
