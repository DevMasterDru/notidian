/**
 * @jest-environment jsdom
 */
import React from "react";
import { act } from "react-dom/test-utils";
import { createRoot, Root } from "react-dom/client";

jest.mock("makemd-core", () => ({}));

const {
  defaultGroupedIslandMenuWidth,
  groupedIslandMenuFixedRowWidth,
  showGroupedIslandMenu,
} = require("./groupedIslandMenu");

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const RECT = { x: 0, y: 0, width: 0, height: 0 } as any;

const mountMenu = () => {
  const captured: { element: any; anchor?: string } = { element: null };
  const openModal = jest.fn();
  showGroupedIslandMenu(
    {
      ui: {
        openCustomMenu: (_rect: any, element: any, _props: any, _win: any, anchor?: string) => {
          captured.element = element;
          captured.anchor = anchor;
        },
        openModal,
      },
    },
    RECT,
    window as any,
    {
      options: [
        { name: "Open", value: "Open" },
        { name: "Done", value: "Done" },
      ],
      saveGlobalOrder: () => {},
      saveViewOrder: () => {},
      clearViewOrder: () => {},
      renameOption: () => {},
    }
  );
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => root.render(captured.element));
  return { root, container, anchor: captured.anchor, openModal };
};

describe("GroupedIslandMenu drag ordering", () => {
  let root: Root;
  let container: HTMLElement;

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("renders accessible drag handles rather than directional arrow controls", () => {
    const mounted = mountMenu();
    ({ root, container } = mounted);

    expect(container.querySelector('[aria-label="Reorder Open"]')).toBeTruthy();
    expect(container.querySelector('[aria-label="Reorder Done"]')).toBeTruthy();
    expect(container.querySelector('[aria-label="Move Open up"]')).toBeFalsy();
    expect(container.querySelector('[aria-label="Move Done down"]')).toBeFalsy();
    expect(mounted.anchor).toBe("bottom");
  });

  it("opens Notidian's input modal for rename instead of calling unsupported window.prompt", () => {
    const mounted = mountMenu();
    ({ root, container } = mounted);
    const rename = container.querySelector<HTMLButtonElement>(
      '[aria-label="Rename Open"]'
    );

    act(() => rename!.click());

    expect(mounted.openModal).toHaveBeenCalledWith(
      "Rename group",
      expect.objectContaining({
        props: expect.objectContaining({ value: "Open", saveLabel: "Rename" }),
      }),
      window
    );
  });

  it("initially sizes to the longest label and caps the result to the safe menu width", () => {
    expect(
      defaultGroupedIslandMenuWidth({
        labelWidths: [110, 318, 220],
        fixedRowWidth: 142,
        maxWidth: 720,
      })
    ).toBe(460);
    expect(
      defaultGroupedIslandMenuWidth({
        labelWidths: [110, 318],
        fixedRowWidth: 142,
        maxWidth: 420,
      })
    ).toBe(420);
  });

  it("counts only fixed controls and box spacing when measuring an option row", () => {
    expect(
      groupedIslandMenuFixedRowWidth({
        controlWidths: [42, 89],
        gap: 4,
        paddingStart: 8,
        paddingEnd: 8,
        marginStart: 6,
        marginEnd: 6,
      })
    ).toBe(167);
  });
});
