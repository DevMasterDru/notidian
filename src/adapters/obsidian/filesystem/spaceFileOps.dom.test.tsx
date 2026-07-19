/** @jest-environment jsdom */
import React, { ReactElement } from "react";
import { act } from "react-dom/test-utils";
import { createRoot, Root } from "react-dom/client";

jest.mock("main", () => ({ __esModule: true, default: class MakeMDPlugin {} }));
jest.mock("core/spaceManager/filesystemAdapter/spaces", () => ({
  retrieveAllRecursiveChildren: jest.fn(),
}));
jest.mock("shared/utils/dom", () => ({ windowFromDocument: jest.fn(() => window) }));

import { retrieveAllRecursiveChildren } from "core/spaceManager/filesystemAdapter/spaces";
import { deleteSpaceFiles } from "./spaceFileOps";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
};

describe("deleteSpaceFiles confirmation boundary", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    (retrieveAllRecursiveChildren as jest.Mock).mockReturnValue([
      { name: "Data", folder: "true", path: "One/Data" },
      { name: "Data", folder: "true", path: "Two/Data" },
      { name: "Other", folder: "true", path: "Three/Other" },
    ]);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    jest.clearAllMocks();
  });

  const openConfirmation = async (deletePath: jest.Mock) => {
    let confirmation!: ReactElement;
    const notify = jest.fn();
    const hide = jest.fn();
    const plugin = {
      obsidianAdapter: { vaultDBCache: new Map() },
      superstate: {
        settings: { spaceSubFolder: "Data", spacesFolder: "Spaces" },
        spaceManager: { deletePath },
        ui: {
          notify,
          openModal: jest.fn((_title: string, element: ReactElement) => {
            confirmation = element;
          }),
        },
      },
    } as any;

    await deleteSpaceFiles(plugin, document);
    await act(async () => {
      root.render(React.cloneElement(confirmation, { hide }));
    });
    return {
      confirm: container.querySelector("button.mod-warning") as HTMLButtonElement,
      hide,
      notify,
    };
  };

  it("waits for every selected deletion before reporting one aggregate failure", async () => {
    const later = deferred();
    const deletePath = jest.fn((path: string) => {
      if (path === "One/Data") return Promise.reject(new Error("first failed"));
      return later.promise;
    });
    const { confirm, hide, notify } = await openConfirmation(deletePath);

    act(() => confirm.click());
    await act(async () => { await Promise.resolve(); });

    expect(deletePath.mock.calls.map(([path]) => path)).toEqual(["One/Data", "Two/Data"]);
    expect(confirm.disabled).toBe(true);
    expect(hide).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();

    await act(async () => later.resolve());

    expect(confirm.disabled).toBe(false);
    expect(hide).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith(expect.stringContaining("AggregateError"));
    expect(notify).not.toHaveBeenCalledWith("All space files have been deleted.");
  });

  it("reports success once and hides only after every selected deletion succeeds", async () => {
    const later = deferred();
    const deletePath = jest.fn((path: string) =>
      path === "One/Data" ? Promise.resolve() : later.promise
    );
    const { confirm, hide, notify } = await openConfirmation(deletePath);

    act(() => confirm.click());
    await act(async () => { await Promise.resolve(); });

    expect(confirm.disabled).toBe(true);
    expect(hide).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();

    await act(async () => later.resolve());

    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith("All space files have been deleted.");
    expect(hide).toHaveBeenCalledTimes(1);
  });
});
