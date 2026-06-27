const newRowPathInSpace = jest.fn();

jest.mock("core/superstate/utils/spaces", () => ({
  newRowPathInSpace: (...args: unknown[]) => newRowPathInSpace(...args),
}));

jest.mock("core/react/components/SpaceView/Contexts/DataTypeView/DataPropertyView", () => ({
  DataPropertyView: (): null => null,
}));
jest.mock("core/react/components/SpaceView/Contexts/TableView/TableView", () => ({
  CellEditMode: {
    EditModeReadOnly: 0,
    EditModeNone: 1,
    EditModeView: 2,
    EditModeValueOnly: 3,
    EditModeActive: 4,
    EditModeAlways: 5,
  },
}));
jest.mock("core/react/context/ContextEditorContext", () => ({
  ContextEditorContext: require("react").createContext(null),
  ContextEditorProvider: ({ children }: any) => children,
}));
jest.mock("core/react/context/FramesMDBContext", () => ({
  FramesMDBProvider: ({ children }: any) => children,
}));
jest.mock("core/react/context/PathContext", () => ({
  PathProvider: ({ children }: any) => children,
}));
jest.mock("core/react/context/SpaceContext", () => ({
  SpaceProvider: ({ children }: any) => children,
}));
jest.mock("core/utils/contexts/pageTitleRename", () => ({
  renamePageTitleForRow: jest.fn(),
}));
jest.mock("core/utils/contexts/typeProfileDefaults", () => ({
  applyNewRowTypeProfileDefaults: jest.fn(),
}));
jest.mock("makemd-core", () => ({}));

import { createDefaultSchemaItemPath } from "./ContextCreateItemModal";

describe("createDefaultSchemaItemPath", () => {
  beforeEach(() => {
    newRowPathInSpace.mockClear();
  });

  it("creates modal-backed table rows through the shared database row-create helper", async () => {
    const space = { path: "Projects" };
    const superstate = {
      spacesIndex: new Map([["Projects", space]]),
    } as any;
    newRowPathInSpace.mockResolvedValue("Projects/New Card.md");

    const path = await createDefaultSchemaItemPath(
      superstate,
      "Projects",
      "New Card"
    );

    expect(path).toBe("Projects/New Card.md");
    expect(newRowPathInSpace).toHaveBeenCalledWith(
      superstate,
      space,
      "New Card",
      true
    );
  });
});
