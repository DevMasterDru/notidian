/** @jest-environment jsdom */
import React from "react";
import { act } from "react-dom/test-utils";
import { createRoot } from "react-dom/client";
import {
  buildCrossDatabaseSourceContextOptions,
  CrossDatabaseSourcesModal,
} from "./CrossDatabaseSourcesModal";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const change = (
  element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement,
  value: string
) => {
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
  it("derives real per-schema filter fields from the context cache", () => {
    expect(
      buildCrossDatabaseSourceContextOptions(
        new Map([
          [
            "Routines",
            {
              schemas: [{ id: "files", name: "Items" }],
              mdb: {
                files: {
                  cols: [
                    { name: "status", type: "text" },
                    { name: "priority_num", type: "number" },
                  ],
                },
              },
            },
          ],
        ]),
        new Map([["Routines", { name: "Daily Routines" }]])
      )
    ).toEqual([
      {
        path: "Routines",
        name: "Daily Routines",
        schemas: [
          {
            id: "files",
            name: "Items",
            fields: [
              { name: "status", type: "text" },
              { name: "priority_num", type: "number" },
            ],
          },
        ],
      },
    ]);
  });

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
              schemas: [
                {
                  id: "files",
                  name: "Items",
                  fields: [{ name: "priority_num", type: "number" }],
                },
              ],
            },
            {
              path: "Events",
              name: "Events",
              schemas: [
                {
                  id: "files",
                  name: "Items",
                  fields: [{ name: "importance", type: "number" }],
                },
              ],
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

  it("loads, edits, adds, and removes native filters before saving normalized objects", () => {
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
              filters: [
                { field: "status", fn: "is", value: "active", fType: "text" },
              ],
            },
            {
              context: "Events",
              db: "files",
              label: "Events",
              fields: { priority: "importance" },
            },
          ]}
          contexts={[
            {
              path: "Routines",
              name: "Routines",
              schemas: [
                {
                  id: "files",
                  name: "Items",
                  fields: [
                    { name: "status", type: "text" },
                    { name: "priority_num", type: "number" },
                  ],
                },
              ],
            },
            {
              path: "Events",
              name: "Events",
              schemas: [
                {
                  id: "files",
                  name: "Items",
                  fields: [{ name: "importance", type: "number" }],
                },
              ],
            },
          ]}
          onSave={onSave}
        />
      );
    });

    const existingField = container.querySelector<HTMLSelectElement>(
      '[aria-label="Source 1 filter 1 field"]'
    )!;
    const existingOperator = container.querySelector<HTMLSelectElement>(
      '[aria-label="Source 1 filter 1 operator"]'
    )!;
    const existingValue = container.querySelector<HTMLInputElement>(
      '[aria-label="Source 1 filter 1 value"]'
    )!;
    expect(existingField.value).toBe("status");
    expect(existingOperator.value).toBe("is");
    expect(existingValue.value).toBe("active");

    const add = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent == "Add filter" && button.closest("section")?.querySelector("strong")?.textContent == "Source 1"
    ) as HTMLButtonElement;
    act(() => add.click());

    const fields = container.querySelectorAll<HTMLSelectElement>(
      '[aria-label^="Source 1 filter"][aria-label$="field"]'
    );
    change(fields[1], "priority_num");
    change(
      container.querySelector<HTMLSelectElement>(
        '[aria-label="Source 1 filter 2 operator"]'
      )!,
      "isGreatThan"
    );
    change(
      container.querySelector<HTMLInputElement>(
        '[aria-label="Source 1 filter 2 value"]'
      )!,
      "2"
    );

    const remove = container.querySelector<HTMLButtonElement>(
      '[aria-label="Remove source 1 filter 1"]'
    )!;
    act(() => remove.click());

    const save = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent == "Save sources"
    ) as HTMLButtonElement;
    expect(save.disabled).toBe(false);
    act(() => save.click());

    expect(onSave).toHaveBeenCalledWith([
      {
        context: "Routines",
        db: "files",
        label: "Routines",
        fields: { priority: "priority_num" },
        filters: [
          {
            field: "priority_num",
            fn: "isGreatThan",
            value: "2",
            fType: "number",
          },
        ],
      },
      {
        context: "Events",
        db: "files",
        label: "Events",
        fields: { priority: "importance" },
      },
    ]);

    act(() => root.unmount());
    container.remove();
  });

  it("blocks save when a configured filter is not valid for the selected source schema", () => {
    const onSave = jest.fn();
    const container = document.createElement("div");
    const root = createRoot(container);
    act(() => {
      root.render(
        <CrossDatabaseSourcesModal
          sources={[
            {
              context: "Routines",
              db: "files",
              fields: {},
              filters: [
                {
                  field: "missing",
                  fn: "futureOperator",
                  value: "active",
                  fType: "text",
                },
              ],
            },
            { context: "Events", db: "files", fields: {} },
          ]}
          contexts={[
            {
              path: "Routines",
              name: "Routines",
              schemas: [
                {
                  id: "files",
                  name: "Items",
                  fields: [{ name: "status", type: "text" }],
                },
              ],
            },
            {
              path: "Events",
              name: "Events",
              schemas: [
                {
                  id: "files",
                  name: "Items",
                  fields: [{ name: "importance", type: "number" }],
                },
              ],
            },
          ]}
          onSave={onSave}
        />
      );
    });

    const save = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent == "Save sources"
    ) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    act(() => save.click());
    expect(onSave).not.toHaveBeenCalled();

    act(() => root.unmount());
  });
});
