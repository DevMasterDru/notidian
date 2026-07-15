export type CommentStatus = "open" | "resolved";

export interface CommentV1 {
  id: string;
  anchor: string;
  quote: string;
  body: string;
  by: string;
  ts: string;
  status: CommentStatus;
}

export type CommentContractErrorCode =
  | "INVALID_ID"
  | "INVALID_ANCHOR"
  | "INVALID_QUOTE"
  | "INVALID_BODY"
  | "INVALID_TIMESTAMP"
  | "MISSING_COMMENTS_VERSION"
  | "UNSUPPORTED_COMMENTS_VERSION"
  | "COMMENTS_NOT_ARRAY"
  | "DUPLICATE_COMMENT_ID";

export class CommentContractError extends Error {
  constructor(public readonly code: CommentContractErrorCode) {
    super(code);
    this.name = "CommentContractError";
  }
}

export const createCommentV1 = (input: {
  id: string;
  anchor: string;
  quote: string;
  body: string;
  createdAt: Date;
}): CommentV1 => {
  if (!/^cmt-[a-z0-9-]+$/.test(input.id)) {
    throw new CommentContractError("INVALID_ID");
  }
  if (!/^\^[A-Za-z0-9-]+$/.test(input.anchor)) {
    throw new CommentContractError("INVALID_ANCHOR");
  }
  const quote = input.quote.replace(/\r\n?/g, "\n");
  if (quote.trim().length === 0) {
    throw new CommentContractError("INVALID_QUOTE");
  }
  if (input.body.trim().length === 0) {
    throw new CommentContractError("INVALID_BODY");
  }
  if (!Number.isFinite(input.createdAt.getTime())) {
    throw new CommentContractError("INVALID_TIMESTAMP");
  }
  return {
    id: input.id,
    anchor: input.anchor,
    quote,
    body: input.body,
    by: "human",
    ts: input.createdAt.toISOString(),
    status: "open",
  };
};

export type CommentFrontmatterPatch =
  | { comments_version: 1; comments: CommentV1[] }
  | { review: Record<string, unknown> };

const commentsFromContainer = (
  container: Record<string, unknown>
): CommentV1[] => {
  const hasComments = Object.prototype.hasOwnProperty.call(container, "comments");
  const hasVersion = Object.prototype.hasOwnProperty.call(
    container,
    "comments_version"
  );
  if (hasComments && !hasVersion) {
    throw new CommentContractError("MISSING_COMMENTS_VERSION");
  }
  if (hasVersion && container.comments_version !== 1) {
    throw new CommentContractError("UNSUPPORTED_COMMENTS_VERSION");
  }
  if (hasComments && !Array.isArray(container.comments)) {
    throw new CommentContractError("COMMENTS_NOT_ARRAY");
  }
  return hasComments ? (container.comments as CommentV1[]) : [];
};

const appendUniqueComment = (
  comments: CommentV1[],
  entry: CommentV1
): CommentV1[] => {
  if (comments.some((comment) => comment?.id === entry.id)) {
    throw new CommentContractError("DUPLICATE_COMMENT_ID");
  }
  return [...comments, entry];
};

export const appendCommentV1 = (
  frontmatter: Record<string, unknown>,
  entry: CommentV1
): CommentFrontmatterPatch => {
  if (frontmatter.type === "review") {
    const review =
      frontmatter.review &&
      typeof frontmatter.review === "object" &&
      !Array.isArray(frontmatter.review)
        ? (frontmatter.review as Record<string, unknown>)
        : {};
    const comments = commentsFromContainer(review);
    return {
      review: {
        ...review,
        comments_version: 1,
        comments: appendUniqueComment(comments, entry),
      },
    };
  }
  const comments = commentsFromContainer(frontmatter);
  return {
    comments_version: 1,
    comments: appendUniqueComment(comments, entry),
  };
};
