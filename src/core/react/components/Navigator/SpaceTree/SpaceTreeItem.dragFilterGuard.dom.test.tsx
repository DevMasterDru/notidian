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
// The collapse caret is a leaf, but its onToggle IS in scope for the
// filtered-caret no-op guard below, so wire the mock's click through to the
// real onToggle prop (the real CollapseToggle also just forwards a click to
// onToggle). A file/space node renders no group caret, so this mock is inert
// for the DnD tests and only exercised by the filtered-group caret test.
jest.mock("core/react/components/UI/Toggles/CollapseToggle", () => ({
  CollapseToggle: (props: any) => (
    <button
      data-testid="collapse-toggle"
      onClick={(e) => props.onToggle && props.onToggle(!props.collapsed, e)}
    />
  ),
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
  const saveSettings = jest.fn();
  const superstate: any = {
    settings: {
      spacesStickers: false,
      editStickerInSidebar: false,
      filePreviewOnHover: false,
      expandFolderOnClick: false,
      overrideNativeMenu: false,
      spaceRowHeight: 29,
      // Persisted collapse state a caret toggle would rewrite (see handleCollapse
      // in SpaceTreeView). The filtered-caret guard must leave this untouched.
      expandedSpaces: [] as string[],
    },
    saveSettings,
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
  return { superstate, uiDragStarted: dragStarted, saveSettings };
};

// A TreeNode shaped like what the tree flattener produces. Two INDEPENDENT axes:
//  - `filtered`: set true ONLY by filterTreeByQuery (a text filter is active) ->
//    the DnD-inert signal the guard keys off.
//  - `sortable`: whether the space is manually rank-ordered; false for any
//    non-rank sort in the NORMAL tree. It must NOT affect the DnD guard.
type DataOpts = {
  sortable?: boolean;
  filtered?: boolean;
  type?: "file" | "space" | "group";
  childrenCount?: number;
};

const makeData = (opts: DataOpts = {}): any => {
  const node: any = {
    id: PATH,
    parentId: "space",
    depth: 1,
    index: 0,
    space: "space",
    type: opts.type ?? "file",
    path: PATH,
    item: { path: PATH, rank: 0 },
    childrenCount: opts.childrenCount ?? 0,
    collapsed: false,
    rank: 0,
  };
  if ("sortable" in opts) node.sortable = opts.sortable;
  if ("filtered" in opts) node.filtered = opts.filtered;
  return node;
};

const makeProps = (dataOpts: DataOpts = {}) => {
  const { superstate, uiDragStarted, saveSettings } = makeSuperstate();
  const dragStarted = jest.fn();
  const dragOver = jest.fn();
  const dragEnded = jest.fn();
  // Mirror handleCollapse (SpaceTreeView): a real caret toggle rewrites
  // settings.expandedSpaces AND calls saveSettings(). If the filtered-caret
  // guard fails, this fires and mutates persisted state.
  const onCollapse = jest.fn((node: any) => {
    superstate.settings.expandedSpaces = [
      ...superstate.settings.expandedSpaces,
      node.id,
    ];
    superstate.saveSettings();
  });
  const props: any = {
    id: PATH,
    disabled: false,
    childCount: dataOpts.childrenCount ?? 0,
    clone: false,
    collapsed: false,
    depth: dataOpts.type === "group" ? 0 : 1,
    ghost: false,
    active: false,
    selected: false,
    onSelectRange: jest.fn(),
    indicator: false,
    indentationWidth: 20,
    data: makeData(dataOpts),
    superstate,
    style: {},
    onCollapse,
    dragStarted,
    dragOver,
    dragEnded,
    dragActive: false,
  };
  return { props, dragStarted, dragOver, dragEnded, uiDragStarted, superstate, saveSettings, onCollapse };
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

  // ---------------------------------------------------------------------------
  // NATIVE DRAG-GHOST (Notidian-uc8y): app-level DnD was already inert on a
  // filtered row (handlers early-return above), but the row still advertised
  // draggable=true, so the OS painted a native drag-ghost on grab. The row must
  // set draggable={!data.filtered} so the native affordance is off too.
  // ---------------------------------------------------------------------------
  it("filtered row is NOT natively draggable (no OS drag-ghost)", () => {
    const { props } = makeProps({ filtered: true, sortable: false });
    const wrapper = renderItem(props);
    // React renders `draggable` as an enumerated attribute ("true"/"false").
    expect(wrapper.getAttribute("draggable")).toBe("false");
  });

  it("an unfiltered row stays natively draggable (draggable=true)", () => {
    const { props } = makeProps({ sortable: true });
    const wrapper = renderItem(props);
    expect(wrapper.getAttribute("draggable")).toBe("true");
  });
});

// ---------------------------------------------------------------------------
// INERT COLLAPSE CARET (Notidian-uc8y): filterTreeByQuery emits a depth-0 group
// node with a CollapseToggle whenever it has children, but the filtered tree
// IGNORES expandedSpaces (it always shows matches expanded). Clicking that
// caret looked inert yet still ran handleCollapse -> rewrote
// settings.expandedSpaces + saveSettings(). The guard makes the caret a no-op
// on a filtered node while leaving the normal-tree caret fully functional.
// ---------------------------------------------------------------------------
describe("TreeItem collapse-caret guard under active filter (Notidian-uc8y)", () => {
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

  const clickCaret = () => {
    const caret = container.querySelector(
      '[data-testid="collapse-toggle"]'
    ) as HTMLElement;
    expect(caret).not.toBeNull();
    act(() => {
      caret.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
  };

  it("filtered group caret click is a NO-OP: onCollapse never fires, expandedSpaces + saveSettings untouched", () => {
    const { props, onCollapse, superstate, saveSettings } = makeProps({
      type: "group",
      childrenCount: 2,
      filtered: true,
      sortable: false,
    });
    renderItem(props);

    clickCaret();

    expect(onCollapse).not.toHaveBeenCalled();
    expect(saveSettings).not.toHaveBeenCalled();
    expect(superstate.settings.expandedSpaces).toEqual([]);
  });

  it("CONTROL: an UNFILTERED group caret click still toggles collapse (onCollapse + saveSettings + expandedSpaces mutate)", () => {
    const { props, onCollapse, superstate, saveSettings } = makeProps({
      type: "group",
      childrenCount: 2,
      // filtered unset -> normal tree; the caret must keep working.
      sortable: true,
    });
    renderItem(props);

    clickCaret();

    expect(onCollapse).toHaveBeenCalledTimes(1);
    expect(onCollapse.mock.calls[0][0].id).toBe(PATH);
    expect(saveSettings).toHaveBeenCalledTimes(1);
    expect(superstate.settings.expandedSpaces).toContain(PATH);
  });
});
