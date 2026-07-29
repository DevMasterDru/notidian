/**
 * @jest-environment jsdom
 */
// ADR 0065 (Atlas ADR-0096 H1, bd Notidian-pb7p.1) — HubTabsView render
// contract:
//   - the tab bar lists EVERY declared tab in declaration order, always all
//     visible (no dropdown), with the active tab marked;
//   - the active tab's composition note renders through NoteView, resolved
//     hub-folder-relative first, then vault-absolute;
//   - clicking a tab switches the mounted composition (previous one unmounts)
//     and persists activeHubTab via saveSpaceMetadataValue against the SPACE
//     path (SpaceDefinition -> .notidian/def.json, Atlas ADR-0066 D4);
//   - a persisted id no longer declared falls back to the first tab;
//   - a tab whose page note is missing renders the error surface in the
//     content area while the bar stays.
//
// NoteView and saveSpaceMetadataValue are mocked (same pattern as
// SpaceNoteBody.dom.test.tsx) so the test exercises the real HubTabsView
// logic without the Obsidian editor or a real write path.
import React from "react";
import { act } from "react-dom/test-utils";
import { createRoot, Root } from "react-dom/client";
import { SpaceState } from "shared/types/PathState";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

jest.mock("core/react/context/SpaceContext", () => ({
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  SpaceContext: require("react").createContext(null),
}));
jest.mock("makemd-core", () => ({}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { SpaceContext } = require("core/react/context/SpaceContext");

jest.mock("core/react/components/PathView/NoteView", () => ({
  NoteView: (props: any) => (
    <div
      data-testid="note-view"
      data-path={props.path}
      data-read-only={String(props.readOnly ?? false)}
    >
      note-content
    </div>
  ),
}));

const saveCalls: Array<{ path: string; key: string; value: unknown }> = [];
jest.mock("core/superstate/utils/spaces", () => ({
  saveSpaceMetadataValue: jest.fn(
    async (_superstate: any, path: string, key: string, value: unknown) => {
      saveCalls.push({ path, key, value });
    }
  ),
}));

import { HubTabsView } from "./HubTabsView";

const TABS = [
  { id: "next", page: "Tabs/Next.md" },
  { id: "state", page: "Tabs/State.md", name: "Current State" },
  { id: "review", page: "Tabs/Review.md" },
];

const makeSuperstate = (existingPaths: string[]) =>
  ({
    settings: {},
    pathsIndex: new Map(existingPaths.map((p) => [p, { path: p }])),
  } as any);

const makeSpaceState = (metadata: Record<string, unknown> = {}): SpaceState =>
  ({
    name: "Life HQ",
    path: "Life HQ",
    type: "folder",
    metadata,
    space: { notePath: "Life HQ/Life HQ.md" },
  } as any);

let container: HTMLDivElement;
let root: Root;

const render = async (
  superstate: any,
  spaceState: SpaceState,
  tabs = TABS,
  readMode = false
) => {
  await act(async () => {
    root.render(
      <SpaceContext.Provider value={{ spaceState, readMode }}>
        <HubTabsView superstate={superstate} tabs={tabs} />
      </SpaceContext.Provider>
    );
  });
};

beforeEach(() => {
  saveCalls.length = 0;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const clickTab = async (label: string) => {
  const button = Array.from(
    container.querySelectorAll("button.mk-hub-tab")
  ).find((el) => el.textContent == label) as HTMLButtonElement;
  expect(button).toBeTruthy();
  await act(async () => {
    button.dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true })
    );
  });
};

describe("HubTabsView (ADR 0065 H1)", () => {
  it("renders every declared tab in order with labels and active marking", async () => {
    const superstate = makeSuperstate([
      "Life HQ/Tabs/Next.md",
      "Life HQ/Tabs/State.md",
      "Life HQ/Tabs/Review.md",
    ]);
    await render(superstate, makeSpaceState());

    const buttons = Array.from(
      container.querySelectorAll("button.mk-hub-tab")
    );
    expect(buttons.map((b) => b.textContent)).toEqual([
      "Next",
      "Current State",
      "Review",
    ]);
    expect(buttons[0].classList.contains("mk-active")).toBe(true);
    expect(buttons[0].getAttribute("aria-selected")).toBe("true");
    expect(buttons[1].getAttribute("aria-selected")).toBe("false");
  });

  it("renders the active tab's page hub-folder-relative through NoteView", async () => {
    const superstate = makeSuperstate(["Life HQ/Tabs/Next.md"]);
    await render(superstate, makeSpaceState());

    const note = container.querySelector('[data-testid="note-view"]');
    expect(note).not.toBeNull();
    expect(note.getAttribute("data-path")).toBe("Life HQ/Tabs/Next.md");
  });

  it("falls back to a vault-absolute page when no hub-relative note exists", async () => {
    const superstate = makeSuperstate(["Tabs/Next.md"]);
    await render(superstate, makeSpaceState());

    expect(
      container
        .querySelector('[data-testid="note-view"]')
        .getAttribute("data-path")
    ).toBe("Tabs/Next.md");
  });

  it("switches the mounted composition on click and persists activeHubTab", async () => {
    const superstate = makeSuperstate([
      "Life HQ/Tabs/Next.md",
      "Life HQ/Tabs/State.md",
    ]);
    await render(superstate, makeSpaceState());

    await clickTab("Current State");

    const notes = container.querySelectorAll('[data-testid="note-view"]');
    expect(notes).toHaveLength(1);
    expect(notes[0].getAttribute("data-path")).toBe("Life HQ/Tabs/State.md");
    expect(saveCalls).toEqual([
      { path: "Life HQ", key: "activeHubTab", value: "state" },
    ]);
  });

  it("starts on the persisted tab when it is still declared", async () => {
    const superstate = makeSuperstate(["Life HQ/Tabs/State.md"]);
    await render(superstate, makeSpaceState({ activeHubTab: "state" }));

    expect(
      container
        .querySelector('[data-testid="note-view"]')
        .getAttribute("data-path")
    ).toBe("Life HQ/Tabs/State.md");
  });

  it("falls back to the first tab when the persisted id is no longer declared", async () => {
    const superstate = makeSuperstate(["Life HQ/Tabs/Next.md"]);
    await render(superstate, makeSpaceState({ activeHubTab: "retired" }));

    expect(
      container
        .querySelector('[data-testid="note-view"]')
        .getAttribute("data-path")
    ).toBe("Life HQ/Tabs/Next.md");
  });

  it("renders the error surface for a missing page note while the bar stays", async () => {
    const superstate = makeSuperstate([]);
    await render(superstate, makeSpaceState());

    expect(container.querySelectorAll("button.mk-hub-tab")).toHaveLength(3);
    expect(container.querySelector('[data-testid="note-view"]')).toBeNull();
    const error = container.querySelector(".mk-notidian-embed-error");
    expect(error).not.toBeNull();
    expect(error.textContent).toContain("Tabs/Next.md");
  });

  it("passes the space read mode through to the composition", async () => {
    const superstate = makeSuperstate(["Life HQ/Tabs/Next.md"]);
    await render(superstate, makeSpaceState(), TABS, true);

    expect(
      container
        .querySelector('[data-testid="note-view"]')
        .getAttribute("data-read-only")
    ).toBe("true");
  });
});
