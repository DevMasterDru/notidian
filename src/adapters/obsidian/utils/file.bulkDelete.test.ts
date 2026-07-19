jest.mock("adapters/obsidian/ui/editors/EmbedSpaceView", () => ({ EMBED_SPACE_VIEW_TYPE: "embed" }));
jest.mock("adapters/obsidian/ui/editors/markdownView/FileView", () => ({ LINK_VIEW_TYPE: "link" }));
jest.mock("adapters/obsidian/SpaceViewContainer", () => ({ SPACE_VIEW_TYPE: "space" }));
jest.mock("../ui/navigator/EverLeafView", () => ({ EVER_VIEW_TYPE: "ever" }));
jest.mock("main", () => ({}));
jest.mock("makemd-core", () => ({}));
jest.mock("core/utils/ui/screen", () => ({ isTouchScreen: jest.fn() }));
jest.mock("shared/utils/dom", () => ({ selectElementContents: jest.fn() }));
jest.mock("obsidian", () => ({
  App: class App {},
  Platform: { isMobile: false },
  TAbstractFile: class TAbstractFile {},
  TFile: class TFile {},
  TFolder: class TFolder {},
  WorkspaceLeaf: class WorkspaceLeaf {},
  normalizePath: (path: string) => path,
}), { virtual: true });

import { deleteFiles } from "./file";

describe("deleteFiles settle-all boundary", () => {
  it("starts every delete and waits for slower siblings before aggregating failure", async () => {
    const started: string[] = [];
    let releaseB = (): void => undefined;
    const deleteFile = jest.fn((path: string) => {
      started.push(path);
      if (path === "A.md") return Promise.reject(new Error("A locked"));
      if (path === "B.md") {
        return new Promise<void>(resolve => {
          releaseB = resolve;
        });
      }
      return Promise.resolve();
    });
    let settled = false;
    const deletion = deleteFiles({ files: { deleteFile } } as any, [
      "A.md",
      "B.md",
      "C.md",
    ]).finally(() => {
      settled = true;
    });
    const rejected = expect(deletion).rejects.toEqual(expect.objectContaining({
      name: "AggregateError",
      errors: [expect.objectContaining({ message: "A locked" })],
    }));

    await Promise.resolve();
    await Promise.resolve();
    expect(started).toEqual(["A.md", "B.md", "C.md"]);
    expect(settled).toBe(false);
    releaseB();
    await rejected;
    expect(settled).toBe(true);
  });
});
