/**
 * @jest-environment jsdom
 */
// Notidian-1mh0: TitleComponent's inline-title onBlur handler already guarded
// the falsy-result case (see the `if (f && ...)` alias branch) but never
// notified the user about it, and never attached a `.catch` at all -- a
// genuine physical-rename rejection from renamePathByName was an unhandled
// promise rejection with zero user notice. This DOM harness exercises the
// real onBlur handler end to end (a real contentEditable blur, not a mocked
// call) to lock down: falsy result -> notify once, rejection -> notify once
// and no unhandled rejection, success -> no notify and the existing alias
// sync still runs unchanged.
import React from "react";
import { act, Simulate } from "react-dom/test-utils";
import { createRoot, Root } from "react-dom/client";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

// jsdom does not implement `innerText` (it requires a layout box model) --
// only `textContent`. onBlur reads `e.target.innerText`, so shim it onto a
// live textContent backing, matching how a real contentEditable div behaves.
if (!Object.getOwnPropertyDescriptor(HTMLElement.prototype, "innerText")) {
  Object.defineProperty(HTMLElement.prototype, "innerText", {
    get(this: HTMLElement) {
      return this.textContent;
    },
    set(this: HTMLElement, value: string) {
      this.textContent = value;
    },
    configurable: true,
  });
}

// Sever the real PathContext/SpaceContext modules: PathContext.tsx
// transitively imports shared/utils/uuid.js, a plain .js helper the repo's
// ts-jest transform cannot parse (same pattern as SpaceNoteBody.dom.test.tsx).
// A fresh, real React.createContext gives TitleComponent a genuine context to
// read and this test a matching <Provider> to feed.
jest.mock("core/react/context/PathContext", () => ({
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  PathContext: require("react").createContext({ pathState: null }),
}));
jest.mock("core/react/context/SpaceContext", () => ({
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  SpaceContext: require("react").createContext({ spaceState: null }),
}));
// makemd-core is imported by TitleComponent only for the Superstate type.
jest.mock("makemd-core", () => ({}));
jest.mock("core/superstate/utils/label", () => ({
  savePathBanner: jest.fn(),
  updatePrimaryAlias: jest.fn(),
}));
jest.mock("core/superstate/utils/path", () => ({
  renamePathByName: jest.fn(),
}));
jest.mock("core/superstate/utils/spaces", () => ({
  saveSpaceCache: jest.fn(),
}));
jest.mock("core/utils/emoji", () => ({
  savePathIcon: jest.fn(),
}));
jest.mock("core/utils/ui/screen", () => ({
  // Forces the mobile render branch so HeaderLabelActions and the alias
  // toggle button (which need superstate.ui.getSticker) never render --
  // irrelevant to the onBlur/rename contract under test.
  isPhone: jest.fn(() => true),
}));
jest.mock("shared/components/StickerModal", () => (): null => null);
jest.mock("shared/components/PathSticker", () => ({
  PathStickerContainer: (): null => null,
}));
jest.mock("../UI/Modals/ImageModal", () => (): null => null);

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { PathContext } = require("core/react/context/PathContext");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { SpaceContext } = require("core/react/context/SpaceContext");

import i18n from "shared/i18n";
import { renamePathByName } from "core/superstate/utils/path";
import { updatePrimaryAlias } from "core/superstate/utils/label";
import { TitleComponent } from "./TitleComponent";

describe("TitleComponent inline-title rename result boundary", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    (renamePathByName as jest.Mock).mockReset();
    (updatePrimaryAlias as jest.Mock).mockReset();
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  const renderTitle = (notify: jest.Mock) => {
    const pathState = {
      path: "Source/Note.md",
      name: "Note",
      subtype: "md",
      metadata: { property: {} },
    };
    const superstate = {
      settings: { spacesUseAlias: false, spacesStickers: false },
      ui: { notify },
    } as any;

    act(() => {
      root.render(
        <PathContext.Provider value={{ pathState }}>
          <SpaceContext.Provider value={{ spaceState: { type: "folder" } }}>
            <TitleComponent
              superstate={superstate}
              readOnly={false}
              setReposition={() => {}}
            />
          </SpaceContext.Provider>
        </PathContext.Provider>
      );
    });

    return container.querySelector(".mk-inline-title") as HTMLDivElement;
  };

  it("notifies once when renamePathByName resolves falsy", async () => {
    const notify = jest.fn();
    (renamePathByName as jest.Mock).mockResolvedValueOnce(null);
    const titleNode = renderTitle(notify);

    await act(async () => {
      titleNode.innerText = "Renamed Note";
      Simulate.blur(titleNode);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(renamePathByName).toHaveBeenCalledWith(
      expect.anything(),
      "Source/Note.md",
      "Renamed Note"
    );
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith(i18n.notice.renamePathFailed);
    expect(updatePrimaryAlias).not.toHaveBeenCalled();
  });

  it("notifies once and leaves no unhandled rejection when renamePathByName rejects", async () => {
    const notify = jest.fn();
    (renamePathByName as jest.Mock).mockRejectedValueOnce(new Error("locked"));
    const titleNode = renderTitle(notify);

    await act(async () => {
      titleNode.innerText = "Renamed Note";
      Simulate.blur(titleNode);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith(i18n.notice.renamePathFailed);
  });

  it("does not notify on a successful rename and still runs the existing alias sync", async () => {
    const notify = jest.fn();
    // A colon is stripped by sanitizeFileName, so sanitizedName != newValue --
    // this exercises the pre-existing alias-sync branch to prove it is
    // untouched by the fix.
    (renamePathByName as jest.Mock).mockResolvedValueOnce(
      "Source/RenamedNote.md"
    );
    const titleNode = renderTitle(notify);

    await act(async () => {
      titleNode.innerText = "Renamed:Note";
      Simulate.blur(titleNode);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(renamePathByName).toHaveBeenCalledWith(
      expect.anything(),
      "Source/Note.md",
      "RenamedNote"
    );
    expect(notify).not.toHaveBeenCalled();
    expect(updatePrimaryAlias).toHaveBeenCalledWith(
      expect.anything(),
      "Source/RenamedNote.md",
      undefined,
      "Renamed:Note"
    );
  });
});
