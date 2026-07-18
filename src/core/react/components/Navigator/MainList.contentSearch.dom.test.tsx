/**
 * @jest-environment jsdom
 */
import React from "react";
import { act } from "react-dom/test-utils";
import { createRoot, Root } from "react-dom/client";
import {
  NavigatorContentSearchRequest,
  NavigatorContentSearchResult,
  NavigatorContentSearchSnapshot,
} from "shared/types/navigatorContentSearch";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const spaceTreeSpy = jest.fn();
jest.mock("core/react/components/Navigator/SpaceTree/SpaceTreeView", () => ({
  SpaceTreeComponent: (props: any) => {
    spaceTreeSpy(props);
    return <div data-testid="space-tree" />;
  },
}));
jest.mock("./MainMenu", () => ({ MainMenu: () => <div /> }));
jest.mock("./Focuses/FocusSelector", () => ({ FocusSelector: () => <div /> }));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { MainList } = require("./MainList");

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
};

class FakeContentSearch {
  snapshot: NavigatorContentSearchSnapshot;
  readonly requests: NavigatorContentSearchRequest[] = [];
  readonly responses: Array<ReturnType<typeof deferred<NavigatorContentSearchResult>>> = [];
  readonly listeners = new Set<(snapshot: NavigatorContentSearchSnapshot) => void>();

  constructor(status: NavigatorContentSearchSnapshot["status"], revision = 1) {
    this.snapshot = { status, revision };
  }

  getSnapshot = () => this.snapshot;
  subscribe = (listener: (snapshot: NavigatorContentSearchSnapshot) => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  search = (request: NavigatorContentSearchRequest) => {
    this.requests.push(request);
    const response = deferred<NavigatorContentSearchResult>();
    this.responses.push(response);
    return response.promise;
  };
  publish(snapshot: NavigatorContentSearchSnapshot) {
    this.snapshot = snapshot;
    for (const listener of this.listeners) listener(snapshot);
  }
}

const makeSuperstate = (
  service: FakeContentSearch | null,
  enabled = true
): any => ({
  settings: { enableNavigatorTextFilter: enabled },
  navigatorContentSearch: service,
  ui: { getSticker: () => "<svg></svg>", primaryInteractionType: () => 1 },
  eventsDispatcher: { addListener: jest.fn(), removeListener: jest.fn() },
});

const typeInto = (input: HTMLInputElement, value: string) => {
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    "value"
  )!.set!;
  setter.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
};

describe("MainList Navigator content search", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    jest.useFakeTimers();
    spaceTreeSpy.mockClear();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    jest.useRealTimers();
  });

  it("passes name/path input immediately and adds content paths only after 150 ms", async () => {
    const service = new FakeContentSearch("ready", 3);
    await act(async () => root.render(<MainList superstate={makeSuperstate(service)} />));
    const input = container.querySelector("input")!;

    act(() => typeInto(input, "body needle"));
    expect(spaceTreeSpy).toHaveBeenLastCalledWith(
      expect.objectContaining({
        filterQuery: "body needle",
        additionalMatchPaths: undefined,
      })
    );
    expect(service.requests).toHaveLength(0);

    await act(async () => jest.advanceTimersByTime(150));
    expect(service.requests).toEqual([
      { requestId: 1, query: "body needle", revision: 3 },
    ]);
    await act(async () =>
      service.responses[0].resolve({
        requestId: 1,
        query: "body needle",
        requestedRevision: 3,
        revision: 3,
        paths: ["Folder/Body.md"],
      })
    );

    const matches = spaceTreeSpy.mock.calls.at(-1)?.[0].additionalMatchPaths;
    expect(Array.from(matches)).toEqual(["Folder/Body.md"]);
  });

  it.each([
    ["building", "Building content index…"],
    ["unavailable", "Content search unavailable"],
  ] as const)("shows honest %s state only for a nonblank query", async (status, text) => {
    const service = new FakeContentSearch(status);
    await act(async () => root.render(<MainList superstate={makeSuperstate(service)} />));
    expect(container.querySelector('[role="status"]')).toBeNull();

    act(() => typeInto(container.querySelector("input")!, "needle"));
    expect(container.querySelector('[role="status"]')?.textContent).toBe(text);
    act(() => jest.advanceTimersByTime(200));
    expect(service.requests).toHaveLength(0);
  });

  it("applies only the latest query and reissues it after a ready revision change", async () => {
    const service = new FakeContentSearch("ready", 1);
    await act(async () => root.render(<MainList superstate={makeSuperstate(service)} />));
    const input = container.querySelector("input")!;

    act(() => typeInto(input, "alpha"));
    await act(async () => jest.advanceTimersByTime(150));
    act(() => typeInto(input, "beta"));
    await act(async () => jest.advanceTimersByTime(150));

    await act(async () =>
      service.responses[0].resolve({
        requestId: 1,
        query: "alpha",
        requestedRevision: 1,
        revision: 1,
        paths: ["Stale.md"],
      })
    );
    expect(spaceTreeSpy.mock.calls.at(-1)?.[0].additionalMatchPaths).toBeUndefined();

    await act(async () =>
      service.responses[1].resolve({
        requestId: 2,
        query: "beta",
        requestedRevision: 1,
        revision: 1,
        paths: ["Current.md"],
      })
    );
    expect(
      Array.from(spaceTreeSpy.mock.calls.at(-1)?.[0].additionalMatchPaths)
    ).toEqual(["Current.md"]);

    act(() => service.publish({ status: "ready", revision: 2 }));
    expect(spaceTreeSpy.mock.calls.at(-1)?.[0].additionalMatchPaths).toBeUndefined();
    await act(async () => jest.advanceTimersByTime(150));
    expect(service.requests.at(-1)).toEqual({
      requestId: 3,
      query: "beta",
      revision: 2,
    });
  });

  it("clears without querying and ignores a late result after unmount", async () => {
    const service = new FakeContentSearch("ready", 1);
    await act(async () => root.render(<MainList superstate={makeSuperstate(service)} />));
    const input = container.querySelector("input")!;
    act(() => typeInto(input, "needle"));
    await act(async () => jest.advanceTimersByTime(150));

    act(() => typeInto(input, ""));
    act(() => jest.advanceTimersByTime(200));
    expect(service.requests).toHaveLength(1);
    expect(spaceTreeSpy.mock.calls.at(-1)?.[0]).toEqual(
      expect.objectContaining({ filterQuery: "", additionalMatchPaths: undefined })
    );

    act(() => root.unmount());
    await act(async () =>
      service.responses[0].resolve({
        requestId: 1,
        query: "needle",
        requestedRevision: 1,
        revision: 1,
        paths: ["Late.md"],
      })
    );
    expect(service.listeners.size).toBe(0);
  });

  it("touches no service seam and renders no content state when the flag is off", async () => {
    const service = new FakeContentSearch("unavailable");
    const getSnapshot = jest.spyOn(service, "getSnapshot");
    const subscribe = jest.spyOn(service, "subscribe");

    await act(async () =>
      root.render(<MainList superstate={makeSuperstate(service, false)} />)
    );

    expect(getSnapshot).not.toHaveBeenCalled();
    expect(subscribe).not.toHaveBeenCalled();
    expect(container.querySelector("input")).toBeNull();
    expect(container.querySelector('[role="status"]')).toBeNull();
    expect(spaceTreeSpy).toHaveBeenLastCalledWith(
      expect.objectContaining({
        filterQuery: undefined,
        additionalMatchPaths: undefined,
      })
    );
  });
});
