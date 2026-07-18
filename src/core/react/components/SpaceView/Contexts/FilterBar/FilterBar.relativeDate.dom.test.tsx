/**
 * @jest-environment jsdom
 */
import React from "react";
import { act } from "react-dom/test-utils";
import { createRoot, Root } from "react-dom/client";
import { ScreenType } from "shared/types/ui";

jest.mock("makemd-core", () => ({
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  SelectOptionType: require("shared/types/menu").SelectOptionType,
}));
jest.mock("core/react/context/SpaceContext", () => ({
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  SpaceContext: require("react").createContext(null),
}));
jest.mock("core/react/context/PathContext", () => ({
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  PathContext: require("react").createContext({ readMode: false }),
}));
jest.mock("core/react/context/ContextEditorContext", () => ({
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  ContextEditorContext: require("react").createContext(null),
}));
jest.mock("core/react/context/FramesMDBContext", () => ({
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  FramesMDBContext: require("react").createContext(null),
}));
jest.mock("core/react/components/UI/Crumbs/PathCrumb", () => ({
  PathCrumb: (): null => null,
}));
jest.mock("core/react/components/UI/Menus/contexts/newSpacePropertyMenu", () => ({
  showNewPropertyMenu: () => {},
}));
jest.mock(
  "core/react/components/UI/Menus/contexts/propertyVisibilityMenu",
  () => ({ showPropertyVisibilityMenu: () => {} })
);
jest.mock("core/react/components/UI/Menus/contexts/spacePropertyMenu", () => ({
  showPropertyMenu: () => {},
}));
jest.mock("core/react/components/UI/Menus/navigator/showSpaceAddMenu", () => ({
  showSpaceAddMenu: () => {},
}));
const showDatePickerMenuMock = jest.fn();
jest.mock("core/react/components/UI/Menus/properties/datePickerMenu", () => ({
  showDatePickerMenu: (...args: unknown[]) => showDatePickerMenuMock(...args),
  DatePickerTimeMode: { None: 0 },
}));
jest.mock("core/react/components/UI/Menus/properties/linkMenu", () => ({
  showLinkMenu: () => {},
}));
jest.mock("core/react/components/UI/Menus/properties/propertyMenu", () => ({
  showSetValueMenu: () => {},
}));
jest.mock("core/react/components/UI/Menus/properties/selectSpaceMenu", () => ({
  showSpacesMenu: () => {},
}));
jest.mock("core/react/components/UI/Modals/ContextCreateItemModal", () => ({
  openContextCreateItemModal: () => {},
}));
jest.mock("core/react/components/UI/Modals/CsvImportModal", () => ({
  CsvImportModal: (): null => null,
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { FilterBar, FilterValueSpan } = require("./FilterBar");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { SpaceContext } = require("core/react/context/SpaceContext");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { PathContext } = require("core/react/context/PathContext");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { ContextEditorContext } = require("core/react/context/ContextEditorContext");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { FramesMDBContext } = require("core/react/context/FramesMDBContext");

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const makeSuperstate = (): any => ({
  settings: { experimental: false },
  ui: {
    getSticker: () => "<svg></svg>",
    getScreenType: () => ScreenType.Desktop,
    openMenu: () => ({ update: () => {}, hide: () => {} }),
    notify: () => {},
    openModal: () => {},
  },
  spaceManager: {
    uriByString: (path: string) => ({
      path,
      ref: null as string | null,
      authority: "",
    }),
    readFrame: async (): Promise<{ cols: unknown[] }> => ({ cols: [] }),
    readTags: (): string[] => [],
  },
  spacesIndex: new Map([["Some Space", { name: "Some Space" }]]),
  contextsIndex: new Map([["Some Space", { schemas: [] }]]),
  pathsIndex: new Map(),
  spacesMap: { getInverse: () => new Set<string>() },
  kitFrames: new Map(),
  getSpaceItems: (): unknown[] => [],
});

const predicateWith = (fn: string, value: string): any => ({
  view: "table",
  filters: [{ field: "closed", fn, fType: "date", value }],
  sort: [],
  groupBy: [],
  listView: "",
  listGroup: "",
  listItem: "",
  listViewProps: {},
  listGroupProps: {},
  listItemProps: {},
  colsHidden: [],
  colsOrder: [],
});

const mount = async (fn: string, value: string) => {
  const savePredicate = jest.fn();
  const superstate = makeSuperstate();
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(
      <SpaceContext.Provider
        value={{
          spaceInfo: null,
          readMode: false,
          spaceState: {
            path: "Some Space",
            name: "Some Space",
            space: { readOnly: false },
            propertyTypes: [],
          },
        }}
      >
        <PathContext.Provider value={{ readMode: false }}>
          <ContextEditorContext.Provider
            value={{
              source: "Some Space",
              dbSchema: { id: "files", name: "Files", type: "db", primary: "false" },
              cols: [{ name: "closed", type: "date", table: "" }],
              filteredData: [],
              predicate: predicateWith(fn, value),
              savePredicate,
              setSearchString: () => {},
              setEditMode: () => {},
              hideColumn: () => {},
              delColumn: () => {},
              saveColumn: () => false,
              openViewSearch: () => {},
              setSearchActive: () => {},
              searchActive: false,
              reloadContextData: async () => {},
            }}
          >
            <FramesMDBContext.Provider
              value={{
                frameSchema: { id: "fs", name: "View", type: "view", def: {} },
                saveSchema: async () => {},
                setFrameSchema: () => {},
              }}
            >
              <FilterBar superstate={superstate} />
            </FramesMDBContext.Provider>
          </ContextEditorContext.Provider>
        </PathContext.Provider>
      </SpaceContext.Provider>
    );
  });
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  return { root, container, savePredicate } as {
    root: Root;
    container: HTMLElement;
    savePredicate: jest.Mock;
  };
};

const change = (element: HTMLInputElement | HTMLSelectElement, value: string) => {
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(
      Object.getPrototypeOf(element),
      "value"
    )!.set!;
    setter.call(element, value);
    element.dispatchEvent(new Event("change", { bubbles: true }));
    if (element instanceof HTMLInputElement) {
      element.dispatchEvent(new Event("input", { bubbles: true }));
    }
  });
};

describe("FilterBar relative-date value editor (Notidian-uupm.4)", () => {
  afterEach(() => {
    showDatePickerMenuMock.mockReset();
    document.body.replaceChildren();
  });

  it("loads an existing unsigned token into accessible amount and unit controls", async () => {
    const { root, container } = await mount("withinLast", "7d");
    const amount = container.querySelector(
      'input[aria-label="Relative date amount"]'
    ) as HTMLInputElement;
    const unit = container.querySelector(
      'select[aria-label="Relative date unit"]'
    ) as HTMLSelectElement;
    expect(amount.value).toBe("7");
    expect(unit.value).toBe("d");
    act(() => root.unmount());
  });

  it("keeps the clickable date value path when the relative editor is not enabled", () => {
    const selectFilterValue = jest.fn();
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => {
      root.render(
        <FilterValueSpan
          superstate={makeSuperstate()}
          fieldType="date"
          filter={{
            field: "closed",
            fn: "withinLast",
            fType: "date",
            value: "7d",
          }}
          selectFilterValue={selectFilterValue}
        />
      );
    });

    expect(
      container.querySelector('input[aria-label="Relative date amount"]')
    ).toBeNull();
    expect(
      container.querySelector('select[aria-label="Relative date unit"]')
    ).toBeNull();
    const value = Array.from(container.querySelectorAll("span")).find(
      (span) => span.textContent === "7d"
    ) as HTMLElement;
    act(() => {
      value.dispatchEvent(new MouseEvent("click", { bubbles: true, view: window }));
    });
    expect(selectFilterValue).toHaveBeenCalledTimes(1);
    const [event, filter] = selectFilterValue.mock.calls[0];
    expect(event).not.toBeNull();
    expect(event.target).toBe(value);
    expect(event.nativeEvent).toBeInstanceOf(MouseEvent);
    expect(filter.value).toBe("7d");
    act(() => root.unmount());
  });

  it.each(["withinLast", "olderThan"])(
    "%s persists normalized Nd/Nw/Nm/Ny tokens when amount and unit change",
    async (fn) => {
      const { root, container, savePredicate } = await mount(fn, "7d");
      const amount = container.querySelector(
        'input[aria-label="Relative date amount"]'
      ) as HTMLInputElement;
      const unit = container.querySelector(
        'select[aria-label="Relative date unit"]'
      ) as HTMLSelectElement;

      change(amount, "008");
      for (const expectedUnit of ["w", "m", "y", "d"]) {
        change(unit, expectedUnit);
      }

      expect(savePredicate.mock.calls.map(([update]) => update.filters[0].value)).toEqual([
        "8d",
        "8w",
        "8m",
        "8y",
        "8d",
      ]);
      act(() => root.unmount());
    }
  );

  it.each(["", "-1", "1.5"])(
    "does not persist invalid amount %j",
    async (invalidAmount) => {
      const { root, container, savePredicate } = await mount("withinLast", "7d");
      const amount = container.querySelector(
        'input[aria-label="Relative date amount"]'
      ) as HTMLInputElement;
      change(amount, invalidAmount);
      expect(savePredicate).not.toHaveBeenCalled();
      act(() => root.unmount());
    }
  );

  it("does not persist an unknown unit or silently rewrite a malformed stored token", async () => {
    const { root, container, savePredicate } = await mount("olderThan", "broken");
    const amount = container.querySelector(
      'input[aria-label="Relative date amount"]'
    ) as HTMLInputElement;
    const unit = container.querySelector(
      'select[aria-label="Relative date unit"]'
    ) as HTMLSelectElement;
    expect(amount.value).toBe("");
    expect(savePredicate).not.toHaveBeenCalled();
    change(unit, "x");
    expect(savePredicate).not.toHaveBeenCalled();
    act(() => root.unmount());
  });

  it.each(["dateBefore", "dateAfter", "isSameDate"])(
    "%s keeps the absolute-date picker and never renders the relative editor",
    async (fn) => {
      const { root, container } = await mount(fn, "2026-07-01");
      expect(
        container.querySelector('input[aria-label="Relative date amount"]')
      ).toBeNull();
      const value = Array.from(
        container.querySelectorAll(".mk-filter > span")
      ).find((span) => span.textContent === "2026-07-01") as HTMLElement;
      act(() => {
        value.dispatchEvent(new MouseEvent("click", { bubbles: true, view: window }));
      });
      expect(showDatePickerMenuMock).toHaveBeenCalledTimes(1);
      act(() => root.unmount());
      showDatePickerMenuMock.mockReset();
    }
  );
});
