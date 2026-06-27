/**
 * @jest-environment jsdom
 */
import React from "react";
import { act } from "react-dom/test-utils";
import { createRoot, Root } from "react-dom/client";
import { ContextCell } from "./ContextCell";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const addPathToSpaceAtIndex = jest.fn();
const newPathInSpace = jest.fn();
const newRowPathInSpace = jest.fn();

jest.mock("core/superstate/utils/spaces", () => ({
  addPathToSpaceAtIndex: (...args: unknown[]) => addPathToSpaceAtIndex(...args),
  newPathInSpace: (...args: unknown[]) => newPathInSpace(...args),
  newRowPathInSpace: (...args: unknown[]) => newRowPathInSpace(...args),
}));

jest.mock("core/react/components/UI/Crumbs/PathCrumb", () => ({
  PathCrumb: (props: any) => <span>{props.children}</span>,
}));

let optionCellProps: any;
jest.mock("./OptionCell", () => ({
  OptionCellBase: (props: any) => {
    optionCellProps = props;
    return <div data-testid="context-cell" />;
  },
}));

const makeSuperstate = () => {
  const spacesMap = {
    getInverse: jest.fn(() => ["Linked/New Item.md"]),
  };
  return {
    spacesMap,
    pathsIndex: new Map(),
    spacesIndex: new Map([["Linked", { path: "Linked" }]]),
    spaceManager: {
      resolvePath: jest.fn(() => "Linked"),
    },
    ui: {},
  } as any;
};

describe("ContextCell row creation", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    addPathToSpaceAtIndex.mockClear();
    newPathInSpace.mockClear();
    newRowPathInSpace.mockClear();
    optionCellProps = null;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("creates a missing linked row through the shared database row-create helper", async () => {
    const superstate = makeSuperstate();

    await act(async () => {
      root.render(
        <ContextCell
          compactMode={false}
          contextPath="Source"
          contextTable={{}}
          editMode={null}
          initialValue=""
          multi={false}
          path="Source/Host.md"
          property={{ name: "Relation", type: "context" } as any}
          propertyValue={JSON.stringify({ space: "Linked", field: "parent" })}
          saveValue={jest.fn()}
          setEditMode={jest.fn()}
          source="Source"
          superstate={superstate}
        />
      );
    });

    await act(async () => {
      optionCellProps.menuProps().saveOptions([], []);
    });

    expect(newRowPathInSpace).toHaveBeenCalledTimes(1);
    expect(newRowPathInSpace).toHaveBeenCalledWith(
      superstate,
      { path: "Linked" },
      "Linked/New Item.md",
      true
    );
    expect(newPathInSpace).not.toHaveBeenCalled();
    expect(addPathToSpaceAtIndex).not.toHaveBeenCalled();
  });
});
