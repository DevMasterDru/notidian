import { applyNewRowTypeProfileDefaults } from "core/utils/contexts/typeProfileDefaults";
import { newRowPathInSpace } from "./spaces";

jest.mock("core/utils/contexts/typeProfileDefaults", () => ({
  applyNewRowTypeProfileDefaults: jest.fn(async (): Promise<void> => undefined),
}));

const applyDefaultsMock =
  applyNewRowTypeProfileDefaults as jest.MockedFunction<
    typeof applyNewRowTypeProfileDefaults
  >;

const makeSuperstate = () =>
  ({
    settings: { spaceSubFolder: ".notidian" },
    formulaContext: {},
    pathsIndex: new Map(),
    spacesMap: new Map(),
    ui: { openPath: jest.fn() },
    spaceManager: {
      addTag: jest.fn(),
      createItemAtPath: jest.fn(),
      copyPath: jest.fn(),
      pathExists: jest.fn(),
    },
  } as any);

const makeSpace = (metadata: Record<string, unknown> = {}) =>
  ({
    type: "folder",
    path: "Projects",
    name: "Projects",
    metadata,
  } as any);

beforeEach(() => {
  applyDefaultsMock.mockClear();
});

describe("newRowPathInSpace", () => {
  it("copies the database default template and returns the copied path without opening", async () => {
    const superstate = makeSuperstate();
    const space = makeSpace({ template: "Default.md" });
    superstate.spaceManager.pathExists.mockResolvedValue(true);
    superstate.spaceManager.copyPath.mockResolvedValue("Projects/New Card.md");

    const path = await newRowPathInSpace(
      superstate,
      space,
      "New Card",
      true
    );

    expect(path).toBe("Projects/New Card.md");
    expect(superstate.spaceManager.pathExists).toHaveBeenCalledWith(
      "Projects/.notidian/templates/Default.md"
    );
    expect(superstate.spaceManager.copyPath).toHaveBeenCalledWith(
      "Projects/.notidian/templates/Default.md",
      "Projects",
      "New Card"
    );
    expect(superstate.spaceManager.createItemAtPath).not.toHaveBeenCalled();
    expect(superstate.ui.openPath).not.toHaveBeenCalled();
    expect(applyDefaultsMock).not.toHaveBeenCalled();
  });

  it("falls back to the empty row path and Type Profile defaults when no template is configured", async () => {
    const superstate = makeSuperstate();
    const space = makeSpace();
    superstate.spaceManager.createItemAtPath.mockResolvedValue(
      "Projects/New Card.md"
    );

    const path = await newRowPathInSpace(
      superstate,
      space,
      "New Card",
      true
    );

    expect(path).toBe("Projects/New Card.md");
    expect(superstate.spaceManager.copyPath).not.toHaveBeenCalled();
    expect(superstate.spaceManager.createItemAtPath).toHaveBeenCalledWith(
      "Projects",
      "md",
      "New Card",
      undefined
    );
    expect(applyDefaultsMock).toHaveBeenCalledWith(
      superstate,
      "Projects",
      "Projects/New Card.md"
    );
    expect(superstate.ui.openPath).not.toHaveBeenCalled();
  });
});
