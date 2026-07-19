/**
 * @jest-environment jsdom
 */
import React from "react";
import { act } from "react-dom/test-utils";
import { createRoot, Root } from "react-dom/client";
import * as datePickerModule from "./datePickerMenu";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const DateScheduleEditor = (datePickerModule as any).DateScheduleEditor;
const DatePicker = (datePickerModule as any).DatePicker;
const dateScheduleBindingForRow =
  (datePickerModule as any).dateScheduleBindingForRow;

describe("date picker default", () => {
  it("keeps an existing due date instead of replacing it with now", () => {
    const existing = new Date("2026-07-19T09:00:00Z");
    const now = new Date("2026-08-01T12:00:00Z");
    expect(
      (datePickerModule as any).datePickerDefaultDate(existing, true, now),
    ).toBe(existing);
  });
});

describe("DateScheduleEditor accessibility and authoring", () => {
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

  const renderEditor = async (overrides: Record<string, unknown> = {}) => {
    const onSave = jest.fn(async () => ({ ok: true }));
    await act(async () => {
      root.render(
        React.createElement(DateScheduleEditor, {
          due: new Date("2026-07-19T09:00:00Z"),
          repeat: { freq: "DAILY", interval: 1 },
          reminder: { before: "PT30M" },
          dateRemindersEnabled: false,
          onSave,
          ...overrides,
        }),
      );
    });
    return onSave;
  };

  it("uses native real-button activation without a duplicate keydown action", async () => {
    await renderEditor();
    const frequencyButtons = Array.from(
      container.querySelectorAll<HTMLButtonElement>("[data-schedule-frequency]"),
    );

    expect(frequencyButtons.map((button) => button.textContent)).toEqual([
      "Daily",
      "Weekly",
      "Monthly",
      "Yearly",
      "Hourly",
    ]);
    expect(frequencyButtons.every((button) => button.tagName === "BUTTON")).toBe(true);
    expect(container.textContent).not.toContain("Minutely");
    expect(container.textContent).not.toContain("Secondly");

    const weekly = frequencyButtons[1];
    act(() => weekly.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
    expect(weekly.getAttribute("aria-pressed")).toBe("false");
    act(() => weekly.click());
    expect(weekly.getAttribute("aria-pressed")).toBe("true");

    const monday = container.querySelector<HTMLButtonElement>(
      '[data-schedule-weekday="MO"]',
    )!;
    act(() => {
      monday.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true }));
      monday.click();
    });
    expect(monday.getAttribute("aria-pressed")).toBe("true");
  });

  it("announces that delivery is disabled while still allowing reminder authoring", async () => {
    await renderEditor();
    const status = container.querySelector('[role="status"]');
    expect(status?.textContent).toMatch(/delivery is off/i);
    expect(container.querySelector<HTMLInputElement>('[aria-label="Reminder before"]')?.value).toBe("PT30M");
  });

  it("surfaces invalid rules through an accessible error and does not save", async () => {
    const onSave = await renderEditor();
    const interval = container.querySelector<HTMLInputElement>('[aria-label="Repeat interval"]')!;
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!
        .set!.call(interval, "0");
      interval.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => container.querySelector<HTMLButtonElement>('[data-schedule-save]')!.click());

    expect(container.querySelector('[role="alert"]')?.textContent).toMatch(/positive integer/i);
    expect(onSave).not.toHaveBeenCalled();
  });

  it("emits canonical mappings from the shared editor", async () => {
    const onSave = await renderEditor({ dateRemindersEnabled: true });
    act(() => {
      container.querySelector<HTMLButtonElement>('[data-schedule-frequency="WEEKLY"]')!.click();
    });
    act(() => {
      container.querySelector<HTMLButtonElement>('[data-schedule-weekday="MO"]')!.click();
    });
    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-schedule-save]')!.click();
    });

    expect(onSave).toHaveBeenCalledWith({
      due: new Date("2026-07-19T09:00:00Z"),
      repeat: { freq: "WEEKLY", interval: 1, byweekday: ["MO"] },
      reminder: { before: "PT30M" },
    });
  });
});

describe("date schedule row binding", () => {
  it("authors the first schedule into a Markdown file with no frontmatter object", async () => {
    const saveProperties = jest.fn(async () => true);
    const pathState = { metadata: {} };
    const superstate: any = {
      settings: { dateReminders: false },
      pathsIndex: new Map([["Events/A.md", pathState]]),
      spaceManager: { saveProperties },
      ui: { notify: jest.fn(), getSticker: () => "" },
    };
    superstate.ui.superstate = superstate;
    const binding = dateScheduleBindingForRow({
      superstate,
      row: { _path: "Events/A.md", due: "", repeat: "", reminder: "" },
      path: "Events/A.md",
      due: new Date("2026-07-19T09:00:00Z"),
    });

    const result = await binding.onSave({
      due: new Date("2026-07-19T09:00:00Z"),
      repeat: { freq: "DAILY", interval: 1 },
      reminder: { before: "PT30M" },
    });

    expect(result).toEqual({ ok: true });
    expect(saveProperties).toHaveBeenCalledWith("Events/A.md", {
      due: "2026-07-19T09:00:00.000Z",
      repeat: { freq: "DAILY", interval: 1 },
      reminder: { before: "PT30M" },
    });
  });

  it("uses a newer canonical due for the opened editor and repeat-only save", async () => {
    const saveProperties = jest.fn(async () => true);
    const canonicalDue = "2026-07-20T11:00:00";
    const staleProjectedDue = "2026-07-19T09:00:00";
    const property: Record<string, unknown> = {
      due: canonicalDue,
      repeat: { freq: "DAILY", interval: 1 },
      reminder: null,
    };
    const superstate: any = {
      settings: { dateReminders: true },
      pathsIndex: new Map([
        ["Events/A.md", { metadata: { property } }],
      ]),
      spaceManager: { saveProperties },
      ui: { notify: jest.fn(), getSticker: () => "" },
    };
    superstate.ui.superstate = superstate;
    const binding = dateScheduleBindingForRow({
      superstate,
      row: { _path: "Events/A.md", due: staleProjectedDue },
      path: "Events/A.md",
      due: staleProjectedDue,
    });

    expect(binding.due).toEqual(new Date(canonicalDue));

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(
        <DatePicker
          ui={superstate.ui}
          value={new Date(staleProjectedDue)}
          setValue={jest.fn()}
          time={(datePickerModule as any).DatePickerTimeMode.Toggle}
          schedule={binding}
        />,
      );
    });
    await act(async () => {
      container.querySelector<HTMLButtonElement>("[data-schedule-save]")!.click();
    });

    expect(saveProperties).toHaveBeenCalledWith(
      "Events/A.md",
      expect.objectContaining({ due: canonicalDue }),
    );
    act(() => root.unmount());
    container.remove();
  });

  it("commits through the frontmatter writer only and never touches an MDB", async () => {
    const saveProperties = jest.fn(async () => true);
    const saveDB = jest.fn();
    const current = {
      due: "2026-07-19T09:00:00Z",
      repeat: { freq: "DAILY", interval: 1 },
      reminder: { before: "PT30M" },
    };
    const superstate: any = {
      settings: { dateReminders: false },
      pathsIndex: new Map([
        ["Events/A.md", { metadata: { property: current } }],
      ]),
      spaceManager: { saveProperties, saveDB },
      ui: { notify: jest.fn() },
    };
    const binding = dateScheduleBindingForRow({
      superstate,
      row: { _path: "Events/A.md", ...current },
      path: "Events/A.md",
      due: current.due,
    });

    await expect(
      binding.onSave({
        due: new Date("2026-07-20T09:00:00Z"),
        repeat: { freq: "WEEKLY", interval: 1 },
        reminder: { before: "PT1H" },
      }),
    ).resolves.toEqual({ ok: true });
    expect(saveProperties).toHaveBeenCalledWith("Events/A.md", {
      due: "2026-07-20T09:00:00.000Z",
      repeat: { freq: "WEEKLY", interval: 1 },
      reminder: { before: "PT1H" },
    });
    expect(saveDB).not.toHaveBeenCalled();
  });

  it("detects a frontmatter change that occurs after the editor opens", async () => {
    const saveProperties = jest.fn(async () => true);
    const state: any = {
      metadata: {
        property: {
          due: "2026-07-19T09:00:00Z",
          repeat: { freq: "DAILY", interval: 1 },
          reminder: undefined,
        },
      },
    };
    const superstate: any = {
      settings: {},
      pathsIndex: new Map([["Events/A.md", state]]),
      spaceManager: { saveProperties },
      ui: { notify: jest.fn() },
    };
    const binding = dateScheduleBindingForRow({
      superstate,
      row: { _path: "Events/A.md", ...state.metadata.property },
      path: "Events/A.md",
      due: state.metadata.property.due,
    });
    state.metadata.property.repeat = { freq: "MONTHLY", interval: 1 };

    const result = await binding.onSave({
      due: new Date("2026-07-20T09:00:00Z"),
      repeat: { freq: "WEEKLY", interval: 1 },
      reminder: null,
    });
    expect(result).toMatchObject({ ok: false, conflict: true });
    expect(saveProperties).not.toHaveBeenCalled();
  });

  it("detects an in-place schedule mapping mutation after the editor opens", async () => {
    const saveProperties = jest.fn(async () => true);
    const repeat = { freq: "DAILY", interval: 1 };
    const reminder = { before: "PT30M" };
    const property = {
      due: "2026-07-19T09:00:00Z",
      repeat,
      reminder,
    };
    const superstate: any = {
      settings: {},
      pathsIndex: new Map([
        ["Events/A.md", { metadata: { property } }],
      ]),
      spaceManager: { saveProperties },
      ui: { notify: jest.fn() },
    };
    const binding = dateScheduleBindingForRow({
      superstate,
      row: { _path: "Events/A.md", ...property },
      path: "Events/A.md",
      due: property.due,
    });

    repeat.interval = 2;
    reminder.before = "PT1H";

    const result = await binding.onSave({
      due: new Date("2026-07-20T09:00:00Z"),
      repeat: { freq: "WEEKLY", interval: 1 },
      reminder: null,
    });

    expect(result).toMatchObject({ ok: false, conflict: true });
    expect(saveProperties).not.toHaveBeenCalled();
  });

  it("allows a legacy row without canonical due to create due on its first save", async () => {
    const saveProperties = jest.fn(async () => true);
    const property = { legacyDate: "2026-07-19T09:00:00" };
    const superstate: any = {
      settings: {},
      pathsIndex: new Map([
        ["Events/A.md", { metadata: { property } }],
      ]),
      spaceManager: { saveProperties },
      ui: { notify: jest.fn() },
    };
    const binding = dateScheduleBindingForRow({
      superstate,
      row: { _path: "Events/A.md", ...property },
      path: "Events/A.md",
      due: property.legacyDate,
    });

    await expect(
      binding.onSave({
        due: new Date(2026, 6, 19, 9),
        repeat: null,
        reminder: null,
      }),
    ).resolves.toEqual({ ok: true });
    expect(saveProperties).toHaveBeenCalledWith(
      "Events/A.md",
      expect.objectContaining({ due: "2026-07-19T09:00:00" }),
    );
  });

  it("keeps explicit canonical null repeat and reminder authoritative over legacy row values", () => {
    const property: Record<string, unknown> = {
      due: "2026-07-19",
      repeat: null,
      reminder: null,
    };
    const superstate: any = {
      settings: {},
      pathsIndex: new Map([
        ["Events/A.md", { metadata: { property } }],
      ]),
    };
    const binding = dateScheduleBindingForRow({
      superstate,
      row: {
        _path: "Events/A.md",
        repeat: { freq: "DAILY", interval: 1 },
        reminder: { before: "PT30M" },
      },
      path: "Events/A.md",
      due: property.due,
    });

    expect(binding.repeat).toBeNull();
    expect(binding.reminder).toBeNull();
  });

  it("keeps explicit canonical null due authoritative over a stale projected due", () => {
    const superstate: any = {
      settings: {},
      pathsIndex: new Map([
        ["Events/A.md", { metadata: { property: { due: null } } }],
      ]),
    };
    const binding = dateScheduleBindingForRow({
      superstate,
      row: { _path: "Events/A.md", due: "2026-07-19T09:00:00" },
      path: "Events/A.md",
      due: "2026-07-19T09:00:00",
    });

    expect(binding.due).toBeNull();
  });

  it("falls back to legacy row repeat and reminder only when canonical keys are absent", () => {
    const property = { due: "2026-07-19" };
    const legacyRepeat = { freq: "DAILY", interval: 1 };
    const legacyReminder = { before: "PT30M" };
    const superstate: any = {
      settings: {},
      pathsIndex: new Map([
        ["Events/A.md", { metadata: { property } }],
      ]),
    };
    const binding = dateScheduleBindingForRow({
      superstate,
      row: {
        _path: "Events/A.md",
        repeat: legacyRepeat,
        reminder: legacyReminder,
      },
      path: "Events/A.md",
      due: property.due,
    });

    expect(binding.repeat).toEqual(legacyRepeat);
    expect(binding.reminder).toEqual(legacyReminder);
  });
});
