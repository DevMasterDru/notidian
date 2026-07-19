/**
 * @jest-environment jsdom
 */
import React from "react";
import { act } from "react-dom/test-utils";
import { createRoot } from "react-dom/client";

jest.mock("makemd-core", () => ({
  SelectOptionType: { Submenu: "submenu" },
}));
jest.mock("core/react/components/UI/Menus/menu/SelectionMenu", () => ({
  defaultMenu: (_ui: unknown, options: unknown[]) => ({ options }),
  menuInput: jest.fn(),
  menuSeparator: { name: "separator", value: "separator" },
}));
jest.mock("core/react/components/SpaceView/Contexts/DataTypeView/ObjectCell", () => ({
  ObjectCell: (): React.ReactElement | null => null,
}));
jest.mock("../contexts/PropertyValue", () => ({
  PropertyValueComponent: (): React.ReactElement | null => null,
}));
import { showSetValueMenu } from "./propertyMenu";
import { showNewPropertyMenu } from "../contexts/newSpacePropertyMenu";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const frequencyValues = (field: any): string[] =>
  JSON.parse(field.value).type.freq.value.options.map((option: any) => option.value);

describe("repeat template runtime routing", () => {
  it.each([
    [true, false],
    [false, true],
  ])(
    "property value authoring selects the strict=%s template",
    (dateScheduleAuthoring, expectsLegacyTokens) => {
      const openMenu = jest.fn();
      const addSpaceProperty = jest.fn();
      const superstate: any = {
        settings: { dateScheduleAuthoring },
        contextsIndex: new Map(),
        ui: { openMenu },
        spaceManager: { addSpaceProperty },
      };
      showSetValueMenu(
        {} as any,
        window,
        superstate,
        "",
        {
          name: "Property",
          type: "option",
          value: JSON.stringify({
            source: "$properties",
            sourceProps: { type: "object", typeName: "Repeat" },
          }),
        } as any,
        jest.fn(),
        "Events",
      );

      openMenu.mock.calls[0][1].saveOptions([], ["Repeat"], true);
      const values = frequencyValues(addSpaceProperty.mock.calls[0][1]);
      expect(values.includes("MINUTELY")).toBe(expectsLegacyTokens);
      expect(values.includes("SECONDLY")).toBe(expectsLegacyTokens);
    },
  );

  it.each([
    [true, false],
    [false, true],
  ])(
    "new-property special authoring selects the strict=%s template",
    async (dateScheduleAuthoring, expectsLegacyTokens) => {
      let menuElement: React.ReactElement;
      const openMenu = jest.fn();
      const saveField = jest.fn(() => true);
      const superstate: any = {
        settings: { dateScheduleAuthoring },
        spacesIndex: new Map(),
        pathsIndex: new Map(),
        spacesMap: { getInverse: (): string[] => [] },
        ui: {
          openCustomMenu: (_rect: unknown, element: React.ReactElement) => {
            menuElement = element;
          },
          openMenu,
          getSticker: () => "",
          notify: jest.fn(),
        },
      };
      showNewPropertyMenu(superstate, {} as any, window, {
        type: "text",
        spaces: [],
        fields: [],
        fileMetadata: true,
        contextPath: "$fm",
        saveField,
      });

      const onSubmenu = jest.fn((builder) => builder({} as any, jest.fn()));
      const container = document.createElement("div");
      document.body.appendChild(container);
      const root = createRoot(container);
      await act(async () => {
        root.render(React.cloneElement(menuElement!, { onSubmenu } as any));
      });
      const typeLabel = Array.from(container.querySelectorAll<HTMLElement>(".mk-menu-options-inner"))
        .find((element) => element.textContent === "Type")!;
      const typeRow = typeLabel.closest<HTMLElement>(".mk-menu-option")!;
      act(() => typeRow.click());
      const typeMenu = openMenu.mock.calls[0][1];
      const special = typeMenu.options.find((option: any) => option.value === "special");
      special.onSubmenu({} as any, jest.fn());
      const specialMenu = openMenu.mock.calls[1][1];
      act(() => specialMenu.options[0].onClick());

      const values = frequencyValues((saveField.mock.calls as any)[0][1]);
      expect(values.includes("MINUTELY")).toBe(expectsLegacyTokens);
      expect(values.includes("SECONDLY")).toBe(expectsLegacyTokens);
      act(() => root.unmount());
      container.remove();
    },
  );
});
