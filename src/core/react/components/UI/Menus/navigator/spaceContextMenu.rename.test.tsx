jest.mock("core/superstate/utils/label", () => ({ savePathColor: jest.fn() }));
jest.mock("core/superstate/utils/path", () => ({
  hidePath: jest.fn(),
  renamePathByName: jest.fn(),
}));
jest.mock("core/superstate/utils/spaces", () => ({
  addPathToSpaceAtIndex: jest.fn(),
  removePathsFromSpace: jest.fn(),
  removeSpace: jest.fn(),
  saveSpaceTemplate: jest.fn(),
  updateSpaceSort: jest.fn(),
}));
jest.mock("core/utils/emoji", () => ({ removePathIcon: jest.fn() }));
jest.mock("core/utils/ui/screen", () => ({ isTouchScreen: jest.fn(() => false) }));
jest.mock("makemd-core", () => ({
  SelectOptionType: { Radio: "radio", Separator: "separator", Submenu: "submenu" },
}));
jest.mock("shared/components/StickerModal", () => (): null => null);
jest.mock("shared/utils/sticker", () => ({ savePathSticker: jest.fn() }));
jest.mock("../menu/SelectionMenu", () => ({
  defaultMenu: (_ui: unknown, options: unknown[]) => ({ options }),
  menuSeparator: { type: "separator" },
}));
jest.mock("../properties/colorPickerMenu", () => ({ showColorPickerMenu: jest.fn() }));
jest.mock("../properties/selectSpaceMenu", () => ({ showSpacesMenu: jest.fn() }));
jest.mock("./showApplyItemsMenu", () => ({ showApplyItemsMenu: jest.fn() }));
jest.mock("./showSpaceAddMenu", () => ({ showSpaceAddMenu: jest.fn() }));

import i18n from "shared/i18n";
import { showSpacesMenu } from "../properties/selectSpaceMenu";
import { showSpaceContextMenu } from "./spaceContextMenu";

const flushPromises = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

const setupMove = (renameSpace: jest.Mock) => {
  let saveSpace!: (path: string) => void;
  (showSpacesMenu as jest.Mock).mockImplementation(
    (_rect, _win, _superstate, saveLink) => {
      saveSpace = saveLink;
    }
  );
  const menuCalls: any[] = [];
  const notify = jest.fn();
  const path = {
    path: "Source/Folder",
    name: "Folder",
    parent: "Source",
    type: "folder",
  } as any;
  const superstate = {
    spacesIndex: new Map([[path.path, { ...path, space: { folderPath: path.path } }]]),
    settings: { spacesStickers: false },
    spaceManager: { renameSpace, copyPath: jest.fn() },
    ui: {
      openMenu: jest.fn((_rect, menu) => menuCalls.push(menu)),
      hasNativePathMenu: jest.fn(() => false),
      getOS: jest.fn(() => "mac"),
      notify,
    },
  } as any;

  showSpaceContextMenu(superstate, path, {} as any, {} as Window);
  const moveOption = menuCalls[0].options.find(
    (option: any) => option.name === i18n.menu.moveFile
  );
  moveOption.onClick({
    currentTarget: { getBoundingClientRect: () => ({}) },
  });
  return { notify, saveSpace };
};

describe("showSpaceContextMenu rename result boundary", () => {
  it("reports once when the detached folder move resolves falsy", async () => {
    const renameSpace = jest.fn().mockResolvedValue(null);
    const { notify, saveSpace } = setupMove(renameSpace);

    saveSpace("Target");
    await flushPromises();

    expect(renameSpace).toHaveBeenCalledWith("Source/Folder", "Target/Folder");
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith("Could not move the space.");
  });

  it("contains a detached folder move rejection and reports once", async () => {
    const renameSpace = jest.fn().mockRejectedValue(new Error("locked"));
    const { notify, saveSpace } = setupMove(renameSpace);

    saveSpace("Target");
    await flushPromises();

    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith("locked");
  });

  it("does not report a successful detached folder move", async () => {
    const renameSpace = jest.fn().mockResolvedValue("Target/Folder");
    const { notify, saveSpace } = setupMove(renameSpace);

    saveSpace("Target");
    await flushPromises();

    expect(notify).not.toHaveBeenCalled();
  });
});
