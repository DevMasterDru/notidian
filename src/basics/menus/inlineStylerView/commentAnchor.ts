export type CommentAnchorFailureCode =
  | "EMPTY_SELECTION"
  | "UNSUPPORTED_SELECTION"
  | "ANCHOR_ID_UNAVAILABLE";

export type CommentAnchorPlan =
  | {
      ok: true;
      anchor: string;
      quote: string;
      change: { from: number; to: number; insert: string } | null;
    }
  | { ok: false; code: CommentAnchorFailureCode };

export type CommentAnchorResolution =
  | { state: "attached" }
  | { state: "changed"; code: "QUOTE_CHANGED" }
  | {
      state: "orphaned";
      code: "ANCHOR_NOT_FOUND" | "ANCHOR_AMBIGUOUS";
    };

const escapeRegExp = (value: string): string =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export const resolveCommentAnchor = (input: {
  document: string;
  anchor: string;
  quote: string;
}): CommentAnchorResolution => {
  const document = input.document.replace(/\r\n?/g, "\n");
  const quote = input.quote.replace(/\r\n?/g, "\n");
  const anchorPattern = new RegExp(
    `(^|\\s)(${escapeRegExp(input.anchor)})(?=\\s|$)`,
    "g"
  );
  const matches = Array.from(document.matchAll(anchorPattern));
  if (matches.length === 0) {
    return { state: "orphaned", code: "ANCHOR_NOT_FOUND" };
  }
  if (matches.length > 1) {
    return { state: "orphaned", code: "ANCHOR_AMBIGUOUS" };
  }

  const match = matches[0];
  const prefix = match[1] ?? "";
  const anchorStart = (match.index ?? 0) + prefix.length;
  const anchorEnd = anchorStart + input.anchor.length;
  const lineStartBreak = document.lastIndexOf("\n", anchorStart - 1);
  const lineStart = lineStartBreak === -1 ? 0 : lineStartBreak + 1;
  const lineEndBreak = document.indexOf("\n", anchorEnd);
  const lineEnd = lineEndBreak === -1 ? document.length : lineEndBreak;
  const line = document.slice(lineStart, lineEnd);
  const standalone = line.trim() === input.anchor;

  let anchoredStart: number;
  let anchoredEnd: number;
  let documentWithoutAnchor: string;
  if (standalone) {
    anchoredEnd = Math.max(0, lineStart - 2);
    const precedingBreak = document.lastIndexOf("\n\n", anchoredEnd - 1);
    anchoredStart = precedingBreak === -1 ? 0 : precedingBreak + 2;
    const removalStart =
      lineStart >= 2 && document.slice(lineStart - 2, lineStart) === "\n\n"
        ? lineStart - 2
        : lineStart;
    documentWithoutAnchor =
      document.slice(0, removalStart) + document.slice(lineEnd);
  } else {
    const isLineOwned = /^\s*(?:#{1,6}\s+|[-*+]\s+|\d+[.)]\s+)/.test(
      line
    );
    if (isLineOwned) {
      anchoredStart = lineStart;
      anchoredEnd = lineEnd;
    } else {
      const precedingBreak = document.lastIndexOf("\n\n", anchorStart - 1);
      anchoredStart = precedingBreak === -1 ? 0 : precedingBreak + 2;
      const followingBreak = document.indexOf("\n\n", anchorEnd);
      anchoredEnd = followingBreak === -1 ? document.length : followingBreak;
    }
    const removalStart =
      anchorStart > 0 && document[anchorStart - 1] === " "
        ? anchorStart - 1
        : anchorStart;
    documentWithoutAnchor =
      document.slice(0, removalStart) + document.slice(anchorEnd);
  }

  let quoteStart = documentWithoutAnchor.indexOf(quote);
  while (quoteStart !== -1) {
    if (quoteStart >= anchoredStart && quoteStart <= anchoredEnd) {
      return { state: "attached" };
    }
    quoteStart = documentWithoutAnchor.indexOf(quote, quoteStart + 1);
  }
  return { state: "changed", code: "QUOTE_CHANGED" };
};

const generateUniqueAnchorId = (
  document: string,
  generateId: () => string
): string | null => {
  for (let attempt = 0; attempt < 16; attempt++) {
    const id = generateId();
    if (!/^[A-Za-z0-9-]+$/.test(id)) continue;
    const token = `^${id}`;
    const collision = document
      .split(/\s+/)
      .some((part) => part === token);
    if (!collision) return id;
  }
  return null;
};

export const planCommentAnchor = (input: {
  document: string;
  from: number;
  to: number;
  generateId: () => string;
}): CommentAnchorPlan => {
  if (
    input.from < 0 ||
    input.to > input.document.length ||
    input.from >= input.to
  ) {
    return { ok: false, code: "EMPTY_SELECTION" };
  }
  if (input.document.startsWith("---\n")) {
    const closingFrontmatter = input.document.indexOf("\n---", 4);
    if (closingFrontmatter !== -1 && input.from < closingFrontmatter + 4) {
      return { ok: false, code: "UNSUPPORTED_SELECTION" };
    }
  }
  const fenceCount = (
    input.document.slice(0, input.from).match(/^\s*(?:```|~~~)/gm) ?? []
  ).length;
  if (fenceCount % 2 === 1) {
    return { ok: false, code: "UNSUPPORTED_SELECTION" };
  }
  const lineStartBreak = input.document.lastIndexOf("\n", input.from - 1);
  const lineStart = lineStartBreak === -1 ? 0 : lineStartBreak + 1;
  const lineEndBreak = input.document.indexOf("\n", input.from);
  const lineEnd = lineEndBreak === -1 ? input.document.length : lineEndBreak;
  const selectedLine = input.document.slice(lineStart, lineEnd);
  if (selectedLine.trim().length === 0) {
    return { ok: false, code: "UNSUPPORTED_SELECTION" };
  }
  const isListItem = /^\s*(?:[-*+]|\d+[.)])\s+/.test(selectedLine);
  const isHeading = /^\s{0,3}#{1,6}\s+/.test(selectedLine);
  if (isListItem || isHeading) {
    const existingLineAnchor = selectedLine.match(
      /(?:^|\s)(\^[A-Za-z0-9-]+)\s*$/
    )?.[1];
    if (existingLineAnchor) {
      return {
        ok: true,
        anchor: existingLineAnchor,
        quote: input.document.slice(input.from, input.to),
        change: null,
      };
    }
    const lineId = generateUniqueAnchorId(input.document, input.generateId);
    if (!lineId) return { ok: false, code: "ANCHOR_ID_UNAVAILABLE" };
    return {
      ok: true,
      anchor: `^${lineId}`,
      quote: input.document.slice(input.from, input.to),
      change: { from: lineEnd, to: lineEnd, insert: ` ^${lineId}` },
    };
  }
  const precedingBreak = input.document.lastIndexOf("\n\n", input.from - 1);
  const blockStart = precedingBreak === -1 ? 0 : precedingBreak + 2;
  const blockBreak = input.document.indexOf("\n\n", input.from);
  const blockEnd = blockBreak === -1 ? input.document.length : blockBreak;
  const isStructuredBlock = /^\s*(?:>|\|)/.test(selectedLine);
  const existingAnchor = input.document
    .slice(blockStart, blockEnd)
    .match(/(?:^|\s)(\^[A-Za-z0-9-]+)\s*$/)?.[1];
  if (existingAnchor) {
    return {
      ok: true,
      anchor: existingAnchor,
      quote: input.document.slice(input.from, input.to),
      change: null,
    };
  }
  const followingStructuredAnchor = isStructuredBlock
    ? input.document.slice(blockEnd).match(/^\n\n(\^[A-Za-z0-9-]+)(?=\n|$)/)?.[1]
    : undefined;
  if (followingStructuredAnchor) {
    return {
      ok: true,
      anchor: followingStructuredAnchor,
      quote: input.document.slice(input.from, input.to),
      change: null,
    };
  }
  const id = generateUniqueAnchorId(input.document, input.generateId);
  if (!id) return { ok: false, code: "ANCHOR_ID_UNAVAILABLE" };
  return {
    ok: true,
    anchor: `^${id}`,
    quote: input.document.slice(input.from, input.to),
    change: {
      from: blockEnd,
      to: blockEnd,
      insert: isStructuredBlock ? `\n\n^${id}` : ` ^${id}`,
    },
  };
};
