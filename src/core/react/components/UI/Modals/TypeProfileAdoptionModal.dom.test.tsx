/**
 * @jest-environment jsdom
 */
// jsdom regression coverage for the schema-adoption preview/confirm modal
// (Notidian-loan.3, ADR-0056 D9). The core guarantee under test: nothing is
// written unless the owner explicitly clicks "Adopt" — Cancel (or closing
// without clicking Adopt) must never invoke onConfirm.

import React from "react";
import { act } from "react-dom/test-utils";
import { createRoot, Root } from "react-dom/client";
import { TypeProfileAdoptionDraft } from "core/utils/contexts/typeProfileAdopt";
import { TypeProfileAdoptionModal } from "./TypeProfileAdoptionModal";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const draftWithFields = (): TypeProfileAdoptionDraft => ({
  database: "Gidi/Hardware/Sensor Registry",
  rowCount: 5,
  alreadyDeclaredFieldNames: ["sensor_id"],
  fields: [
    {
      field: {
        name: "sensor_class",
        kind: "text",
        type: "text",
        enum: { values: ["temperature", "humidity"], strict: false },
      },
      enumCandidate: {
        values: ["temperature", "humidity"],
        presentCount: 5,
        distinctCount: 2,
      },
      foreignKeyCandidates: [
        {
          targetFolder: "Gidi/Hardware/Board Registry",
          targetKey: "board_id",
          overlapCount: 2,
          candidateCount: 2,
          overlapRatio: 1,
        },
      ],
      emptyEncoding: { absentCount: 3, emptyStringCount: 0, presentCount: 2, suggested: "absent" },
    },
  ],
});

const emptyDraft = (): TypeProfileAdoptionDraft => ({
  database: "Gidi/Hardware/Sensor Registry",
  rowCount: 5,
  alreadyDeclaredFieldNames: ["sensor_id", "sensor_class"],
  fields: [],
});

describe("TypeProfileAdoptionModal", () => {
  let root: Root;
  let container: HTMLElement;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("renders the drafted field, its enum/FK/empty-policy suggestions, and does not confirm until clicked", () => {
    const onConfirm = jest.fn();
    const hide = jest.fn();
    act(() => {
      root.render(
        <TypeProfileAdoptionModal
          draft={draftWithFields()}
          onConfirm={onConfirm}
          hide={hide}
        />
      );
    });

    expect(container.textContent).toContain("sensor_class");
    expect(container.textContent).toContain("temperature, humidity");
    expect(container.textContent).toContain("Gidi/Hardware/Board Registry");
    expect(container.textContent).toContain("absent");
    expect(onConfirm).not.toHaveBeenCalled();

    const confirmButton = Array.from(
      container.querySelectorAll("button")
    ).find((b) => b.textContent?.includes("Adopt"));
    expect(confirmButton).toBeTruthy();

    act(() => {
      confirmButton!.dispatchEvent(
        new MouseEvent("click", { bubbles: true })
      );
    });

    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(hide).toHaveBeenCalledTimes(1);
  });

  it("Cancel never calls onConfirm", () => {
    const onConfirm = jest.fn();
    const hide = jest.fn();
    act(() => {
      root.render(
        <TypeProfileAdoptionModal
          draft={draftWithFields()}
          onConfirm={onConfirm}
          hide={hide}
        />
      );
    });

    const cancelButton = Array.from(
      container.querySelectorAll("button")
    ).find((b) => b.textContent?.includes("Cancel"));
    expect(cancelButton).toBeTruthy();

    act(() => {
      cancelButton!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(onConfirm).not.toHaveBeenCalled();
    expect(hide).toHaveBeenCalledTimes(1);
  });

  it("offers no Adopt action and never calls onConfirm when the draft has zero fields", () => {
    const onConfirm = jest.fn();
    act(() => {
      root.render(
        <TypeProfileAdoptionModal draft={emptyDraft()} onConfirm={onConfirm} />
      );
    });

    expect(container.textContent).toContain("Nothing to adopt");
    const adoptButton = Array.from(
      container.querySelectorAll("button")
    ).find((b) => b.textContent?.includes("Adopt"));
    expect(adoptButton).toBeUndefined();
    expect(onConfirm).not.toHaveBeenCalled();
  });
});
