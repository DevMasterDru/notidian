/** @jest-environment jsdom */

jest.mock("adapters/obsidian/utils/file", () => ({
  getAbstractFileAtPath: jest.fn(),
  renameFile: jest.fn(),
}));
jest.mock("core/superstate/utils/label", () => ({ updatePrimaryAlias: jest.fn() }));
jest.mock("core/react/components/UI/Modals/ConfirmationModal", () => ({
  ConfirmationModal: (): null => null,
}));
jest.mock("obsidian", () => ({ TFile: class TFile {} }), { virtual: true });

import {
  getAbstractFileAtPath,
  renameFile,
} from "adapters/obsidian/utils/file";
import { updatePrimaryAlias } from "core/superstate/utils/label";
import { openPathFixer } from "./fileSystemPathFixer";

const harness = (files: string[]) => {
  const warnings = new Set(files);
  const openModal = jest.fn();
  const notify = jest.fn();
  const plugin = {
    app: {},
    obsidianAdapter: { fileNameWarnings: warnings },
    superstate: {
      pathsIndex: new Map(
        files.map(path => [path, { metadata: { property: { aliases: [`alias:${path}`] } } }])
      ),
      ui: { openModal, notify },
    },
  } as any;
  openPathFixer(plugin);
  return {
    plugin,
    warnings,
    confirmAction: openModal.mock.calls[0][1].props.confirmAction as () => Promise<void>,
  };
};

beforeEach(() => {
  (getAbstractFileAtPath as jest.Mock).mockReset();
  (renameFile as jest.Mock).mockReset();
  (updatePrimaryAlias as jest.Mock).mockReset();
});

describe("Path Fixer confirmation boundary", () => {
  it("rejects a falsy rename before alias publication or warning clear", async () => {
    (getAbstractFileAtPath as jest.Mock).mockReturnValue({ name: "Bad Name.md" });
    (renameFile as jest.Mock).mockResolvedValue(null);
    const { confirmAction, plugin, warnings } = harness(["Bad Name.md"]);

    await expect(confirmAction()).rejects.toThrow("Could not rename Bad Name.md");

    expect(updatePrimaryAlias).not.toHaveBeenCalled();
    expect(plugin.obsidianAdapter.fileNameWarnings).toBe(warnings);
  });

  it("rejects a missing source before dereferencing or clearing warnings", async () => {
    (getAbstractFileAtPath as jest.Mock).mockReturnValue(null);
    const { confirmAction, plugin, warnings } = harness(["Missing.md"]);

    await expect(confirmAction()).rejects.toThrow("Could not find Missing.md");

    expect(renameFile).not.toHaveBeenCalled();
    expect(plugin.obsidianAdapter.fileNameWarnings).toBe(warnings);
  });

  it("publishes aliases to returned destinations and clears warnings after all succeed", async () => {
    (getAbstractFileAtPath as jest.Mock)
      .mockReturnValueOnce({ name: "Bad One.md" })
      .mockReturnValueOnce({ name: "Bad Two.md" });
    (renameFile as jest.Mock)
      .mockResolvedValueOnce("Clean One.md")
      .mockResolvedValueOnce("Clean Two.md");
    const { confirmAction, plugin } = harness(["Bad One.md", "Bad Two.md"]);

    await confirmAction();

    expect(updatePrimaryAlias).toHaveBeenNthCalledWith(
      1,
      plugin.superstate,
      "Clean One.md",
      ["alias:Bad One.md"],
      "Bad One.md"
    );
    expect(updatePrimaryAlias).toHaveBeenNthCalledWith(
      2,
      plugin.superstate,
      "Clean Two.md",
      ["alias:Bad Two.md"],
      "Bad Two.md"
    );
    expect(plugin.obsidianAdapter.fileNameWarnings).toEqual(new Set());
  });
});
