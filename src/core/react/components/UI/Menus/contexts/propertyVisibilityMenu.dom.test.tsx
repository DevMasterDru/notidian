/**
 * @jest-environment jsdom
 */
// Offline (jsdom) coverage for Notidian-r6oj — the owner-requested enhancements
// to the shared property-visibility menu (the "Item Properties" picker surfaced
// on Cards/Board/Details, and the table-column header menu):
//
//   PART A — per-row "Remove property" affordance. A trash button renders on each
//     row whose column is DELETABLE (non-frontmatter-backed), gated on the EXACT
//     same predicate the table-header "Delete Property" menu uses
//     (canDeletePropertyColumn), and clicking it invokes the threaded deleteColumn
//     (the same delColumn the table-header menu calls) with the column. A
//     frontmatter-backed column shows NO remove button (its data is canonical in
//     the file — ADR 0001/0014/0016).
//
//   PART B — the "+ New Property" row renders whenever `newProperty` is passed.
//     This is the component half of making it reachable in the Item Properties
//     path (FilterBar now passes newProperty there, mirroring the table path).
//
// WHY THIS TEST LEVEL
// -------------------
// The menu is the shared UI both the table-column path and the Item Properties
// path render. Asserting the row affordances HERE (component-level), with the
// real propertyColumnActions delete gate, proves the behavior for both callers
// without a full FilterBar mount. The heavy `makemd-core` app barrel and the
// `allProperties` module (which transitively reaches ESM-only deps the repo's
// ts-jest transform cannot parse) are stubbed with faithful, minimal shims; the
// delete gate's real semantics (frontmatter-backed => not deletable) are
// preserved in the shim so the gate under test is exercised honestly.
import React from "react";
import { act } from "react-dom/test-utils";
import { createRoot, Root } from "react-dom/client";

// makemd-core is a heavy ESM barrel; the menu only needs the Superstate TYPE
// (erased) at runtime, so an empty stub suffices.
jest.mock("makemd-core", () => ({}));

// allProperties transitively imports the heavy graph; the menu needs only
// filterPropertiesForNameQuery, and propertyColumnActions needs a FAITHFUL
// isFrontmatterBackedProperty (the delete gate under test). Both are reproduced
// minimally so the real gate semantics still drive the assertions.
jest.mock("core/utils/properties/allProperties", () => ({
  filterPropertiesForNameQuery: (properties: any[], query: string) => {
    const trimmed = (query ?? "").trim().toLowerCase();
    if (!trimmed) return properties;
    return properties.filter((p: any) =>
      p.name.toLowerCase().includes(trimmed)
    );
  },
  // Faithful to the real helper: a column is frontmatter-backed iff
  // source === "frontmatter".
  isFrontmatterBackedProperty: (property?: any) =>
    property?.source === "frontmatter",
}));

// The component itself is module-private; render it through showPropertyVisibilityMenu,
// which calls superstate.ui.openCustomMenu(rect, <Component/>, ...). We capture the
// element it passes and mount THAT, so we exercise the real component tree.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { showPropertyVisibilityMenu } = require("./propertyVisibilityMenu");

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const SVG = "<svg><path d='M0 0h1v1H0z'></path></svg>";

const makeSuperstate = (): { superstate: any; captured: { element: any } } => {
  const captured: { element: any } = { element: null };
  const superstate = {
    ui: {
      getSticker: () => SVG,
      openCustomMenu: (_rect: any, element: any) => {
        captured.element = element;
        return { update: () => {}, hide: () => {} };
      },
    },
  };
  return { superstate, captured };
};

type Col = {
  name: string;
  type: string;
  table?: string;
  schemaId?: string;
  source?: string;
  primary?: string;
};

const RECT = { x: 0, y: 0, width: 0, height: 0 } as any;

const mountMenu = (props: any): { root: Root; container: HTMLElement } => {
  const { superstate, captured } = makeSuperstate();
  // showPropertyVisibilityMenu hands the constructed <Component/> element to
  // openCustomMenu; we grab it and mount it so the REAL component renders.
  showPropertyVisibilityMenu(superstate, RECT, window as any, props);
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(captured.element);
  });
  return { root, container };
};

describe("PropertyVisibilityMenu remove/new-property affordances (Notidian-r6oj)", () => {
  const baseCols: Col[] = [
    // Notidian-owned (deletable) column.
    { name: "manual", type: "text", table: "", schemaId: "files" },
    // Frontmatter-backed (NOT deletable — file is canonical).
    {
      name: "status",
      type: "option",
      table: "",
      schemaId: "files",
      source: "frontmatter",
    },
  ];

  let root: Root;
  let container: HTMLElement;
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("PART A: renders a remove button ONLY for deletable columns and invokes deleteColumn with the column", () => {
    const removed: Col[] = [];
    ({ root, container } = mountMenu({
      cols: baseCols,
      colsOrder: [],
      colsHidden: [],
      savePredicate: () => {},
      deleteColumn: (col: Col) => removed.push(col),
    }));

    const removeButtons = Array.from(
      container.querySelectorAll("button.mk-property-visibility-remove")
    ) as HTMLButtonElement[];
    // Exactly ONE remove button — for the Notidian-owned "manual" column. The
    // frontmatter-backed "status" column is gated out (matches the table-header
    // menu, which hides "Delete Property" for frontmatter-backed columns).
    expect(removeButtons.length).toBe(1);

    act(() => {
      removeButtons[0].dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true, view: window })
      );
    });
    expect(removed.length).toBe(1);
    expect(removed[0].name).toBe("manual");
  });

  it("PART A: renders NO remove button at all when deleteColumn is not threaded (kill-switch-OFF / table-edit-disabled callers unchanged)", () => {
    ({ root, container } = mountMenu({
      cols: baseCols,
      colsOrder: [],
      colsHidden: [],
      savePredicate: () => {},
      // no deleteColumn
    }));
    expect(
      container.querySelectorAll("button.mk-property-visibility-remove").length
    ).toBe(0);
  });

  it("PART B: renders the '+ New Property' row exactly when newProperty is passed, and invokes it", () => {
    const newCalls: any[] = [];
    ({ root, container } = mountMenu({
      cols: baseCols,
      colsOrder: [],
      colsHidden: [],
      savePredicate: () => {},
      newProperty: (rect: any) => newCalls.push(rect),
    }));

    // The new-property row is the option carrying the New Property label.
    const options = Array.from(
      container.querySelectorAll(".mk-menu-option")
    ) as HTMLElement[];
    const newRow = options.find((o) =>
      (o.textContent ?? "").includes("New Property")
    );
    expect(newRow).toBeTruthy();

    act(() => {
      newRow!.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true, view: window })
      );
    });
    expect(newCalls.length).toBe(1);
  });

  it("PART B: does NOT render the '+ New Property' row when newProperty is omitted", () => {
    ({ root, container } = mountMenu({
      cols: baseCols,
      colsOrder: [],
      colsHidden: [],
      savePredicate: () => {},
    }));
    const options = Array.from(
      container.querySelectorAll(".mk-menu-option")
    ) as HTMLElement[];
    const newRow = options.find((o) =>
      (o.textContent ?? "").includes("New Property")
    );
    expect(newRow).toBeFalsy();
  });
});
