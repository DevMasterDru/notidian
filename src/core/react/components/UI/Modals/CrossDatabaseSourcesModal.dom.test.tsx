/** @jest-environment jsdom */
import React from "react";
import { act } from "react-dom/test-utils";
import { createRoot } from "react-dom/client";
import { CrossDatabaseSourcesModal } from "./CrossDatabaseSourcesModal";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const change = (element: HTMLInputElement | HTMLTextAreaElement, value: string) => {
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(
      Object.getPrototypeOf(element),
      "value"
    )?.set;
    setter?.call(element, value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
  });
};

describe("CrossDatabaseSourcesModal", () => {
  it("adds a source, edits shared-field mappings, and emits normalized definitions", () => {
    const onSave = jest.fn();
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    act(() => {
      root.render(
        <CrossDatabaseSourcesModal
          sources={[
            {
              context: "Routines",
              db: "files",
              label: "Routines",
              fields: { priority: "priority_num" },
            },
          ]}
          contexts={[
            {
              path: "Routines",
              name: "Routines",
              schemas: [{ id: "files", name: "Items" }],
            },
            {
              path: "Events",
              name: "Events",
              schemas: [{ id: "files", name: "Items" }],
            },
          ]}
          onSave={onSave}
        />
      );
    });

    const add = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent == "Add source"
    ) as HTMLButtonElement;
    act(() => add.click());

    const contexts = container.querySelectorAll<HTMLInputElement>(
      'input[aria-label$="context"]'
    );
    const mappings = container.querySelectorAll<HTMLTextAreaElement>(
      'textarea[aria-label$="field mappings"]'
    );
    change(contexts[1], " Events ");
    change(mappings[1], "priority = importance\nstatus = state\ninvalid");

    const save = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent == "Save sources"
    ) as HTMLButtonElement;
    act(() => save.click());

    expect(onSave).toHaveBeenCalledWith([
      {
        context: "Routines",
        db: "files",
        label: "Routines",
        fields: { priority: "priority_num" },
      },
      {
        context: "Events",
        db: "files",
        label: "Events",
        fields: { priority: "importance", status: "state" },
      },
    ]);

    act(() => root.unmount());
    container.remove();
  });

  it("requires at least two valid sources before save", () => {
    const onSave = jest.fn();
    const container = document.createElement("div");
    const root = createRoot(container);
    act(() => {
      root.render(
        <CrossDatabaseSourcesModal
          sources={[]}
          contexts={[]}
          onSave={onSave}
        />
      );
    });

    const save = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent == "Save sources"
    ) as HTMLButtonElement;
    expect(save.disabled).toBe(true);

    act(() => root.unmount());
  });
});
