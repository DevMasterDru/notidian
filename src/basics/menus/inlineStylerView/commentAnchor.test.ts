import { planCommentAnchor, resolveCommentAnchor } from "./commentAnchor";

describe("planCommentAnchor", () => {
  it("appends a generated block id to the end of a simple paragraph", () => {
    const document = "First paragraph line\ncontinues here\n\nNext paragraph";
    const from = document.indexOf("paragraph");
    const to = from + "paragraph".length;

    expect(
      planCommentAnchor({
        document,
        from,
        to,
        generateId: () => "c-anchor1",
      })
    ).toEqual({
      ok: true,
      anchor: "^c-anchor1",
      quote: "paragraph",
      change: {
        from: "First paragraph line\ncontinues here".length,
        to: "First paragraph line\ncontinues here".length,
        insert: " ^c-anchor1",
      },
    });
  });

  it("reuses an existing valid block id without editing the document", () => {
    const document = "Paragraph with anchor ^existing-id\n\nNext";
    const from = document.indexOf("Paragraph");
    const to = from + "Paragraph".length;

    expect(
      planCommentAnchor({
        document,
        from,
        to,
        generateId: () => "unused",
      })
    ).toEqual({
      ok: true,
      anchor: "^existing-id",
      quote: "Paragraph",
      change: null,
    });
  });

  it("anchors a specific list item on the selected bullet line", () => {
    const document = "- First item\n- Second item\n- Third item";
    const from = document.indexOf("Second");
    const to = from + "Second".length;
    const lineEnd = document.indexOf("\n", from);

    expect(
      planCommentAnchor({
        document,
        from,
        to,
        generateId: () => "c-list2",
      })
    ).toEqual({
      ok: true,
      anchor: "^c-list2",
      quote: "Second",
      change: {
        from: lineEnd,
        to: lineEnd,
        insert: " ^c-list2",
      },
    });
  });

  it("places a blockquote anchor on a separate line with blank-line boundaries", () => {
    const document = "> Quote line\n> continues\n\nAfter";
    const from = document.indexOf("Quote");
    const to = from + "Quote".length;
    const blockEnd = document.indexOf("\n\n");

    expect(
      planCommentAnchor({
        document,
        from,
        to,
        generateId: () => "c-quote",
      })
    ).toEqual({
      ok: true,
      anchor: "^c-quote",
      quote: "Quote",
      change: {
        from: blockEnd,
        to: blockEnd,
        insert: "\n\n^c-quote",
      },
    });
  });

  it("reuses a structured block id from the following standalone line", () => {
    const document = "> Quote line\n\n^existing-quote\n\nAfter";
    const from = document.indexOf("Quote");
    const to = from + "Quote".length;

    expect(
      planCommentAnchor({
        document,
        from,
        to,
        generateId: () => "unused",
      })
    ).toEqual({
      ok: true,
      anchor: "^existing-quote",
      quote: "Quote",
      change: null,
    });
  });

  it.each([
    ["empty selection", "Text", 1, 1, "EMPTY_SELECTION"],
    [
      "YAML frontmatter",
      "---\ntype: review\n---\nBody",
      4,
      8,
      "UNSUPPORTED_SELECTION",
    ],
    [
      "fenced code",
      "```ts\nconst value = 1;\n```\nBody",
      8,
      13,
      "UNSUPPORTED_SELECTION",
    ],
    ["blank line", "First\n\nSecond", 6, 7, "UNSUPPORTED_SELECTION"],
  ])("rejects an unsupported %s without planning a write", (_name, document, from, to, code) => {
    expect(
      planCommentAnchor({
        document,
        from,
        to,
        generateId: () => "unused",
      })
    ).toEqual({ ok: false, code });
  });

  it("retries generated ids until the anchor is collision-free", () => {
    const document = "Selected paragraph\n\nOther ^c-taken";
    const generated = ["c-taken", "c-free"];

    expect(
      planCommentAnchor({
        document,
        from: 0,
        to: "Selected".length,
        generateId: () => generated.shift() ?? "c-free",
      })
    ).toMatchObject({
      ok: true,
      anchor: "^c-free",
    });
  });

  it("anchors a selected heading on the heading line", () => {
    const document = "## Selected heading\nBody without a blank separator";
    const from = document.indexOf("Selected");
    const to = from + "Selected".length;
    const lineEnd = document.indexOf("\n");

    expect(
      planCommentAnchor({
        document,
        from,
        to,
        generateId: () => "c-heading",
      })
    ).toMatchObject({
      ok: true,
      anchor: "^c-heading",
      change: { from: lineEnd, to: lineEnd, insert: " ^c-heading" },
    });
  });

  it("anchors a multi-block selection to the block containing its start", () => {
    const document = "First block\n\nSecond block";

    expect(
      planCommentAnchor({
        document,
        from: document.indexOf("First"),
        to: document.indexOf("block", document.indexOf("Second")) + 5,
        generateId: () => "c-first",
      })
    ).toEqual({
      ok: true,
      anchor: "^c-first",
      quote: "First block\n\nSecond block",
      change: {
        from: "First block".length,
        to: "First block".length,
        insert: " ^c-first",
      },
    });
  });
});

describe("resolveCommentAnchor", () => {
  it("reports attached when the unique anchored block retains the quote", () => {
    expect(
      resolveCommentAnchor({
        document: "Selected text and more ^c-anchor\n\nNext",
        anchor: "^c-anchor",
        quote: "Selected text",
      })
    ).toEqual({ state: "attached" });
  });

  it("reports changed when the unique anchor remains but quote evidence does not", () => {
    expect(
      resolveCommentAnchor({
        document: "Rewritten text ^c-anchor",
        anchor: "^c-anchor",
        quote: "Original text",
      })
    ).toEqual({ state: "changed", code: "QUOTE_CHANGED" });
  });

  it("reports orphaned when the anchor is missing", () => {
    expect(
      resolveCommentAnchor({
        document: "Selected text without its id",
        anchor: "^c-anchor",
        quote: "Selected text",
      })
    ).toEqual({ state: "orphaned", code: "ANCHOR_NOT_FOUND" });
  });

  it("reports orphaned when the anchor occurs more than once", () => {
    expect(
      resolveCommentAnchor({
        document: "First ^c-anchor\n\nSecond ^c-anchor",
        anchor: "^c-anchor",
        quote: "First",
      })
    ).toEqual({ state: "orphaned", code: "ANCHOR_AMBIGUOUS" });
  });

  it("resolves a standalone structured-block anchor against its preceding block", () => {
    expect(
      resolveCommentAnchor({
        document: "> Selected quote\n\n^c-anchor\n\nNext",
        anchor: "^c-anchor",
        quote: "Selected quote",
      })
    ).toEqual({ state: "attached" });
  });
});
