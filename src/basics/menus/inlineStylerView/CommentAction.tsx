import type { EditorView } from "@codemirror/view";
import type MakeBasicsPlugin from "basics/basics";
import { saveFrontmatterProperties } from "core/utils/properties/frontmatterWrite";
import { editorInfoField, type MarkdownView } from "obsidian";
import React from "react";
import { windowFromDocument } from "shared/utils/dom";
import { genId } from "shared/utils/uuid";
import { CommentModal } from "./CommentModal";
import { authorComment } from "./commentAuthoring";

type EditorInfo = { file?: { path?: string } };

export const CommentAction = (props: {
  cm?: EditorView;
  plugin: MakeBasicsPlugin;
  idFactory?: () => string;
  now?: () => Date;
}) => {
  const superstate = props.plugin.plugin.superstate;
  if (!props.cm || !superstate.settings.selectToComment) return null;

  const openCommentModal = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();

    const cm = props.cm;
    const info = cm.state.field(editorInfoField, false) as
      | EditorInfo
      | undefined;
    const filePath = info?.file?.path;
    if (!filePath) {
      superstate.ui.notify("Open a Markdown file before adding a comment.");
      return;
    }

    const selection = cm.state.selection.main;
    let documentSnapshot = cm.state.doc.toString();
    const idFactory = props.idFactory ?? genId;
    const now = props.now ?? (() => new Date());

    const saveComment = async (body: string): Promise<boolean> => {
      const result = await authorComment({
        document: documentSnapshot,
        from: selection.from,
        to: selection.to,
        body,
        frontmatter:
          superstate.pathsIndex.get(filePath)?.metadata?.property ?? {},
        generateBlockId: () => `c-${idFactory()}`,
        generateCommentId: () => `cmt-${idFactory()}`,
        now,
        applyAnchorChange: async (change) => {
          try {
            cm.dispatch({ changes: change });
            documentSnapshot = cm.state.doc.toString();
            const verified =
              cm.state.sliceDoc(
                change.from,
                change.from + change.insert.length
              ) === change.insert;
            if (!verified) return false;

            const markdownView = props.plugin.app.workspace
              .getLeavesOfType("markdown")
              .map((leaf) => leaf.view as MarkdownView)
              .find(
                (view) =>
                  view.file?.path === filePath &&
                  (view.editor as unknown as { cm?: EditorView }).cm === cm
              );
            if (!markdownView) return false;
            await markdownView.save();
            return true;
          } catch (error) {
            documentSnapshot = cm.state.doc.toString();
            return false;
          }
        },
        saveProperties: (properties) =>
          saveFrontmatterProperties({
            superstate,
            path: filePath,
            properties,
            failureMessage: "Could not save comment.",
          }),
      });

      if (result.ok === false) {
        if (result.code !== "FRONTMATTER_WRITE_FAILED") {
          superstate.ui.notify(`Could not add comment (${result.code}).`);
        }
        return false;
      }

      superstate.ui.notify("Comment added.");
      return true;
    };

    superstate.ui.openModal(
      "Add comment",
      <CommentModal saveComment={saveComment} />,
      windowFromDocument(event.currentTarget.ownerDocument)
    );
  };

  return (
    <button
      type="button"
      aria-label="Comment"
      className="mk-mark mk-mark-comment"
      onMouseDown={openCommentModal}
    >
      <svg
        aria-hidden="true"
        width="16"
        height="16"
        viewBox="0 0 16 16"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <path
          d="M2.5 3.5h11v7h-6l-3.5 2v-2H2.5v-7Z"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinejoin="round"
        />
      </svg>
    </button>
  );
};
