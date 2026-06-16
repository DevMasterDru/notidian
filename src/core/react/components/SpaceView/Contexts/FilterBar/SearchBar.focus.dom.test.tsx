/**
 * @jest-environment jsdom
 */
// Offline (jsdom) regression coverage for Notidian-z8q (ADR 0041 review fix):
//   "Cmd/Ctrl+F no longer focuses the search input — keyboard-open regression."
//
// WHY THIS TEST EXISTS
// --------------------
// ADR 0041 consolidated the table view to ONE search affordance and rebound
// Cmd/Ctrl+F (TableView.onKeyDown) to open it via setSearchActive(true), which
// mounts <SearchBar>. The headline behavior the commit/ADR/tooltip all advertise
// ("press Cmd/Ctrl+F and type") only works if SearchBar lands keyboard focus in
// its <input> on mount. Before the fix, SearchBar's focus effect was gated on an
// internal `searchActive` state that was initialized false and never set true, so
// the effect's focus() body never ran and the input carried no autoFocus —
// opening the bar left focus on the table. This test mounts SearchBar and asserts
// its input becomes document.activeElement, failing on the pre-fix code.
import React from "react";
import { act } from "react-dom/test-utils";
import { createRoot, Root } from "react-dom/client";

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { SearchBar } = require("./SearchBar");

// React 18 act() environment flag.
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const makeSuperstate = (): any => ({
  ui: {
    getSticker: () => "<svg></svg>",
  },
});

describe("SearchBar keyboard-open focus (Notidian-z8q / ADR 0041)", () => {
  let root: Root;
  let container: HTMLElement;

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("focuses its input on mount so Cmd/Ctrl+F lands focus in the field", () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    act(() => {
      root.render(
        <SearchBar
          superstate={makeSuperstate()}
          setSearchString={() => {}}
          closeSearch={() => {}}
        />
      );
    });

    const input = container.querySelector("input.mk-search-bar");
    expect(input).toBeTruthy();
    // The just-mounted search input must be the active element — this is the
    // behavior Cmd/Ctrl+F (which mounts SearchBar) depends on.
    expect(document.activeElement).toBe(input);
  });
});
