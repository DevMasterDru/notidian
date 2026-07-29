/**
 * @jest-environment jsdom
 */
// ADR 0065 (Atlas ADR-0096 H1, bd Notidian-pb7p.1) — the SpaceInner mount
// seam:
//   - no `tabs:` declaration (or a non-declaration shape) -> the LEGACY space
//     page renders byte-identical (header + note body + outer + backlinks);
//   - a structurally valid declaration + default-ON hubTabbedViews -> the
//     body swaps to HubTabsView (header stays; note body/outer/backlinks do
//     not render);
//   - the hubTabbedViews kill-switch OFF -> legacy page even with a valid
//     declaration;
//   - an INVALID declaration attempt -> legacy page + a visible error banner
//     naming the violations (fail visible, never fail-brick, no tab bar);
//   - editing the folder note's frontmatter (pathStateUpdated) re-reads the
//     declaration live.
//
// Children are mocked to sentinels (same pattern as SpaceNoteBody.dom.test.tsx)
// so the test locks SpaceInner's branch logic only.
import React from "react";
import { act } from "react-dom/test-utils";
import { createRoot, Root } from "react-dom/client";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

jest.mock("core/react/context/SpaceContext", () => ({
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  SpaceContext: require("react").createContext(null),
}));
jest.mock("makemd-core", () => ({
  Backlinks: () => (
    <div data-testid="backlinks">backlinks</div>
  ),
}));
jest.mock("core/react/components/SpaceView/SpaceHeader", () => ({
  SpaceHeader: () => <div data-testid="space-header">header</div>,
}));
jest.mock("core/react/components/SpaceView/SpaceNoteBody", () => ({
  SpaceNoteBody: () => <div data-testid="space-note-body">note-body</div>,
}));
jest.mock("core/react/components/SpaceView/SpaceOuter", () => ({
  __esModule: true,
  default: React.forwardRef((_props: any, _ref: any) => (
    <div data-testid="space-outer">outer</div>
  )),
}));
jest.mock("core/react/components/SpaceView/HubTabsView", () => ({
  HubTabsView: (props: any) => (
    <div data-testid="hub-tabs" data-tab-count={props.tabs.length}>
      hub-tabs
    </div>
  ),
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { SpaceContext } = require("core/react/context/SpaceContext");

import { SpaceInner } from "./SpaceInner";

const NOTE_PATH = "Life HQ/Life HQ.md";

const VALID_TABS = [
  { id: "next", page: "Tabs/Next.md" },
  { id: "state", page: "Tabs/State.md" },
];

type Listener = (payload: { path: string }) => void;

const makeSuperstate = (opts: {
  tabs?: unknown;
  hubTabbedViews?: boolean;
}) => {
  const listeners = new Map<string, Set<Listener>>();
  const pathsIndex = new Map<string, any>([
    [
      NOTE_PATH,
      { path: NOTE_PATH, metadata: { property: { tabs: opts.tabs } } },
    ],
  ]);
  return {
    settings: {
      spaceViewShowNoteBody: true,
      inlineBacklinks: true,
      ...(opts.hubTabbedViews === undefined
        ? {}
        : { hubTabbedViews: opts.hubTabbedViews }),
    },
    pathsIndex,
    eventsDispatcher: {
      addListener: (key: string, fn: Listener) => {
        if (!listeners.has(key)) listeners.set(key, new Set());
        listeners.get(key).add(fn);
      },
      removeListener: (key: string, fn: Listener) => {
        listeners.get(key)?.delete(fn);
      },
      dispatch: (key: string, payload: { path: string }) => {
        listeners.get(key)?.forEach((fn) => fn(payload));
      },
    },
  } as any;
};

const spaceState = {
  name: "Life HQ",
  path: "Life HQ",
  type: "folder",
  metadata: {},
  space: { notePath: NOTE_PATH },
} as any;

let container: HTMLDivElement;
let root: Root;

const render = async (superstate: any) => {
  await act(async () => {
    root.render(
      <SpaceContext.Provider value={{ spaceState, readMode: false }}>
        <SpaceInner superstate={superstate} header={true} />
      </SpaceContext.Provider>
    );
  });
};

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const legacyVisible = () => ({
  header: container.querySelector('[data-testid="space-header"]') != null,
  noteBody: container.querySelector('[data-testid="space-note-body"]') != null,
  outer: container.querySelector('[data-testid="space-outer"]') != null,
  backlinks: container.querySelector('[data-testid="backlinks"]') != null,
  hubTabs: container.querySelector('[data-testid="hub-tabs"]') != null,
  banner: container.querySelector(".mk-hub-tabs-error") != null,
});

describe("SpaceInner hub-tabs mount seam (ADR 0065 H1)", () => {
  it("renders the legacy page when no declaration exists", async () => {
    await render(makeSuperstate({}));

    expect(legacyVisible()).toEqual({
      header: true,
      noteBody: true,
      outer: true,
      backlinks: true,
      hubTabs: false,
      banner: false,
    });
  });

  it("renders the legacy page for a non-declaration tabs value (no banner)", async () => {
    await render(makeSuperstate({ tabs: ["Next", "State"] }));

    expect(legacyVisible()).toEqual({
      header: true,
      noteBody: true,
      outer: true,
      backlinks: true,
      hubTabs: false,
      banner: false,
    });
  });

  it("swaps the body for HubTabsView on a valid declaration (header stays)", async () => {
    await render(makeSuperstate({ tabs: VALID_TABS }));

    expect(legacyVisible()).toEqual({
      header: true,
      noteBody: false,
      outer: false,
      backlinks: false,
      hubTabs: true,
      banner: false,
    });
    expect(
      container
        .querySelector('[data-testid="hub-tabs"]')
        .getAttribute("data-tab-count")
    ).toBe("2");
  });

  it("renders the legacy page when the hubTabbedViews kill-switch is OFF", async () => {
    await render(
      makeSuperstate({ tabs: VALID_TABS, hubTabbedViews: false })
    );

    expect(legacyVisible()).toEqual({
      header: true,
      noteBody: true,
      outer: true,
      backlinks: true,
      hubTabs: false,
      banner: false,
    });
  });

  it("renders legacy + a visible violation banner for an invalid attempt", async () => {
    await render(
      makeSuperstate({ tabs: [{ id: "NEXT", page: "Tabs/Next.md" }] })
    );

    const state = legacyVisible();
    expect(state.hubTabs).toBe(false);
    expect(state.noteBody).toBe(true);
    expect(state.outer).toBe(true);
    expect(state.banner).toBe(true);
    expect(
      container.querySelector(".mk-hub-tabs-error").textContent
    ).toContain("NEXT");
  });

  it("re-reads the declaration when the folder note's path state updates", async () => {
    const superstate = makeSuperstate({});
    await render(superstate);
    expect(legacyVisible().hubTabs).toBe(false);

    superstate.pathsIndex.set(NOTE_PATH, {
      path: NOTE_PATH,
      metadata: { property: { tabs: VALID_TABS } },
    });
    await act(async () => {
      superstate.eventsDispatcher.dispatch("pathStateUpdated", {
        path: NOTE_PATH,
      });
    });

    expect(legacyVisible().hubTabs).toBe(true);
  });
});
