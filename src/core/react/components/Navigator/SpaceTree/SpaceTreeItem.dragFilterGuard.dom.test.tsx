/**
 * @jest-environment jsdom
 */
// Offline (jsdom) render-contract coverage for the Navigator drag guard under an
// active text filter (bd Notidian-21l4). filterTreeByQuery (spaces.ts) emits every
// synthetic node with `sortable:false` -- the encoded intent is "DnD disabled while
// a query is active" -- but TreeItem's onDragStarted/onDragOver/onDragEnded used to
// fire unconditionally, so a drop during a filter would run id-driven
// projection/rank math (getProjection / dropPathsInTree) against the sparse,
// re-indexed, ancestor-only filtered flattenedTree instead of the real tree.
//
// This locks the guard: a `sortable === false` node is inert (props.dragStarted /
// props.dragOver / props.dragEnded and superstate.ui.dragStarted are NEVER called),
// while an ordinary node (sortable:true, the unfiltered default) still drives every
// handler -- the regression guard proving the strict `=== false` check has zero
// blast radius on normal DnD.
//
// The drop-commit rank/parent math itself is pinned in dragPath.test.ts /
// dropPath.test.ts; this test only proves the handlers are gated, not re-derived.
import React from "react";
import { act } from "react-dom/test-utils";
import { createRoot, Root } from "react-dom/client";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

// --- Mock the heavy leaf UI + menu modules to inert sentinels --------------
// TreeItem is a large drag/drop + sticker + menu leaf; none of that surface is in
// scope for the DnD guard, so stub it out (same "mock the heavy leaf" pattern as
// MainList.filterKillSwitch.dom.test.tsx). Menu builders are only reached on click,
// never during render or a drag event, but stubbing them keeps the import graph flat.
jest.mock("shared/components/PathSticker", () => ({
  PathStickerView: () => <div data-testid="sticker" />,
  PathStickerContainer: () => <div data-testid="sticker-container" />,
}));
jest.mock("core/react/components/UI/Toggles/CollapseToggle", () => ({
  CollapseToggle: () => <div data-testid="collapse-toggle" />,
}));
jest.mock("core/react/components/UI/Menus/navigator/pathContextMenu", () => ({
  showPathContextMenu: jest.fn(),
  triggerMultiPathMenu: jest.fn(),
}));
jest.mock("core/react/components/UI/Menus/properties/linkMenu", () => ({
  showLinkMenu: jest.fn(),
}));
jest.mock("core/react/components/UI/Menus/navigator/showSpaceAddMenu", () => ({
  defaultAddAction: jest.fn(),
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { TreeItem } = require("./SpaceTreeItem");

const PATH = "space/child.md";

const makePathState = (): any => ({
  path: PATH,
  name: "child",
  type: "file",
  label: { name: "child", sticker: "", color: "" },
  metadata: { isFolder: false },
  linkedSpaces: [],
  liveSpaces: [],
  readOnly: false,
});

const makeSuperstate = () => {
  const dragStarted = jest.fn();
  const superstate: any = {
    settings: {
      spacesStickers: false,
      editStickerInSidebar: false,
      filePreviewOnHover: false,
      expandFolderOnClick: false,
      overrideNativeMenu: false,
      spaceRowHeight: 29,
    },
    pathsIndex: new Map([[PATH, makePathState()]]),
    spacesIndex: new Map(),
    ui: {
      getSticker: () => "<svg></svg>",
      // InteractionType.Mouse (=1) -- NOT touch, so getRootProps() is applied.
      primaryInteractionType: () => 1,
      dragStarted,
      setDragLabel: jest.fn(),
      openPath: jest.fn(),
      isEverViewOpen: () => false,
    },
    eventsDispatcher: {
      addListener: jest.fn(),
      removeListener: jest.fn(),
    },
  };
  return { superstate, uiDragStarted: dragStarted };
};

// A TreeNode shaped like what the tree flattener produces. `sortable` is the only
// axis under test: false = filter-emitted (inert), true = ordinary draggable row.
const makeData = (sortable: boolean): any => ({
  id: PATH,
  parentId: "space",
  depth: 1,
  index: 0,
  space: "space",
  sortable,
  type: "file",
  path: PATH,
  item: { path: PATH, rank: 0 },
  childrenCount: 0,
  collapsed: false,
  rank: 0,
});

const makeProps = (sortable: boolean) => {
  const { superstate, uiDragStarted } = makeSuperstate();
  const dragStarted = jest.fn();
  const dragOver = jest.fn();
  const dragEnded = jest.fn();
  const props: any = {
    id: PATH,
    disabled: false,
    childCount: 0,
    clone: false,
    collapsed: false,
    depth: 1,
    ghost: false,
    active: false,
    selected: false,
    onSelectRange: jest.fn(),
    indicator: false,
    indentationWidth: 20,
    data: makeData(sortable),
    superstate,
    style: {},
    onCollapse: jest.fn(),
    dragStarted,
    dragOver,
    dragEnded,
    dragActive: false,
  };
  return { props, dragStarted, dragOver, dragEnded, uiDragStarted };
};

describe("TreeItem DnD guard under active filter (Notidian-21l4)", () => {
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

  const renderItem = (props: any) => {
    act(() => {
      root.render(<TreeItem {...props} />);
    });
    const wrapper = container.querySelector(".mk-tree-wrapper") as HTMLElement;
    expect(wrapper).not.toBeNull();
    return wrapper;
  };

  const fire = (wrapper: HTMLElement, type: "dragstart" | "dragover" | "drop") => {
    act(() => {
      wrapper.dispatchEvent(new Event(type, { bubbles: true }));
    });
  };

  it("sortable:false (filter-emitted) node: dragstart/dragover/drop are all inert", () => {
    const { props, dragStarted, dragOver, dragEnded, uiDragStarted } =
      makeProps(false);
    const wrapper = renderItem(props);

    fire(wrapper, "dragstart");
    fire(wrapper, "dragover");
    fire(wrapper, "drop");

    expect(dragStarted).not.toHaveBeenCalled();
    expect(uiDragStarted).not.toHaveBeenCalled();
    expect(dragOver).not.toHaveBeenCalled();
    expect(dragEnded).not.toHaveBeenCalled();
  });

  it("ordinary sortable node (unfiltered default): dragstart drives dragStarted + ui.dragStarted", () => {
    const { props, dragStarted, uiDragStarted } = makeProps(true);
    const wrapper = renderItem(props);

    fire(wrapper, "dragstart");

    expect(dragStarted).toHaveBeenCalledWith(PATH);
    expect(uiDragStarted).toHaveBeenCalledTimes(1);
  });

  it("ordinary sortable node: dragover and drop still reach their handlers", () => {
    const { props, dragOver, dragEnded } = makeProps(true);
    const wrapper = renderItem(props);

    fire(wrapper, "dragover");
    fire(wrapper, "drop");

    expect(dragOver).toHaveBeenCalledTimes(1);
    expect(dragOver.mock.calls[0][1]).toBe(PATH);
    expect(dragEnded).toHaveBeenCalledTimes(1);
    expect(dragEnded.mock.calls[0][1]).toBe(PATH);
  });

  it("sortable:undefined (legacy node with no flag) is NOT blocked by the strict === false guard", () => {
    // Regression axis: the guard is strict `=== false`, so a node that predates the
    // flag (sortable undefined) must still drag -- only filter-emitted nodes are inert.
    const { props, dragStarted, uiDragStarted } = makeProps(true);
    delete props.data.sortable;
    const wrapper = renderItem(props);

    fire(wrapper, "dragstart");

    expect(dragStarted).toHaveBeenCalledWith(PATH);
    expect(uiDragStarted).toHaveBeenCalledTimes(1);
  });
});
