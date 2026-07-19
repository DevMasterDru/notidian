/**
 * @jest-environment jsdom
 */
import React from "react";
import { act } from "react-dom/test-utils";
import { createRoot, Root } from "react-dom/client";

jest.mock("@dnd-kit/core", () => ({
  defaultDropAnimation: {},
  DragOverlay: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  useDndMonitor: jest.fn(),
  useDroppable: () => ({ setNodeRef: jest.fn() }),
}));
jest.mock("core/react/context/ContextEditorContext", () => ({
  ContextEditorContext: React.createContext({ source: "Events", dbSchema: {} }),
}));
jest.mock("core/react/components/UI/Menus/properties/propertyMenu", () => ({
  showSetValueMenu: jest.fn(),
}));
jest.mock("core/react/components/UI/Menus/properties/datePickerMenu", () => ({
  DatePickerTimeMode: { Toggle: "toggle" },
  dateScheduleBindingForRow: jest.fn(),
  showDatePickerMenu: jest.fn(),
}));
jest.mock("./CalendarHeaderView", () => ({
  CalendarHeaderView: (): React.ReactElement | null => null,
}));
jest.mock("./WeekView/AllDayItem", () => ({
  AllDayItem: () => <div data-calendar-event="day" />,
}));
jest.mock("./DayView/DayGutter", () => ({
  DayGutter: (): React.ReactElement | null => null,
}));
jest.mock("./DayView/DayItem", () => ({
  DayItem: ({ event, clone, editRepeat, scheduleError }: any) =>
    clone ? null : (
      <>
        <div
          data-calendar-event="day"
          data-start={event.start?.toISOString()}
          data-end={event.end?.toISOString()}
        />
        {scheduleError && (
          <span role="img" aria-label={`Invalid recurrence: ${scheduleError}`} />
        )}
        {editRepeat && <button data-edit-repeat="day" onClick={editRepeat} />}
      </>
    ),
}));
jest.mock("./MonthView/MonthDayCell", () => ({
  MonthDayCell: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
}));
jest.mock("./MonthView/MonthWeekItem", () => ({
  MonthWeekItem: ({ index, startEvent, endEvent, editRepeat, scheduleError }: any) =>
    index === -1 ? null : (
      <>
        <div
          data-calendar-event="month"
          data-start={new Date(startEvent).toISOString()}
          data-end={new Date(endEvent).toISOString()}
        />
        {scheduleError && (
          <span role="img" aria-label={`Invalid recurrence: ${scheduleError}`} />
        )}
        {editRepeat && <button data-edit-repeat="month" onClick={editRepeat} />}
      </>
    ),
}));
jest.mock("core/utils/ui/screen", () => ({ isPhone: () => false }));

import { DayView } from "./DayView/DayView";
import { MonthWeekRow } from "./MonthView/MonthWeekRow";
import { dateScheduleBindingForRow } from "core/react/components/UI/Menus/properties/datePickerMenu";
import { showSetValueMenu } from "core/react/components/UI/Menus/properties/propertyMenu";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

type CalendarKind = "day" | "month";

describe("strict Day and Month schedule routing", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    jest.clearAllMocks();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  const renderCalendar = (kind: CalendarKind, event: Record<string, unknown>) => {
    const path = event.File as string | undefined;
    const hasCanonicalSnapshot = event.__canonicalSnapshot === true && !!path;
    const canonicalProperty = event.__canonicalProperty as
      | Record<string, unknown>
      | undefined;
    const superstate = {
      settings: { dateScheduleAuthoring: event.__legacyOff ? false : true },
      ui: { getSticker: () => "<svg></svg>", quickOpen: jest.fn() },
      pathsIndex: hasCanonicalSnapshot
        ? new Map([[path, { metadata: canonicalProperty === undefined
          ? {}
          : { property: canonicalProperty } }]])
        : new Map(),
    } as any;
    act(() => {
      root.render(
        kind === "day" ? (
          <DayView
            superstate={superstate}
            date={new Date(2026, 6, 19)}
            field="selectedStart"
            fieldEnd="selectedEnd"
            fieldRepeat="legacyRepeat"
            data={[event] as any}
            hourHeight={60}
            showHours={event.__allDayBoundary ? false : true}
          />
        ) : (
          <MonthWeekRow
            superstate={superstate}
            date={new Date(2026, 6, 19)}
            field="selectedStart"
            fieldEnd="selectedEnd"
            fieldRepeat="legacyRepeat"
            events={[event] as any}
            insertItem={jest.fn()}
          />
        ),
      );
    });
    return Array.from(
      container.querySelectorAll<HTMLElement>(`[data-calendar-event="${kind}"]`),
    );
  };

  it.each<CalendarKind>(["day", "month"])(
    "%s uses canonical due, preserves selected-field duration, and renders the base exactly once",
    (kind) => {
      const due = kind === "day" ? "2026-07-19T10:00:00" : "2026-07-20T10:00:00";
      const events = renderCalendar(kind, {
        due,
        selectedStart: "2026-07-19T09:00:00",
        selectedEnd: "2026-07-19T10:00:00",
        repeat: { freq: "DAILY", interval: 1, count: 1 },
      });

      expect(events).toHaveLength(1);
      expect(events[0].dataset.start).toBe(new Date(due).toISOString());
      expect(events[0].dataset.end).toBe(
        new Date(new Date(due).getTime() + 60 * 60 * 1000).toISOString(),
      );
    },
  );

  it.each([
    ["day", {}],
    ["month", {}],
    ["day", { selectedStart: "invalid", selectedEnd: "also-invalid" }],
    ["month", { selectedStart: "invalid", selectedEnd: "also-invalid" }],
  ] as Array<[CalendarKind, Record<string, unknown>]>) (
    "%s renders from canonical due with unusable selected fields",
    (kind, selectedFields) => {
      const due = kind === "day" ? "2026-07-19T10:00:00" : "2026-07-20T10:00:00";
      const events = renderCalendar(kind, {
        due,
        repeat: null,
        ...selectedFields,
      });

      expect(events).toHaveLength(1);
      expect(events[0].dataset.start).toBe(new Date(due).toISOString());
      expect(events[0].dataset.end).toBe(
        new Date(new Date(due).getTime() + 60 * 60 * 1000).toISOString(),
      );
    },
  );

  it("Day strict ON never invokes the legacy editor when path or due is invalid", () => {
    renderCalendar("day", {
      selectedStart: "2026-07-19T09:00:00",
      selectedEnd: "2026-07-19T10:00:00",
      legacyRepeat: { freq: "DAILY", interval: 1 },
    });

    const edit = container.querySelector<HTMLButtonElement>('[data-edit-repeat="day"]');
    if (edit) act(() => edit.click());
    expect(showSetValueMenu).not.toHaveBeenCalled();
  });

  it("Day kill-switch OFF invokes the legacy editor", () => {
    renderCalendar("day", {
      __legacyOff: true,
      selectedStart: "2026-07-19T09:00:00",
      selectedEnd: "2026-07-19T10:00:00",
      legacyRepeat: { freq: "DAILY", interval: 1 },
    });

    act(() => container.querySelector<HTMLButtonElement>('[data-edit-repeat="day"]')!.click());
    expect(showSetValueMenu).toHaveBeenCalledTimes(1);
  });

  it.each<CalendarKind>(["day", "month"])(
    "%s kill-switch OFF keeps the selected legacy date authoritative",
    (kind) => {
      const events = renderCalendar(kind, {
        __legacyOff: true,
        due: kind === "day" ? "2026-07-20T09:00:00" : "2026-07-26T09:00:00",
        selectedStart: "2026-07-19T09:00:00",
        selectedEnd: "2026-07-19T10:00:00",
      });

      expect(events).toHaveLength(1);
      expect(events[0].dataset.start).toBe(
        new Date("2026-07-19T09:00:00").toISOString(),
      );
    },
  );

  it("Day recomputes its calendar projection when the kill switch changes at runtime", () => {
    const event = {
      due: "2026-07-20T09:00:00",
      selectedStart: "2026-07-19T09:00:00",
      selectedEnd: "2026-07-19T10:00:00",
    };
    const data = [event] as any;
    const superstate = {
      settings: { dateScheduleAuthoring: true },
      ui: { getSticker: () => "<svg></svg>", quickOpen: jest.fn() },
    } as any;
    const view = () => (
      <DayView
        superstate={superstate}
        date={new Date(2026, 6, 19)}
        field="selectedStart"
        fieldEnd="selectedEnd"
        fieldRepeat="legacyRepeat"
        data={data}
        hourHeight={60}
        showHours
      />
    );

    act(() => root.render(view()));
    expect(container.querySelectorAll('[data-calendar-event="day"]')).toHaveLength(0);

    superstate.settings.dateScheduleAuthoring = false;
    act(() => root.render(view()));

    const events = container.querySelectorAll<HTMLElement>('[data-calendar-event="day"]');
    expect(events).toHaveLength(1);
    expect(events[0].dataset.start).toBe(
      new Date(event.selectedStart).toISOString(),
    );
  });

  it.each<CalendarKind>(["day", "month"])(
    "%s recomputes when a canonical due value mutates behind a stable row array",
    (kind) => {
      const path = "Events/A.md";
      const canonicalProperty: Record<string, unknown> = {
        due: kind === "day" ? "2026-07-20T09:00:00" : "2026-07-26T09:00:00",
        repeat: null,
      };
      const data = [{
        File: path,
        due: "",
        repeat: "",
        selectedStart: "2026-07-19T09:00:00",
        selectedEnd: "2026-07-19T10:00:00",
      }] as any;
      const superstate = {
        settings: { dateScheduleAuthoring: true },
        ui: { getSticker: () => "<svg></svg>", quickOpen: jest.fn() },
        pathsIndex: new Map([[path, { metadata: { property: canonicalProperty } }]]),
      } as any;
      const view = () => kind === "day" ? (
        <DayView
          superstate={superstate}
          date={new Date(2026, 6, 19)}
          field="selectedStart"
          fieldEnd="selectedEnd"
          fieldRepeat="legacyRepeat"
          data={data}
          hourHeight={60}
          showHours
        />
      ) : (
        <MonthWeekRow
          superstate={superstate}
          date={new Date(2026, 6, 19)}
          field="selectedStart"
          fieldEnd="selectedEnd"
          fieldRepeat="legacyRepeat"
          events={data}
          insertItem={jest.fn()}
        />
      );

      act(() => root.render(view()));
      expect(container.querySelectorAll(`[data-calendar-event="${kind}"]`))
        .toHaveLength(0);

      canonicalProperty.due = kind === "day"
        ? "2026-07-19T09:00:00"
        : "2026-07-20T09:00:00";
      act(() => root.render(view()));

      expect(container.querySelectorAll(`[data-calendar-event="${kind}"]`))
        .toHaveLength(1);
    },
  );

  it.each<CalendarKind>(["day", "month"])(
    "%s recomputes when canonical repeat presence mutates behind a stable row array",
    (kind) => {
      const path = "Events/A.md";
      const due = kind === "day"
        ? "2026-07-19T09:00:00"
        : "2026-07-20T09:00:00";
      const canonicalProperty: Record<string, unknown> = { due };
      const data = [{
        File: path,
        due: "",
        repeat: "",
        selectedStart: due,
        selectedEnd: kind === "day"
          ? "2026-07-19T10:00:00"
          : "2026-07-20T10:00:00",
      }] as any;
      const superstate = {
        settings: { dateScheduleAuthoring: true },
        ui: { getSticker: () => "<svg></svg>", quickOpen: jest.fn() },
        pathsIndex: new Map([[path, { metadata: { property: canonicalProperty } }]]),
      } as any;
      const view = () => kind === "day" ? (
        <DayView
          superstate={superstate}
          date={new Date(2026, 6, 19)}
          field="selectedStart"
          fieldEnd="selectedEnd"
          fieldRepeat="legacyRepeat"
          data={data}
          hourHeight={60}
          showHours
        />
      ) : (
        <MonthWeekRow
          superstate={superstate}
          date={new Date(2026, 6, 19)}
          field="selectedStart"
          fieldEnd="selectedEnd"
          fieldRepeat="legacyRepeat"
          events={data}
          insertItem={jest.fn()}
        />
      );

      act(() => root.render(view()));
      expect(container.querySelectorAll(`[data-calendar-event="${kind}"]`))
        .toHaveLength(1);

      canonicalProperty.repeat = { freq: "HOURLY", interval: 1, count: 2 };
      act(() => root.render(view()));

      expect(container.querySelectorAll(`[data-calendar-event="${kind}"]`))
        .toHaveLength(2);
    },
  );

  it.each<CalendarKind>(["day", "month"])(
    "%s falls back to the selected legacy date only when canonical due is absent",
    (kind) => {
      const selectedStart = "2026-07-19T09:00:00";
      const events = renderCalendar(kind, {
        selectedStart,
        selectedEnd: "2026-07-19T10:00:00",
        repeat: { freq: "DAILY", interval: 1, count: 1 },
      });

      expect(events).toHaveLength(1);
      expect(events[0].dataset.start).toBe(new Date(selectedStart).toISOString());
    },
  );

  it.each<CalendarKind>(["day", "month"])(
    "%s ignores own-empty projected schedule columns when frontmatter lacks the canonical keys",
    (kind) => {
      const events = renderCalendar(kind, {
        File: "Events/A.md",
        __canonicalSnapshot: true,
        due: "",
        repeat: "",
        selectedStart: "2026-07-18T09:00:00",
        selectedEnd: "2026-07-18T10:00:00",
        legacyRepeat: { freq: "DAILY", interval: 1, count: 2 },
      });

      expect(events).toHaveLength(1);
      expect(events[0].dataset.start).toBe(
        new Date("2026-07-19T09:00:00").toISOString(),
      );
      const edit = container.querySelector<HTMLButtonElement>(
        `[data-edit-repeat="${kind}"]`,
      );
      expect(edit).not.toBeNull();
      act(() => edit!.click());
      expect(dateScheduleBindingForRow).toHaveBeenCalledWith(
        expect.objectContaining({
          due: "2026-07-18T09:00:00",
          row: expect.objectContaining({
            repeat: { freq: "DAILY", interval: 1, count: 2 },
          }),
        }),
      );
    },
  );

  it.each<CalendarKind>(["day", "month"])(
    "%s omits a canonical base outside its visible window even when the selected date is inside",
    (kind) => {
      const events = renderCalendar(kind, {
        due: kind === "day" ? "2026-07-20T09:00:00" : "2026-07-26T09:00:00",
        selectedStart: "2026-07-19T09:00:00",
        selectedEnd: "2026-07-19T10:00:00",
        repeat: { freq: "DAILY", interval: 1, count: 1 },
      });

      expect(events).toHaveLength(0);
    },
  );

  it("Day excludes the following day's midnight from its strict window", () => {
    const events = renderCalendar("day", {
      __allDayBoundary: true,
      due: "2026-07-20T00:00:00",
      selectedStart: "2026-07-20T00:00:00",
      selectedEnd: "2026-07-20T01:00:00",
      repeat: null,
    });

    expect(events).toHaveLength(0);
  });

  it("Day kill-switch OFF preserves the inclusive next-midnight legacy boundary", () => {
    const events = renderCalendar("day", {
      __legacyOff: true,
      __allDayBoundary: true,
      selectedStart: "2026-07-20T00:00:00",
      selectedEnd: "2026-07-20T01:00:00",
    });

    expect(events).toHaveLength(1);
  });

  it.each<CalendarKind>(["day", "month"])(
    "%s recurrence editor preserves explicit canonical null instead of resurrecting the legacy selector",
    (kind) => {
      renderCalendar(kind, {
        File: "Events/A.md",
        due: kind === "day" ? "2026-07-19T09:00:00" : "2026-07-20T09:00:00",
        selectedStart: "2026-07-19T09:00:00",
        selectedEnd: "2026-07-19T10:00:00",
        repeat: null,
        legacyRepeat: { freq: "DAILY", interval: 1 },
      });

      act(() => container.querySelector<HTMLButtonElement>(`[data-edit-repeat="${kind}"]`)!.click());
      expect(dateScheduleBindingForRow).toHaveBeenCalledWith(
        expect.objectContaining({
          row: expect.objectContaining({ repeat: null }),
        }),
      );
    },
  );

  it.each<CalendarKind>(["day", "month"])(
    "%s renders a prototype-name token error accessibly without losing the base",
    (kind) => {
      const events = renderCalendar(kind, {
        due: kind === "day" ? "2026-07-19T09:00:00" : "2026-07-20T09:00:00",
        selectedStart: "2026-07-19T09:00:00",
        selectedEnd: "2026-07-19T10:00:00",
        repeat: { freq: "DAILY", interval: 1, byweekday: ["toString"] },
      });

      expect(events).toHaveLength(1);
      expect(container.querySelector('[role="img"]')?.getAttribute("aria-label"))
        .toMatch(/invalid recurrence.*weekday/i);
    },
  );
});
