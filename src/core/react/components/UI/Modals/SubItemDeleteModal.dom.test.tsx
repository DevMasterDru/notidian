/** @jest-environment jsdom */
import React from "react";
import { act } from "react-dom/test-utils";
import { createRoot, Root } from "react-dom/client";
import { buildRowTree } from "core/utils/contexts/tableRowTree";
import { SubItemDeleteModal } from "./SubItemDeleteModal";

jest.mock("makemd-core", () => ({}));
jest.mock("core/superstate/utils/path", () => ({
  deletePath: jest.fn(),
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { deletePath } = require("core/superstate/utils/path");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const {
  requestRowDeleteWithSubItems,
} = require("core/utils/contexts/nonDestructiveDelete");

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const deferred = () => {
  let resolve!: () => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<void>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
};

describe("SubItemDeleteModal async deletion boundary", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    (deletePath as jest.Mock).mockReset();
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("keeps a failed delete-only action open and permits a successful retry", async () => {
    const reportError = jest.fn();
    const hide = jest.fn();
    const deleteOnly = jest
      .fn()
      .mockRejectedValueOnce(new Error("parent locked"))
      .mockResolvedValueOnce(undefined);

    await act(async () =>
      root.render(
        <SubItemDeleteModal
          deleteOnly={deleteOnly}
          deleteRecursive={jest.fn()}
          subItemCount={2}
          hide={hide}
          reportError={reportError}
        />
      )
    );
    const deleteOnlyButton = container.querySelector(
      "button:not(.mod-warning)"
    ) as HTMLButtonElement;

    await act(async () => deleteOnlyButton.click());
    expect(reportError).toHaveBeenCalledTimes(1);
    expect(reportError).toHaveBeenCalledWith(
      expect.objectContaining({ message: "parent locked" })
    );
    expect(hide).not.toHaveBeenCalled();
    expect(deleteOnlyButton.disabled).toBe(false);

    await act(async () => deleteOnlyButton.click());
    expect(deleteOnly).toHaveBeenCalledTimes(2);
    expect(reportError).toHaveBeenCalledTimes(1);
    expect(hide).toHaveBeenCalledTimes(1);
  });

  it("allows only one concurrent click or Enter action and keeps Enter delete-only", async () => {
    const gate = deferred();
    const deleteRecursive = jest.fn(() => gate.promise);
    const deleteOnly = jest.fn();
    const hide = jest.fn();

    await act(async () =>
      root.render(
        <SubItemDeleteModal
          deleteOnly={deleteOnly}
          deleteRecursive={deleteRecursive}
          subItemCount={2}
          hide={hide}
          reportError={jest.fn()}
        />
      )
    );
    const recursiveButton = container.querySelector(
      "button.mod-warning"
    ) as HTMLButtonElement;

    act(() => {
      recursiveButton.click();
      window.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true })
      );
      recursiveButton.click();
    });

    expect(deleteRecursive).toHaveBeenCalledTimes(1);
    expect(deleteOnly).not.toHaveBeenCalled();
    expect(recursiveButton.disabled).toBe(true);
    expect(hide).not.toHaveBeenCalled();

    await act(async () => gate.resolve());
    expect(hide).toHaveBeenCalledTimes(1);
  });

  it("reports one recursive aggregate from requestRowDeleteWithSubItems and stays open", async () => {
    const rows = [
      { File: "Parent", parent: "" },
      { File: "Child A", parent: "[[Parent]]" },
      { File: "Child B", parent: "[[Parent]]" },
    ];
    const treeNodes = buildRowTree({
      rows,
      parentKey: "parent",
      pathKey: "File",
    });
    (deletePath as jest.Mock).mockRejectedValue(new Error("child locked"));
    const captures: React.ReactElement[] = [];
    const reportError = jest.fn();
    const hide = jest.fn();
    const superstate = {
      ui: {
        openModal: (_title: string, element: React.ReactElement) => {
          captures.push(element);
        },
        notify: jest.fn(),
      },
    };

    requestRowDeleteWithSubItems({
      superstate,
      rootPath: "Parent",
      subItemsDelete: { treeNodes, isPrimarySurface: true },
      deleteSelf: jest.fn().mockRejectedValue(new Error("parent locked")),
      reportError,
      win: window,
    });

    await act(async () =>
      root.render(React.cloneElement(captures[0], { hide }))
    );
    const recursiveButton = container.querySelector(
      "button.mod-warning"
    ) as HTMLButtonElement;
    await act(async () => recursiveButton.click());

    expect(reportError).toHaveBeenCalledTimes(1);
    expect(reportError.mock.calls[0][0]).toContain("Parent");
    expect(reportError.mock.calls[0][0]).toContain("3 operations failed");
    expect(hide).not.toHaveBeenCalled();
    expect(recursiveButton.disabled).toBe(false);
  });
});
