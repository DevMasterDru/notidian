import {
  appendCommentV1,
  CommentContractError,
  CommentV1,
  createCommentV1,
} from "core/utils/comments/commentContract";
import { planCommentAnchor } from "./commentAnchor";

export type CommentAuthoringFailureCode =
  | "ANCHOR_WRITE_FAILED"
  | "FRONTMATTER_WRITE_FAILED"
  | string;

export type CommentAuthoringResult =
  | {
      ok: true;
      destination: "general" | "review";
      entry: CommentV1;
    }
  | { ok: false; code: CommentAuthoringFailureCode; error?: unknown };

export const authorComment = async (input: {
  document: string;
  from: number;
  to: number;
  body: string;
  frontmatter: Record<string, unknown>;
  generateBlockId: () => string;
  generateCommentId: () => string;
  now: () => Date;
  applyAnchorChange: (change: {
    from: number;
    to: number;
    insert: string;
  }) => boolean | Promise<boolean>;
  saveProperties: (
    properties: Record<string, unknown>
  ) => Promise<{ ok: true } | { ok: false; error?: unknown }>;
}): Promise<CommentAuthoringResult> => {
  const anchorPlan = planCommentAnchor({
    document: input.document,
    from: input.from,
    to: input.to,
    generateId: input.generateBlockId,
  });
  if (anchorPlan.ok === false) return anchorPlan;

  let entry: CommentV1;
  let properties: Record<string, unknown>;
  try {
    entry = createCommentV1({
      id: input.generateCommentId(),
      anchor: anchorPlan.anchor,
      quote: anchorPlan.quote,
      body: input.body,
      createdAt: input.now(),
    });
    properties = appendCommentV1(input.frontmatter, entry);
  } catch (error) {
    if (error instanceof CommentContractError) {
      return { ok: false, code: error.code, error };
    }
    throw error;
  }

  if (anchorPlan.change) {
    const anchorWritten = await input.applyAnchorChange(anchorPlan.change);
    if (!anchorWritten) {
      return { ok: false, code: "ANCHOR_WRITE_FAILED" };
    }
  }

  const write = await input.saveProperties(properties);
  if (write.ok === false) {
    return {
      ok: false,
      code: "FRONTMATTER_WRITE_FAILED",
      error: write.error,
    };
  }

  return {
    ok: true,
    destination: input.frontmatter.type === "review" ? "review" : "general",
    entry,
  };
};
