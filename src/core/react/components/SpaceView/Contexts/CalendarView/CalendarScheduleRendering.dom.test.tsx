/**
 * @jest-environment jsdom
 */
import React from "react";
import { act } from "react-dom/test-utils";
import { createRoot, Root } from "react-dom/client";

let mockExpansion: any = null;
const mockUseDraggable = jest.fn((_options: any): any => ({
  attributes: {},
  listeners: {},
  setNodeRef: jest.fn(),
  transform: null,
}));
jest.mock("core/utils/date-reminders/schedule", () => {
  const actual = jest.requireActual("core/utils/date-reminders/schedule");
  return {
    ...actual,
    expandCalendarEventSchedule: (options: unknown) =>
      mockExpansion ?? actual.expandCalendarEventSchedule(options),
  };
});
jest.mock("@dnd-kit/core", () => ({
  defaultDropAnimation: {},
  DragOverlay: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  useDndMonitor: jest.fn(),
  useDroppable: () => ({ setNodeRef: jest.fn() }),
  useDraggable: mockUseDraggable,
}));
jest.mock("core/react/context/ContextEditorContext", () => ({
  ContextEditorContext: React.createContext({ source: "Events", dbSchema: {} }),
}));
jest.mock("core/react/context/SpaceContext", () => ({
  SpaceContext: React.createContext({ spaceState: { path: "Events" } }),
}));
jest.mock("core/react/context/PathContext", () => ({
  PathContext: React.createContext({ pathState: null }),
}));
jest.mock("core/react/components/UI/Crumbs/PathCrumb", () => ({
  PathCrumb: ({ path }: { path: string }) => <span>{path}</span>,
}));
jest.mock("core/react/components/UI/Menus/navigator/pathContextMenu", () => ({
  showPathContextMenu: jest.fn(),
}));
jest.mock("core/react/components/SpaceView/Frames/FrameNodeEditor/Overlays/FrameDraggableHandle", () => ({
  FrameDraggableHandle: () => <div data-resize-handle />,
}));
jest.mock("core/react/components/UI/Menus/properties/datePickerMenu", () => ({
  DatePickerTimeMode: { Toggle: "toggle" },
  dateScheduleBindingForRow: jest.fn(() => ({ onSave: jest.fn() })),
  showDatePickerMenu: jest.fn(),
}));
jest.mock("core/react/components/UI/Menus/properties/propertyMenu", () => ({
  showSetValueMenu: jest.fn(),
}));
jest.mock("./CalendarHeaderView", () => ({
  CalendarHeaderView: (): React.ReactElement | null => null,
}));
jest.mock("./DayView/DayGutter", () => ({
  DayGutter: (): React.ReactElement | null => null,
}));
jest.mock("./MonthView/MonthDayCell", () => ({
  MonthDayCell: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
}));
jest.mock("core/utils/ui/screen", () => ({ isPhone: () => false }));

import { DayView } from "./DayView/DayView";
import { MonthView } from "./MonthView/MonthView";
import { MonthWeekRow } from "./MonthView/MonthWeekRow";
import { WeekView } from "./WeekView/WeekView";
import { showDatePickerMenu } from "core/react/components/UI/Menus/properties/datePickerMenu";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

describe("actual Day and Month schedule rendering", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    jest.clearAllMocks();
    mockExpansion = null;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  const superstate = (
    settings: { dateScheduleAuthoring?: boolean } = {
      dateScheduleAuthoring: true,
    },
    pathsIndex = new Map<string, unknown>(),
  ) => ({
    settings,
    ui: { getSticker: () => "", quickOpen: jest.fn() },
    pathsIndex,
  } as any);

  const renderDay = (event: Record<string, unknown>) => {
    act(() => root.render(
      <DayView
        superstate={superstate()}
        date={new Date(2026, 6, 19)}
        field="selectedStart"
        fieldEnd="selectedEnd"
        fieldRepeat="legacyRepeat"
        data={[event] as any}
        hourHeight={60}
        gutter
        showHours
        updateItem={jest.fn()}
        insertItem={jest.fn()}
      />,
    ));
  };

  const renderDayWith = (
    event: Record<string, unknown>,
    settings: { dateScheduleAuthoring?: boolean },
    pathsIndex: any,
  ) => {
    act(() => root.render(
      <DayView
        superstate={superstate(settings, pathsIndex)}
        date={new Date(2026, 6, 19)}
        field="selectedStart"
        fieldEnd="selectedEnd"
        fieldRepeat="legacyRepeat"
        data={[event] as any}
        hourHeight={60}
        gutter
        showHours
        updateItem={jest.fn()}
        insertItem={jest.fn()}
      />,
    ));
  };

  const renderMonth = (event: Record<string, unknown>) => {
    act(() => root.render(
      <MonthWeekRow
        superstate={superstate()}
        date={new Date(2026, 6, 19)}
        field="selectedStart"
        fieldEnd="selectedEnd"
        fieldRepeat="legacyRepeat"
        events={[event] as any}
        insertItem={jest.fn()}
      />,
    ));
  };

  const renderWeek = (
    event: Record<string, unknown>,
    options: {
      settings?: { dateScheduleAuthoring?: boolean };
      canonicalProperty?: Record<string, unknown>;
      updateItem?: jest.Mock;
    } = {},
  ) => {
    const path = event.File as string | undefined;
    const pathsIndex = path && options.canonicalProperty
      ? new Map([[path, { metadata: { property: options.canonicalProperty } }]])
      : new Map();
    const updateItem = options.updateItem ?? jest.fn();
    act(() => root.render(
      <WeekView
        superstate={superstate(options.settings, pathsIndex)}
        weekStart={new Date(2026, 6, 19)}
        field="selectedStart"
        fieldEnd="selectedEnd"
        fieldRepeat="legacyRepeat"
        data={[event] as any}
        showHours={false}
        insertItem={jest.fn()}
        updateItem={updateItem}
      />,
    ));
    return updateItem;
  };

  it.each(["day", "month"] as const)(
    "%s announces a truncated series exactly once",
    (kind) => {
      if (kind === "day") {
        mockExpansion = {
          instances: [
            { start: new Date(2026, 6, 19, 9), end: new Date(2026, 6, 19, 10) },
            { start: new Date(2026, 6, 19, 11), end: new Date(2026, 6, 19, 12) },
          ],
          error: null,
          truncated: true,
        };
      }
      const event: Record<string, unknown> = {
        File: "Events/A.md",
        due: "2026-07-19T09:00:00",
        selectedStart: "2026-07-19T09:00:00",
        selectedEnd: "2026-07-19T10:00:00",
        repeat: { freq: "HOURLY", interval: 1 },
      };
      kind === "day" ? renderDay(event) : renderMonth(event);

      expect(container.querySelectorAll('[role="status"]')).toHaveLength(1);
      expect(container.textContent?.match(/Showing the first 100 occurrences\./g)).toHaveLength(1);
    },
  );

  it("Day all-day events expose the shared editor through a real button", () => {
    renderDay({
      File: "Events/A.md",
      due: "2026-07-19",
      selectedStart: "2026-07-19",
      selectedEnd: "2026-07-19",
      repeat: { freq: "DAILY", interval: 1 },
    });

    const button = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Edit recurrence and reminder"]',
    );
    expect(button).not.toBeNull();
    act(() => button!.click());
    expect(showDatePickerMenu).toHaveBeenCalledTimes(1);
  });

  it("Week all-day rows use canonical due/repeat expansion and the shared editor", () => {
    const updateItem = jest.fn();
    renderWeek(
      {
        File: "Events/A.md",
        due: "",
        repeat: "",
        selectedStart: "2026-07-18",
        selectedEnd: "2026-07-18",
        legacyRepeat: null,
      },
      {
        canonicalProperty: {
          due: "2026-07-19",
          repeat: { freq: "DAILY", interval: 1, count: 2 },
        },
        updateItem,
      },
    );

    expect(container.querySelectorAll(".mk-week-event")).toHaveLength(2);
    const button = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Edit recurrence and reminder"]',
    );
    expect(button).not.toBeNull();
    act(() => button!.click());
    expect(showDatePickerMenu).toHaveBeenCalledTimes(1);
    expect(updateItem).not.toHaveBeenCalled();
  });

  it("Week all-day rows expose invalid and truncation signals once", () => {
    renderWeek({
      File: "Events/A.md",
      due: "2026-07-19",
      selectedStart: "2026-07-19",
      selectedEnd: "2026-07-19",
      repeat: { freq: "MINUTELY", interval: 1 },
    });

    expect(container.querySelector('[role="img"]')?.getAttribute("aria-label"))
      .toMatch(/invalid recurrence.*frequency/i);

    mockExpansion = {
      instances: [
        { start: new Date(2026, 6, 19), end: new Date(2026, 6, 19) },
        { start: new Date(2026, 6, 20), end: new Date(2026, 6, 20) },
      ],
      error: null,
      truncated: true,
    };
    renderWeek({
      File: "Events/A.md",
      due: "2026-07-19",
      selectedStart: "2026-07-19",
      selectedEnd: "2026-07-19",
      repeat: { freq: "HOURLY", interval: 1 },
    });

    expect(container.querySelectorAll('[role="status"]')).toHaveLength(1);
  });

  it("Week clips a spanning strict all-day row to all seven visible days", () => {
    renderWeek({
      File: "Events/A.md",
      due: "2026-07-18",
      selectedStart: "2026-07-18",
      selectedEnd: "2026-07-27",
      repeat: null,
    });

    expect(container.querySelector<HTMLElement>(".mk-week-event")?.style.width)
      .toBe("calc(700% - 4px)");
  });

  it("Week kill-switch OFF keeps legacy all-day routing and no strict editor", () => {
    renderWeek(
      {
        File: "Events/A.md",
        due: "2026-07-26",
        selectedStart: "2026-07-19",
        selectedEnd: "2026-07-19",
      },
      { settings: { dateScheduleAuthoring: false } },
    );

    expect(container.querySelectorAll(".mk-week-event")).toHaveLength(1);
    expect(container.querySelector(
      'button[aria-label="Edit recurrence and reminder"]',
    )).toBeNull();
  });

  it("Month caps each source row once across the whole rendered surface", () => {
    act(() => root.render(
      <MonthView
        superstate={superstate()}
        date={new Date(2026, 6, 19)}
        field="selectedStart"
        fieldEnd="selectedEnd"
        fieldRepeat="legacyRepeat"
        data={[{
          File: "Events/A.md",
          due: "2026-07-01T09:00:00",
          selectedStart: "2026-07-01T09:00:00",
          selectedEnd: "2026-07-01T09:30:00",
          repeat: { freq: "HOURLY", interval: 1 },
        }] as any}
        insertItem={jest.fn()}
        updateItem={jest.fn()}
      />,
    ));

    expect(container.querySelectorAll(".mk-month-event")).toHaveLength(100);
    expect(container.querySelectorAll('[role="status"]')).toHaveLength(1);
  });

  it("Week caps a timed source row once across its seven-day surface", () => {
    act(() => root.render(
      <WeekView
        superstate={superstate()}
        weekStart={new Date(2026, 6, 19)}
        field="selectedStart"
        fieldEnd="selectedEnd"
        fieldRepeat="legacyRepeat"
        data={[{
          File: "Events/A.md",
          due: "2026-07-19T00:00:00",
          selectedStart: "2026-07-19T00:00:00",
          selectedEnd: "2026-07-19T00:30:00",
          repeat: { freq: "HOURLY", interval: 1 },
        }] as any}
        showHours
        hourHeight={60}
        insertItem={jest.fn()}
        updateItem={jest.fn()}
      />,
    ));

    expect(container.querySelectorAll(".mk-day-block")).toHaveLength(100);
    expect(container.querySelectorAll('[role="status"]')).toHaveLength(1);
    const occurrenceIds = mockUseDraggable.mock.calls
      .map(([options]) => options.id)
      .filter((id) => String(id).startsWith("event-0:"));
    expect(new Set(occurrenceIds).size).toBe(100);
  });

  it.each(["day", "month", "week"] as const)(
    "%s kill-switch OFF performs no canonical path-state reads",
    (kind) => {
      const pathsIndex = {
        get: jest.fn(() => {
          throw new Error("strict canonical read");
        }),
      };
      const event: Record<string, unknown> = {
        File: "Events/A.md",
        selectedStart: "2026-07-19T09:00:00",
        selectedEnd: "2026-07-19T10:00:00",
        legacyRepeat: null,
      };

      expect(() => {
        if (kind === "day") {
          renderDayWith(event, { dateScheduleAuthoring: false }, pathsIndex);
        } else if (kind === "month") {
          act(() => root.render(
            <MonthWeekRow
              superstate={superstate(
                { dateScheduleAuthoring: false },
                pathsIndex as any,
              )}
              date={new Date(2026, 6, 19)}
              field="selectedStart"
              fieldEnd="selectedEnd"
              fieldRepeat="legacyRepeat"
              events={[event] as any}
              insertItem={jest.fn()}
            />,
          ));
        } else {
          act(() => root.render(
            <WeekView
              superstate={superstate(
                { dateScheduleAuthoring: false },
                pathsIndex as any,
              )}
              weekStart={new Date(2026, 6, 19)}
              field="selectedStart"
              fieldEnd="selectedEnd"
              fieldRepeat="legacyRepeat"
              data={[event] as any}
              showHours={false}
              insertItem={jest.fn()}
              updateItem={jest.fn()}
            />,
          ));
        }
      }).not.toThrow();
      expect(pathsIndex.get).not.toHaveBeenCalled();
    },
  );

  it("strict timed Day projections disable dragging and resizing", () => {
    renderDay({
      File: "Events/A.md",
      due: "2026-07-19T09:00:00",
      selectedStart: "2026-07-19T09:00:00",
      selectedEnd: "2026-07-19T10:00:00",
      repeat: null,
    });

    expect(mockUseDraggable).toHaveBeenCalledWith(
      expect.objectContaining({ disabled: true }),
    );
    expect(container.querySelectorAll("[data-resize-handle]")).toHaveLength(0);
    expect(container.querySelector(
      'button[aria-label="Edit recurrence and reminder"]',
    )).not.toBeNull();
  });

  it.each(["month", "all-day"] as const)(
    "strict %s projections disable dragging while retaining the editor",
    (kind) => {
      const event: Record<string, unknown> = {
        File: "Events/A.md",
        due: kind === "month" ? "2026-07-20T09:00:00" : "2026-07-19",
        selectedStart: kind === "month" ? "2026-07-20T09:00:00" : "2026-07-19",
        selectedEnd: kind === "month" ? "2026-07-20T10:00:00" : "2026-07-20",
        repeat: null,
      };
      if (kind === "month") renderMonth(event);
      else renderWeek(event);

      expect(mockUseDraggable).toHaveBeenCalledWith(
        expect.objectContaining({ disabled: true }),
      );
      expect(container.querySelector(
        'button[aria-label="Edit recurrence and reminder"]',
      )).not.toBeNull();
    },
  );

  it("legacy timed Day items keep drag and resize interactions", () => {
    renderDayWith(
      {
        File: "Events/A.md",
        selectedStart: "2026-07-19T09:00:00",
        selectedEnd: "2026-07-19T10:00:00",
        legacyRepeat: null,
      },
      { dateScheduleAuthoring: false },
      new Map(),
    );

    expect(mockUseDraggable).toHaveBeenCalledWith(
      expect.objectContaining({ disabled: false }),
    );
    expect(container.querySelectorAll("[data-resize-handle]")).toHaveLength(2);
  });

  it.each([
    ["day", {}],
    ["month", {}],
    ["day", { selectedStart: "invalid", selectedEnd: "invalid" }],
    ["month", { selectedStart: "invalid", selectedEnd: "invalid" }],
  ] as const)(
    "%s renders a valid canonical due with unusable selected fields",
    (kind, selectedFields) => {
      const event: Record<string, unknown> = {
        File: "Events/A.md",
        due: kind === "day" ? "2026-07-19T09:00:00" : "2026-07-20T09:00:00",
        repeat: null,
        ...selectedFields,
      };
      kind === "day" ? renderDay(event) : renderMonth(event);

      expect(container.querySelector(kind === "day" ? ".mk-day-block" : ".mk-month-event"))
        .not.toBeNull();
    },
  );
});
