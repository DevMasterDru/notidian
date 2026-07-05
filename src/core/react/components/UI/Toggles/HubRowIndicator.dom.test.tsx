/**
 * @jest-environment jsdom
 */
// Offline (jsdom) render coverage for the row-as-child-hub indicator
// (Notidian-z21a, Atlas Method ADR-0042 D1). The component itself carries no
// gating logic (callers only render it once they've confirmed
// settings.enableNestedHubRows + the hub-row relationship), so these tests
// lock down its own render/interaction contract: it renders the sticker icon,
// exposes an accessible label, and routes a click to onOpen without letting
// the click bubble into the row's own click handler (a table/list row is
// itself clickable).
import React from "react";
import { act } from "react-dom/test-utils";
import { createRoot, Root } from "react-dom/client";

// React 18 act() environment flag.
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

// makemd-core is imported only for the Superstate type; stub it so the test
// never loads its runtime graph (same pattern as SpaceNoteBody.dom.test.tsx).
jest.mock("makemd-core", () => ({}));

import { HubRowIndicator } from "./HubRowIndicator";

const makeSuperstate = () =>
  ({
    ui: {
      getSticker: jest.fn(() => '<svg data-testid="hub-row-sticker"></svg>'),
    },
  } as any);

let container: HTMLDivElement;
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

describe("HubRowIndicator", () => {
  it("renders a button with the table sticker and an accessible label", async () => {
    const superstate = makeSuperstate();
    await act(async () => {
      root.render(
        <HubRowIndicator superstate={superstate} onOpen={() => {}} />
      );
    });

    const button = container.querySelector("button.mk-hub-row-indicator");
    expect(button).not.toBeNull();
    expect(button?.getAttribute("aria-label")).toBe(
      "This row is the hub of a nested database — open it"
    );
    expect(superstate.ui.getSticker).toHaveBeenCalledWith("ui//table");
    expect(container.querySelector('[data-testid="hub-row-sticker"]')).not.toBeNull();
  });

  it("clicking calls onOpen exactly once and stops the click from bubbling to a parent row handler", async () => {
    const superstate = makeSuperstate();
    const onOpen = jest.fn();
    const onRowClick = jest.fn();

    await act(async () => {
      root.render(
        // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions
        <div onClick={onRowClick}>
          <HubRowIndicator superstate={superstate} onOpen={onOpen} />
        </div>
      );
    });

    const button = container.querySelector(
      "button.mk-hub-row-indicator"
    ) as HTMLButtonElement;
    await act(async () => {
      button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onRowClick).not.toHaveBeenCalled();
  });
});
