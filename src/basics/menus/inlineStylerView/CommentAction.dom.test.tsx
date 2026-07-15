/**
 * @jest-environment jsdom
 */
import React from "react";
import { act } from "react-dom/test-utils";
import { createRoot, Root } from "react-dom/client";

const saveFrontmatterProperties = jest.fn();

jest.mock("obsidian", () => ({
  editorInfoField: { name: "editor-info" },
}), { virtual: true });
jest.mock("core/utils/properties/frontmatterWrite", () => ({
  saveFrontmatterProperties: (...args: unknown[]) =>
    saveFrontmatterProperties(...args),
}));
jest.mock("shared/utils/uuid", () => ({ genId: () => "unused" }));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { CommentAction } = require("./CommentAction");

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const makeHarness = (
  selectToComment: boolean,
  frontmatter: Record<string, unknown> = { status: "draft" }
) => {
  let documentText = "Alpha text";
  const openModal = jest.fn();
  const notify = jest.fn();
  const saveEditor = jest.fn(async (): Promise<void> => {});
  const cm = {
    state: {
      selection: { main: { from: 0, to: 5 } },
      doc: { toString: () => documentText },
      sliceDoc: (from: number, to: number) => documentText.slice(from, to),
      field: () => ({ file: { path: "Notes/Alpha.md" } }),
    },
    dispatch: jest.fn(({ changes }) => {
      documentText =
        documentText.slice(0, changes.from) +
        changes.insert +
        documentText.slice(changes.to);
    }),
  };
  const superstate = {
    settings: { selectToComment },
    pathsIndex: new Map([
      ["Notes/Alpha.md", { metadata: { property: frontmatter } }],
    ]),
    ui: { openModal, notify },
  };
  const plugin = {
    plugin: { superstate },
    app: {
      workspace: {
        getLeavesOfType: () => [
          {
            view: {
              editor: { cm },
              file: { path: "Notes/Alpha.md" },
              save: saveEditor,
            },
          },
        ],
      },
    },
  };

  return {
    cm,
    plugin,
    openModal,
    notify,
    saveEditor,
    getDocument: () => documentText,
  };
};

describe("CommentAction", () => {
  let container: HTMLElement;
  let root: Root;

  beforeEach(() => {
    saveFrontmatterProperties.mockReset();
    saveFrontmatterProperties.mockResolvedValue({ ok: true });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("does not render when the default-on feature is killed", () => {
    const harness = makeHarness(false);
    act(() => {
      root.render(
        <CommentAction cm={harness.cm} plugin={harness.plugin} />
      );
    });

    expect(container.querySelector(".mk-mark-comment")).toBeNull();
  });

  it("opens the authoring modal and persists the anchor before frontmatter", async () => {
    const harness = makeHarness(true);
    const persistenceOrder: string[] = [];
    harness.saveEditor.mockImplementation(async () => {
      persistenceOrder.push("editor-save");
    });
    saveFrontmatterProperties.mockImplementation(async () => {
      persistenceOrder.push("frontmatter");
      return { ok: true };
    });
    const idFactory = jest
      .fn()
      .mockReturnValueOnce("blockid")
      .mockReturnValueOnce("commentid");
    act(() => {
      root.render(
        <CommentAction
          cm={harness.cm}
          plugin={harness.plugin}
          idFactory={idFactory}
          now={() => new Date("2026-07-15T08:00:00.000Z")}
        />
      );
    });

    const action = container.querySelector(
      ".mk-mark-comment"
    ) as HTMLButtonElement;
    expect(action.getAttribute("aria-label")).toBe("Comment");
    act(() => {
      action.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    });

    expect(harness.openModal).toHaveBeenCalledTimes(1);
    expect(harness.openModal.mock.calls[0][0]).toBe("Add comment");
    const modal = harness.openModal.mock.calls[0][1] as React.ReactElement<{
      saveComment: (body: string) => Promise<boolean>;
    }>;

    await expect(modal.props.saveComment("Needs a citation.")).resolves.toBe(
      true
    );

    expect(harness.cm.dispatch).toHaveBeenCalledTimes(1);
    expect(harness.saveEditor).toHaveBeenCalledTimes(1);
    expect(persistenceOrder).toEqual(["editor-save", "frontmatter"]);
    expect(harness.getDocument()).toBe("Alpha text ^c-blockid");
    expect(saveFrontmatterProperties).toHaveBeenCalledWith({
      superstate: harness.plugin.plugin.superstate,
      path: "Notes/Alpha.md",
      properties: {
        comments_version: 1,
        comments: [
          {
            id: "cmt-commentid",
            anchor: "^c-blockid",
            quote: "Alpha",
            body: "Needs a citation.",
            by: "human",
            ts: "2026-07-15T08:00:00.000Z",
            status: "open",
          },
        ],
      },
      failureMessage: "Could not save comment.",
    });
    expect(harness.notify).toHaveBeenCalledWith("Comment added.");
  });

  it("reuses the harmless anchor when a failed frontmatter write is retried", async () => {
    saveFrontmatterProperties
      .mockResolvedValueOnce({ ok: false })
      .mockResolvedValueOnce({ ok: true });
    const harness = makeHarness(true);
    const idFactory = jest
      .fn()
      .mockReturnValueOnce("blockid")
      .mockReturnValueOnce("commentone")
      .mockReturnValueOnce("commenttwo");
    act(() => {
      root.render(
        <CommentAction
          cm={harness.cm}
          plugin={harness.plugin}
          idFactory={idFactory}
          now={() => new Date("2026-07-15T08:00:00.000Z")}
        />
      );
    });

    const action = container.querySelector(
      ".mk-mark-comment"
    ) as HTMLButtonElement;
    act(() => {
      action.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    });
    const saveComment = harness.openModal.mock.calls[0][1].props.saveComment;

    await expect(saveComment("Retry me")).resolves.toBe(false);
    await expect(saveComment("Retry me")).resolves.toBe(true);

    expect(harness.cm.dispatch).toHaveBeenCalledTimes(1);
    expect(harness.getDocument()).toBe("Alpha text ^c-blockid");
    expect(saveFrontmatterProperties).toHaveBeenCalledTimes(2);
  });

  it("dispatches review-page comments only to the nested review channel", async () => {
    const harness = makeHarness(true, {
      type: "review",
      status: "awaiting-review",
      review: { verdicts: [{ id: "decision-1" }], future_key: "preserve" },
    });
    const idFactory = jest
      .fn()
      .mockReturnValueOnce("blockid")
      .mockReturnValueOnce("reviewcomment");
    act(() => {
      root.render(
        <CommentAction
          cm={harness.cm}
          plugin={harness.plugin}
          idFactory={idFactory}
          now={() => new Date("2026-07-15T08:00:00.000Z")}
        />
      );
    });

    const action = container.querySelector(
      ".mk-mark-comment"
    ) as HTMLButtonElement;
    act(() => {
      action.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    });
    const saveComment = harness.openModal.mock.calls[0][1].props.saveComment;

    await expect(saveComment("AI review feedback")).resolves.toBe(true);

    const write = saveFrontmatterProperties.mock.calls[0][0];
    expect(write.properties).toEqual({
      review: {
        verdicts: [{ id: "decision-1" }],
        future_key: "preserve",
        comments_version: 1,
        comments: [
          expect.objectContaining({
            id: "cmt-reviewcomment",
            anchor: "^c-blockid",
            body: "AI review feedback",
          }),
        ],
      },
    });
    expect(write.properties).not.toHaveProperty("comments");
  });
});
