/** @jest-environment jsdom */
import React from "react";
import { act } from "react-dom/test-utils";
import { createRoot, Root } from "react-dom/client";
import { ConfirmationModal } from "./ConfirmationModal";
import { runBulkAsync } from "shared/utils/asyncContracts";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const deferred = () => {
  let resolve!: () => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<void>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
};

describe("ConfirmationModal async confirmation", () => {
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

  it("allows exactly one in-flight click or Enter and hides only after success", async () => {
    const gate = deferred();
    const confirmAction = jest.fn(() => gate.promise);
    const hide = jest.fn();
    await act(async () => root.render(<ConfirmationModal
      message="Confirm" confirmLabel="Go" confirmAction={confirmAction} hide={hide} reportError={jest.fn()}
    />));
    const confirm = container.querySelector("button.mod-warning") as HTMLButtonElement;

    act(() => {
      confirm.click();
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
      confirm.click();
    });
    expect(confirmAction).toHaveBeenCalledTimes(1);
    expect(confirm.disabled).toBe(true);
    expect(hide).not.toHaveBeenCalled();

    await act(async () => gate.resolve());
    expect(hide).toHaveBeenCalledTimes(1);
  });

  it("reports failure, stays open, and permits one later retry", async () => {
    const reportError = jest.fn();
    const hide = jest.fn();
    const confirmAction = jest.fn()
      .mockRejectedValueOnce(new Error("failed"))
      .mockResolvedValueOnce(undefined);
    await act(async () => root.render(<ConfirmationModal
      message="Confirm" confirmLabel="Go" confirmAction={confirmAction} hide={hide} reportError={reportError}
    />));
    const confirm = container.querySelector("button.mod-warning") as HTMLButtonElement;

    await act(async () => confirm.click());
    expect(reportError).toHaveBeenCalledWith(expect.objectContaining({ message: "failed" }));
    expect(hide).not.toHaveBeenCalled();
    expect(confirm.disabled).toBe(false);

    await act(async () => confirm.click());
    expect(confirmAction).toHaveBeenCalledTimes(2);
    expect(hide).toHaveBeenCalledTimes(1);
  });

  it("stays open when a destructive bulk action only partially succeeds", async () => {
    const reportError = jest.fn();
    const obsoleteSideChannelReport = jest.fn();
    const hide = jest.fn();
    const completed: string[] = [];
    await act(async () => root.render(<ConfirmationModal
      message="Delete all" confirmLabel="Delete"
      confirmAction={() => (runBulkAsync as any)(["A", "B", "C"], async (value: string) => {
        completed.push(value);
        if (value === "B") throw new Error("B failed");
      }, obsoleteSideChannelReport)}
      hide={hide}
      reportError={reportError}
    />));

    await act(async () => (container.querySelector("button.mod-warning") as HTMLButtonElement).click());

    expect(completed).toEqual(["A", "B", "C"]);
    expect(obsoleteSideChannelReport).not.toHaveBeenCalled();
    expect(hide).not.toHaveBeenCalled();
    expect(reportError).toHaveBeenCalledWith(expect.objectContaining({
      name: "AggregateError",
      errors: [expect.objectContaining({ message: "B failed" })],
    }));
  });
});
