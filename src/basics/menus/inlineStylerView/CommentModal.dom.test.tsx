/**
 * @jest-environment jsdom
 */
import React from "react";
import { act } from "react-dom/test-utils";
import { createRoot, Root } from "react-dom/client";
import { CommentModal } from "./CommentModal";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const changeTextarea = (textarea: HTMLTextAreaElement, value: string) => {
  const nativeSetter = Object.getOwnPropertyDescriptor(
    window.HTMLTextAreaElement.prototype,
    "value"
  )?.set;
  nativeSetter?.call(textarea, value);
  textarea.dispatchEvent(new Event("input", { bubbles: true }));
};

describe("CommentModal", () => {
  let container: HTMLElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("keeps submit disabled until the comment contains text", () => {
    act(() => {
      root.render(
        <CommentModal saveComment={jest.fn()} hide={jest.fn()} />
      );
    });

    const textarea = container.querySelector("textarea") as HTMLTextAreaElement;
    const submit = container.querySelector(
      ".mk-comment-submit"
    ) as HTMLButtonElement;

    expect(textarea).not.toBeNull();
    expect(submit.disabled).toBe(true);

    act(() => {
      changeTextarea(textarea, "   ");
    });
    expect(submit.disabled).toBe(true);
  });

  it("submits the trimmed body and closes the modal", async () => {
    const saveComment = jest.fn(async () => true);
    const hide = jest.fn();
    act(() => {
      root.render(
        <CommentModal saveComment={saveComment} hide={hide} />
      );
    });

    const textarea = container.querySelector("textarea") as HTMLTextAreaElement;
    const form = container.querySelector("form") as HTMLFormElement;
    act(() => {
      changeTextarea(textarea, "  Check the source claim.  ");
    });

    await act(async () => {
      form.dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true })
      );
    });

    expect(saveComment).toHaveBeenCalledWith("Check the source claim.");
    expect(hide).toHaveBeenCalledTimes(1);
  });

  it("stays open and re-enables submit when persistence fails", async () => {
    const saveComment = jest.fn(async () => false);
    const hide = jest.fn();
    act(() => {
      root.render(
        <CommentModal saveComment={saveComment} hide={hide} />
      );
    });

    const textarea = container.querySelector("textarea") as HTMLTextAreaElement;
    const form = container.querySelector("form") as HTMLFormElement;
    const submit = container.querySelector(
      ".mk-comment-submit"
    ) as HTMLButtonElement;
    act(() => {
      changeTextarea(textarea, "Try again");
    });

    await act(async () => {
      form.dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true })
      );
    });

    expect(hide).not.toHaveBeenCalled();
    expect(submit.disabled).toBe(false);
  });
});
