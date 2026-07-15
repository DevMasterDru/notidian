import {
  appendCommentV1,
  CommentContractError,
  createCommentV1,
} from "./commentContract";

describe("CommentV1 contract", () => {
  it("normalizes selected text to LF when creating an entry", () => {
    expect(
      createCommentV1({
        id: "cmt-k3m9x2p7q4",
        anchor: "^c-anchor1",
        quote: "first\r\nsecond",
        body: "Please clarify this.",
        createdAt: new Date("2026-07-15T10:00:00.000Z"),
      })
    ).toEqual({
      id: "cmt-k3m9x2p7q4",
      anchor: "^c-anchor1",
      quote: "first\nsecond",
      body: "Please clarify this.",
      by: "human",
      ts: "2026-07-15T10:00:00.000Z",
      status: "open",
    });
  });

  it("rejects an empty comment body with the stable v1 code", () => {
    expect(() =>
      createCommentV1({
        id: "cmt-k3m9x2p7q4",
        anchor: "^c-anchor1",
        quote: "selected text",
        body: "   ",
        createdAt: new Date("2026-07-15T10:00:00.000Z"),
      })
    ).toThrow(new CommentContractError("INVALID_BODY"));
  });

  it.each([
    ["id", { id: "comment 1" }, "INVALID_ID"],
    ["anchor", { anchor: "paragraph" }, "INVALID_ANCHOR"],
    ["quote", { quote: "\r\n" }, "INVALID_QUOTE"],
    ["timestamp", { createdAt: new Date("invalid") }, "INVALID_TIMESTAMP"],
  ])("rejects an invalid %s with its stable v1 code", (_name, patch, code) => {
    expect(() =>
      createCommentV1({
        id: "cmt-k3m9x2p7q4",
        anchor: "^c-anchor1",
        quote: "selected text",
        body: "Please clarify this.",
        createdAt: new Date("2026-07-15T10:00:00.000Z"),
        ...patch,
      })
    ).toThrow(code);
  });

  it("routes a general note entry to the top-level versioned list", () => {
    const entry = createCommentV1({
      id: "cmt-k3m9x2p7q4",
      anchor: "^c-anchor1",
      quote: "selected text",
      body: "Please clarify this.",
      createdAt: new Date("2026-07-15T10:00:00.000Z"),
    });

    expect(appendCommentV1({ title: "Note" }, entry)).toEqual({
      comments_version: 1,
      comments: [entry],
    });
  });

  it("routes a review entry to review.comments while preserving siblings and unknown keys", () => {
    const first = createCommentV1({
      id: "cmt-first",
      anchor: "^c-first",
      quote: "first selection",
      body: "First comment",
      createdAt: new Date("2026-07-15T09:00:00.000Z"),
    });
    const second = createCommentV1({
      id: "cmt-second",
      anchor: "^c-second",
      quote: "second selection",
      body: "Second comment",
      createdAt: new Date("2026-07-15T10:00:00.000Z"),
    });

    expect(
      appendCommentV1(
        {
          type: "review",
          review: {
            verdicts: [{ id: "decision-1" }],
            comments_version: 1,
            comments: [first],
            future_key: "preserve-me",
          },
        },
        second
      )
    ).toEqual({
      review: {
        verdicts: [{ id: "decision-1" }],
        comments_version: 1,
        comments: [first, second],
        future_key: "preserve-me",
      },
    });
  });

  it("appends to an existing general comment list without replacing it", () => {
    const first = createCommentV1({
      id: "cmt-first",
      anchor: "^c-first",
      quote: "first selection",
      body: "First comment",
      createdAt: new Date("2026-07-15T09:00:00.000Z"),
    });
    const second = createCommentV1({
      id: "cmt-second",
      anchor: "^c-second",
      quote: "second selection",
      body: "Second comment",
      createdAt: new Date("2026-07-15T10:00:00.000Z"),
    });

    expect(
      appendCommentV1(
        { comments_version: 1, comments: [first] },
        second
      )
    ).toEqual({ comments_version: 1, comments: [first, second] });
  });

  it.each([
    [
      "missing version",
      { comments: [] },
      "MISSING_COMMENTS_VERSION",
    ],
    [
      "unsupported version",
      { comments_version: 2, comments: [] },
      "UNSUPPORTED_COMMENTS_VERSION",
    ],
    [
      "non-array list",
      { comments_version: 1, comments: "bad" },
      "COMMENTS_NOT_ARRAY",
    ],
    [
      "malformed review list",
      {
        type: "review",
        review: { comments_version: 1, comments: "bad" },
      },
      "COMMENTS_NOT_ARRAY",
    ],
  ])("refuses an existing %s container without overwriting it", (_name, frontmatter, code) => {
    const entry = createCommentV1({
      id: "cmt-next",
      anchor: "^c-next",
      quote: "selection",
      body: "Comment",
      createdAt: new Date("2026-07-15T10:00:00.000Z"),
    });

    expect(() => appendCommentV1(frontmatter, entry)).toThrow(code);
  });

  it("refuses to append a duplicate comment id", () => {
    const entry = createCommentV1({
      id: "cmt-duplicate",
      anchor: "^c-anchor",
      quote: "selection",
      body: "Comment",
      createdAt: new Date("2026-07-15T10:00:00.000Z"),
    });

    expect(() =>
      appendCommentV1(
        { comments_version: 1, comments: [entry] },
        entry
      )
    ).toThrow("DUPLICATE_COMMENT_ID");
  });
});
