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
import { renamePathByName } from "core/superstate/utils/path";
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

// Notidian-1mh0: the plain "Rename" menu item (space.type != "default") passes
// renamePathByName straight into InputModal.saveValue with no .then/.catch.
// InputModal.save() calls saveValue(value) and immediately hides the modal --
// it never awaits or inspects the returned promise. A genuine physical-rename
// rejection was therefore an unhandled promise rejection with zero user
// notice, and a falsy (swallowed-failure) result was silently dropped too.
describe("showSpaceContextMenu plain rename result boundary", () => {
  const buildSuperstate = (notify: jest.Mock) => {
    const path = {
      path: "Source/Folder",
      name: "Folder",
      parent: "Source",
      type: "folder",
    } as any;
    const superstate = {
      spacesIndex: new Map([
        [path.path, { ...path, space: { folderPath: path.path } }],
      ]),
      settings: { spacesStickers: false },
      spaceManager: { renameSpace: jest.fn(), copyPath: jest.fn() },
      ui: {
        openMenu: jest.fn(),
        openModal: jest.fn(),
        hasNativePathMenu: jest.fn(() => false),
        getOS: jest.fn(() => "mac"),
        notify,
      },
    } as any;
    return { superstate, path };
  };

  const getRenameSaveValue = (superstate: any, path: any) => {
    const menuCalls: any[] = [];
    (superstate.ui.openMenu as jest.Mock).mockImplementation(
      (_rect: unknown, menu: unknown) => menuCalls.push(menu)
    );
    showSpaceContextMenu(superstate, path, {} as any, {} as Window);
    const renameOption = menuCalls[0].options.find(
      (option: any) => option.name === i18n.menu.rename
    );
    renameOption.onClick({});
    const modalElement = (superstate.ui.openModal as jest.Mock).mock
      .calls[0][1];
    return modalElement.props.saveValue as (
      value: string
    ) => Promise<unknown> | void;
  };

  it("notifies once when renamePathByName resolves falsy", async () => {
    const notify = jest.fn();
    const { superstate, path } = buildSuperstate(notify);
    (renamePathByName as jest.Mock).mockResolvedValueOnce(null);

    const saveValue = getRenameSaveValue(superstate, path);
    saveValue("Renamed");
    await flushPromises();

    expect(renamePathByName).toHaveBeenCalledWith(
      superstate,
      "Source/Folder",
      "Renamed"
    );
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith(i18n.notice.renamePathFailed);
  });

  it("notifies once and leaves no unhandled rejection when renamePathByName rejects", async () => {
    const notify = jest.fn();
    const { superstate, path } = buildSuperstate(notify);
    (renamePathByName as jest.Mock).mockRejectedValueOnce(new Error("locked"));

    const saveValue = getRenameSaveValue(superstate, path);
    saveValue("Renamed");
    await flushPromises();

    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith(i18n.notice.renamePathFailed);
  });

  it("does not notify on a successful rename", async () => {
    const notify = jest.fn();
    const { superstate, path } = buildSuperstate(notify);
    (renamePathByName as jest.Mock).mockResolvedValueOnce("Target/Renamed");

    const saveValue = getRenameSaveValue(superstate, path);
    saveValue("Renamed");
    await flushPromises();

    expect(notify).not.toHaveBeenCalled();
  });
});
