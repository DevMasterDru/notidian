jest.mock("core/react/components/UI/Modals/InputModal", () => ({
  InputModal: (): null => null,
}));
jest.mock("makemd-core", () => ({
  SelectOptionType: { Separator: "separator", Submenu: "submenu" },
}));
jest.mock("core/superstate/utils/label", () => ({ savePathColor: jest.fn() }));
jest.mock("core/superstate/utils/path", () => ({
  convertPathToSpace: jest.fn(),
  deletePath: jest.fn(),
  hidePath: jest.fn(),
  hidePaths: jest.fn(),
  movePathToSpace: jest.fn(),
  renamePathByName: jest.fn(),
}));
jest.mock("core/superstate/utils/spaces", () => ({
  removePathsFromSpace: jest.fn(),
  saveSpaceTemplate: jest.fn(),
}));
jest.mock("core/utils/dnd/dropPath", () => ({
  dropPathsInSpaceAtIndex: jest.fn(),
}));
jest.mock("core/utils/emoji", () => ({
  removePathIcon: jest.fn(),
  saveColorForPaths: jest.fn(),
  saveIconsForPaths: jest.fn(),
  savePathIcon: jest.fn(),
}));
jest.mock("core/utils/contexts/nonDestructiveDelete", () => ({
  requestRowDeleteWithSubItems: jest.fn(),
}));
jest.mock("core/utils/ui/screen", () => ({ isTouchScreen: jest.fn(() => false) }));
jest.mock("shared/components/StickerModal", () => (): null => null);
jest.mock("shared/utils/dom", () => ({ windowFromDocument: jest.fn(() => ({})) }));
jest.mock("shared/utils/sticker", () => ({ removeIconsForPaths: jest.fn() }));
jest.mock("../properties/colorPickerMenu", () => ({ showColorPickerMenu: jest.fn() }));
jest.mock("../properties/selectSpaceMenu", () => ({ showSpacesMenu: jest.fn() }));
jest.mock("./spaceContextMenu", () => ({ showSpaceContextMenu: jest.fn() }));

import i18n from "shared/i18n";
import { deletePath } from "core/superstate/utils/path";
import { requestRowDeleteWithSubItems } from "core/utils/contexts/nonDestructiveDelete";
import { showSpacesMenu } from "../properties/selectSpaceMenu";
import { showPathContextMenu } from "./pathContextMenu";

describe("showPathContextMenu rename result boundary", () => {
  it("contains a detached move failure and reports it once when renamePath resolves falsy", async () => {
    let saveSpace!: (path: string) => void;
    (showSpacesMenu as jest.Mock).mockImplementation(
      (_rect, _win, _superstate, saveLink) => {
        saveSpace = saveLink;
      }
    );
    const menuCalls: any[] = [];
    const notify = jest.fn();
    const renamePath = jest.fn().mockResolvedValue(null);
    const superstate = {
      pathsIndex: new Map([
        [
          "Source/Note.md",
          {
            path: "Source/Note.md",
            name: "Note.md",
            parent: "Source",
            type: "file",
            subtype: "md",
          },
        ],
      ]),
      spacesIndex: new Map(),
      settings: { spacesStickers: false },
      spaceManager: { renamePath, copyPath: jest.fn() },
      ui: {
        openMenu: jest.fn((_rect, menu) => menuCalls.push(menu)),
        hasNativePathMenu: jest.fn(() => false),
        getOS: jest.fn(() => "mac"),
        notify,
      },
    } as any;

    showPathContextMenu(
      superstate,
      "Source/Note.md",
      "Source",
      {} as any,
      {} as Window
    );
    const moveOption = menuCalls[0].options.find(
      (option: any) => option.name === i18n.menu.moveFile
    );
    moveOption.onClick({
      currentTarget: { getBoundingClientRect: () => ({}) },
      view: { document: {} },
    });
    saveSpace("Target");
    await Promise.resolve();
    await Promise.resolve();

    expect(renamePath).toHaveBeenCalledWith(
      "Source/Note.md",
      "Target/Note.md"
    );
    expect(notify).toHaveBeenCalledTimes(1);
  });
});

describe("showPathContextMenu delete reporting boundary", () => {
  it("keeps deleteSelf rejecting so requestRowDeleteWithSubItems owns reporting", async () => {
    const menuCalls: any[] = [];
    const notify = jest.fn();
    (deletePath as jest.Mock).mockRejectedValueOnce(new Error("locked"));
    const superstate = {
      pathsIndex: new Map([
        ["Source/Note.md", { path: "Source/Note.md", type: "file" }],
      ]),
      spacesIndex: new Map(),
      settings: { spacesStickers: false },
      spaceManager: {},
      ui: {
        openMenu: jest.fn((_rect, menu) => menuCalls.push(menu)),
        hasNativePathMenu: jest.fn(() => false),
        getOS: jest.fn(() => "mac"),
        notify,
      },
    } as any;

    showPathContextMenu(
      superstate,
      "Source/Note.md",
      "Source",
      {} as any,
      {} as Window
    );
    const deleteOption = menuCalls[0].options.find(
      (option: any) => option.name === i18n.menu.delete
    );
    deleteOption.onClick({});
    const deleteSelf = (requestRowDeleteWithSubItems as jest.Mock).mock.calls[0][0]
      .deleteSelf;
    await expect(deleteSelf()).rejects.toThrow("locked");

    expect(deletePath).toHaveBeenCalledWith(superstate, "Source/Note.md");
    expect(notify).not.toHaveBeenCalled();
  });

  it("supplies the request boundary with the path menu reporter", () => {
    const menuCalls: any[] = [];
    const notify = jest.fn();
    const superstate = {
      pathsIndex: new Map([
        ["Source/Note.md", { path: "Source/Note.md", type: "file" }],
      ]),
      spacesIndex: new Map(),
      settings: { spacesStickers: false },
      spaceManager: {},
      ui: {
        openMenu: jest.fn((_rect, menu) => menuCalls.push(menu)),
        hasNativePathMenu: jest.fn(() => false),
        getOS: jest.fn(() => "mac"),
        notify,
      },
    } as any;

    showPathContextMenu(
      superstate,
      "Source/Note.md",
      "Source",
      {} as any,
      {} as Window
    );
    menuCalls[0].options
      .find((option: any) => option.name === i18n.menu.delete)
      .onClick({});
    const requestCalls = (requestRowDeleteWithSubItems as jest.Mock).mock.calls;
    const reportError = requestCalls[requestCalls.length - 1][0].reportError;
    reportError("Could not delete Source/Note.md: locked");

    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith(
      "Could not delete Source/Note.md: locked"
    );
  });
});
