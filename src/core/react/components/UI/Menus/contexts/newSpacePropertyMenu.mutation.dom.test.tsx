/** @jest-environment jsdom */
import React, { ReactElement } from "react";
import { act } from "react-dom/test-utils";
import { createRoot, Root } from "react-dom/client";

jest.mock("makemd-core", () => ({
  SelectOptionType: { Submenu: "submenu" },
}));
jest.mock("../menu/SelectionMenu", () => ({
  menuSeparator: { name: "separator", value: "separator" },
}));
jest.mock("./PropertyValue", () => ({
  PropertyValueComponent: (): ReactElement | null => null,
}));

import { defaultContextSchemaID } from "shared/schemas/context";
import { PathPropertyName } from "shared/types/context";
import { showNewPropertyMenu } from "./newSpacePropertyMenu";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
};

const table = {
  schema: { id: defaultContextSchemaID, name: "Files", type: "db" },
  cols: [{ name: PathPropertyName, type: "file", schemaId: defaultContextSchemaID }],
  rows: [{ [PathPropertyName]: "A.md" }],
};

describe("new property add-all mutation boundary", () => {
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
    jest.clearAllMocks();
  });

  const openAddAll = async (mutateTable: jest.Mock) => {
    let menu!: ReactElement;
    const reloadContextByPath = jest.fn().mockResolvedValue(true);
    const notify = jest.fn();
    const hide = jest.fn();
    const superstate = {
      settings: { fmKeyAlias: "aliases" },
      spacesIndex: new Map(),
      pathsIndex: new Map([
        ["A.md", { metadata: { property: { Status: "open" } } }],
      ]),
      spacesMap: { getInverse: () => ["A.md"] },
      spaceManager: {
        readTable: jest.fn().mockResolvedValue(table),
        mutateTable,
      },
      reloadContextByPath,
      ui: {
        getSticker: jest.fn(() => ""),
        notify,
        openCustomMenu: jest.fn((_rect, element: ReactElement) => {
          menu = element;
        }),
      },
    } as any;

    showNewPropertyMenu(superstate, {} as any, window, {
      spaces: [],
      fields: table.cols as any,
      schemaId: defaultContextSchemaID,
      contextPath: "Folder",
      saveField: jest.fn(() => true),
    });
    await act(async () => {
      root.render(React.cloneElement(menu, { hide }));
    });
    const addAll = container.querySelector(".mk-property-add-all") as HTMLElement;
    expect(addAll).not.toBeNull();
    act(() => addAll.click());
    await act(async () => { await Promise.resolve(); });

    return { hide, mutateTable, notify, reloadContextByPath };
  };

  it("waits for a successful table mutation before reloading the context", async () => {
    const mutation = deferred<boolean>();
    const state = await openAddAll(jest.fn(() => mutation.promise));

    expect(state.mutateTable).toHaveBeenCalledWith(
      "Folder",
      defaultContextSchemaID,
      expect.objectContaining({ kind: "merge", base: table }),
      true,
    );
    expect(state.reloadContextByPath).not.toHaveBeenCalled();
    expect(state.hide).toHaveBeenCalledTimes(1);

    await act(async () => mutation.resolve(true));

    expect(state.reloadContextByPath).toHaveBeenCalledTimes(1);
    expect(state.reloadContextByPath).toHaveBeenCalledWith("Folder", {
      force: true,
      calculate: true,
    });
    expect(state.notify).not.toHaveBeenCalled();
  });

  it("does not reload and reports once when the table mutation declines", async () => {
    const consoleError = jest.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const state = await openAddAll(jest.fn().mockResolvedValue(false));
      await act(async () => { await Promise.resolve(); });

      expect(state.reloadContextByPath).not.toHaveBeenCalled();
      expect(state.notify).toHaveBeenCalledTimes(1);
      expect(state.notify).toHaveBeenCalledWith(expect.stringContaining("add all properties"));
    } finally {
      consoleError.mockRestore();
    }
  });

  it("contains a rejected table mutation and reports it once without reloading", async () => {
    const consoleError = jest.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const state = await openAddAll(
        jest.fn().mockRejectedValue(new Error("database locked"))
      );
      await act(async () => { await Promise.resolve(); });

      expect(state.reloadContextByPath).not.toHaveBeenCalled();
      expect(state.notify).toHaveBeenCalledTimes(1);
      expect(state.notify).toHaveBeenCalledWith(expect.stringContaining("database locked"));
    } finally {
      consoleError.mockRestore();
    }
  });
});
