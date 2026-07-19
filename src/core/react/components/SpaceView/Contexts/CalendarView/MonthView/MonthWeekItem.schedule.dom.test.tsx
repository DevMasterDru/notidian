/**
 * @jest-environment jsdom
 */
import React from "react";
import { act } from "react-dom/test-utils";
import { createRoot, Root } from "react-dom/client";

jest.mock("@dnd-kit/core", () => ({
  useDraggable: (): any => ({ attributes: {}, listeners: {}, setNodeRef: jest.fn(), transform: null }),
}));
jest.mock("core/react/components/UI/Crumbs/PathCrumb", () => ({
  PathCrumb: ({ path }: { path: string }) => <span>{path}</span>,
}));
jest.mock("core/react/context/SpaceContext", () => ({
  SpaceContext: React.createContext({ spaceState: { path: "Events" } }),
}));

import { MonthWeekItem } from "./MonthWeekItem";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

describe("MonthWeekItem recurrence affordance", () => {
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

  const render = (extra: Record<string, unknown> = {}) => {
    act(() => {
      root.render(
        <MonthWeekItem
          superstate={{
            settings: {},
            ui: { getSticker: () => "<svg></svg>" },
          } as any}
          data={{ _path: "Events/A.md" }}
          index={0}
          startEvent={Date.parse("2026-07-19T09:00:00Z")}
          endEvent={Date.parse("2026-07-19T10:00:00Z")}
          allDay={false}
          repeat
          style={{}}
          {...extra as any}
        />,
      );
    });
  };

  it("never invokes an absent repeat-edit callback", () => {
    render();
    expect(() =>
      container.querySelector<HTMLElement>(".mk-day-block-repeat")!.click(),
    ).not.toThrow();
  });

  it("renders invalid recurrence text as an accessible warning", () => {
    render({ scheduleError: "Repeat frequency is invalid." });
    const warning = container.querySelector('[role="img"]');
    expect(warning?.getAttribute("aria-label")).toBe(
      "Invalid recurrence: Repeat frequency is invalid.",
    );
  });
});
