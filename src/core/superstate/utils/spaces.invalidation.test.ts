jest.mock("core/utils/contexts/context", () => ({
  reorderPathsInContext: jest.fn(() => Promise.resolve()),
}));

import { movePathToNewSpaceAtIndex, updatePathRankInSpace } from "./spaces";

describe("updatePathRankInSpace invalidated reload propagation", () => {
  it("suppresses the space event when every follow-on reload is invalidated", async () => {
    let queued!: () => Promise<unknown>;
    const superstate = {
      spacesIndex: new Map([["Space", { path: "Space", space: { path: "Space" } }]]),
      spacesMap: { getInverse: jest.fn(() => new Set(["A.md", "B.md"])) },
      reloadPath: jest.fn().mockResolvedValue(false),
      dispatchEvent: jest.fn(),
      addToContextStateQueue: jest.fn((operation: () => Promise<unknown>) => { queued = operation; }),
      spaceManager: {},
    } as any;

    await updatePathRankInSpace(superstate, "A.md", 1, "Space");
    await queued();

    expect(superstate.reloadPath).toHaveBeenCalledTimes(2);
    expect(superstate.dispatchEvent).not.toHaveBeenCalled();
  });
});

describe("movePathToNewSpaceAtIndex rename result boundary", () => {
  it("does not enqueue a rank update when renamePath resolves falsy", async () => {
    const superstate = {
      pathsIndex: new Map([
        [
          "Source/Note.md",
          { path: "Source/Note.md", name: "Note.md" },
        ],
      ]),
      spaceManager: {
        pathExists: jest.fn().mockResolvedValue(false),
        renamePath: jest.fn().mockResolvedValue(null),
      },
      ui: { notify: jest.fn() },
      spacesIndex: new Map([
        ["Target", { path: "Target", space: { path: "Target" } }],
      ]),
      spacesMap: { getInverse: jest.fn(() => new Set()) },
      reloadPath: jest.fn(),
      dispatchEvent: jest.fn(),
      addToContextStateQueue: jest.fn(),
    } as any;

    await movePathToNewSpaceAtIndex(
      superstate,
      superstate.pathsIndex.get("Source/Note.md"),
      "Target",
      3,
      false
    );

    expect(superstate.spaceManager.renamePath).toHaveBeenCalledWith(
      "Source/Note.md",
      "Target/Note.md"
    );
    expect(superstate.addToContextStateQueue).not.toHaveBeenCalled();
  });
});
