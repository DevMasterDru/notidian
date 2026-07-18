/**
 * @jest-environment jsdom
 */
// Offline (jsdom) render-contract coverage for the navigator text filter's
// DEFAULT-ON kill-switch (bd Notidian-nrjb, settings.enableNavigatorTextFilter)
// -- the wiring half of the bead that the pure spaces.filterTreeByQuery.test.ts
// suite explicitly does NOT cover (its own header comment says so). Every other
// entry in DOCUMENTED_KILL_SWITCHES (rowVirtualization, viewSettingsInlineBar,
// subItemsSetup, ...) has a dedicated *.dom.test.tsx proving the OFF-state
// renders byte-for-byte legacy behavior; this fills that gap for
// enableNavigatorTextFilter (review catch on Notidian-nrjb).
//
// What this locks down in MainList.tsx:
//   - flag OFF:  no `.mk-navigator-filter` box renders at all, AND
//                <SpaceTreeComponent> receives filterQuery === undefined (not
//                ""), so its `trimmedFilterQuery.length > 0` branch can never
//                fire -- the pre-feature expandedSpaces-driven retrieveData()
//                path stays byte-for-byte unchanged.
//   - flag ON:   the box renders, typing updates local state, and that exact
//                live value is threaded through to <SpaceTreeComponent>'s
//                filterQuery prop; the clear button resets both the input and
//                the prop back to "".
//
// SpaceTreeComponent is mocked to a sentinel (it is a huge drag/drop +
// NavigatorContext + virtualization tree entirely out of scope for this
// kill-switch gate) so the test exercises MainList's OWN gating logic in
// isolation, the same "mock the heavy leaf, assert the flag-branch wiring"
// pattern TableView.virtualization.dom.test.tsx uses for the rowVirtualization
// kill-switch.
import React from "react";
import { act } from "react-dom/test-utils";
import { createRoot, Root } from "react-dom/client";
import { EventDispatcher } from "shared/utils/dispatchers/dispatcher";
import { SuperstateEvent } from "shared/types/PathState";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

// --- Mock the heavy leaf children to recognizable sentinels ---------------
const spaceTreeSpy = jest.fn();
jest.mock("core/react/components/Navigator/SpaceTree/SpaceTreeView", () => ({
  SpaceTreeComponent: (props: any) => {
    spaceTreeSpy(props);
    return (
      <div
        data-testid="space-tree"
        data-filter-query={
          props.filterQuery === undefined ? "__undefined__" : props.filterQuery
        }
      />
    );
  },
}));
jest.mock("./MainMenu", () => ({
  MainMenu: () => <div data-testid="main-menu" />,
}));
jest.mock("./Focuses/FocusSelector", () => ({
  FocusSelector: () => <div data-testid="focus-selector" />,
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { MainList } = require("./MainList");

const makeSuperstate = (enableNavigatorTextFilter: boolean): any => ({
  settings: { enableNavigatorTextFilter },
  ui: {
    getSticker: () => "<svg></svg>",
    // InteractionType.Mouse (=1), i.e. NOT touch -- irrelevant to this gate,
    // just needs to resolve without throwing.
    primaryInteractionType: () => 1,
  },
  eventsDispatcher: new EventDispatcher<SuperstateEvent>(),
});

const typeIntoInput = (input: HTMLInputElement, value: string) => {
  const nativeSetter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    "value"
  )!.set!;
  nativeSetter.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
};

describe("MainList navigator text-filter kill-switch (Notidian-nrjb)", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    spaceTreeSpy.mockClear();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("flag OFF: renders no filter box and passes filterQuery=undefined to SpaceTreeComponent", async () => {
    await act(async () => {
      root.render(<MainList superstate={makeSuperstate(false)} />);
    });

    expect(container.querySelector(".mk-navigator-filter")).toBeNull();
    const tree = container.querySelector('[data-testid="space-tree"]')!;
    expect(tree).not.toBeNull();
    expect(tree.getAttribute("data-filter-query")).toBe("__undefined__");
    expect(spaceTreeSpy).toHaveBeenLastCalledWith(
      expect.objectContaining({
        filterQuery: undefined,
        additionalMatchPaths: undefined,
      })
    );
  });

  it("flag ON: renders the filter box and passes the live query to SpaceTreeComponent", async () => {
    await act(async () => {
      root.render(<MainList superstate={makeSuperstate(true)} />);
    });

    const filterBox = container.querySelector(".mk-navigator-filter");
    expect(filterBox).not.toBeNull();
    const input = container.querySelector(
      ".mk-navigator-filter-input"
    ) as HTMLInputElement;
    expect(input).not.toBeNull();
    // Starts blank -- an empty string (not undefined): the tree still takes
    // the filterTreeByQuery branch's own "" passthrough semantics, not
    // MainList's off-switch semantics.
    expect(
      container
        .querySelector('[data-testid="space-tree"]')!
        .getAttribute("data-filter-query")
    ).toBe("");
    // No clear button while the query is blank.
    expect(container.querySelector(".mk-navigator-filter-clear")).toBeNull();

    await act(async () => {
      typeIntoInput(input, "alpha");
    });

    expect(input.value).toBe("alpha");
    expect(
      container
        .querySelector('[data-testid="space-tree"]')!
        .getAttribute("data-filter-query")
    ).toBe("alpha");
    const clearButton = container.querySelector(
      ".mk-navigator-filter-clear"
    ) as HTMLButtonElement;
    expect(clearButton).not.toBeNull();

    await act(async () => {
      clearButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(input.value).toBe("");
    expect(
      container
        .querySelector('[data-testid="space-tree"]')!
        .getAttribute("data-filter-query")
    ).toBe("");
    expect(container.querySelector(".mk-navigator-filter-clear")).toBeNull();
  });

  it("rerenders the mounted Navigator when settingsChanged toggles the kill-switch", async () => {
    const superstate = makeSuperstate(true);
    await act(async () => {
      root.render(<MainList superstate={superstate} />);
    });
    expect(container.querySelector(".mk-navigator-filter")).not.toBeNull();

    superstate.settings.enableNavigatorTextFilter = false;
    await act(async () => {
      await superstate.eventsDispatcher.dispatchEvent("settingsChanged", null);
    });

    expect(container.querySelector(".mk-navigator-filter")).toBeNull();
    expect(spaceTreeSpy).toHaveBeenLastCalledWith(
      expect.objectContaining({
        filterQuery: undefined,
        additionalMatchPaths: undefined,
      })
    );

    superstate.settings.enableNavigatorTextFilter = true;
    await act(async () => {
      await superstate.eventsDispatcher.dispatchEvent("settingsChanged", null);
    });

    expect(container.querySelector(".mk-navigator-filter")).not.toBeNull();
  });
});
