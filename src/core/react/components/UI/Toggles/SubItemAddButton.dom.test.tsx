/**
 * @jest-environment jsdom
 */
// Component contract for the inline "+ Add sub-item" affordance (ADR 0050):
// renders the plus sticker and, on click, invokes onAdd while stopping
// propagation (so it never triggers row select / cell edit / the row menu).
import React from "react";
import { act } from "react-dom/test-utils";
import { createRoot, Root } from "react-dom/client";

jest.mock("makemd-core", () => ({}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { SubItemAddButton } = require("./SubItemAddButton");

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const superstate: any = {
  ui: { getSticker: () => "<svg data-sticker='plus'></svg>" },
};

describe("SubItemAddButton", () => {
  let container: HTMLElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("renders a low-emphasis plus button with the add-sub-item affordance class", () => {
    act(() => {
      root.render(
        <SubItemAddButton superstate={superstate} onAdd={() => {}} />
      );
    });
    const btn = container.querySelector(".mk-subitem-add") as HTMLElement;
    expect(btn).toBeTruthy();
    expect(btn.tagName).toBe("BUTTON");
    expect(btn.querySelector("svg")).toBeTruthy();
  });

  it("invokes onAdd and stops propagation on click", () => {
    let added = 0;
    let bubbled = 0;
    act(() => {
      root.render(
        // Parent click handler must NOT fire (stopPropagation).
        <div onClick={() => (bubbled += 1)}>
          <SubItemAddButton superstate={superstate} onAdd={() => (added += 1)} />
        </div>
      );
    });
    const btn = container.querySelector(".mk-subitem-add") as HTMLElement;
    act(() => {
      btn.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true })
      );
    });
    expect(added).toBe(1);
    expect(bubbled).toBe(0);
  });
});
