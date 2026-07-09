/**
 * @jest-environment jsdom
 */
// Offline (jsdom) render-contract coverage for the Navigator drag guard under an
// active text filter (bd Notidian-21l4). filterTreeByQuery (spaces.ts) tags every
// synthetic node it emits with `filtered:true` -- the encoded intent is "DnD
// disabled while a query is active" -- but TreeItem's
// onDragStarted/onDragOver/onDragEnded used to fire unconditionally, so a drop
// during a filter would run id-driven projection/rank math (getProjection /
// dropPathsInTree) against the sparse, re-indexed, ancestor-only filtered
// flattenedTree instead of the real tree.
//
// CRITICAL blast-radius axis: the guard keys off the DEDICATED `filtered` flag,
// NOT the overloaded `sortable`. `sortable:false` ALSO marks every ordinary row
// of a non-rank-sorted (File name / date / numerical) space in the NORMAL,
// unfiltered tree -- `space.sortable = spaceSort.field == "rank"`
// (superstate.ts) propagated to each child node (SpaceTreeView.tsx). Gating on
// `sortable === false` would silently disable drag-to-move in every
// alphabetically-/date-sorted folder with no filter active (a real regression;
// dropPath.ts:44/63/70 deliberately pass `projected.sortable && newRank` = false
// as a legitimate "move without a manual rank"). These tests pin that a
// non-rank-sorted ordinary row (sortable:false, filtered unset) STAYS draggable.
//
// The drop-commit rank/parent math itself is pinned in dragPath.test.ts /
// dropPath.test.ts; this test only proves the handlers are gated on the right
// signal, not re-derived.
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

// A TreeNode shaped like what the tree flattener produces. Two INDEPENDENT axes:
//  - `filtered`: set true ONLY by filterTreeByQuery (a text filter is active) ->
//    the DnD-inert signal the guard keys off.
//  - `sortable`: whether the space is manually rank-ordered; false for any
//    non-rank sort in the NORMAL tree. It must NOT affect the DnD guard.
const makeData = (opts: { sortable?: boolean; filtered?: boolean } = {}): any => {
  const node: any = {
    id: PATH,
    parentId: "space",
    depth: 1,
    index: 0,
    space: "space",
    type: "file",
    path: PATH,
    item: { path: PATH, rank: 0 },
    childrenCount: 0,
    collapsed: false,
    rank: 0,
  };
  if ("sortable" in opts) node.sortable = opts.sortable;
  if ("filtered" in opts) node.filtered = opts.filtered;
  return node;
};

const makeProps = (dataOpts: { sortable?: boolean; filtered?: boolean } = {}) => {
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
    data: makeData(dataOpts),
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

  it("filtered node (filter-emitted): dragstart/dragover/drop are all inert", () => {
    const { props, dragStarted, dragOver, dragEnded, uiDragStarted } = makeProps({
      filtered: true,
      // filterTreeByQuery also emits sortable:false; prove `filtered` (not
      // `sortable`) is what makes it inert by setting both the way the filter does.
      sortable: false,
    });
    const wrapper = renderItem(props);

    fire(wrapper, "dragstart");
    fire(wrapper, "dragover");
    fire(wrapper, "drop");

    expect(dragStarted).not.toHaveBeenCalled();
    expect(uiDragStarted).not.toHaveBeenCalled();
    expect(dragOver).not.toHaveBeenCalled();
    expect(dragEnded).not.toHaveBeenCalled();
  });

  it("ordinary rank-sorted node (unfiltered default): dragstart drives dragStarted + ui.dragStarted", () => {
    const { props, dragStarted, uiDragStarted } = makeProps({ sortable: true });
    const wrapper = renderItem(props);

    fire(wrapper, "dragstart");

    expect(dragStarted).toHaveBeenCalledWith(PATH);
    expect(uiDragStarted).toHaveBeenCalledTimes(1);
  });

  it("ordinary rank-sorted node: dragover and drop still reach their handlers", () => {
    const { props, dragOver, dragEnded } = makeProps({ sortable: true });
    const wrapper = renderItem(props);

    fire(wrapper, "dragover");
    fire(wrapper, "drop");

    expect(dragOver).toHaveBeenCalledTimes(1);
    expect(dragOver.mock.calls[0][1]).toBe(PATH);
    expect(dragEnded).toHaveBeenCalledTimes(1);
    expect(dragEnded.mock.calls[0][1]).toBe(PATH);
  });

  it("REGRESSION: non-rank-sorted NORMAL row (sortable:false, filtered unset) stays fully draggable", () => {
    // This is the case the previous guard broke: a File-name/date/numerical-sorted
    // folder makes `space.sortable = false` (superstate.ts), propagated to every
    // child node in the NORMAL (no-filter) tree (SpaceTreeView.tsx). With no text
    // filter active, `filtered` is unset -- the row MUST still drag & drop so a
    // cross-space move (dropPath.ts movePathToNewSpaceAtIndex) can commit.
    const { props, dragStarted, dragOver, dragEnded, uiDragStarted } = makeProps({
      sortable: false,
    });
    const wrapper = renderItem(props);

    fire(wrapper, "dragstart");
    fire(wrapper, "dragover");
    fire(wrapper, "drop");

    expect(dragStarted).toHaveBeenCalledWith(PATH);
    expect(uiDragStarted).toHaveBeenCalledTimes(1);
    expect(dragOver).toHaveBeenCalledTimes(1);
    expect(dragOver.mock.calls[0][1]).toBe(PATH);
    expect(dragEnded).toHaveBeenCalledTimes(1);
    expect(dragEnded.mock.calls[0][1]).toBe(PATH);
  });

  it("legacy node with neither flag set is NOT blocked (only filtered nodes are inert)", () => {
    const { props, dragStarted, uiDragStarted } = makeProps({});
    const wrapper = renderItem(props);

    fire(wrapper, "dragstart");

    expect(dragStarted).toHaveBeenCalledWith(PATH);
    expect(uiDragStarted).toHaveBeenCalledTimes(1);
  });
});
